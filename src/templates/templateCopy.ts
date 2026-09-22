/**
 * 按模板分类的文案库
 * 每个模板对应5条文案，应用模板时随机抽取
 * 严格按照用户确认的内容编写
 */

// ============ 单图排满（标题，10字以内） ============
export const FULL_IMAGE_TEXTS = [
  { title: '时光印记' },
  { title: '遇见美好' },
  { title: '在路上' },
  { title: '生活小记' },
  { title: '岁月温柔' },
];

// ============ 上图下文（小标题 + 100-200字正文） ============
export const IMAGE_TOP_TEXT_BOTTOM_TEXTS = [
  {
    title: '旅行的意义',
    body: '有些风景，只有亲自站在那里才能感受。风的味道、光的温度，都成了记忆里最珍贵的部分。不用刻意寻找，最美的瞬间往往就在不经意的转角。把这些瞬间都收藏起来，在往后的日子里慢慢回味。'
  },
  {
    title: '在路上',
    body: '旅行的意义，不在于去了多少地方，而在于在路上遇见的那些人、那些事，以及那个不一样的自己。把烦恼丢在身后，把期待装进行囊，去看看这个世界的美好。'
  },
  {
    title: '时光印记',
    body: '走过的路，看过的风景，遇到的人，都在悄悄塑造着我们。旅行不是逃离，而是为了更好地回来，带着满满的能量继续前行。原来我们已经走过了这么多路。'
  },
  {
    title: '山川湖海',
    body: '山川湖海，日月星辰，大自然总是在用它的方式提醒我们：世界很大，不要困在自己的小情绪里。去看看，去感受，去热爱每一个当下。'
  },
  {
    title: '慢慢记录',
    body: '时光匆匆，唯有记录能让美好永恒。把这些瞬间都收藏起来，在往后的日子里慢慢回味。原来生活中有这么多值得记录的小确幸。'
  },
];

// ============ 左图右文 / 右图左文（小标题 + 三段不同正文，段间有空隙） ============
export const IMAGE_LEFT_TEXT_RIGHT_TEXTS = [
  { title: '美好瞬间', body: '最好的时光在路上，最美的风景在远方。带着好奇心出发，带着满满的回忆归来。' },
  { title: '生活小记', body: '生活不是赶路，而是感受路。那些沿途的风景、遇见的人、发生的故事，才是最珍贵的收获。' },
  { title: '旅行碎片', body: '在陌生的城市里，感受不同的生活节奏，品尝当地的美食，和当地人聊聊天。' },
  { title: '成长记录', body: '成长是一场漫长的旅行，沿途有鲜花也有荆棘。感谢一路走来的自己，也感谢陪伴在身边的你们。' },
  { title: '时光印记', body: '生活就像一本打开的书，每一天都是新的一页。用心书写每一个故事，让人生这本书变得丰富多彩。' },
];

// ============ 双图横板（无文案） ============
// 双图横板模板没有文案，不需要文案库

// ============ 双图竖版（小标题 + 正文） ============
export const DUAL_PORTRAIT_TEXTS = [
  {
    title: '旅行碎片',
    body: '把日子过成诗，把风景记成故事。这些细碎的美好，拼凑成了完整的生活。'
  },
  {
    title: '今日份小美好',
    body: '生活明朗，万物可爱。每一个平凡的日子，都藏着不期而遇的温柔。'
  },
  {
    title: '时光笔记',
    body: '记录生活中的小确幸，一杯咖啡、一本书、一个好天气，都是礼物。'
  },
  {
    title: '慢慢生活',
    body: '生活不是赶路，而是感受路。那些沿途的风景，才是最珍贵的收获。'
  },
  {
    title: '日常碎片',
    body: '把生活过成自己喜欢的样子，不迎合、不将就，在自己的节奏里慢慢走。'
  },
];

// ============ 三图拼贴（小标题 + 100-200字正文） ============
export const THREE_COLLAGE_TEXTS = [
  {
    title: '美好瞬间',
    body: '最好的时光在路上，最美的风景在远方。带着好奇心出发，带着满满的回忆归来。那些走过的路、看过的云、吹过的风，都会变成生命里温柔的底色，在某个不经意的瞬间，温暖你我。'
  },
  {
    title: '生活小记',
    body: '生活不是赶路，而是感受路。那些沿途的风景、遇见的人、发生的故事，才是最珍贵的收获。愿我们都能在平凡的日子里，找到属于自己的那束光，慢慢生活。'
  },
  {
    title: '旅行碎片',
    body: '在陌生的城市里，感受不同的生活节奏，品尝当地的美食，和当地人聊聊天。这些细碎的瞬间拼凑成了完整的记忆，也拼凑成了独一无二的旅程。'
  },
  {
    title: '成长记录',
    body: '成长是一场漫长的旅行，沿途有鲜花也有荆棘。感谢一路走来的自己，也感谢陪伴在身边的你们。愿我们都能继续保持热爱，奔赴下一场山海。'
  },
  {
    title: '时光印记',
    body: '生活就像一本打开的书，每一天都是新的一页。用心书写每一个故事，让人生这本书变得丰富多彩。愿你眼里有光，心中有爱，脚下有路。'
  },
];

