import type { Project, Page, BookFormat, Element, TextElement, AlbumStyleId } from '@/types';
import { TEMPLATES, applyTemplate, type TemplateDefinition } from '@/templates';
import { THEMES, randomPick, getThemeById, type Theme } from '@/templates/themes';
import { generateId } from '@/utils/units';
import { DEFAULT_BODY_FONT_SIZE } from '@/utils/bodyText';
import { spreadGroups } from '@/utils/spread';

/**
 * 智能生成相册（v2）
 *
 * 2026-10-17 按她的要求重写：
 * - 封面页逻辑不变
 * - 一对跨页（左右两页）照片总数最多 8 张
 * - 单图页有四个模板参与轮换（满版、上图下文、上文下图、左图右文）；
 *   满版图没有文案填充，必须和 ≥4 张照片的页面配对，避免整个跨页太空
 * - 6 图模板加入轮换
 * - 比较满的排版（四图网格、四图杂志风、五图拼贴、双图横板）
 *   暂时不参与智能排版，只在模板面板里供手动选用（名单见 AUTO_LAYOUT_EXCLUDED_TEMPLATE_IDS）
 * - 九宫格在照片超过 45 张时启用，固定放正文最后那一对，和一张满版图配对
 * - 照片按横竖比例分配图位，画面分量高的照片进大图位
 * - 模板整本轮换：同一对、相邻页不重复
 * - 禁组排除：FORBIDDEN_SPREAD_PAIRS 里的模板组合不会出现在同一个跨页上
 * - 疏密配比：同一对的两页尽量一页留白多、一页留白少（差 ≥10 个百分点，软约束）
 *
 * 页面节奏不再固定「多图页 + 单图页」，而是先按「一对」规划：
 * 每一对 = 跨页左右两页（或封面/尾页旁边的落单页），先定照片总数再拆成两页。
 * 配对规则直接复用预览页/双面导出的 spreadGroups，三处永远是同一套。
 */

/** 智能排版用的照片信息（创建页在生成前算好，只活在内存里，不落盘） */
export interface AutoPhoto {
  id: string;
  width: number;
  height: number;
  /** 画面分量 0-1（utils/photoAnalysis 算出来的），缺省按 0.5 */
  weight?: number;
}

export interface AutoLayoutOptions {
  projectName: string;
  themeId: string;
  photos: AutoPhoto[];
  format: BookFormat;
  /** 正文字号（pt），默认 13（DEFAULT_BODY_FONT_SIZE） */
  bodyFontSize?: number;
  /** 是否生成封面页 */
  includeCover: boolean;
  /** 是否生成结尾页 */
  includeEnding: boolean;
  /** 相册风格（默认 classic）；atmosphere 的模板还没做，先拦下 */
  styleId?: AlbumStyleId;
}

/** 已使用的文案记录，避免重复 */
interface UsedTexts {
  pageTitles: Set<string>;
  paragraphs: Set<string>;
  shortParagraphs: Set<string>;
}

/** 单页最多放几张（普通页面） */
const MAX_NORMAL_COUNT = 6;
/** 落单页（封面/尾页旁边没有配对的那页）最多放几张 —— 6 图页只留给成对的跨页，避免六图模板重复出现 */
const MAX_LONE_COUNT = 5;
/** 九宫格模板的张数（1 张头像 + 9 格） */
const NINE_GRID_COUNT = 10;
/** 照片超过这个数（>45，即 46 张起）才启用九宫格，一本最多一次 */
const NINE_GRID_MIN_PHOTOS = 45;
/** 一对跨页左右加起来最多几张（九宫格那一对除外） */
const MAX_PHOTOS_PER_SPREAD = 8;
/** 同一跨页两页留白率的最小差距（10 个百分点），达不到就算了（软约束） */
const MIN_SPREAD_CONTRAST = 0.1;
/**
 * 规划页数时平均一页想放几张。
 * 2.5 是折中：比旧的「一页多图 + 一页满版」（约 2 张/页）紧凑一点，
 * 又不至于整本都是密密麻麻的拼贴页。
 */
const TARGET_PHOTOS_PER_PAGE = 2.5;
/** 相册有这么多张照片时，安排一页 6 图（否则页距太密，小相册放不下） */
const SIX_GRID_MIN_PHOTOS = 12;

/**
 * 暂时不参与智能排版的模板 —— 统一放这一份名单，只在模板面板里手动选用，
 * 之后另有设计计划。想重新启用某款：从这里删掉对应 id 即可。
 * 九宫格已从名单里移出（>40 张时启用、放正文最后一对、配满版图）；
 * 若以后想再停用，把它加回来，连带的「10+1 特殊配对」也会一起跳过（见 planContentPages）。
 */
