import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppDispatch } from '@/store';
import { setCurrentProject } from '@/store/projectSlice';
import SpreadZoom from '@/components/viewer/SpreadZoom';
import { getProject } from '@/utils/storage';
import { decodeAssets } from '@/utils/assetStore';
import {
  decodePreviewAssets,
  collectImageIdsForPages,
  type PreviewImage,
} from '@/utils/previewAssets';
import { ensureFolderReady } from '@/utils/folderLibrary';
import {
  exportImagesZip,
  spreadGroups,
  SHOW_IMAGE_EXPORT_ENTRY,
  type ImageExportMode,
} from '@/utils/exportImages';
import { downloadBlob } from '@/utils/backup';
import { mmToPx } from '@/utils/units';
import { drawPageContent, collectAssetIds, ensureStaticBackgroundsLoaded } from '@/engine/drawPageContent';
import { ensureFontsLoaded } from '@/utils/fonts';
import { jsPDF } from 'jspdf';
import type { BookFormat, Page, Project } from '@/types';

/** 书本在桌面上的可见横向范围（相对书盒左缘） */
interface BookSpan {
  left: number;
  right: number;
}

// 启动守卫在 StrictMode 下会跑两遍，提示只弹一次
let folderGuardAlerted = false;

/** 首屏优先渲染的页数：封面 + 前两个跨页，翻开书立刻有内容 */
const FIRST_SCREEN_PAGES = 6;

/** 还没画好的页先放 1×1 透明占位，后台画完再换 */
const PAGE_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** 一次翻页动画的时长（毫秒） */
const FLIP_DURATION = 800;

/** 一次翻页：从哪一跨页翻到哪一跨页 */
interface FlipAnim {
  dir: 'next' | 'prev';
  from: number; // spreadGroups 的下标
  to: number;
}

/**
 * 一组跨页里每页落在书盒的哪半边：
 * 第 0 组是封面，单独在右半；其余的落单页（总页数为偶数时的末页）单独在左半。
 */
function spreadPosition(
  group: number[] | undefined,
  index: number
): { left?: number; right?: number } {
  if (!group || group.length === 0) return {};
  if (group.length === 1) return index === 0 ? { right: group[0] } : { left: group[0] };
  return { left: group[0], right: group[1] };
}

/**
 * 一页的纸面：白底 + 页面图 + 靠书脊一侧的中缝灰线。
 * 页面内容早就被 drawPageContent 画成了整页的图，这里不需要再画别的东西。
 */
function PageFace({ src, crease }: { src?: string; crease: 'left' | 'right' }) {
  // 这一侧没有页面（封面态的左半、结尾态的右半、翻页时空着的那半边）：
  // 什么都不画，露出桌面 —— 画一块白底会凭空多出半页白纸
  if (!src) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff', overflow: 'hidden' }}>
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 1,
          background: 'rgba(150,145,135,0.35)',
          ...(crease === 'left' ? { left: 0 } : { right: 0 }),
        }}
      />
    </div>
  );
}

/** 摊开在书盒里的静态页面（落单时另一边空着） */
function SpreadLayer({
  left,
  right,
  images,
}: {
  left?: number;
  right?: number;
  images: string[];
}) {
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%' }}>
        <PageFace src={left === undefined ? undefined : images[left]} crease="right" />
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 0, width: '50%', height: '100%' }}>
        <PageFace src={right === undefined ? undefined : images[right]} crease="left" />
      </div>
    </>
  );
}

/**
 * 正在翻动的那张纸：整页绕书脊（书盒中线）竖直旋转 180°，
 * 正面是翻动前朝上的那页，背面是翻过去之后朝上的那页。
 *
 * 这是「像第一页翻开那样直着翻」的实现：原来的 page-flip 是折角纸模型
 * （折角永远从页面上下 1/10 处起、折线必然斜），内页翻起来是个斜折角；
 * 换成 CSS 3D 后每次翻页都是一整张纸绕着书脊转，和封面翻开是一个动作。
 */
