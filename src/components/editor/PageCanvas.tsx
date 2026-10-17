import { useEffect, useRef } from 'react';
import type { Page, BookFormat } from '@/types';
import { mmToPx } from '@/utils/units';
import { getImageAsset } from '@/utils/assetStore';
import { getImageURL } from '@/utils/image';
import { drawPageContent } from '@/engine/drawPageContent';
import { ensureFontsLoaded } from '@/utils/fonts';

/** 和主画布同一个 dpi。缩略图不另算字号，靠整体缩放，所以这个值只用来推画布高度 */
const DPI = 96;

interface Props {
  page: Page;
  format: BookFormat;
  /** 画布内部宽度（px），高度按页面比例推出来 */
  width: number;
  /**
   * 当前跨页：冻结一份快照，编辑期间不跟着重画。
   * 拖拽时 page 每秒要变几十次，跟着重画既费资源（反复读 IndexedDB 里的图片），
   * 画面也会因为异步图片乱序落地而叠影。切走之后才用最终状态重画一次。
   */
  frozen?: boolean;
}

/**
 * 一页的缩略图画布。必须每页一个独立 canvas —— 试过一个 canvas 里
 * translate 画两页，右页的逻辑宽度会算成负数，背景直接画不出来。
 */
export default function PageCanvas({ page, format, width, frozen = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 冻结快照 */
  const frozenRef = useRef<Page | null>(null);
  /** 上次画过的是哪份数据，没变就直接跳过 */
  const lastDrawnRef = useRef<Page | null>(null);
  /** 绘制序号：只有最新一轮有资格落笔，防止旧画面补画到新画布上 */
  const drawIdRef = useRef(0);

  // 横纵共用一个缩放比例，保证等比
  const scale = width / mmToPx(format.width, DPI);
  const height = Math.round(mmToPx(format.height, DPI) * scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let shown: Page;
    if (frozen) {
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

      // 艺术字体没就绪就落笔的话，canvas 会拿系统字体顶替，而且不会自动重画。
      // document.fonts.load 对系统字体立即 resolve，不会拖慢普通页面。
      await ensureFontsLoaded([shown]);

      // 已经有更新的一轮绘制接管了，这一轮的画面作废
      if (drawIdRef.current !== myId) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 整体等比缩小，而不是按缩略图尺寸把字号和坐标重算一遍：
      // 喂给 drawPageContent 的数字和主画布逐字相同，折行点、旋转、cover 裁剪
      // 才不可能跑偏，缩略图就是那一页的等比缩小版。
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawPageContent(ctx, shown, format, DPI, assets);
    })();
  }, [page, format, frozen, scale]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