const AUTO_LAYOUT_EXCLUDED_TEMPLATE_IDS = new Set<string>([
  'two-images-stack',    // 双图横板
  'four-grid',           // 四图网格
  'four-magazine',       // 四图杂志风（本来就不参与）
  'five-collage',        // 五图拼贴
]);

/**
 * 左右双页不能同时出现的模板组合（2026-10-17 她说这两组放在同一个跨页上不好看）。
 * 只约束同一对里的两页，不影响前后页；改模板时记得和 TEMPLATES_BY_COUNT 里的中文名核对。
 */
const FORBIDDEN_SPREAD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['three-collage', 'three-title-top'],     // 三图拼贴 + 三图顶标题底正文
  ['two-images-slanted', 'six-grid-slow'],  // 双图留白 + 六图慢递
];

/**
 * 每个图片数量对应的模板列表 —— 键必须和模板真实的图位数量一致。
 * 用别的张数（7、8、9）会找不到模板；getTemplateCandidates 还会再按
 * 模板里真实的 image 元素数量核一遍，防止列表和模板对不上时丢照片。
 * 在这里保留全部模板的映射，实际候选由 AUTO_LAYOUT_EXCLUDED_TEMPLATE_IDS 过滤。
 */
const TEMPLATES_BY_COUNT: Record<number, string[]> = {
  1: [
    'full-image-bordered',      // 满版图（无文案，必须和 ≥4 张的页面配对）
    'image-top-text-bottom',    // 上图下文
    'text-top-image-bottom',    // 上文下图
    'image-left-text-right',    // 左图右文
  ],
  2: [
    'two-images-stack',    // 双图横板
    'two-images-slanted',  // 双图留白
    'dual-portrait',       // 双图竖版
  ],
  3: [
    'three-collage',       // 三图拼贴
    'three-collage-v2',    // 三图错落
    'three-top-bottom',    // 三图上下排版
    'three-stairs',        // 三图阶梯
    'three-title-top',     // 三图顶标题底正文
    'three-top-two-bottom-wide', // 三图上两下横
  ],
  4: [
    'four-grid',           // 四图网格
    'four-left3-right1',   // 四图三小一大
    'four-grid-whitespace', // 四图留白
    'four-literary',       // 四图文艺排版
    'four-magazine',       // 四图杂志风（已在上面名单里停用）
  ],
  5: [
    'five-collage',        // 五图拼贴
    'five-collage-whitespace', // 五图拼贴留白
    'five-left-right-mixed', // 五图左右混排
  ],
  6: [
    'six-grid-slow',       // 六图慢递
  ],
  10: [
    'nine-grid-avatar',    // 九宫格头像（1 张头像 + 9 张九宫格）
  ],
};

/** 模板里真实的图位数量 */
function imageSlotCount(template: TemplateDefinition): number {
  return template.elements.filter((el) => el.type === 'image').length;
}

/** 取某个张数可用的模板，并核对模板真的能放下这么多张照片 */
function getTemplateCandidates(count: number): TemplateDefinition[] {
  const ids = TEMPLATES_BY_COUNT[count] ?? [];
  return ids
    .filter((id) => !AUTO_LAYOUT_EXCLUDED_TEMPLATE_IDS.has(id))
    .map((id) => TEMPLATES.find((t) => t.id === id))
    .filter((t): t is TemplateDefinition => t !== undefined && imageSlotCount(t) === count);
}

/**
 * 正文页在书里怎么两两配对：返回每一组包含的正文页序号（1 页或 2 页）。
 * 直接跑 spreadGroups，和预览页翻书、双面导出的规则完全一致：
 * [0]（封面）、[1,2]、[3,4]…，总页数为偶数时末页单独在左。
 */
function contentPairings(
  contentPages: number,
  includeCover: boolean,
  includeEnding: boolean
): number[][] {
  const fixed = (includeCover ? 1 : 0) + (includeEnding ? 1 : 0);
  const offset = includeCover ? 1 : 0;
  const groups: number[][] = [];
  for (const group of spreadGroups(fixed + contentPages)) {
    const slots = group
      .map((absoluteIndex) => absoluteIndex - offset)
      .filter((slot) => slot >= 0 && slot < contentPages);
    if (slots.length > 0) groups.push(slots);
  }
  return groups;
}

