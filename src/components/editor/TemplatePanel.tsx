import { useState, useSyncExternalStore } from 'react';
import {
  TEMPLATES,
  getTemplateCategories,
  getTemplatesByCategory,
  applyTemplate,
  subscribeTemplates,
  getTemplatesVersion,
} from '@/templates';
import { deleteTemplateFromLibrary } from '@/utils/templateLibrary';
import { useAppDispatch, useAppSelector } from '@/store';
import { replacePageElements, pushHistory } from '@/store/projectSlice';
import { DEFAULT_BODY_COLOR, DEFAULT_BODY_FONT_SIZE } from '@/utils/bodyText';
import { clearSelection } from '@/store/editorSlice';
import type { BookFormat } from '@/types';

interface Props {
  format: BookFormat;
  onApplied?: () => void;
}

/**
 * 模板面板：展示所有排版模板，点击应用到当前页面
 */
export default function TemplatePanel({ format, onApplied }: Props) {
  const dispatch = useAppDispatch();
  // 模板应用到「活动页」——双页画布上点中的那一页，不是跨页锚页
  const activePageIndex = useAppSelector((s) => s.editor.activePageIndex);
  const project = useAppSelector((s) => s.project.current);
  // 模板库是模块级的可变数组，订阅版本号才能在新增/删除后重新渲染
  useSyncExternalStore(subscribeTemplates, getTemplatesVersion);
  // 按相册风格过滤：classic 显示经典模板，atmosphere 显示氛围感模板
  // 没有对应模板就显示空，不回退
  const styleId = project?.styleId ?? 'classic';
  const inStyle = (t: { styleId?: string }) => (t.styleId ?? 'classic') === styleId;
  const categories = getTemplateCategories().filter((c) =>
    getTemplatesByCategory(c).some(inStyle)
  );

  // 分类下拉：只做定位（滚动到对应分类），不过滤模板
  const [jumpCategory, setJumpCategory] = useState('');

  function jumpToCategory(category: string) {
    if (!category) return;
    document
      .getElementById(`template-category-${category}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 撤销/删页后页码可能暂时越界
  const pageIndex = project
    ? Math.max(0, Math.min(project.pages.length - 1, activePageIndex))
    : 0;

  // 收集当前页面已有的图片ID，应用模板时优先保留这些图片
  const currentPageImageIds = project
    ? project.pages[pageIndex]?.elements.filter((e) => e.type === 'image').map((e) => (e as any).imageId).filter(Boolean)
    : [];

  function handleApply(templateId: string) {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template || !project) return;

    // 先记录历史，支持 Ctrl+Z 撤销
    dispatch(pushHistory());

    // 当前页所有图片ID
    const allImageIds = currentPageImageIds;
    // 新模板需要多少个图片位
    const neededSlots = template.elements.filter((e) => e.type === 'image').length;

    // 只保留新模板放得下的照片，多出来的直接丢弃（不再为它们新建页面）。
    // 照片记录还在 IndexedDB 里，Ctrl+Z 能整页恢复。
    const currentPageImages = allImageIds.slice(0, neededSlots);

    // 应用模板到当前页（记录模板 ID，支持"保存模板"回写）
    const { elements, doodle, background } = applyTemplate(
      template,
      format,
      currentPageImages,
      project.themeId,
      project.bodyFontSize || DEFAULT_BODY_FONT_SIZE,
      project.bodyColor || DEFAULT_BODY_COLOR
    );
    dispatch(replacePageElements({ pageIndex, elements, templateId: template.id, doodle, background }));

    dispatch(clearSelection());
    // 不跳到别的页：用户正在看哪个跨页就留在哪个跨页
    onApplied?.();
    // 等左侧面板切换到页面标签后，滚动到当前页
    setTimeout(() => {
      const activeThumb = document.querySelector('.left-thumb-active');
      activeThumb?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  }

  // 从模板库删除模板（已用该模板排好的页面不受影响，只是之后不能再套用）
  async function handleDelete(templateId: string, name: string) {
    const ok = window.confirm(
      `确定删除模板「${name}」吗？\n\n已经用它排好的页面不会变，但之后不能再套用这个模板了。`
    );
    if (!ok) return;
    await deleteTemplateFromLibrary(templateId);
  }

  return (
    <div className="flex flex-col h-full">
      {/* 分类下拉：选一个分类就滚动定位到它。
          单独占一条工具条（不随模板滚动），而不是 sticky —— sticky 只盖住自己那块，
          上一分类的内容会从它上方和边缘透出来，定位后还留半行字在框上 */}
      <div className="flex-shrink-0 px-3 pt-3 pb-2 bg-white border-b border-gray-100">
        <select
          aria-label="按分类定位模板"
          value={jumpCategory}
          onChange={(e) => {
            setJumpCategory(e.target.value);
            jumpToCategory(e.target.value);
          }}
          className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:border-amber-500 cursor-pointer"
        >
          <option value="">按分类定位…</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      {/* 模板列表自己的滚动区：定位目标贴的是这块的顶边，不会被下拉框盖住 */}
      <div className="flex-1 overflow-auto p-3">
        <div className="space-y-4">
          {categories.map((category) => (
            <div key={category} id={`template-category-${category}`} className="scroll-mt-3">
              <h4 className="text-xs font-bold text-gray-600 mb-2 px-1 flex items-center gap-1">
                <span className="text-sm">🖼️</span>{category}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {getTemplatesByCategory(category).filter(inStyle).map((template) => (
                  // 用 div 而不是 button：删除按钮要嵌在里面，button 套 button 是非法 HTML
                  <div
                    key={template.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleApply(template.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleApply(template.id);
                      }
                    }}
                    className="group relative border border-gray-200 rounded-lg overflow-hidden hover:border-amber-500 hover:shadow-md transition-all text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    title={template.description}
                  >
                    {/* 删除按钮：只有"我的模板"才显示，鼠标移上去才出现 */}
                    {category === '我的模板' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(template.id, template.name);
                        }}
                        title="删除这个模板"
                        aria-label={`删除模板 ${template.name}`}
                        className="absolute top-1 right-1 z-10 w-5 h-5 bg-black/50 text-white rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 hover:bg-red-500 focus:opacity-100 transition-all flex items-center justify-center"
                      >
                        ×
                      </button>
                    )}
                    {/* 模板缩略图 */}
                    <div className="aspect-[148/210] bg-white p-1.5">
                      <TemplateThumbnail templateId={template.id} />
                    </div>
                    {/* 模板名称 */}
                    <div className="px-2 py-1.5 bg-gray-50 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-700 group-hover:text-amber-700 truncate">
                        {template.name}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-400 px-1 leading-relaxed">
              点击模板即可应用到当前页面。已上传的图片会自动填充到模板的图片位，你可以替换为其他图片。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 模板缩略图：用 SVG 绘制模板的布局示意
 */
function TemplateThumbnail({ templateId }: { templateId: string }) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;

  return (
    <svg viewBox="0 0 148 210" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {/* 页面背景 */}
      <rect x="0" y="0" width="148" height="210" fill="#fafafa" stroke="#e0e0e0" strokeWidth="0.5" />

      {template.elements.map((el, idx) => {
        const x = el.x * 148;
        const y = el.y * 210;
        const w = el.width * 148;
        const h = el.height * 210;

        if (el.type === 'image') {
          return (
            <g key={idx}>
              <rect x={x} y={y} width={w} height={h} fill="#d0d0d0" rx="1" />
              {/* 图片图标示意 */}
              <circle cx={x + w * 0.3} cy={y + h * 0.35} r={Math.min(w, h) * 0.08} fill="#b0b0b0" />
              <polygon
                points={`${x + w * 0.1},${y + h * 0.85} ${x + w * 0.45},${y + h * 0.5} ${x + w * 0.7},${y + h * 0.7} ${x + w * 0.85},${y + h * 0.55} ${x + w * 0.95},${y + h * 0.85}`}
                fill="#b0b0b0"
              />
            </g>
          );
        } else {
          // 文字元素：用横线示意
          const isTitle = (el.fontSizeRatio || 0) > 0.05;
          const lineCount = isTitle ? 1 : Math.max(2, Math.floor(h / 8));
          const lines = [];
          for (let i = 0; i < lineCount; i++) {
            const lineY = y + 4 + i * 6;
            const lineW = isTitle ? w * 0.7 : w * (0.6 + Math.random() * 0.35);
            const lineX = el.textAlign === 'center' ? x + (w - lineW) / 2 : el.textAlign === 'right' ? x + w - lineW : x;
            if (lineY < y + h - 2) {
              lines.push(
                <rect key={i} x={lineX} y={lineY} width={lineW} height="2.5" fill={isTitle ? '#999' : '#ccc'} rx="1" />
              );
            }
          }
          return <g key={idx}>{lines}</g>;
        }
      })}
    </svg>
  );
}
