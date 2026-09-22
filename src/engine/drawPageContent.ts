import type { Page, Element, BookFormat, ImageElement, TextElement, StickerElement } from '@/types';
import { mmToPx } from '@/utils/units';
import { computeCoverCrop } from '@/utils/image';

/**
 * 把一页的内容（背景 + 全部元素）画到 ctx 上。
 *
 * 全站只有这一份页面绘制规则：编辑器主画布（CanvasRenderer）和左侧书页缩略图
 * （PageThumbnail）都调它。之前两边各写一套，结果缩略图漏了旋转、漏了 cover 裁剪、
 * 漏了透明度，用户看到的就是"封面照片被拉扁""书脊上的字母方向不对"。
 *
 * ctx 的变换由调用方负责：
 * - 主画布：1:1，dpi 一般 96
 * - 缩略图：先 `ctx.setTransform(scale, 0, 0, scale, 0, 0)` 再调，dpi 仍传 96。
 *   这样喂进来的坐标和字号跟主画布逐字相同，折行点、旋转、裁剪都不可能跑偏，
 *   最后只是整体等比缩小。
 *
 * @param assets 已解码的图片，key 是 imageId / stickerId
 */
export function drawPageContent(
  ctx: CanvasRenderingContext2D,
  page: Page,
  format: BookFormat,
  dpi: number,
  assets: Map<string, HTMLImageElement>
): void {
  const { w, h } = logicalCanvasSize(ctx, format, dpi);

  ctx.clearRect(0, 0, w, h);

  // 背景
  if (page.background.type === 'color') {
    ctx.fillStyle = page.background.value;
    ctx.fillRect(0, 0, w, h);
  }

  // 按 zIndex 排序后绘制元素
  const elements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);
  for (const el of elements) {
    drawElement(ctx, el, dpi, assets);
  }
}

/**
 * 收集这批页面会用到的全部图片资源 id（图片元素、贴纸、以及图片背景）。
 *
 * 归在这里，是因为它和"怎么画"本来就是同一件事的两面：drawElement 按 id 从 assets
 * 里取图，能取到哪些 id 取决于这里收得全不全。分成两份写的话，将来加了新的元素类型
 * 总有一边会漏，症状是页面上某一块永远空白 —— 预览提速那次就是踩了这个（当时
 * Viewer 自己抄了一份绘制逻辑，漏了旋转和 cover 裁剪）。
 */
export function collectAssetIds(pages: Page[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    // 图片背景现在没人会创建，但类型允许，先认上；value 万一是 dataURL 就别当 id 查
    if (page.background.type === 'image' && !page.background.value.startsWith('data:')) {
      ids.add(page.background.value);
    }
    for (const el of page.elements) {
      if (el.type === 'image') ids.add(el.imageId);
      else if (el.type === 'sticker') ids.add(el.stickerId);
    }
  }
  return ids;
}

/**
 * 把画布尺寸换算回「当前变换下」的逻辑尺寸，用来铺满背景。
 *
 * 直接用 mmToPx(format.width) 是不行的：148mm 在 96dpi 下是 559.37px，而画布宽度
 * 只有 559，多出来的 0.37 会让最后一行像素只覆盖 75%，渲染成半透明的一条边。
 * 向上取整后，主画布上正好是 559×794，缩略图上也能铺满（缩略图是整体缩放的，
 * 画布高度是 round 出来的，差的那零点几像素会留一条透明缝）。
 */
function logicalCanvasSize(ctx: CanvasRenderingContext2D, format: BookFormat, dpi: number) {
  const m = ctx.getTransform();
  // 变换异常时退回页面物理尺寸，总比不画背景强
  const w = m.a > 0 ? Math.ceil((ctx.canvas.width - m.e) / m.a) : mmToPx(format.width, dpi);
  const h = m.d > 0 ? Math.ceil((ctx.canvas.height - m.f) / m.d) : mmToPx(format.height, dpi);
  return { w, h };
}

/** 绘制单个元素 */
function drawElement(
  ctx: CanvasRenderingContext2D,
  el: Element,
  dpi: number,
  assets: Map<string, HTMLImageElement>
) {
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;

  // 平移到元素中心进行旋转
  const cx = mmToPx(el.x + el.width / 2, dpi);
  const cy = mmToPx(el.y + el.height / 2, dpi);
  ctx.translate(cx, cy);
  ctx.rotate(((el.rotation ?? 0) * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  if (el.type === 'image') {
    drawImageElement(ctx, el, dpi, assets);
  } else if (el.type === 'text') {
    drawTextElement(ctx, el, dpi);
  } else if (el.type === 'sticker') {
    drawStickerElement(ctx, el, dpi, assets);
  }

  ctx.restore();
}

/** 绘制图片元素 */
function drawImageElement(
  ctx: CanvasRenderingContext2D,
  el: ImageElement,
  dpi: number,
  assets: Map<string, HTMLImageElement>
) {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);
  const h = mmToPx(el.height, dpi);

  const img = assets.get(el.imageId);
  if (img) {
    // cover 模式裁剪：保持比例，居中裁剪，不变形
    const crop = computeCoverCrop(img.width, img.height, w, h, el.crop);
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, x, y, w, h);
  } else {
    // 占位
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('图片加载中...', x + w / 2, y + h / 2);
  }
}

