import type { ImageAsset, Project, StoredImageRecord } from '@/types';
import { collectAssetIds } from '@/engine/drawPageContent';
import { applyCustomTemplate } from '@/templates';
import {
  deleteProject,
  getAllCustomTemplates,
  getAllProjects,
  getImageRecord,
  getSetting,
  saveImageRecord,
  saveProject,
  setSetting,
  stripImageBlob,
  type CustomTemplateRecord,
} from './storage';
import {
  ALBUM_DATA_FILE,
  PHOTO_DIR_NAME,
  README_FILE,
  TEMPLATE_FILE,
  bumpDataVersion,
  deleteAlbumFolder,
  getFolderStatus,
  getMigratedFlag,
  getRootDir,
  getRootDirFrom,
  getStoredFolderHandle,
  getSubDir,
  isFolderModeSupported,
  listEntries,
  queryFolderPermission,
  readFileAt,
  readJsonFile,
  requestFolderPermission,
  setAttention,
  setFolderState,
  setMigratedFlag,
  setPendingWrites,
  setRootDirCache,
  storeFolderHandle,
  storedFolderMatches,
  writeBlobFile,
  writeJsonFile,
  writeTextFile,
} from './folderMode';
import { extFor, safeFolderName } from './fileNames';
import { importTemplates, isUsableTemplate } from './templateImport';
import { createThumbnail, loadImage } from './image';
import { setTemplateChangeHook } from './templateLibrary';

/**
 * 文件夹模式 · 书架层
 *
 * 职责：各相册文件夹的 `相册数据.json` 读写、连接合并（§6.5）、迁移、
 * 删除（连同磁盘）、`我的模板.json` 镜像、照片编号、图片位置索引、缩略图回填。
 *
 * 依赖方向：storage ← folderMode ← 本模块 ← assetStore ← 页面。
 * 本模块不 import assetStore / backup（会成环）；模板库通过注册钩子反过来通知本模块。
 *
 * 红线（§8）：一切文件动作都在 `photo-book\` 里；写盘全部"写后校验"；
 * 清浏览器大图（stripImageBlob）只在对应照片写盘校验通过之后；
 * 删磁盘只有一处 —— 用户在网站上确认删相册（删前核对相册 id）。
 */

const ALBUM_FORMAT = 1;

// ==================== 书架提示（轻提示队列） ====================
// 合并/迁移过程中发现的被动变化（相册被移除、数据读失败……），
// 页面在 dataVersion 变化时取走并弹 toast。

const notices: string[] = [];

function pushNotice(text: string): void {
  notices.push(text);
}

/** 取走并清空待展示的提示 */
export function takeFolderNotices(): string[] {
  return notices.splice(0);
}

// ==================== 待补写标记 ====================
// 「有改动还没写进文件夹」。相册与模板各记一份，合并成一个对外状态。

let albumWritePending = false;
let templateWritePending = false;

function updatePendingFlag(): void {
  setPendingWrites(albumWritePending || templateWritePending);
}

/** 资产仓库写盘失败/断连暂存时用它记「有改动没写进文件夹」 */
export function markAlbumWritePending(): void {
  albumWritePending = true;
  updatePendingFlag();
}

function isConnected(): boolean {
  return getFolderStatus().state === 'connected';
}

export function isFolderConnected(): boolean {
  return isConnected();
}

/**
 * 操作守卫（§5.3）：文件夹模式启用后还没连上时，拦下进编辑器/上传/删除/备份等动作。
 * 返回 false 时置 attention，横幅会亮起来引导重连。
 * 未启用（off）/ 浏览器不支持（unsupported）时一切如旧，不拦截。
 */
export function ensureFolderReady(): boolean {
  const state = getFolderStatus().state;
  if (state === 'off' || state === 'unsupported' || state === 'connected') return true;
  setAttention(true);
  return false;
}

// ==================== 相册清单与内存缓存 ====================

/** 一本相册的 `相册数据.json` 结构（§7.3） */
export interface AlbumImageRecord {
  id: string;
  /** 相对该相册文件夹，如 "照片/0001.jpg" */
  file: string;
  type: string;
  width: number;
  height: number;
  size: number;
  createdAt: number;
}

interface AlbumFile {
  app: 'photo-book';
  formatVersion: number;
  updatedAt: number;
  project: Project;
  images: AlbumImageRecord[];
}

interface AlbumEntry {
  /** 相册文件夹名（相对 photo-book 根），创建时定下，网站内改名不同步 */
  folder: string;
  /** 图片 id → 文件位置（含暂不再用到的旧图，只增不减；删文件只发生在删相册） */
  images: Map<string, AlbumImageRecord>;
  nextNumber: number;
  /** 最近一次写清单的项目快照：上传照片时清单要用它 */
  project?: Project;
}

const albumEntries = new Map<string, AlbumEntry>();

