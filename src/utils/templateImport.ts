import { getAllCustomTemplates, saveCustomTemplate, type CustomTemplateRecord } from './storage';

/**
 * 自定义模板的合并导入。
 *
 * 从 backup.ts 提取出来，是因为文件夹模式也要用同一套合并规则
 * （连接文件夹时把 `我的模板.json` 并进模板库），而 folderLibrary 不能
 * import backup.ts（backup → assetStore → folderLibrary 会成环）。
 *
 * 注意：这里只写 IndexedDB；内存里的模板库（@/templates）由调用方负责
 * 应用（备份导入流程保持原样，文件夹流程会自己调 applyCustomTemplate）。
 */

/**
 * 导入的模板来自外部文件，可能被改坏、也可能是旧版本导出的。
 * 这里做最低限度的校验，结构不对就整个丢掉 —— 让 NaN 坐标进了库，
 * 套用模板时整页元素会飞到画布外面，比少一个模板难查得多。
 */
export function isUsableTemplate(t: unknown): t is CustomTemplateRecord {
  const tpl = t as CustomTemplateRecord;
  if (!tpl || typeof tpl.id !== 'string' || typeof tpl.name !== 'string') return false;
  if (!Array.isArray(tpl.elements) || tpl.elements.length === 0) return false;
  return tpl.elements.every(
    (el) =>
      !!el &&
      (el.type === 'image' || el.type === 'text') &&
      [el.x, el.y, el.width, el.height].every(
        (n) => typeof n === 'number' && Number.isFinite(n)
      )
  );
}

export interface TemplateImportResult {
  /** 新增的（含被改名的） */
  added: number;
  /** 覆盖掉的同 id 模板 */
  updated: number;
  /** 其中因为重名而改过名的 */
  renamed: number;
}

/**
 * 把一批自定义模板写进库。
 *
 * 冲突规则：**id 相同就是同一个模板**（比如把自己电脑的备份导回来），直接更新，
 * 反复导入也只有一个；**只是名字撞上、id 不同的，两个都留**，后导入的改名成
 * 「XX（导入）」。这样两头都不会丢东西，也不会越导越多副本。
 */
export async function importTemplates(
  templates: CustomTemplateRecord[]
): Promise<TemplateImportResult> {
  if (templates.length === 0) return { added: 0, updated: 0, renamed: 0 };

  const local = await getAllCustomTemplates();
  const localIds = new Set(local.map((t) => t.id));
  const takenNames = new Set(local.map((t) => t.name));

  let added = 0;
  let updated = 0;
  let renamed = 0;

  for (const tpl of templates) {
    if (!isUsableTemplate(tpl)) continue;

    if (localIds.has(tpl.id)) {
      await saveCustomTemplate({ ...tpl, category: '我的模板' });
      updated += 1;
      continue;
    }

    let name = tpl.name;
    if (takenNames.has(name)) {
      name = `${tpl.name}（导入）`;
      for (let i = 2; takenNames.has(name); i++) name = `${tpl.name}（导入${i}）`;
      renamed += 1;
    }
    takenNames.add(name);
    localIds.add(tpl.id);

    // category 强制成「我的模板」：模板面板靠它决定归到哪一组、要不要显示删除按钮
    await saveCustomTemplate({ ...tpl, name, category: '我的模板' });
    added += 1;
  }

  return { added, updated, renamed };
}
