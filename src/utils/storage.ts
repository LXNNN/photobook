import { openDB, IDBPDatabase } from 'idb';
import type { Project, ImageAsset } from '@/types';
import type { TemplateDefinition } from '@/templates';

const DB_NAME = 'photo-book-db';
const DB_VERSION = 3;

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
