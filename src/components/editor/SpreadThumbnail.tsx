import { Fragment, useEffect, useState } from 'react';
import type { Page, BookFormat } from '@/types';
import PageCanvas from './PageCanvas';

/**
 * 单页缩略图宽度（px）。左侧栏 14rem（224px）− p-3 两侧 24px − 滚动条约 15px，
 * 两页 + 1px 中缝 + 卡片 2px 边框正好放进内容区。
 */
const PAGE_WIDTH = 90;

interface Props {
  /** 这一组跨页的 1~2 页（封面/结尾落单时只有一页） */
  pages: Page[];
  /** 组第一页在整本里的下标（从 0 开始，用来显示页码） */
  startIndex: number;
  format: BookFormat;
  active: boolean;
  onClick: () => void;
  /** 只有成对的两页才给删除按钮 —— 封面/结尾落单页不能删 */
  onDelete?: () => void;
  onAddPairBefore?: () => void;
  onAddPairAfter?: () => void;
  /**
   * 空白相册专用：在最末尾追加一页空白尾页（只在还没有独立尾页时给）。
   * 普通相册必须成对添加页面，不传这个就不会出现菜单项。
   */
  onAppendEndingPage?: () => void;
  /** 只有成对的两页能拖动；落单页拖不动 */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}

/**
 * 左侧栏的一组跨页缩略图：并排 1~2 页 + 中缝线，点击选中整个跨页。
 * 每页各是一个独立 canvas（见 PageCanvas 的注释），这里只负责排版和交互。
 */
export default function SpreadThumbnail({
  pages,
  startIndex,
  format,
  active,
  onClick,
  onDelete,
  onAddPairBefore,
  onAddPairAfter,
  onAppendEndingPage,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: Props) {
  /** 右键菜单 */
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  // 右键菜单关闭
  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu);
    };
  }, [menuOpen]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  };

  const hasMenu = Boolean(onAddPairBefore || onAddPairAfter || onAppendEndingPage);

  // 落单组只有两种：第一页是封面、下标 > 0 的最后一页是页尾 —— 标出来，
  // 不然用户看到单独的页面不知道它是干什么的（2026-11-25）
  const isLonePage = pages.length === 1;
  const label = pages.length > 1
    ? `第 ${startIndex + 1}–${startIndex + pages.length} 页`
    : startIndex === 0
      ? '第 1 页（封面）'
      : `第 ${startIndex + 1} 页（页尾）`;

  // 宽度由内容（1~2 页 + 中缝）撑开，边框才能紧贴缩略图，不留缝
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      onContextMenu={hasMenu ? handleContextMenu : undefined}
      className={`relative group cursor-pointer rounded-md overflow-hidden border-2 transition-all w-fit mx-auto ${
        active ? 'border-amber-600 shadow-md left-thumb-active' : 'border-gray-200 hover:border-gray-400'
      } ${isDragOver ? 'border-blue-500 border-t-4' : ''}`}
    >
      {/* 成对时两页并排；落单的封面/尾页只有一页宽、整张卡片居中，和主画布一致 */}
      <div className="flex justify-center items-stretch">
        {pages.map((page, i) => (
          <Fragment key={page.id}>
            {/* 中缝：一对页面才画 */}
            {i > 0 && <div className="w-px flex-shrink-0 bg-gray-300" />}
            <div
              className="flex-shrink-0 bg-white ring-1 ring-gray-200"
              style={{ width: PAGE_WIDTH }}
            >
              <PageCanvas page={page} format={format} width={PAGE_WIDTH} frozen={active} />
            </div>
          </Fragment>
        ))}
      </div>

      {/* 封面 / 页尾的标签一直显示（单页卡片窄，字号小一号才放得下）；成对页保持悬停显示 */}
      <div className={`absolute bottom-0 left-0 right-0 py-1 ${
        isLonePage ? 'px-1 text-[10px]' : 'px-2 text-xs'
      } ${
        active
          ? 'bg-amber-600 text-white'
          : `bg-black/40 text-white ${isLonePage ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`
      }`}>
        {label}
      </div>

      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="删除这两页"
          className="absolute top-1 right-1 w-5 h-5 bg-black/50 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all flex items-center justify-center"
        >
          ×
        </button>
      )}

      {/* 右键菜单：普通相册新建总是成对；空白相册多一个「添加页尾」 */}
      {menuOpen && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-2 w-fit"
          style={{ left: menuPos.x, top: menuPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {onAddPairBefore && (
            <button
              onClick={() => { onAddPairBefore(); setMenuOpen(false); }}
              className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap"
            >
              ⬆️ 在上方新建一对
            </button>
          )}
          {onAddPairAfter && (
            <button
              onClick={() => { onAddPairAfter(); setMenuOpen(false); }}
              className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap"
            >
              ⬇️ 在下方新建一对
            </button>
          )}
          {onAppendEndingPage && (
            <button
              onClick={() => { onAppendEndingPage(); setMenuOpen(false); }}
              className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap"
            >
              📄 添加页尾
            </button>
          )}
        </div>
      )}
    </div>
  );
}
