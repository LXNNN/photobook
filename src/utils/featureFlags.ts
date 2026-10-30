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
 * 所以这里按构建模式判断：dev = 开放，build = 置灰。
 * 想全面开放时，直接改成 true 即可（线上重新构建部署）。
 */
export const ATMOSPHERE_STYLE_ENTRY_ENABLED = import.meta.env.DEV;

/** 氛围感入口置灰时卡片上的提示文案 */
export const ATMOSPHERE_STYLE_COMING_SOON = '新模板制作中，敬请期待';
