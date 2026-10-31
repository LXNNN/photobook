/**
 * 预览页专用的缩图 Worker。
 *
 * 为什么要有它：预览页把整本书的每一页画成 800×1135 左右的图片，页上的照片框
 * 只有一两百到七八百像素，可源图是 4096px 的 12MP 大图。在主线程里把 12MP 的
 * 位图缩到几百像素，一次要 130ms 上下（Skia 的高质量下采样要逐像素读一遍），
 * 一本 60 页 240 个图位就是十几秒 —— 用户点「预览」等十几秒就是这么来的。
 *
 * 这些下采样放进 Worker 就能多核并行，而且不占主线程。实测 120 张 12MP 照片
 * 一个 Worker 7 秒、8 个 Worker 5.6 秒，之后主线程拿到的是已经缩好的小位图，
 * 每张画上去几乎不花时间。
 *
 * 注意：`createImageBitmap` 的 resize 选项在老浏览器上会被**静默忽略**（不报错），
 * 所以下面的 postMessage 会带上实际尺寸，调用方可以按真实尺寸再兜一道。
 */

export interface ShrinkRequest {
  id: string;
  blob: Blob;
  /** 目标宽高（按原图比例算好的）；都 >= 原图尺寸时表示不缩放 */
  width: number;
  height: number;
}

export interface ShrinkResponse {
  id: string;
  bitmap?: ImageBitmap;
  /** 实际位图尺寸（resize 被忽略时就是原图尺寸） */
  width?: number;
  height?: number;
  error?: string;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ShrinkRequest>) => void) | null;
  postMessage: (message: ShrinkResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = async (e: MessageEvent<ShrinkRequest>) => {
  const { id, blob, width, height } = e.data;
  try {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
      });
    } catch {
      // resize 参数不被支持时退回全解码（慢一点，但结果对）
      bitmap = await createImageBitmap(blob);
    }
    scope.postMessage(
      { id, bitmap, width: bitmap.width, height: bitmap.height },
      [bitmap]
    );
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
