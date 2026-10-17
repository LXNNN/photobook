/**
 * 跨页分组：整本书「哪两页摊开在一起」的唯一规则。
 *
 * [0]（封面）、[1,2]、[3,4]…，总页数为偶数时末页单独在左（背封/结尾页）。
 * 预览页（page-flip showCover）、双面图片导出、智能排版、编辑器双页显示
 * 全走这一份 —— 别在任何地方再写一套。
 *
 * 放在独立文件（而不是 exportImages.ts）是为了让编辑器引用它时不用把
 * fflate（只有导出才需要）一起拉进来。
 */
export function spreadGroups(total: number): number[][] {
  if (total <= 0) return [];
  const groups: number[][] = [[0]];
  for (let i = 1; i < total; i += 2) {
    groups.push(i + 1 < total ? [i, i + 1] : [i]);
  }
  return groups;
}