/**
 * 一组配对能放下的照片数范围。
 * 相册 ≥12 张时会强制其中一对做六图页（6+1 或 6+2，即 7~8 张），
 * 这一对的下限要按 7 算；否则算出来的页数刚好把照片分完，六图页就塞不进去了。
 */
function capacityOfUnits(
  units: number[][],
  reserveSixGrid: boolean
): { min: number; max: number } {
  let min = 0;
  let max = 0;
  let sixGridReserved = false;
  for (const unit of units) {
    if (unit.length === 2) {
      if (reserveSixGrid && !sixGridReserved) {
        min += MAX_NORMAL_COUNT + 1;
        max += MAX_PHOTOS_PER_SPREAD;
        sixGridReserved = true;
      } else {
        min += 2;
        max += MAX_PHOTOS_PER_SPREAD;
      }
    } else {
      min += 1;
      max += MAX_LONE_COUNT;
    }
  }
  return { min, max };
}

/**
 * 选正文页数：按目标密度算，再保证照片放得下、总页数和封面/结尾配成偶数。
 * 返回 -1 表示这个张数凑不出来，由调用方兜底。
 */
function chooseContentPageCount(
  photoCount: number,
  includeCover: boolean,
  includeEnding: boolean
): number {
  const fixedParity = ((includeCover ? 1 : 0) + (includeEnding ? 1 : 0)) % 2;
  const target = photoCount / TARGET_PHOTOS_PER_PAGE;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let pageCount = 1; pageCount <= photoCount; pageCount++) {
    // 总页数必须是偶数（否则结尾页会和前一页挤在一个跨页里）
    if (pageCount % 2 !== fixedParity) continue;

    const units = contentPairings(pageCount, includeCover, includeEnding);
    const reserveSixGrid =
      photoCount >= SIX_GRID_MIN_PHOTOS && units.some((unit) => unit.length === 2);
    const { min: minPhotos, max: maxPhotos } = capacityOfUnits(units, reserveSixGrid);
    if (photoCount < minPhotos || photoCount > maxPhotos) continue;

    const score = Math.abs(pageCount - target);
    // 平手取页数少的：照片更集中，满版单图页不会太多
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) < 1e-9 && pageCount < best)) {
      best = pageCount;
      bestScore = score;
    }
  }
  return best;
}

/** 一对跨页里两张照片数的「无序组合」key，用来避免连续两对用同一种拆分 */
function splitKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

/**
 * 把一个跨页的照片总数拆成两页张数（每页 1-6 张）。
 * `allowSix` 为 false 时不再拆出 6 图页 —— 一本相册只留一页六图，
 * 因为六图模板只有一个，多出现几次会明显重复。
 */
function splitPairSum(sum: number, lastKey: string, allowSix: boolean): [number, number] {
  const options: { a: number; b: number; weight: number; key: string }[] = [];
  // 只生成无序组合，左右顺序由调用方随机
  for (let a = 1; a <= Math.floor(sum / 2); a++) {
    const b = sum - a;
    if (b < 1 || b > MAX_NORMAL_COUNT) continue;
    if (!allowSix && b === MAX_NORMAL_COUNT) continue;
    const key = splitKey(a, b);
    let weight = 1;
    // 一页满版 + 一页多图，视觉上更有呼吸感
    if (a === 1) weight = 1.2;
    if (a === b) weight = 0.7;
    // 刚用过同一种拆分就降低权重，别一排都是「3+2」
    if (key === lastKey) weight *= 0.3;
    options.push({ a, b, weight, key });
  }

  const total = options.reduce((sumWeight, option) => sumWeight + option.weight, 0);
  let roll = Math.random() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return [option.a, option.b];
  }
  const fallback = options[options.length - 1];
  return [fallback.a, fallback.b];
}

interface PlannedPageCount {
  count: number;
  /** 同一对（跨页）里的页面共用一个 unit，用来避免一对里出现同一个模板 */
  unit: number;
  /** 这一页固定用满版图模板（九宫格那一对的配对页） */
  forceFullImage?: boolean;
}

/**
 * 规划正文每页放几张照片。
 *
 * 流程：
 * 1. 先看要不要安排九宫格（>45 张，一本一次），它固定占正文最后那一对
 *    （10 张 + 1 张满版图）；九宫格在 AUTO_LAYOUT_EXCLUDED_TEMPLATE_IDS 里时这条规则整个跳过
 * 2. 按目标密度定正文页数，并把页面按 spreadGroups 配成一对一对
 * 3. 相册 ≥12 张时，挑一对固定放一张 6 图页（6+1 或 6+2），保证 6 图模板能轮到
 * 4. 其余每一对在「两张之和 2~8」的前提下分配张数，最后算出每页张数
 */
