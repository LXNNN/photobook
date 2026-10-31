import type { Page, Element, BookFormat, ImageElement, TextElement, StickerElement, ShapeElement } from '@/types';
import { mmToPx } from '@/utils/units';
import { computeCoverCrop } from '@/utils/image';

/** 静态资源图片缓存（模块级，避免重复加载） */
const staticImageCache = new Map<string, HTMLImageElement>();

/** 获取或加载静态资源图片（URL形式，如import得到的打包后路径） */
function getOrLoadStaticImage(url: string): HTMLImageElement | undefined {
  let img = staticImageCache.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => window.dispatchEvent(new CustomEvent('static-image-loaded'));
    img.src = url;
    staticImageCache.set(url, img);
  } else if (!img.complete) {
    // 已有缓存但未加载完，补一次重绘通知
    img.onload = () => window.dispatchEvent(new CustomEvent('static-image-loaded'));
  }
  return img;
}

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
  const w = Math.ceil(mmToPx(format.width, dpi));
  const h = Math.ceil(mmToPx(format.height, dpi));

  ctx.clearRect(0, 0, w, h);

  // 背景
  if (page.background.type === 'color') {
    ctx.fillStyle = page.background.value;
    ctx.fillRect(0, 0, w, h);
  } else if (page.background.type === 'image') {
    let bgImg = assets.get(page.background.value);
    if (!bgImg) {
      // 静态资源URL：直接加载并缓存到模块级Map
      bgImg = getOrLoadStaticImage(page.background.value);
    }
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      const crop = computeCoverCrop(bgImg.naturalWidth, bgImg.naturalHeight, w, h);
      ctx.drawImage(bgImg, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    }
  }

  // 胶卷孔填这个色（图片背景没有颜色可填，退白）；不能挖透明——JPEG 导出会变黑孔
  const pageBgColor = page.background.type === 'color' ? page.background.value : '#ffffff';

  // 页面级手绘装饰（不是元素，直接画在背景上，层级低于所有元素）
  if (page.doodle) {
    if (page.doodle.type === 'clothesline') {
      drawClothesline(ctx, page.doodle, format, dpi);
    } else if (page.doodle.path && page.doodle.path.length >= 2) {
      drawPageDoodle(ctx, page.doodle, format, dpi);
    }
  }

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
    // 图片背景：静态资源URL（以/开头）不加入assets，直接绘制时加载；dataURL也不当id查
    if (page.background.type === 'image' && !page.background.value.startsWith('data:') && !page.background.value.startsWith('/')) {
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
/** 胶卷选区：左右黑色边框宽度（mm，约2px@96dpi） */
const FILM_SIDE_BORDER_MM = 0.53;
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
    // 左右边框独立控制：filmLeftEdge/filmRightEdge，兼容旧的 filmSideEdge 总开关
    const left = (el.filmLeftEdge ?? el.filmSideEdge ?? true) ? FILM_SIDE_BORDER_MM : 0;
    const right = (el.filmRightEdge ?? el.filmSideEdge ?? true) ? FILM_SIDE_BORDER_MM : 0;
    return { x: left, y: strip, width: el.width - left - right, height: el.height - strip * 2 };
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
    // 胶卷选区：上下黑边 + 白孔 + 左右黑边（独立控制）
    const leftPx = (el.filmLeftEdge ?? el.filmSideEdge ?? true) ? mmToPx(FILM_SIDE_BORDER_MM, dpi) : 0;
    const rightPx = (el.filmRightEdge ?? el.filmSideEdge ?? true) ? mmToPx(FILM_SIDE_BORDER_MM, dpi) : 0;
    drawFilmStrips(ctx, x, y, w, h, h * FILM_STRIP_RATIO, leftPx, rightPx, pageBgColor);
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

  // 照片选区边框（普通矩形/圆形，胶卷邮票等特殊选区不画）
  if (el.borderWidth && el.borderWidth > 0 && !el.filmEdge && !el.stampEdge) {
    ctx.save();
    ctx.strokeStyle = el.borderColor || '#000000';
    ctx.lineWidth = mmToPx(el.borderWidth, dpi);
    if (el.circleEdge) {
      // 圆形选区：圆形边框
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 普通矩形选区：矩形边框
      ctx.strokeRect(x, y, w, h);
    }
    ctx.restore();
  }
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
  leftBorder: number,
  rightBorder: number,
  pageBgColor: string
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, strip);
  ctx.fillRect(x, y + h - strip, w, strip);
  // 左右黑色边框（独立控制，0表示不绘制）
  if (leftBorder > 0) ctx.fillRect(x, y, leftBorder, h);
  if (rightBorder > 0) ctx.fillRect(x + w - rightBorder, y, rightBorder, h);

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
/**
 * 手绘时钟：12个刻度 + 时针/分针/秒针 + 中心圆点
 * 指针固定为参考图样式：时针10点、分针2点、秒针6点
 */
