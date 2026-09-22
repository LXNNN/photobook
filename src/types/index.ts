// ==================== 项目核心类型定义 ====================

export interface Project {
  id: string;
  name: string;
  coverImage?: string;
  format: BookFormat;
  pages: Page[];
  createdAt: number;
  updatedAt: number;
  version: number;
  /** 主题ID（旅行/生日/情侣等），用于切换模板时取对应文案 */
  themeId?: string;
}

export interface BookFormat {
  width: number;
  height: number;
  bleed: number;
  safeMargin: number;
}

export const PRESET_FORMATS: Record<string, BookFormat> = {
  A5: { width: 148, height: 210, bleed: 3, safeMargin: 5 },
  A4: { width: 210, height: 297, bleed: 3, safeMargin: 5 },
  SQUARE_20: { width: 200, height: 200, bleed: 3, safeMargin: 5 },
};

export interface Page {
  id: string;
  background: PageBackground;
  elements: Element[];
  /** 应用该页的模板 ID（用于"保存模板"功能回写） */
  templateId?: string;
}

export interface PageBackground {
  type: 'color' | 'image';
  value: string;
}

export type Element = ImageElement | TextElement | StickerElement;

export interface BaseElement {
  id: string;
  type: 'image' | 'text' | 'sticker';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked?: boolean;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  imageId: string;
  crop: CropArea;
  filter?: FilterSettings;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FilterSettings {
  brightness: number;
  contrast: number;
  saturate: number;
  grayscale: number;
  sepia: number;
}

/**
 * 字重：关键字或 100-900 数值。
 * 数值在 canvas 的 ctx.font 与 CSS font-weight 中都直接可用。
 */
export type FontWeight = 'normal' | 'bold' | 'lighter' | 'bolder' | number;

export interface TextElement extends BaseElement {
  type: 'text';
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight?: FontWeight;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  /** 是否为固定文字（不自动填充文案，比如装饰小标签） */
  fixed?: boolean;
}

export interface StickerElement extends BaseElement {
  type: 'sticker';
  stickerId: string;
}

export interface ImageAsset {
  id: string;
  blob: Blob;
  thumbnail: string;
  width: number;
  height: number;
  size: number;
  createdAt: number;
}

export interface EditorState {
  currentPageIndex: number;
  selectedElementIds: string[];
  zoom: number;
  pan: { x: number; y: number };
  showGuides: boolean;
  showBleed: boolean;
}

export interface UIState {
  mode: 'edit' | 'view';
  sidebarTab: 'pages' | 'templates' | 'stickers' | 'properties';
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
}

export interface ExportConfig {
  dpi: 150 | 300;
  includeBleed: boolean;
  format: 'pdf' | 'images';
}

export interface LayoutTemplate {
  id: string;
  name: string;
  thumbnail: string;
  category: string;
  elements: Omit<Element, 'id'>[];
}