// ============ 三图错落（小标题 + 80-120字正文） ============
export const THREE_OFFSET_TEXTS = [
  {
    title: '温柔瞬间',
    body: '那些走过的路、看过的云、吹过的风，都会变成生命里温柔的底色，在某个不经意的瞬间，温暖你我。'
  },
  {
    title: '慢慢生活',
    body: '把生活过成自己喜欢的样子，不迎合、不将就。在自己的节奏里，慢慢走、细细品，感受每一个当下。'
  },
  {
    title: '时光不语',
    body: '时光不语，却回答了所有问题。岁月不言，却见证了所有真心。记录这些瞬间，就是记录生活本身。'
  },
  {
    title: '遇见美好',
    body: '每一段旅程都是一次成长，每一次相遇都是一份礼物。珍惜当下，感恩所有遇见，愿所有美好如期而至。'
  },
  {
    title: '岁月悠长',
    body: '岁月悠长，愿我们都能在这平凡的日子里，找到属于自己的那束光，慢慢生活，好好感受每一个当下。'
  },
];

// ============ 四图留白（小标题 + 30-50字正文，两行） ============
export const FOUR_GRID_WHITESPACE_TEXTS = [
  {
    title: '风景在路上',
    body: '走过的路，看过的景，都会变成记忆里的光。愿你我都能在平凡的日子里，找到属于自己的美好。'
  },
  {
    title: '时光慢递',
    body: '把每一个瞬间都好好收藏，等以后翻起来的时候，还能想起当时的风、当时的笑、当时的心情。'
  },
  {
    title: '人间值得',
    body: '生活总有不期而遇的温柔，和生生不息的希望。愿你眼里有星辰，心中有山海，所遇皆美好。'
  },
  {
    title: '岁月静好',
    body: '慢下来，去感受风的形状，去听花开的声音，去看云卷云舒。日子很长，我们慢慢走，慢慢爱。'
  },
  {
    title: '一路生花',
    body: '愿你走过的路都开满鲜花，愿你遇见的人都温柔善良。保持热爱，奔赴山海，未来可期。'
  },
];

// ============ 五图拼贴（10-20字短句） ============
export const FIVE_COLLAGE_TEXTS = [
  { title: '生活明朗，万物可爱', body: '生活明朗，万物可爱' },
  { title: '今日份小美好', body: '今日份小美好' },
  { title: '在路上，永远年轻', body: '在路上，永远年轻' },
  { title: '保持热爱，奔赴山海', body: '保持热爱，奔赴山海' },
  { title: '把日子过成诗', body: '把日子过成诗' },
];

// ============ 模板文案映射表 ============
export const TEMPLATE_COPY_MAP: Record<string, any[]> = {
  'image-top-text-bottom': IMAGE_TOP_TEXT_BOTTOM_TEXTS,
  'image-left-text-right': IMAGE_LEFT_TEXT_RIGHT_TEXTS,
  'text-left-image-right': IMAGE_LEFT_TEXT_RIGHT_TEXTS,
  'dual-portrait': DUAL_PORTRAIT_TEXTS,
  'three-collage': THREE_COLLAGE_TEXTS,
  'three-collage-v2': THREE_OFFSET_TEXTS,
  'two-images-slanted': THREE_OFFSET_TEXTS,
  'four-left3-right1': THREE_COLLAGE_TEXTS,
  'four-grid-whitespace': FOUR_GRID_WHITESPACE_TEXTS,
  'five-collage': FIVE_COLLAGE_TEXTS,
};

// ============ 工具函数 ============
export function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 根据模板 id 获取对应的文案列表
 */
export function getTemplateCopyList(templateId: string): any[] {
  const list = TEMPLATE_COPY_MAP[templateId];
  if (!list) return [];
  return list;
}

/**
 * 根据模板 id 随机获取一条文案
 */
export function getTemplateCopy(templateId: string): any {
  const list = getTemplateCopyList(templateId);
  if (list.length === 0) return null;
  return randomPick(list);
}
