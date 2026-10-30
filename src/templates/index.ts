import type { Element, BookFormat, Page, ImageElement, TextElement, FontWeight, CropArea, AlbumStyleId, PageDoodle, PageBackground } from '@/types';
import { generateId } from '@/utils/units';
import { getRandomText, randomPick } from './copywriting';
import { getTemplateCopyList } from './templateCopy';
import { getThemeById } from './themes';
import { DEFAULT_BODY_COLOR, DEFAULT_BODY_FONT_SIZE } from '@/utils/bodyText';
import moban1Bg from '@/assets/moban1.png';

/**
 * 模板定义
 * 元素坐标使用相对比例 (0-1)，应用时乘以页面实际尺寸
 */
export interface TemplateDefinition {
  id: string;
  name: string;
  category: '封面' | '尾页' | '一图' | '二图' | '三图' | '四图' | '五图' | '六图' | '七图' | '八图' | '十图' | '十二图' | '文字封面' | '我的模板';
  description: string;
  /** 缩略图用的 SVG 路径（用于模板面板预览） */
  thumbnail: string;
  /** 模板元素定义（相对坐标） */
  elements: TemplateElement[];
  /** 相册风格：不填 = classic（经典图文排版）。氛围感设计的模板标 'atmosphere' */
  styleId?: AlbumStyleId;
  /** 黑色类型标识：预留字段，后续用于区分不同的黑色处理方案 */
  blackType?: number;
  /** 页面级手绘连线装饰（不是元素，不可选中拖拽，直接画在背景上） */
  doodle?: PageDoodle;
  /** 模板背景色（应用模板时设置页面背景） */
  background?: string;
  /** 模板背景图（应用模板时设置页面背景图，不可移动缩放），优先级高于background */
  backgroundImage?: string;
}

export interface TemplateElement {
  type: 'image' | 'text' | 'shape';
  /** 相对位置和尺寸 (0-1) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 文字元素的默认内容 */
  placeholder?: string;
  /** 固定文字（不自动填充文案） */
  fixed?: boolean;
  /**
   * 正文标记：应用模板时这段字会被填上文案，字号和颜色跟相册的正文样式走
   * （默认 13pt / #333333），也被「🎨 正文样式」一键换色换字号管。
   * 封面上的英文小字、「记录者」这类短标签不标 —— 它们是排版的一部分。
   */
  body?: boolean;
  /** 短正文标记：空间小的正文区域，从主题短正文库取一行短句，不用长正文 */
  shortBody?: boolean;
  /** 文字元素的默认字号（相对页面宽度的比例）；正文标记的元素只是备用基准 */
  fontSizeRatio?: number;
  /** 文字对齐 */
  textAlign?: 'left' | 'center' | 'right';
  /** 字体粗细 */
  fontWeight?: FontWeight;
  /** 文字颜色 */
  color?: string;
  /** 文字背景色（每行文字后面一条底色）；不填 = 无背景 */
  backgroundColor?: string;
  /** 图片元素的裁剪提示 */
  cropHint?: 'cover' | 'contain';
  /** 图片元素的胶卷边缘效果（电影胶片边框） */
  filmEdge?: boolean;
  /** 胶卷选区左边黑边，默认true */
  filmLeftEdge?: boolean;
  /** 胶卷选区右边黑边，默认true */
  filmRightEdge?: boolean;
  /** @deprecated 旧的左右边框总开关，已拆分，保留兼容 */
  filmSideEdge?: boolean;
  /** 图片元素的邮票边缘效果（四边齿孔） */
  stampEdge?: boolean;
  /** 图片元素的卡片选区效果（白卡片+底部波浪+投影） */
  cardEdge?: boolean;
  /** 图片元素的圆形选区效果（正圆裁剪） */
  circleEdge?: boolean;
  /** 照片选区边框宽度（mm），不填=无边框 */
  borderWidth?: number;
  /** 照片选区边框颜色，默认黑色 */
  borderColor?: string;
  /** 形状元素：手绘时钟样式（刻度+指针+中心文字） */
  clockStyle?: boolean;
  /** 形状元素：手撕纸条样式（暖色背景+手撕边缘+底部手绘线） */
  tornPaper?: boolean;
  /** 形状元素：手绘连线样式，绘制doodlePath定义的曲线 */
  doodleLine?: boolean;
  /** 手绘连线路径点（相对于元素的比例坐标0-1） */
  doodlePath?: { x: number; y: number }[];
  /** 手绘连线颜色，默认#e74c3c */
  doodleColor?: string;
  /** 手绘连线宽度（mm），默认1.5 */
  doodleWidth?: number;
  /** 形状元素：手绘晾衣架样式（弧线+衣架+四条挂线） */
  clothesline?: boolean;
  /** 晾衣架线条颜色，默认#5a5a5a */
  clotheslineColor?: string;
  /** 晾衣架线条宽度（mm），默认0.5 */
  clotheslineWidth?: number;
  /** 形状元素：竖向时间轴样式（竖线+节点圆点） */
  timeline?: boolean;
  /** 时间轴颜色，默认#b8a88a */
  timelineColor?: string;
  /** 时间轴线宽（mm），默认0.5 */
  timelineWidth?: number;
  /** 时间轴节点数量，默认5 */
  timelineNodes?: number;
  /** 图片元素的裁剪区域（相对原图，0-1）；不填则铺满整张图 */
  crop?: CropArea;
  /** 元素透明度 0-1，不填按 1 处理 */
  opacity?: number;
  /** 锁定元素：不可选中、不可移动、不可编辑（用于装饰文字等固定元素） */
  locked?: boolean;
  /** 文字旋转角度（度） */
  rotation?: number;
  /** 文字行高 */
  lineHeight?: number;
  /** 文字字体 */
  fontFamily?: string;
}

/**
 * 8 种常用排版模板
 */
