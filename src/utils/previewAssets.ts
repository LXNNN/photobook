/**
 * 预览页专用的图片准备（2026-10-31 加）。
 *
 * 背景：预览页把每一页画成 800×1135 左右的图片，再拼成跨页翻书。页上的照片框
 * 大多只有一两百到七八百像素，可源图是 4096px 的 12MP 大图。
 *
 * 以前的 `decodeAssets` 把所有原图整张解码，再在 drawPageContent 里一次一次
 * 下采样：一本 60 页、240 个图位的相册，光「12MP → 几百像素」的 Skia 下采样
 * 就要 18 秒（实测），用户点预览等十几秒就是这里来的。
 *
 * 这里的做法：
 * - 先在所有页面里算出每个 imageId **真正需要的源像素**（按照片区显示尺寸，
 *   再按 crop 比例放大 —— 只裁原图一小块时，那一块要被放大填满整个框）。
 * - 需要 ≤ 200px 的：直接用上传时存好的 200px 缩略图，连原图都不用读。
 * - 其余：把原图交给 Worker（`previewShrinkWorker.ts`）在后台线程解码并直接
 *   缩到需要的尺寸，主线程拿到的是已经缩好的小位图，绘制几乎不花时间。
 *   多 Worker 并行后 120 张 12MP 从 18 秒降到 5.6 秒左右。
 *
 * 清晰度：目标尺寸按显示像素算（源 ≥ 1:1），不会比原来把原图直接画上去糊。
 * 铺满整页的大图照样按整页像素生成，不会拿缩略图去顶。
 *
 * 注意：PDF 导出、图片导出不走这里 —— 它们要 300dpi 的原图，继续用 decodeAssets。
 */
import type { BookFormat, Page } from '@/types';
import { mmToPx } from './units';
import { elementPhotoArea } from '@/engine/drawPageContent';
import { decodeAssets, getImageAsset, getImageMeta } from './assetStore';
import { getImageURL, loadImage } from './image';
import type { ShrinkRequest, ShrinkResponse } from './previewShrinkWorker';

/** 上传时缩略图的长边（image.ts 的 createThumbnail(img, 200)） */
const THUMB_LONG = 200;

/**
 * 目标尺寸相对显示像素的超采样倍数。
 * 1.5 倍以下是「够用」，2 倍才能把「先缩一次、绘制时再缩一次」的两段下采样
 * 损失压到看不出来（实测和原图直绘比 PSNR 从 30dB 提到 35~43dB）。
 * Worker 里多缩一点几乎不花时间（瓶颈是解码，不是写目标像素），所以直接给 2 倍。
 */
const TARGET_SUPERSAMPLE = 2;

/** Worker 数量：实测 6 个最优（8 个会和主线程抢核，4 个又用不满） */
const WORKER_COUNT = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));

/** 画在预览页上的图片：原图解码结果，或 Worker 缩好的位图 */
export type PreviewImage = HTMLImageElement | ImageBitmap;

/**
 * 每个 imageId 在本次渲染里需要的源像素长边。
 * 只看图片元素；背景图不走这里（它们按整页画，走原图更稳）。
 */
export function computeImageNeeds(pages: Page[], dpi: number): Map<string, number> {
  const needs = new Map<string, number>();
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.type !== 'image' || !el.imageId) continue;
      const area = elementPhotoArea(el);
      const photoW = mmToPx(area.width, dpi);
      const photoH = mmToPx(area.height, dpi);
      // crop 是相对原图的比例：只裁一小块时，那一块会被放大填满整个框
      const cropW = Math.min(Math.max(el.crop?.width ?? 1, 0.02), 1);
      const cropH = Math.min(Math.max(el.crop?.height ?? 1, 0.02), 1);
      const need = Math.max(photoW / cropW, photoH / cropH);
      if (need > (needs.get(el.imageId) ?? 0)) needs.set(el.imageId, need);
    }
  }
  return needs;
}

/** 页面里的图片背景 id（不是 dataURL / 静态资源路径的那些） */
function collectBackgroundIds(pages: Page[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    if (page.background.type !== 'image') continue;
    const value = page.background.value;
    if (value.startsWith('data:') || value.startsWith('/')) continue;
    ids.add(value);
  }
  return ids;
}

