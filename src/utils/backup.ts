import { Zip, ZipPassThrough, strToU8, strFromU8, unzipSync } from 'fflate';
import type { Project } from '@/types';
import { collectAssetIds } from '@/engine/drawPageContent';
import {
  getAllProjects,
  getAllCustomTemplates,
  type CustomTemplateRecord,
} from './storage';
import { getImageAsset, saveImageAsset } from './assetStore';
import {
  ensureAlbumFolder,
  getAlbumFolderName,
  getImageLocations,
  isFolderConnected,
  persistProject,
} from './folderLibrary';
import { generateId } from './units';
import { safeFolderName, extFor } from './fileNames';

// 模板合并规则与文件夹模式共用（提取到 templateImport.ts，避免循环引用）；
// 这里转出去，现有 import 方不用改
import { isUsableTemplate } from './templateImport';
export { importTemplates } from './templateImport';
export type { TemplateImportResult } from './templateImport';

/**
 * 备份包：把整个书架打包成一个 zip，或者从 zip 里恢复回来。
 *
 * 为什么是 zip 而不是自定义格式：照片存的是印刷分辨率（长边最多 4096），一本相册
 * 几十上百 MB，本来就该打包成一个文件才好拷。而 zip **解开就是普通文件夹** ——
 * 照片是一张张能用任何看图软件打开的图片，网站哪天不在了照片还在。
 * 自己发明一个格式只有这个网站读得懂，那等于把用户的照片锁进这个网站里。
 *
 * zip 里长这样：
 *   相册备份-全部-2026-09-19.zip
 *     蜜月旅行/
 *       相册数据.json      ← 页面怎么排的、照片对应关系
 *       照片/0001.jpg …     ← 照片本身，文件名是给人看的编号
 *     宝宝周岁/…
 *
 * 注意：照片已经是压缩格式（JPEG），再压一遍基本没收益、还费 CPU，
 * 所以一律用 ZipPassThrough（只封装不压缩）。
 */

/** 备份格式版本。将来格式变了靠它判断读不读得动 */
const BACKUP_FORMAT = 1;

/** zip 里那份相册数据的文件名。导入时靠它认出「这是一个相册」 */
const PROJECT_FILE = '相册数据.json';

/** 一个相册的照片统一放这个子目录 */
const PHOTO_DIR = '照片';

/**
 * zip 根目录那份自定义模板的文件名。
 * 模板是全局的、不属于任何相册，所以不塞进相册文件夹，单独一个文件放根目录。
 */
const CUSTOM_TEMPLATE_FILE = '我的模板.json';

interface BackupImageMeta {
  imageId: string;
  /** 相对相册文件夹的路径，如 "照片/0001.jpg" */
  file: string;
  type: string;
  width: number;
  height: number;
  size: number;
  createdAt: number;
  /** 缩略图（base64），原样带走，免得导入后还要重新解一遍原图生成 */
  thumbnail: string;
}

interface BackupProjectFile {
  formatVersion: number;
  exportedAt: number;
  project: Project;
  images: BackupImageMeta[];
}

interface BackupTemplateFile {
  formatVersion: number;
  exportedAt: number;
  templates: CustomTemplateRecord[];
}

export interface BackupBundle {
  /** 在 zip 里的目录名，出错时提示用得上 */
  folder: string;
  project: Project;
  images: BackupImageMeta[];
}

export interface ParsedBackup {
  buf: ArrayBuffer;
  bundles: BackupBundle[];
  /** 备份包里的自定义模板。老备份包里没有这个文件，就是空数组 */
  templates: CustomTemplateRecord[];
}

export interface ImportPlan {
  bundle: BackupBundle;
  /** duplicate = 另起一个新 id 入库（「两份都留」），overwrite = 顶掉本地同名那本 */
  mode: 'overwrite' | 'duplicate';
  /**
   * overwrite 时，本地那本相册的 id。
   *
   * 必须传本地 id 而不是沿用备份里的 id：备份多半是**另一台电脑**导出的，
   * 里面那本的 id 和本地同名那本根本不是一回事。照备份的 id 写进去，结果是
   * 本地那本原封不动、旁边又多出一本同名的 —— 那不叫覆盖，那叫两份都留。
   * 用本地 id 写，才是「这本还是这本，内容换成备份里的」。
   */
  targetId?: string;
}

// ==================== 导出 ====================

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 把整个书架打包成一个 zip。
 *
 * 照片是**一张一张读、一张一张塞进 zip 的**，不是先把所有图读进内存再打包 ——
 * 相册多了总量能到几百 MB，那样峰值内存会翻倍。
 */
