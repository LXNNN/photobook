import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppDispatch } from '@/store';
import { setCurrentProject } from '@/store/projectSlice';
import SpreadZoom from '@/components/viewer/SpreadZoom';
import { getProject } from '@/utils/storage';
import { decodeAssets } from '@/utils/assetStore';
import { ensureFolderReady } from '@/utils/folderLibrary';
import { exportImagesZip, spreadGroups, type ImageExportMode } from '@/utils/exportImages';
import { downloadBlob } from '@/utils/backup';
import { mmToPx } from '@/utils/units';
import { drawPageContent, collectAssetIds } from '@/engine/drawPageContent';
import { jsPDF } from 'jspdf';
import type { Project } from '@/types';
import type { PageFlip } from 'page-flip';

/** 书本在桌面上的可见横向范围（相对书盒左缘） */
interface BookSpan {
  left: number;
  right: number;
}

// 启动守卫在 StrictMode 下会跑两遍，提示只弹一次
let folderGuardAlerted = false;

/**
 * 根据当前页计算书本可见范围
 * showCover 布局：[[0], [1,2], [3,4], ..., [n-1]]（n 为偶数时末页单独在左）
 * 闭合态书在右半、翻开后占满、结尾（n 为偶数）书在左半
 */
function computeSpan(pageIndex: number, total: number, bookW: number): BookSpan {
  const n = Math.max(total, 1);
  const leftPages = pageIndex <= 0 ? 0 : Math.min(pageIndex + 1, n);
  const rightPages = n - leftPages;
  return {
    left: leftPages === 0 ? bookW / 2 : 0,
    right: rightPages === 0 ? bookW / 2 : bookW,
  };
}