/** 图片 id → 文件位置（同一 id 可能散在多本相册里，任取其一读取） */
const imageLocations = new Map<string, Array<{ folder: string; file: string }>>();

export function getImageLocations(id: string): Array<{ folder: string; file: string }> {
  return imageLocations.get(id) ?? [];
}

/** 按位置读一个文件（assetStore 读照片用） */
export async function readImageFile(loc: { folder: string; file: string }): Promise<File> {
  const root = await getRootDir();
  const dir = await root.getDirectoryHandle(loc.folder);
  return readFileAt(dir, loc.file);
}

function addLocation(id: string, loc: { folder: string; file: string }): void {
  const list = imageLocations.get(id);
  if (!list) {
    imageLocations.set(id, [loc]);
    return;
  }
  if (!list.some((l) => l.folder === loc.folder && l.file === loc.file)) list.push(loc);
}

function registerLocations(entry: AlbumEntry): void {
  for (const rec of entry.images.values()) addLocation(rec.id, { folder: entry.folder, file: rec.file });
}

function dropLocations(folder: string): void {
  for (const [id, list] of imageLocations) {
    const remaining = list.filter((l) => l.folder !== folder);
    if (remaining.length) imageLocations.set(id, remaining);
    else imageLocations.delete(id);
  }
}

export function getAlbumFolderName(projectId: string): string | undefined {
  return albumEntries.get(projectId)?.folder;
}

// ==================== 小工具 ====================

