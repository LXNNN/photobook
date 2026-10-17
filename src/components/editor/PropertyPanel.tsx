import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { updateElement, setPageBackground, setPageTemplateId, addElement, pushHistory } from '@/store/projectSlice';
import { selectElement } from '@/store/editorSlice';
import { getImageAsset, saveImageAsset } from '@/utils/assetStore';
import { persistTemplate } from '@/utils/templateLibrary';
import { fileToImageAsset, getImageURL } from '@/utils/image';
import { ART_FONT_OPTIONS, SYSTEM_FONT_OPTIONS, FONT_OPTIONS, FONT_WEIGHTS } from '@/utils/fonts';
import type { FontOption } from '@/utils/fonts';
import { generateId } from '@/utils/units';
import {
  TEMPLATES,
  getTemplateById,
  matchTemplateForPage,
  createTemplateFromPage,
  subscribeTemplates,
  getTemplatesVersion,
} from '@/templates';
import ImageCropper from './ImageCropper';
import type { Page, Element, ImageElement, TextElement, ShapeElement } from '@/types';

interface Props {
  /** 整本相册的所有页：选中的元素可能落在跨页的任意一页上 */
  pages: Page[];
  /** 活动页（点中的那一页）：无选中时的页面属性、选区都作用在它上面 */
  activePageIndex: number;
  selectedIds: string[];
  /** 替换照片时要写进哪本相册的文件夹（资产仓库用） */
  projectId: string;
}

/** 在整本里找元素，返回它所在的页 */
function findElementInPages(pages: Page[], elementId: string): { el: Element; pageIndex: number } | null {
  for (let i = 0; i < pages.length; i++) {
    const el = pages[i].elements.find((e) => e.id === elementId);
    if (el) return { el, pageIndex: i };
  }
  return null;
}

/** 把元素起点夹在页内，不能通过属性面板把元素推过中缝 */
function clampPosition(value: number, size: number, limit: number): number {
  const maxStart = Math.max(0, limit - size);
  return Math.max(0, Math.min(maxStart, value));
}

