import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch, store } from '@/store';
import { setCurrentProject, addElement, updateElement, deleteElement, addPage, deletePage, updateProjectName, reorderPages, swapImages, pushHistory, undo } from '@/store/projectSlice';
import { selectElement, clearSelection, setZoom, setPan, resetZoom, resetEditor, setCurrentPage as setCurrentPageAction } from '@/store/editorSlice';
import { setMode } from '@/store/uiSlice';
import { getProject } from '@/utils/storage';
import { saveImageAsset, getImageAsset } from '@/utils/assetStore';
import { subscribeFolderStatus, getFolderStatus } from '@/utils/folderMode';
import { ensureFolderReady, reconnectFolder, flushFolderWrites, persistProject } from '@/utils/folderLibrary';
import { CanvasRenderer } from '@/engine/CanvasRenderer';
import { InteractionManager } from '@/engine/InteractionManager';
import { mmToPx, generateId } from '@/utils/units';
import { fileToImageAsset, getImageURL, blobToDataURL } from '@/utils/image';
import type { ImageElement, TextElement, Element } from '@/types';
import PageThumbnail from '@/components/editor/PageThumbnail';
import PropertyPanel from '@/components/editor/PropertyPanel';
import TemplatePanel from '@/components/editor/TemplatePanel';
import ImageCropper from '@/components/editor/ImageCropper';

// 启动守卫在 StrictMode 下会跑两遍，提示只弹一次
let folderGuardAlerted = false;

