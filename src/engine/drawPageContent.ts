import type { Page, Element, BookFormat, ImageElement, TextElement, StickerElement, ShapeElement } from '@/types';
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

  // 胶卷孔填这个色（图片背景没有颜色可填，退白）；不能挖透明——JPEG 导出会变黑孔
  const pageBgColor = page.background.type === 'color' ? page.background.value : '#ffffff';

  // 按 zIndex 排序后绘制元素
  const elements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);
  for (const el of elements) {
    drawElement(ctx, el, dpi, assets, pageBgColor);
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
  assets: Map<string, HTMLImageElement>,
  pageBgColor: string
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
    drawImageElement(ctx, el, dpi, assets, pageBgColor);
  } else if (el.type === 'text') {
    drawTextElement(ctx, el, dpi);
  } else if (el.type === 'sticker') {
    drawStickerElement(ctx, el, dpi, assets);
  } else if (el.type === 'shape') {
    drawShapeElement(ctx, el, dpi);
  }

  ctx.restore();
}

/** 胶卷选区：上下黑边各占元素高度的比例 */
const FILM_STRIP_RATIO = 0.12;
/** 卡片选区：左右留白占宽度的比例 */
const CARD_MARGIN_X = 0.04;
/** 卡片选区：上留白占高度的比例 */
const CARD_MARGIN_TOP = 0.03;
/** 卡片选区：下留白（照片底边到波浪基线）占宽度的比例（参考图下边留得最大） */
const CARD_MARGIN_BOTTOM = 0.16;
/** 卡片选区：波浪振幅占宽度的比例 */
const CARD_WAVE_AMP = 0.02;

/**
 * 图片元素里照片实际占的区域（相对元素左上角，mm）。
 * 邮票照片顶到齿孔=整个元素；胶卷只占中间带；卡片四周留白。
 * 渲染（drawImageElement）和裁剪弹窗（ImageCropper 取景框）共用这一份。
 */
export function elementPhotoArea(el: ImageElement): { x: number; y: number; width: number; height: number } {
  if (el.filmEdge) {
    const strip = el.height * FILM_STRIP_RATIO;
    return { x: 0, y: strip, width: el.width, height: el.height - strip * 2 };
  }
  if (el.cardEdge) {
    const marginX = el.width * CARD_MARGIN_X;
    const top = el.height * CARD_MARGIN_TOP;
    const bottom = el.width * CARD_MARGIN_BOTTOM + el.width * CARD_WAVE_AMP;
    return { x: marginX, y: top, width: el.width - marginX * 2, height: el.height - top - bottom };
  }
  return { x: 0, y: 0, width: el.width, height: el.height };
}

/** 绘制图片元素 */
function drawImageElement(
  ctx: CanvasRenderingContext2D,
  el: ImageElement,
  dpi: number,
  assets: Map<string, HTMLImageElement>,
  pageBgColor: string
) {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);
  const h = mmToPx(el.height, dpi);

  // 卡片选区：白卡片（带投影）+ 底部贝壳波浪，照片在四周留白里
  if (el.cardEdge) {
    drawCard(ctx, x, y, w, h);
  } else if (el.filmEdge) {
    // 胶卷选区：上下黑边 + 白孔
    drawFilmStrips(ctx, x, y, w, h, h * FILM_STRIP_RATIO, pageBgColor);
  }

  // 照片画在照片区（邮票 = 整个元素；胶卷/卡片 = 各自的照片区）
  const area = elementPhotoArea(el);
  const photoX = x + mmToPx(area.x, dpi);
  const photoY = y + mmToPx(area.y, dpi);
  const photoW = mmToPx(area.width, dpi);
  const photoH = mmToPx(area.height, dpi);

  // 邮票照片选区：四边齿孔往里凹，照片直接顶到齿孔
  // 圆形选区：正圆（内切于元素，直径 = 短边），照片裁进圆里
  ctx.save();
  if (el.stampEdge) {
    buildStampPath(ctx, x, y, w, h);
    ctx.clip();
  } else if (el.circleEdge) {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.clip();
  }

  const img = assets.get(el.imageId);
  if (img) {
    // cover 模式裁剪：保持比例，居中裁剪，不变形
    const crop = computeCoverCrop(img.width, img.height, photoW, photoH, el.crop);
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, photoX, photoY, photoW, photoH);
  } else {
    // 占位（画在照片区里）
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(photoX, photoY, photoW, photoH);
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('图片加载中...', photoX + photoW / 2, photoY + photoH / 2);
  }

  ctx.restore();
}

