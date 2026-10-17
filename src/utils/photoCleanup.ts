import type { Project } from '@/types';
import { collectAssetIds } from '@/engine/drawPageContent';
import { getAllProjects, getAllImageAssets, deleteImageAsset } from './storage';
import { removeUnusedAlbumPhotos, getImageLocations } from './folderLibrary';

export interface PhotoCleanupResult {
  /** 从相册文件夹里删掉的文件数 */
  removedFiles: number;
  /** 从浏览器库里删掉的照片记录数 */
  removedRecords: number;
}

/**
 * 清理不再使用的照片（点预览时静默执行）。
 *
 * 1. 当前相册文件夹：页面已经不再引用的照片文件直接删（换模板、换照片留下的垃圾）；
 * 2. 浏览器 IndexedDB：所有相册都不引用、磁盘上也没有登记的照片记录一并删掉。
 *
 * 引用检查是全局的——其他相册还在用的照片不会动。
 * 调用方负责：确实删了东西之后清空撤销历史（被删的照片已经回不来了，
 * 旧快照再留着，Ctrl+Z 只会撤销出空白图）。
 */
export async function cleanupUnusedPhotos(project: Project): Promise<PhotoCleanupResult> {
  const removedFiles = await removeUnusedAlbumPhotos(project);

  // 收集所有相册的引用，不只看当前这本
  const stillUsed = new Set<string>();
  for (const p of await getAllProjects()) {
    for (const id of collectAssetIds(p.pages)) stillUsed.add(id);
  }
  // 库里可能是防抖还没落盘的旧版本，以内存里的当前项目再并一次
  for (const id of collectAssetIds(project.pages)) stillUsed.add(id);

  let removedRecords = 0;
  for (const asset of await getAllImageAssets()) {
    if (stillUsed.has(asset.id)) continue;
    // 照片还登记在某个相册文件夹的清单里（磁盘上可能有文件）：记录留着，渲染时能自愈
    if (getImageLocations(asset.id).length > 0) continue;
    await deleteImageAsset(asset.id);
    removedRecords += 1;
  }

  return { removedFiles, removedRecords };
}