export default function Editor() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const project = useAppSelector((s) => s.project.current);
  const currentPageIndex = useAppSelector((s) => s.editor.currentPageIndex);
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
  const [leftTab, setLeftTab] = useState<'pages' | 'templates'>('pages');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // 正在编辑的文字元素
  const [editingText, setEditingText] = useState<{
    elementId: string;
    content: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    textAlign: string;
  } | null>(null);
  const editingTextRef = useRef<HTMLTextAreaElement>(null);
  // 正在裁剪的图片。id 和 URL 绑成一份状态存：分成两个 state 的话，切换到下一个
  // 元素时会出现「新元素的 id + 上一个元素的 URL」的中间态，对话框会先闪一下上一张照片
  const [cropping, setCropping] = useState<{ id: string; url: string } | null>(null);
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

  // 加载裁剪图片的 URL
  useEffect(() => {
    const id = cropping?.id;
    const el = id && project
      ? project.pages[currentPageIndex]?.elements.find((e) => e.id === id)
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
      setCropping(asset ? { id, url: getImageURL(asset) } : null);
    })();
    return () => { cancelled = true; };
  }, [cropping?.id, project, currentPageIndex]);

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

  // 初始化渲染器和交互管理器（canvas 挂载时执行一次）
  useEffect(() => {
    if (!canvasRef.current || !project) return;

    const renderer = new CanvasRenderer(canvasRef.current, project.format, 96);
    rendererRef.current = renderer;

    const interaction = new InteractionManager(canvasRef.current, project.format, 96);
    interactionRef.current = interaction;

    interaction.onSelect = (id, multi) => {
      dispatch(selectElement(id));
    };
    interaction.onClearSelection = () => {
      dispatch(clearSelection());
    };
    // 注意：onElementChange 用 store.getState() 获取最新 pageIndex，避免闭包旧值
    interaction.onElementChange = (id, updates) => {
      const pageIdx = store.getState().editor.currentPageIndex;
      dispatch(updateElement({ pageIndex: pageIdx, elementId: id, updates }));
    };
    interaction.onSwapImages = (sourceId, targetId) => {
      const pageIdx = store.getState().editor.currentPageIndex;
      dispatch(swapImages({ pageIndex: pageIdx, sourceId, targetId }));
    };
    interaction.onHoverTargetChange = (targetId) => {
      setHoverTargetId(targetId);
    };
    interaction.onTextEdit = (elementId, content, x, y, width, height, fontSize, textAlign) => {
      setEditingText({ elementId, content, x, y, width, height, fontSize, textAlign });
    };
    interaction.onImageCrop = (elementId) => {
      // 先选中这个图片元素，再打开裁剪
      dispatch(selectElement(elementId));
      // URL 先留空，等上面那个 effect 取到照片再开对话框。
      // 直接沿用上一次的 URL 的话，会先闪一下上一张照片
      setCropping({ id: elementId, url: '' });
    };
    interaction.onAlignGuides = (guides) => {
      rendererRef.current?.setAlignGuides(guides);
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

    return () => {
      renderer.destroy();
      interaction.destroy();
    };
    // 只在 project 首次加载完成后初始化一次
    // 后续 project 内容变化不重建渲染器和交互管理器，避免拖拽中断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!project]);

  // 渲染当前页
  useEffect(() => {
    if (!rendererRef.current || !project) return;
    const page = project.pages[currentPageIndex];
    if (!page) return;

    // 加载图片资源
    (async () => {
      for (const el of page.elements) {
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
    })();

    rendererRef.current.render(page, selectedIds, showGuides, showBleed, hoverTargetId);
  }, [project, currentPageIndex, selectedIds, showGuides, showBleed, hoverTargetId]);

  // 更新交互管理器状态
  useEffect(() => {
    if (!interactionRef.current || !project) return;
    const page = project.pages[currentPageIndex];
    if (page) {
      interactionRef.current.setElements(page.elements);
      interactionRef.current.setSelectedIds(selectedIds);
      interactionRef.current.setZoom(zoom);
      interactionRef.current.setPan(pan);
    }
  }, [project, currentPageIndex, selectedIds, zoom, pan]);

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

        // 如果当前选中了一个图片元素，直接替换它的图片
        const page = project.pages[currentPageIndex];
        const selectedImageElement = page.elements.find(
          (el) => el.type === 'image' && selectedIds.includes(el.id)
        ) as ImageElement | undefined;

        if (selectedImageElement) {
          // 替换选中元素的图片
          dispatch(updateElement({
            pageIndex: currentPageIndex,
            elementId: selectedImageElement.id,
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

          dispatch(addElement({ pageIndex: currentPageIndex, element: newElement }));
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

  // 添加文字
  const handleAddText = () => {
    if (!project) return;
    const page = project.pages[currentPageIndex];
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
      content: '双击编辑文字',
      fontSize: project.bodyFontSize || 12,
      fontFamily: 'sans-serif',
      color: '#333333',
      textAlign: 'left',
      lineHeight: 1.5,
      letterSpacing: 0,
    };
    dispatch(addElement({ pageIndex: currentPageIndex, element: newElement }));
    dispatch(selectElement(newElement.id));
  };

  // 删除选中元素
  const handleDeleteSelected = () => {
    if (selectedIds.length === 0 || !project) return;
    dispatch(pushHistory());
    for (const id of selectedIds) {
      dispatch(deleteElement({ pageIndex: currentPageIndex, elementId: id }));
    }
    dispatch(clearSelection());
  };

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
        dispatch(resetZoom());
      }
      // Ctrl+Z 撤销
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        dispatch(undo());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, zoom, dispatch, handleSave]);

  // 切换到浏览模式
  const handleViewMode = async () => {
    if (!project) return;
    // 先保存项目（IndexedDB + 文件夹），再跳转预览
    await persistProject(project);
    navigate(`/viewer/${project.id}`);
  };

  if (!project) {
    return <div className="w-full h-full flex items-center justify-center text-gray-400">加载中...</div>;
  }

  const currentPage = project.pages[currentPageIndex];

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
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shadow-sm z-10">
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
          <span className="text-xs text-gray-400">{project.pages.length} 页 · A5</span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
            📷 上传图片
          </button>
          <button onClick={handleAddText} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors">
            📝 添加文字
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <button onClick={() => dispatch(setZoom(zoom / 1.2))} className="w-8 h-8 text-gray-600 hover:bg-gray-100 rounded">-</button>
          <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => dispatch(setZoom(zoom * 1.2))} className="w-8 h-8 text-gray-600 hover:bg-gray-100 rounded">+</button>
          <button onClick={() => dispatch(resetZoom())} className="px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded">适应</button>
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
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="flex border-b border-gray-100">
            {(['pages', 'templates'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  leftTab === tab ? 'text-amber-700 border-b-2 border-amber-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'pages' ? '页面' : '模板'}
              </button>
            ))}
          </div>

          {/* 每个页签自己是独立的滚动容器，切换时保留各自的滚动位置 */}
          <div className={leftTab === 'pages' ? 'flex-1 overflow-auto p-3' : 'hidden'}>
            <div className="space-y-2">
              {project.pages.map((page, idx) => (
                <PageThumbnail
                  key={page.id}
                  page={page}
                  index={idx}
                  active={idx === currentPageIndex}
                  format={project.format}
                  onClick={() => dispatch(setCurrentPageAction(idx))}
                  onDelete={() => {
                    if (project.pages.length <= 1) return;
                    dispatch(pushHistory());
                    dispatch(deletePage(idx));
                    // 删除页面后，自动切换到正确的当前页，避免索引越界导致白屏
                    const total = project.pages.length;
                    let newIndex = currentPageIndex;
                    if (idx === currentPageIndex) {
                      // 删除的是当前页：如果是最后一页就跳到上一页，否则保持索引（自动指向下一页）
                      newIndex = idx === total - 1 ? idx - 1 : idx;
                    } else if (idx < currentPageIndex) {
                      // 删除的是当前页之前的页，当前索引减1
                      newIndex = currentPageIndex - 1;
                    }
                    // 确保索引在有效范围内
                    newIndex = Math.max(0, Math.min(newIndex, total - 2));
                    setTimeout(() => dispatch(setCurrentPageAction(newIndex)), 0);
                  }}
                  onAddPageBefore={() => {
                    dispatch(pushHistory());
                    dispatch(addPage({ afterIndex: idx - 1 }));
                    // 新页面插入在 idx 位置，自动选中它
                    dispatch(setCurrentPageAction(idx));
                  }}
                  onAddPageAfter={() => {
                    dispatch(pushHistory());
                    dispatch(addPage({ afterIndex: idx }));
                    // 新页面插入在 idx + 1 位置，自动选中它
                    dispatch(setCurrentPageAction(idx + 1));
                  }}
                  draggable
                  isDragOver={dragOverIndex === idx && dragIndex !== idx}
                  onDragStart={(e) => {
                    setDragIndex(idx);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIndex(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== idx) {
                      dispatch(reorderPages({ from: dragIndex, to: idx }));
                    }
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                />
              ))}
              <button
                onClick={() => {
                  dispatch(pushHistory());
                  dispatch(addPage({}));
                  // 新页面插入在最后，自动选中它
                  dispatch(setCurrentPageAction(project.pages.length));
                }}
                className="w-full py-3 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 hover:border-amber-400 hover:text-amber-600 transition-colors text-sm"
              >
                + 添加页面
              </button>
            </div>
          </div>
          <div className={leftTab === 'templates' ? 'flex-1 overflow-auto p-3' : 'hidden'}>
            <TemplatePanel format={project.format} onApplied={() => setLeftTab('pages')} />
          </div>
        </aside>

        {/* 中间画布区域 */}
        <main ref={containerRef} className="flex-1 overflow-hidden relative flex items-center justify-center">
          <div style={canvasStyle} className="shadow-2xl relative">
            <canvas ref={canvasRef} className="block bg-white" />
            {/* 文字编辑输入框 */}
            {editingText && (
              <textarea
                ref={editingTextRef}
                value={editingText.content}
                onChange={(e) => setEditingText({ ...editingText, content: e.target.value })}
                onBlur={() => {
                  // 失焦时保存
                  dispatch(pushHistory());
                  dispatch(updateElement({
                    pageIndex: currentPageIndex,
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
                  left: mmToPx(editingText.x, 96),
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
            page={currentPage}
            pageIndex={currentPageIndex}
            selectedIds={selectedIds}
            projectId={project.id}
          />
        </aside>
      </div>

      {/* 隐藏的文件上传 */}
      <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={handleImageUpload} className="hidden" />

      {/* 图片裁剪对话框（URL 有了才开，也就是"确实有照片"才开） */}
      {cropping?.url && (() => {
        const el = currentPage?.elements.find(e => e.id === cropping.id);
        if (!el || el.type !== 'image') return null;
        return (
          <ImageCropper
            element={el as any}
            imageUrl={cropping.url}
            onConfirm={(crop) => {
              dispatch(pushHistory());
              dispatch(updateElement({
                pageIndex: currentPageIndex,
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