function FlipSheet({
  anim,
  front,
  back,
  images,
  sheetRef,
}: {
  anim: FlipAnim;
  front?: number;
  back?: number;
  images: string[];
  sheetRef: { current: HTMLDivElement | null };
}) {
  const isNext = anim.dir === 'next';
  const face: CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: '#fff',
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
  };
  return (
    <div
      ref={sheetRef}
      style={{
        position: 'absolute',
        top: 0,
        height: '100%',
        width: '50%',
        left: isNext ? '50%' : 0,
        // 向后翻：绕右页的左边缘（书脊）转；向前翻：绕左页的右边缘转
        transformOrigin: isNext ? 'left center' : 'right center',
        transformStyle: 'preserve-3d',
        willChange: 'transform',
        zIndex: 5,
      }}
    >
      <div style={face}>
        <PageFace
          src={front === undefined ? undefined : images[front]}
          crease={isNext ? 'left' : 'right'}
        />
      </div>
      <div style={{ ...face, transform: 'rotateY(180deg)' }}>
        <PageFace
          src={back === undefined ? undefined : images[back]}
          crease={isNext ? 'right' : 'left'}
        />
      </div>
    </div>
  );
}

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
  // 翻页动画里的那张纸（CSS 3D 旋转）
  const flipperRef = useRef<HTMLDivElement | null>(null);
  // 同步的翻页状态：state 是异步的，快速连点要用 ref 挡
  const flipRef = useRef<FlipAnim | null>(null);
  // 页面图现在是 object URL（比 dataURL 少一层 base64 编解码），用完要还回去
  const pageUrlsRef = useRef<string[]>([]);
  // 后台渲染的代号：重新渲染 / 离开页面后，旧任务看到代号变了就停
  const renderRunRef = useRef(0);
  // 用户正在翻页动画里：后台渲染先让路，别和动画抢主线程
  const isFlippingRef = useRef(false);
  // 翻页状态兜底：万一动画没正常结束，后台不能永远停着
  const flipIdleTimerRef = useRef<number | null>(null);
  // 每页一张常驻的 <img>（藏在书外）：后台画好的页直接换 src 并提前解码，
  // 翻页动画第一帧才不会撞上 800×1135 JPEG 的解码
  const pageImgRefs = useRef<(HTMLImageElement | null)[]>([]);
  // 每页当前最新的图（后台画好会更新）
  const pageImageUrlsRef = useRef<string[]>([]);
  // 后台画好的页先排队，统一换到 state
  const pendingPageImagesRef = useRef(new Map<number, string>());
  const [project, setProject] = useState<Project | null>(null);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookSize, setBookSize] = useState({ w: 0, h: 0 }); // 初始为0，等计算完成
  // 当前跨页（spreadGroups 的下标），0 = 封面
  const [currentSpread, setCurrentSpread] = useState(0);
  // 正在播的翻页动画；null = 静止
  const [flip, setFlip] = useState<FlipAnim | null>(null);
  const [entered, setEntered] = useState(false); // 入场动画完成
  const [exportMenuOpen, setExportMenuOpen] = useState(false); // 「📥 导出」的小菜单
  const [bgIndex, setBgIndex] = useState(0);
  const BACKDROPS = ['#6c7d9b', '#E8E4DE', '#3a3a3a', '#d4c5b9', '#E9EAEC'];
  const [exporting, setExporting] = useState(false); // 导出中（PDF / 图片都算）
  // 图片导出的进度（PDF 导出没这个，导出中显示"⏳ 导出中 N/M"）
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [magnified, setMagnified] = useState(false); // 放大镜开着
  const [focusMode, setFocusMode] = useState(false); // 专注模式：隐藏上下栏

  // ===== 跨页与页码（全部从 pageImages / currentSpread 推导，不另存一份） =====
  const totalPages = pageImages.length;
  const spreads = useMemo(() => spreadGroups(totalPages), [totalPages]);
  const currentSpreadPages = spreads[currentSpread] ?? [];
  const currentPage = currentSpreadPages[0] ?? 0;

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
      // 让还在跑的后台渲染停下来（它要接着往已经离开的页面里画）
      renderRunRef.current++;
      if (flipIdleTimerRef.current !== null) window.clearTimeout(flipIdleTimerRef.current);
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

  /** 标记「用户正在翻页」，后台批次据此让路 */
  const markFlipping = useCallback((busy: boolean) => {
    if (flipIdleTimerRef.current !== null) {
      window.clearTimeout(flipIdleTimerRef.current);
      flipIdleTimerRef.current = null;
    }
    isFlippingRef.current = busy;
    if (busy) {
      flipIdleTimerRef.current = window.setTimeout(() => {
        isFlippingRef.current = false;
        flipIdleTimerRef.current = null;
      }, 1200);
    }
  }, []);

  // 渲染所有页面为图片
  async function renderAllPages(p: Project) {
    setLoading(true);
    const runId = ++renderRunRef.current;
    pendingPageImagesRef.current.clear();
    setCurrentSpread(0);
    setFlip(null);
    flipRef.current = null;
    markFlipping(false);

    // 用户翻页时让后台的 Worker 池也停下（不派新任务）。缩图是满核的
    // JPEG 解码 + 缩放，翻页动画要在同一批 CPU 上出帧，抢着跑就掉帧——
    // 实测同样一次首次翻开：后台在跑时 40ms 的帧，后台做完后只有 17ms。
    const waitWhileFlipping = async () => {
      while (isFlippingRef.current) {
        if (runId !== renderRunRef.current) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    // 预览图只按「屏幕上真正会显示的大小」渲染，不再固定 150dpi。
    // 书页正常显示约 410~450px 宽，150dpi 却会画到 874×1240 —— 多出来的像素在
    // 翻页动画里每帧都要重新缩放光栅化，弱显卡上就是卡顿的直接来源，加载也慢。
    // 渲染尺寸和下面 calcSize 的放大镜分支用同一套算法（放大镜是屏幕上书页
    // 最大的时候，1080p 窗口约 660px 宽），再乘 PREVIEW_SUPERSAMPLE 留一点
    // 超采样余量：旋转照片的斜边、细笔画在缩放时才有平滑过渡，不显毛糙。
    // 高 DPI 屏按 devicePixelRatio 补回来，封顶仍是 150dpi。
    const ratio = p.format.width / p.format.height;
    const maxW = window.innerWidth - 128;
    const maxH = window.innerHeight - 144;
    let pageCssWidth = Math.min(maxW / 2, maxH / ratio);
    if (pageCssWidth / ratio > maxH) pageCssWidth = maxH * ratio;
    const PREVIEW_SUPERSAMPLE = 1.5;
    const targetPagePx = Math.min(
      Math.round(mmToPx(p.format.width, 150)),
      Math.max(
        320,
        Math.ceil(pageCssWidth * PREVIEW_SUPERSAMPLE * Math.min(window.devicePixelRatio || 1, 2))
      )
    );
    const dpi = (targetPagePx / p.format.width) * 25.4;

    // 首屏优先：先把封面和前两个跨页用到的图准备好，书立刻就能出现；
    // 其余的图在后台继续准备、画好一页补一页（见下面的后台任务）。
    // 需求尺寸仍按全部页面算（decodePreviewAssets 内部统一算），
    // 同一张照片在后面的页里用得更大时也不会缩错。
    const firstIds = collectImageIdsForPages(p.pages, FIRST_SCREEN_PAGES);
    const [firstAssets] = await Promise.all([
      decodePreviewAssets(p.pages, p.format, dpi, { onlyIds: firstIds, waitWhileBusy: waitWhileFlipping }),
      // 字体/静态背景要按全部页准备好，晚到就会被系统字体或空白顶替
      ensureFontsLoaded(p.pages),
      ensureStaticBackgroundsLoaded(p.pages),
    ]);
    if (runId !== renderRunRef.current) return;

    const total = p.pages.length;
    const firstCount = Math.min(FIRST_SCREEN_PAGES, total);
    // 还没画好的页先放占位，等后台画完逐页换掉
    const images: string[] = new Array(total).fill(PAGE_PLACEHOLDER);

    // 首屏这几页一起画、一起编码（编码在后端线程，彼此重叠）
    await Promise.all(
      p.pages.slice(0, firstCount).map(async (page, i) => {
        const url = await renderPageImage(page, p.format, dpi, firstAssets);
        if (url) images[i] = url;
      })
    );
    if (runId !== renderRunRef.current) return;

    pageImageUrlsRef.current = images.slice();
    setPageImages(images);

    // 后台：准备剩下的图 → 画剩下的页 → 每批画完直接换到书的 img 上。
    // 不重建书（重建会把正在看的页弹回封面），只换 <img> 的 src。
    //
    // 分组推进：一次只准备接下来二十来页要用的图，画完再准备下一组。
    // 要是一次把所有图都缩完再画（一百多张 12MP 要五六秒），用户翻到第 7 页
    // 时后面还全是占位；分组之后每两秒左右就有一批页补进来，翻页基本跟得上。
    void (async () => {
      try {
        const allAssets: Map<string, PreviewImage> = new Map(firstAssets);
        const prepared = new Set(firstIds);
        const PREPARE_PAGES = 10;
        // 一批 4 页的同步绘制会挤进同一帧（实测 90ms 长任务、105ms 的帧），
        // 用户正好翻页时就是肉眼可见的一顿。2 页一批把单次占用压到一半以下。
        const RENDER_BATCH = 2;

        for (let start = firstCount; start < total; start += PREPARE_PAGES) {
          if (runId !== renderRunRef.current) return;
          const end = Math.min(start + PREPARE_PAGES, total);
          const groupPages = p.pages.slice(start, end);
          const groupIds = collectImageIdsForPages(groupPages, groupPages.length);
          const groupAssets = await decodePreviewAssets(p.pages, p.format, dpi, {
            onlyIds: groupIds,
            skipIds: prepared,
            waitWhileBusy: waitWhileFlipping,
          });
          if (runId !== renderRunRef.current) return;
          for (const [id, img] of groupAssets) {
            allAssets.set(id, img);
            prepared.add(id);
          }

          // 这一组的页面按小批画，画好一批就换上
          for (let cursor = start; cursor < end; cursor += RENDER_BATCH) {
            if (runId !== renderRunRef.current) return;
            // 用户正在翻页：先等动画走完，别把绘制塞进动画的帧里
            while (isFlippingRef.current) {
              if (runId !== renderRunRef.current) return;
              await new Promise((r) => setTimeout(r, 100));
            }
            const batch = p.pages.slice(cursor, Math.min(cursor + RENDER_BATCH, end));
            await Promise.all(
              batch.map(async (page, offset) => {
                const url = await renderPageImage(page, p.format, dpi, allAssets);
                if (url) {
                  pendingPageImagesRef.current.set(cursor + offset, url);
                  // 同步记下最新图，重建书（放大 / resize）时用得上
                  pageImageUrlsRef.current[cursor + offset] = url;
                }
              })
            );
            if (runId !== renderRunRef.current) return;
            applyPendingPageImages();
          }
        }
      } catch (err) {
        console.error('后台渲染剩余页面失败:', err);
      }
    })();
  }

  /** 画一页并编码成 object URL（页面怎么画只有 drawPageContent 这一份实现） */
  async function renderPageImage(
    page: Page,
    format: BookFormat,
    dpi: number,
    assets: Map<string, PreviewImage>
  ): Promise<string | null> {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(mmToPx(format.width, dpi));
    canvas.height = Math.round(mmToPx(format.height, dpi));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    drawPageContent(ctx, page, format, dpi, assets);

    // 用 toBlob 而不是 toDataURL：编码交给后台线程，主线程不用停下来等。
    // toDataURL 是同步的，每页都要把主线程按住几十毫秒，页数一多就是实打实的一秒多；
    // 而且产出的 base64 比原图大三分之一，塞进 <img> 还得再解一遍 base64。
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    );
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    pageUrlsRef.current.push(url);
    return url;
  }

  /** 把后台画好的页换进 state（页面 img 和翻页动画都从 state 取图） */
  function applyPendingPageImages() {
    if (pendingPageImagesRef.current.size === 0) return;
    const updates = Array.from(pendingPageImagesRef.current);
    pendingPageImagesRef.current.clear();
    for (const [index, url] of updates) {
      const img = pageImgRefs.current[index];
      if (img) {
        img.src = url;
        // 提前解码：否则用户翻到这一页时才开始解 800×1135 的 JPEG，
        // 翻页动画会顿一下（和首次翻开同一个原因）
        void img.decode().catch(() => {});
      }
    }
    setPageImages((prev) => {
      const next = prev.slice();
      for (const [index, url] of updates) next[index] = url;
      return next;
    });
  }

  // 计算书页尺寸
  useEffect(() => {
    const calcSize = () => {
      // 放大镜里书要铺满整个窗口（上下各留 72px 给关闭键和提示条，左右各留 64px）；
      // 平时预览：窄于 1320 按窗口宽度等比缩小（1280 → 800 × 568）；
      // 1320 ~ 1440（她的笔记本窗口 1440 × 791）以书高 585px 为基准
      // （宽 = 585 × 296/210 ≈ 825，即 825 × 585）；
      // 1440 往上线性回到 900，1920 及以上的桌面就是 900 × 639（和最早一样）。
      // 高度不够时再按 maxH 夹紧 —— 屏幕上看到多大就等于印出来多大，
      // 书本身该多大还是多大，放大只是临时看一次
      const winW = window.innerWidth;
      const previewCap =
        winW <= 1440
          ? Math.min(825, (winW * 850) / 1360)
          : Math.min(900, 825 + ((winW - 1440) / 480) * 75);
      const maxW = magnified
        ? window.innerWidth - 128
        : Math.min(window.innerWidth - 200, previewCap);
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

  // 书第一次能显示出来：关掉 loading、播入场过渡。
  // 别把 loading 写进依赖里 —— setLoading(false) 会触发 effect 重跑，
  // 清理函数会把下面那个 setEntered 的定时器一起清掉，入场过渡永远不播（书一直 opacity 0）
  useEffect(() => {
    if (pageImages.length === 0 || bookSize.w === 0) return;
    setLoading(false);
    // 下一帧再置位，让入场过渡生效
    const t = window.setTimeout(() => setEntered(true), 30);
    return () => window.clearTimeout(t);
  }, [pageImages.length, bookSize.w]);

  // 页面图提前解码：翻页动画第一帧才不会撞上 800×1135 JPEG 的解码
  useEffect(() => {
    for (const img of pageImgRefs.current) {
      if (img?.complete) void img.decode().catch(() => {});
    }
  }, [pageImages]);

  /** 翻页动画结束：落到目标跨页 */
  const finishFlip = useCallback(() => {
    const anim = flipRef.current;
    if (!anim) return;
    flipRef.current = null;
    markFlipping(false);
    setCurrentSpread(anim.to);
    setFlip(null);
  }, [markFlipping]);

  // 翻页动画：整张纸绕书脊转 180°（CSS 3D）。
  // 用 Web Animations API 而不是 CSS transition —— 启动/收尾都在这里显式控制，
  // StrictMode 重跑 effect 时 cancel 掉重来即可，不会留下半截状态。
  useEffect(() => {
    if (!flip) return;
    const sheet = flipperRef.current;
    if (!sheet) return;
    const angle = flip.dir === 'next' ? -180 : 180;
    const animation = sheet.animate(
      [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${angle}deg)` }],
      { duration: FLIP_DURATION, easing: 'ease-in-out', fill: 'forwards' }
    );
    animation.onfinish = finishFlip;
    return () => animation.cancel();
  }, [flip, finishFlip]);

  // ===== 翻页入口 =====
  // 点击书页、键盘 ← →、两侧按钮、放大镜里的按钮，全都走这两个函数：
  // 同一段动画、同一套边界判断（已经在封面就翻不了前一页、在末页翻不了后一页）。
  // flipRef 是同步的：连点第二下时 state 还没更新，靠它挡住。
  const goPrev = useCallback(() => {
    if (flipRef.current) return;
    if (currentSpread <= 0) return;
    const anim: FlipAnim = { dir: 'prev', from: currentSpread, to: currentSpread - 1 };
    flipRef.current = anim;
    markFlipping(true);
    setFlip(anim);
  }, [currentSpread, markFlipping]);

  const goNext = useCallback(() => {
    if (flipRef.current) return;
    if (currentSpread >= spreads.length - 1) return;
    const anim: FlipAnim = { dir: 'next', from: currentSpread, to: currentSpread + 1 };
    flipRef.current = anim;
    markFlipping(true);
    setFlip(anim);
  }, [currentSpread, spreads.length, markFlipping]);

  /** 点书页翻页：左半边往回翻、右半边往后翻（封面态点封面就是往后翻） */
  const handleBookClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (e.clientX - rect.left < rect.width / 2) goPrev();
      else goNext();
    },
    [goPrev, goNext]
  );

  // 放大镜开着时：点在书页以外的地方退出放大。
  // 书以外的区域不归书管，点黑边就该退出去；书页上的点击是翻页，不在这里处理。
  // 按钮层用 data 标记排除掉。
  useEffect(() => {
    if (!magnified) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('[data-magnify-chrome]')) return;
      if (containerRef.current?.contains(t)) return; // 点在书上：那是翻页
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
        // ESC 逐层退：先关专注模式、再关导出菜单、再关放大镜，最后才返回编辑页
        if (focusMode) setFocusMode(false);
        else if (exportMenuOpen) setExportMenuOpen(false);
        else if (magnified) setMagnified(false);
        else navigate(`/editor/${projectId}`);
      } else if (e.key === 'f' || e.key === 'F') {
        setFocusMode((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId, navigate, goPrev, goNext, magnified, exportMenuOpen, focusMode]);

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
      // 字体也要在开画之前就绪，否则 300dpi 的 PDF 里会被拍成系统字体；
      // 静态背景图同理，导出是一次画完就结束，不等它就永远缺背景。
      const [assets] = await Promise.all([
        decodeAssets(collectAssetIds(pages)),
        ensureFontsLoaded(pages),
        ensureStaticBackgroundsLoaded(pages),
      ]);

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
  // 闭合态：封面单独在右半，平移 -W/4 让封面居中
  // 结尾态（n 为偶数）：背封单独在左半，平移 +W/4 居中
  const closed = currentSpread === 0 && currentSpreadPages.length === 1;
  const endClosed =
    currentSpread === spreads.length - 1 && currentSpread > 0 && currentSpreadPages.length === 1;
  const isOpening = flip !== null;
  const isClosedState = (closed || endClosed) && !isOpening;

  // ===== 摊开时那片整体投影 =====
  // 它的亮灭时机跟书脊/半页阴影是反的，不能用 isClosedState 那个开关：
  //   翻开第一页：点击那一下书还合着，投影不能先铺开 —— 等动画走完、书真正摊开了再亮
  //   合上最后一页：点下去那一下就撤掉，不能等动画走完
  // isClosedState 里有 !isOpening，而 isOpening 在点击瞬间就翻成 true 了，两头都会错。
  // 所以这里看的是"这趟翻完书还会不会摊着"：closed / endClosed 按已落定的页码算，
  // 翻开的过程中一直是 true（投影自然是灭的）、合上的过程中一直是 false，
  // 就差 flipToClosed —— 这趟的落点是合起态。
  const flipToClosed = flip !== null && (spreads[flip.to]?.length ?? 0) === 1;
  const showSpreadShadow = !closed && !endClosed && !flipToClosed;
  // 封面在右半页（中心在书盒中心右侧 W/4），要居中需向左移 W/4；结尾背封在左半，向右移 W/4
  const centerOffset = closed ? -bookSize.w / 4 : endClosed ? bookSize.w / 4 : 0;
  const offset = isClosedState ? centerOffset : 0;
  const bookTransform = `translateX(${offset}px) scale(${entered ? 1 : 0.94})`;

  // ===== 书盒里摆哪些页 =====
  // 静止时就是当前跨页；翻页动画中，底层换成「目标页的一侧 + 当前页的另一侧」：
  //   往后翻：[当前左页 | 目标右页]，翻动的纸正面是当前右页、背面是目标左页
  //   往回翻：[目标左页 | 当前右页]，翻动的纸正面是当前左页、背面是目标右页
  // 封面态（只有右半页）和结尾态（只有左半页）也套这套规则，空的一边留白。
  let baseLeft: number | undefined;
  let baseRight: number | undefined;
  let flipFront: number | undefined;
  let flipBack: number | undefined;
  if (!flip) {
    const pos = spreadPosition(spreads[currentSpread], currentSpread);
    baseLeft = pos.left;
    baseRight = pos.right;
  } else {
    const fromPos = spreadPosition(spreads[flip.from], flip.from);
    const toPos = spreadPosition(spreads[flip.to], flip.to);
    if (flip.dir === 'next') {
      baseLeft = fromPos.left;
      baseRight = toPos.right;
      flipFront = fromPos.right;
      flipBack = toPos.left;
    } else {
      baseLeft = toPos.left;
      baseRight = fromPos.right;
      flipFront = fromPos.left;
      flipBack = toPos.right;
    }
  }

  // 桌面投影的范围跟着当前页走
  const span = useMemo(
    () => computeSpan(currentPage, totalPages, bookSize.w),
    [currentPage, totalPages, bookSize.w]
  );
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
    <div className="w-full h-full flex flex-col select-none overflow-hidden transition-colors" style={{ background: BACKDROPS[bgIndex] }}>
      {/* 顶部栏 */}
      <header className={`relative h-14 bg-black/20 backdrop-blur flex items-center justify-between px-6 text-white z-10 flex-shrink-0 border-b border-white/10 transition-transform duration-300 ${focusMode ? '-translate-y-full' : ''}`}>
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
        <h1 className="text-sm font-medium text-white absolute left-1/2 -translate-x-1/2">{project?.name}</h1>
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
          <button
            onClick={() => setFocusMode((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-white hover:text-gray-200 transition-colors"
            title="专注模式（F键切换），隐藏上下栏"
          >
            {focusMode ? '📺 退出专注' : '⛶ 专注'}
          </button>
          {/* 背景色切换 */}
          <div className="flex items-center gap-1.5" title="切换背景色">
            {BACKDROPS.map((c, i) => (
              <button
                key={c}
                onClick={() => setBgIndex(i)}
                className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: i === bgIndex ? '#fff' : 'rgba(255,255,255,0.3)' }}
              />
            ))}
          </div>
          {/* 📥 导出：PDF 和图片（单面 / 双面）都收在这个下拉里；
              图片两项的开关在 utils/exportImages.ts（SHOW_IMAGE_EXPORT_ENTRY，现为开放） */}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={exporting || !project}
              title={SHOW_IMAGE_EXPORT_ENTRY ? '导出 PDF 或图片' : '导出 PDF（打印用）'}
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
                  {/* 图片导出两项（开关在 utils/exportImages.ts，现为开放；藏起来就改 false） */}
                  {SHOW_IMAGE_EXPORT_ENTRY && (
                    <>
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
                    </>
                  )}
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

        {/* 页面图预热：每页一张常驻的 <img>（不显示），提前加载 + 解码。
            翻页动画第一帧才不会撞上 800×1135 JPEG 的解码；后台画好的页
            也靠它先把新图换上去、解码好 */}
        <div aria-hidden style={{ display: 'none' }}>
          {pageImages.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              ref={(el) => {
                pageImgRefs.current[i] = el;
              }}
            />
          ))}
        </div>

        {/* 书本：桌面投影 + 书页 */}
        <div
          className="relative"
          style={{
            width: bookSize.w || 700,
            height: bookSize.h || 500,
            // 放大镜时把书抬到黑幕（z-30）之上：书是真的变大了，翻页动画和
            // 点击翻页都还在书自己身上，不能拿别的东西盖住它
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
          {/* 桌面投影（已隐藏） */}
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 2px)', height: 50,
              left: span.left - 24, right: bookSize.w - span.right - 24,
              background:
                'radial-gradient(ellipse 50% 55% at 50% 22%, rgba(80,65,40,0.38) 0%, rgba(80,65,40,0.16) 45%, rgba(80,65,40,0) 78%)',
              filter: 'blur(9px)',
              transition: 'left 300ms ease, right 300ms ease',
              display: 'none',
            }}
          />
          {/* 合起来时只有半页可见（封面在右半、封底在左半）。
              整盒投影会糊到空着的那半页上，所以单独给可见的半页铺一层，
              垫在书页下面，只露出封面轮廓之外的部分。
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
          {/* 书页：静态跨页 + 翻页中的那张纸（CSS 3D） */}
          <div
            ref={containerRef}
            data-book
            className="absolute inset-0 z-[1]"
            onClick={handleBookClick}
            style={{ perspective: '2400px' }}
          >
            <SpreadLayer left={baseLeft} right={baseRight} images={pageImages} />
            {flip && (
              <FlipSheet
                anim={flip}
                front={flipFront}
                back={flipBack}
                images={pageImages}
                sheetRef={flipperRef}
              />
            )}
          </div>
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
              // 不能挡书页的翻页点击
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
        </div>
      </div>

      {/* 底部提示 */}
      <div className={`h-10 bg-black/20 flex items-center justify-center flex-shrink-0 border-t border-white/10 transition-transform duration-300 ${focusMode ? 'translate-y-full' : ''}`}>
        <p className="text-xs text-gray-300">
          {isClosedState
            ? '点击封面翻开相册'
            : '点击书页翻页 · 键盘 ← → 翻页 · 🔍 放大看文字 · ESC 返回'}
        </p>
      </div>

      {/* 放大镜：书本身放大到铺满屏幕（书页尺寸真的变大，见 calcSize），
          翻页动画和点击翻页都跟着放大后的尺寸走。
          这层黑幕垫在书下面（书被抬到 z-40）；"点书页以外退出"由上面那个
          落点判断的监听负责，黑幕自己接不到点击 */}
      {magnified && <div className="fixed inset-0 z-30 bg-black/90" />}

      {/* 放大镜的按钮层：箭头 / 关闭 / 提示条。整层不吃鼠标（pointer-events-none），
          只有按钮自己接事件 —— 点在书页上要原样落到书自己身上，才能翻出动画。
          挂在最外层（没有 transform / backdrop-filter 的祖先），fixed inset-0 才相对窗口定位 */}
      {magnified && (
        <SpreadZoom
          onPrev={goPrev}
          onNext={goNext}
          // 能不能翻，跟 goPrev / goNext 里的边界判断保持一致
          canPrev={currentSpread > 0}
          canNext={currentSpread < spreads.length - 1}
          onClose={() => setMagnified(false)}
        />
      )}
    </div>
  );
}