export function isNotFoundError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError';
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** 从 "0007.jpg" 里取编号；认不出来就当 0 */
function fileNumber(name: string): number {
  const m = /^(\d+)/.exec(baseName(name));
  return m ? Number(m[1]) : 0;
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function albumDir(entry: AlbumEntry): Promise<FileSystemDirectoryHandle> {
  const root = await getRootDir();
  return root.getDirectoryHandle(entry.folder);
}

async function ensurePhotoDir(entry: AlbumEntry): Promise<FileSystemDirectoryHandle> {
  const dir = await albumDir(entry);
  const photoDir = await getSubDir(dir, PHOTO_DIR_NAME, { create: true });
  if (!photoDir) throw new Error('照片子目录创建失败');
  return photoDir;
}

/** 给新照片分配这本书里的下一个编号（扫现有文件名取最大 + 1，不存计数器，永不失配） */
function allocFile(entry: AlbumEntry, type: string): string {
  const file = `${PHOTO_DIR_NAME}/${String(entry.nextNumber).padStart(4, '0')}${extFor(type)}`;
  entry.nextNumber += 1;
  return file;
}

function recordOf(id: string, file: string, blob: Blob, record?: StoredImageRecord): AlbumImageRecord {
  return {
    id,
    file,
    type: blob.type || 'image/jpeg',
    width: record?.width ?? 0,
    height: record?.height ?? 0,
    size: blob.size,
    createdAt: record?.createdAt ?? Date.now(),
  };
}

/** 按清单条目建内存条目：编号取"清单里的最大编号"和"照片目录里实际文件的最大编号"的较大者 */
async function buildEntry(folder: string, images: AlbumImageRecord[]): Promise<AlbumEntry> {
  let max = 0;
  for (const rec of images) max = Math.max(max, fileNumber(rec.file));
  try {
    const root = await getRootDir();
    const dir = await getSubDir(root, folder);
    const photoDir = dir ? await getSubDir(dir, PHOTO_DIR_NAME) : undefined;
    if (photoDir) {
      for (const e of await listEntries(photoDir)) max = Math.max(max, fileNumber(e.name));
    }
  } catch {
    // 读不到就按清单算；编号宁大勿小
  }
  return { folder, images: new Map(images.map((r) => [r.id, r])), nextNumber: max + 1 };
}

// ==================== 清单读写 ====================

async function writeAlbumFile(project: Project, entry: AlbumEntry): Promise<void> {
  entry.project = project;
  const dir = await albumDir(entry);
  const payload: AlbumFile = {
    app: 'photo-book',
    formatVersion: ALBUM_FORMAT,
    updatedAt: Date.now(),
    project,
    images: [...entry.images.values()],
  };
  await writeJsonFile(dir, ALBUM_DATA_FILE, payload);
}

async function createAlbumEntry(project: Project, usedNames?: Set<string>): Promise<AlbumEntry> {
  const root = await getRootDir();
  const used =
    usedNames ??
    new Set((await listEntries(root)).filter((e) => e.handle.kind === 'directory').map((e) => e.name));
  const folder = safeFolderName(project.name, used);
  const dir = await getSubDir(root, folder, { create: true });
  if (!dir) throw new Error('相册文件夹创建失败');
  await getSubDir(dir, PHOTO_DIR_NAME, { create: true });
  const entry: AlbumEntry = { folder, images: new Map(), nextNumber: 1, project };
  albumEntries.set(project.id, entry);
  // 立刻落一份清单：中途关页面也不会留下"没有清单"的文件夹
  // （那种文件夹下次连接会被当成不认识的内容跳过 —— 全新相册必须一步到位）
  await writeAlbumFile(project, entry);
  return entry;
}

/**
 * 确保这本相册在文件夹里有自己的目录（创建相册时调用）。
 * 未连接时返回 undefined（调用方走浏览器兜底）。
 */
export async function ensureAlbumFolder(project: Project): Promise<string | undefined> {
  if (!isConnected()) return undefined;
  const entry = albumEntries.get(project.id) ?? (await createAlbumEntry(project));
  return entry.folder;
}

// ==================== 照片物化（浏览器大图 → 磁盘文件） ====================

/**
 * 把相册用到的照片逐张落进它的 `照片\`：
 * - 清单里已有位置、文件在且大小一致 → 跳过（可中断、可重跑、幂等）
 * - 文件不在/对不上、本地还有大图 → 补写（写后核对大小）
 * - 本地大图已清、别的相册文件夹里有同一张 → 拷一份过来（保住自包含）
 * 校验过的 id 收进 verified，全部写盘完成后才允许清浏览器大图。
 */
async function materialize(
  project: Project,
  entry: AlbumEntry,
  options: { verifyExisting: boolean; verified?: Set<string>; tick?: () => void }
): Promise<void> {
  const needed = collectAssetIds(project.pages);
  for (const id of needed) {
    try {
      const mapped = entry.images.get(id);
      // 已登记且不需要核对（日常保存路径）：不再读盘，省掉每 3 秒一次的整本 IO
      if (mapped && !options.verifyExisting) continue;

      const record = await getImageRecord(id);
      const blob = record?.blob;

      if (mapped) {
        let file: File | undefined;
        try {
          file = await readFileAt(await albumDir(entry), mapped.file);
        } catch {
          // 文件不在（还没写过/被手删）：往下走补写分支
        }
        if (file) {
          if (!blob || file.size === blob.size || file.size === record?.size) {
            options.verified?.add(id);
          } else if (blob) {
            await writeBlobFile(await ensurePhotoDir(entry), baseName(mapped.file), blob);
            options.verified?.add(id);
          }
          // 对不上又没有大图可补：保留现场（文件夹为准），渲染时按实际文件画
          continue;
        }
        if (blob) {
          await writeBlobFile(await ensurePhotoDir(entry), baseName(mapped.file), blob);
          options.verified?.add(id);
          continue;
        }
        // 没文件也没大图：别的相册文件夹里可能有同一张（共用照片），拷一份
        await copyFromOtherAlbum(id, entry, mapped.file);
        continue;
      }

      if (blob) {
        const file = allocFile(entry, blob.type);
        await writeBlobFile(await ensurePhotoDir(entry), baseName(file), blob);
        entry.images.set(id, recordOf(id, file, blob, record));
        addLocation(id, { folder: entry.folder, file });
        options.verified?.add(id);
        continue;
      }
      // 没有大图也没有清单位置：可能是贴纸（本来就没有图片资源），
      // 也可能是别的相册已经拷过同 id 的照片 —— 试后者，都不行就交给渲染占位
      const copied = await copyFromOtherAlbum(id, entry, undefined);
      if (copied) options.verified?.add(id);
    } finally {
      options.tick?.();
    }
  }
}

/** 从别的相册文件夹拷同一张照片过来；拷成功返回 true */
async function copyFromOtherAlbum(id: string, entry: AlbumEntry, targetFile?: string): Promise<boolean> {
  const other = (imageLocations.get(id) ?? []).find((l) => l.folder !== entry.folder);
  if (!other) return false;
  try {
    const source = await readImageFile(other);
    const file = targetFile ?? allocFile(entry, source.type || 'image/jpeg');
    await writeBlobFile(await ensurePhotoDir(entry), baseName(file), source);
    if (!targetFile) {
      entry.images.set(id, recordOf(id, file, source));
      addLocation(id, { folder: entry.folder, file });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 日常保存：把当前项目写进它自己的 `相册数据.json`（写后重新读出校验）。
 * 没连上时只记「待补写」；写失败转 needs-reconnect（改动已先落浏览器）。
 */
export async function saveProjectToFolder(project: Project): Promise<boolean> {
  if (!isConnected()) {
    // 只在「启用过文件夹、暂时没连上」时记待补写；
    // off / unsupported 模式下压根没有文件夹可写，不该让界面以为有改动待同步
    const st = getFolderStatus().state;
    if (st === 'needs-reconnect' || st === 'folder-missing') {
      albumWritePending = true;
      updatePendingFlag();
    }
    return false;
  }
  try {
    const entry = albumEntries.get(project.id) ?? (await createAlbumEntry(project));
    entry.project = project;
    // 兜底自愈：万一有带大图的新照片没在保存时登记过（比如断连时上传后重连补写），
    // 这里只处理"没登记过的"，已登记的不做核对，保持保存动作轻快
    const verified = new Set<string>();
    await materialize(project, entry, { verifyExisting: false, verified });
    await writeAlbumFile(project, entry);
    registerLocations(entry);
    for (const id of verified) {
      try {
        await stripImageBlob(id);
      } catch {
        // 清不掉不影响磁盘
      }
    }
    albumWritePending = false;
    updatePendingFlag();
    return true;
  } catch {
    albumWritePending = true;
    updatePendingFlag();
    setFolderState('needs-reconnect');
    setAttention(true);
    return false;
  }
}

/** 浏览器里一份 + 文件夹里一份（编辑器等保存路径统一走它） */
export async function persistProject(project: Project): Promise<void> {
  await saveProject(project);
  await saveProjectToFolder(project);
}

/**
 * 上传/替换照片时把一张新照片写进该相册的 `照片\`，更新清单与位置索引，
 * 元数据 + 缩略图进 IndexedDB（大图不留浏览器）。
 * 校验通过才算数；失败抛错，由 assetStore 走浏览器兜底（带 blob 暂存 + 待补写）。
 */
export async function saveImageToAlbum(projectId: string, asset: ImageAsset): Promise<void> {
  const entry = albumEntries.get(projectId);
  if (!entry) throw new Error('这本相册还没有对应的文件夹');
  if (!entry.project) throw new Error('相册文件夹还没有初始化完成');

  const photoDir = await ensurePhotoDir(entry);
  const file = allocFile(entry, asset.blob.type);
  await writeBlobFile(photoDir, baseName(file), asset.blob);
  entry.images.set(asset.id, {
    id: asset.id,
    file,
    type: asset.blob.type || 'image/jpeg',
    width: asset.width,
    height: asset.height,
    size: asset.size,
    createdAt: asset.createdAt,
  });
  // 清单写成功之后才把浏览器侧的记录改成"只有元数据"的版本：
  // 清单校验不过就抛错，assetStore 兜底会保留完整大图
  await writeAlbumFile(entry.project, entry);
  registerLocations(entry);
  await saveImageRecord({
    id: asset.id,
    thumbnail: asset.thumbnail,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    createdAt: asset.createdAt,
  });
}

// ==================== 连接 / 合并 ====================

interface FolderAlbum {
  folder: string;
  data: AlbumFile;
}

async function scanFolderAlbums(
  root: FileSystemDirectoryHandle,
  options?: { silent?: boolean }
): Promise<{ albums: FolderAlbum[]; usedNames: Set<string> }> {
  const albums: FolderAlbum[] = [];
  const usedNames = new Set<string>();
  for (const entry of await listEntries(root)) {
    if (entry.handle.kind !== 'directory') continue;
    usedNames.add(entry.name);
    const dir = entry.handle as FileSystemDirectoryHandle;
    const read = await readJsonFile<AlbumFile>(dir, ALBUM_DATA_FILE);
    if (!read.ok) {
      // 缺清单：不是相册文件夹（或已手删），不打扰用户；
      // 读坏了：只跳过这一本、保留现场，提示一声
      if (read.reason === 'corrupt' && !options?.silent) {
        pushNotice(`「${entry.name}」的相册数据读取失败，已跳过（文件保留原样）`);
      }
      continue;
    }
    const data = read.value;
    if (data?.app !== 'photo-book' || !data.project?.id || !Array.isArray(data.project.pages)) continue;
    albums.push({ folder: entry.name, data });
  }
  return { albums, usedNames };
}

export interface ConnectPreview {
  folderName: string;
  /** 文件夹里有没有 photo-book 结构（之前的连接留下的） */
  hasPhotoBook: boolean;
  /** 是不是记录里那个文件夹（判断该不该走"手动删掉→同步移除"规则） */
  sameFolder: boolean;
  folderAlbumCount: number;
  localAlbumCount: number;
  localPhotoCount: number;
}

export type PrepareResult = { ok: true; preview: ConnectPreview } | { ok: false; reason: 'denied' | 'error' };

/**
 * 连接第一步（只读）：申请权限、看一眼两边各有多少内容，供界面决定弹不弹确认框。
 * 必须从用户点击里发起（requestPermission 只认手势）。
 */
export async function prepareConnect(handle: FileSystemDirectoryHandle): Promise<PrepareResult> {
  try {
    const perm = await queryFolderPermission(handle);
    if (perm !== 'granted') {
      const requested = await requestFolderPermission(handle);
      if (requested !== 'granted') return { ok: false, reason: 'denied' };
    }

    let hasPhotoBook = true;
    let folderAlbumCount = 0;
    try {
      const root = await getRootDirFrom(handle);
      const { albums } = await scanFolderAlbums(root, { silent: true });
      folderAlbumCount = albums.length;
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
      hasPhotoBook = false; // 还没有 photo-book，视为全新
    }

    const localProjects = await getAllProjects();
    let localPhotoCount = 0;
    for (const p of localProjects) localPhotoCount += collectAssetIds(p.pages).size;

    return {
      ok: true,
      preview: {
        folderName: handle.name,
        hasPhotoBook,
        sameFolder: await storedFolderMatches(handle),
        folderAlbumCount,
        localAlbumCount: localProjects.length,
        localPhotoCount,
      },
    };
  } catch (err) {
    console.error('检查文件夹失败', err);
    return { ok: false, reason: 'error' };
  }
}

export interface SyncProgress {
  done: number;
  total: number;
}

export interface SyncResult {
  /** 从文件夹载入到书架的相册数 */
  loaded: number;
  /** 本机补写进文件夹的相册数 */
  pushed: number;
  /** 文件夹被手动删掉、从书架同步移除的相册数 */
  removed: number;
}

/**
 * 连接第二步：正式合并（§6.5）。
 * 首次启用、迁移、换电脑、重新指认 —— 全都走这一条路，
 * 规则统一为"逐本比对、缺什么补什么"，可中断可重跑。
 */
export async function runSync(
  handle: FileSystemDirectoryHandle,
  options?: { createRoot?: boolean; onProgress?: (p: SyncProgress) => void }
): Promise<SyncResult> {
  const root = await getRootDirFrom(handle, { create: options?.createRoot !== false });
  setRootDirCache(root);
  albumEntries.clear();
  imageLocations.clear();
  templateFileBlocked = false;

  const sameFolder = await storedFolderMatches(handle);
  const migrated = sameFolder && (await getMigratedFlag());
  const hasReadme = await fileExists(root, README_FILE);
  // 「搬过家」且结构完整，才允许把文件夹里没有的相册判成"被手动删掉"；
  // 否则一律走安全方向：补写进文件夹（宁可多写，不丢）
  const canRemoveMissing = migrated && hasReadme;

  const { albums: folderAlbums, usedNames } = await scanFolderAlbums(root);
  const localProjects = await getAllProjects();
  const folderById = new Map(folderAlbums.map((a) => [a.data.project.id, a]));

  type Job =
    | { kind: 'load'; album: FolderAlbum }
    | { kind: 'in-sync'; album: FolderAlbum }
    | { kind: 'push'; project: Project; source?: FolderAlbum }
    | { kind: 'remove'; project: Project };

  const jobs: Job[] = [];
  for (const album of folderAlbums) {
    const local = localProjects.find((p) => p.id === album.data.project.id);
    if (!local || album.data.project.updatedAt > local.updatedAt) jobs.push({ kind: 'load', album });
    else if (local.updatedAt > album.data.project.updatedAt)
      jobs.push({ kind: 'push', project: local, source: album });
    else jobs.push({ kind: 'in-sync', album });
  }
  for (const project of localProjects) {
    if (folderById.has(project.id)) continue;
    jobs.push(canRemoveMissing ? { kind: 'remove', project } : { kind: 'push', project });
  }

  const projectOf = (job: Job): Project =>
    job.kind === 'load' || job.kind === 'in-sync' ? job.album.data.project : job.project;
  const total = jobs.reduce(
    (n, job) => (job.kind === 'remove' ? n + 1 : n + 1 + collectAssetIds(projectOf(job).pages).size),
    0
  );

  const result: SyncResult = { loaded: 0, pushed: 0, removed: 0 };
  const verifiedIds = new Set<string>();
  const backfillQueue: string[] = [];
  let done = 0;
  const report = () => options?.onProgress?.({ done, total });
  const tick = (n = 1) => {
    done += n;
  };

  try {
    for (const job of jobs) {
      if (job.kind === 'remove') {
        // 唯一会"删书架记录"的地方，且只在"确定搬过家 + 结构完整"时走到
        await deleteProject(job.project.id);
        pushNotice(`「${job.project.name}」的文件夹不在文件夹里了，已从书架移除`);
        result.removed += 1;
        tick();
        report();
        continue;
      }

      if (job.kind === 'load' || job.kind === 'in-sync') {
        const { folder, data } = job.album;
        if (job.kind === 'load') await saveProject(data.project);
        const entry = await buildEntry(folder, data.images ?? []);
        entry.project = data.project;
        albumEntries.set(data.project.id, entry);
        registerLocations(entry);
        await ensureImageRecords(entry, data.images ?? [], backfillQueue, verifiedIds);
        result.loaded += job.kind === 'load' ? 1 : 0;
        tick(1 + collectAssetIds(data.project.pages).size);
        report();
        continue;
      }

      // push：本地有、文件夹缺（或本地更新）的一本
      const project = job.project;
      const entry = job.source
        ? await buildEntry(job.source.folder, job.source.data.images ?? [])
        : await createAlbumEntry(project, usedNames);
      entry.project = project;
      albumEntries.set(project.id, entry);
      await materialize(project, entry, {
        verifyExisting: true,
        verified: verifiedIds,
        tick: () => {
          tick();
          report();
        },
      });
      await writeAlbumFile(project, entry);
      registerLocations(entry);
      result.pushed += 1;
      tick();
      report();
    }

    // 结构文件：说明 + 模板（模板合并顺带把本地独有的补写上去）
    await writeTextFile(root, README_FILE, README_BOM + README_TEXT);
    await mergeTemplates(root);

    // 所有写盘校验通过之后，才清理浏览器里的大图（§8 红线第 2 条）
    for (const id of verifiedIds) {
      try {
        await stripImageBlob(id);
      } catch {
        // 清不掉不影响磁盘上的照片
      }
    }
    void backfillThumbnails(backfillQueue);

    await storeFolderHandle(handle);
    await setMigratedFlag(true);
    albumWritePending = false;
    templateWritePending = await getTemplatesDirty();
    updatePendingFlag();
    setFolderState('connected', handle.name);
    setAttention(false);
    bumpDataVersion();
    return result;
  } catch (err) {
    // 磁盘上已写的原样保留、浏览器里的一个没删；下次接着来
    albumWritePending = true;
    updatePendingFlag();
    throw err;
  }
}

/** 连接时把清单里的照片元数据补进 IndexedDB；缺缩略图的排进回填队列 */
async function ensureImageRecords(
  entry: AlbumEntry,
  images: AlbumImageRecord[],
  backfillQueue: string[],
  verifiedIds: Set<string>
): Promise<void> {
  for (const rec of images) {
    const existing = await getImageRecord(rec.id);
    if (!existing) {
      await saveImageRecord({
        id: rec.id,
        thumbnail: '',
        width: rec.width,
        height: rec.height,
        size: rec.size,
        createdAt: rec.createdAt,
      });
      backfillQueue.push(rec.id);
      continue;
    }
    if (!existing.thumbnail) backfillQueue.push(rec.id);
    // 本地还留着大图的（还没搬过家）：文件夹里文件在、大小一致，就可以清掉大图省空间；
    // 文件夹里没有这张的话把大图留着 —— 它可能是唯一一份，渲染还得靠它
    if (existing.blob) {
      try {
        const file = await readFileAt(await albumDir(entry), rec.file);
        if (file.size === existing.blob.size) verifiedIds.add(rec.id);
      } catch {
        // 保持现状
      }
    }
  }
}

/** 缩略图回填：后台从磁盘照片逐张重生成（先占位后替换，不阻塞界面） */
async function backfillThumbnails(ids: string[]): Promise<void> {
  for (const id of new Set(ids)) {
    try {
      const loc = getImageLocations(id)[0];
      if (!loc) continue;
      const file = await readImageFile(loc);
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImage(url);
        const thumbnail = await createThumbnail(img, 200);
        const record = await getImageRecord(id);
        if (record) {
          if (record.thumbnail !== thumbnail) await saveImageRecord({ ...record, thumbnail });
        } else {
          await saveImageRecord({
            id,
            thumbnail,
            width: img.naturalWidth,
            height: img.naturalHeight,
            size: file.size,
            createdAt: Date.now(),
          });
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      // 补不上就算了，下次连接还会再试
    }
  }
}

// ==================== 我的模板.json 镜像 ====================

const TEMPLATES_DIRTY_KEY = 'folderTemplatesDirty';

async function getTemplatesDirty(): Promise<boolean> {
  return (await getSetting<boolean>(TEMPLATES_DIRTY_KEY)) === true;
}

async function setTemplatesDirty(value: boolean): Promise<void> {
  await setSetting(TEMPLATES_DIRTY_KEY, value);
}

/** 模板文件读坏过（还会写就毁了现场）：本次会话不再写它，重连/重启后再试 */
let templateFileBlocked = false;

interface TemplateFile {
  formatVersion: number;
  updatedAt: number;
  templates: unknown[];
}

async function writeTemplateFile(root: FileSystemDirectoryHandle): Promise<void> {
  const templates = await getAllCustomTemplates();
  const payload: TemplateFile = { formatVersion: ALBUM_FORMAT, updatedAt: Date.now(), templates };
  await writeJsonFile(root, TEMPLATE_FILE, payload);
}

/**
 * 连接时的模板合并（§6.8）：
 * - 平常：同 id 以文件夹为准；仅文件夹有 → 载入；仅名字撞 → 后并入的改名
 * - 本地有"断连期间的改动"（脏标记）：同 id 以本地为准（先向上补写再合并）
 * - 最终把并集整体写回 `我的模板.json`（本地独有的顺带补写上去）
 */
async function mergeTemplates(root: FileSystemDirectoryHandle): Promise<void> {
  const read = await readJsonFile<TemplateFile>(root, TEMPLATE_FILE);
  let folderTemplates: CustomTemplateRecord[] = [];
  if (read.ok) {
    const list = Array.isArray(read.value?.templates) ? read.value.templates : [];
    folderTemplates = list.filter(isUsableTemplate);
    templateFileBlocked = false;
  } else if (read.reason === 'corrupt') {
    templateFileBlocked = true;
    pushNotice('文件夹里的「我的模板.json」读取失败，本次跳过模板同步（原文件已保留）');
  } else {
    templateFileBlocked = false; // 还没有这个文件 = 全新文件夹
  }

  const dirty = await getTemplatesDirty();
  if (dirty) {
    const local = await getAllCustomTemplates();
    const localIds = new Set(local.map((t) => t.id));
    // 同 id 本地为准：只并入文件夹独有的，然后整体写回
    await importTemplates(folderTemplates.filter((t) => !localIds.has(t.id)));
  } else {
    await importTemplates(folderTemplates);
  }

  // 并入内存模板库（换浏览器连接后自定义模板立刻显示，不用刷新）
  const merged = await getAllCustomTemplates();
  for (const t of merged) applyCustomTemplate(t);

  if (!templateFileBlocked) {
    await writeTemplateFile(root);
    await setTemplatesDirty(false);
    templateWritePending = false;
    updatePendingFlag();
  } else {
    // 读坏的原文件保留，等用户处理；本地改动先记着
    await setTemplatesDirty(true);
  }
}

let templateWriteTimer: ReturnType<typeof setTimeout> | undefined;

/** 模板库改完招呼一声（由 templateLibrary 的钩子调用） */
function scheduleTemplateWrite(): void {
  const st = getFolderStatus().state;
  // off / unsupported：没启用文件夹模式，模板落盘只走 IndexedDB（现状）
  if (st === 'off' || st === 'unsupported') return;
  if (st === 'connected') {
    // 正常连着：短防抖后写 我的模板.json，不必打扰状态条
    if (templateWriteTimer) clearTimeout(templateWriteTimer);
    templateWriteTimer = setTimeout(() => {
      templateWriteTimer = undefined;
      void flushTemplateWrite();
    }, 1000);
    return;
  }
  // 断连（needs-reconnect / folder-missing）：改动记待补写；
  // 脏标记让重连合并时「本地较新的模板优先」（§6.8）
  templateWritePending = true;
  updatePendingFlag();
  void setTemplatesDirty(true);
}

async function flushTemplateWrite(): Promise<void> {
  if (!isConnected() || templateFileBlocked) return;
  try {
    await writeTemplateFile(await getRootDir());
    templateWritePending = false;
    updatePendingFlag();
    await setTemplatesDirty(false);
  } catch {
    // 写盘失败（句柄失效等）：改动已在浏览器里，转待重连
    setFolderState('needs-reconnect');
    setAttention(true);
  }
}

/** 页面隐藏时补一次模板落盘（防抖可能还没到点） */
export async function flushFolderWrites(): Promise<void> {
  if (templateWriteTimer) {
    clearTimeout(templateWriteTimer);
    templateWriteTimer = undefined;
    await flushTemplateWrite();
  }
}

// 注册给模板库：模板增删改落盘后，把 我的模板.json 跟上
setTemplateChangeHook(scheduleTemplateWrite);

// ==================== 启动 / 重连 ====================

/**
 * 启动时自动连接（main.tsx 里、React 渲染前 await）。
 * 全程不弹框、绝不阻塞启动；任何失败只影响状态与横幅。
 */
export async function initFolderMode(): Promise<void> {
  try {
    if (!isFolderModeSupported()) {
      setFolderState('unsupported');
      return;
    }
    const handle = await getStoredFolderHandle();
    if (!handle) {
      setFolderState('off');
      return;
    }
    const perm = await queryFolderPermission(handle);
    if (perm !== 'granted') {
      setFolderState('needs-reconnect', handle.name);
      return;
    }
    try {
      // createRoot: false —— 启动时不静默重建被删掉的结构（§10），
      // 那属于"重新指认"的用户动作
      await runSync(handle, { createRoot: false });
    } catch (err) {
      if (isNotFoundError(err)) {
        setFolderState('folder-missing', handle.name);
        return;
      }
      console.error('连接文件夹失败', err);
      setFolderState('needs-reconnect', handle.name);
      setAttention(true);
    }
  } catch (err) {
    console.error('文件夹模式初始化失败', err);
    setFolderState('off');
  }
}

export type ReconnectResult =
  | { ok: true; result: SyncResult }
  | { ok: false; reason: 'denied' | 'folder-missing' | 'error' };

/** 「重新连接」按钮：在点击手势里重新申请权限，通过后立刻走合并 */
export async function reconnectFolder(): Promise<ReconnectResult> {
  const handle = await getStoredFolderHandle();
  if (!handle) return { ok: false, reason: 'error' };
  const perm = await requestFolderPermission(handle);
  if (perm !== 'granted') {
    setAttention(true);
    return { ok: false, reason: 'denied' };
  }
  try {
    const result = await runSync(handle, { createRoot: true });
    return { ok: true, result };
  } catch (err) {
    if (isNotFoundError(err)) {
      setFolderState('folder-missing', handle.name);
      return { ok: false, reason: 'folder-missing' };
    }
    console.error('重新连接失败', err);
    setFolderState('needs-reconnect', handle.name);
    setAttention(true);
    return { ok: false, reason: 'error' };
  }
}

// ==================== 删除相册（连同磁盘文件夹） ====================

export interface DeleteAlbumResult {
  /** 对应文件夹名（空字符串 = 磁盘上本来就没有） */
  folderName: string;
  /** 没删干净的文件（被占用等），交给用户手动清 */
  failed: string[];
}

/**
 * 删除相册：书架记录 + 磁盘文件夹一起删（网站里唯一删磁盘文件的地方，§6.10）。
 * 删之前重读该文件夹的 `相册数据.json` 核对相册 id，一致才动手；
 * 核对不通过就抛错、文件夹不动。
 */
export async function deleteAlbum(projectId: string): Promise<DeleteAlbumResult> {
  let folderName = albumEntries.get(projectId)?.folder;
  if (!folderName) folderName = await findAlbumFolderById(projectId);

  if (folderName) {
    const root = await getRootDir();
    let dir: FileSystemDirectoryHandle | undefined;
    try {
      dir = await root.getDirectoryHandle(folderName);
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
    }
    if (dir) {
      const read = await readJsonFile<AlbumFile>(dir, ALBUM_DATA_FILE);
      if (!read.ok || read.value?.project?.id !== projectId) {
        throw new Error('相册数据核对不通过，文件夹没有动（可以重新连接后再试试）');
      }
      const report = await deleteAlbumFolder(folderName);
      await deleteProject(projectId);
      albumEntries.delete(projectId);
      dropLocations(folderName);
      bumpDataVersion();
      return { folderName, failed: report.failed };
    }
  }

  // 磁盘上已经没有这本的文件夹（自己被手删过）：只删书架记录
  await deleteProject(projectId);
  albumEntries.delete(projectId);
  bumpDataVersion();
  return { folderName: folderName ?? '', failed: [] };
}

/** 缓存里没有时（理论少见）去文件夹里找含这个相册 id 的目录 */
async function findAlbumFolderById(projectId: string): Promise<string | undefined> {
  const root = await getRootDir();
  for (const entry of await listEntries(root)) {
    if (entry.handle.kind !== 'directory') continue;
    const read = await readJsonFile<AlbumFile>(entry.handle as FileSystemDirectoryHandle, ALBUM_DATA_FILE);
    if (read.ok && read.value?.project?.id === projectId) return entry.name;
  }
  return undefined;
}

// ==================== 说明文件 ====================

const README_BOM = '\uFEFF';

// 注意：正文里的反斜杠要写成 \\（字符串转义），落盘后才是单个 \
const README_TEXT = `你好，这是「电子相册」网站为你创建的照片文件夹。

■ 这里面是什么
  photo-book 里，每本相册有一个自己的文件夹（名字就是相册名），里面是：

    · 照片\\        —— 这本相册的照片原文件，双击就能看
    · 相册数据.json —— 这本相册的排版数据

  不用这个网站，你的照片也在，就是一张张普通的图片文件。

■ 哪些能改，哪些别动
  · 整个 photo-book 文件夹：可以改名、可以搬到别的盘
    （网站会引导你重新指认一下，数据不丢）
  · 相册文件夹的名字：可以随便改（网站按里面的数据认相册）
  · 照片\\ 里的图片文件：请不要单独改名或删除，网站按文件名找照片

■ 删相册
  想删掉哪本相册，直接删掉它那个文件夹就可以，网站下次打开会自动同步。
  在网站上删除相册时，文件夹里的数据也会一并删除（会先问你确认）。
  删除不进电脑回收站，删之前想留的话，先把文件夹复制一份。

■ 换电脑 / 换浏览器
  打开电子相册网站，选择「连接已有的相册文件夹」，选中这个文件夹，
  照片、相册和你自己做的模板就都回来了。
  浏览器如果弹出授权框，选「每次访问时允许」，以后打开网站就不用再点。

■ 备份
  把整个 photo-book 文件夹复制到网盘或 U 盘，就是最完整的备份；
  每本相册的文件夹也能单独拷走、单独打开。
  网站里的「导出备份」按钮也可以打包成 zip 文件。
`;
