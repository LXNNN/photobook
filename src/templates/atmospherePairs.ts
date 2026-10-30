import { TEMPLATES, type TemplateDefinition } from './index';

/** 一对固定跨页：左边放哪个模板、右边放哪个模板都由这里的数据决定 */
export interface AtmospherePair {
  left: TemplateDefinition;
  right: TemplateDefinition;
  /** 左页图位数 */
  leftSlots: number;
  /** 右页图位数 */
  rightSlots: number;
  /** 这一对一共放几张照片 */
  capacity: number;
  /** 左|右，用于判断这一对是不是同一对 */
  key: string;
  has121: boolean;
  has72: boolean;
}

interface PairDef {
  left: string;
  right: string;
}

/**
 * 固定搭配（28 对）。每对的左右顺序就是用户给的顺序：
 * 逗号前放左页、逗号后放右页，不能反过来。列表顺序不是入书顺序。
 */
export const PRIMARY_PAIR_DEFS: readonly PairDef[] = [
  { left: '2.5', right: '3.1' },
  { left: '4.3', right: '2.3' },
  { left: '2.6', right: '5.3' },
  { left: '3.1', right: '2.8' },
  { left: '4.1', right: '3.1' },
  { left: '1.2', right: '6.1' },
  { left: '3.6', right: '1.2' },
  { left: '4.3', right: '1.7' },
  { left: '2.6', right: '4.2' },
  { left: '1.3', right: '2.4' },
  { left: '5.2', right: '2.3' },
  { left: '1.6', right: '7.2' },
  { left: '4.5', right: '2.4' },
  { left: '3.4', right: '1.2' },
  { left: '2.1', right: '2.2' },
  { left: '5.6', right: '2.4' },
  { left: '1.4', right: '7.1' },
  { left: '5.5', right: '1.2' },
  { left: '6.2', right: '1.4' },
  { left: '5.1', right: '2.3' },
  { left: '5.4', right: '4.5' },
  { left: '1.4', right: '8.1' },
  { left: '2.6', right: '2.7' },
  { left: '12.1', right: '1.4' },
  { left: '3.2', right: '4.5' },
  { left: '4.6', right: '1.4' },
  { left: '4.6', right: '1.2' },
  { left: '1.6', right: '3.4' },
];

/** 备用搭配（固定搭配凑不齐时补；左右顺序同样按给定顺序固定） */
export const BACKUP_PAIR_DEFS: readonly PairDef[] = [
  { left: '2.5', right: '4.4' },
  { left: '4.1', right: '3.3' },
  { left: '4.1', right: '2.3' },
  { left: '5.2', right: '1.6' },
  { left: '5.2', right: '1.3' },
  { left: '5.2', right: '1.7' },
  { left: '4.5', right: '2.1' },
  { left: '2.6', right: '2.2' },
  { left: '2.8', right: '2.2' },
  // 2026-10-30 从固定搭配挪过来的
  { left: '1.6', right: '2.9' },
  { left: '1.5', right: '7.2' },
  { left: '1.6', right: '2.1' },
];

/** 左页池：动态配对时从里面拿左页模板 */
export const LEFT_POOL_NAMES: readonly string[] = [
  '2.3', '2.6', '3.1', '3.3', '3.4', '4.5', '4.6', '5.6', '6.1', '6.2',
];

/** 1 图正文模板（不含封面/尾页；它们的图位也是 1，但不参与正文配对） */
export const ONE_IMAGE_TEMPLATE_NAMES: readonly string[] = [
  '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7',
];

/** 右页池：动态配对时从里面拿右页模板 */
export const RIGHT_POOL_NAMES: readonly string[] = [
  ...ONE_IMAGE_TEMPLATE_NAMES,
  '2.1', '2.2', '2.4', '2.5', '2.7', '2.8',
  '3.2', '3.5', '3.6',
  '4.1', '4.2', '4.3', '4.4',
  '5.1', '5.2', '5.3', '5.4', '5.5',
  '7.1', '7.2', '8.1', '12.1',
];

export const ATMOSPHERE_COVER_ID = 'atm-cover-travel-journal';
export const ATMOSPHERE_ENDING_ID = 'atm-ending-minimal';

export interface AtmospherePairPools {
  primary: AtmospherePair[];
  backup: AtmospherePair[];
  dynamic: AtmospherePair[];
}

/** 模板里真实的图位数量 */
export function imageSlotCount(template: TemplateDefinition): number {
  return template.elements.filter((el) => el.type === 'image').length;
}

function findAtmosphereTemplateByName(name: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.styleId === 'atmosphere' && t.name === name);
}

function makePair(leftName: string, rightName: string): AtmospherePair | null {
  const left = findAtmosphereTemplateByName(leftName);
  const right = findAtmosphereTemplateByName(rightName);
  if (!left || !right) return null;

  const leftSlots = imageSlotCount(left);
  const rightSlots = imageSlotCount(right);
  if (leftSlots < 1 || rightSlots < 1) return null;

  return {
    left,
    right,
    leftSlots,
    rightSlots,
    capacity: leftSlots + rightSlots,
    key: `${leftName}|${rightName}`,
    has121: leftName === '12.1' || rightName === '12.1',
    has72: leftName === '7.2' || rightName === '7.2',
  };
}

/**
 * 在生成时现查一遍模板库：用户删掉的模板会自动跳过，
 * 模板改了图位数也会按新容量重新算。
 */
export function getAtmospherePairPools(): AtmospherePairPools {
  const resolve = (defs: readonly PairDef[]): AtmospherePair[] =>
    defs
      .map((d) => makePair(d.left, d.right))
      .filter((p): p is AtmospherePair => p !== null);

  const primary = resolve(PRIMARY_PAIR_DEFS);
  const backup = resolve(BACKUP_PAIR_DEFS);

  // 左池 × 右池的动态配对
  const dynamic: AtmospherePair[] = [];
  const seen = new Set<string>();
  for (const leftName of LEFT_POOL_NAMES) {
    for (const rightName of RIGHT_POOL_NAMES) {
      const pair = makePair(leftName, rightName);
      if (!pair || seen.has(pair.key)) continue;
      seen.add(pair.key);
      dynamic.push(pair);
    }
  }

  return { primary, backup, dynamic };
}

/** 全部 1 图正文模板；1.2 放最前面，M=1 时优先用它 */
export function getOneImageTemplates(): TemplateDefinition[] {
  return ONE_IMAGE_TEMPLATE_NAMES
    .map((name) => findAtmosphereTemplateByName(name))
    .filter((t): t is TemplateDefinition => !!t && imageSlotCount(t) === 1)
    .sort((a, b) => Number(b.name === '1.2') - Number(a.name === '1.2'));
}

/** 封面：优先氛围感同款，模板被删了就退回经典杂志封面 */
export function getAtmosphereCoverTemplate(): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === ATMOSPHERE_COVER_ID)
    ?? TEMPLATES.find((t) => t.id === 'cover-travel-journal');
}

/** 尾页：优先氛围感同款，模板被删了就退回经典尾页2 */
export function getAtmosphereEndingTemplate(): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === ATMOSPHERE_ENDING_ID)
    ?? TEMPLATES.find((t) => t.id === 'ending-minimal');
}
