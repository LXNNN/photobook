import { useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch, store } from '@/store';
import { setCurrentProject, addElement, updateElement, deleteElement, addPagePair, deletePagePair, movePages, updateProjectName, swapImages, pushHistory, undo, clearHistory, setBodyStyle } from '@/store/projectSlice';
import { selectElement, multiSelectElement, clearSelection, setZoom, setPan, resetEditor, setCurrentPage as setCurrentPageAction, setActivePage } from '@/store/editorSlice';
import { setMode } from '@/store/uiSlice';
import { buildSpreadPages, anchorOf, spreadGroupAt, spreadAnchors, findElementPage, insertAfterSpread, appendPairIndex, movePairBefore, anchorAfterDelete } from '@/utils/spreadLayout';
import { spreadGroups } from '@/utils/spread';
import { getProject } from '@/utils/storage';
import { saveImageAsset, getImageAsset } from '@/utils/assetStore';
import { subscribeFolderStatus, getFolderStatus } from '@/utils/folderMode';
import { ensureFolderReady, reconnectFolder, flushFolderWrites, persistProject } from '@/utils/folderLibrary';
import { CanvasRenderer } from '@/engine/CanvasRenderer';
import { InteractionManager } from '@/engine/InteractionManager';
import { mmToPx, generateId } from '@/utils/units';
import { fileToImageAsset, getImageURL, blobToDataURL } from '@/utils/image';
import type { ImageElement, TextElement, Element } from '@/types';
import SpreadThumbnail from '@/components/editor/SpreadThumbnail';
import PropertyPanel from '@/components/editor/PropertyPanel';
import TemplatePanel from '@/components/editor/TemplatePanel';
import ImageCropper from '@/components/editor/ImageCropper';
import BodyStyleDialog from '@/components/editor/BodyStyleDialog';
import {
  DEFAULT_BODY_COLOR,
  DEFAULT_BODY_FONT_SIZE,
  DEFAULT_TITLE_COLOR,
  DEFAULT_TITLE_FONT_SIZE,
  SHOW_BODY_STYLE_ENTRY,
} from '@/utils/bodyText';
import { cleanupUnusedPhotos } from '@/utils/photoCleanup';

// 启动守卫在 StrictMode 下会跑两遍，提示只弹一次
let folderGuardAlerted = false;