function planContentPages(
  photoCount: number,
  includeCover: boolean,
  includeEnding: boolean
): PlannedPageCount[] | null {
  // ===== 1. 选页数（九宫格 >45 张时安排）=====
  // 九宫格若被放回暂停名单，它的「10+1 特殊配对」也一起跳过
  const nineGridEnabled = !AUTO_LAYOUT_EXCLUDED_TEMPLATE_IDS.has('nine-grid-avatar');
  let useNineGrid = false;
  let basePageCount = -1;
  if (nineGridEnabled && photoCount > NINE_GRID_MIN_PHOTOS) {
    const restCount = chooseContentPageCount(
      photoCount - NINE_GRID_COUNT - 1,
      includeCover,
      includeEnding
    );
    if (restCount > 0) {
      // 九宫格自己占一对，所以正文比剩下的照片多 2 页
      const units = contentPairings(restCount + 2, includeCover, includeEnding);
      if (units.some((unit) => unit.length === 2)) {
        useNineGrid = true;
        basePageCount = restCount;
      }
    }
  }
  if (!useNineGrid) {
    basePageCount = chooseContentPageCount(photoCount, includeCover, includeEnding);
  }
  if (basePageCount <= 0) return null;

  const contentPageCount = basePageCount + (useNineGrid ? 2 : 0);
  const units = contentPairings(contentPageCount, includeCover, includeEnding);
  const pairUnits = units
    .map((unit, index) => (unit.length === 2 ? index : -1))
    .filter((index) => index >= 0);

  // ===== 2. 固定张数的特殊页 =====
  // 九宫格固定放在正文最后一对（相册靠后的位置），另一页固定用满版图配对
  const nineGridUnit = useNineGrid ? pairUnits[pairUnits.length - 1] : -1;

  // 6 图页：随机挑一对（避开九宫格），固定成 6+1 或 6+2。
  // 位置随机而不是永远放第一对 —— 否则每本相册的六图页都在最前面，翻两本就看出规律了。
  const sixGridCandidates = pairUnits.filter((index) => index !== nineGridUnit);
  const sixGridUnit =
    photoCount >= SIX_GRID_MIN_PHOTOS && sixGridCandidates.length > 0
      ? randomPick(sixGridCandidates)
      : -1;

  const forcedSums = new Map<number, number>();
  if (nineGridUnit >= 0) forcedSums.set(nineGridUnit, NINE_GRID_COUNT + 1);
  // 先按 8 张预占（6+2），实际分配时 7 或 8 哪个放得下就用哪个。
  // 预占是为了算前面页面的平均值时先把这一对的份额扣掉。
  if (sixGridUnit >= 0) forcedSums.set(sixGridUnit, MAX_PHOTOS_PER_SPREAD);

  // ===== 3. 每对 / 每页能装几张 =====
  const caps = units.map((unit, index) => {
    if (index === nineGridUnit) return { min: NINE_GRID_COUNT + 1, max: NINE_GRID_COUNT + 1 };
    // 六图页那一对先钉死 7~8 张，前面的页不许把它的照片吃到只剩 5 张
    if (index === sixGridUnit) return { min: MAX_NORMAL_COUNT + 1, max: MAX_PHOTOS_PER_SPREAD };
    if (unit.length === 2) return { min: 2, max: MAX_PHOTOS_PER_SPREAD };
    return { min: 1, max: MAX_LONE_COUNT };
  });

  // 后面的单元至少 / 最多还能装几张，用来看这一步能拿多少
  const minAfter = new Array(units.length + 1).fill(0);
  const maxAfter = new Array(units.length + 1).fill(0);
  // 后面固定张数（九宫格、六图页）已经占掉的份额，分普通页时先扣掉，
  // 免得前面的页把照片吃光、后面的页只能拿最低张数（出现一串「1+1」）
  const fixedAfter = new Array(units.length + 1).fill(0);
  const normalAfter = new Array(units.length + 1).fill(0);
  for (let i = units.length - 1; i >= 0; i--) {
    minAfter[i] = minAfter[i + 1] + caps[i].min;
    maxAfter[i] = maxAfter[i + 1] + caps[i].max;
    const fixedSum = forcedSums.get(i);
    fixedAfter[i] = fixedAfter[i + 1] + (fixedSum ?? 0);
    normalAfter[i] = normalAfter[i + 1] + (fixedSum === undefined ? 1 : 0);
  }

  // ===== 4. 逐对分配照片 =====
  const unitCounts: number[][] = [];
  let remaining = photoCount;
  let lastSplitKey = '';
  let sixGridUsed = false;

  for (let i = 0; i < units.length; i++) {
    const cap = caps[i];
    const lo = Math.max(cap.min, remaining - maxAfter[i + 1]);
    const hi = Math.min(cap.max, remaining - minAfter[i + 1]);
    const forced = forcedSums.get(i);
    // 六图页 6+1（7 张）和 6+2（8 张）都行，哪个落在可行区间里就用哪个
    const sixGridSums =
      i === sixGridUnit && !sixGridUsed
        ? [8, 7].filter((value) => value >= lo && value <= hi)
        : [];
    const forcedSum = sixGridSums.length > 0 ? randomPick(sixGridSums) : forced;
    let sum: number;

    if (forcedSum !== undefined && forcedSum >= lo && forcedSum <= hi) {
      sum = forcedSum;
    } else {
      // 按「扣掉后面固定页之后」的平均值取整，偶尔 ±1 制造节奏变化
      const normalUnits = normalAfter[i + 1] + 1;
      const average = (remaining - fixedAfter[i + 1]) / normalUnits;
      const jitter = Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      sum = Math.min(hi, Math.max(lo, Math.round(average + jitter)));
    }

    if (units[i].length === 2) {
      if (i === nineGridUnit && sum === NINE_GRID_COUNT + 1) {
        unitCounts.push(Math.random() < 0.5 ? [NINE_GRID_COUNT, 1] : [1, NINE_GRID_COUNT]);
      } else if (
        i === sixGridUnit &&
        !sixGridUsed &&
        (sum === 7 || sum === 8)
      ) {
        sixGridUsed = true;
        const other = sum - MAX_NORMAL_COUNT;
        unitCounts.push(
          Math.random() < 0.5 ? [MAX_NORMAL_COUNT, other] : [other, MAX_NORMAL_COUNT]
        );
      } else {
        const [a, b] = splitPairSum(sum, lastSplitKey, !sixGridUsed);
        if (a === MAX_NORMAL_COUNT || b === MAX_NORMAL_COUNT) sixGridUsed = true;
        lastSplitKey = splitKey(a, b);
        unitCounts.push(Math.random() < 0.5 ? [a, b] : [b, a]);
      }
    } else {
      unitCounts.push([sum]);
    }

    remaining -= sum;
  }

  const planned: PlannedPageCount[] = [];
  unitCounts.forEach((counts, unit) => {
    counts.forEach((count) => {
      planned.push({
        count,
        unit,
        // 九宫格那一对里的单图页固定用满版图配对
        forceFullImage: unit === nineGridUnit && count === 1,
      });
    });
  });
  return planned;
}