export async function exportAllProjects(
  onProgress?: (done: number, total: number) => void
): Promise<{ blob: Blob; filename: string; templateCount: number }> {
  const projects = await getAllProjects();
  const templates = await getAllCustomTemplates();
  if (projects.length === 0 && templates.length === 0) {
    throw new Error('书架上一本相册都没有，也没有自定义模板，没有可导出的内容');
  }

  // 先把清单算出来（要打包哪些文件），这样进度条才有分母
  const usedFolders = new Set<string>();
  const jobs = projects.map((project) => ({
    project,
    folder: safeFolderName(project.name, usedFolders),
    ids: [...collectAssetIds(project.pages)],
  }));
  const total =
    jobs.reduce((n, j) => n + j.ids.length, 0) + jobs.length + (templates.length > 0 ? 1 : 0);

  // 攒成一个个 Blob 而不是 Uint8Array 数组：Blob 由浏览器托管、可以直接落磁盘，
  // 不占 JS 堆。几百 MB 压在堆上很容易把标签页压崩。
  const parts: BlobPart[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError = err;
      return;
    }
    parts.push(new Blob([chunk]));
  });

  const addFile = (path: string, data: Uint8Array) => {
    if (zipError) return;
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    entry.push(data, true);
  };

  let done = 0;
  for (const job of jobs) {
    const images: BackupImageMeta[] = [];
    let n = 0;

    for (const imageId of job.ids) {
      const asset = await getImageAsset(imageId);
      // 图丢了就跳过这张，但相册本身照导 —— 不能因为少一张照片整本都导不出来
      if (asset) {
        n += 1;
        const file = `${PHOTO_DIR}/${String(n).padStart(4, '0')}${extFor(asset.blob.type)}`;
        addFile(`${job.folder}/${file}`, new Uint8Array(await asset.blob.arrayBuffer()));
        images.push({
          imageId,
          file,
          type: asset.blob.type || 'image/jpeg',
          width: asset.width,
          height: asset.height,
          size: asset.size,
          createdAt: asset.createdAt,
          thumbnail: asset.thumbnail,
        });
      }
      onProgress?.(++done, total);
    }

    const payload: BackupProjectFile = {
      formatVersion: BACKUP_FORMAT,
      exportedAt: Date.now(),
      project: job.project,
      images,
    };
    addFile(`${job.folder}/${PROJECT_FILE}`, strToU8(JSON.stringify(payload, null, 2)));
    onProgress?.(++done, total);
  }

  // 自定义模板是纯排版数据（坐标、字号、颜色），不含照片，几十 KB 而已，
  // 在 zip 根目录放一个文件就够了
  if (templates.length > 0) {
    const payload: BackupTemplateFile = {
      formatVersion: BACKUP_FORMAT,
      exportedAt: Date.now(),
      templates,
    };
    addFile(CUSTOM_TEMPLATE_FILE, strToU8(JSON.stringify(payload, null, 2)));
    onProgress?.(++done, total);
  }

  zip.end();
  if (zipError) throw zipError;

  return {
    blob: new Blob(parts, { type: 'application/zip' }),
    filename: `相册备份-全部-${dateStamp()}.zip`,
    templateCount: templates.length,
  };
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 别马上撤销：下载还没真正挂上去就撤销的话，Chrome 会存到一个空文件
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ==================== 导入 ====================

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/**
 * 先把 zip 读一遍，只看相册数据（「相册数据.json」），不碰照片。
 *
 * 分两遍是故意的：第一遍拿到「包里有哪些相册」，才能停下来问用户撞车了怎么办；
 * 等用户拿定主意了，第二遍才真的把照片解出来写库。
 */
export async function parseBackup(file: File): Promise<ParsedBackup> {
  const buf = await file.arrayBuffer();

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buf), {
      filter: (f) => {
        const name = basename(f.name);
        return name === PROJECT_FILE || name === CUSTOM_TEMPLATE_FILE;
      },
    });
  } catch {
    throw new Error('这个文件打不开，可能不是备份包，或者已经损坏了');
  }

  const bundles: BackupBundle[] = [];
  const templates: CustomTemplateRecord[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    try {
      if (basename(path) === CUSTOM_TEMPLATE_FILE) {
        const payload = JSON.parse(strFromU8(bytes)) as BackupTemplateFile;
        for (const t of payload?.templates ?? []) {
          if (isUsableTemplate(t)) templates.push(t);
        }
        continue;
      }
      const payload = JSON.parse(strFromU8(bytes)) as BackupProjectFile;
      if (!payload?.project?.id || !Array.isArray(payload.project.pages)) continue;
      bundles.push({
        folder: dirname(path),
        project: payload.project,
        images: payload.images ?? [],
      });
    } catch {
      // 单个相册（或那份模板文件）坏了，不影响包里别的内容，跳过它继续
    }
  }

  if (bundles.length === 0 && templates.length === 0) {
    throw new Error('这个备份包里没找到相册或模板');
  }
  return { buf, bundles, templates };
}

