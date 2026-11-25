import type { Project } from '@/types';

/**
 * 空白相册：书架「+ 空白相册」建出来的相册。
 *
 * 它的页面全是用户自己设计的（没有智能排版生成的模板页），所以右键菜单
 * 多一个「添加页尾」——只在这种相册里开放，普通相册必须保持跨页成对添加。
 */
export function isBlankAlbum(project: Project): boolean {
  return project.isBlankAlbum === true;
}

/**
 * 识别功能上线前建的老空白相册（它们的数据里还没有 isBlankAlbum 标记）。
 *
 * 条件刻意保守：没有任何照片、没套过模板、背景都是纯色。智能生成的相册
 * 每一页都有 templateId，所以不会误判；手动改过的普通相册也基本带着模板 id。
 * 编辑器加载时调一次，识别到就补写标记并随自动保存落盘 —— 之后用户就算
 * 套模板、加照片，标记也还在，右键「添加页尾」不会突然消失。
 */
export function looksLikeBlankAlbum(project: Project): boolean {
  if (project.isBlankAlbum !== undefined) return false;
  return project.pages.every(
    (page) =>
      !page.templateId &&
      page.background.type === 'color' &&
      !page.elements.some((el) => el.type === 'image')
  );
}
