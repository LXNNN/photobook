import { openDB, IDBPDatabase } from 'idb';
import type { Project, ImageAsset, StoredImageRecord } from '@/types';
import type { TemplateDefinition } from '@/templates';

const DB_NAME = 'photo-book-db';
/**
 * 升级历史（只加不改，现有 store 的数据一个字节都不动）：
 * v4：新增 settings store —— 存文件夹模式的授权句柄与迁移标志
 */
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('customTemplates')) {
          db.createObjectStore('customTemplates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('deletedTemplates')) {
          db.createObjectStore('deletedTemplates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

// ==================== 项目存储 ====================

export async function saveProject(project: Project): Promise<void> {
  const db = await getDB();
  await db.put('projects', project);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDB();
  return db.get('projects', id);
}

export async function getAllProjects(): Promise<Project[]> {
  const db = await getDB();
  const projects = await db.getAll('projects');
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('projects', id);
}

// ==================== 图片资源存储 ====================

export async function saveImageAsset(asset: ImageAsset): Promise<void> {
  const db = await getDB();
  await db.put('images', asset);
}

export async function getImageAsset(id: string): Promise<ImageAsset | undefined> {
  const db = await getDB();
  return db.get('images', id);
}

/**
 * 读原始存储记录（大图可能已被文件夹模式清掉，`blob` 允许没有）。
 * 新版代码想区分「渲染资产」和「存储记录」时用这个；
 * 老的 getImageAsset 保持不动。
 */
export async function getImageRecord(id: string): Promise<StoredImageRecord | undefined> {
  const db = await getDB();
  return db.get('images', id);
}

/** 写回原始存储记录（可以不带 blob —— 大图已经在磁盘文件夹里了） */
export async function saveImageRecord(record: StoredImageRecord): Promise<void> {
  const db = await getDB();
  await db.put('images', record);
}

export async function deleteImageAsset(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('images', id);
}

export async function getAllImageAssets(): Promise<ImageAsset[]> {
  const db = await getDB();
  return db.getAll('images');
}

// ==================== 自定义模板存储 ====================

/** 自定义模板定义（用户保存的模板覆盖） */
export type CustomTemplateRecord = TemplateDefinition;

export async function saveCustomTemplate(template: CustomTemplateRecord): Promise<void> {
  const db = await getDB();
  await db.put('customTemplates', template);
}

export async function getAllCustomTemplates(): Promise<CustomTemplateRecord[]> {
  const db = await getDB();
  return db.getAll('customTemplates');
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('customTemplates', id);
}

// ==================== 已删除模板记录（墓碑） ====================
// 内置模板每次启动都会重新载入，光从内存里删掉的话刷新就复活了。
// 所以删内置模板时要在这里留一条记录，启动时按它把模板过滤掉。

interface DeletedTemplateRecord {
  id: string;
}

/** 记录一个被删除的内置模板 */
export async function saveDeletedTemplate(id: string): Promise<void> {
  const db = await getDB();
  await db.put('deletedTemplates', { id } as DeletedTemplateRecord);
}

/** 读取所有被删除的内置模板 id */
export async function getAllDeletedTemplates(): Promise<string[]> {
  const db = await getDB();
  const records: DeletedTemplateRecord[] = await db.getAll('deletedTemplates');
  return records.map((r) => r.id);
}

/** 清除删除记录（"恢复默认"把内置模板找回来时用） */
export async function clearDeletedTemplate(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('deletedTemplates', id);
}

// ==================== 设置（文件夹模式的句柄与标志） ====================
// 文件句柄是可结构化克隆对象，能直接存进 IndexedDB；浏览器重启后重新要权限即可。

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const db = await getDB();
  const record = (await db.get('settings', key)) as { key: string; value: T } | undefined;
  return record?.value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('settings', { key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDB();
  await db.delete('settings', key);
}

/**
 * 把一条图片记录里的大图清掉（原图已经写进磁盘文件夹并校验过了）。
 * 缩略图与元数据保留 —— 文件夹没接上时还能拿它们画出排版。
 * 只在文件夹模式的迁移/补写流程里调用，调用点必须晚于写盘校验（红线 §8）。
 */
export async function stripImageBlob(id: string): Promise<void> {
  const db = await getDB();
  const record = (await db.get('images', id)) as { blob?: unknown } | undefined;
  if (!record || record.blob === undefined) return;
  delete record.blob;
  await db.put('images', record);
}
