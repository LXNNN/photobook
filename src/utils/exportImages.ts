import { Zip, ZipPassThrough } from 'fflate';
import type { BookFormat, Page, Project } from '@/types';
import { collectAssetIds, drawPageContent, ensureStaticBackgroundsLoaded } from '@/engine/drawPageContent';
import { decodeAssets } from './assetStore';
import { ensureFontsLoaded } from './fonts';
import { mmToPx } from './units';
import { safeFolderName } from './fileNames';
import { spreadGroups } from './spread';

/**
 * 把整本相册导出成一批高清图片（zip 打包下载）。
 *
 * 两种方式：
 * - 单面：一页一张
 * - 双面：封面和封底拼成一张（封底在左、封面在右），其余按阅读跨页 [2,3]、[4,5]…
 *   拼成一排（分组规则见 spreadImageGroups）。两页中间压一条灰线当书缝，
 *   一眼看出是摊开的两页。
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
 * 图片导出（单面 / 双面）的入口开关。
 * 2026-10-16 起开放（她要用来给打印社/发图）；想再藏起来就把这里改成 false，
 * 菜单项消失、实现全留着（和 Editor 的 SHOW_BODY_STYLE_ENTRY 一个套路）。
 */
export const SHOW_IMAGE_EXPORT_ENTRY = true;

/**
 * 跨页分组（[0]、[1,2]、[3,4]…，偶数页数时末页落单）的唯一实现在
 * utils/spread.ts —— 预览页、智能排版、编辑器等多处在共用。
 * 这里 re-export 保持原有 import 路径可用。
 */
export { spreadGroups };

/**
 * 双面图片导出的分组：封面和封底拼成一张，其余按阅读跨页 [1,2]、[3,4]…
 *
 * 拼法跟印刷版封面一致：封底在左、封面在右（从书外面看的样子），
 * 所以返回的分组是 [末页下标, 0]。其它跨页的左右顺序就是阅读顺序。
 *
 * 预览页仍用 spreadGroups（封面单独、末页落单），这里只给图片导出用。
 * 相册总页数正常情况下是偶数；奇数时退回原分组（首尾不合并，避免拆散跨页）。
 */
export function spreadImageGroups(total: number): number[][] {
  if (total <= 0) return [];
  if (total === 1) return [[0]];
  if (total % 2 === 1) return spreadGroups(total);

  const groups: number[][] = [[total - 1, 0]];
  for (let i = 1; i < total - 1; i += 2) {
    groups.push([i, i + 1]);
  }
  return groups;
}

/**
 * 图片文件名：一页的写「第01页.jpg」，两页拼的写「第02-03页.jpg」
 * （页码从 1 数起，和预览页顶栏一致）。
 * 封面+封底那张分组是 [末页, 0]，页码反着写不好认，单独叫「封面-封底.jpg」。
 */
function groupFileName(group: number[]): string {
  const pad = (i: number) => String(i + 1).padStart(2, '0');
  if (group.length === 1) return `第${pad(group[0])}页.jpg`;
  if (group[0] > group[1]) return '封面-封底.jpg';
  return `第${pad(group[0])}-${pad(group[1])}页.jpg`;
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
  const groups = mode === 'spread' ? spreadImageGroups(pages.length) : pages.map((_, i) => [i]);
  if (groups.length === 0) {
    throw new Error('这本相册还没有页面，没有可导出的内容');
  }

  // 整本书用到的图一次解码好，逐页复用（和 PDF 导出同一做法）。
  // 字体也在画之前就绪，否则导出图里的艺术字会被系统字体顶替；
  // 静态背景图也要等，导出是一次画完就结束，不等它就永远缺背景。
  const [assets] = await Promise.all([
    decodeAssets(collectAssetIds(pages)),
    ensureFontsLoaded(pages),
    ensureStaticBackgroundsLoaded(pages),
  ]);

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
