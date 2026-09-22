import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { updateElement, setPageBackground, setPageTemplateId } from '@/store/projectSlice';
import { getImageAsset, saveImageAsset } from '@/utils/storage';
import { persistTemplate } from '@/utils/templateLibrary';
import { fileToImageAsset, getImageURL } from '@/utils/image';
import { FONT_OPTIONS, FONT_WEIGHTS } from '@/utils/fonts';
import {
  TEMPLATES,
  getTemplateById,
  matchTemplateForPage,
  createTemplateFromPage,
  subscribeTemplates,
  getTemplatesVersion,
} from '@/templates';
import ImageCropper from './ImageCropper';
import type { Page, Element, ImageElement, TextElement } from '@/types';

interface Props {
  page: Page;
  pageIndex: number;
  selectedIds: string[];
}

export default function PropertyPanel({ page, pageIndex, selectedIds }: Props) {
  const dispatch = useAppDispatch();
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  const selectedElement = selectedIds.length === 1
    ? page.elements.find((el) => el.id === selectedIds[0])
    : null;

  function updateEl(updates: Partial<Element>) {
    if (!selectedElement) return;
    dispatch(updateElement({ pageIndex, elementId: selectedElement.id, updates }));
  }

  return (
    <div>
      {/* 模板操作按钮 */}
      <div className="p-3 border-b border-gray-100">
        <button
          onClick={() => setTemplateModalOpen(true)}
          className="w-full py-2 text-sm rounded-lg transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          🎨 模板操作
        </button>
      </div>

      {/* 模板操作弹窗 */}
      {templateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setTemplateModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-96 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-800">模板操作</h3>
              <button
                onClick={() => setTemplateModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <TemplateActions page={page} pageIndex={pageIndex} onDone={() => setTemplateModalOpen(false)} />
          </div>
        </div>
      )}

      {/* 页面属性（无选中时） */}
      {!selectedElement && <PageProperties page={page} pageIndex={pageIndex} />}

      {/* 图片元素属性 */}
      {selectedElement?.type === 'image' && (
        <ImagePropertyPanel
          el={selectedElement as ImageElement}
          pageIndex={pageIndex}
          onUpdate={updateEl}
        />
      )}

      {/* 文字元素属性 */}
      {selectedElement?.type === 'text' && (
        <TextProperties el={selectedElement as TextElement} onUpdate={updateEl} />
      )}
    </div>
  );
}

// ==================== 模板操作（只能新增，内置模板不可改） ====================

function TemplateActions({ page, pageIndex, onDone }: { page: Page; pageIndex: number; onDone?: () => void }) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((s) => s.project.current);
  const [newName, setNewName] = useState('');
  const [createState, setCreateState] = useState<'idle' | 'creating' | 'created' | 'duplicate'>('idle');
  // 模板库被新增/删除后（比如在左侧面板删了模板），这里的提示文案要跟着更新
  useSyncExternalStore(subscribeTemplates, getTemplatesVersion);

  // 当前页对应的模板：优先用页面记录的 templateId；
  // 老页面（本次功能上线前生成的）没有记录，就按元素几何反查一个
  const resolvedTemplateId = useMemo(() => {
    if (page.templateId) return page.templateId;
    if (!project) return undefined;
    return matchTemplateForPage(page, project.format)?.id;
  }, [page, project]);

  const matchedTemplate = resolvedTemplateId ? getTemplateById(resolvedTemplateId) : undefined;

  // 反查到的模板回写到页面，下次打开就不用再猜
  useEffect(() => {
    if (!project || page.templateId || !resolvedTemplateId) return;
    dispatch(setPageTemplateId({ pageIndex, templateId: resolvedTemplateId }));
  }, [project, page.templateId, resolvedTemplateId, pageIndex, dispatch]);

  // 用当前页面样式新建一个模板（只会新增，不动任何已有模板）
  const handleCreateTemplate = async () => {
    if (!project) return;
    const name = newName.trim();
    if (!name) return;

    // 模板库里已经有同名的就拦下来，否则面板上会出现两个一模一样的名字分不清
    if (TEMPLATES.some((t) => t.name === name)) {
      setCreateState('duplicate');
      return;
    }

    setCreateState('creating');
    const tpl = createTemplateFromPage(page, project.format, name);
    await persistTemplate(tpl);
    // 当前页改挂到新模板上
    dispatch(setPageTemplateId({ pageIndex, templateId: tpl.id }));
    setNewName('');
    setCreateState('created');
    setTimeout(() => setCreateState('idle'), 2500);
  };

  const busy = createState === 'creating';

  return (
    <div>
      {/* 新增模板：给当前页样式起个名字，在模板库里另存一个 */}
      <div>
        <p className="text-sm text-gray-600 mb-2">新建模板（另存为新模板）</p>
        <input
          type="text"
          value={newName}
          maxLength={20}
          placeholder="新模板名称"
          onChange={(e) => {
            setNewName(e.target.value);
            if (createState !== 'idle') setCreateState('idle');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreateTemplate();
          }}
          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg mb-2 bg-white focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={handleCreateTemplate}
          disabled={!newName.trim() || busy}
          className="w-full py-2 text-sm rounded-lg border border-dashed transition-colors border-amber-400 text-amber-700 hover:bg-amber-50 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          {createState === 'creating'
            ? '新增中...'
            : createState === 'created'
              ? '✓ 已新增到「我的模板」'
              : '＋ 新增模板'}
        </button>
        {createState === 'duplicate' && (
          <p className="text-xs text-red-500 mt-1.5 leading-relaxed">
            已经有叫「{newName.trim()}」的模板了，换个名字吧。
          </p>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-2.5 leading-relaxed">
        {matchedTemplate
          ? `当前页用的是模板「${matchedTemplate.name}」。`
          : '当前页是自由排版。'}
        新增的模板会存进「我的模板」，内置模板不会被改动。
      </p>
    </div>
  );
}