/** 绘制文字元素（自动换行） */
function drawTextElement(ctx: CanvasRenderingContext2D, el: TextElement, dpi: number) {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);

  // 字体大小按 DPI 缩放（基准是 96 DPI）
  const fontSize = el.fontSize * (dpi / 96);
  const lineHeightPx = fontSize * el.lineHeight;

  ctx.fillStyle = el.color;
  const weight = el.fontWeight || 'normal';
  ctx.font = `${weight} ${fontSize}px ${el.fontFamily}`;
  ctx.textAlign = el.textAlign;
  ctx.textBaseline = 'top';

  let startY = y;

  // 自动换行：先按段落分割，再逐字测量宽度
  const paragraphs = el.content.split('\n');
  for (const paragraph of paragraphs) {
    const words = paragraph.split('');
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const testLine = currentLine + words[i];
      const metrics = ctx.measureText(testLine);

      if (metrics.width > w && currentLine !== '') {
        // 当前行放不下，换行
        drawLine(ctx, currentLine, x, startY, w, el.textAlign);
        startY += lineHeightPx;
        currentLine = words[i];
      } else {
        currentLine = testLine;
      }
    }

    // 画最后一行
    if (currentLine) {
      drawLine(ctx, currentLine, x, startY, w, el.textAlign);
      startY += lineHeightPx;
    }
  }
}

/** 画一行文字（根据对齐方式计算 x） */
function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  align: string
) {
  let tx = x;
  if (align === 'center') tx = x + w / 2;
  if (align === 'right') tx = x + w;
  ctx.fillText(text, tx, y);
}

/** 绘制贴纸元素 */
function drawStickerElement(
  ctx: CanvasRenderingContext2D,
  el: StickerElement,
  dpi: number,
  assets: Map<string, HTMLImageElement>
) {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);
  const h = mmToPx(el.height, dpi);

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;

  // 根据不同的贴纸类型画不同的样式
  switch (el.stickerId) {
    case 'bubble-round': {
      // 圆角对话气泡
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 2;
      const radius = 8;
      // 画圆角矩形
      ctx.beginPath();
      ctx.roundRect(x, y, w, h - 10, radius);
      ctx.fill();
      ctx.stroke();
      // 画小尾巴
      ctx.beginPath();
      ctx.moveTo(x + 20, y + h - 10);
      ctx.lineTo(x + 35, y + h);
      ctx.lineTo(x + 45, y + h - 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'bubble-thought': {
      // 思考气泡
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 2;
      const radius = h / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fill();
      ctx.stroke();
      // 画小圆圈
      ctx.beginPath();
      ctx.arc(x + 20, y + h + 6, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 30, y + h + 14, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'tag': {
      // 标签
      ctx.fillStyle = '#fff9e6';
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 2;
      // 画带缺口的标签形状
      ctx.beginPath();
      ctx.moveTo(x + 20, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + 20, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 画小孔
      ctx.beginPath();
      ctx.arc(x + 10, y + h / 2, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#333333';
      ctx.fill();
      break;
    }
    case 'note': {
      // 便签
      ctx.fillStyle = '#fffbe6';
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 2;
      // 画便签形状（右上角折角）
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - 15, y);
      ctx.lineTo(x + w, y + 15);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 画折角
      ctx.beginPath();
      ctx.moveTo(x + w - 15, y);
      ctx.lineTo(x + w - 15, y + 15);
      ctx.lineTo(x + w, y + 15);
      ctx.closePath();
      ctx.fillStyle = '#e6e2d3';
      ctx.fill();
      break;
    }
    case 'date-line': {
      // 日期横线样式
      ctx.fillStyle = '#666666';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(new Date().getFullYear() + '.' + (new Date().getMonth() + 1) + '.' + new Date().getDate(), x + w / 2, y + h / 2);
      // 画上下两条线
      ctx.strokeStyle = '#999999';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x + w, y + 2);
      ctx.moveTo(x, y + h - 2);
      ctx.lineTo(x + w, y + h - 2);
      ctx.stroke();
      break;
    }
    case 'date-circle': {
      // 圆形日期
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2 - 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#666666';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(new Date().getMonth() + 1 + '/' + new Date().getDate(), x + w / 2, y + h / 2);
      break;
    }
    default: {
      // 默认：灰色矩形占位
      ctx.fillStyle = 'rgba(200, 200, 255, 0.3)';
      ctx.fillRect(x, y, w, h);
    }
  }

  ctx.restore();
}
