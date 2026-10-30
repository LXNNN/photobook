import type { BookFormat } from '@/types';
import type { TemplateDefinition } from '@/templates';

/** 智能排版用的照片信息（创建页在生成前算好，只活在内存里，不落盘） */
export interface AutoPhoto {
  id: string;
  width: number;
  height: number;
  /** 画面分量 0-1（utils/photoAnalysis 算出来的），缺省按 0.5 */
  weight?: number;
}

/** cover 模式下这张照片放进这个图位要裁掉多少（0 = 一点都不用裁） */
export function cropLoss(photoAspect: number, slotAspect: number): number {
  if (!(photoAspect > 0) || !(slotAspect > 0)) return 0;
  const visible = photoAspect > slotAspect ? slotAspect / photoAspect : photoAspect / slotAspect;
  return 1 - visible;
}

/**
 * 把这一页的照片分到模板的图位里，返回按元素顺序排好的图片 id。
 *
 * 规则：
 * - 竖图优先进竖框、横图优先进横框，尽量少裁
 * - 最大的图位优先分给「画面分量」最高的照片（主角），
 *   但如果它的形状实在不合适、裁得太狠，就让给更合适的那张
 * - 条件差不多时按上传顺序
 */
export function orderPhotosForTemplate(
  template: TemplateDefinition,
  photos: AutoPhoto[],
  format: BookFormat
): string[] {
  const slots = template.elements
    .filter((el) => el.type === 'image')
    .map((el) => ({
      area: el.width * el.height,
      aspect: (el.width * format.width) / (el.height * format.height),
    }));

  // 张数对不上（理论上不会发生）就按原顺序填，至少不丢照片
  if (slots.length !== photos.length) {
    return photos.map((photo) => photo.id);
  }

  const remaining = [...photos];
  const ordered = new Array<string>(slots.length);
  const slotOrder = slots
    .map((_, index) => index)
    .sort((a, b) => slots[b].area - slots[a].area);
  const heroSlot = slotOrder[0];

  for (const slotIndex of slotOrder) {
    const slot = slots[slotIndex];
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const photo = remaining[i];
      const photoAspect =
        photo.width > 0 && photo.height > 0 ? photo.width / photo.height : slot.aspect;
      let score = cropLoss(photoAspect, slot.aspect);
      // 主角加成只给最大的图位；0.18 足够让同样合适的照片优先，
      // 又不至于为了「主角」把一张竖图硬塞进横框裁掉一大半
      if (slotIndex === heroSlot) score -= 0.18 * (photo.weight ?? 0.5);
      // 同等条件按上传顺序，保证结果稳定
      score += i * 1e-6;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    ordered[slotIndex] = remaining.splice(bestIndex, 1)[0].id;
  }
  return ordered;
}