// ==================== 页面属性（无选中元素时） ====================

function PageProperties({ page, pageIndex }: { page: Page; pageIndex: number }) {
  const dispatch = useAppDispatch();

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">页面属性</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">背景颜色</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={page.background.type === 'color' ? page.background.value : '#ffffff'}
              onChange={(e) => dispatch(setPageBackground({ pageIndex, background: { type: 'color', value: e.target.value } }))}
              className="w-10 h-10 rounded cursor-pointer border border-gray-200"
            />
            <input
              type="text"
              value={page.background.type === 'color' ? page.background.value : '#ffffff'}
              onChange={(e) => dispatch(setPageBackground({ pageIndex, background: { type: 'color', value: e.target.value } }))}
              className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            选中元素后可编辑其属性。<br />
            支持拖拽移动、缩放、旋转。
          </p>
        </div>

        {/* 快捷背景色 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">常用背景</label>
          <div className="grid grid-cols-6 gap-1.5">
            {['#ffffff', '#faf8f5', '#f5f0e8', '#e8e4de', '#2c2c2c', '#1a1a1a', '#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#ede9fe', '#fee2e2'].map((color) => (
              <button
                key={color}
                onClick={() => dispatch(setPageBackground({ pageIndex, background: { type: 'color', value: color } }))}
                className="w-full aspect-square rounded border border-gray-200 hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== 文字属性 ====================

function TextProperties({ el, onUpdate }: { el: TextElement; onUpdate: (u: Partial<Element>) => void }) {
  const currentWeight = el.fontWeight ?? 'normal';

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">文字属性</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">文字内容</label>
          <textarea
            value={el.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded resize-none"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">字体</label>
          <select
            value={FONT_OPTIONS.some((f) => f.value === el.fontFamily) ? el.fontFamily : ''}
            onChange={(e) => onUpdate({ fontFamily: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded bg-white"
          >
            {!FONT_OPTIONS.some((f) => f.value === el.fontFamily) && (
              <option value="" disabled>
                当前字体（{el.fontFamily}）
              </option>
            )}
            {FONT_OPTIONS.map((f) => (
              <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">粗细</label>
          <div className="flex gap-1">
            {FONT_WEIGHTS.map((w) => (
              <button
                key={w.label}
                onClick={() => onUpdate({ fontWeight: w.value })}
                title={`字重 ${w.value}`}
                className={`flex-1 py-1.5 text-xs rounded ${currentWeight === w.value ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            中文字体多数只有常规/加粗两档，英文数字字体档位更全。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">字号</label>
            <input type="number" value={el.fontSize} min="6" max="200"
              onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) || 12 })}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">颜色</label>
            <input type="color" value={el.color}
              onChange={(e) => onUpdate({ color: e.target.value })}
              className="w-full h-9 border border-gray-200 rounded cursor-pointer" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">对齐方式</label>
          <div className="flex gap-1">
            {(['left', 'center', 'right'] as const).map((align) => (
              <button key={align}
                onClick={() => onUpdate({ textAlign: align })}
                className={`flex-1 py-1.5 text-xs rounded ${el.textAlign === align ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">行高: {el.lineHeight.toFixed(1)}</label>
          <input type="range" min="1" max="3" step="0.1" value={el.lineHeight}
            onChange={(e) => onUpdate({ lineHeight: parseFloat(e.target.value) })} className="w-full" />
        </div>
        <PositionFields el={el} onChange={onUpdate} />
      </div>
    </div>
  );
}

// 位置/尺寸字段组件
function PositionFields({ el, onChange }: { el: Element; onChange: (u: Partial<Element>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
      <div>
        <label className="block text-xs text-gray-500 mb-1.5">X (mm)</label>
        <input type="number" value={Math.round(el.x * 10) / 10} step="0.5"
          onChange={(e) => onChange({ x: parseFloat(e.target.value) || 0 })}
          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1.5">Y (mm)</label>
        <input type="number" value={Math.round(el.y * 10) / 10} step="0.5"
          onChange={(e) => onChange({ y: parseFloat(e.target.value) || 0 })}
          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1.5">宽 (mm)</label>
        <input type="number" value={Math.round(el.width * 10) / 10} step="0.5" min="1"
          onChange={(e) => onChange({ width: parseFloat(e.target.value) || 1 })}
          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1.5">高 (mm)</label>
        <input type="number" value={Math.round(el.height * 10) / 10} step="0.5" min="1"
          onChange={(e) => onChange({ height: parseFloat(e.target.value) || 1 })}
          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded" />
      </div>
    </div>
  );
}

// ==================== 图片属性面板（含裁剪、替换） ====================

interface ImagePanelProps {
  el: ImageElement;
  pageIndex: number;
  onUpdate: (updates: Partial<Element>) => void;
}

function ImagePropertyPanel({ el, pageIndex, onUpdate }: ImagePanelProps) {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [imageUrl, setImageUrl] = useState('');

  // 加载当前图片 URL
  useEffect(() => {
    if (!el.imageId) return;
    getImageAsset(el.imageId).then((asset) => {
      if (asset) {
        setImageUrl(getImageURL(asset));
      }
    });
  }, [el.imageId]);

  // 替换图片
  const handleReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const asset = await fileToImageAsset(file);
      await saveImageAsset(asset);

      onUpdate({ imageId: asset.id, crop: { x: 0, y: 0, width: 1, height: 1 } });

      // 刷新预览
      setImageUrl(getImageURL(asset));
    } catch (err) {
      console.error('替换图片失败:', err);
      alert('图片处理失败: ' + (err as Error).message);
    }
    e.target.value = '';
  };

  // 确认裁剪
  const handleCropConfirm = (crop: { x: number; y: number; width: number; height: number }) => {
    onUpdate({ crop });
    setShowCropper(false);
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">图片属性</h3>
      <div className="space-y-3">
        {/* 预览缩略图 */}
        {imageUrl && (
          <div className="rounded-lg overflow-hidden border border-gray-200">
            <img src={imageUrl} alt="" className="w-full h-32 object-cover" />
          </div>
        )}

        {/* 操作按钮 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            🔄 替换图片
          </button>
          <button
            onClick={() => setShowCropper(true)}
            className="py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            ✂️ 裁剪
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" onChange={handleReplace} className="hidden" />

        <PositionFields el={el} onChange={onUpdate} />

        <div className="pt-3 border-t border-gray-100">
          <label className="block text-xs text-gray-500 mb-1.5">透明度: {Math.round(el.opacity * 100)}%</label>
          <input type="range" min="0" max="1" step="0.01" value={el.opacity}
            onChange={(e) => onUpdate({ opacity: parseFloat(e.target.value) })} className="w-full" />
        </div>
        <div className="pt-3 border-t border-gray-100">
          <label className="block text-xs text-gray-500 mb-1.5">旋转: {Math.round(el.rotation)}°</label>
          <input type="range" min="-180" max="180" step="1" value={el.rotation}
            onChange={(e) => onUpdate({ rotation: parseFloat(e.target.value) })} className="w-full" />
        </div>
      </div>

      {/* 裁剪对话框 */}
      {showCropper && imageUrl && (
        <ImageCropper
          element={el}
          imageUrl={imageUrl}
          onConfirm={handleCropConfirm}
          onClose={() => setShowCropper(false)}
        />
      )}
    </div>
  );
}