/** 这个模板和同一对里已经选好的模板，是不是 FORBIDDEN_SPREAD_PAIRS 里的禁组 */
function formsForbiddenPair(id: string, usedInUnit: Set<string>): boolean {
  return FORBIDDEN_SPREAD_PAIRS.some(
    ([a, b]) => (a === id && usedInUnit.has(b)) || (b === id && usedInUnit.has(a))
  );
}

/** 某页可选的模板（含满版图限制），选模板和「看一步」共用同一份 */
function getPageCandidates(count: number, allowFullImage: boolean): TemplateDefinition[] {
  const all = getTemplateCandidates(count);
  // 满版图没有文案，单独一页会显得空：只能配 ≥4 张照片的另一页。
  // 1+1 / 1+2 / 1+3 这种小跨页改用带文字的「一图」模板。
  const candidates = allowFullImage ? all : all.filter((t) => t.id !== 'full-image-bordered');
  if (candidates.length === 0) {
    throw new Error(`没有可用的 ${count} 图模板`);
  }
  return candidates;
}

/**
 * 模板的留白率（0-1）：图片和文字元素占的面积之外的部分。
 * 元素都是相对坐标，直接加面积就行，跟开本无关；用于「一页疏、一页密」的配比。
 */
function whitespaceRatio(template: TemplateDefinition): number {
  let content = 0;
  for (const el of template.elements) {
    if (el.type === 'image' || el.type === 'text') {
      content += el.width * el.height;
    }
  }
  return 1 - content;
}

/**
 * 落单页（封面/尾页旁边没有配对的页）按「整本用得最少」挑模板：
 * - 不和上一页重复
 * - 同等条件下随机，保证每次生成不完全一样
 */
