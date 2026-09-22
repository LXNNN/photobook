import type { ImageAsset } from '@/types';
import { generateId } from './units';

/** 检测是否是 HEIC/HEIF 格式 */
export function isHeicFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  // 按文件后缀判断更可靠：系统没注册 HEIC 关联时 file.type 会是空字符串
  return name.endsWith('.heic') || name.endsWith('.heif') ||
         name.endsWith('.heics') ||
         type.includes('heic') || type.includes('heif');
}

/** 常见图片后缀。系统没注册对应 MIME 时 file.type 为空，只能看后缀 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif', '.heics'];

/** 判断是否是可处理的图片文件 */
export function isImageFile(file: File): boolean {
  if ((file.type || '').toLowerCase().startsWith('image/')) return true;
  // file.type 为空时（Windows 上很常见）退回按后缀判断，否则文件会被静默丢掉
  const name = (file.name || '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * HEIC 文件转 JPEG
 *
 * 用动态 import 懒加载 heic-to：它内置的 libheif 有 3MB 左右，
 * 静态导入会让每个访客都白白下载；只有真正选了 HEIC 才去取。
 *
 * 不要换回 heic2any：那个包内置的 libheif 是 2020 年的老版本，
 * 解不了新 iPhone（iOS 17/18）拍的 HEIC，上传时会直接报错。
 */
async function convertHeicToJpeg(file: File): Promise<File> {
  try {
    const { heicTo } = await import('heic-to');
    const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 });
    return new File([blob], file.name.replace(/\.(heic|heif|heics)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch (err) {
    console.error('HEIC 转换失败:', file.name, err);
    throw new Error(
      `HEIC 转换失败：${file.name}\n\n` +
      `临时办法：在 iPhone 设置 → 相机 → 格式 里选「兼容性最佳」，之后拍的照片就是 JPG 了。`
    );
  }
}

/**
 * 把 HEIC 转成浏览器能显示的 JPEG，其他格式原样返回。
 *
 * 预览和生成都要用，所以统一走这里：Chrome 无法直接渲染 HEIC，
 * 不转的话 <img> 会显示成破图，画布上也画不出来。
 */
export async function toDisplayableFile(file: File): Promise<File> {
  return isHeicFile(file) ? convertHeicToJpeg(file) : file;
}

/**
 * 印刷分辨率上限（图片长边像素数）。
 *
 * A5 整页在 300dpi 下是 1748×2480，长边留到 4096 有 1.65 倍余量，
 * 够照片被裁切、放大到整页之后仍然清晰。
 *
 * 取 4096 而不是 4000，是为了让 iPhone 12MP 照片（长边 4032）**原样通过**——
 * 它是最常见的尺寸，能不动就不要动，重新编码一次就白掉一次画质。
 */
const PRINT_MAX_EDGE = 4096;

/**
 * 超出印刷需要的照片缩到 PRINT_MAX_EDGE 以内；没超的原样返回。
 *
 * 不要改回「按文件大小压到 5MB」那套（原来用的 browser-image-compression）：
 * 那是按体积定的目标，为了凑够体积会同时降质量**和缩分辨率**，把用户的高像素
 * 照片砍掉一大半像素（实测 6000×8000 只剩 3383×4512，像素少 68%）。
 * 这本书最终是要 300dpi 印刷的，为了省磁盘砍像素，等于砍印刷质量。
 */
async function capToPrintResolution(file: File): Promise<File> {
  const img = await loadImage(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);

  // 已经在印刷需要的范围内：一次都不要重新编码，重新编码本身就会掉画质
  if (longEdge <= PRINT_MAX_EDGE) return file;

  const scale = PRINT_MAX_EDGE / longEdge;
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // 相册页面是白底。先铺白，PNG 的透明区域才不会被 JPEG 编码成黑块
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  // 编码失败就退回原图：宁可存大一点，也不能让上传直接挂掉
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}

/** 读取文件为 ImageAsset */
export async function fileToImageAsset(file: File): Promise<ImageAsset> {
  const processedFile = await toDisplayableFile(file);

  const stored = await capToPrintResolution(processedFile);
  const img = await loadImage(stored);

  // 生成缩略图
  const thumbnail = await createThumbnail(img, 200);

  return {
    id: generateId(),
    blob: stored,
    thumbnail,
    // 必须是最终落盘文件的真实尺寸。之前这里记的是压缩前的尺寸，
    // 一旦压缩同时缩了分辨率，元数据就和 blob 对不上了
    width: img.naturalWidth,
    height: img.naturalHeight,
    size: stored.size,
    createdAt: Date.now(),
  };
}

/** 加载图片（拿尺寸、解码都靠它）。传字符串时调用方自己负责它的生命周期 */
export function loadImage(file: File | Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    if (typeof file === 'string') {
      img.src = file;
    } else {
      img.src = URL.createObjectURL(file);
    }
  });
}

/** 创建缩略图 base64（传入已解码的图片，避免重复解码） */
async function createThumbnail(img: HTMLImageElement, maxSize: number): Promise<string> {
  const canvas = document.createElement('canvas');
  const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

/** Blob 转 dataURL */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 从 ImageAsset 获取可用于渲染的 URL */
export function getImageURL(asset: ImageAsset): string {
  return URL.createObjectURL(asset.blob);
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 计算 cover 模式的裁剪区域
 * 保持图片原始比例，居中裁剪，填满目标区域，图片不会变形
 * @param imgWidth 图片原始宽度
 * @param imgHeight 图片原始高度
 * @param targetWidth 目标区域宽度（px）
 * @param targetHeight 目标区域高度（px）
 * @param customCrop 用户自定义裁剪区域（相对比例 0-1），如果非默认值则优先使用
 * @returns 裁剪区域（像素坐标）
 */
export function computeCoverCrop(
  imgWidth: number,
  imgHeight: number,
  targetWidth: number,
  targetHeight: number,
  customCrop?: CropArea
): { sx: number; sy: number; sw: number; sh: number } {
  // 如果有自定义裁剪（非默认全图），优先使用用户的裁剪
  const hasCustomCrop = customCrop && (
    customCrop.x !== 0 || customCrop.y !== 0 ||
    customCrop.width !== 1 || customCrop.height !== 1
  );

  if (hasCustomCrop && customCrop) {
    return {
      sx: customCrop.x * imgWidth,
      sy: customCrop.y * imgHeight,
      sw: customCrop.width * imgWidth,
      sh: customCrop.height * imgHeight,
    };
  }

  // 自动 cover 裁剪：保持比例，居中裁剪填满
  const imgRatio = imgWidth / imgHeight;
  const targetRatio = targetWidth / targetHeight;

  let sx = 0, sy = 0, sw = imgWidth, sh = imgHeight;

  if (imgRatio > targetRatio) {
    // 图片比目标更宽 → 按高度适配，左右裁剪
    sw = imgHeight * targetRatio;
    sx = (imgWidth - sw) / 2;
  } else {
    // 图片比目标更高 → 按宽度适配，上下裁剪
    sh = imgWidth / targetRatio;
    sy = (imgHeight - sh) / 2;
  }

  return { sx, sy, sw, sh };
}