function drawClock(ctx: CanvasRenderingContext2D, el: ShapeElement, dpi: number): void {
  const cx = mmToPx(el.x + el.width / 2, dpi);
  const cy = mmToPx(el.y + el.height / 2, dpi);
  const r = Math.min(mmToPx(el.width, dpi), mmToPx(el.height, dpi)) / 2 * 0.75;

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.strokeStyle = '#333333';
  ctx.lineCap = 'round';

  // 12个刻度
  ctx.lineWidth = Math.max(2, r * 0.04);
  for (let i = 0; i < 12; i++) {
    const angle = (-90 + i * 30) * Math.PI / 180;
    const inner = r * 0.82;
    const outer = r * 0.95;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }

  // 时针（10点方向，粗短）
  ctx.lineWidth = Math.max(3, r * 0.06);
  const hourAngle = (-90 + 10 * 30) * Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(hourAngle) * r * 0.5, cy + Math.sin(hourAngle) * r * 0.5);
  ctx.stroke();

  // 分针（2点方向，中长）
  ctx.lineWidth = Math.max(2, r * 0.045);
  const minAngle = (-90 + 2 * 30) * Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(minAngle) * r * 0.7, cy + Math.sin(minAngle) * r * 0.7);
  ctx.stroke();

  // 秒针（6点方向，细长）
  ctx.lineWidth = Math.max(1.5, r * 0.025);
  const secAngle = (-90 + 6 * 30) * Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(secAngle) * r * 0.82, cy + Math.sin(secAngle) * r * 0.82);
  ctx.stroke();

  // 中心圆点
  ctx.fillStyle = '#333333';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(3, r * 0.05), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * 手撕纸条：暖色背景 + 四周手撕不规则边缘 + 底部手绘下划线
 */
function drawTornPaper(ctx: CanvasRenderingContext2D, el: ShapeElement, dpi: number): void {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);
  const h = mmToPx(el.height, dpi);
  const tear = Math.max(2, h * 0.04); // 手撕边缘振幅

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;

  // 构建手撕边缘路径（用正弦波叠加模拟不规则撕纸效果）
  ctx.beginPath();
  const steps = 40;
  // 上边（从左到右）
  ctx.moveTo(x, y + tear * 0.5);
  for (let i = 0; i <= steps; i++) {
    const px = x + (w * i / steps);
    const py = y + tear * 0.5 + Math.sin(i * 0.8) * tear * 0.4 + Math.sin(i * 2.1) * tear * 0.2;
    ctx.lineTo(px, py);
  }
  // 右边（从上到下）
  for (let i = 0; i <= steps; i++) {
    const px = x + w - tear * 0.3 + Math.sin(i * 1.2) * tear * 0.3 + Math.sin(i * 2.5) * tear * 0.15;
    const py = y + (h * i / steps);
    ctx.lineTo(px, py);
  }
  // 下边（从右到左）
  for (let i = steps; i >= 0; i--) {
    const px = x + (w * i / steps);
    const py = y + h - tear * 0.4 + Math.sin(i * 0.9 + 1) * tear * 0.35 + Math.sin(i * 1.8) * tear * 0.2;
    ctx.lineTo(px, py);
  }
  // 左边（从下到上）
  for (let i = steps; i >= 0; i--) {
    const px = x + tear * 0.3 + Math.sin(i * 1.1 + 2) * tear * 0.3 + Math.sin(i * 2.3) * tear * 0.15;
    const py = y + (h * i / steps);
    ctx.lineTo(px, py);
  }
  ctx.closePath();

  // 填充暖色背景（用元素背景色，默认暖米色）
  ctx.fillStyle = el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : '#f5f0e8';
  ctx.fill();

  // 底部手绘下划线（深色，略微弯曲，有手绘感）
  const lineY = y + h * 0.78;
  ctx.strokeStyle = '#4a3f35';
  ctx.lineWidth = Math.max(1.5, h * 0.025);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.08, lineY);
  // 用二次贝塞尔曲线模拟手绘弯曲
  ctx.quadraticCurveTo(x + w * 0.4, lineY - h * 0.02, x + w * 0.7, lineY + h * 0.01);
  ctx.quadraticCurveTo(x + w * 0.85, lineY + h * 0.02, x + w * 0.92, lineY - h * 0.005);
  ctx.stroke();

  ctx.restore();
}