export default function Viewer() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageFlipRef = useRef<PageFlip | null>(null);
  // 页面图现在是 object URL（比 dataURL 少一层 base64 编解码），用完要还回去
  const pageUrlsRef = useRef<string[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [bookSize, setBookSize] = useState({ w: 0, h: 0 }); // 初始为0，等计算完成
  const [span, setSpan] = useState<BookSpan>({ left: 0, right: 0 });
  const [isOpening, setIsOpening] = useState(false); // 正在从闭合态展开
  const [flipToClosed, setFlipToClosed] = useState(false); // 这趟翻页的落点是"只有一页"的合起态
  const [entered, setEntered] = useState(false); // 入场动画完成
  const [exportMenuOpen, setExportMenuOpen] = useState(false); // 「📥 导出」的小菜单
  const [exporting, setExporting] = useState(false); // 导出中（PDF / 图片都算）
  // 图片导出的进度（PDF 导出没这个，导出中显示"⏳ 导出中 N/M"）
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [magnified, setMagnified] = useState(false); // 放大镜开着
  // 当前页码的镜像。书是按 bookSize 重建的（放大 / 退出放大 / 窗口尺寸变了都会
  // 重建一次），重建后要翻回原来那一页 —— 但那个 effect 绝不能把 currentPage
  // 写进依赖里，它一跑就会把正在看的书拆了重做
  const currentPageRef = useRef(0);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // 启动时已启用文件夹模式但还没连上：不进入预览（§5.3），先回书架重连
  useEffect(() => {
    if (ensureFolderReady()) return;
    if (!folderGuardAlerted) {
      folderGuardAlerted = true;
      alert('文件夹还没连上。照片暂时读不出来，先回书架页点「重新连接」再预览吧');
    }
    navigate('/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 页面图是 object URL，离开预览页时统一还回去。
  // ref 里攒了本次挂载产生过的全部 URL（含 StrictMode 下多跑那一轮的），
  // 所以这里能一次清干净。
  useEffect(
    () => () => {
      pageUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      pageUrlsRef.current = [];
    },
    []
  );

  // 加载项目
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const p = await getProject(projectId);
        if (p) {
          setProject(p);
          dispatch(setCurrentProject(p));
          await renderAllPages(p);
        } else {
          navigate('/');
        }
      } catch (err) {
        console.error('加载项目失败:', err);
        setLoading(false);
      }
    })();
  }, [projectId, dispatch, navigate]);

  // 渲染所有页面为图片
  async function renderAllPages(p: Project) {
    setLoading(true);
    const dpi = 150;

    const assets = await decodeAssets(collectAssetIds(p.pages));

    const images: string[] = [];
    for (const page of p.pages) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(mmToPx(p.format.width, dpi));
      canvas.height = Math.round(mmToPx(p.format.height, dpi));
      const ctx = canvas.getContext('2d')!;

      // 页面怎么画只有 engine/drawPageContent 这一份实现（编辑器主画布、缩略图
      // 和这里都走它），别再在页面里另写一套 —— 之前那套就漏了旋转和 cover 裁剪。
      drawPageContent(ctx, page, p.format, dpi, assets);

      // 用 toBlob 而不是 toDataURL：编码交给后台线程，主线程不用停下来等。
      // toDataURL 是同步的，每页都要把主线程按住几十毫秒，页数一多就是实打实的一秒多；
      // 而且产出的 base64 比原图大三分之一，塞进 <img> 还得再解一遍 base64。
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9)
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        pageUrlsRef.current.push(url);
        images.push(url);
      }
    }

    setPageImages(images);
    setTotalPages(images.length);
  }

  // 计算书页尺寸
  useEffect(() => {
    const calcSize = () => {
      // 放大镜里书要铺满整个窗口（上下各留 72px 给关闭键和提示条，左右各留 64px）；
      // 平时预览则把整本书夹在 900px 内 —— 屏幕上看到多大就等于印出来多大，
      // 书本身该多大还是多大，放大只是临时看一次
      const maxW = magnified ? window.innerWidth - 128 : Math.min(window.innerWidth - 200, 900);
      const maxH = magnified ? window.innerHeight - 144 : window.innerHeight - 160;
      const ratio = 148 / 210;
      let pageW = Math.min(maxW / 2, maxH / ratio);
      let pageH = pageW / ratio;
      if (pageH > maxH) {
        pageH = maxH;
        pageW = pageH * ratio;
      }
      setBookSize((prev) => {
        const next = { w: Math.round(pageW * 2), h: Math.round(pageH) };
        // 尺寸没变就返回原对象，React 会跳过更新，也就不会把整本书拆了重建。
        // 宽高被 maxW/maxH 夹住的情况下，很多 resize 其实并不改变尺寸。
        return prev.w === next.w && prev.h === next.h ? prev : next;
      });
    };
    calcSize();
    window.addEventListener('resize', calcSize);
    return () => window.removeEventListener('resize', calcSize);
  }, [magnified]);

  // 初始化 PageFlip - 等所有准备好再开始
  useEffect(() => {
    // 等所有条件都满足：
    // 1. 页面图片已加载
    // 2. 书页尺寸已计算
    // 3. 容器已存在
    if (pageImages.length === 0 || bookSize.w === 0 || !containerRef.current) return;

    const container = containerRef.current;
    container.innerHTML = '';

    // PageFlip 的 destroy() 里有 `this.block.remove()`，block 就是构造时传进去的
    // 那个元素。如果直接把 React 管的 container 传进去，destroy 会把 container
    // 本身从 DOM 里摘掉，而 React 并不知道它没了 —— 之后的渲染只会继续往这个
    // 游离节点里画，书就再也不出现了（改窗口大小后整本书消失就是这个）。
    // 所以自己造一层壳交给它，让它删自己的壳。
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;';
    container.appendChild(host);

    // 实例是在异步链里建的（要先等图片加载、再动态 import），cleanup 跑的时候
    // 它可能还没出生。没有这两个变量的话：effect 一重跑 → cleanup 里 ref 还是
    // null → 没销毁任何东西 → 上一次的异步链照样把 PageFlip 建出来，于是同一个
    // 容器上挂了两套书。两套书各有一套 rAF 渲染循环、各自记着自己的页码，
    // 就会互相盖来盖去、露出"残页"（末页看着像跨页就是这么来的）。
    // bookSize 变一次、窗口 resize、StrictMode 挂载两遍都会触发重跑，
    // 实测 8 次加载有 6 次撞上。
    let cancelled = false;
    let created: PageFlip | null = null;

    const n = pageImages.length;

    // 创建页面元素
    const pageElements: HTMLElement[] = [];
    for (let i = 0; i < n; i++) {
      const page = document.createElement('div');
      // 初始隐藏：PageFlip 只对当前跨页和翻页中的页面调用 simpleDraw/draw（都会重写 style 并设 display:block），
      // 非激活页若可见会以 100% 宽的白底堆在容器里，闭合态时左侧会露出一个"空白页"
      page.style.display = 'none';
      page.style.width = '100%';
      page.style.height = '100%';
      page.style.overflow = 'hidden';
      page.style.background = '#fff';
      page.style.position = 'relative';
      page.dataset.index = String(i);

      const img = document.createElement('img');
      img.src = pageImages[i];
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.display = 'block';
      page.appendChild(img);

      // ===== 中缝折线：浅灰色细线 =====
      // 页序（showCover）：封面(0)单独在右、奇数页在左、偶数页在右、n 为偶数时末页单独在左
      const isLeftSide = i % 2 === 1 || (i === n - 1 && n % 2 === 0);
      const edge = isLeftSide ? 'right' : 'left'; // 靠书脊的一侧

      const creaseLine = document.createElement('div');
      creaseLine.style.position = 'absolute';
      creaseLine.style.top = '0';
      creaseLine.style.bottom = '0';
      creaseLine.style.width = '1px';
      if (edge === 'right') creaseLine.style.right = '0';
      else creaseLine.style.left = '0';
      creaseLine.style.background = 'rgba(150,145,135,0.35)';
      creaseLine.style.pointerEvents = 'none';
      page.appendChild(creaseLine);

      host.appendChild(page);
      pageElements.push(page);
    }

    // 等待所有图片加载完成
    const imgPromises = Array.from(host.querySelectorAll('img')).map(
      (img) => new Promise<void>((resolve) => {
        if (img.complete) resolve();
        else {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }
      })
    );

    Promise.all(imgPromises).then(() => {
      import('page-flip').then(({ PageFlip }) => {
        // 异步期间 effect 已经重跑过：容器里的东西早被清掉换成新的了，
        // 这次的结果直接作废，别在同一个容器上再建一套
        if (cancelled) return;

        const pageFlip = new PageFlip(host, {
          width: bookSize.w / 2,
          height: bookSize.h,
          size: 'fixed',
          drawShadow: false,
          flippingTime: 800,
          usePortrait: false,
          startZIndex: 0,
          autoSize: false,
          maxShadowOpacity: 0,
          showCover: true,
          mobileScrollSupport: true,
          swipeDistance: 50,
          clickEventForward: true,
          useMouseEvents: true,
          // 关闭悬停角部的折叠预览效果，只有点击才翻页
          showPageCorners: false,
        });

        created = pageFlip;
        pageFlip.loadFromHTML(pageElements);
        pageFlipRef.current = pageFlip;

        // 初始：闭合态，书在右半
        setSpan(computeSpan(0, n, bookSize.w));

        // 手动显示第一页（封面）
        if (pageElements.length > 0) {
          pageElements[0].style.display = 'block';
        }

        pageFlip.on('flip', (e) => {
          const idx = typeof e.data === 'number' ? e.data : pageFlip.getCurrentPageIndex();
          setCurrentPage(idx);
          setSpan(computeSpan(idx, n, bookSize.w));
        });

        // 这趟翻页翻完，会不会落到"只有一页"的合起状态（封面 0、或 n 为偶数时的末页 n-1）？
        // 落点是合起态的话，摊开时那片整体投影从点击那一刻就该撤掉（见下面的 showSpreadShadow）。
        // 方向问 page-flip 自己，不按点击位置猜：FlipDirection.FORWARD = 0、BACK = 1。
        // 能翻到合起态的只有两种走法：从封面往回翻（当前在第 1 页）、
        // 从倒数第二个跨页往后翻到末页（当前在 n-3）。n 为奇数时没有单独一页的末页，
        // 这时 n-3 不是跨页起始页，条件自然不成立（n=3 是例外，n-3=0 正好是封面，所以还要 n 为偶数）。
        const updateFlipToClosed = () => {
          const calc = pageFlip.getFlipController()?.getCalculation();
          if (!calc) return; // 方向还没定（比如这个方向翻不动），保持原样
          const from = pageFlip.getCurrentPageIndex();
          setFlipToClosed(
            calc.getDirection() === 0 ? n % 2 === 0 && from === n - 3 : from === 1
          );
        };

        // 翻页状态机：按下/翻页中 → 把"居中+倾斜"复位，与翻页动画同步
        pageFlip.on('changeState', (e) => {
          const s = e.data as string;
          if (s === 'flipping') {
            // 单击翻页走这条路，这时方向已经定了
            setIsOpening(true);
            updateFlipToClosed();
          } else if (s === 'user_fold') {
            // 拖拽翻页只发 user_fold、不发 flipping，方向也得算。
            // 但 fold() 是先发状态、后建 calc 的，这一拍方向还没出来，等一个微任务再读。
            setIsOpening(true);
            queueMicrotask(updateFlipToClosed);
          } else if (s === 'read') {
            setIsOpening(false);
            setFlipToClosed(false);
          }
        });

        // 书是按 bookSize 重建的，而放大镜就是靠改 bookSize 实现的
        // （点击「🔍 放大」→ 书页尺寸变大 → 这里重跑一遍）。新建的书总是从
        // 封面开始，所以要把书翻回原来那一页，不然点一下放大就被送回封面了。
        // 用瞬跳 turnToPage —— 这是重建、不是在翻页，不该播一段翻页动画
        const restore = currentPageRef.current;
        if (restore > 0) {
          pageFlip.turnToPage(restore);
          setCurrentPage(restore);
          setSpan(computeSpan(restore, n, bookSize.w));
        } else {
          setCurrentPage(0);
        }
        setLoading(false); // 初始化完成，隐藏 loading
        // 下一帧再置位，让入场过渡生效
        setTimeout(() => setEntered(true), 30);
      });
    });

    return () => {
      cancelled = true;
      // 销毁"本次"建的那个实例：ref 里放的可能是后一次 effect 建的书，
      // 无脑 destroy() 会把新书拆掉、把旧书留在页面上
      created?.destroy();
      if (pageFlipRef.current === created) pageFlipRef.current = null;
    };
  }, [pageImages, bookSize]);


  // ===== 翻页为什么用 flipNext / flipPrev，而不是别的 =====
  // page-flip 有三套翻页入口，坑在中间那套：
  //   turnToNextPage / turnToPrevPage → 内部的 showNext()/showPrev()：瞬跳。
  //     showNext() 把上界写成了 `currentSpreadIndex < getSpread().length`（该是
  //     length - 1），在最后一个跨页再往后翻就会先把下标 ++ 到越界值，再读
  //     `undefined.length` 抛 TypeError，下标卡在非法值上。症状：到末页后第一次
  //     按「上一页」毫无反应（那一下只是把非法下标拉回合法），要按第二次才退得回去。
  //     这是库的内部缺陷，别去改 node_modules，绕开它。
  //   turnToPage → show()：瞬跳，自带边界检查 —— 重建书之后恢复页码用它。
  //   flipNext / flipPrev → FlipController：**带动画**（就是点击书页走的那条路），
  //     而且进动画之前先过一遍 checkDirection()：往后翻要求「当前页 < 总页数-1」、
  //     往回翻要求「当前页 >= 1」，翻不动直接 return —— 那条会越界的路径走不到。
  // 所以按钮和键盘都用 flipNext/flipPrev：翻页动画本来就是书该有的样子，放大镜里
  // 点击书页走的是同一条路，三个入口表现完全一致。各自的边界再自己把一道，双保险。
  const goPrev = useCallback(() => {
    const pf = pageFlipRef.current;
    if (!pf) return;
    if (pf.getCurrentPageIndex() <= 0) return; // 已经在封面
    pf.flipPrev();
  }, []);

  const goNext = useCallback(() => {
    const pf = pageFlipRef.current;
    if (!pf) return;
    const cur = pf.getCurrentPageIndex();
    // 封面(0) 后面接着的是第 1 页开头的跨页；其余跨页往后跳两页
    const next = cur <= 0 ? 1 : cur + 2;
    if (next >= totalPages) return; // 已经在最后一个跨页
    pf.flipNext();
  }, [totalPages]);

  // 放大镜开着时：点在书页以外的地方退出放大。
  // 不能只靠黑幕自己接点击 —— page-flip 的 .stf__block 比整本书大一圈（所有页面
  // 都并排摆在里面、靠 transform 挪到眼前），书以外那片空白也归它吃，点黑边根本
  // 落不到黑幕上。所以按落点判断：点在书页上不动（那是翻页，page-flip 自己在处理），
  // 点在别处就退。按钮层用 data 标记排除掉。
  useEffect(() => {
    if (!magnified) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('[data-magnify-chrome]') || t.closest('.stf__item')) return;
      setMagnified(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [magnified]);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'Escape') {
        // ESC 逐层退：先关导出菜单、再关放大镜，最后才返回编辑页，别一键把人送走
        if (exportMenuOpen) setExportMenuOpen(false);
        else if (magnified) setMagnified(false);
        else navigate(`/editor/${projectId}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId, navigate, goPrev, goNext, magnified, exportMenuOpen]);

  // 导出 PDF
  async function handleExportPDF() {
    if (!project || exporting) return;
    setExporting(true);

    try {
      const dpi = 300; // 打印社标准 300 DPI
      const pages = project.pages;
      const format = project.format;

      // A5 尺寸（mm）
      const pageWidthMm = format.width;
      const pageHeightMm = format.height;

      // 创建 PDF
      const pdf = new jsPDF({
        orientation: pageWidthMm > pageHeightMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidthMm, pageHeightMm],
      });

      // 整本书用到的图一次解码好，逐页复用。
      // 原来是每页都把本页的图重新读库、重新解码一遍，同一张照片横跨几页就解几遍。
      const assets = await decodeAssets(collectAssetIds(pages));

      // 渲染每一页并添加到 PDF
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(mmToPx(format.width, dpi));
        canvas.height = Math.round(mmToPx(format.height, dpi));
        const ctx = canvas.getContext('2d')!;

        // 渲染页面内容
        drawPageContent(ctx, page, format, dpi, assets);

        // 转成图片并添加到 PDF
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (i === 0) {
          pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
        } else {
          pdf.addPage([pageWidthMm, pageHeightMm], pageWidthMm > pageHeightMm ? 'landscape' : 'portrait');
          pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
        }
      }

      // 下载 PDF
      pdf.save(`${project.name || '相册'}.pdf`);
    } catch (err) {
      console.error('导出 PDF 失败:', err);
      alert('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  // 导出图片（单面 / 双面）→ zip 打包下载
  async function handleExportImage(mode: ImageExportMode) {
    if (!project || exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await exportImagesZip(project, mode, (done, total) =>
        setExportProgress({ done, total })
      );
      downloadBlob(blob, filename);
    } catch (err) {
      console.error('导出图片失败:', err);
      alert(err instanceof Error && err.message === '这本相册还没有页面，没有可导出的内容'
        ? err.message
        : '导出失败，请重试');
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  // ===== 导出的张数（菜单里直接告诉她会得到几张）=====
  // 用 project.pages 而不是 pageImages：万一某页的图没生成出来，页码也还是对的
  const pageCount = project?.pages.length ?? 0;
  const spreadCount = spreadGroups(pageCount).length;

  // ===== 闭合态居中 =====
  // 闭合态：封面单独在右半（showCover 布局），平移 -W/4 让封面居中
  // 结尾态（n 为偶数）：背封单独在左半，平移 +W/4 居中
  const closed = currentPage === 0;
  const endClosed = totalPages > 1 && currentPage === totalPages - 1 && totalPages % 2 === 0;
  const isClosedState = (closed || endClosed) && !isOpening;

  // ===== 摊开时那片整体投影 =====
  // 它的亮灭时机跟书脊/半页阴影是反的，不能用 isClosedState 那个开关：
  //   翻开第一页：点击那一下书还合着，投影不能先铺开 —— 等动画走完、书真正摊开了再亮
  //   合上最后一页：点下去那一下就撤掉，不能等动画走完
  // isClosedState 里有 !isOpening，而 isOpening 在点击瞬间就翻成 true 了，两头都会错。
  // 所以这里看的是"这趟翻完书还会不会摊着"：closed / endClosed 按已落定的页码算，
  // 翻开的过程中一直是 true（投影自然是灭的）、合上的过程中一直是 false，
  // 就差 flipToClosed —— 这趟的落点是合起态。
  const showSpreadShadow = !closed && !endClosed && !flipToClosed;
  // 封面在右半页（中心在书盒中心右侧 W/4），要居中需向左移 W/4；结尾背封在左半，向右移 W/4
  const centerOffset = closed ? -bookSize.w / 4 : endClosed ? bookSize.w / 4 : 0;
  const offset = isClosedState ? centerOffset : 0;
  const bookTransform = `translateX(${offset}px) scale(${entered ? 1 : 0.94})`;
  const bookTransition =
    'transform 700ms cubic-bezier(0.33, 0, 0.2, 1), opacity 400ms ease, box-shadow 500ms ease';

  // ===== 合起来时的书脊 =====
  // 就是首页书架上那本书的做法：书脊那一侧一条灰色窄边、书口那一侧一点投影。
  // 封面态封面单独占右半，书脊在它的左缘；封底态背封单独占左半，书脊在它的右缘
  // （书翻过来了，书脊跟着换到另一侧）。两处都正好落在书盒中线上，
  // 所以锚点统一用 50%，只把方向和圆角镜像一下。
  // 另一侧的书口靠下面那层半页阴影往外投出来，x 偏移要跟着换边，见那里的 boxShadow。
  const spineOnLeft = closed;
  // 实测量过书架：封面 139px、灰边 4px，占 2.88%。书架的灰边是写死的 4px、
  // 书宽随屏幕变，所以这个比例不是设计常量；按当前常见屏幕取 2.9% 等比放大，
  // 观感才跟书架一致（450px 的封面 → 13px）。
  const spineW = Math.max(4, Math.round((bookSize.w / 2) * 0.029));
  // 书架上 4px 的边往书脊那侧偏 3px（探出去一截），这里保持同样的比例
  const spineLean = Math.round(spineW * 0.75);
  // 探出去的那一侧修圆，跟书架的 rounded-l-lg 一样
  const spineRadius = spineOnLeft
    ? `${spineW}px 0 0 ${spineW}px`
    : `0 ${spineW}px ${spineW}px 0`;
  // 书口（书脊对面那条边）朝哪一侧：封面态书脊在左、书口朝右，封底态反过来。
  // 下面那层半页阴影要往书口外侧投，x 偏移的正负跟着它走
  const foreEdge = spineOnLeft ? 1 : -1;

  return (
    <div className="w-full h-full flex flex-col bg-[#6c7d9b] select-none overflow-hidden">
      {/* 顶部栏 */}
      <header className="h-14 bg-black/20 backdrop-blur flex items-center justify-between px-6 text-white z-10 flex-shrink-0 border-b border-white/10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm text-white hover:text-gray-200 transition-colors"
          >
            🏠 首页
          </button>
          <button
            onClick={() => navigate(`/editor/${projectId}`)}
            className="flex items-center gap-2 text-sm text-white hover:text-gray-200 transition-colors"
          >
            ← 返回编辑
          </button>
        </div>
        <h1 className="text-sm font-medium text-white">{project?.name}</h1>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-300">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setMagnified(true)}
            disabled={pageImages.length === 0}
            className="flex items-center gap-1.5 text-sm text-white hover:text-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="放大当前跨页看文字"
          >
            🔍 放大
          </button>
          {/* 📥 导出：PDF 和图片（单面 / 双面）都收在这个下拉里 */}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={exporting || !project}
              title="导出 PDF 或图片"
              className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting
                ? exportProgress
                  ? `⏳ 导出中 ${exportProgress.done}/${exportProgress.total}`
                  : '⏳ 导出中...'
                : '📥 导出 ▾'}
            </button>
            {exportMenuOpen && !exporting && (
              <>
                {/* 点别处就把菜单收起来（满屏的透明层接住点击，不改别处的行为） */}
                <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-72 py-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      void handleExportPDF();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-amber-50 transition-colors"
                  >
                    📄 导出 PDF（打印用）
                  </button>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      void handleExportImage('single');
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-amber-50 transition-colors"
                  >
                    🖼️ 导出图片 · 单面（每页一张，{pageCount} 张）
                  </button>
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      void handleExportImage('spread');
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-amber-50 transition-colors"
                  >
                    🖼️ 导出图片 · 双面（左右摊开，{spreadCount} 张）
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 翻书区域 */}
      <div className="flex-1 flex items-center justify-center relative">
        {/* loading 遮罩 */}
        {loading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#2c3a55]">
            <div className="text-center">
              <div className="text-5xl mb-4 animate-pulse">📖</div>
              <p className="text-gray-300">正在加载相册...</p>
            </div>
          </div>
        )}

        {/* 左侧翻页按钮 */}
        <button
          onClick={goPrev}
          className="absolute left-4 z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-gray-200 transition-all backdrop-blur-sm"
          aria-label="上一页"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* 右侧翻页按钮 */}
        <button
          onClick={goNext}
          className="absolute right-4 z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-gray-200 transition-all backdrop-blur-sm"
          aria-label="下一页"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* 书本：桌面投影 + PageFlip 容器 */}
        <div
          className="relative"
          style={{
            width: bookSize.w || 700,
            height: bookSize.h || 500,
            // 放大镜时把书抬到黑幕（z-30）之上：书是真的变大了，翻页动画、
            // 点击翻页、边角手势全由 page-flip 原生处理，不能拿别的东西盖住它
            zIndex: magnified ? 40 : undefined,
            // 摊开时的整体书阴影（开会合上的时机见 showSpreadShadow）
            boxShadow: showSpreadShadow
              ? '0 22px 55px rgba(90,70,45,0.3), 0 3px 10px rgba(90,70,45,0.2)'
              : 'none',
            visibility: loading ? 'hidden' : 'visible',
            transform: bookTransform,
            transition: bookTransition,
            opacity: entered ? 1 : 0,
          }}
        >
          {/* 桌面投影 */}
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 2px)', height: 50,
              left: span.left - 24, right: bookSize.w - span.right - 24,
              background:
                'radial-gradient(ellipse 50% 55% at 50% 22%, rgba(80,65,40,0.38) 0%, rgba(80,65,40,0.16) 45%, rgba(80,65,40,0) 78%)',
              filter: 'blur(9px)',
              transition: 'left 300ms ease, right 300ms ease',
            }}
          />
          {/* 合起来时只有半页可见（封面在右半、封底在左半）。
              整盒投影会糊到空着的那半页上，所以单独给可见的半页铺一层，
              垫在 PageFlip 容器下面，只露出封面轮廓之外的部分。
              数值照抄首页书架上那本书的 boxShadow。 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: closed ? '50%' : 0,
              right: closed ? 0 : '50%',
              // 书架上那本的 boxShadow 是 `2px 2px 8px rgba(0,0,0,0.1)`，那是画在
              // 约 200px 宽的书上；这里封面有 450px，等比例放大才是同一个观感。
              // x 偏移要朝"书口"那一侧投：封面朝上时书在右半、书口是右沿（往右投），
              // 封底朝上时书在左半、书口换成左沿（得往左投）。
              // 分两道：贴着边沿的那道窄、偏移小，负责把书的边"切"出一道清楚的轮廓；
              // 外面那道宽而散的托体积。只留一道柔影的话边沿是糊的，书立不起来。
              boxShadow: `${foreEdge * 2}px 3px 7px rgba(0,0,0,0.22), ${foreEdge * 9}px 9px 28px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(0,0,0,0.06)`,
              opacity: isClosedState ? 1 : 0,
              transition: 'opacity 320ms ease',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          {/* PageFlip 容器 */}
          <div ref={containerRef} className="absolute inset-0 z-[1]" />
          {/* 书脊灰边：书本的厚度感，跟书架上那本一模一样。
              封面态贴在封面左缘、封底态贴在背封右缘，两处都落在书盒中线上。 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: spineOnLeft ? '50%' : undefined,
              right: spineOnLeft ? undefined : '50%',
              width: spineW,
              transform: `translateX(${spineOnLeft ? -spineLean : spineLean}px)`,
              // 书架上那本是 from-gray-300 to-gray-200，但它是摆在白卡片上，
              // 灰比白深、读起来才是"厚度"。这里的桌面是米色的，照抄同一组灰
              // 会反而比背景亮、变成一道高光，所以整体压深一档，保持同样的
              // "外深内浅"两段式，落在米色背景上仍然是暗面。
              background: `linear-gradient(to ${spineOnLeft ? 'right' : 'left'}, #c2c5ca, #e4e5e7)`,
              borderRadius: spineRadius,
              opacity: isClosedState ? 1 : 0,
              transition: 'opacity 320ms ease',
              // 不能挡 PageFlip 的翻页点击
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
        </div>
      </div>

      {/* 底部提示 */}
      <div className="h-10 bg-black/20 flex items-center justify-center flex-shrink-0 border-t border-white/10">
        <p className="text-xs text-gray-300">
          {isClosedState
            ? '点击封面翻开相册'
            : '点击书页翻页 · 键盘 ← → 翻页 · 🔍 放大看文字 · ESC 返回'}
        </p>
      </div>

      {/* 放大镜：书本身放大到铺满屏幕（书页尺寸真的变大，见 calcSize），
          page-flip 按新尺寸重建，所以翻页动画、点击翻页、边角手势全是原生的。
          这层黑幕垫在书下面（书被抬到 z-40）；"点书页以外退出"由上面那个
          落点判断的监听负责，黑幕自己接不到点击（page-flip 的 block 比书大一圈） */}
      {magnified && <div className="fixed inset-0 z-30 bg-black/90" />}

      {/* 放大镜的按钮层：箭头 / 关闭 / 提示条。整层不吃鼠标（pointer-events-none），
          只有按钮自己接事件 —— 点在书页上要原样落到 page-flip 手里，才能翻出动画。
          挂在最外层（没有 transform / backdrop-filter 的祖先），fixed inset-0 才相对窗口定位 */}
      {magnified && (
        <SpreadZoom
          onPrev={goPrev}
          onNext={goNext}
          // 能不能翻，跟 goPrev / goNext 里的边界判断保持一致
          canPrev={currentPage > 0}
          canNext={(currentPage <= 0 ? 1 : currentPage + 2) < totalPages}
          onClose={() => setMagnified(false)}
        />
      )}
    </div>
  );
}