/**
 * 卡片选区：白卡片 + 底部贝壳波浪（浅弧，参考图：周期 ≈ 宽 0.176、振幅 ≈ 宽 0.02）
 * + 柔光投影（canvas shadow，跟着波浪走，不需要手工画阴影）。
 */
function drawCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const amp = w * CARD_WAVE_AMP;
  // 波浪密度：周期 = 宽 0.088（参考图 0.176 的两倍密度，她说要更密集）
  const n = Math.max(2, Math.round(w / (w * 0.088)));
  const period = w / n;
  const cuspY = y + h - amp;

  ctx.save();
  // 柔光投影：比参考图收一点，offset 向下一点显得立体
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = w * 0.06;
  ctx.shadowOffsetX = w * 0.01;
  ctx.shadowOffsetY = w * 0.03;
  ctx.fillStyle = '#ffffff';

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, cuspY);
  // 下边波浪：从右下往左下，每个贝壳一个 quadratic（控制点深度 2A → 顶点深度 A）
  for (let i = n - 1; i >= 0; i--) {
    const cx = x + (i + 0.5) * period;
    const rightCusp = x + (i + 1) * period;
    ctx.lineTo(rightCusp, cuspY);
    ctx.quadraticCurveTo(cx, cuspY + amp * 2, rightCusp - period, cuspY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 胶卷上下黑边 + 白孔。孔的比例取自参考图（孔宽 = 孔高 × 1.43、孔距 = 孔宽 × 1.7、
 * 角留白 = 孔宽 × 1.07）。孔填页面背景色而不是挖透明——预览页/图片导出把页面
 * 压成 JPEG，透明孔会变成黑孔（JPEG 没有透明通道）。
 */
function drawFilmStrips(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  strip: number,
  pageBgColor: string
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, strip);
  ctx.fillRect(x, y + h - strip, w, strip);

  const holeH = strip * 0.55;
  const holeW = holeH * 1.43;
  const period = holeW * 1.7;
  const margin = holeW * 1.07;
  const radius = holeH * 0.2;
  const count = Math.max(2, Math.round((w - 2 * margin) / period) + 1);
  const actualPeriod = (w - 2 * margin) / (count - 1);

  ctx.fillStyle = pageBgColor;
  for (let i = 0; i < count; i++) {
    const cx = x + margin + i * actualPeriod;
    for (const cy of [y + strip / 2, y + h - strip / 2]) {
      roundRectPath(ctx, cx - holeW / 2, cy - holeH / 2, holeW, holeH, radius);
      ctx.fill();
    }
  }
}

/** 圆角矩形路径 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * 四边半圆齿孔的邮票路径：齿孔往内凹，齿孔之间留平直边，四个角也留平直边
 * （角上的横边留白 : 竖边留白 = 1 : 2，参考图里竖边确实比横边留得多）。
 * 尺寸按元素短边比例算，缩放时自动跟着变。
 */
function buildStampPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const minSide = Math.min(w, h);
  const holeR = minSide * 0.026;   // 齿孔半径（参考图 25px / 950px）
  const refSpacing = minSide * 0.082; // 齿孔中心距参考值（参考图 78px / 950px）
  const cornerH = minSide * 0.025; // 横边角的平直留白（参考图 24px / 950px）
  const cornerV = cornerH * 2;     // 竖边角的平直留白 = 横边 2 倍（横竖 1:2）
  // 每条边去掉两角留白后，按参考间距排齿孔；齿孔再均匀铺满两角之间
  const nx = Math.max(2, Math.round((w - 2 * (cornerH + holeR)) / refSpacing + 1)); // 上下边
  const ny = Math.max(2, Math.round((h - 2 * (cornerV + holeR)) / refSpacing + 1)); // 左右边
  const dx = (w - 2 * (cornerH + holeR)) / (nx - 1);
  const dy = (h - 2 * (cornerV + holeR)) / (ny - 1);

  ctx.beginPath();
  // 四边齿孔都用 ccw=true（角度递减）：弧的起终点必须顺着路径的行进方向，
  // 齿孔才被 nonzero 填充规则算在图形外面。起终点反了的话，齿孔区域会被填实。
  // 路径必须从角落点开始——不然 closePath 会从最后一个齿孔斜着连回起点，切掉角落。
  ctx.moveTo(x, y);
  // 上边：从左到右，齿孔往下凹
  for (let i = 0; i < nx; i++) {
    const cx = x + cornerH + holeR + i * dx;
    ctx.lineTo(cx - holeR, y);
    ctx.arc(cx, y, holeR, Math.PI, 0, true);
  }
  ctx.lineTo(x + w, y);
  // 右边：从上到下，齿孔往左凹
  for (let i = 0; i < ny; i++) {
    const cy = y + cornerV + holeR + i * dy;
    ctx.lineTo(x + w, cy - holeR);
    ctx.arc(x + w, cy, holeR, -Math.PI / 2, Math.PI / 2, true);
  }
  ctx.lineTo(x + w, y + h);
  // 下边：从右到左，齿孔往上凹
  for (let i = 0; i < nx; i++) {
    const cx = x + w - cornerH - holeR - i * dx;
    ctx.lineTo(cx + holeR, y + h);
    ctx.arc(cx, y + h, holeR, 0, Math.PI, true);
  }
  ctx.lineTo(x, y + h);
  // 左边：从下到上，齿孔往右凹
  for (let i = 0; i < ny; i++) {
    const cy = y + h - cornerV - holeR - i * dy;
    ctx.lineTo(x, cy + holeR);
    ctx.arc(x, cy, holeR, Math.PI / 2, -Math.PI / 2, true);
  }
  ctx.closePath();
}

