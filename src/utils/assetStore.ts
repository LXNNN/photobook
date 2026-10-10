import type { ImageAsset } from '@/types';
import {
  getImageAsset as getImageFromIDB,
  getImageRecord,
  saveImageAsset as saveImageToIDB,
} from './storage';
import {
  getFolderStatus,
  setAttention,
  setFolderState,
} from './folderMode';
import {
  getImageLocations,
  isFolderConnected,
  markAlbumWritePending,
  readImageFile,
  saveImageToAlbum,
} from './folderLibrary';

/**
 * 资产仓库：读图 / 存图的统一入口。
 *
 * 页面代码不再直接摸 IndexedDB 里的图片 —— 已启用文件夹模式时，
 * 原图在磁盘（相册文件夹\照片\），这里负责从磁盘读、带一个小 LRU 缓存
 * （避免一屏渲染/翻页/缩放时同一张图反复读盘）；未启用时就是 IndexedDB（现状）。
 *
 * 出口仍然返回带 blob 的 ImageAsset：drawPageContent 及全部渲染代码一份不改。
 *
 * 依赖方向：assetStore ← 页面 / backup.ts；assetStore 自己 import folderLibrary。
 */

/** LRU 上限：几十张就够了，目的只有一个 —— 同屏不反复读盘 */
const LRU_MAX = 40;

const cache = new Map<string, ImageAsset>();

function cacheGet(id: string): ImageAsset | undefined {
  const hit = cache.get(id);
  if (hit) {
    // 提到最新（Map 的迭代顺序即 LRU 顺序）
    cache.delete(id);
    cache.set(id, hit);
  }
  return hit;
}

function cacheSet(id: string, asset: ImageAsset): void {
  cache.delete(id);
  cache.set(id, asset);
  if (cache.size > LRU_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * 渲染用全图。
 *
 * id 允许 undefined：模板留下的空图片区域就是没有 imageId 的元素，
 * `getImageRecord(undefined)` 会抛 DataError 把整个加载循环打断
 * （历史上踩过这个坑），这里统一挡掉，调用方不用人人记得。
 */
export async function getImageAsset(id: string | undefined): Promise<ImageAsset | undefined> {
  if (!id) return undefined;

  const cached = cacheGet(id);
  if (cached) return cached;

  if (isFolderConnected()) {
    // 磁盘优先（同一 id 可能散在多本相册里，任取其一）
    for (const loc of getImageLocations(id)) {
      try {
        const file = await readImageFile(loc);
        const record = await getImageRecord(id);
        const asset: ImageAsset = {
          id,
          blob: file,
          thumbnail: record?.thumbnail ?? '',
          width: record?.width ?? 0,
          height: record?.height ?? 0,
          size: file.size,
          createdAt: record?.createdAt ?? Date.now(),
        };
        cacheSet(id, asset);
        return asset;
      } catch {
        // 这处读不到就试下一处
      }
    }
    // 文件夹里都没有：落下去看浏览器里还留着大图的没有（还没搬过家的照片）
  }

  const record = await getImageFromIDB(id).catch(() => undefined);
  if (record?.blob) {
    const asset = record as ImageAsset;
    cacheSet(id, asset);
    return asset;
  }
  return undefined;
}

/**
 * 只要缩略图/元数据（书架封面、侧栏小预览）：
 * 永远读 IndexedDB，绝不触发读盘。
 */
export async function getImageMeta(
  id: string | undefined
): Promise<{ thumbnail: string; width: number; height: number } | undefined> {
  if (!id) return undefined;
  const record = await getImageRecord(id).catch(() => undefined);
  if (!record) return undefined;
  return { thumbnail: record.thumbnail, width: record.width, height: record.height };
}

/**
 * 上传 / 替换照片。
 * - 已连接：写进该相册文件夹（写后校验）→ 元数据 + 缩略图进 IndexedDB（大图不留浏览器）
 * - 未连接但启用了文件夹模式：带大图暂存在 IndexedDB + 记待补写，重连后自动补写（§6.6）
 * - 写盘失败：转 needs-reconnect，改动不丢（大图在浏览器里）
 * - 未启用（off / unsupported）：现状，直接存 IndexedDB
 */
export async function saveImageAsset(projectId: string, asset: ImageAsset): Promise<void> {
  const state = getFolderStatus().state;

  if (state === 'connected') {
    try {
      await saveImageToAlbum(projectId, asset);
      cacheSet(asset.id, asset);
      return;
    } catch (err) {
      console.warn('照片没写进文件夹，先在浏览器里存一份', err);
      markAlbumWritePending();
      setFolderState('needs-reconnect');
      setAttention(true);
    }
  } else if (state === 'needs-reconnect' || state === 'folder-missing') {
    // 断连期间的上传：暂存 + 待补写
    markAlbumWritePending();
  }

  await saveImageToIDB(asset);
  cacheSet(asset.id, asset);
}