export const TEMPLATES: TemplateDefinition[] = [
  // ============ 封面/尾页 ============
  {
    id: 'cover-minimal',
    name: '极简封面',
    category: '封面',
    description: '左上角大标题，简洁高级，适合文艺风',
    thumbnail: 'cover-minimal',
    elements: [
      { type: 'image', x: 0, y: 0, width: 1, height: 1, cropHint: 'cover' },
      { type: 'text', x: 0.08, y: 0.15, width: 0.6, height: 0.1, placeholder: '时光印记', fontSizeRatio: 0.08, textAlign: 'left', fontWeight: 'bold', color: '#ffffff' },
      { type: 'text', x: 0.08, y: 0.26, width: 0.5, height: 0.04, placeholder: 'MEMORIES', fontSizeRatio: 0.025, textAlign: 'left', color: '#ffffff' },
      { type: 'text', x: 0.08, y: 0.85, width: 0.4, height: 0.04, placeholder: '2026', fontSizeRatio: 0.03, textAlign: 'left', color: '#ffffff' },
    ],
  },
  {
    id: 'cover-travel-journal',
    name: '杂志封面',
    category: '封面',
    description: '白底大标题 + 满幅大图，左侧四角星与竖排 TIME 装饰，极简杂志风',
    thumbnail: 'cover-travel-journal',
    elements: [
      // 照片（满幅大图，四周留白；顶部文字区加大、图片高度减小）
      { type: 'image', x: 0.082, y: 0.431, width: 0.828, height: 0.506, cropHint: 'cover' },
      // 右上大标题（可修改，右侧对齐基准）
      { type: 'text', x: 0.667, y: 0.063, width: 0.256, height: 0.13, placeholder: '时间\n旅行纪', fontSizeRatio: 0.11, textAlign: 'right', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1.05 },
      // ——作者名（标题下方）
      { type: 'text', x: 0.663, y: 0.228, width: 0.256, height: 0.025, placeholder: '——作者名', fontSizeRatio: 0.031, textAlign: 'right', color: '#888888', lineHeight: 1, fixed: true },
      // 两个四角星（小、大，位于 TIME 上方）
      { type: 'text', x: 0.102, y: 0.074, width: 0.034, height: 0.026, placeholder: '✦', fontSizeRatio: 0.041, textAlign: 'center', color: '#1a1a1a', lineHeight: 1, fixed: true },
      { type: 'text', x: 0.136, y: 0.048, width: 0.046, height: 0.032, placeholder: '✦', fontSizeRatio: 0.055, textAlign: 'center', color: '#1a1a1a', lineHeight: 1, fixed: true },
      // TIME 竖排：每个字母单独向右旋转 90°，衬线字体
      { type: 'text', x: 0.126, y: 0.114, width: 0.062, height: 0.045, placeholder: 'T', fontSizeRatio: 0.167, textAlign: 'center', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1, rotation: 90, fontFamily: 'Georgia, "Times New Roman", serif', fixed: true },
      { type: 'text', x: 0.129, y: 0.17, width: 0.062, height: 0.045, placeholder: 'I', fontSizeRatio: 0.167, textAlign: 'center', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1, rotation: 90, fontFamily: 'Georgia, "Times New Roman", serif', fixed: true },
      { type: 'text', x: 0.129, y: 0.243, width: 0.062, height: 0.045, placeholder: 'M', fontSizeRatio: 0.167, textAlign: 'center', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1, rotation: 90, fontFamily: 'Georgia, "Times New Roman", serif', fixed: true },
      { type: 'text', x: 0.09, y: 0.306, width: 0.091, height: 0.079, placeholder: 'E', fontSizeRatio: 0.167, textAlign: 'center', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1, rotation: 90, fontFamily: 'Georgia, "Times New Roman", serif', fixed: true },
      // 标题下方中文小字（可修改，右侧与大标题对齐）
      { type: 'text', x: 0.489, y: 0.274, width: 0.43, height: 0.018, placeholder: '・这一路的风景 ・从我的视角展开', fontSizeRatio: 0.029, textAlign: 'right', color: '#555555', lineHeight: 1, fixed: true },
      // 对应英文大写（可修改，右侧对齐）
      { type: 'text', x: 0.489, y: 0.296, width: 0.43, height: 0.015, placeholder: 'THE SCENERY ALONG THE WAY FROM MY PERSPECTIVE', fontSizeRatio: 0.017, textAlign: 'right', color: '#999999', lineHeight: 1, fixed: true },
      // 见天地，见众生，见自己（可修改，右侧对齐）
      { type: 'text', x: 0.489, y: 0.334, width: 0.43, height: 0.02, placeholder: '见天地，见众生，见自己', fontSizeRatio: 0.043, textAlign: 'right', color: '#333333', lineHeight: 1, fixed: true },
      // 底部两行浅灰小字
      { type: 'text', x: 0.2, y: 0.96, width: 0.6, height: 0.012, placeholder: 'CHERISH EVERY MOMENT', fontSizeRatio: 0.017, textAlign: 'center', color: '#c8c8c8', lineHeight: 1, fixed: true },
      { type: 'text', x: 0.2, y: 0.973, width: 0.6, height: 0.012, placeholder: 'COLLECT BEAUTIFUL MEMORIES OF LIFE', fontSizeRatio: 0.017, textAlign: 'center', color: '#c8c8c8', lineHeight: 1, fixed: true },
    ],
  },
  {
    id: 'ending-page',
    name: '尾页1',
    category: '尾页',
    description: '全幅大图+居中寄语，适合做尾页',
    thumbnail: 'ending-page',
    elements: [
      { type: 'image', x: 0, y: 0, width: 1, height: 1, cropHint: 'cover' },
      { type: 'text', x: 0.15, y: 0.3, width: 0.7, height: 0.1, placeholder: '未完待续', fontSizeRatio: 0.07, textAlign: 'center', fontWeight: 'bold', color: '#ffffff' },
      { type: 'text', x: 0.2, y: 0.45, width: 0.6, height: 0.15, placeholder: '每一段旅程都是一次成长，期待下一次出发。', fontSizeRatio: 0.03, textAlign: 'center', color: '#ffffff' },
      { type: 'text', x: 0.15, y: 0.7, width: 0.7, height: 0.05, placeholder: 'THANK YOU', fontSizeRatio: 0.025, textAlign: 'center', color: '#ffffff' },
    ],
  },
  {
    id: 'ending-minimal',
    name: '尾页2',
    category: '尾页',
    description: '居中方形照片+未完待续+年份，简约文艺尾页',
    thumbnail: 'ending-minimal',
    elements: [
      // 居中方形照片
      { type: 'image', x: 0.309, y: 0.206, width: 0.378, height: 0.252, cropHint: 'cover' },
      // 未完待续
      { type: 'text', x: 0.199, y: 0.505, width: 0.602, height: 0.05, placeholder: '未完待续', fontSizeRatio: 0.033, textAlign: 'center', fontWeight: 'bold', color: '#333333' },
      // 年份（动态获取当前年份）
      { type: 'text', x: 0.199, y: 0.547, width: 0.602, height: 0.04, placeholder: '{year}', fontSizeRatio: 0.031, textAlign: 'center', fontWeight: 'normal', color: '#333333' },
    ],
  },

  // ============ 氛围感设计 - 封面/尾页 ============
  {
    id: 'atm-cover-minimal',
    name: '极简封面',
    category: '封面',
    description: '左上角大标题，简洁高级，适合文艺风',
    thumbnail: 'cover-minimal',
    styleId: 'atmosphere',
    elements: [
      { type: 'image', x: 0, y: 0, width: 1, height: 1, cropHint: 'cover' },
      { type: 'text', x: 0.08, y: 0.15, width: 0.6, height: 0.1, placeholder: '时光印记', fontSizeRatio: 0.08, textAlign: 'left', fontWeight: 'bold', color: '#ffffff' },
      { type: 'text', x: 0.08, y: 0.26, width: 0.5, height: 0.04, placeholder: 'MEMORIES', fontSizeRatio: 0.025, textAlign: 'left', color: '#ffffff' },
      { type: 'text', x: 0.08, y: 0.85, width: 0.4, height: 0.04, placeholder: '2026', fontSizeRatio: 0.03, textAlign: 'left', color: '#ffffff' },
    ],
  },
  {
    id: 'atm-cover-travel-journal',
    name: '杂志封面',
    category: '封面',
    description: '白底大标题 + 满幅大图，左侧四角星与竖排 TIME 装饰，极简杂志风',
    thumbnail: 'cover-travel-journal',
    styleId: 'atmosphere',
    elements: [
      // 照片（满幅大图，四周留白；顶部文字区加大、图片高度减小）
      { type: 'image', x: 0.082, y: 0.431, width: 0.828, height: 0.506, cropHint: 'cover' },
      // 右上大标题（可修改，右侧对齐基准）
      { type: 'text', x: 0.667, y: 0.063, width: 0.256, height: 0.13, placeholder: '时间\n旅行纪', fontSizeRatio: 0.11, textAlign: 'right', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1.05 },
      // ——作者名（标题下方）
      { type: 'text', x: 0.663, y: 0.228, width: 0.256, height: 0.025, placeholder: '——作者名', fontSizeRatio: 0.031, textAlign: 'right', color: '#888888', lineHeight: 1, fixed: true },
      // 两个四角星（小、大，位于 TIME 上方）
      { type: 'text', x: 0.102, y: 0.074, width: 0.034, height: 0.026, placeholder: '✦', fontSizeRatio: 0.041, textAlign: 'center', color: '#1a1a1a', lineHeight: 1, fixed: true },
      { type: 'text', x: 0.136, y: 0.048, width: 0.046, height: 0.032, placeholder: '✦', fontSizeRatio: 0.055, textAlign: 'center', color: '#1a1a1a', lineHeight: 1, fixed: true },
      // TIME 竖排：每个字母单独向右旋转 90°，衬线字体
      { type: 'text', x: 0.126, y: 0.114, width: 0.062, height: 0.045, placeholder: 'T', fontSizeRatio: 0.167, textAlign: 'center', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1, rotation: 90, fontFamily: 'Georgia, "Times New Roman", serif', fixed: true },
      { type: 'text', x: 0.129, y: 0.17, width: 0.062, height: 0.045, placeholder: 'I', fontSizeRatio: 0.167, textAlign: 'center', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1, rotation: 90, fontFamily: 'Georgia, "Times New Roman", serif', fixed: true },
      { type: 'text', x: 0.129, y: 0.243, width: 0.062, height: 0.045, placeholder: 'M', fontSizeRatio: 0.167, textAlign: 'center', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1, rotation: 90, fontFamily: 'Georgia, "Times New Roman", serif', fixed: true },
      { type: 'text', x: 0.09, y: 0.306, width: 0.091, height: 0.079, placeholder: 'E', fontSizeRatio: 0.167, textAlign: 'center', fontWeight: 'normal', color: '#1a1a1a', lineHeight: 1, rotation: 90, fontFamily: 'Georgia, "Times New Roman", serif', fixed: true },
      // 标题下方中文小字（可修改，右侧与大标题对齐）
      { type: 'text', x: 0.489, y: 0.274, width: 0.43, height: 0.018, placeholder: '・这一路的风景 ・从我的视角展开', fontSizeRatio: 0.029, textAlign: 'right', color: '#555555', lineHeight: 1, fixed: true },
      // 对应英文大写（可修改，右侧对齐）
      { type: 'text', x: 0.489, y: 0.296, width: 0.43, height: 0.015, placeholder: 'THE SCENERY ALONG THE WAY FROM MY PERSPECTIVE', fontSizeRatio: 0.017, textAlign: 'right', color: '#999999', lineHeight: 1, fixed: true },
      // 见天地，见众生，见自己（可修改，右侧对齐）
      { type: 'text', x: 0.489, y: 0.334, width: 0.43, height: 0.02, placeholder: '见天地，见众生，见自己', fontSizeRatio: 0.043, textAlign: 'right', color: '#333333', lineHeight: 1, fixed: true },
      // 底部两行浅灰小字
      { type: 'text', x: 0.2, y: 0.96, width: 0.6, height: 0.012, placeholder: 'CHERISH EVERY MOMENT', fontSizeRatio: 0.017, textAlign: 'center', color: '#c8c8c8', lineHeight: 1, fixed: true },
      { type: 'text', x: 0.2, y: 0.973, width: 0.6, height: 0.012, placeholder: 'COLLECT BEAUTIFUL MEMORIES OF LIFE', fontSizeRatio: 0.017, textAlign: 'center', color: '#c8c8c8', lineHeight: 1, fixed: true },
    ],
  },
  {
    id: 'atm-ending-page',
    name: '尾页1',
    category: '尾页',
    description: '全幅大图+居中寄语，适合做尾页',
    thumbnail: 'ending-page',
    styleId: 'atmosphere',
    elements: [
      { type: 'image', x: 0, y: 0, width: 1, height: 1, cropHint: 'cover' },
      { type: 'text', x: 0.15, y: 0.3, width: 0.7, height: 0.1, placeholder: '未完待续', fontSizeRatio: 0.07, textAlign: 'center', fontWeight: 'bold', color: '#ffffff' },
      { type: 'text', x: 0.2, y: 0.45, width: 0.6, height: 0.15, placeholder: '每一段旅程都是一次成长，期待下一次出发。', fontSizeRatio: 0.03, textAlign: 'center', color: '#ffffff' },
      { type: 'text', x: 0.15, y: 0.7, width: 0.7, height: 0.05, placeholder: 'THANK YOU', fontSizeRatio: 0.025, textAlign: 'center', color: '#ffffff' },
    ],
  },
  {
    id: 'atm-ending-minimal',
    name: '尾页2',
    category: '尾页',
    description: '居中方形照片+未完待续+年份，简约文艺尾页',
    thumbnail: 'ending-minimal',
    styleId: 'atmosphere',
    elements: [
      // 居中方形照片
      { type: 'image', x: 0.309, y: 0.206, width: 0.378, height: 0.252, cropHint: 'cover' },
      // 未完待续
      { type: 'text', x: 0.199, y: 0.505, width: 0.602, height: 0.05, placeholder: '未完待续', fontSizeRatio: 0.033, textAlign: 'center', fontWeight: 'bold', color: '#333333' },
      // 年份（动态获取当前年份）
      { type: 'text', x: 0.199, y: 0.547, width: 0.602, height: 0.04, placeholder: '{year}', fontSizeRatio: 0.031, textAlign: 'center', fontWeight: 'normal', color: '#333333' },
    ],
  },

  // ============ 图片为主 ============
  {
    id: 'full-image',
    name: '单图满版',
    category: '一图',
    description: '一张大图铺满全页，底部留空间加文字',
    thumbnail: 'full',
    elements: [
      { type: 'image', x: 0, y: 0, width: 1, height: 0.82, cropHint: 'cover' },
      { type: 'text', x: 0.08, y: 0.85, width: 0.84, height: 0.1, placeholder: '在这里写标题', fontSizeRatio: 0.06, textAlign: 'center', fontWeight: 'bold', color: '#333333' },
    ],
  },
  {
    id: 'full-image-bordered',
    name: '满版图（带边框）',
    category: '一图',
    description: '一张图填满页面，四周留白边框，无文案',
    thumbnail: 'full-bordered',
    elements: [
      { type: 'image', x: 0.05, y: 0.05, width: 0.9, height: 0.9, cropHint: 'cover' },
    ],
  },
  {
    id: 'image-top-text-bottom',
    name: '上图下文',
    category: '一图',
    description: '上方大图，下方文字区域，经典旅行日记版式',
    thumbnail: 'top-bottom',
    elements: [
      { type: 'image', x: 0.06, y: 0.05, width: 0.88, height: 0.55, cropHint: 'cover' },
      { type: 'text', x: 0.1, y: 0.64, width: 0.8, height: 0.08, placeholder: '标题', fontSizeRatio: 0.055, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      { type: 'text', x: 0.1, y: 0.73, width: 0.8, height: 0.2, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
    ],
  },
  {
    id: 'text-top-image-bottom',
    name: '上文下图',
    category: '一图',
    description: '上方文字区域，下方大图，适合开篇寄语或章节页',
    thumbnail: 'text-top-image-bottom',
    elements: [
      { type: 'text', x: 0.1, y: 0.136, width: 0.8, height: 0.08, placeholder: '标题', fontSizeRatio: 0.055, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      { type: 'text', x: 0.1, y: 0.241, width: 0.8, height: 0.2, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      { type: 'image', x: 0.06, y: 0.40, width: 0.88, height: 0.55, cropHint: 'cover' },
    ],
  },
  // ============ 图文混排 ============
  {
    id: 'image-left-text-right',
    name: '左图右文',
    category: '一图',
    description: '左侧图片，右侧文字，三段正文段间有空隙',
    thumbnail: 'left-right',
    elements: [
      { type: 'image', x: 0.05, y: 0.08, width: 0.5, height: 0.84, cropHint: 'cover' },
      { type: 'text', x: 0.6, y: 0.12, width: 0.35, height: 0.08, placeholder: '标题', fontSizeRatio: 0.06, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      { type: 'text', x: 0.6, y: 0.24, width: 0.35, height: 0.18, placeholder: '第一段...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      { type: 'text', x: 0.6, y: 0.44, width: 0.35, height: 0.18, placeholder: '第二段...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      { type: 'text', x: 0.6, y: 0.64, width: 0.35, height: 0.18, placeholder: '第三段...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
    ],
  },
  {
    id: 'text-left-image-right',
    name: '左文右图',
    category: '一图',
    description: '左侧文字，右侧图片，三段正文段间有空隙',
    thumbnail: 'right-left',
    elements: [
      { type: 'text', x: 0.08, y: 0.12, width: 0.337, height: 0.08, placeholder: '标题', fontSizeRatio: 0.06, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      { type: 'text', x: 0.08, y: 0.24, width: 0.337, height: 0.18, placeholder: '第一段...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      { type: 'text', x: 0.08, y: 0.44, width: 0.337, height: 0.18, placeholder: '第二段...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      { type: 'text', x: 0.08, y: 0.64, width: 0.337, height: 0.18, placeholder: '第三段...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      { type: 'image', x: 0.45, y: 0.08, width: 0.5, height: 0.84, cropHint: 'cover' },
    ],
  },
  {
    id: 'one-stamp-diagonal',
    name: '1.1',
    category: '一图',
    styleId: 'atmosphere',
    description: '居中邮票选区+左上到右下斜向散落英文字母，文艺拼贴感',
    thumbnail: 'one-stamp',
    elements: [
      // 居中邮票选区
      { type: 'image', x: 0.225, y: 0.2571, width: 0.55, height: 0.4857, cropHint: 'cover', stampEdge: true },
      // 斜向散落英文字母（固定装饰文字，不填充文案）
      { type: 'text', x: 0.0676, y: 0.0476, width: 0.0541, height: 0.0381, placeholder: 'A', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -15 },
      { type: 'text', x: 0.1689, y: 0.0952, width: 0.0541, height: 0.0381, placeholder: 'B', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 20 },
      { type: 'text', x: 0.1014, y: 0.1667, width: 0.0541, height: 0.0381, placeholder: 'C', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -25 },
      { type: 'text', x: 0.2365, y: 0.1905, width: 0.0541, height: 0.0381, placeholder: 'D', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 10 },
      { type: 'text', x: 0.1351, y: 0.2619, width: 0.0541, height: 0.0381, placeholder: 'E', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -20 },
      { type: 'text', x: 0.3041, y: 0.2857, width: 0.0541, height: 0.0381, placeholder: 'F', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 15 },
      { type: 'text', x: 0.2027, y: 0.3571, width: 0.0541, height: 0.0381, placeholder: 'G', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -10 },
      { type: 'text', x: 0.3716, y: 0.381, width: 0.0541, height: 0.0381, placeholder: 'H', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 25 },
      { type: 'text', x: 0.2703, y: 0.4524, width: 0.0541, height: 0.0381, placeholder: 'I', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -15 },
      { type: 'text', x: 0.4392, y: 0.4762, width: 0.0541, height: 0.0381, placeholder: 'J', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 20 },
      { type: 'text', x: 0.3378, y: 0.5476, width: 0.0541, height: 0.0381, placeholder: 'K', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -20 },
      { type: 'text', x: 0.5068, y: 0.5714, width: 0.0541, height: 0.0381, placeholder: 'L', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 10 },
      { type: 'text', x: 0.4054, y: 0.6429, width: 0.0541, height: 0.0381, placeholder: 'M', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -25 },
      { type: 'text', x: 0.5743, y: 0.6667, width: 0.0541, height: 0.0381, placeholder: 'N', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 15 },
      { type: 'text', x: 0.473, y: 0.7381, width: 0.0541, height: 0.0381, placeholder: 'O', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -10 },
      { type: 'text', x: 0.6419, y: 0.7619, width: 0.0541, height: 0.0381, placeholder: 'P', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 20 },
      { type: 'text', x: 0.5405, y: 0.8333, width: 0.0541, height: 0.0381, placeholder: 'Q', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -15 },
      { type: 'text', x: 0.7095, y: 0.8571, width: 0.0541, height: 0.0381, placeholder: 'R', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 25 },
      { type: 'text', x: 0.6081, y: 0.9048, width: 0.0541, height: 0.0381, placeholder: 'S', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -20 },
      { type: 'text', x: 0.777, y: 0.9286, width: 0.0541, height: 0.0381, placeholder: 'T', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 10 },
      { type: 'text', x: 0.1216, y: 0.0714, width: 0.0541, height: 0.0381, placeholder: 'U', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 10 },
      { type: 'text', x: 0.2162, y: 0.1333, width: 0.0541, height: 0.0381, placeholder: 'V', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -15 },
      { type: 'text', x: 0.1486, y: 0.2, width: 0.0541, height: 0.0381, placeholder: 'W', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 20 },
      { type: 'text', x: 0.2838, y: 0.2381, width: 0.0541, height: 0.0381, placeholder: 'X', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -10 },
      { type: 'text', x: 0.1892, y: 0.3095, width: 0.0541, height: 0.0381, placeholder: 'Y', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 15 },
      { type: 'text', x: 0.3514, y: 0.3333, width: 0.0541, height: 0.0381, placeholder: 'Z', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -20 },
      { type: 'text', x: 0.2568, y: 0.4048, width: 0.0541, height: 0.0381, placeholder: 'A', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 25 },
      { type: 'text', x: 0.4189, y: 0.4286, width: 0.0541, height: 0.0381, placeholder: 'B', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -15 },
      { type: 'text', x: 0.3243, y: 0.5, width: 0.0541, height: 0.0381, placeholder: 'C', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 10 },
      { type: 'text', x: 0.4865, y: 0.5238, width: 0.0541, height: 0.0381, placeholder: 'D', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -25 },
      { type: 'text', x: 0.3919, y: 0.5952, width: 0.0541, height: 0.0381, placeholder: 'E', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 20 },
      { type: 'text', x: 0.5541, y: 0.619, width: 0.0541, height: 0.0381, placeholder: 'F', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -10 },
      { type: 'text', x: 0.4595, y: 0.6905, width: 0.0541, height: 0.0381, placeholder: 'G', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 15 },
      { type: 'text', x: 0.6216, y: 0.7143, width: 0.0541, height: 0.0381, placeholder: 'H', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -20 },
      { type: 'text', x: 0.527, y: 0.7857, width: 0.0541, height: 0.0381, placeholder: 'I', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 25 },
      { type: 'text', x: 0.6892, y: 0.8095, width: 0.0541, height: 0.0381, placeholder: 'J', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -15 },
      { type: 'text', x: 0.5946, y: 0.8667, width: 0.0541, height: 0.0381, placeholder: 'K', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 10 },
      { type: 'text', x: 0.7297, y: 0.8952, width: 0.0541, height: 0.0381, placeholder: 'L', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -25 },
      { type: 'text', x: 0.6622, y: 0.9429, width: 0.0541, height: 0.0381, placeholder: 'M', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: 20 },
      { type: 'text', x: 0.8108, y: 0.9524, width: 0.0541, height: 0.0381, placeholder: 'N', fixed: true, locked: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', rotation: -10 },
    ],
  },
  {
    id: 'atm-one-full',
    name: '1.2',
    category: '一图',
    styleId: 'atmosphere',
    description: '一张照片铺满整张页面，无装饰，极简沉浸感',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0, y: 0, width: 1, height: 1, cropHint: 'cover' },
    ],
  },
  {
    id: 'atm-one-film-letters',
    name: '1.3',
    category: '一图',
    styleId: 'atmosphere',
    description: '胶卷横图居中+彩色英文字母散落装饰+TO THE GOOD DAYS标题，复古拼贴感',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.1482, y: 0.3177, width: 0.6974, height: 0.3702, cropHint: 'cover', filmEdge: true },
      { type: 'text', x: 0.4755, y: 0.1388, width: 0.3893, height: 0.0952, placeholder: '"TOTHEGOODDAYS."', fixed: true, fontSizeRatio: 0.0477, textAlign: 'right', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      // 左上角散落字母
      { type: 'text', x: 0.175, y: 0.2114, width: 0.1112, height: 0.0671, placeholder: 'A', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#bd4c4c', lineHeight: 1.5, rotation: -12.48 },
      { type: 'text', x: 0.246, y: 0.2114, width: 0.0742, height: 0.0451, placeholder: 'B', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#729d6c', lineHeight: 1.5 },
      { type: 'text', x: 0.309, y: 0.245, width: 0.0907, height: 0.0592, placeholder: 'C', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#eed349', lineHeight: 1.5 },
      { type: 'text', x: 0.3997, y: 0.2746, width: 0.0863, height: 0.0452, placeholder: 'D', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.175, y: 0.2742, width: 0.0914, height: 0.0435, placeholder: 'E', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#8689ee', lineHeight: 1.5 },
      { type: 'text', x: 0.2433, y: 0.2562, width: 0.0796, height: 0.0506, placeholder: 'F', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#d23737', lineHeight: 1.5, rotation: -35.86 },
      { type: 'text', x: 0.2879, y: 0.2995, width: 0.0701, height: 0.0398, placeholder: 'G', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#c729a5', lineHeight: 1.5, rotation: 19.12 },
      // 右下角散落字母
      { type: 'text', x: 0.4969, y: 0.7062, width: 0.1011, height: 0.0431, placeholder: 'E', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#8689ee', lineHeight: 1.5, rotation: -13.43 },
      { type: 'text', x: 0.5697, y: 0.7493, width: 0.0954, height: 0.0543, placeholder: 'F', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#d23737', lineHeight: 1.5, rotation: -12.39 },
      { type: 'text', x: 0.6378, y: 0.795, width: 0.1045, height: 0.0671, placeholder: 'G', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#c729a5', lineHeight: 1.5, rotation: 9.45 },
      { type: 'text', x: 0.7571, y: 0.7836, width: 0.1363, height: 0.0585, placeholder: 'H', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#3fd534', lineHeight: 1.5, rotation: -4.66 },
      { type: 'text', x: 0.598, y: 0.7062, width: 0.0878, height: 0.043, placeholder: 'A', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#bd4c4c', lineHeight: 1.5 },
      { type: 'text', x: 0.6701, y: 0.7131, width: 0.1443, height: 0.0474, placeholder: 'B', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#729d6c', lineHeight: 1.5, rotation: -22.31 },
      { type: 'text', x: 0.7676, y: 0.7152, width: 0.1342, height: 0.0531, placeholder: 'C', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#eed349', lineHeight: 1.5, rotation: -14.42 },
      // 底部文案
      { type: 'text', x: 0.0997, y: 0.8621, width: 0.6, height: 0.0952, placeholder: 'This is our story, told not in perfect words, but in honest moments, captured one photo at a time.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-one-bottom-text',
    name: '1.4',
    category: '一图',
    styleId: 'atmosphere',
    description: '上方大图铺满+底部手写体memonts大字标题，极简文艺',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0, y: 0, width: 1, height: 0.7971, cropHint: 'cover' },
      { type: 'text', x: 0.1993, y: 0.8545, width: 0.6, height: 0.0952, placeholder: 'memonts', fixed: true, fontSizeRatio: 0.1239, textAlign: 'center', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5, fontFamily: '"Great Vibes", cursive' },
    ],
  },
  {
    id: 'atm-one-top-text-bottom',
    name: '1.5',
    category: '一图',
    styleId: 'atmosphere',
    description: '上方右对齐正文+下方大图，上文字下图留白式排版',
    thumbnail: '',
    elements: [
      { type: 'text', x: 0.2762, y: 0.105, width: 0.6587, height: 0.0952, placeholder: 'Life moves fast, but in these pages, we can slow it down, hold on a little longer, and remember how it felt to be here.', fixed: true, fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.0645, y: 0.5138, width: 0.8704, height: 0.4339, cropHint: 'cover' },
    ],
  },
  {
    id: 'atm-one-film-center',
    name: '1.6',
    category: '一图',
    styleId: 'atmosphere',
    description: '中间胶卷横图+右上camera film标题+下方正文，复古胶卷感',
    thumbnail: '',
    elements: [
      { type: 'text', x: 0.4354, y: 0.2024, width: 0.4146, height: 0.0564, placeholder: 'camera film', fixed: true, fontSizeRatio: 0.0715, textAlign: 'right', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'image', x: 0.15, y: 0.2915, width: 0.7, height: 0.3947, cropHint: 'cover', filmEdge: true },
      { type: 'text', x: 0.15, y: 0.7478, width: 0.6973, height: 0.0952, placeholder: 'Life moves fast, but in these pages, we can slow it down, hold on a little longer, and remember how it felt to be here.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-one-center-hashtag',
    name: '1.7',
    category: '一图',
    styleId: 'atmosphere',
    description: '中间大图居中+左上#adventures+右下#here is to good times.标签',
    thumbnail: '',
    elements: [
      { type: 'text', x: 0.1181, y: 0.1681, width: 0.3673, height: 0.0418, placeholder: '#adventures', fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.1777, y: 0.2241, width: 0.6608, height: 0.5288, cropHint: 'cover' },
      { type: 'text', x: 0.4716, y: 0.7987, width: 0.4298, height: 0.0432, placeholder: '#here is to good times.', fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  // ============ 多图拼贴 ============
  {
    id: 'two-images-stack',
    name: '双图横板',
    category: '二图',
    description: '上下两张图片，中间留白，简洁干净',
    thumbnail: 'two-stack',
    elements: [
      { type: 'image', x: 0.08, y: 0.05, width: 0.84, height: 0.4381, cropHint: 'cover' },
      { type: 'image', x: 0.08, y: 0.512, width: 0.84, height: 0.4381, cropHint: 'cover' },
    ],
  },
  {
    id: 'two-images-slanted',
    name: '双图留白',
    category: '二图',
    description: '上下两张横图居中，大量留白，左上角配小字文案，文艺感强',
    thumbnail: 'two-slanted',
    elements: [
      // 左上角小字文案（宽度96mm，与上图间距8mm）
      { type: 'text', x: 0.12, y: 0.148, width: 0.6486, height: 0.03, placeholder: '出发的意义从来都不是赶路', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      // 上方横图（下移，与下图间距5mm）
      { type: 'image', x: 0.12, y: 0.216, width: 0.76, height: 0.32, cropHint: 'cover' },
      // 下方横图（位置不变）
      { type: 'image', x: 0.12, y: 0.56, width: 0.76, height: 0.32, cropHint: 'cover' },
    ],
  },
  {
    id: 'two-diagonal-text',
    name: '对角图文',
    category: '二图',
    description: '两张照片对角排列，左上右下各配一段正文文字',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.0639, y: 0.0714, width: 0.4392, height: 0.4226, cropHint: 'cover' },
      { type: 'image', x: 0.5031, y: 0.5092, width: 0.4392, height: 0.4229, cropHint: 'cover' },
      { type: 'text', x: 0.5746, y: 0.1647, width: 0.3134, height: 0.2359, placeholder: '有些风景，只有亲自站在那里才能感受。风的味道、光的温度，都成了记忆里最珍贵的部分。不用刻意寻找，最美的瞬间往往就在不经意的转角。把这些瞬间都收藏起来，在往后的日子里慢慢回味。', body: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.0882, y: 0.6191, width: 0.357, height: 0.2031, placeholder: '旅行的意义，不在于去了多少地方，而在于在路上遇见的那些人、那些事，以及那个不一样的自己。把烦恼丢在身后，把期待装进行囊，去看看这个世界的美好。', body: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'three-collage',
    name: '三图拼贴',
    category: '三图',
    description: '一大两小的杂志风拼贴，活泼有层次',
    thumbnail: 'three-collage',
    elements: [
      { type: 'image', x: 0.05, y: 0.05, width: 0.599, height: 0.55, cropHint: 'cover' },
      { type: 'image', x: 0.67, y: 0.05, width: 0.28, height: 0.267, cropHint: 'cover' },
      { type: 'image', x: 0.67, y: 0.329, width: 0.28, height: 0.271, cropHint: 'cover' },
      { type: 'text', x: 0.074, y: 0.64, width: 0.84, height: 0.08, placeholder: '与你有关', fontSizeRatio: 0.05, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      { type: 'text', x: 0.08, y: 0.74, width: 0.84, height: 0.18, placeholder: '生活碎片，拼凑成光', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
    ],
  },
  {
    id: 'three-collage-v2',
    name: '三图错落',
    category: '三图',
    description: '左上大图+右上文字小图+底部横图，层次丰富',
    thumbnail: 'three-collage-v2',
    elements: [
      // 左上大图
      { type: 'image', x: 0.05, y: 0.05, width: 0.55, height: 0.55, cropHint: 'cover' },
      // 右上角标题
      { type: 'text', x: 0.64, y: 0.06, width: 0.31, height: 0.06, placeholder: '慢慢生活', fontSizeRatio: 0.045, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      // 右上角正文
      { type: 'text', x: 0.64, y: 0.14, width: 0.31, height: 0.15, placeholder: '岁月悠长，愿我们都能在这平凡的日子里，找到属于自己的那束光，慢慢生活，好好感受每一个当下。', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      // 右中竖版小图
      { type: 'image', x: 0.624, y: 0.32, width: 0.326, height: 0.28, cropHint: 'cover' },
      // 底部横版大图
      { type: 'image', x: 0.05, y: 0.624, width: 0.9, height: 0.326, cropHint: 'cover' },
    ],
  },
  {
    id: 'three-top-bottom',
    name: '三图上下排版',
    category: '三图',
    description: '上方横版大图+下方两张竖版小图，底部配标题和正文，适合家庭回忆照',
    thumbnail: 'three-top-bottom',
    elements: [
      // 上方横版大图
      { type: 'image', x: 0.1, y: 0.05, width: 0.8, height: 0.314, cropHint: 'cover' },
      // 下方左图
      { type: 'image', x: 0.1, y: 0.38, width: 0.389, height: 0.3, cropHint: 'cover' },
      // 下方右图
      { type: 'image', x: 0.512, y: 0.38, width: 0.389, height: 0.3, cropHint: 'cover' },
      // 右下角标题
      { type: 'text', x: 0.52, y: 0.724, width: 0.38, height: 0.05, placeholder: '人间值得', fontSizeRatio: 0.045, textAlign: 'right', fontWeight: 'bold', color: '#2c2c2c' },
      // 左下角正文
      { type: 'text', x: 0.1, y: 0.749, width: 0.5, height: 0.18, placeholder: '这一天，在姥姥家里，那真是一段快乐的时光。姐姐从学校借回来的相机，三个人分别和姥姥、老爷合照，现在想起来还是会笑出声……', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
    ],
  },
  {
    id: 'three-stairs',
    name: '三图阶梯',
    category: '三图',
    description: '三张竖版照片从左下到右上阶梯错落排列，左上角配标题和短句文案',
    thumbnail: 'three-stairs',
    elements: [
      // 标题
      { type: 'text', x: 0.093, y: 0.139, width: 0.5, height: 0.06, placeholder: '时光印记', fontSizeRatio: 0.05, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      // 文案（两行短句）
      { type: 'text', x: 0.093, y: 0.199, width: 0.5, height: 0.1, placeholder: '双击编辑文字\n双击编辑文字', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333', lineHeight: 1.5 },
      // 左下方第一张
      { type: 'image', x: 0.059, y: 0.452, width: 0.284, height: 0.429, cropHint: 'cover' },
      // 中间第二张
      { type: 'image', x: 0.362, y: 0.321, width: 0.284, height: 0.429, cropHint: 'cover' },
      // 右上方第三张
      { type: 'image', x: 0.666, y: 0.183, width: 0.284, height: 0.429, cropHint: 'cover' },
      // 右下角一行文案（从文案库映射，右对齐）
      { type: 'text', x: 0.5358, y: 0.8457, width: 0.3655, height: 0.041, placeholder: '在这里写下一句感悟...', body: true, shortBody: true, fontSizeRatio: 0.0191, textAlign: 'right', fontWeight: 'normal', color: '#333333' },
    ],
  },
  {
    id: 'atm-three-snapshots',
    name: '3.1',
    category: '三图',
    description: '三图错落排列+英文装饰文字，文艺快照风格',
    thumbnail: '',
    styleId: 'atmosphere',
    blackType: 1,
    elements: [
      // 第1张图
      { type: 'image', x: 0.15, y: 0.1615, width: 0.4459, height: 0.1905, cropHint: 'cover' },
      // 第2张图
      { type: 'image', x: 0.3798, y: 0.381, width: 0.4459, height: 0.1905, cropHint: 'cover' },
      // 第3张图
      { type: 'image', x: 0.15, y: 0.6013, width: 0.4459, height: 0.1905, cropHint: 'cover' },
      // 装饰英文 Snapshots（Playfair Display，固定内容）
      { type: 'text', x: 0.1277, y: 0.4563, width: 0.1929, height: 0.0398, placeholder: 'Snapshots', fixed: true, fontSizeRatio: 0.0477, textAlign: 'left', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Playfair Display", serif' },
      // 装饰英文 Moments（固定内容）
      { type: 'text', x: 0.6537, y: 0.2398, width: 0.2593, height: 0.0545, placeholder: 'Moments', fixed: true, fontSizeRatio: 0.0477, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      // 装饰英文 Fragments（固定内容）
      { type: 'text', x: 0.6452, y: 0.6833, width: 0.2678, height: 0.0543, placeholder: 'Fragments', fixed: true, fontSizeRatio: 0.0477, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      // 底部标题 Forever memories.（固定内容，居中加粗）
      { type: 'text', x: 0.2242, y: 0.8715, width: 0.6, height: 0.0645, placeholder: 'Forever memories.', fixed: true, fontSizeRatio: 0.0548, textAlign: 'center', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-three-left-big',
    name: '3.2',
    category: '三图',
    styleId: 'atmosphere',
    description: '左侧竖版大图占满高度，右侧上下两张小图错落叠放，杂志拼贴感',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0, y: 0, width: 0.7, height: 1, cropHint: 'cover' },
      { type: 'image', x: 0.6097, y: 0.1149, width: 0.2988, height: 0.2417, cropHint: 'cover', rotation: -13.85, cardEdge: true },
      { type: 'image', x: 0.5837, y: 0.3198, width: 0.2748, height: 0.2321, cropHint: 'cover', cardEdge: true },
    ],
  },
  {
    id: 'atm-three-row-labels',
    name: '3.3',
    category: '三图',
    styleId: 'atmosphere',
    description: '三张横图等距横排居中，每张上方配标签文字，简约整齐',
    thumbnail: '',
    elements: [
      { type: 'text', x: 0.0561, y: 0.3191, width: 0.276, height: 0.037, placeholder: '#Memories', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.355, y: 0.3212, width: 0.3052, height: 0.0328, placeholder: '#Snapshots', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.6601, y: 0.3212, width: 0.2095, height: 0.0296, placeholder: '#Treasures', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.0561, y: 0.3561, width: 0.2838, height: 0.2335, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.3581, y: 0.3561, width: 0.2838, height: 0.2351, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.6601, y: 0.3561, width: 0.2838, height: 0.2359, cropHint: 'cover', borderWidth: 0.5 },
    ],
  },
  {
    id: 'atm-three-vertical-center',
    name: '3.4',
    category: '三图',
    styleId: 'atmosphere',
    description: '三张横图垂直居中排列，等宽等高，0.5mm黑边，极简竖列',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.3142, y: 0.1368, width: 0.3378, height: 0.2143, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.3142, y: 0.3776, width: 0.3378, height: 0.2143, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.3142, y: 0.6184, width: 0.3378, height: 0.2143, cropHint: 'cover', borderWidth: 0.5 },
    ],
  },
  {
    id: 'atm-three-stamp-right',
    name: '3.5',
    category: '三图',
    styleId: 'atmosphere',
    description: '左上邮票小图+右侧大标题+中间大图+底部小横图，杂志错落感',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.1118, y: 0.094, width: 0.2712, height: 0.2124, cropHint: 'cover', stampEdge: true },
      { type: 'text', x: 0.4789, y: 0.2002, width: 0.4333, height: 0.0623, placeholder: 'Chill time', fixed: true, fontSizeRatio: 0.0763, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'text', x: 0.5446, y: 0.2817, width: 0.4013, height: 0.0494, placeholder: 'These days were golden.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.5446, y: 0.3311, width: 0.4397, height: 0.0952, placeholder: 'Moments worth keeping forever.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.3146, y: 0.4524, width: 0.6314, height: 0.2753, cropHint: 'cover' },
      { type: 'image', x: 0.1118, y: 0.7682, width: 0.5184, height: 0.1868, cropHint: 'cover' },
    ],
  },
  {
    id: 'atm-three-top-two-bottom',
    name: '3.6',
    category: '三图',
    styleId: 'atmosphere',
    description: '上方两张小横图并排+中间标题正文+底部右张大图，日记排版',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.0552, y: 0.0497, width: 0.2703, height: 0.2322, cropHint: 'cover' },
      { type: 'image', x: 0.3412, y: 0.0497, width: 0.2703, height: 0.2322, cropHint: 'cover' },
      { type: 'text', x: 0.1903, y: 0.3976, width: 0.3769, height: 0.0952, placeholder: 'Life lately', fixed: true, fontSizeRatio: 0.0763, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5 },
      { type: 'text', x: 0.1903, y: 0.4692, width: 0.6523, height: 0.0952, placeholder: 'Some days are ordinary while they\u2019re happening, but when you look back, you realize they were the best ones.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.301, y: 0.6538, width: 0.6172, height: 0.3212, cropHint: 'cover' },
    ],
  },
  {
    id: 'three-title-top',
    name: '三图顶标题底正文',
    category: '三图',
    description: '顶部标题+中间左大图右两小图+底部正文，简约文艺',
    thumbnail: 'three-title-top',
    elements: [
      // 右上角装饰英文（固定内容，不填充文案）
      { type: 'text', x: 0.3189, y: 0.0614, width: 0.6, height: 0.0348, placeholder: 'HAVEAGOODTIME', fixed: true, fontSizeRatio: 0.0191, textAlign: 'right', fontWeight: 'normal', color: '#333333' },
      // 标题
      { type: 'text', x: 0.0927, y: 0.1091, width: 0.84, height: 0.08, placeholder: '在这里写标题', fontSizeRatio: 0.05, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      // 左中大图
      { type: 'image', x: 0.0927, y: 0.1891, width: 0.5094, height: 0.5038, cropHint: 'cover' },
      // 右上小图
      { type: 'image', x: 0.6189, y: 0.1891, width: 0.2838, height: 0.2452, cropHint: 'cover' },
      // 右中小图
      { type: 'image', x: 0.6189, y: 0.4462, width: 0.2838, height: 0.2452, cropHint: 'cover' },
      // 正文
      { type: 'text', x: 0.0927, y: 0.7609, width: 0.8116, height: 0.1229, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'three-top-two-bottom-wide',
    name: '三图上两下横',
    category: '三图',
    description: '顶部右对齐标题+上方两小图+中间横大图+底部正文，错落有致',
    thumbnail: 'three-top-two-bottom-wide',
    elements: [
      // 标题（右对齐）
      { type: 'text', x: 0.4899, y: 0.8319, width: 0.3797, height: 0.05, placeholder: '在这里写标题', fontSizeRatio: 0.0548, textAlign: 'right', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5 },
      // 左上小图
      { type: 'image', x: 0.1169, y: 0.2533, width: 0.373, height: 0.2618, cropHint: 'cover' },
      // 右上小图
      { type: 'image', x: 0.5074, y: 0.2533, width: 0.373, height: 0.2618, cropHint: 'cover' },
      // 中间横大图
      { type: 'image', x: 0.1169, y: 0.5271, width: 0.7635, height: 0.2619, cropHint: 'cover' },
      // 正文
      { type: 'text', x: 0.1169, y: 0.1414, width: 0.7722, height: 0.0776, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'four-literary',
    name: '四图文艺排版',
    category: '四图',
    description: '四张图错落排列+底部标题正文，文艺杂志风，适合旅行感悟',
    thumbnail: 'four-literary',
    elements: [
      // 左上（大图）
      { type: 'image', x: 0.0797, y: 0.084, width: 0.498, height: 0.245, cropHint: 'cover' },
      // 右上（小图）
      { type: 'image', x: 0.6, y: 0.084, width: 0.324, height: 0.245, cropHint: 'cover' },
      // 左下（小图）
      { type: 'image', x: 0.0797, y: 0.346, width: 0.324, height: 0.245, cropHint: 'cover' },
      // 右下（大图）
      { type: 'image', x: 0.426, y: 0.346, width: 0.498, height: 0.245, cropHint: 'cover' },
      // 标题
      { type: 'text', x: 0.1, y: 0.678, width: 0.8, height: 0.05, placeholder: '标题', fontSizeRatio: 0.045, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      // 正文
      { type: 'text', x: 0.1, y: 0.744, width: 0.8, height: 0.15, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      // 三个点装饰
      { type: 'text', x: 0.4, y: 0.90, width: 0.2, height: 0.02, placeholder: '● ● ●', fontSizeRatio: 0.02, textAlign: 'center', color: '#333333', lineHeight: 1, fixed: true },
    ],
  },
  {
    id: 'four-grid',
    name: '四图网格',
    category: '四图',
    description: '2x2 均匀网格，适合展示系列照片',
    thumbnail: 'four-grid',
    elements: [
      { type: 'image', x: 0.0588, y: 0.05, width: 0.43, height: 0.4381, cropHint: 'cover' },
      { type: 'image', x: 0.5135, y: 0.05, width: 0.43, height: 0.4381, cropHint: 'cover' },
      { type: 'image', x: 0.0588, y: 0.5081, width: 0.43, height: 0.4381, cropHint: 'cover' },
      { type: 'image', x: 0.5135, y: 0.5081, width: 0.43, height: 0.4381, cropHint: 'cover' },
    ],
  },
  {
    id: 'four-magazine',
    name: '四图杂志风',
    category: '四图',
    description: '左大右小错落布局，杂志感十足',
    thumbnail: 'four-magazine',
    elements: [
      // 左上大图
      { type: 'image', x: 0.05, y: 0.05, width: 0.62, height: 0.55, cropHint: 'cover' },
      // 右上小图1
      { type: 'image', x: 0.6932, y: 0.05, width: 0.25, height: 0.266, cropHint: 'cover' },
      // 右上小图2
      { type: 'image', x: 0.6932, y: 0.3305, width: 0.25, height: 0.269, cropHint: 'cover' },
      // 底部横大图
      { type: 'image', x: 0.05, y: 0.6167, width: 0.8919, height: 0.3333, cropHint: 'cover' },
    ],
  },
  {
    id: 'four-grid-whitespace',
    name: '四图留白',
    category: '四图',
    description: '2x2田字格四张图，四周大量留白，底部配标题和正文，文艺感强',
    thumbnail: 'four-grid-ws',
    elements: [
      // 左上
      { type: 'image', x: 0.12, y: 0.08, width: 0.368, height: 0.314, cropHint: 'cover' },
      // 右上
      { type: 'image', x: 0.512, y: 0.08, width: 0.368, height: 0.314, cropHint: 'cover' },
      // 左下
      { type: 'image', x: 0.12, y: 0.411, width: 0.368, height: 0.314, cropHint: 'cover' },
      // 右下
      { type: 'image', x: 0.512, y: 0.411, width: 0.368, height: 0.314, cropHint: 'cover' },
      // 底部标题（右下角）
      { type: 'text', x: 0.5, y: 0.78, width: 0.38, height: 0.05, placeholder: '标题', fontSizeRatio: 0.045, textAlign: 'right', fontWeight: 'bold', color: '#2c2c2c' },
      // 底部正文（左下角）
      { type: 'text', x: 0.12, y: 0.84, width: 0.5, height: 0.12, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
    ],
  },
  {
    id: 'four-left3-right1',
    name: '四图三小一大',
    category: '四图',
    description: '左列三张小竖图，右列一张大图，底部带文案',
    thumbnail: 'four-left3-right1',
    elements: [
      // 左列三张小图
      { type: 'image', x: 0.0791, y: 0.05, width: 0.32, height: 0.2048, cropHint: 'cover' },
      { type: 'image', x: 0.0791, y: 0.2676, width: 0.32, height: 0.2048, cropHint: 'cover' },
      { type: 'image', x: 0.0791, y: 0.4852, width: 0.32, height: 0.2048, cropHint: 'cover' },
      // 右边大图
      { type: 'image', x: 0.4168, y: 0.05, width: 0.5, height: 0.64, cropHint: 'cover' },
      // 底部标题
      { type: 'text', x: 0.073, y: 0.7353, width: 0.7162, height: 0.05, placeholder: '在这里写标题', fontSizeRatio: 0.05, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      // 底部正文
      { type: 'text', x: 0.073, y: 0.7953, width: 0.7162, height: 0.16, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333', lineHeight: 1.5 },
    ],
  },
  // ============ 文字为主 ============
  {
    id: 'text-cover',
    name: '文字封面',
    category: '文字封面',
    description: '大标题+副标题，适合做封面或章节页',
    thumbnail: 'text-cover',
    elements: [
      { type: 'text', x: 0.1, y: 0.3, width: 0.8, height: 0.15, placeholder: '大标题', fontSizeRatio: 0.1, textAlign: 'center', fontWeight: 'bold', color: '#2c2c2c' },
      { type: 'text', x: 0.15, y: 0.48, width: 0.7, height: 0.08, placeholder: '副标题 / 日期', fontSizeRatio: 0.04, textAlign: 'center', color: '#888888' },
      { type: 'text', x: 0.2, y: 0.62, width: 0.6, height: 0.15, placeholder: '一段简短的引言或寄语...', body: true, fontSizeRatio: 0.031, textAlign: 'center', color: '#333333' },
    ],
  },
  // ============ 特殊样式 ============
  {
    id: 'dual-portrait',
    name: '双图竖版',
    category: '二图',
    description: '两张竖版照片并列，上下加标题和文案',
    thumbnail: 'dual-portrait',
    elements: [
      // 顶部小标签（固定文字，不填充文案）
      { type: 'text', x: 0.08, y: 0.06, width: 0.2, height: 0.03, placeholder: '旅行碎片', fontSizeRatio: 0.02, textAlign: 'left', color: '#999999', fixed: true },
      // 大标题
      { type: 'text', x: 0.08, y: 0.12, width: 0.6, height: 0.08, placeholder: '这里写标题', fontSizeRatio: 0.06, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      // 左图
      { type: 'image', x: 0.0764, y: 0.24, width: 0.4189, height: 0.58, cropHint: 'cover' },
      // 右图
      { type: 'image', x: 0.5034, y: 0.24, width: 0.4189, height: 0.58, cropHint: 'cover' },
      // 正文
      { type: 'text', x: 0.08, y: 0.86, width: 0.5676, height: 0.1, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
    ],
  },
  {
    id: 'atm-two-collage',
    name: '2.1',
    category: '二图',
    styleId: 'atmosphere',
    description: '左上图+右下长图错落排列，配英文装饰字和大号DATA TIME文字，杂志拼贴感',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.0752, y: 0.1012, width: 0.4158, height: 0.3064, cropHint: 'cover' },
      { type: 'image', x: 0.2279, y: 0.6457, width: 0.7, height: 0.3, cropHint: 'cover' },
      { type: 'text', x: 0.5615, y: 0.1972, width: 0.2985, height: 0.0952, placeholder: '#here is to good times', fixed: true, fontSizeRatio: 0.0381, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.2279, y: 0.6164, width: 0.6, height: 0.0294, placeholder: '#memories worth keeping.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.4764, y: 0.4524, width: 0.3836, height: 0.0952, placeholder: 'CHILL TIME', fixed: true, fontSizeRatio: 0.0906, textAlign: 'left', fontWeight: 500, color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-two-stagger',
    name: '2.2',
    category: '二图',
    styleId: 'atmosphere',
    description: '两张横图左右错落叠放，配#have a good time装饰文字，杂志拼贴感',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.0743, y: 0.1534, width: 0.6955, height: 0.3, cropHint: 'cover', borderWidth: 0.5, borderColor: '#000000' },
      { type: 'image', x: 0.208, y: 0.4952, width: 0.7, height: 0.3, cropHint: 'cover', borderWidth: 0.5, borderColor: '#000000' },
      { type: 'text', x: 0.3976, y: 0.1103, width: 0.4524, height: 0.0238, placeholder: '#here is to good times', fixed: true, fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.15, y: 0.8162, width: 0.3258, height: 0.0358, placeholder: 'Collecting moments,\none frame at a time.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-two-diagonal',
    name: '2.3',
    category: '二图',
    styleId: 'atmosphere',
    description: '两张横图对角错落排列，上方大号HAVEAGOODTIME标题，下方装饰文字',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.1068, y: 0.283, width: 0.5193, height: 0.1889, cropHint: 'cover', borderWidth: 0.5, borderColor: '#000000' },
      { type: 'image', x: 0.3733, y: 0.5009, width: 0.5057, height: 0.1807, cropHint: 'cover', borderWidth: 0.5, borderColor: '#000000' },
      { type: 'text', x: 0.2678, y: 0.1557, width: 0.4644, height: 0.0952, placeholder: 'HAVEAGOODTIME', fixed: true, fontSizeRatio: 0.0667, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5 },
      { type: 'text', x: 0.3173, y: 0.7698, width: 0.3543, height: 0.0952, placeholder: 'Relaxing moments', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-two-top-bottom',
    name: '2.4',
    category: '二图',
    styleId: 'atmosphere',
    description: '上方大图+中间居中文案+右下角小图，简约文艺',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.0923, y: 0.0922, width: 0.793, height: 0.3, cropHint: 'cover' },
      { type: 'image', x: 0.3756, y: 0.704, width: 0.5424, height: 0.2371, cropHint: 'cover' },
      { type: 'text', x: 0.2, y: 0.5158, width: 0.6, height: 0.0952, placeholder: 'May these pages always remind us that even the smallest moments can become the warmest memories.', fixed: true, fontSizeRatio: 0.031, textAlign: 'center', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-two-letters-card',
    name: '2.5',
    category: '二图',
    styleId: 'atmosphere',
    description: '米黄背景+散落字母A-N+两张卡片选区照片错落叠放，Keepsakes标题',
    thumbnail: '',
    background: '#fef3c7',
    elements: [
      // 散落字母（左上到右下斜向）
      { type: 'text', x: 0.0676, y: 0.0476, width: 0.0541, height: 0.0381, placeholder: 'A', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -15 },
      { type: 'text', x: 0.1689, y: 0.0952, width: 0.0541, height: 0.0381, placeholder: 'B', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 20 },
      { type: 'text', x: 0.1014, y: 0.1667, width: 0.0541, height: 0.0381, placeholder: 'C', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -25 },
      { type: 'text', x: 0.2365, y: 0.1905, width: 0.0541, height: 0.0381, placeholder: 'D', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 10 },
      { type: 'text', x: 0.1351, y: 0.2619, width: 0.0541, height: 0.0381, placeholder: 'E', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -20 },
      { type: 'text', x: 0.3041, y: 0.2857, width: 0.0541, height: 0.0381, placeholder: 'F', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 15 },
      { type: 'text', x: 0.2027, y: 0.3571, width: 0.0541, height: 0.0381, placeholder: 'G', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -10 },
      { type: 'text', x: 0.3716, y: 0.381, width: 0.0541, height: 0.0381, placeholder: 'H', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 25 },
      { type: 'text', x: 0.2703, y: 0.4524, width: 0.0541, height: 0.0381, placeholder: 'I', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -15 },
      { type: 'text', x: 0.4392, y: 0.4762, width: 0.0541, height: 0.0381, placeholder: 'J', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 20 },
      { type: 'text', x: 0.3378, y: 0.5476, width: 0.0541, height: 0.0381, placeholder: 'K', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -20 },
      { type: 'text', x: 0.5068, y: 0.5714, width: 0.0541, height: 0.0381, placeholder: 'L', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 10 },
      { type: 'text', x: 0.4054, y: 0.6429, width: 0.0541, height: 0.0381, placeholder: 'M', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -25 },
      { type: 'text', x: 0.5743, y: 0.6667, width: 0.0541, height: 0.0381, placeholder: 'N', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 15 },
      { type: 'text', x: 0.473, y: 0.7381, width: 0.0541, height: 0.0381, placeholder: 'O', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -10 },
      { type: 'text', x: 0.6419, y: 0.7619, width: 0.0541, height: 0.0381, placeholder: 'P', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 20 },
      { type: 'text', x: 0.5405, y: 0.8333, width: 0.0541, height: 0.0381, placeholder: 'Q', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -15 },
      { type: 'text', x: 0.7095, y: 0.8571, width: 0.0541, height: 0.0381, placeholder: 'R', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 25 },
      { type: 'text', x: 0.6081, y: 0.9048, width: 0.0541, height: 0.0381, placeholder: 'S', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -20 },
      { type: 'text', x: 0.777, y: 0.9286, width: 0.0541, height: 0.0381, placeholder: 'T', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 10 },
      { type: 'text', x: 0.1216, y: 0.0714, width: 0.0541, height: 0.0381, placeholder: 'U', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 10 },
      { type: 'text', x: 0.2162, y: 0.1333, width: 0.0541, height: 0.0381, placeholder: 'V', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -15 },
      { type: 'text', x: 0.1486, y: 0.2, width: 0.0541, height: 0.0381, placeholder: 'W', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 20 },
      { type: 'text', x: 0.2838, y: 0.2381, width: 0.0541, height: 0.0381, placeholder: 'X', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -10 },
      { type: 'text', x: 0.1892, y: 0.3095, width: 0.0541, height: 0.0381, placeholder: 'Y', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 15 },
      { type: 'text', x: 0.3514, y: 0.3333, width: 0.0541, height: 0.0381, placeholder: 'Z', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -20 },
      { type: 'text', x: 0.2568, y: 0.4048, width: 0.0541, height: 0.0381, placeholder: 'A', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 25 },
      { type: 'text', x: 0.4189, y: 0.4286, width: 0.0541, height: 0.0381, placeholder: 'B', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -15 },
      { type: 'text', x: 0.3243, y: 0.5, width: 0.0541, height: 0.0381, placeholder: 'C', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 10 },
      { type: 'text', x: 0.4865, y: 0.5238, width: 0.0541, height: 0.0381, placeholder: 'D', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -25 },
      { type: 'text', x: 0.3919, y: 0.5952, width: 0.0541, height: 0.0381, placeholder: 'E', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 20 },
      { type: 'text', x: 0.5541, y: 0.619, width: 0.0541, height: 0.0381, placeholder: 'F', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -10 },
      { type: 'text', x: 0.4595, y: 0.6905, width: 0.0541, height: 0.0381, placeholder: 'G', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 15 },
      { type: 'text', x: 0.6216, y: 0.7143, width: 0.0541, height: 0.0381, placeholder: 'H', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -20 },
      { type: 'text', x: 0.527, y: 0.7857, width: 0.0541, height: 0.0381, placeholder: 'I', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 25 },
      { type: 'text', x: 0.6892, y: 0.8095, width: 0.0541, height: 0.0381, placeholder: 'J', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -15 },
      { type: 'text', x: 0.5946, y: 0.8667, width: 0.0541, height: 0.0381, placeholder: 'K', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 10 },
      { type: 'text', x: 0.7297, y: 0.8952, width: 0.0541, height: 0.0381, placeholder: 'L', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -25 },
      { type: 'text', x: 0.6622, y: 0.9429, width: 0.0541, height: 0.0381, placeholder: 'M', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: 20 },
      { type: 'text', x: 0.8108, y: 0.9524, width: 0.0541, height: 0.0381, placeholder: 'N', fixed: true, fontSizeRatio: 0.0238, textAlign: 'center', fontWeight: 'normal', color: '#999999', lineHeight: 1.5, rotation: -10 },
      // 右上标题
      { type: 'text', x: 0.5152, y: 0.0857, width: 0.3209, height: 0.0533, placeholder: 'Keepsakes', fixed: true, fontSizeRatio: 0.0524, textAlign: 'left', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'text', x: 0.5675, y: 0.1524, width: 0.3236, height: 0.0698, placeholder: '#Collecting moments, one frame at a time.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      // 两张卡片选区照片
      { type: 'image', x: 0.1397, y: 0.3133, width: 0.4819, height: 0.2343, cropHint: 'cover', cardEdge: true, rotation: -13.47 },
      { type: 'image', x: 0.419, y: 0.4667, width: 0.4623, height: 0.2533, cropHint: 'cover', cardEdge: true },
      // 左下角小字
      { type: 'text', x: 0.0798, y: 0.7857, width: 0.3134, height: 0.0415, placeholder: '#ancdefg', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-two-bottom-side',
    name: '2.6',
    category: '二图',
    styleId: 'atmosphere',
    description: '上方大标题+正文留白+底部两张竖图并排，简约日记感',
    thumbnail: '',
    elements: [
      { type: 'text', x: 0.2919, y: 0.1298, width: 0.6, height: 0.0692, placeholder: 'Life lately', fixed: true, fontSizeRatio: 0.0715, textAlign: 'right', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'text', x: 0.2488, y: 0.2204, width: 0.6431, height: 0.0952, placeholder: 'Some days are ordinary while they\u2019re happening, but when you look back, you realize they were the best ones.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.0455, y: 0.6642, width: 0.3292, height: 0.2895, cropHint: 'cover' },
      { type: 'image', x: 0.3997, y: 0.6642, width: 0.3412, height: 0.2895, cropHint: 'cover' },
    ],
  },
  {
    id: 'atm-two-equal',
    name: '2.7',
    category: '二图',
    styleId: 'atmosphere',
    description: '两张竖图等宽并排，上下留边，极简双拼',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0, y: 0.1447, width: 0.4036, height: 0.7106, cropHint: 'cover' },
      { type: 'image', x: 0.4172, y: 0.1447, width: 0.4237, height: 0.7124, cropHint: 'cover' },
    ],
  },
  {
    id: 'atm-two-stamp-bottom',
    name: '2.8',
    category: '二图',
    styleId: 'atmosphere',
    description: '右上角邮票小图+底部满宽大图+左上LIFE LATELY标题+引言',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.5558, y: 0.0931, width: 0.3228, height: 0.2802, cropHint: 'cover', stampEdge: true },
      { type: 'image', x: 0, y: 0.4347, width: 1, height: 0.5653, cropHint: 'cover' },
      { type: 'text', x: 0.1114, y: 0.1745, width: 0.4307, height: 0.0507, placeholder: 'LIFELATELY', fixed: true, fontSizeRatio: 0.0524, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5 },
      { type: 'text', x: 0.175, y: 0.2332, width: 0.3194, height: 0.0672, placeholder: '"These days were golden."', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-two-dark',
    name: '2.9',
    category: '二图',
    styleId: 'atmosphere',
    description: '深色背景#1a1a1a，上下两张居中横图+白色标题正文，暗黑电影感',
    thumbnail: '',
    background: '#1a1a1a',
    elements: [
      { type: 'text', x: 0.2, y: 0.1462, width: 0.6, height: 0.0592, placeholder: 'Relaxing moments', fixed: true, fontSizeRatio: 0.0715, textAlign: 'center', fontWeight: 'bold', color: '#ffffff', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'image', x: 0.1352, y: 0.2151, width: 0.7297, height: 0.2618, cropHint: 'cover' },
      { type: 'image', x: 0.1352, y: 0.4956, width: 0.7297, height: 0.2666, cropHint: 'cover' },
      { type: 'text', x: 0.1528, y: 0.8022, width: 0.695, height: 0.0952, placeholder: 'Every frame holds a story, every smile holds a memory, and every page reminds us that good days are worth collecting.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#ffffff', lineHeight: 1.5 },
    ],
  },
  {
    id: 'five-collage',
    name: '五图拼贴',
    category: '五图',
    description: '左列2张+右列3张，适合旅行记录',
    thumbnail: 'five-collage',
    elements: [
      // 左上竖版大图
      { type: 'image', x: 0.057, y: 0.05, width: 0.451, height: 0.379, cropHint: 'cover' },
      // 左下横版图
      { type: 'image', x: 0.057, y: 0.442, width: 0.451, height: 0.376, cropHint: 'cover' },
      // 右上横版图
      { type: 'image', x: 0.526, y: 0.05, width: 0.420, height: 0.248, cropHint: 'cover' },
      // 右中横版图
      { type: 'image', x: 0.526, y: 0.310, width: 0.420, height: 0.248, cropHint: 'cover' },
      // 右下横版图
      { type: 'image', x: 0.526, y: 0.571, width: 0.420, height: 0.248, cropHint: 'cover' },
      // 底部标题
      { type: 'text', x: 0.05, y: 0.887, width: 0.9, height: 0.04, placeholder: '在这里写标题', fontSizeRatio: 0.04, textAlign: 'center', fontWeight: 'bold', color: '#2c2c2c' },
    ],
  },
  {
    id: 'five-collage-whitespace',
    name: '五图拼贴留白',
    category: '五图',
    description: '左列2张+右列3张，整体缩小留白更多，简约文艺',
    thumbnail: 'five-collage-whitespace',
    elements: [
      // 左上一行短句正文（标记 shortBody，从主题短正文库取一行短句）
      { type: 'text', x: 0.1, y: 0.1033, width: 0.406, height: 0.035, placeholder: '生活明朗，万物可爱', body: true, shortBody: true, fontSizeRatio: 0.03, textAlign: 'left', color: '#666666', lineHeight: 1.5 },
      // 左上竖版大图
      { type: 'image', x: 0.1, y: 0.154, width: 0.406, height: 0.341, cropHint: 'cover' },
      // 左下横版图
      { type: 'image', x: 0.1, y: 0.507, width: 0.406, height: 0.338, cropHint: 'cover' },
      // 右上横版图
      { type: 'image', x: 0.522, y: 0.154, width: 0.378, height: 0.223, cropHint: 'cover' },
      // 右中横版图
      { type: 'image', x: 0.522, y: 0.388, width: 0.378, height: 0.223, cropHint: 'cover' },
      // 右下横版图
      { type: 'image', x: 0.522, y: 0.623, width: 0.378, height: 0.223, cropHint: 'cover' },
      // 底部标题
      { type: 'text', x: 0.05, y: 0.907, width: 0.9, height: 0.04, placeholder: '在这里写标题', fontSizeRatio: 0.04, textAlign: 'center', fontWeight: 'bold', color: '#2c2c2c' },
    ],
  },
  {
    id: 'five-left-right-mixed',
    name: '五图左右混排',
    category: '五图',
    description: '左侧两图+正文，右侧正文+三图，左右交错混排，文艺感强',
    thumbnail: 'five-left-right-mixed',
    elements: [
      // 左上小图
      { type: 'image', x: 0.0732, y: 0.0814, width: 0.3986, height: 0.2024, cropHint: 'cover' },
      // 左中小图
      { type: 'image', x: 0.0732, y: 0.2962, width: 0.3986, height: 0.2024, cropHint: 'cover' },
      // 右上正文（短文案，2行）
      { type: 'text', x: 0.502, y: 0.1222, width: 0.4212, height: 0.0952, placeholder: '在这里写下短句...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333', lineHeight: 1.5 },
      // 左下正文（长文案，4-5行）
      { type: 'text', x: 0.0732, y: 0.5869, width: 0.3912, height: 0.0952, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333', lineHeight: 1.5 },
      // 右上图
      { type: 'image', x: 0.4906, y: 0.2519, width: 0.4324, height: 0.2095, cropHint: 'cover' },
      // 右中图
      { type: 'image', x: 0.4906, y: 0.4727, width: 0.4324, height: 0.2095, cropHint: 'cover' },
      // 右下图
      { type: 'image', x: 0.4906, y: 0.6927, width: 0.4324, height: 0.2095, cropHint: 'cover' },
    ],
  },
  {
    id: 'six-grid-slow',
    name: '六图慢递',
    category: '六图',
    description: '顶部正文+3行2列六图+右下大标题，文艺慢生活风格',
    thumbnail: 'six-grid-slow',
    elements: [
      // 顶部正文
      { type: 'text', x: 0.1399, y: 0.1163, width: 0.6, height: 0.0624, placeholder: '慢下来，去感受风的形状，去听花开的声音，去看云卷云舒。日子很长，我们慢慢走，慢慢爱', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333', lineHeight: 1.5 },
      // 第1行左图
      { type: 'image', x: 0.1399, y: 0.2, width: 0.3514, height: 0.1905, cropHint: 'cover' },
      // 第1行右图
      { type: 'image', x: 0.5081, y: 0.2, width: 0.3514, height: 0.1905, cropHint: 'cover' },
      // 第2行左图
      { type: 'image', x: 0.1399, y: 0.4019, width: 0.3514, height: 0.1905, cropHint: 'cover' },
      // 第2行右图
      { type: 'image', x: 0.5081, y: 0.4019, width: 0.3514, height: 0.1905, cropHint: 'cover' },
      // 第3行左图
      { type: 'image', x: 0.1399, y: 0.6034, width: 0.3514, height: 0.1905, cropHint: 'cover' },
      // 第3行右图
      { type: 'image', x: 0.5081, y: 0.6034, width: 0.3514, height: 0.1905, cropHint: 'cover' },
      // 底部右侧标题
      { type: 'text', x: 0.2435, y: 0.8473, width: 0.6, height: 0.0952, placeholder: '时光慢递', fontSizeRatio: 0.0549, textAlign: 'right', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-six-film-strip',
    name: '6.1',
    category: '六图',
    description: '三排错落排列，仿胶卷电影感，适合旅行记录',
    thumbnail: '',
    styleId: 'atmosphere',
    blackType: 1,
    elements: [
      // 第1排左图（去掉左边框）
      { type: 'image', x: 0.0012, y: 0.1854, width: 0.3291, height: 0.1681, cropHint: 'cover', filmEdge: true, filmLeftEdge: false },
      // 第1排中图
      { type: 'image', x: 0.3299, y: 0.1854, width: 0.3446, height: 0.1681, cropHint: 'cover', filmEdge: true },
      // 第1排右图（去掉右边框）
      { type: 'image', x: 0.6745, y: 0.1854, width: 0.3243, height: 0.1681, cropHint: 'cover', filmEdge: true, filmRightEdge: false },
      // 第2排左图（去掉左边框）
      { type: 'image', x: 0.3264, y: 0.4292, width: 0.349, height: 0.1441, cropHint: 'cover', filmEdge: true, filmLeftEdge: false },
      // 第2排右图（去掉右边框）
      { type: 'image', x: 0.6745, y: 0.429, width: 0.3243, height: 0.1443, cropHint: 'cover', filmEdge: true, filmRightEdge: false },
      // 第3排左图（只有一张，左右边框都去掉）
      { type: 'image', x: 0.0012, y: 0.6484, width: 0.5081, height: 0.1633, cropHint: 'cover', filmEdge: true, filmLeftEdge: false, filmRightEdge: false },
    ],
  },
  {
    id: 'atm-six-staircase',
    name: '6.2',
    category: '六图',
    styleId: 'atmosphere',
    description: '六张小图阶梯式向右下排列+左下Relaxing moments标题+底部正文',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.1754, y: 0.1642, width: 0.2297, height: 0.1619, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.4329, y: 0.1642, width: 0.2297, height: 0.1619, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.6894, y: 0.1642, width: 0.2297, height: 0.1619, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.4329, y: 0.3615, width: 0.2297, height: 0.1619, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.6894, y: 0.3615, width: 0.2297, height: 0.1619, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'image', x: 0.6894, y: 0.5595, width: 0.2297, height: 0.1619, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'text', x: 0.104, y: 0.7387, width: 0.4582, height: 0.0593, placeholder: 'Relaxing moments', fixed: true, fontSizeRatio: 0.0548, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'text', x: 0.1041, y: 0.7981, width: 0.6, height: 0.0952, placeholder: 'May these pages always remind us that even the smallest moments can become the warmest memories.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-seven-collage',
    name: '7.1',
    category: '七图',
    styleId: 'atmosphere',
    description: '七张照片错落拼贴，左上Adventures标题+右下Fragments标题+底部引言，杂志感',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.15, y: 0.2499, width: 0.3513, height: 0.1535, cropHint: 'cover' },
      { type: 'image', x: 0.527, y: 0.149, width: 0.2907, height: 0.2543, cropHint: 'cover' },
      { type: 'image', x: 0.0777, y: 0.4204, width: 0.1946, height: 0.1313, cropHint: 'cover' },
      { type: 'image', x: 0.2901, y: 0.4127, width: 0.2112, height: 0.1465, cropHint: 'cover' },
      { type: 'image', x: 0.5306, y: 0.4127, width: 0.2872, height: 0.2077, cropHint: 'cover' },
      { type: 'image', x: 0.2143, y: 0.569, width: 0.287, height: 0.2401, cropHint: 'cover' },
      { type: 'image', x: 0.5289, y: 0.6305, width: 0.2905, height: 0.1265, cropHint: 'cover' },
      { type: 'text', x: 0.1589, y: 0.1467, width: 0.2623, height: 0.0533, placeholder: 'Adventures', fixed: true, fontSizeRatio: 0.0548, textAlign: 'left', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'text', x: 0.5467, y: 0.814, width: 0.2612, height: 0.0952, placeholder: 'Fragments', fixed: true, fontSizeRatio: 0.0548, textAlign: 'right', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'text', x: 0.175, y: 0.8905, width: 0.6, height: 0.0952, placeholder: '"Collecting moments, one frame at a time."', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-seven-arc',
    name: '7.2',
    category: '七图',
    styleId: 'atmosphere',
    description: '白色卡片居中，7张照片沿弧形围绕排列，左侧手写斜向装饰文字',
    thumbnail: '',
    background: '#fef3c7',
    elements: [
      // 中间时钟
      { type: 'shape', x: 0.2244, y: 0.2944, width: 0.5541, height: 0.3929, backgroundColor: '#ffffff', clockStyle: true },
      // 七张照片沿弧形排列
      { type: 'image', x: 0.4041, y: 0.1151, width: 0.1702, height: 0.1421, cropHint: 'cover' },
      { type: 'image', x: 0.6187, y: 0.1896, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      { type: 'image', x: 0.7533, y: 0.3165, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      { type: 'image', x: 0.8176, y: 0.4525, width: 0.1382, height: 0.1048, cropHint: 'cover' },
      { type: 'image', x: 0.7673, y: 0.5884, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      { type: 'image', x: 0.6047, y: 0.6988, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      { type: 'image', x: 0.4041, y: 0.7512, width: 0.1703, height: 0.1419, cropHint: 'cover' },
      // 左侧斜向装饰文字
      { type: 'text', x: 0.1087, y: 0.3689, width: 0.1157, height: 0.0238, placeholder: 'ZZZ...', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif', rotation: 16.33 },
      { type: 'text', x: 0.0888, y: 0.424, width: 0.1274, height: 0.057, placeholder: 'ZZZ...', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.0865, y: 0.495, width: 0.1379, height: 0.0509, placeholder: 'ZZZ...', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5, rotation: -5.6 },
      { type: 'text', x: 0.1087, y: 0.5573, width: 0.1315, height: 0.048, placeholder: 'ZZZ...', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5, rotation: -16.87 },
      { type: 'text', x: 0.1452, y: 0.6053, width: 0.19, height: 0.0354, placeholder: 'ZZZ...', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5, rotation: -36.21 },
    ],
  },
  {
    id: 'atm-eight-mosaic',
    name: '8.1',
    category: '八图',
    styleId: 'atmosphere',
    description: '八张小图错落拼贴成散点网格，右上和左下各配文字',
    thumbnail: '',
    elements: [
      { type: 'text', x: 0.3003, y: 0.0957, width: 0.6, height: 0.0593, placeholder: 'Relaxing moments', fixed: true, fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.0678, y: 0.2314, width: 0.2013, height: 0.1324, cropHint: 'cover' },
      { type: 'image', x: 0.4948, y: 0.2314, width: 0.211, height: 0.1346, cropHint: 'cover' },
      { type: 'image', x: 0.2667, y: 0.366, width: 0.2082, height: 0.1433, cropHint: 'cover' },
      { type: 'image', x: 0.7328, y: 0.366, width: 0.1973, height: 0.1319, cropHint: 'cover' },
      { type: 'image', x: 0.0678, y: 0.5275, width: 0.1989, height: 0.1359, cropHint: 'cover' },
      { type: 'image', x: 0.4948, y: 0.5167, width: 0.2225, height: 0.1396, cropHint: 'cover' },
      { type: 'image', x: 0.2691, y: 0.6764, width: 0.223, height: 0.1317, cropHint: 'cover' },
      { type: 'image', x: 0.7173, y: 0.6764, width: 0.2183, height: 0.1297, cropHint: 'cover' },
      { type: 'text', x: 0.0678, y: 0.898, width: 0.3422, height: 0.0554, placeholder: 'Here\u2019s to the memories.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-five-banner-diary',
    name: '5.1',
    category: '五图',
    description: '顶部横幅大图+底部错落小图+日期文字，旅行日记感',
    thumbnail: '',
    styleId: 'atmosphere',
    blackType: 2,
    elements: [
      // 顶部横幅大图
      { type: 'image', x: 0, y: 0, width: 0.9987, height: 0.4452, cropHint: 'cover' },
      // 右侧中间小图
      { type: 'image', x: 0.7133, y: 0.4086, width: 0.1991, height: 0.1407, cropHint: 'cover', borderWidth: 1, borderColor: '#e9dddd' },
      // 底部左小图
      { type: 'image', x: 0.2559, y: 0.6429, width: 0.2027, height: 0.1429, cropHint: 'cover', borderWidth: 0.5, borderColor: '#666666' },
      // 底部中小图
      { type: 'image', x: 0.4834, y: 0.6429, width: 0.2027, height: 0.1429, cropHint: 'cover', borderWidth: 0.5, borderColor: '#666666' },
      // 底部右小图
      { type: 'image', x: 0.7097, y: 0.6429, width: 0.2027, height: 0.1429, cropHint: 'cover', borderWidth: 0.5, borderColor: '#666666' },
      // 日期文字（右对齐，固定装饰文字）
      { type: 'text', x: 0.0516, y: 0.6767, width: 0.1635, height: 0.0752, placeholder: '2026年3月12日\n地点', fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-five-timeline',
    name: '5.2',
    category: '五图',
    description: '竖向时间轴，5个节点，卡片照片交替左右+时间文字交替排列，旅行记录感',
    thumbnail: '',
    styleId: 'atmosphere',
    background: '#f5f0e8',
    elements: [
      // 竖向时间轴（中间竖线+5个节点圆点，固定不可拖拽）
      {
        type: 'shape', x: 0.49, y: 0, width: 0.02, height: 1,
        backgroundColor: 'transparent',
        timeline: true,
        timelineColor: '#b8a88a',
        timelineWidth: 0.5,
        timelineNodes: 5,
        fixed: true,
      },
      // 照片1（右上）
      { type: 'image', x: 0.1316, y: 0.079, width: 0.2387, height: 0.18, cropHint: 'cover', cardEdge: true, rotation: 7.22 },
      // 照片2（右下）
      { type: 'image', x: 0.5541, y: 0.2441, width: 0.3025, height: 0.1736, cropHint: 'cover', cardEdge: true, rotation: -5.27 },
      // 照片3（左侧）
      { type: 'image', x: 0.1288, y: 0.3832, width: 0.2415, height: 0.1838, cropHint: 'cover', cardEdge: true },
      // 照片4（右侧）
      { type: 'image', x: 0.5791, y: 0.5792, width: 0.304, height: 0.1725, cropHint: 'cover', cardEdge: true, rotation: 8.49 },
      // 照片5（左下）
      { type: 'image', x: 0.1316, y: 0.7517, width: 0.2302, height: 0.166, cropHint: 'cover', cardEdge: true, rotation: 9.12 },
      // 时间文字1（右侧左对齐）
      { type: 'text', x: 0.5541, y: 0.1333, width: 0.3716, height: 0.0714, placeholder: '09:30\n抵达入口', fixed: true, fontSizeRatio: 0.0477, textAlign: 'left', fontWeight: 500, color: '#b8a88a', lineHeight: 1.4, fontFamily: '"Great Vibes", cursive' },
      // 时间文字2（左侧右对齐）
      { type: 'text', x: 0.0651, y: 0.2952, width: 0.3716, height: 0.0714, placeholder: '10:20\n走过草坪', fixed: true, fontSizeRatio: 0.0477, textAlign: 'right', fontWeight: 500, color: '#b8a88a', lineHeight: 1.4, fontFamily: '"Great Vibes", cursive' },
      // 时间文字3（右侧左对齐）
      { type: 'text', x: 0.5791, y: 0.4639, width: 0.3716, height: 0.0714, placeholder: '11:15\n停留水边', fixed: true, fontSizeRatio: 0.0477, textAlign: 'left', fontWeight: 500, color: '#b8a88a', lineHeight: 1.4, fontFamily: '"Great Vibes", cursive' },
      // 时间文字4（左侧右对齐）
      { type: 'text', x: 0.0651, y: 0.619, width: 0.3716, height: 0.0714, placeholder: '13:40\n庭院小憩', fixed: true, fontSizeRatio: 0.0477, textAlign: 'right', fontWeight: 500, color: '#b8a88a', lineHeight: 1.4, fontFamily: '"Great Vibes", cursive' },
      // 时间文字5（右侧左对齐）
      { type: 'text', x: 0.5541, y: 0.781, width: 0.3716, height: 0.0714, placeholder: '14:00\n黄昏花墙', fixed: true, fontSizeRatio: 0.0477, textAlign: 'left', fontWeight: 500, color: '#b8a88a', lineHeight: 1.4, fontFamily: '"Great Vibes", cursive' },
    ],
  },
  {
    id: 'atm-five-film',
    name: '5.3',
    category: '五图',
    styleId: 'atmosphere',
    description: '胶卷风格五图，上方两张横排+下方三张阶梯错落倾斜排列，配camera film标题',
    thumbnail: '',
    background: '#913100',
    elements: [
      { type: 'image', x: 0, y: 0.249, width: 0.3967, height: 0.1667, cropHint: 'cover', filmEdge: true },
      { type: 'image', x: 0.3967, y: 0.249, width: 0.368, height: 0.1667, cropHint: 'cover', filmEdge: true },
      { type: 'image', x: -0.0304, y: 0.5013, width: 0.3627, height: 0.1681, cropHint: 'cover', filmEdge: true, rotation: -12 },
      { type: 'image', x: 0.3243, y: 0.4489, width: 0.3581, height: 0.1681, cropHint: 'cover', filmEdge: true, rotation: -12 },
      { type: 'image', x: 0.6723, y: 0.3948, width: 0.3649, height: 0.1681, cropHint: 'cover', filmEdge: true, rotation: -12 },
      { type: 'text', x: 0.3318, y: 0.1199, width: 0.6, height: 0.0952, placeholder: 'camera film', fixed: true, fontSizeRatio: 0.0548, textAlign: 'right', fontWeight: 'bold', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.1713, y: 0.8194, width: 0.6, height: 0.0952, placeholder: 'These days were golden.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-five-left-vertical',
    name: '5.4',
    category: '五图',
    styleId: 'atmosphere',
    description: '左侧竖版大图占满高度+右侧四张卡片小图错落叠放，米白背景',
    thumbnail: '',
    background: '#f5f0e8',
    elements: [
      { type: 'image', x: 0, y: 0, width: 0.533, height: 0.9999, cropHint: 'cover' },
      { type: 'image', x: 0.5772, y: 0.0848, width: 0.2704, height: 0.1976, cropHint: 'cover', cardEdge: true, rotation: 11.01 },
      { type: 'image', x: 0.5129, y: 0.2943, width: 0.2375, height: 0.1776, cropHint: 'cover', cardEdge: true, rotation: -18.92 },
      { type: 'image', x: 0.7125, y: 0.4448, width: 0.2241, height: 0.1823, cropHint: 'cover', cardEdge: true },
      { type: 'image', x: 0.5129, y: 0.6272, width: 0.2813, height: 0.17, cropHint: 'cover', cardEdge: true, rotation: 22.2 },
    ],
  },
  {
    id: 'atm-five-right-stack',
    name: '5.5',
    category: '五图',
    styleId: 'atmosphere',
    description: '右侧五张横图竖排+左侧Life lately大标题+编号标注，浅蓝背景',
    thumbnail: '',
    background: '#e3ecf8',
    elements: [
      { type: 'text', x: 0.118, y: 0.3405, width: 0.2879, height: 0.1456, placeholder: 'Life\nlately', fixed: true, fontSizeRatio: 0.0906, textAlign: 'center', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'image', x: 0.5765, y: 0.0324, width: 0.3716, height: 0.1714, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'text', x: 0.3254, y: 0.1634, width: 0.2172, height: 0.0502, placeholder: '(1)', fixed: true, fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.5765, y: 0.2247, width: 0.3716, height: 0.1714, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'text', x: 0.3388, y: 0.3533, width: 0.2037, height: 0.0428, placeholder: '(2)', fixed: true, fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.5765, y: 0.4133, width: 0.3716, height: 0.1714, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'text', x: 0.2417, y: 0.5508, width: 0.3009, height: 0.0278, placeholder: '(3)', fixed: true, fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.5765, y: 0.6038, width: 0.3716, height: 0.1714, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'text', x: 0.4217, y: 0.7326, width: 0.1208, height: 0.0426, placeholder: '(4)', fixed: true, fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'image', x: 0.5765, y: 0.7935, width: 0.3716, height: 0.1714, cropHint: 'cover', borderWidth: 0.5 },
      { type: 'text', x: 0.4059, y: 0.9257, width: 0.1366, height: 0.0391, placeholder: '(5)', fixed: true, fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-five-film-blue',
    name: '5.6',
    category: '五图',
    styleId: 'atmosphere',
    description: '上方三张胶卷横排+中间A roll of film标题+下方两张胶卷横排，浅蓝背景',
    thumbnail: '',
    background: '#dbeafe',
    elements: [
      { type: 'image', x: 0, y: 0.1715, width: 0.3581, height: 0.1949, cropHint: 'cover', filmEdge: true },
      { type: 'image', x: 0.3574, y: 0.1714, width: 0.3378, height: 0.1948, cropHint: 'cover', filmEdge: true },
      { type: 'image', x: 0.6926, y: 0.1715, width: 0.3074, height: 0.1948, cropHint: 'cover', filmEdge: true },
      { type: 'text', x: 0.1932, y: 0.481, width: 0.6, height: 0.0549, placeholder: 'A roll of film', fixed: true, fontSizeRatio: 0.0524, textAlign: 'center', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'image', x: 0, y: 0.6308, width: 0.4932, height: 0.1724, cropHint: 'cover', filmEdge: true },
      { type: 'image', x: 0.4932, y: 0.6308, width: 0.5034, height: 0.1724, cropHint: 'cover', filmEdge: true },
    ],
  },
  {
    id: 'four-doodle-left',
    name: '4.1',
    category: '四图',
    styleId: 'atmosphere',
    description: '4个圆形照片+浅灰手绘连线蜿蜒串联，跨页左半部分',
    thumbnail: '',
    background: '#f5f0e8',
    doodle: {
      path: [
        { x: 0.192, y: 0.175 },
        { x: 0.266, y: 0.398 },
        { x: 0.412, y: 0.603 },
        { x: 0.641, y: 0.793 },
        { x: 0.95, y: 0.82 },
      ],
      color: '#c8c4bc',
      width: 0.4,
    },
    elements: [
      // 第1个圆形照片
      { type: 'image', x: 0.0878, y: 0.1262, width: 0.1757, height: 0.1238, cropHint: 'cover', circleEdge: true, borderWidth: 1, borderColor: '#ffffff' },
      // 第2个圆形照片
      { type: 'image', x: 0.1824, y: 0.3452, width: 0.1757, height: 0.1238, cropHint: 'cover', circleEdge: true, borderWidth: 1, borderColor: '#ffffff' },
      // 第3个圆形照片
      { type: 'image', x: 0.3311, y: 0.5490, width: 0.1757, height: 0.1238, cropHint: 'cover', circleEdge: true, borderWidth: 1, borderColor: '#ffffff' },
      // 第4个圆形照片
      { type: 'image', x: 0.5574, y: 0.7233, width: 0.1757, height: 0.1238, cropHint: 'cover', circleEdge: true, borderWidth: 1, borderColor: '#ffffff' },
      // 装饰字1：Life lately
      { type: 'text', x: 0.4993, y: 0.2452, width: 0.3432, height: 0.0643, placeholder: '"Life lately"', fixed: true, fontSizeRatio: 0.0669, textAlign: 'center', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      // 装饰字2：Moments worth keeping forever.
      { type: 'text', x: 0.4993, y: 0.3095, width: 0.3932, height: 0.0629, placeholder: 'Moments worth keeping forever.', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      // 装饰字3：Collecting moments, one frame at a time.
      { type: 'text', x: 0.0878, y: 0.8286, width: 0.6, height: 0.0952, placeholder: '"Collecting moments, one frame at a time."', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      // 正文1：9:00 吃饭
      { type: 'text', x: 0.3014, y: 0.1767, width: 0.2027, height: 0.0714, placeholder: '9:00\n吃饭', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      // 正文2：11:00 出发
      { type: 'text', x: 0.3919, y: 0.3929, width: 0.2027, height: 0.0714, placeholder: '11:00\n出发', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      // 正文3：13:00 赏花
      { type: 'text', x: 0.5473, y: 0.6, width: 0.2027, height: 0.0714, placeholder: '13:00\n赏花', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      // 正文4：17:00 夜景
      { type: 'text', x: 0.7845, y: 0.7605, width: 0.2027, height: 0.0714, placeholder: '17:00\n夜景', fixed: true, fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'nine-grid-avatar',
    name: '九宫格头像',
    category: '十图',
    description: '顶部头像+标题文案，下方3×3九宫格紧凑排列，适合朋友圈合集',
    thumbnail: 'nine-grid-avatar',
    elements: [
      // 顶部左侧头像（28×30mm，y=15mm）
      { type: 'image', x: 0.05, y: 0.0714, width: 0.1892, height: 0.1429, cropHint: 'cover' },
      // 顶部右侧标题（y=17mm，与头像间距加大，宽87mm）
      { type: 'text', x: 0.30, y: 0.081, width: 0.5878, height: 0.06, placeholder: '在这里写标题', fontSizeRatio: 0.05, textAlign: 'left', fontWeight: 'bold', color: '#2c2c2c' },
      // 顶部右侧文案（宽87mm）
      { type: 'text', x: 0.30, y: 0.15, width: 0.5878, height: 0.08, placeholder: '在这里写下你的故事和感受...', body: true, fontSizeRatio: 0.031, textAlign: 'left', color: '#333333' },
      // 九宫格 - 第1行（43×45mm，间距不变，整体靠下，和头像间距加大）
      { type: 'image', x: 0.052, y: 0.30, width: 0.2905, height: 0.2143, cropHint: 'cover' },
      { type: 'image', x: 0.3545, y: 0.30, width: 0.2905, height: 0.2143, cropHint: 'cover' },
      { type: 'image', x: 0.657, y: 0.30, width: 0.2905, height: 0.2143, cropHint: 'cover' },
      // 九宫格 - 第2行
      { type: 'image', x: 0.052, y: 0.5263, width: 0.2905, height: 0.2143, cropHint: 'cover' },
      { type: 'image', x: 0.3545, y: 0.5263, width: 0.2905, height: 0.2143, cropHint: 'cover' },
      { type: 'image', x: 0.657, y: 0.5263, width: 0.2905, height: 0.2143, cropHint: 'cover' },
      // 九宫格 - 第3行
      { type: 'image', x: 0.052, y: 0.7526, width: 0.2905, height: 0.2143, cropHint: 'cover' },
      { type: 'image', x: 0.3545, y: 0.7526, width: 0.2905, height: 0.2143, cropHint: 'cover' },
      { type: 'image', x: 0.657, y: 0.7526, width: 0.2905, height: 0.2143, cropHint: 'cover' },
    ],
  },
  {
    id: 'atm-four-bg-clothesline',
    name: '4.2',
    category: '四图',
    styleId: 'atmosphere',
    description: '蓝天白云晾衣架背景图，四张拍立得照片悬挂，文艺清新',
    thumbnail: '',
    backgroundImage: moban1Bg,
    elements: [
      // 第1张照片（左上拍立得）
      { type: 'image', x: 0.1453, y: 0.3352, width: 0.1817, height: 0.1409, cropHint: 'cover', rotation: 9 },
      // 第2张照片（右上拍立得）
      { type: 'image', x: 0.6852, y: 0.384, width: 0.1817, height: 0.1439, cropHint: 'cover', rotation: 2.42 },
      // 第3张照片（左下拍立得）
      { type: 'image', x: 0.2534, y: 0.5681, width: 0.1892, height: 0.1423, cropHint: 'cover', rotation: 13 },
      // 第4张照片（右下拍立得）
      { type: 'image', x: 0.5878, y: 0.6505, width: 0.1885, height: 0.1329, cropHint: 'cover', rotation: -14.32 },
    ],
  },
  {
    id: 'atm-four-full-stack',
    name: '4.3',
    category: '四图',
    styleId: 'atmosphere',
    description: '一张满版背景图+左侧三张卡片小图错落叠放，悬浮拼贴感',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0, y: 0, width: 1, height: 1, cropHint: 'cover' },
      { type: 'image', x: 0.1027, y: 0.1438, width: 0.3527, height: 0.1873, cropHint: 'cover', cardEdge: true, rotation: -4.05 },
      { type: 'image', x: 0.1027, y: 0.3557, width: 0.3584, height: 0.181, cropHint: 'cover', cardEdge: true, rotation: 8.43 },
      { type: 'image', x: 0.0899, y: 0.5536, width: 0.3655, height: 0.1779, cropHint: 'cover', cardEdge: true, rotation: -7.19 },
    ],
  },
  {
    id: 'atm-four-milestones',
    name: '4.4',
    category: '四图',
    styleId: 'atmosphere',
    description: '四张大小不一的横图错落拼贴+多处英文标题装饰，杂志拼贴感',
    thumbnail: '',
    elements: [
      { type: 'text', x: 0.6963, y: 0.0302, width: 0.2574, height: 0.0319, placeholder: 'Captured moments.', fixed: true, fontSizeRatio: 0.0238, textAlign: 'right', fontWeight: 'normal', color: '#999999', lineHeight: 1.5 },
      { type: 'image', x: 0.0864, y: 0.1076, width: 0.567, height: 0.2319, cropHint: 'cover' },
      { type: 'text', x: 0.6847, y: 0.2018, width: 0.2276, height: 0.0435, placeholder: 'Milestones', fixed: true, fontSizeRatio: 0.0429, textAlign: 'right', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'image', x: 0.3991, y: 0.3747, width: 0.4464, height: 0.1641, cropHint: 'cover' },
      { type: 'text', x: 0.0864, y: 0.4396, width: 0.2589, height: 0.0536, placeholder: '(Fragments)', fixed: true, fontSizeRatio: 0.0429, textAlign: 'left', fontWeight: 500, color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'image', x: 0.0864, y: 0.578, width: 0.3838, height: 0.1521, cropHint: 'cover' },
      { type: 'text', x: 0.5457, y: 0.6337, width: 0.2794, height: 0.0408, placeholder: '"Memories"', fixed: true, fontSizeRatio: 0.0429, textAlign: 'left', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      { type: 'image', x: 0.5444, y: 0.7301, width: 0.2806, height: 0.1215, cropHint: 'cover' },
      { type: 'text', x: 0.0864, y: 0.7909, width: 0.3613, height: 0.0952, placeholder: '#Keepsakes', fixed: true, fontSizeRatio: 0.0429, textAlign: 'center', fontWeight: 500, color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.0412, y: 0.9537, width: 0.1997, height: 0.0238, placeholder: 'Cherished times.', fixed: true, fontSizeRatio: 0.0238, textAlign: 'left', fontWeight: 500, color: '#999999', lineHeight: 1.5, fontFamily: '"Playfair Display", serif' },
    ],
  },
  {
    id: 'atm-four-stamp-grid',
    name: '4.5',
    category: '四图',
    styleId: 'atmosphere',
    description: '四张邮票边缘照片2×2排列，左上和右下各配一行小字',
    thumbnail: '',
    elements: [
      { type: 'image', x: 0.1567, y: 0.2333, width: 0.3378, height: 0.2476, cropHint: 'cover', stampEdge: true },
      { type: 'image', x: 0.4945, y: 0.2333, width: 0.3378, height: 0.2476, cropHint: 'cover', stampEdge: true },
      { type: 'image', x: 0.1567, y: 0.481, width: 0.3378, height: 0.2476, cropHint: 'cover', stampEdge: true },
      { type: 'image', x: 0.4945, y: 0.481, width: 0.3378, height: 0.2476, cropHint: 'cover', stampEdge: true },
      { type: 'text', x: 0.3256, y: 0.8601, width: 0.3455, height: 0.0664, placeholder: 'Relaxing moments', fontSizeRatio: 0.0429, textAlign: 'center', fontWeight: 'bold', color: '#333333', lineHeight: 1.5, fontFamily: '"Montserrat", sans-serif' },
      // 右上角L形装饰线 ┘
      { type: 'shape', x: 0.6826, y: 0.2071, width: 0.19, height: 0.15, backgroundColor: 'transparent', doodleLine: true, doodleColor: '#333333', doodleWidth: 0.5, doodlePath: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
      // 左下角L形装饰线 └
      { type: 'shape', x: 0.1163, y: 0.6599, width: 0.27, height: 0.1, backgroundColor: 'transparent', doodleLine: true, doodleColor: '#333333', doodleWidth: 0.5, doodlePath: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
    ],
  },
  {
    id: 'atm-four-fragments',
    name: '4.6',
    category: '四图',
    styleId: 'atmosphere',
    description: '左侧两张小图竖排+右上一张小图+右下一张大图错落，四处小标签文字',
    thumbnail: '',
    background: '#ffffff',
    elements: [
      { type: 'image', x: 0.1157, y: 0.0805, width: 0.2365, height: 0.1667, cropHint: 'cover' },
      { type: 'image', x: 0.6348, y: 0.1907, width: 0.2703, height: 0.1905, cropHint: 'cover' },
      { type: 'image', x: 0.1131, y: 0.3201, width: 0.2365, height: 0.1667, cropHint: 'cover' },
      { type: 'image', x: 0.3834, y: 0.5978, width: 0.5216, height: 0.3562, cropHint: 'cover' },
      { type: 'text', x: 0.0734, y: 0.5257, width: 0.2038, height: 0.0514, placeholder: 'Fragments', fontSizeRatio: 0.031, textAlign: 'center', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.0734, y: 0.9067, width: 0.2788, height: 0.0473, placeholder: 'Adventures', fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.3834, y: 0.2132, width: 0.1654, height: 0.0339, placeholder: 'Snapshots', fontSizeRatio: 0.031, textAlign: 'left', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
      { type: 'text', x: 0.6442, y: 0.4034, width: 0.2358, height: 0.0439, placeholder: 'Memories', fontSizeRatio: 0.031, textAlign: 'right', fontWeight: 'normal', color: '#333333', lineHeight: 1.5 },
    ],
  },
  {
    id: 'atm-clock-twelve',
    name: '12.1',
    category: '十二图',
    description: '手绘时钟风格，12张照片围绕时钟排列，记录每一刻美好时光',
    thumbnail: '',
    styleId: 'atmosphere',
    background: '#fffae5',
    elements: [
      // 中心手绘时钟
      { type: 'shape', x: 0.1838, y: 0.2572, width: 0.6325, height: 0.4546, backgroundColor: 'transparent', clockStyle: true },
      // 12点方向
      { type: 'image', x: 0.4257, y: 0.1316, width: 0.1486, height: 0.1256, cropHint: 'cover' },
      // 1点方向
      { type: 'image', x: 0.6399, y: 0.1837, width: 0.1273, height: 0.1047, cropHint: 'cover' },
      // 2点方向
      { type: 'image', x: 0.7631, y: 0.3, width: 0.1672, height: 0.1048, cropHint: 'cover' },
      // 3点方向
      { type: 'image', x: 0.7885, y: 0.4476, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      // 4点方向
      { type: 'image', x: 0.7885, y: 0.5952, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      // 5点方向
      { type: 'image', x: 0.6145, y: 0.7033, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      // 6点方向
      { type: 'image', x: 0.4257, y: 0.7429, width: 0.1486, height: 0.1254, cropHint: 'cover' },
      // 7点方向
      { type: 'image', x: 0.2502, y: 0.7033, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      // 8点方向
      { type: 'image', x: 0.083, y: 0.5952, width: 0.1486, height: 0.1048, cropHint: 'cover' },
      // 9点方向
      { type: 'image', x: 0.0628, y: 0.468, width: 0.1486, height: 0.0844, cropHint: 'cover' },
      // 10点方向
      { type: 'image', x: 0.0628, y: 0.3128, width: 0.1486, height: 0.092, cropHint: 'cover' },
      // 11点方向
      { type: 'image', x: 0.2114, y: 0.1837, width: 0.1486, height: 0.113, cropHint: 'cover' },
    ],
  },
];

/** applyTemplate 的可选行为开关 */
export interface ApplyTemplateOptions {
  /** 保持模板文字原样，不填主题文案/正文样式 */
  preserveText?: boolean;
  /** 把所有文字标成 fixed（不参与全局标题/正文样式） */
  forceFixedText?: boolean;
}

/**
 * 将模板应用到页面，生成实际元素
 * @param template 模板定义
 * @param format 页面格式
 * @param existingImageIds 可用的图片ID列表（按顺序填充模板中的图片位）
 * @param themeId 主题ID（旅行/日常用模板文案，其他主题用主题文案）
 * @param bodyFontSize 正文字号（pt），默认 13；传相册的 bodyFontSize
 * @param bodyColor 正文颜色，默认 #333333；传相册的 bodyColor
 * @param options 氛围感模板用：preserveText 保持模板文字原样，forceFixedText 把所有文字标成 fixed
 */
export function applyTemplate(
  template: TemplateDefinition,
  format: BookFormat,
  existingImageIds: string[] = [],
  themeId: string = 'travel',
  bodyFontSize: number = DEFAULT_BODY_FONT_SIZE,
  bodyColor: string = DEFAULT_BODY_COLOR,
  options?: ApplyTemplateOptions
): { elements: Element[]; doodle?: PageDoodle; background?: PageBackground } {
  let imageIndex = 0;
  const elements: Element[] = [];

  // 旅行/日常主题用模板文案库，其他主题用主题文案库
  const useThemeCopy = themeId !== 'travel' && themeId !== 'daily';
  const theme = useThemeCopy ? getThemeById(themeId) : undefined;

  // 获取模板对应的文案（仅旅行/日常主题用）
  const templateCopyList = !useThemeCopy ? getTemplateCopyList(template.id) : undefined;
  let paragraphIndex = 0; // 用于三段正文模板
  let bodyPickIndex = 0; // 用于从文案库随机选多条正文

  // 预随机选三条文案，用于多正文位置的模板（比如左图右文）
  let pickedBodies: string[] = [];
  if (templateCopyList && templateCopyList.length > 0 && !templateCopyList[0].paragraphs) {
    // 从文案库里随机选3条不重复的正文
    const shuffled = [...templateCopyList].sort(() => Math.random() - 0.5);
    pickedBodies = shuffled.slice(0, 3).map(item => item.body);
  }

  // 主题模式下，预随机选3条正文
  let themePickedBodies: string[] = [];
  if (theme) {
    const shuffled = [...theme.paragraphs].sort(() => Math.random() - 0.5);
    themePickedBodies = shuffled.slice(0, 3);
  }

  for (let i = 0; i < template.elements.length; i++) {
    const tplEl = template.elements[i];
    const base = {
      id: generateId(),
      x: tplEl.x * format.width,
      y: tplEl.y * format.height,
      width: tplEl.width * format.width,
      height: tplEl.height * format.height,
      rotation: tplEl.rotation ?? 0,
      opacity: tplEl.opacity ?? 1,
      zIndex: i,
      locked: tplEl.locked === true,
      fixed: tplEl.fixed === true,
    };

    if (tplEl.type === 'image') {
      const imageId = existingImageIds[imageIndex] || '';
      imageIndex++;
      elements.push({
        ...base,
        type: 'image',
        imageId,
        // 拷贝一份，避免多个页面共用同一个 crop 对象
        crop: tplEl.crop ? { ...tplEl.crop } : { x: 0, y: 0, width: 1, height: 1 },
        // 胶卷边缘效果
        filmEdge: tplEl.filmEdge === true,
        // 胶卷左右黑边（独立控制，默认true；filmSideEdge是旧总开关，兼容）
        filmLeftEdge: tplEl.filmLeftEdge ?? tplEl.filmSideEdge ?? true,
        filmRightEdge: tplEl.filmRightEdge ?? tplEl.filmSideEdge ?? true,
        // 邮票边缘效果
        stampEdge: tplEl.stampEdge === true,
        // 卡片选区效果
        cardEdge: tplEl.cardEdge === true,
        // 圆形选区效果
        circleEdge: tplEl.circleEdge === true,
        // 照片选区边框
        borderWidth: tplEl.borderWidth,
        borderColor: tplEl.borderColor,
      });
    } else if (tplEl.type === 'shape') {
      // 普通选区（形状元素）
      elements.push({
        ...base,
        type: 'shape',
        backgroundColor: (tplEl as any).backgroundColor || '#ffffff',
        borderRadius: (tplEl as any).borderRadius,
        borderColor: (tplEl as any).borderColor,
        borderWidth: (tplEl as any).borderWidth,
        clockStyle: (tplEl as any).clockStyle === true,
        tornPaper: (tplEl as any).tornPaper === true,
        doodleLine: (tplEl as any).doodleLine === true,
        doodlePath: (tplEl as any).doodlePath ? JSON.parse(JSON.stringify((tplEl as any).doodlePath)) : undefined,
        doodleColor: (tplEl as any).doodleColor,
        doodleWidth: (tplEl as any).doodleWidth,
        clothesline: (tplEl as any).clothesline === true,
        clotheslineColor: (tplEl as any).clotheslineColor,
        clotheslineWidth: (tplEl as any).clotheslineWidth,
        timeline: (tplEl as any).timeline === true,
        timelineColor: (tplEl as any).timelineColor,
        timelineWidth: (tplEl as any).timelineWidth,
        timelineNodes: (tplEl as any).timelineNodes,
      });
    } else {
      // 根据模板文案填充
      const fontSizeRatio = tplEl.fontSizeRatio || 0.03;
      // 三种文字：固定装饰（不填）、正文（带 body 标记）、标题（字号到标题线）。
      // 都不沾的（封面上的英文小字、短标签）保持模板原样。
      const isBody = tplEl.body === true;
      const isTitle = !isBody && fontSizeRatio >= 0.04;
      // 封面/尾页模板里的字整块不算标题：竖排 TIME、「✦」是按设计稿摆的，
      // 大标题也是给这一页量身定的尺寸（比正文页标题大一圈）。显式标 false，
      // 之后「全局改标题样式」就不会把封面也改了
      const title = isTitle && template.category !== '封面' && template.category !== '尾页';
      let content: string;
      let actualFontSizeRatio = fontSizeRatio;

      // 氛围感模板：文字全部按模板原样，不触发主题文案/正文样式
      if (options?.preserveText) {
        content = tplEl.placeholder || '';
      } else if ((tplEl as any).fixed) {
        content = tplEl.placeholder || '';
      } else if (isBody) {
        // 正文：主题文案库优先；标记 shortBody 的用主题短正文（一行短句），普通正文用主题长正文
        const isShortBody = (tplEl as any).shortBody === true;
        if (isShortBody) {
          // 短正文：总是从主题短正文库取（旅行/日常主题也有 shortParagraphs）
          const themeForShort = getThemeById(themeId);
          const shorts = themeForShort?.shortParagraphs || [];
          content = shorts.length > 0 ? randomPick(shorts) : (tplEl.placeholder || '');
        } else if (theme) {
          if (themePickedBodies.length > 1) {
            // 长正文：多正文位置按顺序取预选的3条
            content = themePickedBodies[bodyPickIndex] || '';
            bodyPickIndex++;
          } else {
            content = randomPick(theme.paragraphs);
          }
        } else if (templateCopyList && templateCopyList.length > 0) {
          // 没有主题时用模板专属文案库
          const randomCopy = randomPick(templateCopyList);
          if (pickedBodies.length > 0) {
            content = pickedBodies[bodyPickIndex] || '';
            bodyPickIndex++;
          } else if (randomCopy.paragraphs && Array.isArray(randomCopy.paragraphs)) {
            content = randomCopy.paragraphs[paragraphIndex] || '';
            paragraphIndex++;
          } else {
            content = randomCopy.body || tplEl.placeholder || '';
          }
        } else {
          content = tplEl.placeholder || '';
        }
        // 正文字号跟相册的正文样式走（默认 13pt，可在「🎨 正文样式」里改）
        actualFontSizeRatio = bodyFontSize / (format.width * 2.83);
      } else if (isTitle) {
        // 标题：主题文案库优先
        if (theme) {
          content = randomPick(theme.pageTitles);
        } else if (templateCopyList && templateCopyList.length > 0) {
          content = randomPick(templateCopyList).title || tplEl.placeholder || '';
        } else {
          content = tplEl.placeholder ?? getRandomText(true, false, false);
        }
      } else {
        // 装饰小字：原样保留
        content = tplEl.placeholder || '';
      }

      // 替换动态年份占位符
      if (content.includes('{year}')) {
        content = content.replace('{year}', String(new Date().getFullYear()));
      }

      elements.push({
        ...base,
        type: 'text',
        content,
        fontSize: Math.round(actualFontSizeRatio * format.width * 2.83), // mm转pt近似
        fontFamily: tplEl.fontFamily || 'sans-serif',
        fontWeight: tplEl.fontWeight ?? 'normal',
        // 正文的颜色由相册的正文样式决定（默认 #333333），其余保持模板自己的配色；
        // preserveText 时连正文标记也按模板原色走，不让正文字体色渗进来
        color: !options?.preserveText && isBody ? bodyColor : tplEl.color || '#666666',
        textAlign: tplEl.textAlign || 'left',
        lineHeight: tplEl.lineHeight ?? 1.5,
        letterSpacing: 0,
        // 模板带了背景色就带上（「新建模板」存下来的页可能有；老模板没有这个字段）
        backgroundColor: tplEl.backgroundColor,
        fixed: options?.forceFixedText ? true : ((tplEl as any).fixed || false),
        // 显式表态：模板出来的每个文字都写明是不是正文 / 标题，
        // 全站不用再靠字号猜（封面尾页那几段也是显式的 false）。
        // shortBody 也要写出来：不写的话智能排版回填文案时只认 body，
        // 小空间里的短句会被长正文顶掉、撑出文字框。
        body: options?.preserveText ? false : isBody,
        shortBody: options?.preserveText ? false : tplEl.shortBody === true,
        title: options?.preserveText ? false : title,
      });
    }
  }

  const pageBackground = template.backgroundImage
    ? { type: 'image' as const, value: template.backgroundImage }
    : { type: 'color' as const, value: template.background || '#ffffff' };

  return { elements, doodle: template.doodle ? JSON.parse(JSON.stringify(template.doodle)) : undefined, background: pageBackground };
}

/**
 * 按 id 获取模板定义
 */
export function getTemplateById(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

// ==================== 模板库变更订阅 ====================
// 模板库是模块级的可变数组，React 改不动也看不见它的变化。
// 组件用 useSyncExternalStore(subscribeTemplates, getTemplatesVersion) 订阅版本号，
// 才能在内置数据被增/删/改之后重新渲染。

const templateListeners = new Set<() => void>();
let templateVersion = 0;

function notifyTemplatesChanged(): void {
  templateVersion++;
  templateListeners.forEach((fn) => fn());
}

/** 订阅模板库变更，返回取消订阅函数（配合 useSyncExternalStore） */
export function subscribeTemplates(fn: () => void): () => void {
  templateListeners.add(fn);
  return () => {
    templateListeners.delete(fn);
  };
}

/** 模板库版本号，每次增删改 +1 */
export function getTemplatesVersion(): number {
  return templateVersion;
}

/**
 * 用自定义模板覆盖同 id 的内置模板（用户"保存模板"后调用）
 * id 不存在时作为新模板追加（"新增模板"）
 */
export function applyCustomTemplate(template: TemplateDefinition): void {
  const idx = TEMPLATES.findIndex((t) => t.id === template.id);
  if (idx !== -1) {
    TEMPLATES[idx] = template;
  } else {
    TEMPLATES.push(template);
  }
  CUSTOM_TEMPLATE_IDS.add(template.id);
  notifyTemplatesChanged();
}

/** 已被用户自定义覆盖过的模板 id 集合 */
const CUSTOM_TEMPLATE_IDS = new Set<string>();

/** 该模板是否存在用户保存过的自定义版本（决定"恢复默认"是否有意义） */
export function hasCustomTemplate(id: string | undefined): boolean {
  return !!id && CUSTOM_TEMPLATE_IDS.has(id);
}

// 内置模板快照（模块加载时保存，作为"恢复默认"的来源）
const BUILTIN_TEMPLATES: TemplateDefinition[] = JSON.parse(JSON.stringify(TEMPLATES));

/** 是否是内置模板（内置模板被删除要记墓碑，否则刷新后又回来了） */
export function isBuiltinTemplate(id: string): boolean {
  return BUILTIN_TEMPLATES.some((t) => t.id === id);
}

/**
 * 恢复内置模板（用户"恢复默认"后调用）
 * 该模板若已被删除，会一并重新加回模板库
 * @returns 是否成功还原（false 表示该 id 不是内置模板，如用户新建的模板）
 */
export function restoreBuiltinTemplate(id: string): boolean {
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
  CUSTOM_TEMPLATE_IDS.delete(id);
  if (!builtin) return false;

  const restored: TemplateDefinition = JSON.parse(JSON.stringify(builtin));
  const idx = TEMPLATES.findIndex((t) => t.id === id);
  if (idx !== -1) {
    TEMPLATES[idx] = restored;
  } else {
    TEMPLATES.push(restored);
  }
  notifyTemplatesChanged();
  return true;
}

/**
 * 从模板库移除模板（只动内存，持久化由 utils/templateLibrary 负责）
 * @returns 被移除的模板；id 不存在时返回 undefined
 */
export function removeTemplate(id: string): TemplateDefinition | undefined {
  const idx = TEMPLATES.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  const [removed] = TEMPLATES.splice(idx, 1);
  CUSTOM_TEMPLATE_IDS.delete(id);
  notifyTemplatesChanged();
  return removed;
}

// ==================== 页面 ↔ 模板 互转 ====================

/**
 * 页面元素（绝对 mm）→ 模板元素（相对比例）
 */
export function pageElementsToTemplateElements(
  elements: Element[],
  format: BookFormat
): TemplateElement[] {
  return elements
    .filter((el) => el.type === 'image' || el.type === 'text')
    .map((el) => {
      const base: TemplateElement = {
        type: el.type === 'image' ? 'image' : 'text',
        x: el.x / format.width,
        y: el.y / format.height,
        width: el.width / format.width,
        height: el.height / format.height,
      };
      // 透明度只在不透明时省略，保持模板数据干净
      if (el.opacity !== 1) base.opacity = el.opacity;

      if (el.type === 'image') {
        const img = el as ImageElement;
        base.cropHint = 'cover';
        base.crop = { ...img.crop };
        return base;
      }

      const text = el as TextElement;
      const t: TemplateElement = {
        ...base,
        placeholder: text.content,
        fontSizeRatio: text.fontSize / (format.width * 2.83),
        textAlign: text.textAlign,
        fontWeight: text.fontWeight,
        color: text.color,
        lineHeight: text.lineHeight,
      };
      if (text.fontFamily && text.fontFamily !== 'sans-serif') t.fontFamily = text.fontFamily;
      if (text.rotation) t.rotation = text.rotation;
      // 固定文字标记也要写回，否则「新建模板」存下来的模板会丢掉它，
      // 下次用这个模板时这些装饰文字会被填上随机文案
      if (text.fixed) t.fixed = true;
      // 正文标记同理：丢了下次应用就变成「装饰小字」，不再填文案、也不跟正文样式走
      if (text.body !== undefined) t.body = text.body;
      // 短正文标记也要写回：丢了下次应用会按普通正文填长文案，撑出小文字框
      if (text.shortBody) t.shortBody = true;
      // 背景色也要写回，不然「新建模板」存下来下次应用就丢了
      if (text.backgroundColor) t.backgroundColor = text.backgroundColor;
      return t;
    });
}

/** 匹配容差：页面尺寸的 1%，另加 0.5mm 兜底 */
const MATCH_TOLERANCE_RATIO = 0.01;
const MATCH_TOLERANCE_MM = 0.5;

function withinTolerance(a: number, b: number, pageSize: number): boolean {
  return Math.abs(a - b) <= Math.max(pageSize * MATCH_TOLERANCE_RATIO, MATCH_TOLERANCE_MM);
}

/**
 * 反查页面来自哪个模板：按元素类型 + 相对几何位置做贪心匹配。
 * 用于给没有记录 templateId 的老页面找回模板（"保存模板"回写的前提）。
 * 只比几何、不比文字内容，因此改过文案/字体/颜色的页面仍能匹配上。
 */
export function matchTemplateForPage(
  page: Page,
  format: BookFormat
): TemplateDefinition | undefined {
  const candidates = page.elements.filter((el) => el.type === 'image' || el.type === 'text');
  if (candidates.length === 0) return undefined;

  let best: { template: TemplateDefinition; score: number } | undefined;

  for (const template of TEMPLATES) {
    if (template.elements.length !== candidates.length) continue;

    const used = new Array(candidates.length).fill(false);
    let score = 0;
    let matchedAll = true;

    for (const tplEl of template.elements) {
      const tplX = tplEl.x * format.width;
      const tplY = tplEl.y * format.height;
      const tplW = tplEl.width * format.width;
      const tplH = tplEl.height * format.height;

      let hit = -1;
      let hitDist = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        if (used[i] || candidates[i].type !== tplEl.type) continue;
        const el = candidates[i];
        if (!withinTolerance(el.x, tplX, format.width)) continue;
        if (!withinTolerance(el.y, tplY, format.height)) continue;
        if (!withinTolerance(el.width, tplW, format.width)) continue;
        if (!withinTolerance(el.height, tplH, format.height)) continue;
        const dist =
          Math.abs(el.x - tplX) + Math.abs(el.y - tplY) +
          Math.abs(el.width - tplW) + Math.abs(el.height - tplH);
        if (dist < hitDist) {
          hitDist = dist;
          hit = i;
        }
      }

      if (hit === -1) {
        matchedAll = false;
        break;
      }
      used[hit] = true;
      score += hitDist;
    }

    if (matchedAll && (!best || score < best.score)) {
      best = { template, score };
    }
  }

  return best?.template;
}

/**
 * 用页面当前样式生成一个新模板（页面反查不到模板时的"存为新模板"）
 */
export function createTemplateFromPage(
  page: Page,
  format: BookFormat,
  name: string,
  styleId: AlbumStyleId = 'classic'
): TemplateDefinition {
  return {
    id: `custom-${generateId()}`,
    name,
    category: '我的模板',
    description: '由页面样式保存的自定义模板',
    thumbnail: '',
    elements: pageElementsToTemplateElements(page.elements, format),
    styleId,
  };
}

/**
 * 用模板重新生成页面元素，但保留页面上已有的文字内容与图片
 * （"恢复默认"时使用：还原默认排版样式，不丢用户填的内容）
 */
export function reapplyTemplateKeepingContent(
  template: TemplateDefinition,
  format: BookFormat,
  page: Page,
  themeId: string = 'travel'
): { elements: Element[]; doodle?: PageDoodle; background?: PageBackground } {
  const oldElements = page.elements.filter((el) => el.type === 'image' || el.type === 'text');
  const imageIds = oldElements
    .filter((el) => el.type === 'image')
    .map((el) => (el as ImageElement).imageId);
  const oldTexts = oldElements.filter((el) => el.type === 'text') as TextElement[];

  const { elements: fresh, doodle } = applyTemplate(template, format, imageIds, themeId);

  let textIndex = 0;
  for (const el of fresh) {
    if (el.type !== 'text') continue;
    const old = oldTexts[textIndex];
    if (old?.content) (el as TextElement).content = old.content;
    textIndex++;
  }
  const pageBackground2 = template.backgroundImage
    ? { type: 'image' as const, value: template.backgroundImage }
    : { type: 'color' as const, value: template.background || '#ffffff' };

  return { elements: fresh, doodle, background: pageBackground2 };
}

/**
 * 模板分类的固定显示顺序
 */
const CATEGORY_ORDER: TemplateDefinition['category'][] = ['封面', '尾页', '一图', '二图', '三图', '四图', '五图', '六图', '七图', '八图', '十图', '十二图', '文字封面', '我的模板'];

/**
 * 获取模板分类列表（按固定顺序排列）
 */
export function getTemplateCategories(): string[] {
  const allCategories = new Set(TEMPLATES.map((t) => t.category));
  return CATEGORY_ORDER.filter((c) => allCategories.has(c));
}

/**
 * 隐藏的模板 id 列表（不显示在模板面板，以后可能再开放）
 */
const HIDDEN_TEMPLATE_IDS = ['full-image'];

/**
 * 按分类获取模板
 */
export function getTemplatesByCategory(category: string): TemplateDefinition[] {
  return TEMPLATES.filter((t) => t.category === category && !HIDDEN_TEMPLATE_IDS.includes(t.id));
}
