import { Zip, ZipPassThrough } from 'fflate';
import type { BookFormat, Page, Project } from '@/types';
import { collectAssetIds, drawPageContent } from '@/engine/drawPageContent';
import { decodeAssets } from './assetStore';
import { mmToPx } from './units';
import { safeFolderName } from './fileNames';

/**
 * 把整本相册导出成一批高清图片（zip 打包下载）。
 *
 * 两种方式：
 * - 单面：一页一张
 * - 双面：按预览页翻开的跨页规则拼成一排 —— 封面单独、[2,3]、[4,5]…、末页落单
 *   时也单独一张（规则见 spreadGroups）。两页中间压一条灰线当书缝，一眼看出是摊开的两页。
 *
 * 渲染走 drawPageContent（和 PDF 导出、预览页同一份绘制实现）、300dpi + JPEG，
 * 和 PDF 里的每一页同规格 —— PDF 里是什么样，导出的图就是什么样。
 */

/** 导出分辨率：和 PDF 导出一致的印刷级 300 DPI */
const EXPORT_DPI = 300;
/** JPEG 质量：和 PDF 导出同档 */
const JPEG_QUALITY = 0.95;

/**
 * 跨页中间那条书缝。
 * 颜色用半透明黑而不是固定灰：页面底色有白有米色，半透明黑在哪都是"压暗一点"，
 * 不会在深色底上跳出来。
 */
const SPINE_COLOR = 'rgba(0, 0, 0, 0.2)';
/** 书缝宽度（画布像素）。300dpi 下 8px ≈ 0.7mm，缩到手机上看仍然看得见、又不抢戏 */
const SPINE_WIDTH = 8;

export type ImageExportMode = 'single' | 'spread';

/**
 * 图片导出（单面 / 双面）的入口开关：这个版本先藏起来，后续再开放。
 * 只是不显示菜单项 —— 实现、跨页规则（spreadGroups）、书缝、进度提示全都留着，
 * 想放出来把这里改成 true 即可（和 Editor 的 SHOW_BODY_STYLE_ENTRY 一个套路）。
 */
export const SHOW_IMAGE_EXPORT_ENTRY = false;

/**
 * 跨页分组，规则与预览页（page-flip showCover）完全一致：
 * [0]（封面）、[1,2]、[3,4]…，总页数为偶数时末页单独在左（背封）。
 * 双面导出和菜单里的张数预览都用它，别在别处再写一套。
 */
export function spreadGroups(total: number): number[][] {
  if (total <= 0) return [];
  const groups: number[][] = [[0]];
  for (let i = 1; i < total; i += 2) {
    groups.push(i + 1 < total ? [i, i + 1] : [i]);
  }
  return groups;
}

/** 图片文件名：一页的写「第01页.jpg」，两页拼的写「第02-03页.jpg」（页码从 1 数起，和预览页顶栏一致） */
function groupFileName(group: number[]): string {
  const pad = (i: number) => String(i + 1).padStart(2, '0');
  return group.length === 1
    ? `第${pad(group[0])}页.jpg`
    : `第${pad(group[0])}-${pad(group[1])}页.jpg`;
}

/** 把一页画到给定画布上（复用同一张画布时先重置变换，别让上一页的状态残留） */
function drawPageTo(
  page: Page,
  format: BookFormat,
  assets: Map<string, HTMLImageElement>,
  canvas: HTMLCanvasElement
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawPageContent(ctx, page, format, EXPORT_DPI, assets);
}

/** 画布 → JPEG 字节。用 toBlob 而不是 toDataURL：编码交给后台线程，主线程不用停下来等 */
async function toJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  if (!blob) throw new Error('图片生成失败');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 导出图片 zip。返回 blob 和文件名，下载由调用方触发（和备份包一个套路）。
 */
export async function exportImagesZip(
  project: Project,
  mode: ImageExportMode,
  onProgress?: (done: number, total: number) => void
): Promise<{ blob: Blob; filename: string; count: number }> {
  const pages = project.pages;
  const format = project.format;
  const groups = mode === 'spread' ? spreadGroups(pages.length) : pages.map((_, i) => [i]);
  if (groups.length === 0) {
    throw new Error('这本相册还没有页面，没有可导出的内容');
  }

  // 整本书用到的图一次解码好，逐页复用（和 PDF 导出同一做法）
  const assets = await decodeAssets(collectAssetIds(pages));

  // 单页画布复用；双面另开一张两倍宽的，把左右两页拼进去
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = Math.round(mmToPx(format.width, EXPORT_DPI));
  pageCanvas.height = Math.round(mmToPx(format.height, EXPORT_DPI));

  const spreadCanvas = document.createElement('canvas');
  spreadCanvas.width = pageCanvas.width * 2;
  spreadCanvas.height = pageCanvas.height;

  // 图片已是 JPEG，再压一遍没收益还费 CPU，所以用 ZipPassThrough 只封装不压缩
  // （和备份包同一套做法）；攒 Blob 不攒 Uint8Array —— 几十上百 MB 压在 JS 堆上
  // 容易把标签页压崩，Blob 由浏览器托管、可以直接落磁盘。
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
  for (const group of groups) {
    let bytes: Uint8Array;
    if (group.length === 1) {
      drawPageTo(pages[group[0]], format, assets, pageCanvas);
      bytes = await toJpegBytes(pageCanvas);
    } else {
      const sctx = spreadCanvas.getContext('2d')!;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, spreadCanvas.width, spreadCanvas.height);
      drawPageTo(pages[group[0]], format, assets, pageCanvas);
      sctx.drawImage(pageCanvas, 0, 0);
      drawPageTo(pages[group[1]], format, assets, pageCanvas);
      sctx.drawImage(pageCanvas, pageCanvas.width, 0);
      // 最后压上中间那条书缝：跨过中线左右各半，模拟书的两页
      sctx.fillStyle = SPINE_COLOR;
      sctx.fillRect(pageCanvas.width - SPINE_WIDTH / 2, 0, SPINE_WIDTH, spreadCanvas.height);
      bytes = await toJpegBytes(spreadCanvas);
    }
    addFile(groupFileName(group), bytes);
    onProgress?.(++done, groups.length);
  }

  zip.end();
  if (zipError) throw zipError;

  const base = safeFolderName(project.name || '相册', new Set());
  return {
    blob: new Blob(parts, { type: 'application/zip' }),
    filename: `${base}-${mode === 'spread' ? '双面' : '单面'}.zip`,
    count: groups.length,
  };
}
