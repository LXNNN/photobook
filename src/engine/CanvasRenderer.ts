import type { Element, BookFormat } from '@/types';
import type { SpreadPage } from '@/utils/spreadLayout';
import { mmToPx } from '@/utils/units';
import { drawPageContent } from './drawPageContent';

/** 边界距离标注的数据结构（坐标是画布 mm，已带页面偏移） */
export interface BoundaryDistance {
  left: number;
  right: number;
  top: number;
  bottom: number;
  x: number;
  y: number;
  width: number;
  height: number;
  leftTargetX: number;
  rightTargetX: number;
  topTargetY: number;
  bottomTargetY: number;
}

/**
 * 编辑器画布位图相对逻辑尺寸（96dpi）的放大倍数。
 *
 * 画布的逻辑坐标、字号、命中判定全部还是 96dpi 那一套，只是位图按 2 倍像素画，
 * 再缩回原来的 CSS 尺寸显示：文字边缘、选中框、投影都会清晰很多。
 * 预览页之所以清楚，是因为 150dpi 渲染后再缩小显示（超采样）；编辑器原来是
 * 1:1 位图，屏幕缩放（Windows 125%/150%）和 zoom 一叠加就发虚。
 *
 * InteractionManager 的坐标换算依赖这个值，改的时候两处必须一起改。
 */
export const EDITOR_RENDER_SCALE = 2;

