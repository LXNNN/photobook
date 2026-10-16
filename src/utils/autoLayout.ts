import type { Project, Page, BookFormat, Element, ImageElement, TextElement } from '@/types';
import { TEMPLATES, applyTemplate } from '@/templates';
import { THEMES, randomPick, getThemeById, type Theme } from '@/templates/themes';
import { generateId } from '@/utils/units';
import { DEFAULT_BODY_FONT_SIZE } from '@/utils/bodyText';

export interface AutoLayoutOptions {
  projectName: string;
  themeId: string;
  imageIds: string[];
  format: BookFormat;
  /** 每页最多几张图（1-4） */
  maxImagesPerPage: number;
  /** 正文字号（pt），默认 13（DEFAULT_BODY_FONT_SIZE） */
  bodyFontSize?: number;
  /** 是否生成封面页 */
  includeCover: boolean;
  /** 是否生成结尾页 */
  includeEnding: boolean;
}

/**
 * 已使用的文案记录，避免重复
 */
interface UsedTexts {
  pageTitles: Set<string>;
  paragraphs: Set<string>;
}

/**
 * 正文一页能放的图片张数 —— 必须和 TEMPLATES_BY_COUNT 的键一致。
 * 用别的张数（6、7、8、9）会找不到模板、退回单图模板，多出来的照片就被静默丢掉。
 */
const VALID_PHOTO_COUNTS = [1, 2, 3, 4, 5, 10];

/**
 * 每个图片数量对应的模板列表
 */
const TEMPLATES_BY_COUNT: Record<number, string[]> = {
  1: [
    'image-top-text-bottom', // 上图下文
    'text-top-image-bottom', // 上文下图
    'image-left-text-right', // 左图右文
    'text-left-image-right', // 左文右图
  ],
  2: [
    // 这里以前还列了「左图右文 / 左文右图」，但那两个模板只有 1 个图位，
    // 2 张图塞进去会有一张被静默丢掉（照片就少了一张）
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
    'four-grid',           // 四宫格
    'four-magazine',       // 四图杂志风
    'four-left3-right1',   // 四图三小一大
    'four-grid-whitespace', // 四图留白
    'four-literary',       // 四图文艺排版
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
    'nine-grid-avatar',    // 九宫格头像（1张头像 + 9张九宫格）
  ],
};

/**
 * 根据图片数量随机选一个模板，避免和上一页重复
 */
