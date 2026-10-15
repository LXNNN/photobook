interface Props {
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  onClose: () => void;
}

/**
 * 放大镜的按钮层：两侧箭头 + 关闭 + 底部提示条。
 *
 * 放大的本体是**书自己**（Viewer 里把 bookSize 换成铺满窗口的尺寸，page-flip 按新
 * 尺寸重建），所以这一层只是浮在书上面的几个控件，不画页面：
 *
 *   - 整层 pointer-events-none，只有按钮自己 pointer-events-auto。点在书页上必须
 *     原样落到 page-flip 手里 —— 点击翻页和那段翻页动画都是它原生的，盖一层东西
 *     上去就等于把动画盖掉了（这正是上一版的问题：贴静态图，翻页没有动画）。
 *   - 黑幕和"点黑边退出"在 Viewer 里（z-30，垫在书下面），不在这一层。
 *     data-magnify-chrome 是给那边认的：落在带这个标记的元素上不算"点黑边"，
 *     不然点一下箭头就把放大镜关了。
 *
 * 为什么当初要做放大镜：正文按印刷标准是 12pt，而预览页把整本书夹在 900px 内
 * （单页 450px），1920 的大屏上正文只有 12.9px，看字吃力 —— 但书的显示尺寸不能
 * 动，屏幕上看到多大就等于印出来多大，改了就是骗人。所以给一个临时的「放大看」，
 * 退出后书还是原来那个大小。
 */
export default function SpreadZoom({ onPrev, onNext, canPrev, canNext, onClose }: Props) {
  return (
    <div data-magnify-chrome className="fixed inset-0 z-50 pointer-events-none">
      {/* 翻页箭头：位置和预览页两侧那对一致。放大镜里也用同一对按钮翻页，
          走的是和点击书页完全一样的带动画翻页 */}
      <button
        onClick={onPrev}
        disabled={!canPrev}
        aria-label="上一页"
        className="pointer-events-auto absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-gray-200 transition-colors disabled:opacity-25 disabled:cursor-default"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        onClick={onNext}
        disabled={!canNext}
        aria-label="下一页"
        className="pointer-events-auto absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-gray-200 transition-colors disabled:opacity-25 disabled:cursor-default"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      <button
        onClick={onClose}
        aria-label="关闭放大"
        className="pointer-events-auto absolute top-5 right-6 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
      >
        ✕
      </button>

      {/* 提示条：书上下各留了 72px，不会压到书页上 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/50 text-xs text-white/75 whitespace-nowrap">
        点击书页翻页 · 键盘 ← → 也翻 · 点黑边或按 ESC 退出
      </div>
    </div>
  );
}
