import type { BookFormat, Element, Project, TextElement } from '@/types';

/** 正文默认字号（pt）。改这里，全站正文的默认跟着变 */
export const DEFAULT_BODY_FONT_SIZE = 13;
/** 正文默认颜色。改这里，全站正文的默认跟着变 */
export const DEFAULT_BODY_COLOR = '#333333';
/** 标题默认字号（pt）。手写标题的默认大小，在标题线以上（A5 下 23pt） */
export const DEFAULT_TITLE_FONT_SIZE = 23;
/** 标题默认颜色 —— 跟模板里的标题同一个深灰 */
export const DEFAULT_TITLE_COLOR = '#2c2c2c';

/**
 * 要不要在编辑页顶栏显示「🎨 正文样式」这个入口。
 *
 * 这个版本先不上「一键换全书正文样式」（用户 2026-10-15 要求先藏起来，后续有需求再开放）：
 * 入口不显示，但判定口径（isBodyText / countBodyText）、弹窗组件、正文默认值都留着 ——
 * 模板正文照样是 13pt / #333333，「添加正文」也照样带正文标记。想放出来改成 true 即可。
 */
export const SHOW_BODY_STYLE_ENTRY = false;

/**
 * 标题线（pt）：模板里用 fontSizeRatio ≥ 0.04 区分标题和正文，落到具体开本上就是
 * 「字号 ≥ 页面宽 × 0.04 × 2.83」—— 2.83 是 mm→pt 的近似系数，applyTemplate 反推
 * 字号用的就是同一个式子。A5 下约 16.8pt：13pt 的正文都在线以下，17pt 往上的
 * 标题在线以上。
 */
export function titleFontSize(format: BookFormat): number {
  return format.width * 0.04 * 2.83;
}

/**
 * 是不是「正文」：文字元素、不是 fixed 装饰小字、字号没到标题线。
 *
 * 模板做出来的文字都带明确的 body 标记，优先认它 —— 封面上的英文小字、
 * 「记录者」这种短标签虽然字号也在标题线以下，但标了 body: false，不算正文。
 * 没有标记的是老相册（或用户手动加的元素），退回按字号猜，口径跟模板填充时一致。
 */
export function isBodyText(el: Element, format: BookFormat): el is TextElement {
  if (el.type !== 'text' || el.fixed) return false;
  if (el.body !== undefined) return el.body;
  return el.fontSize < titleFontSize(format);
}

/**
 * 是不是「标题」：跟正文一个套路 —— 标了 title 的优先认它（编辑页「添加标题」
 * 做出来的、模板里正文页的标题都带标记），没标的（老相册的数据）按字号是否
 * 到标题线判断。fixed 装饰小字永远不算标题。
 *
 * 封面/尾页上那些大字号的字（竖排 TIME、封面大标题）是设计稿的一部分，模板给
 * 它们标了 title: false，所以做「全局改标题样式」时不会被误伤。
 */
export function isTitleText(el: Element, format: BookFormat): el is TextElement {
  if (el.type !== 'text' || el.fixed) return false;
  if (el.title !== undefined) return el.title;
  return el.fontSize >= titleFontSize(format);
}

/** 这本相册里一共有多少处正文（弹窗上显示"将影响 N 处"） */
export function countBodyText(project: Project): number {
  let n = 0;
  for (const page of project.pages) {
    for (const el of page.elements) {
      if (isBodyText(el, project.format)) n++;
    }
  }
  return n;
}
