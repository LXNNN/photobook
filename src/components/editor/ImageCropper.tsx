import { useState, useRef, useEffect } from 'react';
import type { ImageElement } from '@/types';
import { fitCropToRatio } from '@/utils/image';

interface Props {
  element: ImageElement;
  imageUrl: string;
  onConfirm: (crop: { x: number; y: number; width: number; height: number }) => void;
  onClose: () => void;
}

/** 照片在容器里的显示矩形（和容器同一个坐标系，单位 px，可以是负数） */
interface PhotoRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 图片裁剪对话框
 *
 * 取景框固定在对话框中间不动（形状 = 元素宽高比），**动的是照片**：
 * 拖动移动、滚轮缩放，跟手机相册的裁剪手感一致 —— 用户看到的是
 * 「我要把照片的哪一块放进这个框里」。
 *
 * 内部仍然只维护照片的位置和大小，照片必须始终盖住取景框（cover），
 * 所以框里永远有画面、不会露底。确认时把照片的位置反算成 crop
 * （相对原图的 0-1 区域）。
 */
export default function ImageCropper({ element, imageUrl, onConfirm, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [photo, setPhoto] = useState<PhotoRect>({ x: 0, y: 0, w: 0, h: 0 });
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  // 取景框：形状跟着元素走，尽量占满对话框（500×400 是这个弹窗一直以来的可用大小）
  const elementRatio = element.width / element.height;
  const frameW = Math.min(500, 400 * elementRatio);
  const frameH = frameW / elementRatio;

  const aspect = imgSize.w && imgSize.h ? imgSize.w / imgSize.h : 1;
  // 照片能缩到多小：刚好盖满取景框（cover）。再小框里就会露出空白，
  // 而确认后的 crop 是拿这块区域去铺满图片元素的，露白的地方会跟所见对不上
  const minPhotoW = Math.max(frameW, frameH * aspect);
  // 能放到多大：原图 1:1 像素（再放大只是插值变糊，没有意义）
  const maxPhotoW = Math.max(minPhotoW, imgSize.w);

  // 进弹窗时把照片摆到跟已有 crop 一致的位置；没裁过就 cover 居中
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const W = img.width;
      const H = img.height;
      setImgSize({ w: W, h: H });
      const a = W / H;

      const hasCustomCrop =
        element.crop.x !== 0 || element.crop.y !== 0 || element.crop.width !== 1 || element.crop.height !== 1;
      const crop = hasCustomCrop
        ? // 存下来的框万一是按别的形状裁的（换过位、元素被缩放过、老数据），
          // 这里先掰回当前元素的形状。比例本来就配得上的话是恒等变换
          fitCropToRatio(element.crop, W, H, elementRatio)
        : { x: 0, y: 0, width: 1, height: 1 };

      // 照片宽 = 取景框宽 / 裁剪区宽度（裁剪区越窄，说明照片放得越大）
      const w = Math.max(Math.max(frameW, frameH * a), frameW / crop.width);
      const h = w / a;
      // 让裁剪区中心对准取景框中心（整张图时就是正中间）
      let x = frameW / 2 - (crop.x + crop.width / 2) * w;
      let y = frameH / 2 - (crop.y + crop.height / 2) * h;
      x = Math.min(0, Math.max(frameW - w, x));
      y = Math.min(0, Math.max(frameH - h, y));
      setPhoto({ x, y, w, h });
    };
    img.src = imageUrl;
  }, [imageUrl, element.crop, elementRatio, frameW, frameH]);

  // 拖动 = 移动照片。照片必须一直盖住取景框，所以能拖的范围是
  // x ∈ [框宽 - 照片宽, 0]（照片比框宽，这个区间是负到 0）
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStart.current = { mx: e.clientX, my: e.clientY, px: photo.x, py: photo.y };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragStart.current;
      if (!d) return;
      setPhoto((prev) => {
        const x = Math.min(0, Math.max(frameW - prev.w, d.px + (e.clientX - d.mx)));
        const y = Math.min(0, Math.max(frameH - prev.h, d.py + (e.clientY - d.my)));
        return { ...prev, x, y };
      });
    };
    const onUp = () => {
      dragStart.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [frameW, frameH]);

  // 滚轮缩放照片。以鼠标位置为锚点：缩放前后鼠标底下的那个画面对准原地，
  // 不然滚起来照片会到处乱跑。
  // 必须用原生 addEventListener —— React 的 onWheel 是 passive 的，
  // 里面调 preventDefault 会被浏览器忽略，滚轮会连带把底下的页面也滚走。
  // 监听挂在整层遮罩上（不是只挂在取景框上）：鼠标停在弹窗的空白处滚也照样缩放，
  // 而且滚动被吃掉，不会把背后的编辑页滚走
  useEffect(() => {
    const el = overlayRef.current;
    const box = containerRef.current;
    if (!el || !box) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setPhoto((prev) => {
        if (!prev.w) return prev;

        // deltaMode=1 是"按行滚"的老式滚轮，换算成像素，让两种设备手感一致
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        // 向上滚（delta<0）→ 照片放大。指数曲线，滚一格的幅度和当前大小无关
        const factor = Math.exp(-delta * 0.0015);

        let w = prev.w * factor;
        if (w < minPhotoW) w = minPhotoW;
        if (w > maxPhotoW) w = maxPhotoW;
        if (Math.abs(w - prev.w) < 0.01) return prev; // 已经到边界，不白渲染

        const h = w / aspect;
        const k = w / prev.w; // 照片整体缩放比例，x/y 要按同一比例向锚点收拢
        const rect = box.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const x = Math.min(0, Math.max(frameW - w, mx - (mx - prev.x) * k));
        const y = Math.min(0, Math.max(frameH - h, my - (my - prev.y) * k));
        return { x, y, w, h };
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [aspect, minPhotoW, maxPhotoW, frameW, frameH]);

  // 确认：把照片当前位置反算成相对原图的 0-1 区域
  const handleConfirm = () => {
    if (!photo.w || !photo.h) return;
    onConfirm({
      x: clamp01(-photo.x / photo.w),
      y: clamp01(-photo.y / photo.h),
      width: Math.min(1, frameW / photo.w),
      height: Math.min(1, frameH / photo.h),
    });
  };

  // 重置：照片回到刚好盖满取景框、居中
  const handleReset = () => {
    const w = minPhotoW;
    const h = w / aspect;
    setPhoto({ x: (frameW - w) / 2, y: (frameH - h) / 2, w, h });
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">裁剪图片</h3>

        {/* 取景框。照片比框大，溢出的部分被裁掉 —— 最终就显示框里这一块 */}
        <div
          ref={containerRef}
          className="relative bg-gray-900 overflow-hidden cursor-move select-none"
          style={{ width: frameW, height: frameH }}
          onMouseDown={handleMouseDown}
        >
          {photo.w > 0 && (
            <img
              src={imageUrl}
              alt=""
              // max-w-none 必须留着：Tailwind 的 preflight 会给所有 img 加
              // max-width:100%，照片就会被压回容器宽、但高度还是 inline 的值 → 被拉伸
              className="absolute pointer-events-none select-none max-w-none"
              style={{ left: photo.x, top: photo.y, width: photo.w, height: photo.h }}
              draggable={false}
            />
          )}

          {/* 框本身不接收鼠标事件，拖拽统一由外层容器处理 */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 border border-white/40" />
            <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-gray-900" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-gray-900" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-gray-900" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-gray-900" />
          </div>
        </div>

        {/* 提示 */}
        <p className="text-xs text-gray-400 text-center mt-3">拖动移动照片 · 滚轮缩放照片 · 框里就是最终显示的范围</p>

        {/* 按钮 */}
        <div className="flex justify-between mt-4">
          <button onClick={handleReset} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            重置
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              取消
            </button>
            <button onClick={handleConfirm} className="px-4 py-2 text-sm bg-amber-700 text-white hover:bg-amber-800 rounded-lg">
              确认裁剪
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