export default function Editor() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const project = useAppSelector((s) => s.project.current);
  const currentPageIndex = useAppSelector((s) => s.editor.currentPageIndex);
  const activePageIndex = useAppSelector((s) => s.editor.activePageIndex);
  const selectedIds = useAppSelector((s) => s.editor.selectedElementIds);
  const zoom = useAppSelector((s) => s.editor.zoom);
  const pan = useAppSelector((s) => s.editor.pan);
  const showGuides = useAppSelector((s) => s.editor.showGuides);
  const showBleed = useAppSelector((s) => s.editor.showBleed);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const interactionRef = useRef<InteractionManager | null>(null);
  const projectInitializedRef = useRef(false); // 记录项目是否已初始化过
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [bodyStyleOpen, setBodyStyleOpen] = useState(false); // 「🎨 正文样式」弹窗
  const [addTextOpen, setAddTextOpen] = useState(false); // 「📝 添加文字」的小菜单
  const [leftTab, setLeftTab] = useState<'pages' | 'templates'>('pages');
  // 拖拽排序：存的都是跨页锚页（一组两页一起移动）
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [dragOverAnchor, setDragOverAnchor] = useState<number | null>(null);
  // 正在编辑的文字元素（带页码：双页下文本框要落在它所在的那一页上）
  const [editingText, setEditingText] = useState<{
    elementId: string;
    pageIndex: number;
    content: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    textAlign: string;
  } | null>(null);
  const editingTextRef = useRef<HTMLTextAreaElement>(null);
  // 切页/切跨页前兜底保存用（textarea 失焦通常已经先保存过，这里防漏）
  const editingTextStateRef = useRef<typeof editingText>(null);
  useEffect(() => {
    editingTextStateRef.current = editingText;
  }, [editingText]);
  // 正在裁剪的图片。id 和 URL 绑成一份状态存：分成两个 state 的话，切换到下一个
  // 元素时会出现「新元素的 id + 上一个元素的 URL」的中间态，对话框会先闪一下上一张照片
  const [cropping, setCropping] = useState<{ id: string; pageIndex: number; url: string } | null>(null);
  const folderStatus = useSyncExternalStore(subscribeFolderStatus, getFolderStatus);
  /** 有改动还没落盘（防抖没到点）：页面隐藏时补一次保存 */
  const dirtyRef = useRef(false);

  // 启动时已启用文件夹模式但还没连上：不进入编辑（§5.3）——
  // 照片都在磁盘里，没连上进来也画不出来，先回书架页把连接搞定。
  // 只在进入时检查一次：编辑中途断连是允许继续的（§6.6）
  useEffect(() => {
    if (ensureFolderReady()) return;
    if (!folderGuardAlerted) {
      folderGuardAlerted = true;
      alert('文件夹还没连上。照片暂时读不出来，先回书架页点「重新连接」，连上再进来吧');
    }
    navigate('/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每次进编辑页都从「第 1 页 + 原始缩放」开始，不沿用上次离开时的状态：
  // 不清的话，上次停在哪一页，再进来就还在哪一页，看起来像页面被"缓存"了。
  // 依赖 projectId：换一本相册（或从书架重新点进来）也重置
  useEffect(() => {
    dispatch(resetEditor());
  }, [dispatch, projectId]);

  // 当前跨页：currentPageIndex 存的是锚页（组的第一页），画布上显示 1~2 页。
  // 落单页（封面/结尾）居中，配对页一左一右 —— 偏移规则全在 spreadLayout 里。
  const spreadPages = useMemo(
    () => (project ? buildSpreadPages(project.pages, currentPageIndex, project.format.width) : []),
    [project, currentPageIndex]
  );
  const spreadGroup = project ? spreadGroupAt(currentPageIndex, project.pages.length) : [];
  // 活动页越界兜底（撤销后页数变少时会出现）：任何需要页码的地方都用这个
  const safeActivePageIndex = project
    ? Math.max(0, Math.min(project.pages.length - 1, activePageIndex))
    : 0;

  // 页码兜底：undo 之后 pages 可能变短、currentPageIndex / activePageIndex 可能越界。
  // 锚页修正会清空选中（setCurrentPage 的既有行为）；活动页跑出当前跨页时回到锚页。
  useEffect(() => {
    if (!project) return;
    const total = project.pages.length;
    const anchor = anchorOf(currentPageIndex, total);
    if (anchor !== currentPageIndex) {
      dispatch(setCurrentPageAction(anchor));
      return;
    }
    const group = spreadGroupAt(currentPageIndex, total);
    if (!group.includes(activePageIndex)) {
      dispatch(setActivePage(anchor));
    }
  }, [project, currentPageIndex, activePageIndex, dispatch]);

  /** 切页/切跨页前把还没提交的文字编辑保存掉（textarea 失焦通常已先保存） */
  const flushEditingText = useCallback(() => {
    const current = editingTextStateRef.current;
    if (!current) return;
    editingTextStateRef.current = null;
    dispatch(pushHistory());
    dispatch(updateElement({
      pageIndex: current.pageIndex,
      elementId: current.elementId,
      updates: { content: current.content },
    }));
    setEditingText(null);
  }, [dispatch]);

  // 加载裁剪图片的 URL（按裁剪弹窗记录的页码找元素，双页下不能再用 currentPageIndex）
  useEffect(() => {
    const id = cropping?.id;
    const el = id && project
      ? project.pages[cropping.pageIndex]?.elements.find((e) => e.id === id)
      : undefined;
    const imageId = el && el.type === 'image' ? (el as any).imageId : undefined;
    if (!id || !imageId) {
      // 没有照片可裁（模板留下的空图片区域就是这种）：关掉。
      // 不关的话会拿上一张的 URL 顶替 —— blob URL 还活着，照片照样显示得出来，
      // 看起来就像"空图片区域弹出了上一页的照片"。
      if (id) setCropping(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const asset = await getImageAsset(imageId);
      if (cancelled) return;
      // 照片取不到也关掉：取不到就没法裁
      setCropping(asset ? { id, pageIndex: cropping.pageIndex, url: getImageURL(asset) } : null);
    })();
    return () => { cancelled = true; };
  }, [cropping?.id, cropping?.pageIndex, project]);

  // 加载项目
  useEffect(() => {
    if (!projectId) return;
    // 只有从别的页面跳进来，或者刷新页面时，才从 IndexedDB 加载项目
    // 进入后后续 project 内容变化，不重新加载，也不重置当前页码
    if (project && project.id === projectId) {
      return;
    }
    (async () => {
      const p = await getProject(projectId);
      if (p) {
        dispatch(setCurrentProject(p));
        projectInitializedRef.current = true;
        // 页码不用在这里重置：进入编辑页时已经统一 resetEditor 了（见上面那个 effect）
      } else {
        navigate('/');
      }
    })();
  }, [projectId, dispatch, navigate]);

  /**
   * 缩放到「整个跨页刚好放进画布区域」并居中。
   * transformOrigin 是 top left，画布本身又被 flex 居中，所以缩放后要用 pan
   * 补回居中差 = 原始尺寸 × (1 - zoom) / 2。
   */
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    const padding = 48;
    const nextZoom = Math.max(
      0.1,
      Math.min(1, (cw - padding) / canvas.width, (ch - padding) / canvas.height)
    );
    dispatch(setZoom(nextZoom));
    dispatch(setPan({
      x: (canvas.width * (1 - nextZoom)) / 2,
      y: (canvas.height * (1 - nextZoom)) / 2,
    }));
  }, [dispatch]);

  // 初始化渲染器和交互管理器（canvas 挂载时执行一次）
  useEffect(() => {
    if (!canvasRef.current || !project) return;

    const renderer = new CanvasRenderer(canvasRef.current, project.format, 96);
    rendererRef.current = renderer;

    const interaction = new InteractionManager(canvasRef.current, project.format, 96);
    interactionRef.current = interaction;

    // 所有元素回调都带页码：双页画布上元素可能在任何一页，按元素真实的页去改
    interaction.onSelect = (id, multi, pageIndex) => {
      if (multi) {
        dispatch(multiSelectElement(id));
      } else {
        dispatch(selectElement(id));
      }
      // 点哪页哪页就是活动页 —— 点元素不清选中，跨页 Ctrl 多选才不会被切断
      dispatch(setActivePage(pageIndex));
    };
    interaction.onClearSelection = (pageIndex) => {
      dispatch(clearSelection());
      if (pageIndex !== null) dispatch(setActivePage(pageIndex));
    };
    interaction.onElementChange = (id, updates, pageIndex) => {
      dispatch(updateElement({ pageIndex, elementId: id, updates }));
    };
    interaction.onSwapImages = (sourceId, targetId, pageIndex) => {
      dispatch(swapImages({ pageIndex, sourceId, targetId }));
    };
    interaction.onHoverTargetChange = (targetId) => {
      setHoverTargetId(targetId);
    };
    interaction.onTextEdit = (elementId, content, x, y, width, height, fontSize, textAlign, pageIndex) => {
      setEditingText({ elementId, pageIndex, content, x, y, width, height, fontSize, textAlign });
    };
    interaction.onImageCrop = (elementId, pageIndex) => {
      // 先选中这个图片元素，再打开裁剪
      dispatch(selectElement(elementId));
      dispatch(setActivePage(pageIndex));
      // URL 先留空，等上面那个 effect 取到照片再开对话框。
      // 直接沿用上一次的 URL 的话，会先闪一下上一张照片
      setCropping({ id: elementId, pageIndex, url: '' });
    };
    interaction.onAlignGuides = (guides) => {
      rendererRef.current?.setAlignGuides(guides);
    };
    interaction.onBoundaryDistance = (dist) => {
      rendererRef.current?.setBoundaryDistance(dist);
    };
    interaction.onDragStart = () => {
      dispatch(pushHistory());
    };
    interaction.onPanChange = (p) => {
      dispatch(setPan(p));
    };
    interaction.onZoomChange = (newZoom, center) => {
      // 以鼠标位置为中心缩放：调整 pan 让鼠标指向的画布位置不变
      if (center && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const oldZoom = rect.width / canvasRef.current.width;
        const ratio = newZoom / oldZoom;
        const currentPan = store.getState().editor.pan;
        const deltaX = (center.x - rect.left) * (1 - ratio);
        const deltaY = (center.y - rect.top) * (1 - ratio);
        dispatch(setPan({ x: currentPan.x + deltaX, y: currentPan.y + deltaY }));
      }
      dispatch(setZoom(newZoom));
    };

    // 进入编辑页默认「适应窗口」：双页比原来的单页宽一倍，1:1 多半放不下
    const raf = requestAnimationFrame(() => fitToView());

    return () => {
      cancelAnimationFrame(raf);
      renderer.destroy();
      interaction.destroy();
    };
    // 只在 project 首次加载完成后初始化一次
    // 后续 project 内容变化不重建渲染器和交互管理器，避免拖拽中断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!project]);

  // 渲染当前跨页（1~2 页）
  useEffect(() => {
    if (!rendererRef.current || !project) return;

    // 加载跨页里所有页面用到的图片资源
    (async () => {
      for (const spreadPage of spreadPages) {
        for (const el of spreadPage.page.elements) {
          if (el.type === 'image' || el.type === 'sticker') {
            const id = el.type === 'image' ? el.imageId : el.stickerId;
            // 模板留下的空图片区域没有 imageId，必须跳过：不跳的话
            // getImageAsset(undefined) 会抛 DataError 把整个循环中断，
            // 排在这个空位后面的照片就再也加载不到了（画布上一直是灰色占位）
            if (!id) continue;
            if (!rendererRef.current!.getCachedImage(id)) {
              const asset = await getImageAsset(id);
              if (asset) {
                const url = getImageURL(asset);
                const img = new Image();
                img.onload = () => {
                  rendererRef.current!.cacheImage(id, img);
                };
                img.src = url;
              }
            }
          }
        }
      }
    })();

    rendererRef.current.render(
      spreadPages,
      selectedIds,
      showGuides,
      showBleed,
      hoverTargetId,
      safeActivePageIndex
    );
  }, [project, spreadPages, selectedIds, showGuides, showBleed, hoverTargetId, safeActivePageIndex]);

  // 更新交互管理器状态
  useEffect(() => {
    if (!interactionRef.current) return;
    interactionRef.current.setPages(spreadPages);
    interactionRef.current.setSelectedIds(selectedIds);
    interactionRef.current.setZoom(zoom);
    interactionRef.current.setPan(pan);
  }, [spreadPages, selectedIds, zoom, pan]);

  // 画布 CSS 变换（缩放+平移）
  const canvasStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: 'top left',
  };

  // 保存
  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    await persistProject(project);
    setSaving(false);
    setTimeout(() => setSaving(false), 1500);
  }, [project]);

  // 自动保存（防抖）：3 秒没再动就写一次。
  // 已启用文件夹模式时顺着一起写这本相册的 相册数据.json（§6.6，同一个节奏）；
  // 未启用时就是 IndexedDB（现状）——persistProject 内部已分好路
  useEffect(() => {
    if (!project) return;
    dirtyRef.current = true;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      void persistProject(project);
    }, 3000);
    return () => clearTimeout(timer);
  }, [project]);

  // 页面隐藏时补一次：防抖还没到点的改动 + 还没落盘的模板 json（§6.6 / §7.5）
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      const current = store.getState().project.current;
      if (current && dirtyRef.current) {
        dirtyRef.current = false;
        void persistProject(current);
      }
      void flushFolderWrites();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // 上传图片
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !project) return;

    for (const file of Array.from(files)) {
      try {
        const asset = await fileToImageAsset(file);
        await saveImageAsset(project.id, asset);

        // 如果当前跨页选中了一个图片元素，直接替换它的图片（可能在另一页上）
        let selectedImageElement: { element: ImageElement; pageIndex: number } | undefined;
        for (const spreadPage of spreadPages) {
          const el = spreadPage.page.elements.find(
            (e) => e.type === 'image' && selectedIds.includes(e.id)
          ) as ImageElement | undefined;
          if (el) {
            selectedImageElement = { element: el, pageIndex: spreadPage.index };
            break;
          }
        }
        // 没有替换目标时，新增的照片落在活动页（点哪页就是哪页）
        const page = project.pages[safeActivePageIndex];

        if (selectedImageElement) {
          // 替换选中元素的图片
          dispatch(updateElement({
            pageIndex: selectedImageElement.pageIndex,
            elementId: selectedImageElement.element.id,
            updates: { imageId: asset.id, crop: { x: 0, y: 0, width: 1, height: 1 } },
          }));
        } else {
          // 没有选中图片，新增一个元素放在中间
          const maxW = project.format.width * 0.6;
          const maxH = project.format.height * 0.6;
          const ratio = asset.width / asset.height;
          let w = maxW;
          let h = w / ratio;
          if (h > maxH) {
            h = maxH;
            w = h * ratio;
          }

          const newElement: ImageElement = {
            id: generateId(),
            type: 'image',
            x: (project.format.width - w) / 2,
            y: (project.format.height - h) / 2,
            width: w,
            height: h,
            rotation: 0,
            opacity: 1,
            zIndex: page.elements.length,
            imageId: asset.id,
            crop: { x: 0, y: 0, width: 1, height: 1 },
          };

          dispatch(addElement({ pageIndex: safeActivePageIndex, element: newElement }));
          dispatch(selectElement(newElement.id));
        }

        // 缓存图片
        const url = getImageURL(asset);
        const img = new Image();
        img.onload = () => rendererRef.current?.cacheImage(asset.id, img);
        img.src = url;
      } catch (err) {
        console.error('上传图片失败:', err);
        alert(`图片处理失败: ${file.name}\n${err instanceof Error ? err.message : String(err)}`);
      }
    }

    e.target.value = '';
  };

  // 添加文字：标题和正文分开加。加的时候就把身份标上（title / body），
  // 之后「🎨 正文样式」和「全局改标题样式」才知道该不该管这段字。
  const handleAddText = (kind: 'title' | 'body') => {
    if (!project) return;
    const page = project.pages[safeActivePageIndex];
    const isTitle = kind === 'title';
    const newElement: TextElement = {
      id: generateId(),
      type: 'text',
      x: project.format.width * 0.2,
      y: project.format.height * 0.4,
      width: project.format.width * 0.6,
      height: 20,
      rotation: 0,
      opacity: 1,
      zIndex: page.elements.length,
      content: isTitle ? '双击编辑标题' : '双击编辑文字',
      fontSize: isTitle ? DEFAULT_TITLE_FONT_SIZE : project.bodyFontSize || DEFAULT_BODY_FONT_SIZE,
      fontFamily: 'sans-serif',
      // 标题默认加粗；正文不设（跟着默认的常规走）
      fontWeight: isTitle ? 'bold' : undefined,
      // 正文跟着相册的正文样式走（「🎨 正文样式」里改过就用改过的）；
      // 标题目前用固定的一套（25pt / 深灰），跟模板里的标题一致
      color: isTitle ? DEFAULT_TITLE_COLOR : project.bodyColor || DEFAULT_BODY_COLOR,
      textAlign: 'left',
      lineHeight: 1.5,
      letterSpacing: 0,
      // 两个标记都写死：这样之后在右侧面板里把字号调大调小，它的身份也不会跟着变
      title: isTitle,
      body: !isTitle,
    };
    // 压历史：跟其它改动操作一个规矩（删元素、加页、套模板都压），
    // 不然加了字按 Ctrl+Z 撤的是上一步别的操作，这行字还赖着不走
    dispatch(pushHistory());
    dispatch(addElement({ pageIndex: safeActivePageIndex, element: newElement }));
    dispatch(selectElement(newElement.id));
  };

  // 一键换全书正文的颜色/字号：先压历史（Ctrl+Z 能退回来），再改。
  // 判定和落地都在 setBodyStyle 里，这边只管把选好的值递进去。
  const handleApplyBodyStyle = (color: string, fontSize: number) => {
    dispatch(pushHistory());
    dispatch(setBodyStyle({ color, fontSize }));
    setBodyStyleOpen(false);
  };

  // 删除选中元素（跨页多选时逐个按元素所在的页删）
  const handleDeleteSelected = () => {
    if (selectedIds.length === 0 || !project) return;
    dispatch(pushHistory());
    for (const id of selectedIds) {
      const pageIndex = findElementPage(project.pages, id);
      if (pageIndex >= 0) dispatch(deleteElement({ pageIndex, elementId: id }));
    }
    dispatch(clearSelection());
  };

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 正文样式弹窗开着时，快捷键一律让路 —— 不然按一下 Backspace 就把弹窗
      // 背后选中的那个元素删了
      if (bodyStyleOpen) {
        if (e.key === 'Escape') setBodyStyleOpen(false);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.ctrlKey && e.key === '=') {
        e.preventDefault();
        dispatch(setZoom(zoom * 1.2));
      }
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        dispatch(setZoom(zoom / 1.2));
      }
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        fitToView();
      }
      // Ctrl+Z 撤销
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        dispatch(undo());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, zoom, dispatch, handleSave, bodyStyleOpen, fitToView]);

  // 切换到浏览模式
  const handleViewMode = async () => {
    if (!project) return;
    // 先把当前编辑保存进 IndexedDB / 文件夹，再跳转预览（保证预览读到最新排版）
    await persistProject(project);
    navigate(`/viewer/${project.id}`);
    // 跳转之后在后台清理换模板/换照片留下的、页面已经不再引用的照片。
    // 不 await —— 删文件可能要一会儿，不能拖着预览打不开。
    void cleanupUnusedPhotos(project)
      .then((cleaned) => {
        if (cleaned.removedFiles === 0 && cleaned.removedRecords === 0) return;
        // 确实删了东西才清空撤销历史 —— 被删的照片回不来了，旧快照留着只会撤销出空白图。
        // 清理完成时用户可能已经切到别的相册，别清错历史
        if (store.getState().project.current?.id !== project.id) return;
        dispatch(clearHistory());
      })
      .catch(() => {
        // 清理失败不影响预览（照片还在，撤销历史也保留）
      });
  };

  if (!project) {
    return <div className="w-full h-full flex items-center justify-center text-gray-400">加载中...</div>;
  }

  // 顶栏跨页导航
  const spreadPageLabel = spreadGroup.length > 1
    ? `第 ${spreadGroup[0] + 1}–${spreadGroup[1] + 1} 页`
    : `第 ${(spreadGroup[0] ?? 0) + 1} 页`;
  const allAnchors = spreadAnchors(project.pages.length);
  const anchorPos = allAnchors.indexOf(anchorOf(currentPageIndex, project.pages.length));
  const goSpread = (delta: number) => {
    const next = allAnchors[anchorPos + delta];
    if (next === undefined) return;
    flushEditingText();
    dispatch(setCurrentPageAction(next));
  };

  // ── 左侧缩略图：成对增删 + 成对拖拽 ─────────────────────────────
  // 插点一律用 spreadLayout 的 helper 算，别手算下标：算错就把跨页劈开了。

  const handleSelectSpread = (anchor: number) => {
    flushEditingText();
    dispatch(setCurrentPageAction(anchor));
  };

  /** 在 atIndex 处插一对空白页并选中它（插入后新组的第一页就是 atIndex） */
  const handleAddPairAt = (atIndex: number) => {
    flushEditingText();
    dispatch(pushHistory());
    dispatch(addPagePair({ atIndex }));
    dispatch(setCurrentPageAction(atIndex));
  };

  const handleDeletePair = (anchor: number) => {
    const group = spreadGroupAt(anchor, project.pages.length);
    if (group.length !== 2) return;
    if (!confirm('这两页会一起删除，确定吗？')) return;

    // 正在编辑/裁剪的内容如果就在被删的两页上，直接关掉 —— 别先保存进即将删掉的页面
    const edited = editingTextStateRef.current;
    if (edited && group.includes(edited.pageIndex)) {
      editingTextStateRef.current = null;
      setEditingText(null);
    } else {
      flushEditingText();
    }
    if (cropping && group.includes(cropping.pageIndex)) {
      setCropping(null);
    }

    const totalAfter = project.pages.length - 2;
    const currentAnchor = anchorOf(currentPageIndex, project.pages.length);
    // 删的是当前跨页 → 落回后一组；删在它前面 → 整体前移两页；删在它后面 → 不动
    const nextAnchor = anchor === currentAnchor
      ? anchorAfterDelete(anchor, totalAfter)
      : anchor < currentAnchor
        ? currentAnchor - 2
        : currentAnchor;

    dispatch(pushHistory());
    dispatch(deletePagePair(anchor));
    dispatch(setCurrentPageAction(nextAnchor));
  };

  /** 拖拽成对排序：把拖起的那一对放到目标组前面 */
  const handleDropPair = (targetAnchor: number) => {
    if (dragAnchor === null) {
      setDragOverAnchor(null);
      return;
    }
    const { from, to } = movePairBefore(dragAnchor, targetAnchor, project.pages.length);
    if (from !== to) {
      flushEditingText();
      dispatch(pushHistory());
      dispatch(movePages({ from, to, count: 2 }));
      // 挪完这一对就在 [to, to+1]，选中它
      dispatch(setCurrentPageAction(to));
    }
    setDragAnchor(null);
    setDragOverAnchor(null);
  };

  // 文件夹异常提示条（§9.4）：中途断连时编辑继续，改动始终先落浏览器，重连后自动补写
  const folderNotice =
    folderStatus.state === 'needs-reconnect'
      ? '文件夹连接断开了。改动已先存在浏览器里，重新连接后会自动写入文件夹'
      : folderStatus.state === 'folder-missing'
        ? '找不到相册文件夹了。改动已先存在浏览器里，请到书架页重新指认文件夹'
        : folderStatus.pendingWrites
          ? '有改动还没写进文件夹，稍后会自动重试'
          : '';

  const handleReconnectInEditor = async () => {
    const r = await reconnectFolder();
    if (r.ok) return; // 状态一变，提示条自己消失
    if (r.reason === 'denied') {
      alert('没有连接成功。照片都还在，可以再试一次，或在浏览器设置里允许本站的文件夹访问');
    } else if (r.reason === 'folder-missing') {
      alert('文件夹被移动或改名了。请回到书架页，点「重新指认文件夹」重新选一下，数据不会丢');
      navigate('/');
    } else {
      alert('重新连接失败，请再试一次');
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#e8e4de]">
      {/* 顶部工具栏 */}
      {/* z-30：要盖住下面的文件夹提示条（那条也是 z-10，且在 DOM 里排在后面），
          不然「📝 添加文字」的下拉菜单会被提示条压住一截 */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shadow-sm z-30">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700 text-sm">
            ← 返回
          </button>
          <input
            value={project.name}
            onChange={(e) => dispatch(updateProjectName(e.target.value))}
            onBlur={() => {
              const state = store.getState();
              if (state.project.current) {
                void persistProject(state.project.current);
              }
            }}
            className="text-base font-medium bg-transparent border-b border-transparent hover:border-gray-300 focus:border-amber-600 outline-none px-1 py-0.5 w-48"
          />
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <button
              onClick={() => goSpread(-1)}
              disabled={anchorPos <= 0}
              title="上一个跨页"
              className="w-6 h-6 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ‹
            </button>
            <span>{spreadPageLabel} · 共 {project.pages.length} 页 · A5</span>
            <button
              onClick={() => goSpread(1)}
              disabled={anchorPos < 0 || anchorPos >= allAnchors.length - 1}
              title="下一个跨页"
              className="w-6 h-6 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ›
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
            📷 上传图片
          </button>
          {/* 📝 添加文字：下拉里选标题还是正文。加出来就带身份标记 */}
          <div className="relative">
            <button
              onClick={() => setAddTextOpen((v) => !v)}
              title="添加标题或正文"
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              📝 添加文字 ▾
            </button>
            {addTextOpen && (
              <>
                {/* 点别处就把菜单收起来（满屏的透明层接住点击，不改别处的行为） */}
                <div className="fixed inset-0 z-10" onClick={() => setAddTextOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-32 py-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                  <button
                    onClick={() => {
                      handleAddText('title');
                      setAddTextOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 transition-colors"
                  >
                    添加标题
                  </button>
                  <button
                    onClick={() => {
                      handleAddText('body');
                      setAddTextOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 transition-colors"
                  >
                    添加正文
                  </button>
                </div>
              </>
            )}
          </div>
          {/* 「🎨 正文样式」入口：这个版本先不上，开关在 utils/bodyText.ts 里 */}
          {SHOW_BODY_STYLE_ENTRY && (
            <button
              onClick={() => setBodyStyleOpen(true)}
              title="一键换全书正文的颜色和字号"
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              🎨 正文样式
            </button>
          )}
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <button onClick={() => dispatch(setZoom(zoom / 1.2))} className="w-8 h-8 text-gray-600 hover:bg-gray-100 rounded">-</button>
          <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => dispatch(setZoom(zoom * 1.2))} className="w-8 h-8 text-gray-600 hover:bg-gray-100 rounded">+</button>
          <button onClick={fitToView} className="px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded">适应</button>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <button onClick={handleSave} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
            {saving ? '保存中...' : '💾 保存'}
          </button>
          <button onClick={handleViewMode} className="px-4 py-1.5 text-sm bg-amber-700 text-white hover:bg-amber-800 rounded-md transition-colors">
            👁 预览
          </button>
        </div>
      </header>

      {/* 文件夹异常提示条（§9.4） */}
      {folderNotice && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-3 text-xs text-amber-800 z-10">
          <span>⚠️</span>
          <span className="flex-1">{folderNotice}</span>
          {folderStatus.state === 'needs-reconnect' && (
            <button
              onClick={handleReconnectInEditor}
              className="px-2.5 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
            >
              重新连接
            </button>
          )}
          {folderStatus.state === 'folder-missing' && (
            <button
              onClick={() => navigate('/')}
              className="px-2.5 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
            >
              去书架处理
            </button>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧面板 */}
        <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
          <div className="flex border-b border-gray-100">
            {(['pages', 'templates'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                className={`relative flex-1 py-2.5 text-xs font-medium transition-colors group ${
                  leftTab === tab ? 'text-amber-700 border-b-2 border-amber-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'pages' ? '页面' : '模板'}
                {/* 模板页签悬停提示气泡 */}
                {tab === 'templates' && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-52 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 pointer-events-none shadow-xl leading-relaxed text-left">
                    切换模板时，当前页已编辑好的文案会被覆盖，模板放不下的照片也会被删除，请先保存文案，再切换模板
                    {/* 气泡小箭头 */}
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-800 rotate-45"></div>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* 每个页签自己是独立的滚动容器，切换时保留各自的滚动位置 */}
          <div className={leftTab === 'pages' ? 'flex-1 overflow-auto p-3' : 'hidden'}>
            <div className="space-y-2">
              {spreadGroups(project.pages.length).map((group) => {
                const anchor = group[0];
                const paired = group.length === 2;
                // 结尾落单页（总页数为偶数时）：新的一对只能插在它上方，
                // 「下方新建」会插到它前面去，按钮文案会对不上，索性不给
                const isEndingLone = !paired && anchor > 0;
                return (
                  <SpreadThumbnail
                    key={project.pages[anchor].id}
                    pages={group.map((i) => project.pages[i])}
                    startIndex={anchor}
                    format={project.format}
                    active={group.includes(currentPageIndex)}
                    onClick={() => handleSelectSpread(anchor)}
                    onDelete={paired ? () => handleDeletePair(anchor) : undefined}
                    // 封面永远是第一页，「上方新建」无处可插
                    onAddPairBefore={anchor > 0 ? () => handleAddPairAt(anchor) : undefined}
                    onAddPairAfter={isEndingLone ? undefined : () => handleAddPairAt(insertAfterSpread(anchor, project.pages.length))}
                    draggable={paired}
                    isDragOver={dragOverAnchor === anchor && dragAnchor !== anchor}
                    onDragStart={(e) => {
                      setDragAnchor(anchor);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverAnchor(anchor);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDropPair(anchor);
                    }}
                  />
                );
              })}
              <button
                onClick={() => handleAddPairAt(appendPairIndex(project.pages.length))}
                className="w-full py-3 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 hover:border-amber-400 hover:text-amber-600 transition-colors text-sm"
              >
                + 添加页面
              </button>
            </div>
          </div>
          <div className={leftTab === 'templates' ? 'flex-1 overflow-hidden' : 'hidden'}>
            <TemplatePanel format={project.format} onApplied={() => setLeftTab('pages')} />
          </div>
        </aside>

        {/* 中间画布区域 */}
        <main ref={containerRef} className="flex-1 overflow-hidden relative flex items-center justify-center">
          {/* 投影由渲染器按页画，桌面底色从 canvas 透明处透出来 */}
          <div style={canvasStyle} className="relative">
            <canvas ref={canvasRef} className="block" />
            {/* 文字编辑输入框 */}
            {editingText && (
              <textarea
                ref={editingTextRef}
                value={editingText.content}
                onChange={(e) => setEditingText({ ...editingText, content: e.target.value })}
                onBlur={() => {
                  // 失焦时保存（写到文字所在的那一页）
                  dispatch(pushHistory());
                  dispatch(updateElement({
                    pageIndex: editingText.pageIndex,
                    elementId: editingText.elementId,
                    updates: { content: editingText.content }
                  }));
                  setEditingText(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditingText(null);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    editingTextRef.current?.blur();
                  }
                }}
                autoFocus
                style={{
                  position: 'absolute',
                  // 文字在左页/右页/落单居中页，位置要加上那一页的画布偏移
                  left: mmToPx(
                    (spreadPages.find((sp) => sp.index === editingText.pageIndex)?.offsetX ?? 0) +
                      editingText.x,
                    96
                  ),
                  top: mmToPx(editingText.y, 96),
                  width: mmToPx(editingText.width, 96),
                  minHeight: mmToPx(editingText.height, 96),
                  fontSize: editingText.fontSize,
                  textAlign: editingText.textAlign as any,
                  border: '1px dashed #d97706',
                  outline: 'none',
                  background: 'rgba(255,255,255,0.95)',
                  resize: 'none',
                  fontFamily: 'sans-serif',
                  lineHeight: 1.5,
                }}
              />
            )}
          </div>
          {/* 缩放提示 */}
          <div className="absolute bottom-4 left-4 text-xs text-gray-400 bg-white/80 px-2 py-1 rounded">
            滚轮缩放 · Alt+拖拽平移 · Delete 删除
          </div>
        </main>

        {/* 右侧属性面板 */}
        <aside className="w-72 bg-white border-l border-gray-200 overflow-auto">
          <PropertyPanel
            pages={project.pages}
            activePageIndex={safeActivePageIndex}
            selectedIds={selectedIds}
            projectId={project.id}
          />
        </aside>
      </div>

      {/* 隐藏的文件上传 */}
      <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={handleImageUpload} className="hidden" />

      {/* 正文样式弹窗（一键换全书正文的颜色/字号） */}
      {bodyStyleOpen && project && (
        <BodyStyleDialog
          project={project}
          onApply={handleApplyBodyStyle}
          onClose={() => setBodyStyleOpen(false)}
        />
      )}

      {/* 图片裁剪对话框（URL 有了才开，也就是"确实有照片"才开） */}
      {cropping?.url && (() => {
        const el = project.pages[cropping.pageIndex]?.elements.find(e => e.id === cropping.id);
        if (!el || el.type !== 'image') return null;
        return (
          <ImageCropper
            element={el as any}
            imageUrl={cropping.url}
            onConfirm={(crop) => {
              dispatch(pushHistory());
              dispatch(updateElement({
                pageIndex: cropping.pageIndex,
                elementId: cropping.id,
                updates: { crop }
              }));
              setCropping(null);
            }}
            onClose={() => setCropping(null)}
          />
        );
      })()}
    </div>
  );
}
