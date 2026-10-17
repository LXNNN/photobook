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
  /** 正文字号（pt），默认 13（DEFAULT_BODY_FONT_SIZE），用于所有模板正文和新添加文字 */
  bodyFontSize?: number;
  /** 正文颜色（「🎨 正文样式」改过之后记下来），默认 #333333（DEFAULT_BODY_COLOR） */
  bodyColor?: string;
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

export type Element = ImageElement | TextElement | StickerElement | ShapeElement;

export interface BaseElement {
  id: string;
  type: 'image' | 'text' | 'sticker' | 'shape';
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

/**
 * 形状/选区元素：普通选区，可设置背景色、圆角等
 */
export interface ShapeElement extends BaseElement {
  type: 'shape';
  /** 背景色 */
  backgroundColor: string;
  /** 圆角（mm），默认 0 */
  borderRadius?: number;
  /** 边框颜色 */
  borderColor?: string;
  /** 边框宽度（mm） */
  borderWidth?: number;
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
  /**
   * 背景色（右侧栏「文字属性 → 背景色」加的）：每行文字后面一条底色，
   * 长行色条长、短行色条短，居中/居右的行色条跟着走。
   * 不填 = 无背景（老相册、模板默认都没有）。
   */
  backgroundColor?: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  /** 是否为固定文字（不自动填充文案，比如装饰小标签） */
  fixed?: boolean;
  /**
   * 正文标记：模板里那段会被填文案、跟着「正文样式」走的正文。
   * true = 正文；false = 明确不是（标题、装饰小字、照片上的白字）；
   * 不填 = 老相册的数据，按字号是否到标题线来判断（见 utils/bodyText.ts）。
   */
  body?: boolean;
  /**
   * 短正文标记：空间小的正文区域（比如五图留白模板左上角那行），
   * 从主题的 shortParagraphs 里取一行短句，不用长正文。
   * 和 body 成对使用；不填 = 普通正文。
   */
  shortBody?: boolean;
  /**
   * 标题标记：「📝 添加文字 → 添加标题」做出来的那段标题。
   * true = 标题；false = 明确不是标题（手动写的正文）；不填 = 模板做的或
   * 老相册的数据，按字号是否到标题线判断（见 utils/bodyText.ts 的 isTitleText）。
   * 之后做「全局调标题样式」就认这个标记。
   */
  title?: boolean;
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

/**
 * IndexedDB 里的图片存储记录。启用文件夹模式并完成迁移后，原图以普通文件存在
 * 磁盘（相册文件夹\照片\），这里的 blob 会被清掉，只剩缩略图与元数据；
 * 渲染要用的 `ImageAsset`（blob 必填）由资产仓库（assetStore）负责补全。
 */
export interface StoredImageRecord {
  id: string;
  blob?: Blob;
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
