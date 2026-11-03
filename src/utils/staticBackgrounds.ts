import type { PageBackground, Project } from '@/types';
import moban1Bg from '@/assets/moban1.png';

/**
 * 内置模板的静态背景图。
 *
 * 相册数据.json 里**不能存打包后的 URL**：URL 会随部署路径（`/photobook/` 还是 `/`）、
 * 构建 hash、开发服务器（`/src/assets/...`）变化。以前 4.2 的 `moban1.png` 就是把
 * 开发服务器地址写进了 JSON，换到线上/重新选文件夹后图片 404，背景就消失了。
 *
 * 现在统一存稳定键 `static-bg:moban1`，渲染时再换成当前构建的 URL；
 * 旧数据里认得出的历史 URL 也会在读取时自动归一。
 */
export const STATIC_BG_PREFIX = 'static-bg:';

const STATIC_BACKGROUNDS: Record<string, string> = {
  moban1: moban1Bg,
};

export function staticBackgroundKey(name: string): string {
  return `${STATIC_BG_PREFIX}${name}`;
}

/** 背景值是不是「不需要去图片仓库里找」的静态资源（稳定键 / dataURL / 绝对路径） */
export function isStaticBackgroundValue(value: string): boolean {
  return value.startsWith(STATIC_BG_PREFIX) || value.startsWith('data:') || value.startsWith('/');
}

function isLegacyStaticUrl(name: string, value: string): boolean {
  // 认这几种历史写法：
  //   /photobook/src/assets/moban1.png（开发服务器）
  //   /photobook/assets/moban1-QqUm5tcW.png（旧版 GitHub Pages 构建）
  //   /assets/moban1-QqUm5tcW.png（根路径部署）
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|/)assets/${escaped}(?:-[^/]+)?\\.(?:png|jpe?g|webp)(?:[?#].*)?$`, 'i').test(value);
}

/** 把历史 URL 归一成稳定键；不认识的背景值原样返回 */
export function normalizeStaticBackgroundValue(value: string): string {
  if (value.startsWith(STATIC_BG_PREFIX)) return value;
  for (const name of Object.keys(STATIC_BACKGROUNDS)) {
    if (isLegacyStaticUrl(name, value)) return staticBackgroundKey(name);
  }
  return value;
}

/** 把背景值换成当前构建里真正可加载的 URL（稳定键 / 历史 URL → 打包 URL） */
export function resolveStaticBackground(value: string): string {
  const normalized = normalizeStaticBackgroundValue(value);
  if (normalized.startsWith(STATIC_BG_PREFIX)) {
    return STATIC_BACKGROUNDS[normalized.slice(STATIC_BG_PREFIX.length)] ?? normalized;
  }
  return normalized;
}

/** 读取项目时把旧的背景 URL 换成稳定键（只换认得出的内置背景，不会动用户自己的图） */
export function normalizeProjectBackgrounds(project: Project): Project {
  let changed = false;
  const pages = project.pages.map((page) => {
    if (page.background.type !== 'image') return page;
    const value = normalizeStaticBackgroundValue(page.background.value);
    if (value === page.background.value) return page;
    changed = true;
    return { ...page, background: { ...page.background, value } as PageBackground };
  });
  return changed ? { ...project, pages } : project;
}