export default function PropertyPanel({ pages, activePageIndex, selectedIds, projectId }: Props) {
  const dispatch = useAppDispatch();
  const format = useAppSelector((s) => s.project.current?.format);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  const page = pages[activePageIndex];
  const pageIndex = activePageIndex;

  // 页面不存在时（比如刚删除了当前页），不渲染属性面板，避免白屏
  if (!page || !page.elements) {
    return null;
  }

  const selectedElement = selectedIds.length === 1
    ? findElementInPages(pages, selectedIds[0])
    : null;

  const isMultiSelect = selectedIds.length > 1;

  function updateEl(updates: Partial<Element>) {
    if (!selectedElement) return;
    const next = { ...updates };
    if (format) {
      // X/Y 输入框按元素所在页夹紧（拖拽本身已经在交互层夹过了）
      if (next.x !== undefined) next.x = clampPosition(next.x, selectedElement.el.width, format.width);
      if (next.y !== undefined) next.y = clampPosition(next.y, selectedElement.el.height, format.height);
    }
    dispatch(updateElement({ pageIndex: selectedElement.pageIndex, elementId: selectedElement.el.id, updates: next }));
  }

  // 多选时批量移动所有选中元素：每个元素按自己所在的页夹紧，照片不能跨中缝
  function moveSelectedElements(deltaX: number, deltaY: number) {
    for (const id of selectedIds) {
      const found = findElementInPages(pages, id);
      if (!found) continue;
      const updates: Partial<Element> = {};
      if (deltaX !== 0) {
        updates.x = format ? clampPosition(found.el.x + deltaX, found.el.width, format.width) : found.el.x + deltaX;
      }
      if (deltaY !== 0) {
        updates.y = format ? clampPosition(found.el.y + deltaY, found.el.height, format.height) : found.el.y + deltaY;
      }
      dispatch(updateElement({ pageIndex: found.pageIndex, elementId: id, updates }));
    }
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
      {selectedIds.length === 0 && <PageProperties page={page} pageIndex={pageIndex} />}

      {/* 多选组属性（选中多个元素时） */}
      {isMultiSelect && (
        <MultiSelectPanel
          pages={pages}
          selectedIds={selectedIds}
          onMove={moveSelectedElements}
        />
      )}

      {/* 图片元素属性 */}
      {selectedElement?.el.type === 'image' && (
        <ImagePropertyPanel
          el={selectedElement.el as ImageElement}
          pageIndex={selectedElement.pageIndex}
          onUpdate={updateEl}
          projectId={projectId}
        />
      )}

      {/* 文字元素属性 */}
      {selectedElement?.el.type === 'text' && (
        <TextProperties el={selectedElement.el as TextElement} onUpdate={updateEl} />
      )}

      {/* 形状/选区元素属性 */}
      {selectedElement?.el.type === 'shape' && (
        <ShapeProperties
          el={selectedElement.el as ShapeElement}
          page={pages[selectedElement.pageIndex]}
          pageIndex={selectedElement.pageIndex}
          onUpdate={updateEl}
        />
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
  const project = useAppSelector((s) => s.project.current);
  const format = project?.format;

  // 添加照片选区（空图片占位符）
  const handleAddImageSlot = () => {
    if (!format) return;
    const maxZ = page.elements.length > 0 ? Math.max(...page.elements.map((e) => e.zIndex)) : -1;
    const newElement: ImageElement = {
      id: generateId(),
      type: 'image',
      x: format.width * 0.15,
      y: format.height * 0.2,
      width: format.width * 0.7,
      height: format.height * 0.3,
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      imageId: '',
      crop: { x: 0, y: 0, width: 1, height: 1 },
    };
    dispatch(addElement({ pageIndex, element: newElement }));
    dispatch(selectElement(newElement.id));
  };

  // 添加普通选区（可设置背景色的形状）
  const handleAddShapeSlot = () => {
    if (!format) return;
    const maxZ = page.elements.length > 0 ? Math.max(...page.elements.map((e) => e.zIndex)) : -1;
    const newElement: ShapeElement = {
      id: generateId(),
      type: 'shape',
      x: format.width * 0.15,
      y: format.height * 0.2,
      width: format.width * 0.7,
      height: format.height * 0.3,
      rotation: 0,
      opacity: 1,
      zIndex: maxZ + 1,
      backgroundColor: '#e8e4de',
      borderRadius: 0,
    };
    dispatch(addElement({ pageIndex, element: newElement }));
    dispatch(selectElement(newElement.id));
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">页面属性</h3>

      <div className="space-y-4">
        {/* 添加选区功能（照片选区/普通选区） */}
        <div className="pb-4 border-b border-gray-100">
          <label className="block text-xs text-gray-500 mb-2">添加选区</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleAddImageSlot}
              className="py-2 px-3 text-xs rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium"
            >
              🖼️ 照片选区
            </button>
            <button
              onClick={handleAddShapeSlot}
              className="py-2 px-3 text-xs rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors font-medium"
            >
              ⬜ 普通选区
            </button>
          </div>
        </div>

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

        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            选中元素后可编辑其属性。<br />
            支持拖拽移动、缩放、旋转。
          </p>
        </div>
      </div>
    </div>
  );
}

// ==================== 文字属性 ====================

/** 字体下拉的选项。style 里的字体只是在支持自定义样式的浏览器里预览用 */
function renderFontOptions(options: FontOption[]) {
  return options.map((f) => (
    <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
      {f.label}
    </option>
  ));
}

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
            <optgroup label="艺术字体">{renderFontOptions(ART_FONT_OPTIONS)}</optgroup>
            <optgroup label="系统字体">{renderFontOptions(SYSTEM_FONT_OPTIONS)}</optgroup>
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
          <label className="block text-xs text-gray-500 mb-1.5">背景色</label>
          <div className="flex items-center gap-2">
            <input type="color" value={el.backgroundColor ?? '#fff3b0'}
              onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
              className="w-10 h-9 border border-gray-200 rounded cursor-pointer"
              title="选文字的背景色" />
            <span className="flex-1 text-xs text-gray-500">{el.backgroundColor ?? '无背景'}</span>
            {el.backgroundColor && (
              <button
                onClick={() => onUpdate({ backgroundColor: undefined })}
                className="px-2 py-1.5 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                去掉
              </button>
            )}
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

// ==================== 多选组属性面板 ====================

function MultiSelectPanel({ pages, selectedIds, onMove }: {
  pages: Page[];
  selectedIds: string[];
  onMove: (deltaX: number, deltaY: number) => void;
}) {
  // 计算选中组的边界。跨页多选时只取第一个元素所在页的那些元素：
  // 两页的坐标各自从 0 起算，混在一起算最小值没有意义。
  const found = selectedIds
    .map((id) => findElementInPages(pages, id))
    .filter((f): f is { el: Element; pageIndex: number } => !!f);

  const anchorPageIndex = found[0]?.pageIndex;
  const selectedElements = found
    .filter((f) => f.pageIndex === anchorPageIndex)
    .map((f) => f.el);

  let minX = Infinity, minY = Infinity;
  for (const el of selectedElements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; }

  const handleXChange = (newX: number) => {
    onMove(newX - minX, 0);
  };

  const handleYChange = (newY: number) => {
    onMove(0, newY - minY);
  };

  return (
    <div className="p-3 border-b border-gray-100">
      <div className="text-sm font-medium text-gray-700 mb-2">已选中 {selectedIds.length} 个元素</div>
      <div className="text-xs text-gray-400 mb-3">修改坐标可整体移动选中组</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">X (mm)</label>
          <input
            type="number"
            value={Math.round(minX * 10) / 10}
            step="0.5"
            onChange={(e) => handleXChange(parseFloat(e.target.value) || 0)}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Y (mm)</label>
          <input
            type="number"
            value={Math.round(minY * 10) / 10}
            step="0.5"
            onChange={(e) => handleYChange(parseFloat(e.target.value) || 0)}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded"
          />
        </div>
      </div>
    </div>
  );
}

// ==================== 形状/选区属性面板 ====================

function ShapeProperties({ el, page, pageIndex, onUpdate }: {
  el: ShapeElement;
  page: Page;
  pageIndex: number;
  onUpdate: (u: Partial<Element>) => void;
}) {
  const dispatch = useAppDispatch();

  // 统一的层级调整：重新排序后交换位置，再重新分配所有元素的zIndex（确保唯一稳定）
  const adjustLayer = (direction: 'forward' | 'backward') => {
    if (!page) return;
    // 按 zIndex 升序排序，zIndex 相同的按原数组顺序（后添加的在上层）
    const sorted = [...page.elements].sort((a, b) => {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      return page.elements.indexOf(a) - page.elements.indexOf(b);
    });
    const currentIndex = sorted.findIndex((e) => e.id === el.id);
    if (currentIndex === -1) return;

    // 上一层：和后一个交换；下一层：和前一个交换
    let targetIndex: number;
    if (direction === 'forward') {
      if (currentIndex >= sorted.length - 1) return; // 已经最上层
      targetIndex = currentIndex + 1;
    } else {
      if (currentIndex <= 0) return; // 已经最下层
      targetIndex = currentIndex - 1;
    }

    // 交换排序数组中的位置
    [sorted[currentIndex], sorted[targetIndex]] = [sorted[targetIndex], sorted[currentIndex]];

    // 重新分配所有元素的 zIndex（0,1,2,3... 确保唯一稳定）
    dispatch(pushHistory());
    sorted.forEach((element, index) => {
      if (element.zIndex !== index) {
        dispatch(updateElement({ pageIndex, elementId: element.id, updates: { zIndex: index } }));
      }
    });
  };

  const handleBringForward = () => adjustLayer('forward');
  const handleSendBackward = () => adjustLayer('backward');

  // 直接更新当前元素（走 onUpdate —— 里面的 X/Y 夹紧不能绕过去）
  const handleUpdate = (updates: Partial<Element>) => {
    onUpdate(updates);
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">普通选区</h3>

      <div className="space-y-4">
        {/* 层级调整 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">层级调整</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleBringForward}
              className="py-1.5 px-2 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              ⬆️ 上一层
            </button>
            <button
              onClick={handleSendBackward}
              className="py-1.5 px-2 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              ⬇️ 下一层
            </button>
          </div>
        </div>

        {/* 背景色 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">背景颜色</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={el.backgroundColor || '#e8e4de'}
              onChange={(e) => handleUpdate({ backgroundColor: e.target.value })}
              className="w-10 h-10 rounded cursor-pointer border border-gray-200"
            />
            <input
              type="text"
              value={el.backgroundColor || '#e8e4de'}
              onChange={(e) => handleUpdate({ backgroundColor: e.target.value })}
              className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded"
            />
          </div>
        </div>

        {/* 常用颜色 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">常用颜色</label>
          <div className="grid grid-cols-6 gap-1.5">
            {['#ffffff', '#faf8f5', '#f5f0e8', '#e8e4de', '#d4cfc7', '#2c2c2c', '#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#ede9fe', '#fee2e2'].map((color) => (
              <button
                key={color}
                onClick={() => handleUpdate({ backgroundColor: color })}
                className="w-full aspect-square rounded border border-gray-200 hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        {/* 圆角 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">圆角 (mm)</label>
          <input
            type="number"
            value={el.borderRadius || 0}
            step="1"
            min="0"
            onChange={(e) => handleUpdate({ borderRadius: parseFloat(e.target.value) || 0 })}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded"
          />
        </div>

        {/* 不透明度 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">不透明度: {Math.round((el.opacity ?? 1) * 100)}%</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={el.opacity ?? 1}
            onChange={(e) => handleUpdate({ opacity: parseFloat(e.target.value) })}
            className="w-full"
          />
        </div>
      </div>

      {/* 位置尺寸 */}
      <PositionFields el={el} onChange={handleUpdate} />
    </div>
  );
}

// ==================== 图片属性面板（含裁剪、替换） ====================

interface ImagePanelProps {
  el: ImageElement;
  pageIndex: number;
  onUpdate: (updates: Partial<Element>) => void;
  /** 替换照片时要写进哪本相册的文件夹（资产仓库用） */
  projectId: string;
}

function ImagePropertyPanel({ el, pageIndex, onUpdate, projectId }: ImagePanelProps) {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [imageUrl, setImageUrl] = useState('');

  // 加载当前图片 URL
  useEffect(() => {
    // 换到还没填照片的元素上（模板留下的空图片区域）必须把 URL 清掉。
    // 这个面板没带 key，切元素时不会重挂载，留着上一张的 URL 的话，
    // 预览图和裁剪框里都会是上一张照片
    if (!el.imageId) {
      setImageUrl('');
      return;
    }
    let cancelled = false;
    getImageAsset(el.imageId).then((asset) => {
      if (!cancelled && asset) {
        setImageUrl(getImageURL(asset));
      }
    });
    return () => { cancelled = true; };
  }, [el.imageId]);

  // 替换图片
  const handleReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const asset = await fileToImageAsset(file);
      await saveImageAsset(projectId, asset);

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
            disabled={!el.imageId}
            className="py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
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
