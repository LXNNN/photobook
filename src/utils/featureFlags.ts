/**
 * 功能开关（构建时决定，不是用户可改的配置）
 */

/**
 * 【氛围感设计】入口是否开放。
 *
 * 2026-10-30 她的要求：这一轮线上先不开放氛围感——GitHub Pages 的构建里
 * 「氛围感设计」卡片置灰、显示「新模板制作中，敬请期待」；本地开发
 * （npm run dev）保持开放，方便继续做模板和调试。
 *
 * 2026-11-04 起全面开放（本地和线上构建都开）。
 * 想再藏起来就改回 import.meta.env.DEV（或直接 false），实现别删。
 */
export const ATMOSPHERE_STYLE_ENTRY_ENABLED = true;

/** 氛围感入口置灰时卡片上的提示文案（入口已开放，留着以后隐藏时用） */
export const ATMOSPHERE_STYLE_COMING_SOON = '新模板制作中，敬请期待';
