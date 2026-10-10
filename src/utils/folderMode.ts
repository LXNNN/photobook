import { getSetting, setSetting, deleteSetting } from './storage';

/**
 * 文件夹模式 · 连接层
 *
 * 职责：能力检测、授权管理、句柄存取（IndexedDB settings）、文件原语
 * （读/写/列目录/原子写/删除）、模块级连接状态。
 *
 * 约定（数据安全红线，见设计文档 §8）：
 * - 一切文件操作都在用户所选目录的 `photo-book\` 子目录内部，外面一概不碰
 * - 写文件一律 createWritable → write → close（close 才原子落盘）；
 *   清单写后重新读出 parse 校验，照片写后核对大小
 * - 状态对象是模块级可订阅的（useSyncExternalStore 用），只在变化时换引用
 */

export const ROOT_DIR_NAME = 'photo-book';
export const ALBUM_DATA_FILE = '相册数据.json';
export const PHOTO_DIR_NAME = '照片';
export const TEMPLATE_FILE = '我的模板.json';
export const README_FILE = '先看我-说明.txt';

const HANDLE_SETTING_KEY = 'folderHandle';
const MIGRATED_SETTING_KEY = 'folderMigrated';

// ==================== Chromium 专属 API 的类型补充 ====================
// lib.dom 对 picker / 权限方法 / isSameEntry 的标注不全，这里补最小声明；运行时全部有存在性判断

export type PermissionStateLite = 'granted' | 'denied' | 'prompt';

interface HandleWithPerm extends FileSystemHandle {
  queryPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionStateLite>;
  requestPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionStateLite>;
}

interface PickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
}