/**
 * 页面级手绘连线：自然手绘风格
 * - 3次描边，每次有轻微偏移，模拟"多描几下"
 * - 每段线条粗细不均匀（0.5-1.5倍变化）
 * - 路径点带伪随机抖动
 */
function drawPageDoodle(
  ctx: CanvasRenderingContext2D,
  doodle: { path?: { x: number; y: number }[]; color?: string; width?: number },
  format: BookFormat,
  dpi: number
): void {
  const points = doodle.path;
  if (!points || points.length < 2) return;

  const pageW = mmToPx(format.width, dpi);
  const pageH = mmToPx(format.height, dpi);
  const color = doodle.color || '#c8c4bc';
  const baseWidth = mmToPx(doodle.width ?? 0.4, dpi);

  // 转换路径点为像素坐标
  const pts = points.map(p => ({ x: p.x * pageW, y: p.y * pageH }));

  // 生成带抖动和粗细变化的详细路径
  function generatePath(seedOffset: number): { x: number; y: number; w: number }[] {
    const path: { x: number; y: number; w: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const segments = 14;
      for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        let x = p0.x + (p1.x - p0.x) * t;
        let y = p0.y + (p1.y - p0.y) * t;
        // 端点不抖动，中间点加伪随机偏移
        if (j > 0 && j < segments) {
          const seed1 = Math.sin((i + seedOffset) * 12.9898 + j * 78.233) * 43758.5453;
          const seed2 = Math.sin((i + seedOffset) * 4.123 + j * 9.456) * 23421.631;
          const jitterX = (seed1 - Math.floor(seed1) - 0.5) * baseWidth * 4;
          const jitterY = (seed2 - Math.floor(seed2) - 0.5) * baseWidth * 4;
          x += jitterX;
          y += jitterY;
        }
        // 粗细变化（0.5-1.5倍）
        const widthSeed = Math.sin((i + seedOffset) * 7.123 + j * 3.456) * 12345.678;
        const widthRatio = 0.5 + (widthSeed - Math.floor(widthSeed)) * 1.0;
        path.push({ x, y, w: baseWidth * widthRatio });
      }
    }
    return path;
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;

  // 3次描边，每次有不同的偏移、透明度和粗细，模拟手绘多描
  const passes = [
    { offset: 0, alpha: 0.55, widthScale: 1.0 },
    { offset: 50, alpha: 0.35, widthScale: 0.7 },
    { offset: 120, alpha: 0.25, widthScale: 1.3 },
  ];

  for (const pass of passes) {
    const path = generatePath(pass.offset);
    ctx.globalAlpha = pass.alpha;
    // 分段绘制，每段有不同的粗细
    for (let i = 0; i < path.length - 1; i++) {
      const p0 = path[i];
      const p1 = path[i + 1];
      ctx.lineWidth = (p0.w + p1.w) / 2 * pass.widthScale;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * 手绘晾衣架装饰：弧线+晾衣架+四条挂线
 */
function drawClothesline(
  ctx: CanvasRenderingContext2D,
  doodle: {
    path?: { x: number; y: number }[];
    color?: string;
    width?: number;
    hangerX?: number;
    hangerY?: number;
    photoAnchors?: { x: number; y: number }[];
  },
  format: BookFormat,
  dpi: number
): void {
  const pageW = mmToPx(format.width, dpi);
  const pageH = mmToPx(format.height, dpi);
  const color = doodle.color || '#5a5a5a';
  const baseWidth = mmToPx(doodle.width ?? 0.5, dpi);
  const hangerX = (doodle.hangerX ?? 0.2) * pageW;
  const hangerY = (doodle.hangerY ?? 0.3) * pageH;

  // 伪随机工具
  const rand = (seed: number) => {
    const x = Math.sin(seed) * 43758.5453;
    return x - Math.floor(x);
  };

  // 手绘线条绘制函数（带抖动、多描边）
  const drawHandLine = (pts: { x: number; y: number }[], seedOffset: number) => {
    if (pts.length < 2) return;
    const detailed: { x: number; y: number; w: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const segments = 8;
      for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        let x = p0.x + (p1.x - p0.x) * t;
        let y = p0.y + (p1.y - p0.y) * t;
        if (j > 0 && j < segments) {
          x += (rand(i * 12.9 + j * 78.2 + seedOffset) - 0.5) * baseWidth * 3;
          y += (rand(i * 4.1 + j * 9.4 + seedOffset) - 0.5) * baseWidth * 3;
        }
        const wRatio = 0.6 + rand(i * 7.1 + j * 3.4 + seedOffset) * 0.8;
        detailed.push({ x, y, w: baseWidth * wRatio });
      }
    }
    for (let i = 0; i < detailed.length - 1; i++) {
      ctx.lineWidth = (detailed[i].w + detailed[i + 1].w) / 2;
      ctx.beginPath();
      ctx.moveTo(detailed[i].x, detailed[i].y);
      ctx.lineTo(detailed[i + 1].x, detailed[i + 1].y);
      ctx.stroke();
    }
  };

  // 3次描边
  const passes = [
    { alpha: 0.6, widthScale: 1.0, seed: 0 },
    { alpha: 0.35, widthScale: 0.7, seed: 50 },
    { alpha: 0.25, widthScale: 1.3, seed: 120 },
  ];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;

  for (const pass of passes) {
    ctx.globalAlpha = pass.alpha;
    const w = baseWidth * pass.widthScale;
    ctx.lineWidth = w;

    // 1. 左侧弧线
    if (doodle.path && doodle.path.length >= 2) {
      const arcPts = doodle.path.map(p => ({ x: p.x * pageW, y: p.y * pageH }));
      drawHandLine(arcPts, pass.seed);
    }

    // 2. 晾衣架（三角形+挂钩）
    const hangerWidth = mmToPx(35, dpi);
    const hangerHeight = mmToPx(25, dpi);
    // 挂钩（小圆圈）
    ctx.beginPath();
    ctx.arc(hangerX, hangerY - mmToPx(3, dpi), mmToPx(2.5, dpi), 0, Math.PI * 2);
    ctx.stroke();
    // 三角形
    const triTop = { x: hangerX, y: hangerY };
    const triLeft = { x: hangerX - hangerWidth / 2, y: hangerY + hangerHeight };
    const triRight = { x: hangerX + hangerWidth / 2, y: hangerY + hangerHeight };
    drawHandLine([triTop, triLeft], pass.seed + 10);
    drawHandLine([triTop, triRight], pass.seed + 20);
    drawHandLine([triLeft, triRight], pass.seed + 30);

    // 3. 四条挂线（从晾衣架底部到照片）
    if (doodle.photoAnchors && doodle.photoAnchors.length > 0) {
      const bottomY = hangerY + hangerHeight;
      const lineCount = doodle.photoAnchors.length;
      for (let i = 0; i < lineCount; i++) {
        const anchor = doodle.photoAnchors[i];
        const startX = triLeft.x + (triRight.x - triLeft.x) * ((i + 0.5) / lineCount);
        const endX = anchor.x * pageW;
        const endY = anchor.y * pageH;
        drawHandLine([{ x: startX, y: bottomY }, { x: endX, y: endY }], pass.seed + 40 + i * 10);
      }
    }
  }

  ctx.restore();
}

/**
 * 手绘连线（shape元素版本）：用二次贝塞尔曲线连接路径点
 */
function drawDoodleLine(ctx: CanvasRenderingContext2D, el: ShapeElement, dpi: number): void {
  const points = el.doodlePath;
  if (!points || points.length < 2) return;

  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);
  const h = mmToPx(el.height, dpi);

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.strokeStyle = el.doodleColor || '#e74c3c';
  ctx.lineWidth = mmToPx(el.doodleWidth ?? 1.5, dpi);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 转换路径点为像素坐标
  const pts = points.map(p => ({
    px: x + p.x * w,
    py: y + p.y * h,
  }));

  ctx.beginPath();
  ctx.moveTo(pts[0].px, pts[0].py);

  // 用二次贝塞尔曲线连接，控制点稍微偏移模拟手绘
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    // 中点作为控制点，加一点随机抖动（用固定的伪随机，避免每次重绘都变）
    const midX = (p0.px + p1.px) / 2;
    const midY = (p0.py + p1.py) / 2;
    // 基于索引的伪随机偏移
    const jitter = ((i * 37) % 10 - 5) * 0.3;
    ctx.quadraticCurveTo(midX + jitter, midY - jitter, p1.px, p1.py);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * 手绘晾衣架：上方弧线+衣架+四条挂线，单条手绘线（带轻微抖动）
 */
function drawShapeClothesline(ctx: CanvasRenderingContext2D, el: ShapeElement, dpi: number): void {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);
  const h = mmToPx(el.height, dpi);
  const color = el.clotheslineColor || '#999999';
  const lineW = mmToPx(el.clotheslineWidth ?? 0.5, dpi);

  // 伪随机工具（固定种子，每次重绘一致）
  const rand = (seed: number) => {
    const v = Math.sin(seed) * 43758.5453;
    return v - Math.floor(v);
  };

  // 手绘单条线：在两点之间插入中间点带轻微抖动
  const drawHandLine = (p0: { x: number; y: number }, p1: { x: number; y: number }, seed: number) => {
    const segments = 6;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let j = 1; j <= segments; j++) {
      const t = j / segments;
      let px = p0.x + (p1.x - p0.x) * t;
      let py = p0.y + (p1.y - p0.y) * t;
      if (j < segments) {
        px += (rand(seed + j * 1.7) - 0.5) * lineW * 2;
        py += (rand(seed + j * 2.3) - 0.5) * lineW * 2;
      }
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  };

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. 上方弧线（晾衣绳）：#666666，线宽0.5mm（不加粗）
  const arcY = y + h * 0.12 - 12;
  const arcSag = h * 0.06;
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = mmToPx(0.5, dpi);
  ctx.beginPath();
  ctx.moveTo(x, arcY);
  const cpX = x + w / 2;
  const cpY = arcY + arcSag;
  ctx.quadraticCurveTo(cpX, cpY, x + w, arcY);
  ctx.stroke();
  // 恢复线宽为1.0mm（衣架、挂钩、四条线用）
  ctx.lineWidth = lineW;

  // 2. 衣架：#84aadc
  const hangerBottomW = w * 0.65;
  const hangerH = h * 0.15;
  const hangerCenterX = x + w / 2;
  const hangerTopY = arcY + arcSag * 2.2;
  const hangerBottomY = hangerTopY + hangerH;
  const cornerR = lineW * 5;

  const topPoint = { x: hangerCenterX, y: hangerTopY };
  const shoulderLeft = { x: hangerCenterX - hangerBottomW * 0.35, y: hangerTopY + hangerH * 0.45 };
  const shoulderRight = { x: hangerCenterX + hangerBottomW * 0.35, y: hangerTopY + hangerH * 0.45 };
  const bottomLeft = { x: hangerCenterX - hangerBottomW / 2, y: hangerBottomY };
  const bottomRight = { x: hangerCenterX + hangerBottomW / 2, y: hangerBottomY };

  ctx.strokeStyle = '#84aadc';
  ctx.beginPath();
  ctx.moveTo(topPoint.x, topPoint.y);
  ctx.lineTo(shoulderLeft.x, shoulderLeft.y);
  ctx.quadraticCurveTo(bottomLeft.x, shoulderLeft.y + cornerR, bottomLeft.x + cornerR, bottomLeft.y);
  ctx.lineTo(bottomRight.x - cornerR, bottomRight.y);
  ctx.quadraticCurveTo(bottomRight.x, shoulderRight.y + cornerR, shoulderRight.x, shoulderRight.y);
  ctx.lineTo(topPoint.x, topPoint.y);
  ctx.stroke();

  // 挂钩（问号）：#84aadc
  const qH = hangerTopY - arcY;
  const s = qH / 210;
  const dx = hangerCenterX - 217.5 * s;
  const dy = arcY - 80 * s;
  const pt = (px: number, py: number) => ({ x: px * s + dx, y: py * s + dy });

  const start = pt(190, 140);
  const cp1 = pt(170, 85);
  const cp2 = pt(265, 80);
  const mid = pt(255, 130);
  const cp3 = pt(245, 180);
  const cp4 = pt(210, 220);
  const end = pt(200, 290);

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, mid.x, mid.y);
  ctx.bezierCurveTo(cp3.x, cp3.y, cp4.x, cp4.y, end.x, end.y);
  ctx.stroke();

  // 3. 四条挂线：白色，短->长->短->长
  const lineStartY = hangerBottomY;
  const lineLengths = [0.68, 0.93, 0.68, 0.93];
  ctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const lx = hangerCenterX - hangerBottomW / 2 + hangerBottomW * ((i + 0.5) / 4);
    const endY = y + h * lineLengths[i];
    drawHandLine({ x: lx, y: lineStartY }, { x: lx, y: endY }, 200 + i * 30);
  }

  ctx.restore();
}