/** 把用户选中的相册真正写进库里 */
export async function importBackups(
  buf: ArrayBuffer,
  plans: ImportPlan[],
  onProgress?: (done: number, total: number) => void
): Promise<{ projects: number; images: number }> {
  const total = plans.reduce((n, p) => n + p.bundle.images.length, 0) + plans.length;
  let done = 0;
  let imageCount = 0;

  // 「两份都留」时要起新名字。名字从库里现取一次，同一个 Set 一路 add 下去，
  // 这样一次导入好几本之间也不会互相撞。
  const takenNames = new Set((await getAllProjects()).map((p) => p.name));
  /** 撞车的那本改名成「XX（导入）」。已经有同名的就叫「XX（导入2）」，再往后顺延 */
  const importedName = (base: string): string => {
    let name = `${base}（导入）`;
    for (let i = 2; takenNames.has(name); i++) name = `${base}（导入${i}）`;
    takenNames.add(name);
    return name;
  };

  for (const { bundle, mode, targetId } of plans) {
    // 只解这一个相册的目录，写完就扔掉，别把整个包的照片同时摊在内存里
    let entries: Record<string, Uint8Array> = {};
    try {
      entries = unzipSync(new Uint8Array(buf), {
        filter: (f) => bundle.folder === '' || f.name.startsWith(`${bundle.folder}/`),
      });
    } catch {
      throw new Error(`「${bundle.project.name}」的数据解不开，备份包可能损坏了`);
    }

    // 先把项目定下来（覆盖时用本地 id，理由见 ImportPlan.targetId 的注释），
    // 照片才知道该写进哪本相册
    const project: Project =
      mode === 'duplicate'
        ? { ...bundle.project, id: generateId(), name: importedName(bundle.project.name), updatedAt: Date.now() }
        : { ...bundle.project, id: targetId ?? bundle.project.id, updatedAt: Date.now() };

    // 已连接文件夹时，先建好这本相册的文件夹
    await ensureAlbumFolder(project);
    const connected = isFolderConnected();
    const albumFolder = connected ? getAlbumFolderName(project.id) : undefined;

    for (const meta of bundle.images) {
      const bytes = entries[`${bundle.folder}/${meta.file}`];
      if (bytes && bytes.length > 0) {
        // 同一个 id 的图内容必然相同（id 是上传时生成的），本地已经有了就别重写。
        // 文件夹模式按「本相册」判重：这张照片必须在这本相册自己的文件夹里有一份
        // （每本相册自包含，删掉别的相册不影响它），哪怕别的相册已经有同样的图
        const alreadyHere = connected
          ? getImageLocations(meta.imageId).some((l) => l.folder === albumFolder)
          : Boolean(await getImageAsset(meta.imageId));
        if (!alreadyHere) {
          await saveImageAsset(project.id, {
            id: meta.imageId,
            // unzipSync 出来的字节流必然是普通 ArrayBuffer（zip 就在内存里），
            // 但它的类型标成了宽泛的 ArrayBufferLike，含 SharedArrayBuffer，
            // 跟 BlobPart 对不上，这里断言一下即可，别为绕类型多做一次拷贝。
            blob: new Blob([bytes as unknown as BlobPart], { type: meta.type || 'image/jpeg' }),
            thumbnail: meta.thumbnail || '',
            width: meta.width,
            height: meta.height,
            size: meta.size,
            createdAt: meta.createdAt || Date.now(),
          });
          imageCount += 1;
        }
      }
      onProgress?.(++done, total);
    }

    // 存项目：IndexedDB + 这本的 相册数据.json（含照片清单）
    await persistProject(project);
    onProgress?.(++done, total);
  }

  return { projects: plans.length, images: imageCount };
}

// ==================== 自定义模板导入 ====================
// importTemplates 与模板合法性校验已提取到 templateImport.ts（文件夹模式共用），
// 在本文件顶部 re-export 出去了。
