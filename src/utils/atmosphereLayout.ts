import type { Project, Page, BookFormat, TextElement } from '@/types';
import { applyTemplate, type TemplateDefinition } from '@/templates';
import { generateId } from '@/utils/units';
import { DEFAULT_BODY_FONT_SIZE } from '@/utils/bodyText';
import { orderPhotosForTemplate, type AutoPhoto } from '@/utils/photoOrder';
import {
  getAtmospherePairPools,
  getAtmosphereCoverTemplate,
  getAtmosphereEndingTemplate,
  getOneImageTemplates,
  type AtmospherePair,
  type AtmospherePairPools,
} from '@/templates/atmospherePairs';
import type { AutoLayoutOptions } from '@/utils/autoLayout';

/** 平均每个跨页放几张；固定池 28 对（不含 12.1）平均约 6 张 */
const TARGET_PHOTOS_PER_SPREAD = 6;
/** 先按目标跨页数附近找，找不到再逐步放宽 */
const K_OFFSETS = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -8, 8, -10, 10];
/** 12.1 只在总张数超过这个数时参与 */
const MAX_121_PHOTOS = 60;

/** 规划出来的一对跨页（left 为 null 表示空白页） */
export interface PlannedAtmosphereSpread {
  left: TemplateDefinition | null;
  right: TemplateDefinition | null;
  leftCount: number;
  rightCount: number;
  capacity: number;
  special?: '12.1' | '7.2';
  key?: string;
}

