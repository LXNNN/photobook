import { loadImage } from './image';

/**
 * 在本地给照片算一个「画面分量」分数（0-1），给智能排版挑「主角」用。
 *
 * 只看缩略图的明暗反差、边缘清晰度、色彩丰富度 —— 认不出照片里有什么，
 * 也不需要联网：全部在浏览器本地算，照片不出电脑。
 *
 * 分数高 ≈ 画面更抓眼（清楚、反差强、颜色饱满），会优先放进模板里最大的图位。
 * 拿不到 / 算不了就返回 0.5，退回按上传顺序分配，不影响生成。
 */

/** 分析用的小图边长。64 够看出反差和结构，又不至于让 40 张照片的分析拖慢生成 */
const SAMPLE_SIZE = 64;

export async function analyzePhotoWeight(thumbnail: string): Promise<number> {
  try {
    const img = await loadImage(thumbnail);

    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0.5;
    // 不管横竖，统一压成方形采样：这里只统计颜色分布，不关心构图
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const luminance = new Float32Array(SAMPLE_SIZE * SAMPLE_SIZE);
    let sum = 0;
    let sumSq = 0;
    let saturationSum = 0;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      luminance[p] = l;
      sum += l;
      sumSq += l * l;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      saturationSum += max === 0 ? 0 : (max - min) / max;
    }

    const count = luminance.length;
    const mean = sum / count;
    // 明暗反差：太灰太平的照片分数低
    const contrast = Math.sqrt(Math.max(0, sumSq / count - mean * mean));

    // 边缘密度：相邻像素的亮度差。缩到 64px 后还剩的差别，就是画面的「结构感」
    let gradientSum = 0;
    let gradientCount = 0;
    for (let y = 0; y < SAMPLE_SIZE; y++) {
      for (let x = 0; x < SAMPLE_SIZE; x++) {
        const p = y * SAMPLE_SIZE + x;
        if (x + 1 < SAMPLE_SIZE) {
          gradientSum += Math.abs(luminance[p + 1] - luminance[p]);
          gradientCount++;
        }
        if (y + 1 < SAMPLE_SIZE) {
          gradientSum += Math.abs(luminance[p + SAMPLE_SIZE] - luminance[p]);
          gradientCount++;
        }
      }
    }

    const contrastScore = clamp01(contrast / 56);
    const sharpnessScore = clamp01(gradientSum / gradientCount / 18);
    const colorScore = clamp01(saturationSum / count / 0.35);

    return clamp01(0.35 * contrastScore + 0.4 * sharpnessScore + 0.25 * colorScore);
  } catch (err) {
    // 分析失败不影响生成：按中间值处理，照片照样进相册
    console.warn('照片画面分析失败，按默认分量处理:', err);
    return 0.5;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
