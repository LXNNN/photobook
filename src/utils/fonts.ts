import type { FontWeight, Page } from '@/types';

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
  { label: '加粗', value: 'bold' },
  { label: '特粗', value: 900 },
];

/**
 * 艺术字体：字体文件随网站放在 src/assets/fonts（@font-face 声明在 index.css），
 * 不依赖用户电脑装没装。都是 OFL / 免费商用授权，授权文件就在同目录。
 *
 * 编辑页右侧字体下拉里单独成一组。
 */
export const ART_FONT_OPTIONS: FontOption[] = [
  { label: '得意黑', value: '"Smiley Sans", sans-serif' },
  { label: '龙藏体', value: '"Long Cang", "KaiTi", serif' },
  { label: 'Great Vibes（英文花体）', value: '"Great Vibes", cursive' },
  { label: 'Playfair Display（英文衬线）', value: '"Playfair Display", serif' },
  { label: 'Montserrat（英文无衬线）', value: '"Montserrat", sans-serif' },
];

/** 系统字体：靠用户电脑自己装的字体，换电脑/换系统可能不一样 */
export const SYSTEM_FONT_OPTIONS: FontOption[] = [
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

/** 全部字体（判断「当前字体在不在列表里」这类事用它） */
export const FONT_OPTIONS: FontOption[] = [...ART_FONT_OPTIONS, ...SYSTEM_FONT_OPTIONS];

/**
 * 等指定字体真正可用。
 *
 * canvas 不会等 @font-face 下载完：字体没就绪时 ctx.font 会落到 fallback，
 * 而且画上去之后不会自动重画——缩略图、预览图、300dpi PDF 都会把这个
 * fallback 固化下来。所以每一处 drawPageContent 之前都要先 await 一遍。
 *
 * 系统字体没有 @font-face，document.fonts.load 会立即 resolve，不拖慢；
 * 字体名写错也只是加载不到，不抛错，照常用 fallback 画。
 */
export async function loadFontFamilies(families: Iterable<string>): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(
    [...families].map((family) =>
      document.fonts.load(`16px ${family}`).catch(() => {
        // 加载失败就用 fallback，不能因为一个字体名把整页绘制卡死
      })
    )
  );
}

/** 收集页面里文字元素用到的全部字体，等它们就绪 */
export async function ensureFontsLoaded(pages: Page[]): Promise<void> {
  const families = new Set<string>();
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.type === 'text') families.add(el.fontFamily || 'sans-serif');
    }
  }
  await loadFontFamilies(families);
}

/** font-family 列表里真正要查的第一个字体（后面的都是 fallback） */
function firstFamily(fontFamily: string): string {
  return (fontFamily || 'sans-serif').split(',')[0].trim();
}

/**
 * 页面用到的字体是否都真正就绪。用来判断「要不要等字体加载完再重绘一遍」——
 * 已经就绪时不必每帧多画一次（拖拽时每帧都会触发渲染）。
 * 电脑上没注册的字体（比如系统字体被换掉）会直接算可用，按 fallback 画就行。
 */
export function fontsReady(pages: Page[]): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true;
  const families = new Set<string>();
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.type === 'text') families.add(firstFamily(el.fontFamily));
    }
  }
  return [...families].every((family) => document.fonts.check(`16px ${family}`));
}
