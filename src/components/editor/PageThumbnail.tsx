import { useEffect, useRef, useState } from 'react';
import type { Page, BookFormat } from '@/types';
import { mmToPx } from '@/utils/units';
import { getImageAsset } from '@/utils/storage';
import { getImageURL } from '@/utils/image';
import { drawPageContent } from '@/engine/drawPageContent';

/** 缩略图宽度（px），高度按页面真实比例推算出来，不写死 */
const THUMB_WIDTH = 120;
/** 和主画布同一个 dpi。缩略图不另算字号，靠整体缩放，所以这个值只用来推画布高度 */
const DPI = 96;

interface Props {
  page: Page;
  index: number;
  active: boolean;
  format: BookFormat;
  onClick: () => void;
  onDelete: () => void;
  onAddPageBefore: () => void;
  onAddPageAfter: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}

export default function PageThumbnail({ page, index, active, format, onClick, onDelete, onAddPageBefore, onAddPageAfter, draggable, onDragStart, onDragOver, onDrop, isDragOver }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 正在编辑的那一页的冻结快照：编辑期间缩略图不跟着变 */
  const frozenRef = useRef<Page | null>(null);
  /** 上次画过的是哪份数据，没变就直接跳过 */
  const lastDrawnRef = useRef<Page | null>(null);
  /** 绘制序号：只有最新一轮有资格落笔，防止旧画面补画到新画布上 */
  const drawIdRef = useRef(0);
  /** 右键菜单 */
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  // 横纵共用一个缩放比例，保证等比
  const scale = THUMB_WIDTH / mmToPx(format.width, DPI);
  const thumbWidth = THUMB_WIDTH;
  const thumbHeight = Math.round(mmToPx(format.height, DPI) * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let shown: Page;
    if (active) {
      // 正在编辑的这一页：进来时冻结一份，编辑期间不再跟画。
      // 拖拽时 page 每秒要变几十次，跟着重画既费资源（反复读 IndexedDB 里的图片），
      // 画面也会因为异步图片乱序落地而叠影。
      if (!frozenRef.current) frozenRef.current = page;
      shown = frozenRef.current;
    } else {
      // 切走了解冻，这时才用最终状态重画一次
      frozenRef.current = null;
      shown = page;
    }
    if (shown === lastDrawnRef.current) return;
    lastDrawnRef.current = shown;
    const myId = ++drawIdRef.current;

    (async () => {
      // 先把这一页用到的图片（含贴纸）全部解码好再落笔。
      // 图片只能异步取，若边画边等，图片就会全部画在文字之后，盖住文字、图层顺序全乱。
      const assets = new Map<string, HTMLImageElement>();
      await Promise.all(
        shown.elements
          .filter((el) => el.type === 'image' || el.type === 'sticker')
          .map(async (el) => {
            const assetId = el.type === 'image' ? el.imageId : el.stickerId;
            if (!assetId) return;
            const asset = await getImageAsset(assetId);
            if (!asset) return;
            const img = new Image();
            const url = getImageURL(asset);
            await new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              img.src = url;
            });
            // 图已经解码进 img 了，这个 objectURL 用完就撤，不然每画一次漏一个
            URL.revokeObjectURL(url);
            assets.set(assetId, img);
          })
      );

      // 已经有更新的一轮绘制接管了，这一轮的画面作废
      if (drawIdRef.current !== myId) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 整体等比缩小，而不是按缩略图尺寸把字号和坐标重算一遍：
      // 喂给 drawPageContent 的数字和主画布逐字相同，折行点、旋转、cover 裁剪
      // 才不可能跑偏，缩略图就是当前页的等比缩小版。
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawPageContent(ctx, shown, format, DPI, assets);
    })();
  }, [page, format, active, scale]);

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

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      className={`relative group cursor-pointer rounded-md overflow-hidden border-2 transition-all ${
        active ? 'border-amber-600 shadow-md left-thumb-active' : 'border-transparent hover:border-gray-300'
      } ${isDragOver ? 'border-blue-500 border-t-4' : ''}`}
    >
      {/* 比例跟页面走，非 A5 的相册也不会被拉伸 */}
      <div className="bg-white" style={{ aspectRatio: `${format.width} / ${format.height}` }}>
        <canvas ref={canvasRef} width={thumbWidth} height={thumbHeight} className="w-full h-full" />
      </div>
      <div className={`absolute bottom-0 left-0 right-0 px-2 py-1 text-xs ${
        active ? 'bg-amber-600 text-white' : 'bg-black/40 text-white opacity-0 group-hover:opacity-100'
      }`}>
        第 {index + 1} 页
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-1 right-1 w-5 h-5 bg-black/50 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all flex items-center justify-center"
      >
        ×
      </button>

      {/* 右键菜单 */}
      {menuOpen && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-2 w-fit"
          style={{ left: menuPos.x, top: menuPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onAddPageBefore(); setMenuOpen(false); }}
            className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap"
          >
            ⬆️ 在上方新建一页
          </button>
          <button
            onClick={() => { onAddPageAfter(); setMenuOpen(false); }}
            className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap"
          >
            ⬇️ 在下方新建一页
          </button>
        </div>
      )}
    </div>
  );
}
