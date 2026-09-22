import type { Project, Page, BookFormat, Element, ImageElement, TextElement } from '@/types';
import { TEMPLATES, applyTemplate } from '@/templates';
import { THEMES, randomPick, getThemeById, type Theme } from '@/templates/themes';
import { generateId } from '@/utils/units';

export interface AutoLayoutOptions {
  projectName: string;
  themeId: string;
  imageIds: string[];
  format: BookFormat;
  /** 每页最多几张图（1-4） */
  maxImagesPerPage: number;
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
 * 每个图片数量对应的模板列表
 */
const TEMPLATES_BY_COUNT: Record<number, string[]> = {
  1: [
    'image-top-text-bottom', // 上图下文
    'image-left-text-right', // 左图右文
    'text-left-image-right', // 左文右图
  ],
  2: [
    'two-images-stack',    // 双图横板
    'two-images-slanted',  // 双图留白
    'dual-portrait',       // 双图竖版
    'image-left-text-right', // 左图右文
    'text-left-image-right', // 左文右图
  ],
  3: [
    'three-collage',       // 三图拼贴
    'three-collage-v2',    // 三图错落
  ],
  4: [
    'four-grid',           // 四宫格
    'four-magazine',       // 四图杂志风
    'four-left3-right1',   // 四图三小一大
    'four-grid-whitespace', // 四图留白
  ],
  5: [
    'five-collage',        // 五图拼贴
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
  const { projectName, themeId, imageIds, format, maxImagesPerPage, includeCover, includeEnding } = options;
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
  let isMultiPhotoPage = true; // 第一页是多张图页
  let multiPhotoCountIndex = 0; // 多图页的数量循环索引：2→3→4→5→2→3...
  const multiPhotoCounts = [2, 3, 4, 5]; // 保证双图、三图、四图、五图都有
  let lastTemplateId: string | undefined = undefined; // 上一页用的模板，避免重复

  while (imageIndex < imageIds.length) {
    let count: number;
    let templateId: string;

    if (isMultiPhotoPage) {
      // 多图页：按 2→3→4→5 循环选数量，保证每种都有
      count = multiPhotoCounts[multiPhotoCountIndex % multiPhotoCounts.length];
      multiPhotoCountIndex++;
      // 如果剩下的图片不够，就少放几张
      const remaining = imageIds.length - imageIndex;
      if (count > remaining) {
        count = Math.max(1, remaining);
      }
      // 根据数量选模板，避免和上一页重复
      templateId = pickTemplateByImageCount(count, lastTemplateId);
    } else {
      // 单张图页：满版图带边框，无文案
      count = 1;
      templateId = 'full-image-bordered';
    }

    // 这一页的图片ID
    const pageImageIds = imageIds.slice(imageIndex, imageIndex + count);

    // 应用模板
    const template = TEMPLATES.find((t) => t.id === templateId)!;
    const elements = applyTemplate(template, format, pageImageIds);

    // 填充文案（单张满版图页不填文案）
    if (isMultiPhotoPage) {
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

    imageIndex += count;
    isMultiPhotoPage = !isMultiPhotoPage; // 下一页切换类型
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
    templateId: 'cover-magazine',
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

    // 根据字号判断是标题还是正文
    const isTitle = textEl.fontSize > format.width * 0.04 * 2.83;

    if (isTitle) {
      textEl.content = getUniquePageTitle(theme, used);
    } else {
      textEl.content = getUniqueParagraph(theme, used);
    }
  }
}
