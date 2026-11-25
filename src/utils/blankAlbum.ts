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
 * 空白相册创建时不选主题（themeId 为空），智能生成的相册都是先选了主题才生成
 * （themeId 一定有）。这个线索不受「套没套模板、放没放照片」影响 —— 她已有的
 * 空白相册（比如「模板设计经典图文」）套了模板、放了照片也照样认得出来。
 * 编辑器加载时调一次，识别到就补写标记并随自动保存落盘。
 */
export function looksLikeBlankAlbum(project: Project): boolean {
  if (project.isBlankAlbum !== undefined) return false;
  return !project.themeId;
}