function pickTemplate(
  candidates: TemplateDefinition[],
  lastTemplateId: string | undefined,
  usage: Map<string, number>
): TemplateDefinition {
  const filters: ((template: TemplateDefinition) => boolean)[] = [
    (template) => template.id !== lastTemplateId,
    () => true,
  ];

  let pool = candidates;
  for (const filter of filters) {
    const filtered = candidates.filter(filter);
    if (filtered.length > 0) {
      pool = filtered;
      break;
    }
  }

  const minUsage = Math.min(...pool.map((template) => usage.get(template.id) ?? 0));
  const leastUsed = pool.filter((template) => (usage.get(template.id) ?? 0) === minUsage);
  const chosen = randomPick(leastUsed);
  usage.set(chosen.id, (usage.get(chosen.id) ?? 0) + 1);
  return chosen;
}

/**
 * 一对跨页的两页一起挑模板（2026-10-17 她要「一页疏、一页密」的配比）：
 * - 硬约束（逐级放松）：同一对里不重复 → 左页不撞上一跨页的右页 → 最后才放禁组
 * - 软约束：两页留白率差 ≥ MIN_SPREAD_CONTRAST 的组合优先，拉不开就全部参与
 * - 多样性：整本用得最少的组合里随机挑一对
 *
 * 只挑模板、不动 usage 计数，由调用方统一加。
 */
function pickTemplatePair(
  candidatesA: TemplateDefinition[],
  candidatesB: TemplateDefinition[],
  lastTemplateId: string | undefined,
  usage: Map<string, number>
): [TemplateDefinition, TemplateDefinition] {
  const pairs: Array<[TemplateDefinition, TemplateDefinition]> = [];
  for (const a of candidatesA) {
    for (const b of candidatesB) {
      if (a.id === b.id) continue;
      if (formsForbiddenPair(a.id, new Set([b.id]))) continue;
      pairs.push([a, b]);
    }
  }
  // 理论上到不了这里（目前没有任何一对的两页都只有一个且相同的候选）；
  // 保险起见按「重复 > 禁组」的顺序放松，跟旧逻辑的优先级一致
  if (pairs.length === 0) {
    for (const a of candidatesA) {
      for (const b of candidatesB) {
        if (!formsForbiddenPair(a.id, new Set([b.id]))) pairs.push([a, b]);
      }
    }
  }
  if (pairs.length === 0) {
    for (const a of candidatesA) {
      for (const b of candidatesB) {
        pairs.push([a, b]);
      }
    }
  }

  const filters: Array<(pair: [TemplateDefinition, TemplateDefinition]) => boolean> = [
    ([a]) => a.id !== lastTemplateId,
    () => true,
  ];
  let pool = pairs;
  for (const filter of filters) {
    const filtered = pairs.filter(filter);
    if (filtered.length > 0) {
      pool = filtered;
      break;
    }
  }

  // 软约束：留白差 ≥ 10 个百分点的组合优先；一个都没有就全都要（尽力就行）
  const contrast = pool.filter(
    ([a, b]) => Math.abs(whitespaceRatio(a) - whitespaceRatio(b)) >= MIN_SPREAD_CONTRAST
  );
  if (contrast.length > 0) pool = contrast;

  const scores = pool.map(([a, b]) => (usage.get(a.id) ?? 0) + (usage.get(b.id) ?? 0));
  const minScore = Math.min(...scores);
  const best = pool.filter((_, index) => scores[index] === minScore);
  return randomPick(best);
}

