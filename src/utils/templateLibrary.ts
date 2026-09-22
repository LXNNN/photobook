import {
  applyCustomTemplate,
  removeTemplate,
  restoreBuiltinTemplate,
  isBuiltinTemplate,
} from '@/templates';
import {
  getAllCustomTemplates,
  getAllDeletedTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  saveDeletedTemplate,
  clearDeletedTemplate,
} from '@/utils/storage';

// 「模板库」= 内置模板 + 用户覆盖 − 用户删除。
// 内存中的模板库在 @/templates 里（模块级可变数组），落盘在 utils/storage。
// 这个模块负责把两边对齐，避免 templates 反向依赖 storage 形成循环引用。

/**
 * 启动时加载模板库：先套用用户保存过的自定义模板，再剔除用户删掉的模板。
 * 必须在 React 渲染前 await 完。
 */
export async function initTemplateLibrary(): Promise<void> {
  const [customs, deletedIds] = await Promise.all([
    getAllCustomTemplates(),
    getAllDeletedTemplates(),
  ]);

  for (const tpl of customs) {
    applyCustomTemplate(tpl);
  }
  for (const id of deletedIds) {
    removeTemplate(id);
  }
}

/**
 * 从模板库删除一个模板，并落盘。
 * 内置模板删掉后另存一条墓碑记录，否则刷新时会随内置模板一起复活。
 */
export async function deleteTemplateFromLibrary(id: string): Promise<void> {
  const removed = removeTemplate(id);
  if (!removed) return;

  // 自定义模板的覆盖记录没用了，顺手清掉
  await deleteCustomTemplate(id);
  if (isBuiltinTemplate(id)) {
    await saveDeletedTemplate(id);
  }
}

/**
 * 恢复内置模板的默认样式，并落盘。
 * 该模板若已被删除，会一并从墓碑里救回来。
 * @returns 是否成功（false 表示该 id 不是内置模板，如用户新建的模板）
 */
export async function restoreTemplateFromLibrary(id: string): Promise<boolean> {
  const restored = restoreBuiltinTemplate(id);
  if (!restored) return false;

  await deleteCustomTemplate(id);
  await clearDeletedTemplate(id);
  return true;
}

/** 保存 / 覆盖一个模板，并落盘 */
export async function persistTemplate(template: Parameters<typeof saveCustomTemplate>[0]): Promise<void> {
  applyCustomTemplate(template);
  await saveCustomTemplate(template);
}