function pickTemplateByImageCount(count: number, lastTemplateId?: string): string {
  const templates = TEMPLATES_BY_COUNT[count] || TEMPLATES_BY_COUNT[1];
  // 如果只有一个模板，直接返回
  if (templates.length === 1) {
    return templates[0];
  }
  // 过滤掉和上一页相同的模板
  const available = templates.filter(t => t !== lastTemplateId);
  // 从可用模板里随机选一个
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * 从主题中获取不重复的页面标题
 */
function getUniquePageTitle(theme: Theme, used: UsedTexts): string {
  const available = theme.pageTitles.filter((t) => !used.pageTitles.has(t));
  if (available.length === 0) {
    // 用完了就重置
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

/**
 * 自动生成电子相册
 */
export function autoGenerateAlbum(options: AutoLayoutOptions): Project {
  const { projectName, themeId, imageIds, format, maxImagesPerPage, bodyFontSize = DEFAULT_BODY_FONT_SIZE, includeCover, includeEnding } = options;
  const theme = getThemeById(themeId) || THEMES[0];
  const used: UsedTexts = { pageTitles: new Set(), paragraphs: new Set() };

  const pages: Page[] = [];
  let imageIndex = 0;

  // ========== 1. 封面页 ==========
  if (includeCover) {
    const coverPage = createCoverPage(projectName, theme, format, imageIds, imageIndex);
    pages.push(coverPage);
    // 封面用了图片，但正文页继续从第一张图片开始（不前进 imageIndex）
  }

  // ========== 2. 内容页：交替生成「多张图页」和「单张满版图页」 ==========
  // 先把图片怎么分组算出来，再逐页生成 —— 正文页数的奇偶要按下面的规则调整，
  // 分组和生成分开写，改分组时不用去动已经生成好的页面
  const groups: { imageIds: string[]; isMultiPhotoPage: boolean }[] = [];
  {
    let isMultiPhotoPage = true; // 第一页是多张图页
    let multiPhotoCountIndex = 0; // 多图页的数量循环索引：2→3→4→5→2→3...
    // 至少15张图片才会生成九宫格头像模板（10图）
    const multiPhotoCounts = imageIds.length >= 15 ? [2, 3, 4, 5, 10] : [2, 3, 4, 5];

    while (imageIndex < imageIds.length) {
      let count: number;

      if (isMultiPhotoPage) {
        // 多图页：按 2→3→4→5 循环选数量，保证每种都有
        count = multiPhotoCounts[multiPhotoCountIndex % multiPhotoCounts.length];
        multiPhotoCountIndex++;
        // 剩下的图片不够就少放几张。张数只能用"有模板的"（1/2/3/4/5/10）：
        // 比如剩 6 张时放 6 张，找不到 6 图模板会退回单图模板，另外 5 张照片
        // 就被静默丢掉了。于是这里挑一个不超过剩余张数、且有模板的最大值
        const remaining = imageIds.length - imageIndex;
        if (count > remaining) {
          count = VALID_PHOTO_COUNTS.filter((c) => c <= remaining).pop()!;
        }
      } else {
        // 单张图页：满版图带边框，无文案
        count = 1;
      }

      groups.push({
        imageIds: imageIds.slice(imageIndex, imageIndex + count),
        isMultiPhotoPage,
      });

      imageIndex += count;
      isMultiPhotoPage = !isMultiPhotoPage; // 下一页切换类型
    }
  }

  // ---- 正文页数要和封面/结尾页搭成偶数，否则书翻到最后合不上 ----
  // 排版的节奏是「多图页 + 单图页」两两成对，但图片张数没凑好时最后会落单一个
  // 多图页（46 张图就是：最后剩一个 5 图页），整本页数变成奇数。
  // page-flip 的 showCover 布局是 [0], [1,2], [3,4], …，只有总页数是偶数时最后一页
  // 才单独占一页；奇数时结尾页会跟倒数第二页挤在同一个跨页里，翻到最后收不回来
  // （用户 2026-10-13 反馈的「相册1111」）。
  // 拆法：把落单的多图页拆成「少一张的多图页 + 单图页」—— 正好补上缺的那个
  // 单图页，页数转成偶数，节奏也还是「多图页配单图页」。
  const fixedPages = (includeCover ? 1 : 0) + (includeEnding ? 1 : 0);
  const wantEvenGroups = fixedPages % 2 === 0;
  if ((groups.length % 2 === 0) !== wantEvenGroups) {
    // 找最后一个能拆的多图页：正文奇数页时它就是最后一页，偶数页时是倒数第二页
    let at = -1;
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].isMultiPhotoPage && groups[i].imageIds.length >= 2) {
        at = i;
        break;
      }
    }
    if (at >= 0) {
      const group = groups[at];
      const count = group.imageIds.length;
      // 拆出来的张数同样得是"有模板的"：10 图页用的是九宫格头像模板，
      // 拆成 9+1 没有 9 图模板，改拆成两个 5 图页；其余拆成「N-1 张 + 1 张」，
      // 正好是一页多图配一页满版图
      const firstCount = count === 10 ? 5 : count - 1;
      groups.splice(
        at,
        1,
        { imageIds: group.imageIds.slice(0, firstCount), isMultiPhotoPage: true },
        { imageIds: group.imageIds.slice(firstCount), isMultiPhotoPage: count === 10 }
      );
    }
    // 找不到能拆的（图片太少、多图页都被截断成 1 张了）就保持原样
  }

  let lastTemplateId: string | undefined = undefined; // 上一页用的模板，避免重复

  for (const group of groups) {
    const count = group.imageIds.length;
    // 显式标注类型：不写的话 templateId 和 lastTemplateId 会互相引用，TS 推不出来
    const templateId: string = group.isMultiPhotoPage
      ? pickTemplateByImageCount(count, lastTemplateId)
      : 'full-image-bordered';

    const template = TEMPLATES.find((t) => t.id === templateId)!;
    const elements = applyTemplate(template, format, group.imageIds, themeId, bodyFontSize);

    // 填充文案（单张满版图页不填文案）
    if (group.isMultiPhotoPage) {
      fillTextElements(elements, theme, used, format);
    }

    pages.push({
      id: generateId(),
      background: { type: 'color', value: '#ffffff' },
      elements,
      templateId,
    });

    // 记录这一页用的模板，下一页避免重复
    lastTemplateId = templateId;
  }

  // ========== 3. 结尾页 ==========
  if (includeEnding && pages.length > 0) {
    // 用最后一张图片做结尾页背景
    const lastImageId = imageIds[imageIds.length - 1];
    const endingPage = createEndingPage(theme, format, lastImageId);
    pages.push(endingPage);
  }

  // 确保至少有一页
  if (pages.length === 0) {
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
  };
}

