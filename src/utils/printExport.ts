import { jsPDF } from 'jspdf';
import { Zip, ZipPassThrough } from 'fflate';
import type { BookFormat, Page, Project } from '@/types';
import {
  collectAssetIds,
  drawPageContent,
  ensureStaticBackgroundsLoaded,
  type RenderImage,
} from '@/engine/drawPageContent';
import { decodeAssets } from './assetStore';
import { ensureFontsLoaded } from './fonts';
import { mmToPx } from './units';
import { safeFolderName } from './fileNames';

/**
 * 印刷版导出（打印社胶装要求），和原来的 PDF / 图片导出完全独立：
 *
 * - 内页：去掉封面和封底，每张页面等比放大成一张 A4 竖版（210×297mm）；
 * - 封面：封底在左、封面在右，各放大成 A4，居中放在一张 A3+ 横版（483×329mm）上。
 *
 * 为什么是「放大」：相册现在按 A5（148×210mm）设计，打印社要的内页 A4、封面 A3+
 * 是成品尺寸，所以整页按 A4 等比放大；不放大就会在 A4 中间留一圈白边、成品还是 A5 大小。
 *
 * 书脊先按 0 处理（两张 A4 直接相邻），以后要加书脊只改 COVER_GAP_MM 并调整 startX。
 * 渲染仍然只走 drawPageContent 这一份实现，和预览、普通导出逐像素一致。
 */

/** 印刷成品尺寸：内页 A4 竖版，封面展开 A3+ 横版（同一张纸转 90°） */
const INNER = { width: 210, height: 297 } as const;
const COVER = { width: 483, height: 329 } as const;

/** 印刷标准 300 DPI，和普通 PDF 导出一致 */
const PRINT_DPI = 300;
const JPEG_QUALITY = 0.95;

/**
 * 印刷版导出的入口开关。
 * 2026-11-09 起先隐藏；想再开放就改成 true，导出实现全部留着
 * （和 SHOW_IMAGE_EXPORT_ENTRY 一个套路，菜单项和 handleExportPrint 都别删）。
 */
export const SHOW_PRINT_EXPORT_ENTRY = false;

export interface PrintExportResult {
  blob: Blob;
  filename: string;
  /** 内页张数（不含封面/封底） */
  innerPageCount: number;
}

/**
 * 把一页按 A4 等比放大后渲染成画布。
 *
 * 按**宽度**铺满 A4：A5 的 148×210 和 A4 的 210×297 是同一比例，只是毫米取整
 * 有一点点差（放大后高度多出约 1mm）。宁可上下各裁掉 0.5mm，也不要在左右留白 ——
 * 左右留白会让两张 A4 拼在一起时书脊处出现一条 0.7mm 的白线。
 *
 * dpi 同步乘上放大倍数，落到 A4 上仍然是真实的 300dpi 像素，而不是把 300dpi
 * 的 A5 图硬拉大。
 */
function renderPageForA4(
  page: Page,
  format: BookFormat,
  assets: Map<string, RenderImage>
): HTMLCanvasElement {
  const scale = INNER.width / format.width;
  const dpi = PRINT_DPI * scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(mmToPx(format.width, dpi));
  canvas.height = Math.round(mmToPx(format.height, dpi));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  drawPageContent(ctx, page, format, dpi, assets);
  return canvas;
}

/**
 * 把放大后的一页放到一张标准 A4 画布上。
 *
 * 宽度方向正好铺满；高度多出来的那 0.5mm 左右由画布自然裁掉。
 * 如果以后遇到比 A4 矮的开本，就居中留白（白底）——目前只有 A5，走不到这条。
 */
function composeA4(pageCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(mmToPx(INNER.width, PRINT_DPI));
  canvas.height = Math.round(mmToPx(INNER.height, PRINT_DPI));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    pageCanvas,
    Math.round((canvas.width - pageCanvas.width) / 2),
    Math.round((canvas.height - pageCanvas.height) / 2)
  );
  return canvas;
}

