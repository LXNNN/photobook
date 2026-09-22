import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch, store } from '@/store';
import { setCurrentProject, addElement, updateElement, deleteElement, addPage, deletePage, updateProjectName, reorderPages, swapImages, pushHistory, undo } from '@/store/projectSlice';
import { selectElement, clearSelection, setZoom, setPan, resetZoom, setCurrentPage as setCurrentPageAction } from '@/store/editorSlice';
import { setMode } from '@/store/uiSlice';
import { getProject, saveProject } from '@/utils/storage';
import { CanvasRenderer } from '@/engine/CanvasRenderer';
import { InteractionManager } from '@/engine/InteractionManager';
import { mmToPx, generateId } from '@/utils/units';
import { fileToImageAsset, getImageURL, blobToDataURL } from '@/utils/image';
import { saveImageAsset, getImageAsset } from '@/utils/storage';
import type { ImageElement, TextElement, Element } from '@/types';
import PageThumbnail from '@/components/editor/PageThumbnail';
import PropertyPanel from '@/components/editor/PropertyPanel';
import TemplatePanel from '@/components/editor/TemplatePanel';
import ImageCropper from '@/components/editor/ImageCropper';

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
  // 正在裁剪的图片元素 id
  const [croppingImageId, setCroppingImageId] = useState<string | null>(null);
  const [croppingImageUrl, setCroppingImageUrl] = useState<string>('');

  // 加载裁剪图片的 URL
  useEffect(() => {
    if (!croppingImageId || !project) return;
    const el = project.pages[currentPageIndex]?.elements.find(e => e.id === croppingImageId);
    if (!el || el.type !== 'image') return;
    const imageId = (el as any).imageId;
    if (!imageId) return;
    (async () => {
      const asset = await getImageAsset(imageId);
      if (asset) {
        setCroppingImageUrl(getImageURL(asset));
      }
    })();
  }, [croppingImageId, project, currentPageIndex]);

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
        dispatch(setCurrentPageAction(0));
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
      setCroppingImageId(elementId);
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
    await saveProject(project);
    setSaving(false);
    setTimeout(() => setSaving(false), 1500);
  }, [project]);

  // 自动保存（防抖）
  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => {
      saveProject(project);
    }, 3000);
    return () => clearTimeout(timer);
  }, [project]);

  // 上传图片
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !project) return;

    for (const file of Array.from(files)) {
      try {
        const asset = await fileToImageAsset(file);
        await saveImageAsset(asset);

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
      fontSize: 14,
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
    // 先保存项目，再跳转预览
    await saveProject(project);
    navigate(`/viewer/${project.id}`);
  };

  if (!project) {
    return <div className="w-full h-full flex items-center justify-center text-gray-400">加载中...</div>;
  }

  const currentPage = project.pages[currentPageIndex];

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
                saveProject(state.project.current);
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
          />
        </aside>
      </div>

      {/* 隐藏的文件上传 */}
      <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={handleImageUpload} className="hidden" />

      {/* 图片裁剪对话框 */}
      {croppingImageId && croppingImageUrl && (() => {
        const el = currentPage?.elements.find(e => e.id === croppingImageId);
        if (!el || el.type !== 'image') return null;
        return (
          <ImageCropper
            element={el as any}
            imageUrl={croppingImageUrl}
            onConfirm={(crop) => {
              dispatch(pushHistory());
              dispatch(updateElement({
                pageIndex: currentPageIndex,
                elementId: croppingImageId,
                updates: { crop }
              }));
              setCroppingImageId(null);
            }}
            onClose={() => setCroppingImageId(null)}
          />
        );
      })()}
    </div>
  );
}
