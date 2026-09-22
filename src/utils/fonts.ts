import type { FontWeight } from '@/types';

/**
 * 可用字体列表（Windows 系统常见字体，canvas 渲染可用）
 * value 为 CSS font-family 写法，直接用于 ctx.font
 */
export interface FontOption {
  /** 界面显示名 */
  label: string;
  /** CSS font-family 值 */
  value: string;
}

/**
 * 可选字重。数值写法在 canvas 的 ctx.font 和 CSS font-weight 里都直接有效。
 * 注意：多数中文字体只有常规/加粗两档，其余档位会落到最近的一档。
 */
export const FONT_WEIGHTS: { label: string; value: FontWeight }[] = [
  { label: '细', value: 300 },
  { label: '常规', value: 'normal' },
  { label: '中粗', value: 500 },
  { label: '半粗', value: 600 },
  { label: '加粗', value: 'bold' },
  { label: '特粗', value: 900 },
];

export const FONT_OPTIONS: FontOption[] = [
  { label: '无衬线（默认）', value: 'sans-serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { label: '黑体', value: '"SimHei", sans-serif' },
  { label: '等线', value: '"DengXian", sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: '宋体', value: '"SimSun", serif' },
  { label: '衬线（默认）', value: 'serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: '楷体', value: '"KaiTi", serif' },
  { label: '仿宋', value: '"FangSong", serif' },
  { label: '隶书', value: '"LiSu", serif' },
  { label: '华文行楷', value: '"STXingkai", serif' },
  { label: '华文新魏', value: '"STXinwei", serif' },
  { label: '等宽（Courier New）', value: '"Courier New", monospace' },
];