function loadImageFromSrc(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadThumbnail(id: string): Promise<HTMLImageElement | null> {
  const meta = await getImageMeta(id);
  if (!meta?.thumbnail) return null;
  return loadImageFromSrc(meta.thumbnail);
}

async function loadOriginal(id: string): Promise<HTMLImageElement | null> {
  const asset = await getImageAsset(id);
  if (!asset?.blob) return null;
  const url = getImageURL(asset);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface ShrinkJob {
  id: string;
  maxLong: number;
}

/**
 * 用 Worker 池把原图缩到需要的尺寸。失败的 id 放进 failed，由调用方退回原图。
 *
 * 每个 Worker 一次只领一个任务（领任务时才读 blob），内存峰值是「Worker 数 ×
 * 一张全尺寸位图」，而不是「全部原图同时解码」—— 后者在 100 张以上会到几 GB。
 */
async function shrinkWithWorkers(
  jobs: ShrinkJob[],
  onResult: (id: string, image: PreviewImage) => void,
  failed: Set<string>,
  waitWhileBusy?: () => Promise<void>
): Promise<void> {
  if (jobs.length === 0) return;

  let workers: Worker[];
  try {
    const count = Math.min(WORKER_COUNT, jobs.length);
    workers = Array.from(
      { length: count },
      () => new Worker(new URL('./previewShrinkWorker.ts', import.meta.url), { type: 'module' })
    );
  } catch {
    // 不支持 Worker（或者被 CSP 挡了）：全部退回原图
    for (const job of jobs) failed.add(job.id);
    return;
  }

  const queue = jobs.slice();
  try {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              resolve();
            };

            const pump = async () => {
              // 用户正在翻页时先不派新任务：6 个 Worker 满核解码/缩放会
              // 抢走合成线程的 CPU，翻页动画就会掉帧（实测首次翻开 40ms 的帧，
              // 等后台全部做完后同样一次翻开只有 17ms）。任务粒度是一张图，
              // 正在处理的那张跑完就自然停下。
              if (waitWhileBusy) await waitWhileBusy();
              const job = queue.shift();
              if (!job) {
                finish();
                return;
              }
              const asset = await getImageAsset(job.id).catch(() => undefined);
              if (!asset?.blob) {
                failed.add(job.id);
                void pump();
                return;
              }
              const w = asset.width || 0;
              const h = asset.height || 0;
              if (!w || !h) {
                failed.add(job.id);
                void pump();
                return;
              }
              // 原图本来就不大：不用缩，直接解码
              const long = Math.max(w, h);
              const targetLong = Math.min(long, Math.ceil(job.maxLong * TARGET_SUPERSAMPLE));
              if (targetLong >= long) {
                failed.add(job.id);
                void pump();
                return;
              }
              const scale = targetLong / long;
              const request: ShrinkRequest = {
                id: job.id,
                blob: asset.blob,
                width: Math.max(1, Math.round(w * scale)),
                height: Math.max(1, Math.round(h * scale)),
              };

              worker.onmessage = (e: MessageEvent<ShrinkResponse>) => {
                const data = e.data;
                if (data.bitmap) {
                  onResult(job.id, data.bitmap);
                } else {
                  failed.add(job.id);
                }
                void pump();
              };
              worker.onerror = () => {
                failed.add(job.id);
                void pump();
              };
              worker.postMessage(request);
            };

            void pump();
          })
      )
    );
  } finally {
    for (const worker of workers) worker.terminate();
  }
}

/** 收集前 N 页会用到的图片 id（图片元素 + 图片背景），供首屏优先加载 */
export function collectImageIdsForPages(pages: Page[], pageCount: number): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < Math.min(pageCount, pages.length); i++) {
    const page = pages[i];
    if (page.background.type === 'image') {
      const value = page.background.value;
      if (!value.startsWith('data:') && !value.startsWith('/')) ids.add(value);
    }
    for (const el of page.elements) {
      if (el.type === 'image' && el.imageId) ids.add(el.imageId);
    }
  }
  return ids;
}

/**
 * 预览页的图片准备：按「这次渲染真正需要的尺寸」取图。
 *
 * 与 decodeAssets 的区别只在「给多大的图」：这里给的是刚好够用的小图，
 * 画起来快；导出（PDF / 300dpi 图片）仍然用 decodeAssets 拿原图。
 *
 * `onlyIds` / `skipIds` 是给「首屏优先」用的：先只准备前几页要用的图，
 * 书能立刻显示出来，剩下的在后台继续准备（尺寸仍按全部页面算，
 * 同一张图在后面的页里用得更大时不会缩错）。
 */
export async function decodePreviewAssets(
  pages: Page[],
  format: BookFormat,
  dpi: number,
  options?: {
    onlyIds?: Set<string>;
    skipIds?: Set<string>;
    /** 每张图开始处理前调用，让调用方有机会让路（比如用户正在翻页） */
    waitWhileBusy?: () => Promise<void>;
  }
): Promise<Map<string, PreviewImage>> {
  const needs = computeImageNeeds(pages, dpi);
  const backgroundIds = collectBackgroundIds(pages);
  const assets = new Map<string, PreviewImage>();

  // 背景图：整页大小，走原图（drawPageContent 的背景分支还依赖 complete/naturalWidth）
  const backgroundJobs = [...backgroundIds]
    .filter((id) => !options?.skipIds?.has(id))
    .filter((id) => !options?.onlyIds || options.onlyIds.has(id))
    .map(async (id) => {
      const img = await loadOriginal(id);
      if (img) assets.set(id, img);
    });

  // 小图：用现成的 200px 缩略图（无损的前提是缩略图长边 ≥ 需求，见下面的判断）
  const thumbJobs: string[] = [];
  const shrinkJobs: ShrinkJob[] = [];
  for (const [id, need] of needs) {
    if (backgroundIds.has(id)) continue;
    if (options?.skipIds?.has(id)) continue;
    if (options?.onlyIds && !options.onlyIds.has(id)) continue;
    if (need <= THUMB_LONG) thumbJobs.push(id);
    else shrinkJobs.push({ id, maxLong: need });
  }

  const thumbPromises = thumbJobs.map(async (id) => {
    const img = await loadThumbnail(id);
    if (img) assets.set(id, img);
    else shrinkJobs.push({ id, maxLong: needs.get(id) ?? 0 });
  });

  await Promise.all([...backgroundJobs, ...thumbPromises]);

  const failed = new Set<string>();
  await shrinkWithWorkers(
    shrinkJobs,
    (id, image) => assets.set(id, image),
    failed,
    options?.waitWhileBusy
  );

  // 兜底：Worker 没能处理的（老浏览器 / 尺寸未知 / 解码失败）退回原图，
  // 慢一点但画面一定是对的
  const stillMissing = shrinkJobs
    .map((job) => job.id)
    .filter((id) => !assets.has(id));
  if (stillMissing.length > 0) {
    const fallback = await decodeAssets(new Set(stillMissing));
    for (const [id, img] of fallback) assets.set(id, img);
  }

  return assets;
}
