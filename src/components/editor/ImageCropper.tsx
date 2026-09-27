import { useState, useRef, useEffect, useCallback } from 'react';
import type { ImageElement } from '@/types';
import { fitCropToRatio } from '@/utils/image';

interface Props {
  element: ImageElement;
  imageUrl: string;
  onConfirm: (crop: { x: number; y: number; width: number; height: number }) => void;
  onClose: () => void;
}

/**
 * 图片裁剪对话框
 * 裁剪框宽高比与元素一致，用户拖动选择显示区域
 */
export default function ImageCropper({ element, imageUrl, onConfirm, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [displayScale, setDisplayScale] = useState(1);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const dragStart = useRef<{ mx: number; my: number; cropX: number; cropY: number } | null>(null);

  // 元素宽高比
  const elementRatio = element.width / element.height;

  // 加载图片并初始化裁剪框
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImgSize({ w: img.width, h: img.height });

      // 计算显示缩放（适应容器）
      const containerWidth = 500;
      const containerHeight = 400;
      const scale = Math.min(containerWidth / img.width, containerHeight / img.height, 1);
      setDisplayScale(scale);

      // 计算裁剪框大小：裁剪框宽高比 = 元素宽高比
      // 裁剪框在原始图片坐标中的大小
      let cropW = img.width;
      let cropH = cropW / elementRatio;
      if (cropH > img.height) {
        cropH = img.height;
        cropW = cropH * elementRatio;
      }

      // 初始裁剪位置：居中，或使用已有的 crop
      const hasCustomCrop = element.crop.x !== 0 || element.crop.y !== 0 || element.crop.width !== 1 || element.crop.height !== 1;
      let cropX = (img.width - cropW) / 2;
      let cropY = (img.height - cropH) / 2;

      if (hasCustomCrop) {
        // 裁剪框的形状必须跟着元素走。存下来的框万一是按别的形状裁的（换过位、
        // 元素被缩放过、老数据），这里掰回来，否则对话框会显示成一个跟当前
        // 图片区域对不上的形状。比例本来就配得上的话是恒等变换。
        const fit = fitCropToRatio(element.crop, img.width, img.height, elementRatio);
        cropX = fit.x * img.width;
        cropY = fit.y * img.height;
        cropW = fit.width * img.width;
        cropH = fit.height * img.height;
      }

      setCropRect({ x: cropX, y: cropY, w: cropW, h: cropH });
    };
    img.src = imageUrl;
  }, [imageUrl, element.crop, elementRatio]);

  // 拖动裁剪框
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      cropX: cropRect.x,
      cropY: cropRect.y,
    };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragStart.current) return;
    const dx = (e.clientX - dragStart.current.mx) / displayScale;
    const dy = (e.clientY - dragStart.current.my) / displayScale;

    let newX = dragStart.current.cropX + dx;
    let newY = dragStart.current.cropY + dy;

    // 边界限制
    newX = Math.max(0, Math.min(imgSize.w - cropRect.w, newX));
    newY = Math.max(0, Math.min(imgSize.h - cropRect.h, newY));

    setCropRect((prev) => ({ ...prev, x: newX, y: newY }));
  }, [displayScale, imgSize, cropRect.w, cropRect.h]);

  const handleMouseUp = useCallback(() => {
    dragStart.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // 确认裁剪
  const handleConfirm = () => {
    onConfirm({
      x: cropRect.x / imgSize.w,
      y: cropRect.y / imgSize.h,
      width: cropRect.w / imgSize.w,
      height: cropRect.h / imgSize.h,
    });
  };

  // 重置裁剪
  const handleReset = () => {
    const cropW = Math.min(imgSize.w, imgSize.h * elementRatio);
    const cropH = cropW / elementRatio;
    setCropRect({
      x: (imgSize.w - cropW) / 2,
      y: (imgSize.h - cropH) / 2,
      w: cropW,
      h: cropH,
    });
  };

  const displayW = imgSize.w * displayScale;
  const displayH = imgSize.h * displayScale;
  const displayCropX = cropRect.x * displayScale;
  const displayCropY = cropRect.y * displayScale;
  const displayCropW = cropRect.w * displayScale;
  const displayCropH = cropRect.h * displayScale;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">裁剪图片</h3>

        {/* 裁剪区域 */}
        <div
          ref={containerRef}
          className="relative bg-gray-900 rounded-lg overflow-hidden mx-auto"
          style={{ width: displayW, height: displayH, maxWidth: 500, maxHeight: 400 }}
        >
          <img src={imageUrl} alt="" className="absolute top-0 left-0 select-none" style={{ width: displayW, height: displayH }} draggable={false} />

          {/* 遮罩层 - 裁剪框外变暗 */}
          <svg className="absolute inset-0" width={displayW} height={displayH}>
            <defs>
              <mask id="cropMask">
                <rect width="100%" height="100%" fill="white" />
                <rect x={displayCropX} y={displayCropY} width={displayCropW} height={displayCropH} fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#cropMask)" />
          </svg>

          {/* 裁剪框 */}
          <div
            className="absolute border-2 border-white cursor-move"
            style={{
              left: displayCropX,
              top: displayCropY,
              width: displayCropW,
              height: displayCropH,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)',
            }}
            onMouseDown={handleMouseDown}
          >
            {/* 四个角的标记 */}
            <div className="absolute -top-1 -left-1 w-2 h-2 bg-white rounded-full" />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full" />
            <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-white rounded-full" />
            <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-white rounded-full" />
          </div>
        </div>

        {/* 提示 */}
        <p className="text-xs text-gray-400 text-center mt-3">拖动裁剪框选择显示区域，宽高比保持不变</p>

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