interface CapacityBucket {
  capacity: number;
  candidates: AtmospherePair[];
  maxCount: number;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dedupePairs(pairs: AtmospherePair[]): AtmospherePair[] {
  const seen = new Set<string>();
  const out: AtmospherePair[] = [];
  for (const pair of pairs) {
    if (seen.has(pair.key)) continue;
    seen.add(pair.key);
    out.push(pair);
  }
  return out;
}

function blankPage(): Page {
  return {
    id: generateId(),
    background: { type: 'color', value: '#ffffff' },
    elements: [],
  };
}

function spreadFromPair(pair: AtmospherePair): PlannedAtmosphereSpread {
  const special: '12.1' | '7.2' | undefined = pair.has121
    ? '12.1'
    : pair.has72
      ? '7.2'
      : undefined;
  return {
    left: pair.left,
    right: pair.right,
    leftCount: pair.leftSlots,
    rightCount: pair.rightSlots,
    capacity: pair.capacity,
    special,
    key: pair.key,
  };
}

/** M=1：一张 1 图模板 + 一张空白页 */
function planSinglePhoto(): PlannedAtmosphereSpread {
  const templates = getOneImageTemplates();
  if (templates.length === 0) throw new Error('没有可用的 1 图氛围感模板');
  return {
    left: null,
    right: templates[0],
    leftCount: 0,
    rightCount: 1,
    capacity: 1,
    key: `blank|${templates[0].name}`,
  };
}

/** M=2：左右各一张 1 图模板 */
function planTwoPhotos(): PlannedAtmosphereSpread {
  const templates = getOneImageTemplates();
  if (templates.length === 0) throw new Error('没有可用的 1 图氛围感模板');
  const left = templates[0];
  const right = templates[1] ?? templates[0];
  return {
    left,
    right,
    leftCount: 1,
    rightCount: 1,
    capacity: 2,
    key: `${left.name}|${right.name}`,
  };
}

/**
 * 按照片张数规划正文跨页。只做规划，不生成页面，方便单独验证。
 */
export function planAtmosphereSpreads(
  photoCount: number,
  pools: AtmospherePairPools = getAtmospherePairPools()
): PlannedAtmosphereSpread[] {
  if (photoCount <= 0) throw new Error('没有照片可排版');
  if (photoCount === 1) return [planSinglePhoto()];
  if (photoCount === 2) return [planTwoPhotos()];

  const kTarget = Math.max(1, Math.round(photoCount / TARGET_PHOTOS_PER_SPREAD));

  // 一级一级放宽：固定池 → 固定+备用 → 再加左右池动态配对
  const tiers: AtmospherePair[][] = [
    pools.primary,
    dedupePairs([...pools.primary, ...pools.backup]),
    dedupePairs([...pools.primary, ...pools.backup, ...pools.dynamic]),
  ];

  for (const tierPairs of tiers) {
    const result = tryTier(tierPairs, photoCount, kTarget, false);
    if (result) return orderSpreads(result);
  }

  // 最后一档：允许同一对重复使用
  const allPairs = dedupePairs([...pools.primary, ...pools.backup, ...pools.dynamic]);
  const reused = tryTier(allPairs, photoCount, kTarget, true);
  if (reused) return orderSpreads(reused);

  throw new Error('氛围感模板凑不出这套照片张数');
}

/**
 * 在一个候选池里找解：先决定用不用 12.1/7.2（最多用一对），
 * 再把余下的照片按容量组合分给普通配对。
 */
function tryTier(
  pairs: AtmospherePair[],
  totalPhotos: number,
  kTarget: number,
  allowReuse: boolean
): PlannedAtmosphereSpread[] | null {
  const canUse121 = totalPhotos > MAX_121_PHOTOS;
  const usable = pairs.filter((p) => !p.has121 || canUse121);

  const regular = usable.filter((p) => !p.has121 && !p.has72);
  const special72 = shuffle(usable.filter((p) => p.has72 && !p.has121));
  const special121 = canUse121
    ? shuffle(usable.filter((p) => p.has121 && !p.has72))
    : [];

  const specialOptions: Array<{ special?: '12.1' | '7.2'; pair?: AtmospherePair }> = [
    {},
    ...special72.map((pair) => ({ special: '7.2' as const, pair })),
    ...special121.map((pair) => ({ special: '12.1' as const, pair })),
  ];

  for (const offset of K_OFFSETS) {
    const k = kTarget + offset;
    if (k < 1) continue;

    for (const option of specialOptions) {
      const specialPairs = option.pair ? 1 : 0;
      const remainingK = k - specialPairs;
      if (remainingK < 0) continue;

      const remainingPhotos = totalPhotos - (option.pair?.capacity ?? 0);
      if (remainingPhotos < 0) continue;

      const buckets = buildBuckets(regular, allowReuse, remainingK);
      if (buckets.length === 0 && remainingPhotos !== 0) continue;
      if (remainingPhotos === 0 && remainingK !== 0) continue;

      const composition = findComposition(buckets, remainingPhotos, remainingK);
      if (!composition) continue;

      const spreads = instantiatePlan(composition, regular, option.pair, allowReuse);
      if (spreads) return spreads;
    }
  }

  // 大张数时容量组合太刁钻，用贪心兜底（允许重复的那一档才用）
  if (allowReuse) {
    return greedyPlan(regular, special72, special121, totalPhotos, kTarget);
  }
  return null;
}

function buildBuckets(
  pairs: AtmospherePair[],
  allowReuse: boolean,
  maxK: number
): CapacityBucket[] {
  const byCapacity = new Map<number, AtmospherePair[]>();
  for (const pair of pairs) {
    const list = byCapacity.get(pair.capacity) ?? [];
    list.push(pair);
    byCapacity.set(pair.capacity, list);
  }
  return [...byCapacity.entries()]
    .map(([capacity, candidates]) => ({
      capacity,
      candidates,
      maxCount: allowReuse ? maxK : candidates.length,
    }))
    .sort((a, b) => b.capacity - a.capacity);
}

/**
 * 容量组合回溯：每个容量代表一组配对，最多用 candidates.length 次
 * （允许复用时上限就是剩余跨页数）。只关心「几种容量各用几次」，
 * 具体用哪几对留给 instantiatePlan 随机挑。
 */
function findComposition(
  buckets: CapacityBucket[],
  targetSum: number,
  targetK: number
): Map<number, number> | null {
  if (targetSum === 0 && targetK === 0) return new Map();
  if (targetSum <= 0 || targetK <= 0) return null;

  const chosen = new Array<number>(buckets.length).fill(0);
  const failed = new Set<string>();

  const dfs = (index: number, sum: number, count: number): boolean => {
    if (sum === targetSum && count === targetK) return true;
    if (index >= buckets.length || sum > targetSum || count > targetK) return false;

    // 上界剪枝：剩下的桶全用满也到不了目标就直接放弃
    let maxSum = sum;
    let maxCount = count;
    for (let i = index; i < buckets.length; i++) {
      const bucket = buckets[i];
      const n = Math.min(
        bucket.maxCount,
        Math.floor((targetSum - sum) / bucket.capacity)
      );
      if (n <= 0) continue;
      maxSum += n * bucket.capacity;
      maxCount += n;
    }
    if (maxSum < targetSum || maxCount < targetK) return false;

    const key = `${index}|${sum}|${count}`;
    if (failed.has(key)) return false;

    const bucket = buckets[index];
    const maxUse = Math.min(
      bucket.maxCount,
      Math.floor((targetSum - sum) / bucket.capacity),
      targetK - count
    );

    for (let use = maxUse; use >= 0; use--) {
      chosen[index] = use;
      if (dfs(index + 1, sum + use * bucket.capacity, count + use)) return true;
    }
    chosen[index] = 0;
    failed.add(key);
    return false;
  };

  if (!dfs(0, 0, 0)) return null;

  const result = new Map<number, number>();
  for (let i = 0; i < buckets.length; i++) {
    if (chosen[i] > 0) result.set(buckets[i].capacity, chosen[i]);
  }
  return result;
}

/** 把「容量→次数」落到具体的配对；优先用整本还没出现过的模板 */
function instantiatePlan(
  composition: Map<number, number>,
  regularPairs: AtmospherePair[],
  specialPair: AtmospherePair | undefined,
  allowReuse: boolean
): PlannedAtmosphereSpread[] | null {
  const byCapacity = new Map<number, AtmospherePair[]>();
  for (const pair of regularPairs) {
    const list = byCapacity.get(pair.capacity) ?? [];
    list.push(pair);
    byCapacity.set(pair.capacity, list);
  }

  const usedKeys = new Set<string>();
  const templateUsage = new Map<string, number>();
  const usedTemplates = (pair: AtmospherePair): number =>
    (templateUsage.get(pair.left.name) ?? 0) + (templateUsage.get(pair.right.name) ?? 0);
  const remember = (pair: AtmospherePair) => {
    templateUsage.set(pair.left.name, (templateUsage.get(pair.left.name) ?? 0) + 1);
    templateUsage.set(pair.right.name, (templateUsage.get(pair.right.name) ?? 0) + 1);
  };

  if (specialPair) remember(specialPair);

  const chosenPairs: AtmospherePair[] = [];
  for (const [capacity, count] of composition) {
    const candidates = byCapacity.get(capacity) ?? [];
    if (candidates.length === 0) return null;

    for (let i = 0; i < count; i++) {
      let available = candidates.filter((pair) => !usedKeys.has(pair.key));
      if (available.length === 0) {
        if (!allowReuse) return null;
        available = candidates;
      }

      let minUsage = Number.POSITIVE_INFINITY;
      for (const pair of available) minUsage = Math.min(minUsage, usedTemplates(pair));
      const best = available.filter((pair) => usedTemplates(pair) === minUsage);
      const picked = best[Math.floor(Math.random() * best.length)];

      chosenPairs.push(picked);
      usedKeys.add(picked.key);
      remember(picked);
    }
  }

  const spreads = chosenPairs.map(spreadFromPair);
  if (specialPair) spreads.push(spreadFromPair(specialPair));
  return spreads;
}

/** 大张数兜底：按平均张数贪心选容量，不保证配对不重复（这一档本来就允许重复） */
function greedyPlan(
  regular: AtmospherePair[],
  special72: AtmospherePair[],
  special121: AtmospherePair[],
  totalPhotos: number,
  kTarget: number
): PlannedAtmosphereSpread[] | null {
  const capacities = [...new Set(regular.map((p) => p.capacity))].sort((a, b) => a - b);
  if (capacities.length === 0) return null;
  const minCap = capacities[0];
  const maxCap = capacities[capacities.length - 1];

  const options: Array<{ special?: '12.1' | '7.2'; pair?: AtmospherePair }> = [
    {},
    ...special72.map((pair) => ({ special: '7.2' as const, pair })),
    ...special121.map((pair) => ({ special: '12.1' as const, pair })),
  ];

  for (const option of options) {
    const specialPairs = option.pair ? 1 : 0;
    const remainingPhotos = totalPhotos - (option.pair?.capacity ?? 0);
    if (remainingPhotos < 0) continue;

    for (const offset of K_OFFSETS) {
      const k = kTarget + offset - specialPairs;
      if (k < 1) continue;
      if (remainingPhotos < k * minCap || remainingPhotos > k * maxCap) continue;

      const chosenCaps: number[] = [];
      let leftSum = remainingPhotos;
      let ok = true;

      for (let i = 0; i < k; i++) {
        const slotsLeft = k - i;
        const lower = Math.max(minCap, leftSum - (slotsLeft - 1) * maxCap);
        const upper = Math.min(maxCap, leftSum - (slotsLeft - 1) * minCap);
        const choices = capacities.filter((c) => c >= lower && c <= upper);
        if (choices.length === 0) {
          ok = false;
          break;
        }
        const avg = leftSum / slotsLeft;
        choices.sort((a, b) => Math.abs(a - avg) - Math.abs(b - avg));
        chosenCaps.push(choices[0]);
        leftSum -= choices[0];
      }
      if (!ok || leftSum !== 0) continue;

      const composition = new Map<number, number>();
      for (const cap of chosenCaps) {
        composition.set(cap, (composition.get(cap) ?? 0) + 1);
      }
      const spreads = instantiatePlan(composition, regular, option.pair, true);
      if (spreads) return spreads;
    }
  }

  return null;
}

function countAdjacentEqualCapacity(spreads: PlannedAtmosphereSpread[]): number {
  let count = 0;
  for (let i = 1; i < spreads.length; i++) {
    if (spreads[i].capacity === spreads[i - 1].capacity) count++;
  }
  return count;
}

/**
 * 贪心重排：每次挑剩余数量最多的容量，且尽量和上一对疏密相反。
 * 只要最密的容量不超过一半，就能排成完全不相邻（类似「重构字符串」）。
 */
function arrangeWithoutAdjacentEqual(
  spreads: PlannedAtmosphereSpread[]
): PlannedAtmosphereSpread[] {
  const groups = new Map<number, PlannedAtmosphereSpread[]>();
  for (const spread of spreads) {
    const list = groups.get(spread.capacity) ?? [];
    list.push(spread);
    groups.set(spread.capacity, list);
  }

  const remaining = [...groups.entries()].map(([capacity, items]) => ({
    capacity,
    items: shuffle(items),
  }));
  const total = spreads.length;
  const result: PlannedAtmosphereSpread[] = [];
  let lastCapacity: number | null = null;

  while (result.length < total) {
    let best: (typeof remaining)[number] | null = null;

    for (const group of remaining) {
      if (group.items.length === 0 || group.capacity === lastCapacity) continue;

      if (!best || group.items.length > best.items.length) {
        best = group;
      } else if (group.items.length === best.items.length) {
        // 数量一样时，尽量让下一对和上一对疏密相反
        if (lastCapacity === null) {
          if (group.capacity > best.capacity) best = group;
        } else if (lastCapacity >= 6) {
          if (group.capacity < best.capacity) best = group;
        } else if (group.capacity > best.capacity) {
          best = group;
        }
      }
    }

    // 只剩上一对的容量了，只能相邻（正常容量分布不会走到这里）
    if (!best) {
      best = remaining.find((group) => group.items.length > 0) ?? null;
    }
    if (!best) break;

    const item = best.items.pop();
    if (!item) break;
    result.push(item);
    lastCapacity = best.capacity;
  }

  return result;
}

/**
 * 排序：12.1 放整本 1/3 处；其余先按容量大小交替排，
 * 如果仍有相邻两对一样密，就换用贪心重排尽量拉开。
 */
function orderSpreads(spreads: PlannedAtmosphereSpread[]): PlannedAtmosphereSpread[] {
  if (spreads.length <= 1) return spreads;

  const special121 = spreads.find((s) => s.special === '12.1');
  const rest = special121 ? spreads.filter((s) => s !== special121) : [...spreads];

  const desc = shuffle(rest).sort((a, b) => b.capacity - a.capacity);
  const ordered: PlannedAtmosphereSpread[] = [];
  let i = 0;
  let j = desc.length - 1;
  while (i <= j) {
    ordered.push(desc[i++]);
    if (i <= j) ordered.push(desc[j--]);
  }

  if (countAdjacentEqualCapacity(ordered) > 0) {
    const alternative = arrangeWithoutAdjacentEqual(rest);
    if (countAdjacentEqualCapacity(alternative) < countAdjacentEqualCapacity(ordered)) {
      ordered.splice(0, ordered.length, ...alternative);
    }
  }

  if (special121) {
    const base = Math.min(
      ordered.length,
      Math.max(0, Math.floor(spreads.length / 3))
    );
    // 12.1 放在 1/3 附近；如果旁边正好也有 13 张的跨页，就往旁边挪一格
    let insertAt = base;
    for (let distance = 1; distance <= ordered.length; distance++) {
      const candidates = [base - distance, base + distance];
      let found = false;
      for (const position of candidates) {
        if (position < 0 || position > ordered.length) continue;
        const prev = position > 0 ? ordered[position - 1] : undefined;
        const next = position < ordered.length ? ordered[position] : undefined;
        if (prev?.capacity === special121.capacity || next?.capacity === special121.capacity) {
          continue;
        }
        insertAt = position;
        found = true;
        break;
      }
      if (found) break;
    }
    ordered.splice(insertAt, 0, special121);
  }
  return ordered;
}

/** 生成一本氛围感相册 */
export function generateAtmosphereAlbum(options: AutoLayoutOptions): Project {
  const {
    projectName,
    themeId,
    photos,
    format,
    bodyFontSize = DEFAULT_BODY_FONT_SIZE,
  } = options;

  const pages: Page[] = [];
  const plan = photos.length > 0 ? planAtmosphereSpreads(photos.length) : [];

  // 封面固定生成（氛围感的跨页结构依赖封面/尾页）
  pages.push(
    createAtmosphereCoverPage(projectName, format, photos[0]?.id ?? '', themeId, bodyFontSize)
  );

  let photoIndex = 0;
  for (const spread of plan) {
    if (spread.left) {
      const pagePhotos = photos.slice(photoIndex, photoIndex + spread.leftCount);
      photoIndex += spread.leftCount;
      pages.push(makeAtmospherePage(spread.left, pagePhotos, format, themeId, bodyFontSize));
    } else {
      pages.push(blankPage());
    }

    if (spread.right) {
      const pagePhotos = photos.slice(photoIndex, photoIndex + spread.rightCount);
      photoIndex += spread.rightCount;
      pages.push(makeAtmospherePage(spread.right, pagePhotos, format, themeId, bodyFontSize));
    } else {
      pages.push(blankPage());
    }
  }

  // 尾页固定生成；没有照片时也保留一张空白尾页
  pages.push(
    createAtmosphereEndingPage(
      format,
      photos.length > 0 ? photos[photos.length - 1].id : '',
      themeId,
      bodyFontSize
    )
  );

  // 兜底：整本页数必须是偶数（正常规划不会走到这里）
  if (pages.length % 2 !== 0) pages.push(blankPage());

  const now = Date.now();
  return {
    id: generateId(),
    name: projectName,
    format,
    pages,
    createdAt: now,
    updatedAt: now,
    version: 1,
    themeId,
    bodyFontSize,
    styleId: 'atmosphere',
  };
}

function makeAtmospherePage(
  template: TemplateDefinition,
  pagePhotos: AutoPhoto[],
  format: BookFormat,
  themeId: string,
  bodyFontSize: number
): Page {
  const orderedIds = orderPhotosForTemplate(template, pagePhotos, format);
  const { elements, doodle, background } = applyTemplate(
    template,
    format,
    orderedIds,
    themeId,
    bodyFontSize,
    undefined,
    { preserveText: true, forceFixedText: true }
  );
  return {
    id: generateId(),
    background: background ?? { type: 'color', value: '#ffffff' },
    elements,
    templateId: template.id,
    doodle,
  };
}

/** 封面：杂志封面同款，只有大标题换成相册名 */
function createAtmosphereCoverPage(
  projectName: string,
  format: BookFormat,
  imageId: string,
  themeId: string,
  bodyFontSize: number
): Page {
  const template = getAtmosphereCoverTemplate();
  if (!template) return blankPage();

  const { elements, doodle, background } = applyTemplate(
    template,
    format,
    imageId ? [imageId] : [],
    themeId,
    bodyFontSize,
    undefined,
    // 先不标 fixed，不然下面找不到大标题
    { preserveText: true }
  );

  for (const el of elements) {
    if (el.type !== 'text') continue;
    const textEl = el as TextElement;
    if (!textEl.fixed && textEl.fontSize > format.width * 0.07 * 2.83) {
      textEl.content = projectName;
    }
  }

  // 替换完再把整页文字标成固定，避免全局标题样式改到封面
  for (const el of elements) {
    if (el.type === 'text') (el as TextElement).fixed = true;
  }

  return {
    id: generateId(),
    background: background ?? { type: 'color', value: '#ffffff' },
    elements,
    templateId: template.id,
    doodle,
  };
}

/** 尾页：尾页2同款，文字原样保留（{year} 由 applyTemplate 替换） */
function createAtmosphereEndingPage(
  format: BookFormat,
  imageId: string,
  themeId: string,
  bodyFontSize: number
): Page {
  const template = getAtmosphereEndingTemplate();
  if (!template) return blankPage();

  const { elements, doodle, background } = applyTemplate(
    template,
    format,
    imageId ? [imageId] : [],
    themeId,
    bodyFontSize,
    undefined,
    { preserveText: true, forceFixedText: true }
  );

  return {
    id: generateId(),
    background: background ?? { type: 'color', value: '#ffffff' },
    elements,
    templateId: template.id,
    doodle,
  };
}