export function isFolderModeSupported(): boolean {
  return typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

// ==================== 连接状态（模块级可订阅） ====================

export type FolderState = 'unsupported' | 'off' | 'connected' | 'needs-reconnect' | 'folder-missing';

export interface FolderStatus {
  state: FolderState;
  /** 已连接/有记录时的文件夹名（浏览器不给绝对路径，只有名字） */
  folderName: string;
  /** 有改动还没写进文件夹（写盘失败/断连期间产生），重连成功后自动补写 */
  pendingWrites: boolean;
  /** 守卫拦下动作时置位：横幅亮起来提醒用户点重连 */
  attention: boolean;
  /** 连接/合并/删除等完成 +1，页面据此刷新书架 */
  dataVersion: number;
}

let status: FolderStatus = {
  state: 'off',
  folderName: '',
  pendingWrites: false,
  attention: false,
  dataVersion: 0,
};

const listeners = new Set<() => void>();

function update(patch: Partial<FolderStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeFolderStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** useSyncExternalStore 的 getSnapshot：状态没变时返回同一引用 */
export function getFolderStatus(): FolderStatus {
  return status;
}

export function setFolderState(state: FolderState, folderName?: string): void {
  update(folderName === undefined ? { state } : { state, folderName });
}

export function setPendingWrites(value: boolean): void {
  if (status.pendingWrites !== value) update({ pendingWrites: value });
}

export function setAttention(value: boolean): void {
  if (status.attention !== value) update({ attention: value });
}

export function bumpDataVersion(): void {
  update({ dataVersion: status.dataVersion + 1 });
}

// ==================== 选择文件夹与授权 ====================

/** 弹出系统文件夹选择框。用户取消返回 undefined；其他错误原样抛出 */
export async function pickFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const picker = (window as PickerWindow).showDirectoryPicker?.bind(window);
  if (!picker) return undefined;
  try {
    return await picker({ id: 'photo-book', mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return undefined;
    throw err;
  }
}

export async function queryFolderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionStateLite> {
  const fn = (handle as HandleWithPerm).queryPermission;
  return fn ? fn.call(handle, { mode: 'readwrite' }) : 'prompt';
}

/** 重新申请权限。必须在用户手势（点击）里调用，浏览器只认手势 */
export async function requestFolderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionStateLite> {
  const fn = (handle as HandleWithPerm).requestPermission;
  return fn ? fn.call(handle, { mode: 'readwrite' }) : 'prompt';
}

// ==================== 句柄与标志的存取 ====================

export async function getStoredFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return getSetting<FileSystemDirectoryHandle>(HANDLE_SETTING_KEY);
}

export async function storeFolderHandle(handle: FileSystemDirectoryHandle | undefined): Promise<void> {
  if (handle) await setSetting(HANDLE_SETTING_KEY, handle);
  else await deleteSetting(HANDLE_SETTING_KEY);
}

/** 新选的文件夹是不是记录里的同一个（浏览器重启后重新选目录时用来判断） */
export async function storedFolderMatches(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const stored = await getStoredFolderHandle();
  if (!stored) return false;
  try {
    return await stored.isSameEntry(handle);
  } catch {
    return false;
  }
}

/** 本机是否已把书架搬进当前记录的文件夹（首次启用/迁移后置位；换文件夹重算） */
export async function getMigratedFlag(): Promise<boolean> {
  return (await getSetting<boolean>(MIGRATED_SETTING_KEY)) === true;
}

export async function setMigratedFlag(value: boolean): Promise<void> {
  await setSetting(MIGRATED_SETTING_KEY, value);
}

// ==================== 文件原语 ====================

let cachedRoot: FileSystemDirectoryHandle | null = null;

export function setRootDirCache(handle: FileSystemDirectoryHandle | null): void {
  cachedRoot = handle;
}

/**
 * 从指定父目录拿 `photo-book\` 根句柄（不碰缓存）。
 * 用户选完文件夹、还在确认弹窗阶段时用它看一眼，不能污染当前连接的缓存。
 */
export async function getRootDirFrom(
  parent: FileSystemDirectoryHandle,
  options?: { create?: boolean }
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(ROOT_DIR_NAME, options?.create ? { create: true } : undefined);
}

/**
 * 拿 `photo-book\` 根目录句柄。读不到/未连接时抛错，调用方负责状态转换。
 * create 只在首次启用/指认新文件夹时传。
 */
export async function getRootDir(options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
  if (!cachedRoot) {
    const parent = await getStoredFolderHandle();
    if (!parent) throw new Error('还没有连接文件夹');
    cachedRoot = await getRootDirFrom(parent, options);
  }
  return cachedRoot;
}

export type JsonReadResult<T> = { ok: true; value: T } | { ok: false; reason: 'missing' | 'corrupt' };

export async function readJsonFile<T>(dir: FileSystemDirectoryHandle, name: string): Promise<JsonReadResult<T>> {
  let file: File;
  try {
    const handle = await dir.getFileHandle(name);
    file = await handle.getFile();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return { ok: false, reason: 'missing' };
    throw err;
  }
  try {
    return { ok: true, value: JSON.parse(await file.text()) as T };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

async function atomicWrite(dir: FileSystemDirectoryHandle, name: string, data: Blob): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  // close() 才真正落盘（先写临时文件再原子替换），中途失败不损坏原有文件
  await writable.close();
}

/** 写文本文件（说明文件等） */
export async function writeTextFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  await atomicWrite(dir, name, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

/** 写 json 文件并抽查：重新读出、能 parse 才算数（§7.5） */
export async function writeJsonFile(dir: FileSystemDirectoryHandle, name: string, value: unknown): Promise<void> {
  await atomicWrite(dir, name, new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const check = await readJsonFile(dir, name);
  if (!check.ok) throw new Error(`${name} 写入后校验失败`);
}

/** 写照片文件并核对大小：写进去的和源数据一个字节不差才算数（§7.5） */
export async function writeBlobFile(dir: FileSystemDirectoryHandle, name: string, blob: Blob): Promise<void> {
  await atomicWrite(dir, name, blob);
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  if (file.size !== blob.size) {
    throw new Error(`${name} 写入后大小不一致（写入 ${file.size} / 源 ${blob.size}）`);
  }
}

/** 列目录（按名字排序，稳定可重跑） */
export async function listEntries(
  dir: FileSystemDirectoryHandle
): Promise<Array<{ name: string; handle: FileSystemHandle }>> {
  const out: Array<{ name: string; handle: FileSystemHandle }> = [];
  const iterable = dir as unknown as {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  for await (const [name, handle] of iterable.entries()) {
    out.push({ name, handle });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return out;
}

/** 子目录句柄；不存在返回 undefined；create 时顺带创建 */
export async function getSubDir(
  dir: FileSystemDirectoryHandle,
  name: string,
  options?: { create?: boolean }
): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await dir.getDirectoryHandle(name, options?.create ? { create: true } : undefined);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return undefined;
    throw err;
  }
}

/** 读相册文件夹里的文件（relPath 如 "照片/0001.jpg"） */
export async function readFileAt(albumDir: FileSystemDirectoryHandle, relPath: string): Promise<File> {
  const parts = relPath.split('/').filter(Boolean);
  let current: FileSystemDirectoryHandle = albumDir;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i]);
  }
  const handle = await current.getFileHandle(parts[parts.length - 1]);
  return handle.getFile();
}

export interface DeleteReport {
  /** 删掉的文件/目录个数 */
  deleted: number;
  /** 没删掉的（被占用等），相对 photo-book 的路径 */
  failed: string[];
}

/**
 * 逐文件删掉一本相册的整个文件夹。
 * 调用方必须先核对过 `相册数据.json` 里的相册 id（§6.10 第 3 步）——
 * 这个函数只管删，不做任何判断。个别文件删不掉不中断，删完其余，最后汇报。
 */
export async function deleteAlbumFolder(folderName: string): Promise<DeleteReport> {
  const report: DeleteReport = { deleted: 0, failed: [] };
  const root = await getRootDir();

  let albumDir: FileSystemDirectoryHandle;
  try {
    albumDir = await root.getDirectoryHandle(folderName);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return report; // 已经不在了，视作删干净
    throw err;
  }

  const clearDir = async (dir: FileSystemDirectoryHandle, path: string): Promise<void> => {
    for (const entry of await listEntries(dir)) {
      const entryPath = `${path}${entry.name}`;
      try {
        if (entry.handle.kind === 'directory') {
          await clearDir(entry.handle as FileSystemDirectoryHandle, `${entryPath}/`);
        }
        await dir.removeEntry(entry.name);
        report.deleted += 1;
      } catch {
        report.failed.push(entryPath);
      }
    }
  };

  await clearDir(albumDir, `${ROOT_DIR_NAME}/${folderName}/`);
  try {
    await root.removeEntry(folderName);
    report.deleted += 1;
  } catch {
    report.failed.push(`${ROOT_DIR_NAME}/${folderName}`);
  }
  return report;
}
