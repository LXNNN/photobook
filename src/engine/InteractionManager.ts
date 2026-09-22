import type { Element, BookFormat } from '@/types';
import { mmToPx, pxToMm } from '@/utils/units';

export type InteractionMode = 'none' | 'drag' | 'resize' | 'rotate' | 'pan';

interface HitResult {
  element: Element;
  handle?: string; // 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br' | 'rotate'
}

/**
 * 交互管理器
 * 处理鼠标事件：命中检测、拖拽、缩放、旋转、画布平移
 */
export class InteractionManager {
  private canvas: HTMLCanvasElement;
  private format: BookFormat;
  private dpi: number;
  private zoom: number = 1;
  private pan: { x: number; y: number } = { x: 0, y: 0 };

  private mode: InteractionMode = 'none';
  private startMouse: { x: number; y: number } = { x: 0, y: 0 };
  private startElement: Element | null = null;
  private activeHandle: string | null = null;

  // 回调
  onSelect?: (elementId: string, multi: boolean) => void;
  onClearSelection?: () => void;
  onElementChange?: (elementId: string, updates: Partial<Element>) => void;
  onSwapImages?: (sourceId: string, targetId: string) => void;
  onPanChange?: (pan: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number, center?: { x: number; y: number }) => void;
  onAlignGuides?: (guides: { vertical: number[]; horizontal: number[] }) => void;
  onDragStart?: () => void; // 拖拽开始时调用（用于记录历史）
  onHoverTargetChange?: (targetId: string | null) => void; // 拖拽调换位置时的目标变化
  onTextEdit?: (elementId: string, content: string, x: number, y: number, width: number, height: number, fontSize: number, textAlign: string) => void; // 双击文字开始编辑
  onImageCrop?: (elementId: string) => void; // 双击图片开始裁剪

  // 拖拽时悬停的目标图片（用于互换）
  private hoverTargetId: string | null = null;

  // 对齐容差（mm）
  private alignTolerance = 2;

  constructor(canvas: HTMLCanvasElement, format: BookFormat, dpi = 96) {
    this.canvas = canvas;
    this.format = format;
    this.dpi = dpi;
    this.bindEvents();
  }

  setZoom(zoom: number) { this.zoom = zoom; }
  setPan(pan: { x: number; y: number }) { this.pan = pan; }

