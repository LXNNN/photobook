import type { FolderStatus } from '@/utils/folderMode';

/**
 * 书架页顶部的文件夹状态横幅（§5.2，文案 §9.1）。
 * 按四种状态显示不同内容；浏览器不支持文件夹模式时，退回原来的琥珀色备份提醒。
 *
 * 纯展示组件：连接的确认弹窗、进度、结果提示都由 ProjectList 管（它那套弹窗/进度已有现成实现）。
 */
interface Props {
  status: FolderStatus;
  /** 连接/迁移/删除进行中：按钮禁用 */
  busy: boolean;
  /** 选择 / 重新选择 / 重新指认文件夹（同一个动作，走同一套合并） */
  onPick: () => void;
  /** 浏览器重启后权限待确认时的「重新连接」 */
  onReconnect: () => void;
}

export default function FolderBanner({ status, busy, onPick, onReconnect }: Props) {
  // 不支持（Firefox / Safari）：维持原来的琥珀色备份提醒，一个字不动
  if (status.state === 'unsupported') {
    return (
      <div className="flex-shrink-0 mx-8 mb-1 px-5 py-3.5 rounded-lg bg-amber-50 border border-amber-300 flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5">⚠️</span>
        <div className="text-sm leading-relaxed">
          <span className="font-semibold text-amber-900">
            相册只存在这台电脑的这个浏览器里，没有上传到网上。
          </span>
          <span className="text-amber-800">
            清除浏览数据、换浏览器或换电脑，都可能让相册消失。请点右下角
            <span className="font-medium">「导出备份」</span>
            ，把生成的 zip 文件存到网盘或 U 盘；换电脑时用
            <span className="font-medium">「导入备份」</span>
            就能原样恢复。
          </span>
        </div>
      </div>
    );
  }

  if (status.state === 'connected') {
    // 安静的状态条：日常不需要用户做任何事
    return (
      <div className="flex-shrink-0 mx-8 mb-1 px-5 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-3">
        <span className="text-base leading-none">📁</span>
        <span className="text-sm text-emerald-800 flex-1">
          已存到电脑文件夹：<span className="font-medium">{status.folderName || '已连接的文件夹'}</span>
          {status.pendingWrites && <span className="text-emerald-600 ml-2">（有改动正在写入…）</span>}
        </span>
        <button
          onClick={onPick}
          disabled={busy}
          className="text-xs text-emerald-700 hover:text-emerald-900 underline underline-offset-2 disabled:opacity-50"
        >
          重新选择
        </button>
      </div>
    );
  }

  if (status.state === 'needs-reconnect') {
    return (
      <div
        className={`flex-shrink-0 mx-8 mb-1 px-5 py-3.5 rounded-lg bg-amber-50 border flex items-start gap-3 ${
          status.attention ? 'border-amber-400 ring-2 ring-amber-200' : 'border-amber-300'
        }`}
      >
        <span className="text-lg leading-none mt-0.5">🔌</span>
        <div className="text-sm leading-relaxed flex-1">
          <div className="font-semibold text-amber-900">
            文件夹连接需要重新确认一下{status.folderName ? `（${status.folderName}）` : ''}
          </div>
          <div className="text-amber-800">
            照片都还在。点「重新连接」，在浏览器弹出的框里选「每次访问时允许」，以后打开就不用再点了
          </div>
        </div>
        <button
          onClick={onReconnect}
          disabled={busy}
          className="self-center px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          重新连接
        </button>
      </div>
    );
  }

  if (status.state === 'folder-missing') {
    return (
      <div className="flex-shrink-0 mx-8 mb-1 px-5 py-3.5 rounded-lg bg-red-50 border border-red-300 flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5">🔍</span>
        <div className="text-sm leading-relaxed flex-1">
          <div className="font-semibold text-red-900">
            找不到相册文件夹了{status.folderName ? `（${status.folderName}）` : ''}
          </div>
          <div className="text-red-800">
            可能是被移动、改名，或者 U 盘/移动硬盘没有插上。找回后点「重新指认文件夹」，数据不会丢
          </div>
        </div>
        <button
          onClick={onPick}
          disabled={busy}
          className="self-center px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          重新指认文件夹
        </button>
      </div>
    );
  }

  // off：支持文件夹模式但还没启用 → 推荐启用
  return (
    <div className="flex-shrink-0 mx-8 mb-1 px-5 py-3.5 rounded-lg bg-sky-50 border border-sky-200 flex items-start gap-3">
      <span className="text-lg leading-none mt-0.5">📁</span>
      <div className="text-sm leading-relaxed flex-1">
        <div className="font-semibold text-sky-900">照片和相册可以存到电脑文件夹里</div>
        <div className="text-sky-800">存到文件夹就不怕清浏览器数据，换电脑也能随手带走</div>
      </div>
      <button
        onClick={onPick}
        disabled={busy}
        className="self-center px-4 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        选择文件夹
      </button>
    </div>
  );
}
