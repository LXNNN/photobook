import { useState } from 'react';
import type { Project } from '@/types';
import { countBodyText, DEFAULT_BODY_COLOR, DEFAULT_BODY_FONT_SIZE } from '@/utils/bodyText';

/** 模板里正文用到的灰阶，直接给成色板（也可以自己取色） */
const PRESET_COLORS = ['#1a1a1a', '#2c2c2c', '#333333', '#555555', '#666666', '#888888'];
const SIZE_OPTIONS = [
  { pt: 12, label: '12pt' },
  { pt: 13, label: '13pt 默认' },
  { pt: 14, label: '14pt' },
];

interface Props {
  project: Project;
  onApply: (color: string, fontSize: number) => void;
  onClose: () => void;
}

/**
 * 「🎨 正文样式」弹窗：一键换全书正文的颜色和字号。
 *
 * 只认正文 —— 标题（字号到了标题线）和 fixed 装饰小字都不动，判定在
 * utils/bodyText.ts 里，跟模板填充正文时的口径一致。
 *
 * 换完之后这套颜色/字号会记进相册（bodyColor / bodyFontSize），下次点
 * 「📝 添加文字」新建的文字直接用它 —— 这也是弹窗存在的意义：先在这儿定好
 * 全书的正文样式，再往下补字，不用一个个调。
 */
export default function BodyStyleDialog({ project, onApply, onClose }: Props) {
  const [color, setColor] = useState((project.bodyColor || DEFAULT_BODY_COLOR).toLowerCase());
  const [fontSize, setFontSize] = useState(project.bodyFontSize || DEFAULT_BODY_FONT_SIZE);
  const affected = countBodyText(project);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl p-6 w-[400px] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-800">🎨 正文样式</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ×
          </button>
        </div>

        {/* 颜色 */}
        <div className="mb-5">
          <div className="text-sm text-gray-600 mb-2">正文颜色</div>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                className={`w-8 h-8 rounded-full border transition-all ${
                  color === c ? 'border-amber-600 ring-2 ring-amber-200' : 'border-gray-200 hover:border-gray-400'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            {/* 系统取色器：色板之外的任意颜色 */}
            <label
              className="w-8 h-8 rounded-full border border-dashed border-gray-300 hover:border-gray-500 cursor-pointer flex items-center justify-center text-[10px] text-gray-500"
              title="自己选颜色"
            >
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value.toLowerCase())}
                className="sr-only"
              />
              +
            </label>
            <span className="text-xs text-gray-500 ml-1 font-mono">{color}</span>
          </div>
        </div>

        {/* 字号 */}
        <div className="mb-5">
          <div className="text-sm text-gray-600 mb-2">正文字号</div>
          <div className="flex gap-2">
            {SIZE_OPTIONS.map((o) => (
              <button
                key={o.pt}
                onClick={() => setFontSize(o.pt)}
                className={`flex-1 px-3 py-2 text-sm rounded-md border transition-colors ${
                  fontSize === o.pt
                    ? 'border-amber-600 bg-amber-50 text-amber-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-400'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* 预览：所见即所得地看一眼颜色和字号 */}
        <div className="mb-4 rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
          <div className="text-xs text-gray-400 mb-1">效果预览</div>
          <div style={{ color, fontSize: fontSize * (4 / 3), lineHeight: 1.6 }}>
            这一路的风景，从我的视角展开
          </div>
        </div>

        {/* 影响范围：让她点之前心里有数 */}
        <p className="text-xs text-gray-500 leading-relaxed mb-5">
          {affected > 0 ? (
            <>将把全书 <span className="text-gray-800 font-medium">{affected} 处正文</span>换成这套颜色和字号。</>
          ) : (
            <>这本相册里还没有正文，只把默认样式定成这套。</>
          )}
          <br />
          标题和装饰小字不受影响。换完之后再点「📝 添加文字 → 添加正文」，新写的正文也用这套。
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onApply(color, fontSize)}
            className="px-4 py-1.5 text-sm bg-amber-700 text-white hover:bg-amber-800 rounded-md transition-colors"
          >
            应用到全书
          </button>
        </div>
      </div>
    </div>
  );
}