/**
 * Canvas 渲染器（双页画布）
 *
 * 画布永远是两页宽：正文跨页左页在左、右页在右；封面/结尾这种落单页居中
 * （左右露出编辑器桌面底色）。页面内容（背景 + 元素）的绘制规则仍然只走
 * drawPageContent —— 这里只额外负责每页的偏移、投影、出血线/安全线、
 * 中缝、活动页边框和选中框。
 *
 * 每页必须在 clip 之后才 translate + drawPageContent：drawPageContent 会用
 * ctx 变换反推逻辑画布尺寸来铺背景，translate 之后清屏/背景会一直铺到画布
 * 右缘（落单居中页会糊满右半边桌面）。
 *
 * 位图放大倍数见 EDITOR_RENDER_SCALE：draw() 里所有坐标仍按 96dpi 的逻辑
 * 像素画（setTransform 统一放大），CSS 尺寸固定为逻辑尺寸。
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private format: BookFormat;
  private dpi: number;
  private renderScale: number;
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private dirty: boolean = true;
  private rafId: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    format: BookFormat,
    dpi = 96,
    renderScale = EDITOR_RENDER_SCALE
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.format = format;
    this.dpi = dpi;
    this.renderScale = renderScale;
    this.resize();
  }

  /** 逻辑画布尺寸（96dpi 像素，也是 CSS 显示尺寸） */
  private get logicalWidth(): number {
    return Math.round(mmToPx(this.format.width, this.dpi)) * 2;
  }

  private get logicalHeight(): number {
    return Math.round(mmToPx(this.format.height, this.dpi));
  }

  /** 调整画布尺寸：固定两页宽（落单页画在中缝位置） */
  resize(dpi?: number) {
    if (dpi) this.dpi = dpi;
    // 位图按 renderScale 放大，CSS 尺寸保持逻辑尺寸 —— 显示大小不变、像素更密
    this.canvas.width = this.logicalWidth * this.renderScale;
    this.canvas.height = this.logicalHeight * this.renderScale;
    this.canvas.style.width = `${this.logicalWidth}px`;
    this.canvas.style.height = `${this.logicalHeight}px`;
    this.markDirty();
  }

  /** 标记需要重绘 */
  markDirty() {
    this.dirty = true;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.renderLoop());
    }
  }

  private renderLoop() {
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    this.rafId = null;
  }

  /** 渲染当前跨页（1~2 页） */
  async render(
    pages: SpreadPage[],
    selectedIds: string[] = [],
    showGuides = true,
    showBleed = true,
    hoverTargetId?: string | null,
    activePageIndex?: number
  ) {
    this.currentPages = pages;
    this.selectedIds = selectedIds;
    this.showGuides = showGuides;
    this.showBleed = showBleed;
    this.hoverTargetId = hoverTargetId || null;
    this.activePageIndex = activePageIndex ?? null;
    this.markDirty();
  }

  private currentPages: SpreadPage[] = [];
  private selectedIds: string[] = [];
  private showGuides = true;
  private showBleed = true;
  private hoverTargetId: string | null = null;
  private activePageIndex: number | null = null;
  private alignGuides: { vertical: number[]; horizontal: number[] } = { vertical: [], horizontal: [] };
  private boundaryDistance: BoundaryDistance | null = null;

  setAlignGuides(guides: { vertical: number[]; horizontal: number[] }) {
    this.alignGuides = guides;
    this.markDirty();
  }

  setBoundaryDistance(dist: BoundaryDistance | null) {
    this.boundaryDistance = dist;
    this.markDirty();
  }

  /** 页面左上角在画布里的像素位置 */
  private pageOriginX(page: SpreadPage): number {
    return mmToPx(page.offsetX, this.dpi);
  }

  private get pageWidthPx(): number {
    return mmToPx(this.format.width, this.dpi);
  }

  private draw() {
    const ctx = this.ctx;
    // 之后所有绘制坐标都用 96dpi 的逻辑像素，位图由这一层变换放大；
    // 线宽/手柄/投影的视觉大小因此和原来完全一致
    ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    ctx.clearRect(0, 0, width, height);

    if (this.currentPages.length === 0) return;

    // 1. 先给每页垫白底 + 投影（内容随后覆盖）。两页的投影都画完再画内容，
    //    否则右页投影会压到左页内容上，中缝附近会多出一道灰边。
    for (const page of this.currentPages) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(this.pageOriginX(page), 0, this.pageWidthPx, height);
      ctx.restore();
    }

    // 2. 每页 clip 后平移到自己的位置再画内容 —— 背景不会越界到隔壁页/桌面
    for (const page of this.currentPages) {
      const originX = this.pageOriginX(page);
      ctx.save();
      ctx.beginPath();
      ctx.rect(originX, 0, this.pageWidthPx, height);
      ctx.clip();
      ctx.translate(originX, 0);
      drawPageContent(ctx, page.page, this.format, this.dpi, this.imageCache);
      ctx.restore();

      if (this.showGuides || this.showBleed) {
        this.drawPageGuides(originX);
      }

      if (this.activePageIndex !== null && page.index === this.activePageIndex) {
        this.drawActivePageBorder(originX);
      }
    }

    // 3. 中缝：只有两页配对时才画（落单页居中，没有中缝）
    if (this.currentPages.length === 2) {
      ctx.save();
      ctx.fillStyle = 'rgba(150, 145, 135, 0.35)';
      ctx.fillRect(width / 2 - 0.5, 0, 1, height);
      ctx.restore();
    }

    // 4. 对齐辅助线（坐标已是画布 mm）
    this.drawAlignGuides();

    // 5. 边界距离
    this.drawBoundaryDistance();

    // 6. 选中框 / hover 高亮：按元素所在页加偏移
    for (const id of this.selectedIds) {
      const found = this.findElement(id);
      if (found) this.drawSelection(found.element, this.pageOriginX(found.page));
    }

    if (this.hoverTargetId) {
      const found = this.findElement(this.hoverTargetId);
      if (found) this.drawHoverHighlight(found.element, this.pageOriginX(found.page));
    }
  }

  private findElement(id: string): { element: Element; page: SpreadPage } | null {
    for (const page of this.currentPages) {
      const element = page.page.elements.find((el) => el.id === id);
      if (element) return { element, page };
    }
    return null;
  }

  /** 绘制对齐辅助线（画布 mm 坐标，竖线贯穿整块画布） */
  private drawAlignGuides() {
    const ctx = this.ctx;
    const width = this.logicalWidth;
    const height = this.logicalHeight;

    ctx.save();
    ctx.strokeStyle = '#ff4081';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (const x of this.alignGuides.vertical) {
      const px = mmToPx(x, this.dpi);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }

    for (const y of this.alignGuides.horizontal) {
      const py = mmToPx(y, this.dpi);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** 绘制元素距离页面四边的距离标注（坐标是画布 mm） */
  private drawBoundaryDistance() {
    if (!this.boundaryDistance) return;
    const ctx = this.ctx;
    const d = this.boundaryDistance;
    const dpi = this.dpi;

    const elCenterX = d.x + d.width / 2;
    const elCenterY = d.y + d.height / 2;

    ctx.save();
    ctx.strokeStyle = '#2196f3';
    ctx.fillStyle = '#2196f3';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const drawLabel = (text: string, cxMm: number, cyMm: number) => {
      const cx = mmToPx(cxMm, dpi);
      const cy = mmToPx(cyMm, dpi);
      const metrics = ctx.measureText(text);
      const padX = 4;
      const padY = 2;
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(33, 150, 243, 0.9)';
      ctx.fillRect(cx - metrics.width / 2 - padX, cy - 7 - padY, metrics.width + padX * 2, 14 + padY * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, cx, cy);
      ctx.setLineDash([4, 3]);
      ctx.fillStyle = '#2196f3';
    };

    const leftLineY = elCenterY;
    ctx.beginPath();
    ctx.moveTo(mmToPx(d.leftTargetX, dpi), mmToPx(leftLineY, dpi));
    ctx.lineTo(mmToPx(d.x, dpi), mmToPx(leftLineY, dpi));
    ctx.stroke();
    drawLabel(`${d.left}mm`, (d.leftTargetX + d.x) / 2, leftLineY);

    const rightLineY = elCenterY;
    const elRight = d.x + d.width;
    ctx.beginPath();
    ctx.moveTo(mmToPx(elRight, dpi), mmToPx(rightLineY, dpi));
    ctx.lineTo(mmToPx(d.rightTargetX, dpi), mmToPx(rightLineY, dpi));
    ctx.stroke();
    drawLabel(`${d.right}mm`, (elRight + d.rightTargetX) / 2, rightLineY);

    const topLineX = elCenterX;
    ctx.beginPath();
    ctx.moveTo(mmToPx(topLineX, dpi), mmToPx(d.topTargetY, dpi));
    ctx.lineTo(mmToPx(topLineX, dpi), mmToPx(d.y, dpi));
    ctx.stroke();
    drawLabel(`${d.top}mm`, topLineX, (d.topTargetY + d.y) / 2);

    const bottomLineX = elCenterX;
    const elBottom = d.y + d.height;
    ctx.beginPath();
    ctx.moveTo(mmToPx(bottomLineX, dpi), mmToPx(elBottom, dpi));
    ctx.lineTo(mmToPx(bottomLineX, dpi), mmToPx(d.bottomTargetY, dpi));
    ctx.stroke();
    drawLabel(`${d.bottom}mm`, bottomLineX, (elBottom + d.bottomTargetY) / 2);

    ctx.restore();
  }

  /** 绘制某一页的出血线、安全线（originX 是该页左缘像素位置） */
  private drawPageGuides(originX: number) {
    const ctx = this.ctx;
    const width = this.pageWidthPx;
    const height = this.logicalHeight;
    const bleed = mmToPx(this.format.bleed, this.dpi);
    const safe = mmToPx(this.format.safeMargin, this.dpi);

    if (this.showBleed && this.format.bleed > 0) {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(originX + bleed, bleed, width - bleed * 2, height - bleed * 2);
      ctx.setLineDash([]);
    }

    if (this.showGuides) {
      ctx.strokeStyle = 'rgba(0, 100, 255, 0.4)';
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(originX + safe, safe, width - safe * 2, height - safe * 2);
      ctx.setLineDash([]);
    }
  }

  /** 活动页边框：新加的照片/文字会落在这页，给个不刺眼的琥珀色提示 */
  private drawActivePageBorder(originX: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 83, 9, 0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(originX + 1, 1, this.pageWidthPx - 2, this.logicalHeight - 2);
    ctx.restore();
  }

  /** 绘制选中框和控制点（offsetX 是元素所在页的左缘像素位置） */
  private drawSelection(el: Element, offsetX: number) {
    const ctx = this.ctx;
    const x = offsetX + mmToPx(el.x, this.dpi);
    const y = mmToPx(el.y, this.dpi);
    const w = mmToPx(el.width, this.dpi);
    const h = mmToPx(el.height, this.dpi);

    ctx.save();
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(((el.rotation ?? 0) * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    const handleSize = 8;
    const handles = [
      [x, y], [x + w / 2, y], [x + w, y],
      [x, y + h / 2], [x + w, y + h / 2],
      [x, y + h], [x + w / 2, y + h], [x + w, y + h],
    ];
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 1.5;
    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    }

    if (el.type !== 'shape') {
      const rotY = y - 24;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, rotY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + w / 2, rotY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#2196f3';
      ctx.fill();
    }

    ctx.restore();
  }

  /** 绘制 hover 高亮（拖拽调换位置时的目标） */
  private drawHoverHighlight(el: Element, offsetX: number) {
    const ctx = this.ctx;
    const x = offsetX + mmToPx(el.x, this.dpi);
    const y = mmToPx(el.y, this.dpi);
    const w = mmToPx(el.width, this.dpi);
    const h = mmToPx(el.height, this.dpi);

    ctx.save();
    ctx.fillStyle = 'rgba(33, 150, 243, 0.2)';
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    ctx.restore();
  }

  /** 缓存图片 */
  cacheImage(id: string, img: HTMLImageElement) {
    this.imageCache.set(id, img);
    this.markDirty();
  }

  /** 获取图片缓存 */
  getCachedImage(id: string): HTMLImageElement | undefined {
    return this.imageCache.get(id);
  }

  /** 清空图片缓存 */
  clearImageCache() {
    this.imageCache.clear();
  }

  /** 销毁 */
  destroy() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.imageCache.clear();
  }
}