/**
 * 竖向时间轴：竖线+节点圆点
 */
function drawShapeTimeline(ctx: CanvasRenderingContext2D, el: ShapeElement, dpi: number): void {
  const x = mmToPx(el.x, dpi);
  const y = mmToPx(el.y, dpi);
  const w = mmToPx(el.width, dpi);
  const h = mmToPx(el.height, dpi);
  const color = el.timelineColor || '#b8a88a';
  const lineW = mmToPx(el.timelineWidth ?? 0.5, dpi);
  const nodeCount = el.timelineNodes ?? 5;

  const lineX = x + w / 2;  // 竖线在中间
  const topPadding = h * 0.08;  // 顶部空白
  const bottomPadding = h * 0.08;  // 底部空白
  const lineStartY = y + topPadding;
  const lineEndY = y + h - bottomPadding;
  const nodeRadius = lineW * 3;  // 节点圆点半径

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';

  // 竖线
  ctx.beginPath();
  ctx.moveTo(lineX, lineStartY);
  ctx.lineTo(lineX, lineEndY);
  ctx.stroke();

  // 节点圆点（均匀分布）
  const usableH = lineEndY - lineStartY;
  for (let i = 0; i < nodeCount; i++) {
    const nodeY = lineStartY + usableH * ((i + 0.5) / nodeCount);
    ctx.beginPath();
    ctx.arc(lineX, nodeY, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawShapeElement(ctx: CanvasRenderingContext2D, el: ShapeElement, dpi: number) {
  // 手绘时钟样式
  if (el.clockStyle) {
    drawClock(ctx, el, dpi);
    return;
  }
  // 手撕纸条样式
  if (el.tornPaper) {
    drawTornPaper(ctx, el, dpi);
    return;
  }
  // 手绘连线样式
  if (el.doodleLine) {
    drawDoodleLine(ctx, el, dpi);
    return;
  }
  // 手绘晾衣架样式
  if (el.clothesline) {
    drawShapeClothesline(ctx, el, dpi);
    return;
  }
  // 竖向时间轴样式
  if (el.timeline) {
    drawShapeTimeline(ctx, el, dpi);
    return;
  }

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
