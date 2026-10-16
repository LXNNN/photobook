import type { Page, Element, BookFormat } from '@/types';
import { mmToPx } from '@/utils/units';
import { drawPageContent } from './drawPageContent';

/**
 * Canvas 渲染器
 * 负责将页面数据渲染到 Canvas 上
 *
 * 页面内容（背景 + 元素）的绘制规则在 drawPageContent 里，和左侧书页缩略图共用；
 * 这里只额外负责编辑器专属的出血线、安全线、选中框。
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private format: BookFormat;
  private dpi: number;
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private dirty: boolean = true;
  private rafId: number | null = null;

  constructor(canvas: HTMLCanvasElement, format: BookFormat, dpi = 96) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.format = format;
    this.dpi = dpi;
    this.resize();
  }

  /** 调整画布尺寸以匹配页面物理尺寸 */
  resize(dpi?: number) {
    if (dpi) this.dpi = dpi;
    const width = Math.round(mmToPx(this.format.width, this.dpi));
    const height = Math.round(mmToPx(this.format.height, this.dpi));
    this.canvas.width = width;
    this.canvas.height = height;
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

  /** 渲染整个页面 */
  async render(page: Page, selectedIds: string[] = [], showGuides = true, showBleed = true, hoverTargetId?: string | null) {
    this.currentPage = page;
    this.selectedIds = selectedIds;
    this.showGuides = showGuides;
    this.showBleed = showBleed;
    this.hoverTargetId = hoverTargetId || null;
    this.markDirty();
  }

  private currentPage: Page | null = null;
  private selectedIds: string[] = [];
  private showGuides = true;
  private showBleed = true;
  private hoverTargetId: string | null = null;
  private alignGuides: { vertical: number[]; horizontal: number[] } = { vertical: [], horizontal: [] };
  private boundaryDistance: { left: number; right: number; top: number; bottom: number; x: number; y: number; width: number; height: number; leftTargetX: number; rightTargetX: number; topTargetY: number; bottomTargetY: number } | null = null;

  setAlignGuides(guides: { vertical: number[]; horizontal: number[] }) {
    this.alignGuides = guides;
    this.markDirty();
  }

  setBoundaryDistance(dist: { left: number; right: number; top: number; bottom: number; x: number; y: number; width: number; height: number; leftTargetX: number; rightTargetX: number; topTargetY: number; bottomTargetY: number } | null) {
    this.boundaryDistance = dist;
    this.markDirty();
  }

  private draw() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);

    if (!this.currentPage) return;

    // 背景 + 全部元素：和左侧缩略图走同一份规则
    drawPageContent(ctx, this.currentPage, this.format, this.dpi, this.imageCache);

    // 绘制辅助线
    if (this.showGuides || this.showBleed) {
      this.drawGuides();
    }

    // 绘制对齐辅助线
    this.drawAlignGuides();

    // 绘制边界距离
    this.drawBoundaryDistance();

    // 绘制选中框
    const elements = [...this.currentPage.elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const id of this.selectedIds) {
      const el = elements.find((e) => e.id === id);
      if (el) this.drawSelection(el);
    }

    // 绘制 hover 高亮（拖拽调换位置时的目标）
    if (this.hoverTargetId) {
      const el = elements.find((e) => e.id === this.hoverTargetId);
      if (el) this.drawHoverHighlight(el);
    }
  }

  /** 绘制对齐辅助线 */
  private drawAlignGuides() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    ctx.save();
    ctx.strokeStyle = '#ff4081';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    // 画竖线
    for (const x of this.alignGuides.vertical) {
      const px = mmToPx(x, this.dpi);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }

    // 画横线
    for (const y of this.alignGuides.horizontal) {
      const py = mmToPx(y, this.dpi);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** 绘制元素距离页面四边的距离标注 */
  private drawBoundaryDistance() {
    if (!this.boundaryDistance) return;
    const ctx = this.ctx;
    const d = this.boundaryDistance;
    const dpi = this.dpi;

    // 元素中心位置
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

    // 绘制距离标注的辅助函数
    const drawLabel = (text: string, cxMm: number, cyMm: number) => {
      const cx = mmToPx(cxMm, dpi);
      const cy = mmToPx(cyMm, dpi);
      // 测量文字宽度，画背景框
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

    // 左边距离：从左侧目标（相邻元素右边缘或页边）到元素左边缘
    const leftLineY = elCenterY;
    ctx.beginPath();
    ctx.moveTo(mmToPx(d.leftTargetX, dpi), mmToPx(leftLineY, dpi));
    ctx.lineTo(mmToPx(d.x, dpi), mmToPx(leftLineY, dpi));
    ctx.stroke();
    drawLabel(`${d.left}mm`, (d.leftTargetX + d.x) / 2, leftLineY);

    // 右边距离：从元素右边缘到右侧目标（相邻元素左边缘或页边）
    const rightLineY = elCenterY;
    const elRight = d.x + d.width;
    ctx.beginPath();
    ctx.moveTo(mmToPx(elRight, dpi), mmToPx(rightLineY, dpi));
    ctx.lineTo(mmToPx(d.rightTargetX, dpi), mmToPx(rightLineY, dpi));
    ctx.stroke();
    drawLabel(`${d.right}mm`, (elRight + d.rightTargetX) / 2, rightLineY);

    // 上边距离：从上方目标（相邻元素下边缘或页边）到元素上边缘
    const topLineX = elCenterX;
    ctx.beginPath();
    ctx.moveTo(mmToPx(topLineX, dpi), mmToPx(d.topTargetY, dpi));
    ctx.lineTo(mmToPx(topLineX, dpi), mmToPx(d.y, dpi));
    ctx.stroke();
    drawLabel(`${d.top}mm`, topLineX, (d.topTargetY + d.y) / 2);

    // 下边距离：从元素下边缘到下方目标（相邻元素上边缘或页边）
    const bottomLineX = elCenterX;
    const elBottom = d.y + d.height;
    ctx.beginPath();
    ctx.moveTo(mmToPx(bottomLineX, dpi), mmToPx(elBottom, dpi));
    ctx.lineTo(mmToPx(bottomLineX, dpi), mmToPx(d.bottomTargetY, dpi));
    ctx.stroke();
    drawLabel(`${d.bottom}mm`, bottomLineX, (elBottom + d.bottomTargetY) / 2);

    ctx.restore();
  }

  /** 绘制辅助线（出血线、安全线） */
  private drawGuides() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const bleed = mmToPx(this.format.bleed, this.dpi);
    const safe = mmToPx(this.format.safeMargin, this.dpi);

    if (this.showBleed && this.format.bleed > 0) {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(bleed, bleed, width - bleed * 2, height - bleed * 2);
      ctx.setLineDash([]);
    }

    if (this.showGuides) {
      ctx.strokeStyle = 'rgba(0, 100, 255, 0.4)';
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(safe, safe, width - safe * 2, height - safe * 2);
      ctx.setLineDash([]);
    }
  }

  /** 绘制选中框和控制点 */
  private drawSelection(el: Element) {
    const ctx = this.ctx;
    const x = mmToPx(el.x, this.dpi);
    const y = mmToPx(el.y, this.dpi);
    const w = mmToPx(el.width, this.dpi);
    const h = mmToPx(el.height, this.dpi);

    ctx.save();
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(((el.rotation ?? 0) * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    // 选中框
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // 8个控制点
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

    // 旋转控制点（顶部）—— shape 类型（普通选区）不显示旋转控制点
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
  private drawHoverHighlight(el: Element) {
    const ctx = this.ctx;
    const x = mmToPx(el.x, this.dpi);
    const y = mmToPx(el.y, this.dpi);
    const w = mmToPx(el.width, this.dpi);
    const h = mmToPx(el.height, this.dpi);

    ctx.save();

    // 半透明填充
    ctx.fillStyle = 'rgba(33, 150, 243, 0.2)';
    ctx.fillRect(x, y, w, h);

    // 高亮边框
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
