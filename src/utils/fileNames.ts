/**
 * 文件名清洗与编号工具。
 *
 * 备份 zip 和文件夹模式都要把相册名变成安全的文件夹名、按图片类型定扩展名，
 * 规则必须完全一致（备份包解开和文件夹长一个样，靠的就是同一套规则）。
 *
 * 单独成一个文件，是因为文件夹层的 folderLibrary 不能 import backup.ts
 * （backup → assetStore → folderLibrary，会成环），只能把共用规则提到最底层。
 */

/**
 * Windows 不允许文件名里有这些字符；控制字符（\p{Cc}）一并算进去。
 *
 * 控制字符要写成 \p{Cc}，千万别在源码里直接敲一个控制字符范围 ——
 * 那会往文件里塞进真实的 NUL，屏幕上看不见，但整个文件会被当成二进制，
 * 编辑器和 diff 全都读不了（这个坑真踩过一次）。
 */
export const UNSAFE_NAME = /[\\/:*?"<>|\p{Cc}]/gu;

/** 把相册名洗成能当文件夹名的样子，重名就加序号 */
export function safeFolderName(name: string, used: Set<string>): string {
  let base = (name || '').replace(UNSAFE_NAME, '_').trim().replace(/[. ]+$/, '');
  if (!base) base = '未命名相册';
  // 太长的名字在 Windows 上容易踩路径长度限制
  if (base.length > 60) base = base.slice(0, 60);

  let out = base;
  let i = 2;
  while (used.has(out)) out = `${base} (${i++})`;
  used.add(out);
  return out;
}

/** 图片 MIME → 文件扩展名（认不出来的一律按 .jpg） */
export function extFor(type: string): string {
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/bmp') return '.bmp';
  if (type === 'image/avif') return '.avif';
  return '.jpg';
}
