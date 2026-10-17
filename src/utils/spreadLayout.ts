import type { Page } from '@/types';
import { spreadGroups } from './spread';

/**
 * 编辑页双页排版的位置计算。
 *
 * 数据模型不动：pages 还是一页一条的平数组，元素照旧按页存。这里只负责
 * 「哪两页算一个跨页、各自在双页画布上放在哪」——所有插页/删页/拖拽的
 * 下标计算也集中在这里，别在组件里手算，算错一下就把跨页劈开了。
 */

/** 双页画布上的一个页面：原始下标 + 在画布里的横向偏移（mm） */
export interface SpreadPage {
  /** 在 project.pages 里的下标 */
  index: number;
  page: Page;
  /** 画布内横向偏移（mm）：落单页居中 = 页宽/2，配对页 = 0 或 页宽 */
  offsetX: number;
}

function clampPageIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, index));
}

/**
 * 取包含 index 的那一组跨页（[0]、[1,2]、[3,4]…）。
 * 越界时先 clamp —— undo 之后页码可能暂时越界，不能因此白屏。
 */
export function spreadGroupAt(index: number, total: number): number[] {
  if (total <= 0) return [];
  const i = clampPageIndex(index, total);
  return spreadGroups(total).find((group) => group.includes(i)) ?? [];
}

/**
 * 跨页锚页 = 这一组的第一个页。
 * editor.currentPageIndex 存的就是它（「当前在哪一个跨页」）。
 */
export function anchorOf(index: number, total: number): number {
  return spreadGroupAt(index, total)[0] ?? 0;
}

/** 这一组是否只有一页（封面 / 总页数为偶数时的结尾页） */
export function isLoneGroup(index: number, total: number): boolean {
  return spreadGroupAt(index, total).length === 1;
}

/**
 * 页面在双页画布里的横向偏移（mm）。
 * 画布永远是两页宽；落单页居中，配对页一左一右。
 */
export function pageOffsetX(positionInGroup: number, groupLength: number, pageWidth: number): number {
  if (groupLength <= 1) return pageWidth / 2;
  return positionInGroup * pageWidth;
}

/** 按当前锚页组出双页画布要画的 1~2 页（带偏移） */
export function buildSpreadPages(pages: Page[], anchorIndex: number, pageWidth: number): SpreadPage[] {
  const group = spreadGroupAt(anchorIndex, pages.length);
  return group.map((index, position) => ({
    index,
    page: pages[index],
    offsetX: pageOffsetX(position, group.length, pageWidth),
  }));
}

/** 元素在哪一页（找不到返回 -1）。跨页多选、批量删除、属性面板都靠它定位 */
export function findElementPage(pages: Page[], elementId: string): number {
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].elements.some((el) => el.id === elementId)) return i;
  }
  return -1;
}

/**
 * 「在当前跨页后面插入一对」的插入位。
 * 当前跨页是结尾落单页时插在它**前面**（保住它最后单独占一页的位置）；
 * 封面哪怕也落单（只有一页的相册）仍然插在它后面。
 */
export function insertAfterSpread(anchorIndex: number, total: number): number {
  const group = spreadGroupAt(anchorIndex, total);
  if (group.length === 0) return total;
  const last = group[group.length - 1];
  if (group.length === 1 && last > 0 && last === total - 1) return last;
  return last + 1;
}

/**
 * 列表底部「+ 添加页面」的插入位：接在正文最后、结尾落单页之前。
 * 总页数为偶数时末页是落单的结尾页，不能把新的一对插到它后面。
 */
export function appendPairIndex(total: number): number {
  if (total <= 1) return total;
  if (total % 2 === 0) return total - 1;
  return total;
}

/**
 * 拖拽跨页排序：把 from 开始的一对页面挪到 beforeIndex 那一组的前面。
 * 返回的下标直接喂给 projectSlice.movePages（先删后插的语义）。
 * 落单页（封面/结尾页）不参与拖拽，原样返回。
 */
export function movePairBefore(
  from: number,
  beforeIndex: number,
  total: number
): { from: number; to: number } {
  const group = spreadGroupAt(from, total);
  if (group.length !== 2) return { from, to: from };

  // 插到末尾用 total；否则对齐到目标组的锚页；封面永远是第一页
  const target = beforeIndex >= total ? total : Math.max(1, spreadGroupAt(beforeIndex, total)[0] ?? total);
  const to = target > from ? target - 2 : target;
  return { from: group[0], to };
}

/** 删掉一对页面之后，当前跨页该落在哪一页（落回后一组；删的是最后一组就回上一组） */
export function anchorAfterDelete(deletedAnchor: number, totalAfter: number): number {
  if (totalAfter <= 0) return 0;
  return anchorOf(Math.min(deletedAnchor, totalAfter - 1), totalAfter);
}

/** 全部跨页锚页（顶栏 ‹ › 切跨页用） */
export function spreadAnchors(total: number): number[] {
  return spreadGroups(total).map((group) => group[0]);
}