/**
 * 创建封面页（杂志风格）
 */
function createCoverPage(
  projectName: string,
  theme: Theme,
  format: BookFormat,
  imageIds: string[],
  imageIndex: number
): Page {
  const elements = [];

  // 用旅行杂志封面模板，第一张图片做背景
  const template = TEMPLATES.find((t) => t.id === 'cover-travel-journal')!;
  const templateElements = applyTemplate(template, format, [imageIds[imageIndex] || '']);

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
 * 创建结尾页（杂志风格）
 */
function createEndingPage(theme: Theme, format: BookFormat, lastImageId?: string): Page {
  // 用结尾寄语模板
  const template = TEMPLATES.find((t) => t.id === 'ending-page')!;
  const templateElements = applyTemplate(template, format, lastImageId ? [lastImageId] : []);

  // 填充结尾文案
  for (const el of templateElements) {
    if (el.type === 'text') {
      const textEl = el as TextElement;
      // 大标题
      if (textEl.fontSize > format.width * 0.05 * 2.83) {
        textEl.content = randomPick(['未完待续', 'THANK YOU', '下一站', 'THE END', '继续前行']);
      }
      // 正文
      else if (textEl.fontSize > format.width * 0.025 * 2.83) {
        textEl.content = randomPick(theme.endings);
      }
      // 底部英文小字
      else {
        textEl.content = randomPick(['SEE YOU', 'THANKS FOR WATCHING', 'FIN', 'TO BE CONTINUED']);
      }
    }
  }

  return {
    id: generateId(),
    background: { type: 'color', value: '#faf8f5' },
    elements: templateElements,
    templateId: 'ending-page',
  };
}

/**
 * 填充模板中的文字元素
 */
function fillTextElements(
  elements: Element[],
  theme: Theme,
  used: UsedTexts,
  format: BookFormat
) {
  for (const el of elements) {
    if (el.type !== 'text') continue;
    // 固定文字（比如装饰小标签）保持原样，不填充
    if ((el as any).fixed) continue;
    const textEl = el as TextElement;

    // 正文标记优先：标了的填正文；没标的按字号是否到标题线判标题；
    // 都不是的（装饰小字、短标签）不动
    if (textEl.body) {
      textEl.content = getUniqueParagraph(theme, used);
    } else if (textEl.fontSize > format.width * 0.04 * 2.83) {
      textEl.content = getUniquePageTitle(theme, used);
    }
  }
}