  /** 屏幕坐标转画布坐标（mm） */
  private screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    // getBoundingClientRect 已包含外层 CSS transform(translate+scale)，
    // 直接用比例换算到 canvas 内部像素坐标，不要再手动减 pan / 除 zoom
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const cssX = (screenX - rect.left) * scaleX;
    const cssY = (screenY - rect.top) * scaleY;
    return { x: pxToMm(cssX, this.dpi), y: pxToMm(cssY, this.dpi) };
  }

  /** 命中检测：从上层到下层遍历 */
  hitTest(elements: Element[], mmX: number, mmY: number): HitResult | null {
    const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
    for (const el of sorted) {
      if (el.locked) continue;
      // 旋转后的命中检测（简化：用包围盒）
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const rad = (-el.rotation * Math.PI) / 180;
      const dx = mmX - cx;
      const dy = mmY - cy;
      const localX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);

      if (localX >= el.x && localX <= el.x + el.width &&
          localY >= el.y && localY <= el.y + el.height) {
        return { element: el };
      }
    }
    return null;
  }

  /** 检测是否命中控制点 */
  hitHandle(el: Element, mmX: number, mmY: number): string | null {
    const handleSizeMm = pxToMm(8, this.dpi) / this.zoom;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const rad = (-el.rotation * Math.PI) / 180;
    const dx = mmX - cx;
    const dy = mmY - cy;
    const localX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    const localY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);

    const handles: Record<string, [number, number]> = {
      tl: [el.x, el.y], tc: [cx, el.y], tr: [el.x + el.width, el.y],
      ml: [el.x, cy], mr: [el.x + el.width, cy],
      bl: [el.x, el.y + el.height], bc: [cx, el.y + el.height], br: [el.x + el.width, el.y + el.height],
      rotate: [cx, el.y - pxToMm(24, this.dpi) / this.zoom],
    };

    for (const [name, [hx, hy]] of Object.entries(handles)) {
      if (Math.abs(localX - hx) <= handleSizeMm && Math.abs(localY - hy) <= handleSizeMm) {
        return name;
      }
    }
    return null;
  }

  private bindEvents() {
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('wheel', this.handleWheel);
    this.canvas.addEventListener('dblclick', this.handleDblClick);
  }

  private elements: Element[] = [];
  private selectedIds: string[] = [];

  setElements(elements: Element[]) { this.elements = elements; }
  setSelectedIds(ids: string[]) { this.selectedIds = ids; }

  /** 对齐检测：检测元素边缘是否和其他元素对齐 */
  private detectAlignment(
    el: Element,
    newX: number,
    newY: number
  ): { snappedX: number; snappedY: number; guides: { vertical: number[]; horizontal: number[] } } {
    const tolerance = this.alignTolerance;
    const verticalGuides: number[] = [];
    const horizontalGuides: number[] = [];

    // 收集其他元素的所有边缘线
    const otherElements = this.elements.filter((e) => e.id !== el.id && !e.locked);

    // 当前元素的 3 条竖线：左、中、右
    const elLeft = newX;
    const elCenterX = newX + el.width / 2;
    const elRight = newX + el.width;

    // 当前元素的 3 条横线：上、中、下
    const elTop = newY;
    const elCenterY = newY + el.height / 2;
    const elBottom = newY + el.height;

    let snappedX = newX;
    let snappedY = newY;

    // 检测垂直对齐（竖线）
    let minDistX = tolerance;
    let bestGuideX: number | null = null;
    let bestOffset = 0;

    for (const other of otherElements) {
      const lines = [
        other.x,                    // 左边缘
        other.x + other.width / 2,  // 中心
        other.x + other.width,      // 右边缘
      ];
      for (const line of lines) {
        // 检测当前元素的左、中、右是否对齐
        const offsets = [
          { dist: Math.abs(elLeft - line), offset: line - elLeft },
          { dist: Math.abs(elCenterX - line), offset: line - elCenterX },
          { dist: Math.abs(elRight - line), offset: line - elRight },
        ];
        for (const { dist, offset } of offsets) {
          if (dist < minDistX) {
            minDistX = dist;
            bestGuideX = line;
            bestOffset = offset;
          }
        }
      }
    }

    if (bestGuideX !== null) {
      snappedX = newX + bestOffset;
      verticalGuides.push(bestGuideX);
    }

    // 检测水平对齐（横线）
    let minDistY = tolerance;
    let bestGuideY: number | null = null;
    let bestOffsetY = 0;

    for (const other of otherElements) {
      const lines = [
        other.y,                    // 上边缘
        other.y + other.height / 2, // 中心
        other.y + other.height,     // 下边缘
      ];
      for (const line of lines) {
        const offsets = [
          { dist: Math.abs(elTop - line), offset: line - elTop },
          { dist: Math.abs(elCenterY - line), offset: line - elCenterY },
          { dist: Math.abs(elBottom - line), offset: line - elBottom },
        ];
        for (const { dist, offset } of offsets) {
          if (dist < minDistY) {
            minDistY = dist;
            bestGuideY = line;
            bestOffsetY = offset;
          }
        }
      }
    }

    if (bestGuideY !== null) {
      snappedY = newY + bestOffsetY;
      horizontalGuides.push(bestGuideY);
    }

    return {
      snappedX,
      snappedY,
      guides: { vertical: verticalGuides, horizontal: horizontalGuides },
    };
  }

  /** 缩放时的对齐检测 */
  private detectResizeAlignment(
    el: Element,
    newX: number,
    newY: number,
    newW: number,
    newH: number
  ): {
    snappedX: number;
    snappedY: number;
    snappedRight: number;
    snappedBottom: number;
    guides: { vertical: number[]; horizontal: number[] };
  } {
    const tolerance = this.alignTolerance;
    const verticalGuides: number[] = [];
    const horizontalGuides: number[] = [];

    const otherElements = this.elements.filter((e) => e.id !== el.id && !e.locked);

    // 当前元素的 3 条竖线：左、中、右
    const elLeft = newX;
    const elCenterX = newX + newW / 2;
    const elRight = newX + newW;

    // 当前元素的 3 条横线：上、中、下
    const elTop = newY;
    const elCenterY = newY + newH / 2;
    const elBottom = newY + newH;

    let snappedX = newX;
    let snappedY = newY;
    let snappedRight = elRight;
    let snappedBottom = elBottom;

    // 检测垂直对齐（竖线）
    for (const other of otherElements) {
      const lines = [
        other.x,
        other.x + other.width / 2,
        other.x + other.width,
      ];
      for (const line of lines) {
        // 检测左边
        if (Math.abs(elLeft - line) < tolerance) {
          snappedX = line;
          verticalGuides.push(line);
        }
        // 检测右边
        if (Math.abs(elRight - line) < tolerance) {
          snappedRight = line;
          verticalGuides.push(line);
        }
        // 检测中心
        if (Math.abs(elCenterX - line) < tolerance) {
          verticalGuides.push(line);
        }
      }
    }

    // 检测水平对齐（横线）
    for (const other of otherElements) {
      const lines = [
        other.y,
        other.y + other.height / 2,
        other.y + other.height,
      ];
      for (const line of lines) {
        // 检测上边
        if (Math.abs(elTop - line) < tolerance) {
          snappedY = line;
          horizontalGuides.push(line);
        }
        // 检测下边
        if (Math.abs(elBottom - line) < tolerance) {
          snappedBottom = line;
          horizontalGuides.push(line);
        }
        // 检测中心
        if (Math.abs(elCenterY - line) < tolerance) {
          horizontalGuides.push(line);
        }
      }
    }

    return {
      snappedX,
      snappedY,
      snappedRight,
      snappedBottom,
      guides: { vertical: verticalGuides, horizontal: horizontalGuides },
    };
  }

  private handleMouseDown = (e: MouseEvent) => {
    const { x, y } = this.screenToCanvas(e.clientX, e.clientY);
    this.startMouse = { x: e.clientX, y: e.clientY };

    // 中键或空格拖拽平移
    if (e.button === 1 || e.altKey) {
      this.mode = 'pan';
      return;
    }

    // 先检测选中元素的控制点
    if (this.selectedIds.length === 1) {
      const selected = this.elements.find((el) => el.id === this.selectedIds[0]);
      if (selected) {
        const handle = this.hitHandle(selected, x, y);
        if (handle) {
          this.mode = handle === 'rotate' ? 'rotate' : 'resize';
          this.startElement = { ...selected };
          this.activeHandle = handle;
          return;
        }
      }
    }

    // 命中检测
    const hit = this.hitTest(this.elements, x, y);
    if (hit) {
      if (!this.selectedIds.includes(hit.element.id)) {
        this.onSelect?.(hit.element.id, e.shiftKey);
      }
      this.mode = 'drag';
      this.startElement = { ...hit.element };
      this.onDragStart?.(); // 通知外部记录历史
    } else {
      this.onClearSelection?.();
      this.mode = 'none';
    }
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (this.mode === 'none') {
      // 更新鼠标样式
      const { x, y } = this.screenToCanvas(e.clientX, e.clientY);
      if (this.selectedIds.length === 1) {
        const selected = this.elements.find((el) => el.id === this.selectedIds[0]);
        if (selected) {
          const handle = this.hitHandle(selected, x, y);
          if (handle) {
            this.canvas.style.cursor = handle === 'rotate' ? 'crosshair' : 'pointer';
            return;
          }
        }
      }
      const hit = this.hitTest(this.elements, x, y);
      this.canvas.style.cursor = hit ? 'move' : 'default';
      return;
    }

    if (this.mode === 'pan') {
      const dx = e.clientX - this.startMouse.x;
      const dy = e.clientY - this.startMouse.y;
      this.onPanChange?.({ x: this.pan.x + dx, y: this.pan.y + dy });
      this.startMouse = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!this.startElement) return;
    const { x, y } = this.screenToCanvas(e.clientX, e.clientY);
    const startCanvas = this.screenToCanvas(this.startMouse.x, this.startMouse.y);

    if (this.mode === 'drag') {
      let dx = x - startCanvas.x;
      let dy = y - startCanvas.y;
      let newX = this.startElement.x + dx;
      let newY = this.startElement.y + dy;

      // 检测是否拖到了另一个图片元素上（用于调换位置）
      let newHoverTarget: string | null = null;
      if (this.startElement.type === 'image') {
        // 计算当前拖拽元素的中心点
        const cx = newX + this.startElement.width / 2;
        const cy = newY + this.startElement.height / 2;
        // 检测中心点是否命中了另一个图片元素（排除当前拖拽的元素）
        const otherElements = this.elements.filter((el) => el.id !== this.startElement!.id);
        const hit = this.hitTest(otherElements, cx, cy);
        if (hit && hit.element.type === 'image') {
          newHoverTarget = hit.element.id;
        }
      }

      // 更新 hover 目标
      if (newHoverTarget !== this.hoverTargetId) {
        this.hoverTargetId = newHoverTarget;
        this.onHoverTargetChange?.(newHoverTarget);
      }

      if (this.hoverTargetId) {
        // hover 到目标图片时：不移动位置，不更新元素，只显示高亮
        this.onAlignGuides?.({ vertical: [], horizontal: [] });
      } else {
        // 没 hover 到目标图片：正常移动位置 + 对齐检测
        const { snappedX, snappedY, guides } = this.detectAlignment(
          this.startElement,
          newX,
          newY
        );
        newX = snappedX;
        newY = snappedY;

        // 通知渲染层画辅助线
        this.onAlignGuides?.(guides);

        this.onElementChange?.(this.startElement.id, {
          x: newX,
          y: newY,
        });
      }
    } else if (this.mode === 'resize' && this.activeHandle) {
      this.handleResize(x, y, e.shiftKey);
    } else if (this.mode === 'rotate') {
      const cx = this.startElement.x + this.startElement.width / 2;
      const cy = this.startElement.y + this.startElement.height / 2;
      const angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
      const snapped = e.shiftKey ? Math.round(angle / 15) * 15 : angle;
      this.onElementChange?.(this.startElement.id, { rotation: snapped });
    }
  };

  private handleResize(x: number, y: number, shiftKey: boolean = false) {
    if (!this.startElement || !this.activeHandle) return;
    const el = this.startElement;
    let { x: nx, y: ny, width: nw, height: nh } = el;

    const aspect = el.width / el.height;
    const keepRatio = shiftKey;

    switch (this.activeHandle) {
      case 'br':
        nw = Math.max(5, x - el.x);
        nh = Math.max(5, y - el.y);
        if (keepRatio) nh = nw / aspect;
        break;
      case 'bl':
        nw = Math.max(5, el.x + el.width - x);
        nx = x;
        nh = Math.max(5, y - el.y);
        if (keepRatio) { nh = nw / aspect; ny = el.y + el.height - nh; }
        break;
      case 'tr':
        nw = Math.max(5, x - el.x);
        nh = Math.max(5, el.y + el.height - y);
        ny = y;
        if (keepRatio) nh = nw / aspect;
        break;
      case 'tl':
        nw = Math.max(5, el.x + el.width - x);
        nx = x;
        nh = Math.max(5, el.y + el.height - y);
        ny = y;
        if (keepRatio) { nh = nw / aspect; nx = el.x + el.width - nw; }
        break;
      case 'mr':
        nw = Math.max(5, x - el.x);
        if (keepRatio) { nh = nw / aspect; ny = el.y + (el.height - nh) / 2; }
        break;
      case 'ml':
        nw = Math.max(5, el.x + el.width - x);
        nx = x;
        if (keepRatio) { nh = nw / aspect; ny = el.y + (el.height - nh) / 2; nx = el.x + el.width - nw; }
        break;
      case 'bc':
        nh = Math.max(5, y - el.y);
        if (keepRatio) { nw = nh * aspect; nx = el.x + (el.width - nw) / 2; }
        break;
      case 'tc':
        nh = Math.max(5, el.y + el.height - y);
        ny = y;
        if (keepRatio) { nh = Math.max(5, el.y + el.height - y); nw = nh * aspect; nx = el.x + (el.width - nw) / 2; ny = el.y + el.height - nh; }
        break;
    }

    // 缩放时也检测对齐
    const { snappedX, snappedY, snappedRight, snappedBottom, guides } = this.detectResizeAlignment(
      el, nx, ny, nw, nh
    );

    // 根据拖拽的方向，只吸附对应的边
    let finalNx = nx;
    let finalNy = ny;
    if (this.activeHandle.includes('l') || this.activeHandle.includes('r')) {
      finalNx = snappedX;
    }
    if (this.activeHandle.includes('t') || this.activeHandle.includes('b')) {
      finalNy = snappedY;
    }

    // 通知渲染层画辅助线
    this.onAlignGuides?.(guides);

    this.onElementChange?.(el.id, { x: finalNx, y: finalNy, width: nw, height: nh });
  }

  private handleMouseUp = () => {
    // 清除辅助线
    this.onAlignGuides?.({ vertical: [], horizontal: [] });

    // 如果拖拽到了另一个图片上，触发调换位置
    if (this.mode === 'drag' && this.hoverTargetId && this.startElement) {
      this.onSwapImages?.(this.startElement.id, this.hoverTargetId);
    }

    // 重置 hover 目标
    this.hoverTargetId = null;
    this.onHoverTargetChange?.(null);

    this.canvas.style.cursor = 'default';
    this.mode = 'none';
    this.startElement = null;
    this.activeHandle = null;
  };

  private handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, this.zoom * delta));
    this.onZoomChange?.(newZoom, { x: e.clientX, y: e.clientY });
  };

  /** 双击元素：文字编辑 / 图片裁剪 */
  private handleDblClick = (e: MouseEvent) => {
    const mm = this.screenToCanvas(e.clientX, e.clientY);
    const hit = this.hitTest(this.elements, mm.x, mm.y);
    if (!hit) return;

    if (hit.element.type === 'text') {
      const textEl = hit.element as any;
      this.onTextEdit?.(
        hit.element.id,
        textEl.content || '',
        textEl.x,
        textEl.y,
        textEl.width,
        textEl.height,
        textEl.fontSize || 12,
        textEl.textAlign || 'left'
      );
    } else if (hit.element.type === 'image') {
      this.onImageCrop?.(hit.element.id);
    }
  };

  destroy() {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('dblclick', this.handleDblClick);
  }
}