/** cover 模式下这张照片放进这个图位要裁掉多少（0 = 一点都不用裁） */
function cropLoss(photoAspect: number, slotAspect: number): number {
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
function orderPhotosForTemplate(
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

/**
 * 从主题中获取不重复的页面标题
 */
function getUniquePageTitle(theme: Theme, used: UsedTexts): string {
  const available = theme.pageTitles.filter((t) => !used.pageTitles.has(t));
  if (available.length === 0) {
    used.pageTitles.clear();
    return randomPick(theme.pageTitles);
  }
  const title = randomPick(available);
  used.pageTitles.add(title);
  return title;
}

/**
 * 从主题中获取不重复的正文文案
 */
function getUniqueParagraph(theme: Theme, used: UsedTexts): string {
  const available = theme.paragraphs.filter((t) => !used.paragraphs.has(t));
  if (available.length === 0) {
    used.paragraphs.clear();
    return randomPick(theme.paragraphs);
  }
  const text = randomPick(available);
  used.paragraphs.add(text);
  return text;
}

/** 短正文（一行短句），给空间小的文字框用 */
function getUniqueShortParagraph(theme: Theme, used: UsedTexts): string {
  const available = theme.shortParagraphs.filter((t) => !used.shortParagraphs.has(t));
  if (available.length === 0) {
    used.shortParagraphs.clear();
    return randomPick(theme.shortParagraphs);
  }
  const text = randomPick(available);
  used.shortParagraphs.add(text);
  return text;
}

/**
 * 自动生成电子相册
 */
export function autoGenerateAlbum(options: AutoLayoutOptions): Project {
  const {
    projectName,
    themeId,
    photos,
    format,
    bodyFontSize = DEFAULT_BODY_FONT_SIZE,
    includeCover,
    includeEnding,
    styleId = 'classic',
  } = options;

  // 氛围感设计的模板还没做：先明确拦下，别生成出挂着 atmosphere 标签的经典排版
  if (styleId === 'atmosphere') {
    throw new Error('氛围感设计的模板还在制作中，先选「经典图文排版」吧');
  }
  const theme = getThemeById(themeId) || THEMES[0];
  const used: UsedTexts = {
    pageTitles: new Set(),
    paragraphs: new Set(),
    shortParagraphs: new Set(),
  };

  const pages: Page[] = [];

  // ========== 1. 封面页（逻辑不变） ==========
  if (includeCover) {
    pages.push(createCoverPage(projectName, format, photos[0]?.id ?? ''));
  }

  // ========== 2. 正文页：按「一对」规划 ==========
  const plan = photos.length > 0
    ? planContentPages(photos.length, includeCover, includeEnding)
    : null;

  if (plan) {
    const usage = new Map<string, number>();
    let lastTemplateId: string | undefined;
    let photoIndex = 0;

    // 同一对里另一页放几张，用来判断满版图能不能用
    const countsByUnit = new Map<number, number[]>();
    const entriesByUnit = new Map<number, PlannedPageCount[]>();
    for (const planned of plan) {
      const counts = countsByUnit.get(planned.unit) ?? [];
      counts.push(planned.count);
      countsByUnit.set(planned.unit, counts);
      const entries = entriesByUnit.get(planned.unit) ?? [];
      entries.push(planned);
      entriesByUnit.set(planned.unit, entries);
    }

    // 每页的候选模板提前算好，同一对的两页一起选模板时用同一份
    const entryCandidates = new Map<PlannedPageCount, TemplateDefinition[]>();
    for (const planned of plan) {
      const unitCounts = countsByUnit.get(planned.unit) ?? [];
      let siblingCount: number | null = null;
      if (unitCounts.length === 2) {
        siblingCount = planned.count === unitCounts[0] ? unitCounts[1] : unitCounts[0];
      }
      // 只有 1 张照片的页面：另一页有 ≥4 张才允许用满版图（满版没有文案，
      // 小跨页里会显得空）；落单页旁边是封面/尾页，不受这个限制
      const allowFullImage = planned.count !== 1 || siblingCount === null || siblingCount >= 4;
      entryCandidates.set(planned, getPageCandidates(planned.count, allowFullImage));
    }

    const makePage = (template: TemplateDefinition, pagePhotos: AutoPhoto[]): Page => {
      const orderedIds = orderPhotosForTemplate(template, pagePhotos, format);
      const elements = applyTemplate(template, format, orderedIds, themeId, bodyFontSize);
      // 满版图没有文字元素，这一步对它自然是空操作；带文案的单图模板要填
      fillTextElements(elements, theme, used, format);
      return {
        id: generateId(),
        background: { type: 'color', value: '#ffffff' },
        elements,
        templateId: template.id,
      };
    };

    // 按「一对」为单位推进：同一对的两页一起挑模板（一疏一密），
    // 落单页（封面/尾页旁边）没有配对，走单页规则
    for (const unitEntries of entriesByUnit.values()) {
      const [entryA, entryB] = unitEntries;

      if (!entryB) {
        const pagePhotos = photos.slice(photoIndex, photoIndex + entryA.count);
        photoIndex += entryA.count;
        const template = pickTemplate(entryCandidates.get(entryA)!, lastTemplateId, usage);
        pages.push(makePage(template, pagePhotos));
        lastTemplateId = template.id;
        continue;
      }

      const pagePhotosA = photos.slice(photoIndex, photoIndex + entryA.count);
      photoIndex += entryA.count;
      const pagePhotosB = photos.slice(photoIndex, photoIndex + entryB.count);
      photoIndex += entryB.count;

      // 九宫格那一对的单图页固定配满版图，不参与轮换
      const forcedA = entryA.forceFullImage
        ? getTemplateCandidates(entryA.count).find((t) => t.id === 'full-image-bordered')
        : undefined;
      const forcedB = entryB.forceFullImage
        ? getTemplateCandidates(entryB.count).find((t) => t.id === 'full-image-bordered')
        : undefined;
      const [templateA, templateB] = pickTemplatePair(
        forcedA ? [forcedA] : entryCandidates.get(entryA)!,
        forcedB ? [forcedB] : entryCandidates.get(entryB)!,
        lastTemplateId,
        usage
      );
      usage.set(templateA.id, (usage.get(templateA.id) ?? 0) + 1);
      usage.set(templateB.id, (usage.get(templateB.id) ?? 0) + 1);

      pages.push(makePage(templateA, pagePhotosA));
      pages.push(makePage(templateB, pagePhotosB));
      lastTemplateId = templateB.id;
    }
  } else if (photos.length > 0) {
    // 只有 1 张照片：凑不出一对，放一页满版；页数奇偶最后统一兜底
    const template = getTemplateCandidates(1)[0];
    const elements = applyTemplate(template, format, [photos[0].id], themeId, bodyFontSize);
    pages.push({
      id: generateId(),
      background: { type: 'color', value: '#ffffff' },
      elements,
      templateId: template.id,
    });
  }

  // ========== 3. 结尾页（逻辑不变） ==========
  if (includeEnding && pages.length > 0) {
    const lastImageId = photos.length > 0 ? photos[photos.length - 1].id : '';
    pages.push(createEndingPage(format, lastImageId));
  }

  // 确保至少有一页
  if (pages.length === 0) {
    pages.push({
      id: generateId(),
      background: { type: 'color', value: '#ffffff' },
      elements: [],
    });
  }

  // 兜底：整本页数必须是偶数，否则翻到最后结尾页会和前一页挤在一个跨页里
  // （正常规划不会走到这里，只有 1 张照片这种凑不出一对的极端情况才需要补一页）
  if (pages.length % 2 !== 0) {
    pages.push({
      id: generateId(),
      background: { type: 'color', value: '#ffffff' },
      elements: [],
    });
  }

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
    styleId,
  };
}

/**
 * 创建封面页（杂志风格）
 */
function createCoverPage(projectName: string, format: BookFormat, imageId: string): Page {
  const elements = [];

  // 用旅行杂志封面模板，第一张图片做背景
  const template = TEMPLATES.find((t) => t.id === 'cover-travel-journal')!;
  const templateElements = applyTemplate(template, format, [imageId]);

  // 填充封面文案：只填大标题，其他文字保持模板默认内容
  for (const el of templateElements) {
    if (el.type === 'text') {
      const textEl = el as TextElement;
      // 固定文字直接跳过，不填充
      if (textEl.fixed) continue;
      // 只有不是固定文字的大标题，才用项目名填充
      if (textEl.fontSize > format.width * 0.07 * 2.83) {
        textEl.content = projectName;
      }
    }
  }
  elements.push(...templateElements);

  return {
    id: generateId(),
    background: { type: 'color', value: '#ffffff' },
    elements,
    templateId: 'cover-travel-journal',
  };
}

/**
 * 创建结尾页：尾页2（原「页尾（未完待续）」）——居中照片 + 未完待续 + 年份。
 * 年份占位符 {year} 由 applyTemplate 替换成当前年份，文字保持模板原样。
 */
function createEndingPage(format: BookFormat, lastImageId?: string): Page {
  const template = TEMPLATES.find((t) => t.id === 'ending-minimal')!;
  const elements = applyTemplate(template, format, lastImageId ? [lastImageId] : []);

  return {
    id: generateId(),
    background: { type: 'color', value: '#faf8f5' },
    elements,
    templateId: 'ending-minimal',
  };
}

/**
 * 填充模板中的文字元素
 */
function fillTextElements(elements: Element[], theme: Theme, used: UsedTexts, format: BookFormat) {
  for (const el of elements) {
    if (el.type !== 'text') continue;
    const textEl = el as TextElement;
    // 固定文字（比如装饰小标签）保持原样，不填充
    if (textEl.fixed) continue;

    // 正文标记优先：短正文取一行短句（文字框小，长正文会撑出去），
    // 普通正文取长文案；没标的按字号是否到标题线判标题；
    // 都不是的（装饰小字、短标签）不动
    if (textEl.shortBody) {
      textEl.content = getUniqueShortParagraph(theme, used);
    } else if (textEl.body) {
      textEl.content = getUniqueParagraph(theme, used);
    } else if (textEl.fontSize > format.width * 0.04 * 2.83) {
      textEl.content = getUniquePageTitle(theme, used);
    }
  }
}