/** 绘制形状/选区元素 */
function drawShapeElement(ctx: CanvasRenderingContext2D, el: ShapeElement, dpi: number) {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);
  const h = mmToPx(el.height, dpi);
  const radius = el.borderRadius ? mmToPx(el.borderRadius, dpi) : 0;

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;

  // 绘制圆角矩形路径
  if (radius > 0) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  } else {
    ctx.beginPath(); // 必须开始新路径，否则会累积前面元素的路径，导致fill填充所有矩形
    ctx.rect(x, y, w, h);
  }

  // 填充背景色
  if (el.backgroundColor) {
    ctx.fillStyle = el.backgroundColor;
    ctx.fill();
  }

  // 绘制边框
  if (el.borderColor && el.borderWidth && el.borderWidth > 0) {
    ctx.strokeStyle = el.borderColor;
    ctx.lineWidth = mmToPx(el.borderWidth, dpi);
    ctx.stroke();
  }

  ctx.restore();
}

/** 绘制文字元素（自动换行） */
function drawTextElement(ctx: CanvasRenderingContext2D, el: TextElement, dpi: number) {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);

  // 字体大小按 DPI 缩放（基准是 96 DPI）
  const fontSize = el.fontSize * (dpi / 96);
  const lineHeightPx = fontSize * el.lineHeight;

  // 背景色（可无）：每行文字后面一条底色——长行色条长、短行色条短，
  // 居中/居右的行色条跟着文字走。左右各留一点边距，字不贴色条边；
  // 上下按「行高比字多出来的部分两边各分一半」让字在色条里居中，
  // 这样相邻两行的色条正好首尾相接，多行看起来是连着的一片。
  const bg = el.backgroundColor;
  const bgPadX = fontSize * 0.2;
  const bgOffsetY = (lineHeightPx - fontSize) / 2;

  ctx.fillStyle = el.color;
  const weight = el.fontWeight || 'normal';
  ctx.font = `${weight} ${fontSize}px ${el.fontFamily}`;
  ctx.textAlign = el.textAlign;
  ctx.textBaseline = 'top';

  let startY = y;

  // 画一行（先底色、后文字），并把光标准备到下一行
  const flushLine = (line: string) => {
    if (bg) {
      const lineW = ctx.measureText(line).width;
      const lineX = alignStartX(el.textAlign, x, w, lineW);
      ctx.fillStyle = bg;
      ctx.fillRect(lineX - bgPadX, startY - bgOffsetY, lineW + bgPadX * 2, lineHeightPx);
      ctx.fillStyle = el.color;
    }
    drawLine(ctx, line, x, startY, w, el.textAlign);
    startY += lineHeightPx;
  };

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
        flushLine(currentLine);
        currentLine = words[i];
      } else {
        currentLine = testLine;
      }
    }

    // 画最后一行
    if (currentLine) {
      flushLine(currentLine);
    }
  }
}

/** 一行文字的起始 x（按对齐方式算，色条就画在这个位置） */
function alignStartX(align: string, x: number, w: number, lineWidth: number): number {
  if (align === 'center') return x + (w - lineWidth) / 2;
  if (align === 'right') return x + w - lineWidth;
  return x;
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