/** 画布 → JPEG dataURL（和普通 PDF 导出同档质量） */
function canvasToJpeg(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** 大画布用完立刻释放位图内存（A3+ 300dpi 一张约 90MB） */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * 导出印刷版：返回一个 zip（内含「内页A4.pdf」和「封面A3+.pdf」），下载由调用方触发。
 *
 * 封面展开的方向：从外面看，封底在左、封面在右。封面 PDF 用 A3+ 横版 483×329，
 * 因为两张 A4 并排是 420×297，竖版的 329mm 宽度放不下。
 */
export async function exportPrintVersion(
  project: Project,
  onProgress?: (done: number, total: number) => void
): Promise<PrintExportResult> {
  const pages = project.pages;
  const format = project.format;
  if (pages.length < 3) {
    throw new Error('这本相册没有内页，无法导出印刷版');
  }

  const coverPage = pages[0];
  const backPage = pages[pages.length - 1];
  const innerPages = pages.slice(1, -1);

  // 整本书用到的图一次解码好，逐页复用；字体/静态背景也要在开画之前就绪，
  // 否则导出的 PDF 里艺术字会被系统字体顶替、静态背景永远缺一块。
  const [assets] = await Promise.all([
    decodeAssets(collectAssetIds(pages)),
    ensureFontsLoaded(pages),
    ensureStaticBackgroundsLoaded(pages),
  ]);

  const total = innerPages.length + 2; // 内页 + 封底 + 封面
  let done = 0;

  // ===== 内页 A4（去掉封面和封底）=====
  const innerPdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [INNER.width, INNER.height],
    compress: true,
  });

  for (let i = 0; i < innerPages.length; i++) {
    if (i > 0) innerPdf.addPage([INNER.width, INNER.height], 'portrait');
    const pageCanvas = renderPageForA4(innerPages[i], format, assets);
    const a4Canvas = composeA4(pageCanvas);
    innerPdf.addImage(canvasToJpeg(a4Canvas), 'JPEG', 0, 0, INNER.width, INNER.height);
    releaseCanvas(pageCanvas);
    releaseCanvas(a4Canvas);
    onProgress?.(++done, total);
  }

  // ===== 封面 A3+（封底在左、封面在右，各一张 A4，整体居中）=====
  const coverPdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [COVER.width, COVER.height],
    compress: true,
  });

  const sheet = document.createElement('canvas');
  sheet.width = Math.round(mmToPx(COVER.width, PRINT_DPI));
  sheet.height = Math.round(mmToPx(COVER.height, PRINT_DPI));
  const sheetCtx = sheet.getContext('2d');
  if (!sheetCtx) throw new Error('无法创建画布');
  sheetCtx.fillStyle = '#ffffff';
  sheetCtx.fillRect(0, 0, sheet.width, sheet.height);

  const a4WidthPx = Math.round(mmToPx(INNER.width, PRINT_DPI));
  const a4HeightPx = Math.round(mmToPx(INNER.height, PRINT_DPI));
  // 两张 A4 并排，整体在 A3+ 上居中；书脊先按 0 算，以后加书脊从这里留缝
  const startX = Math.round((sheet.width - a4WidthPx * 2) / 2);
  const startY = Math.round((sheet.height - a4HeightPx) / 2);

  const coverSlots: Array<{ page: Page; x: number }> = [
    { page: backPage, x: startX }, // 封底在左
    { page: coverPage, x: startX + a4WidthPx }, // 封面在右
  ];
  for (const slot of coverSlots) {
    const pageCanvas = renderPageForA4(slot.page, format, assets);
    const a4Canvas = composeA4(pageCanvas);
    sheetCtx.drawImage(a4Canvas, slot.x, startY);
    releaseCanvas(pageCanvas);
    releaseCanvas(a4Canvas);
    onProgress?.(++done, total);
  }

  coverPdf.addImage(canvasToJpeg(sheet), 'JPEG', 0, 0, COVER.width, COVER.height);
  releaseCanvas(sheet);

  // ===== 两个 PDF 打成一个 zip（和图片导出同一套：只封装不压缩）=====
  const base = safeFolderName(project.name || '相册', new Set());
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

  addFile(`${base}-内页A4.pdf`, new Uint8Array(innerPdf.output('arraybuffer')));
  addFile(`${base}-封面A3+.pdf`, new Uint8Array(coverPdf.output('arraybuffer')));
  zip.end();
  if (zipError) throw zipError;

  return {
    blob: new Blob(parts, { type: 'application/zip' }),
    filename: `${base}-印刷版.zip`,
    innerPageCount: innerPages.length,
  };
}
