import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, store } from '@/store';
import { setCurrentProject, setProjectList, createProject } from '@/store/projectSlice';
import { getAllProjects, saveProject, deleteProject, getImageAsset } from '@/utils/storage';
import { getImageURL } from '@/utils/image';
import { formatDate } from '@/utils/units';
import { drawPageContent } from '@/engine/drawPageContent';
import {
  exportAllProjects,
  parseBackup,
  importBackups,
  importTemplates,
  downloadBlob,
} from '@/utils/backup';
import type { ParsedBackup, ImportPlan, BackupBundle } from '@/utils/backup';
import { PRESET_FORMATS } from '@/types';
import type { Project, ImageElement } from '@/types';

/** 导出/导入进行中的状态。total 为 0 表示还在准备、进度未知 */
interface BusyState {
  title: string;
  done: number;
  total: number;
}

/** 导入时撞上同名相册，停下来问用户 */
interface ConflictState {
  parsed: ParsedBackup;
  /** 本地相册名 → id。判断撞车和"覆盖哪一本"都靠它 */
  byName: Map<string, string>;
  collisions: BackupBundle[];
}

export default function ProjectList() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    const list = await getAllProjects();
    setProjects(list);
    dispatch(setProjectList(list));

    // 逐个加载封面缩略图，边加载边显示，不要等所有都加载完
    for (const project of list) {
      const firstPage = project.pages[0];
      if (firstPage) {
        try {
          // 创建离屏 canvas（用低 DPI 加快加载）
          const format = PRESET_FORMATS.A5;
          const dpi = 48; // 封面缩略图用低 DPI，加快加载
          const canvas = document.createElement('canvas');
          canvas.width = Math.round((format.width / 25.4) * dpi);
          canvas.height = Math.round((format.height / 25.4) * dpi);
          const ctx = canvas.getContext('2d')!;

          // 加载第一页所有图片。
          //
          // 优先用上传时就存好的缩略图（200px）：封面画布才 280×397，拿它缩下去几乎不
          // 花时间。而原图是 12MP，缩到封面尺寸每张要 80ms —— 6 本相册实测 699ms，
          // 换成缩略图后 35ms。慢的不是解码，是这个巨大的下采样。
          // 缩略图是 dataURL，顺带也免掉了 objectURL 的回收问题。
          const imageElements = firstPage.elements.filter(el => el.type === 'image') as ImageElement[];
          const assets = new Map<string, HTMLImageElement>();

          await Promise.all(imageElements.map(async (el) => {
            const asset = await getImageAsset(el.imageId);
            if (!asset) return;

            const img = new Image();

            if (asset.thumbnail) {
              img.src = asset.thumbnail;
              await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              });
              assets.set(el.imageId, img);
              return;
            }

            // 老数据可能没存缩略图，退回原图
            const url = getImageURL(asset);
            img.src = url;
            await new Promise<void>((resolve) => {
              // 必须也等 onerror：只等 onload 的话，遇到坏图这里会永远挂着，
              // 后面所有相册的封面都跟着出不来
              img.onload = () => resolve();
              img.onerror = () => resolve();
            });
            // 图已经解码进 img 了，objectURL 用完就撤
            URL.revokeObjectURL(url);
            assets.set(el.imageId, img);
          }));

          // 渲染页面内容
          drawPageContent(ctx, firstPage, format, dpi, assets);

          // 转成 dataURL（质量低一点，加快加载）
          const url = canvas.toDataURL('image/jpeg', 0.7);
          // 逐个更新，边加载边显示
          setCoverUrls(prev => ({ ...prev, [project.id]: url }));
        } catch (e) {
          console.error('渲染封面失败', e);
          // 降级：直接拿第一张图片当封面
          const firstImage = firstPage.elements.find(el => el.type === 'image') as ImageElement | undefined;
          if (firstImage) {
            const asset = await getImageAsset(firstImage.imageId);
            if (asset) {
              // 缩略图优先：它本来就只是个封面，够用，而且不会留下没人回收的 objectURL
              const url = asset.thumbnail || getImageURL(asset);
              setCoverUrls(prev => ({ ...prev, [project.id]: url }));
            }
          }
        }
      }
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    dispatch(createProject({ name: newName.trim() }));
    setTimeout(async () => {
      const state = store.getState();
      if (state.project.current) {
        await saveProject(state.project.current);
        navigate(`/editor/${state.project.current.id}`);
      }
    }, 50);
    setShowCreate(false);
    setNewName('');
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('确定删除这个相册吗？此操作不可恢复。')) return;
    await deleteProject(id);
    loadProjects();
  }

  function handleEdit(project: Project, e: React.MouseEvent) {
    e.stopPropagation();
    dispatch(setCurrentProject(project));
    navigate(`/editor/${project.id}`);
  }

  function handlePreview(project: Project, e: React.MouseEvent) {
    e.stopPropagation();
    dispatch(setCurrentProject(project));
    navigate(`/viewer/${project.id}`);
  }

  // ==================== 备份：导出 / 导入 ====================
  // 相册平时就存在浏览器里，这一对按钮负责"搬出去"和"搬回来"。
  // 都是重活（几百 MB 要读、要压、要写），全程盖一层进度，并且明说别关页面。

  async function handleExport() {
    setBusy({ title: '正在打包相册…', done: 0, total: 0 });
    try {
      const { blob, filename, templateCount } = await exportAllProjects((done, total) => {
        setBusy({ title: '正在打包相册…', done, total });
      });
      downloadBlob(blob, filename);
      setBusy(null);
      setToast(
        `已导出 ${(blob.size / 1024 / 1024).toFixed(1)} MB` +
          (templateCount > 0 ? `（含 ${templateCount} 个自定义模板）` : '') +
          `。请把「${filename}」存到网盘或 U 盘——换电脑时用它就能恢复。`
      );
    } catch (err) {
      setBusy(null);
      alert(err instanceof Error ? err.message : '导出失败');
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 清空 value，否则同一个文件再选一次不会触发 change
    e.target.value = '';
    if (!file) return;

    setBusy({ title: '正在读取备份包…', done: 0, total: 0 });
    try {
      const parsed = await parseBackup(file);
      // 用库里最新的数据判断重名，不用页面上的 state——那可能已经过时了
      const local = await getAllProjects();
      const byName = new Map(local.map((p) => [p.name, p.id]));
      const collisions = parsed.bundles.filter((b) => byName.has(b.project.name));
      setBusy(null);

      if (collisions.length > 0) {
        setConflict({ parsed, byName, collisions });
      } else {
        await runImport(parsed, parsed.bundles.map((b) => ({ bundle: b, mode: 'overwrite' as const })));
      }
    } catch (err) {
      setBusy(null);
      alert(err instanceof Error ? err.message : '导入失败');
    }
  }

  async function runImport(parsed: ParsedBackup, plans: ImportPlan[]) {
    setBusy({ title: '正在导入相册…', done: 0, total: 0 });
    try {
      const r = await importBackups(parsed.buf, plans, (done, total) => {
        setBusy({ title: '正在导入相册…', done, total });
      });
      // 模板跟着相册一起进库，不用用户再单独操作一次
      const t = await importTemplates(parsed.templates);
      setBusy(null);
      setConflict(null);

      // 备份包可能只有模板（或只有相册），不要提示"已导入 0 本相册"
      const parts: string[] = [];
      if (r.projects > 0) parts.push(`${r.projects} 本相册`);
      if (r.images > 0) parts.push(`${r.images} 张照片`);
      if (t.added + t.updated > 0) parts.push(`${t.added + t.updated} 个自定义模板`);
      setToast(`已导入 ${parts.join('、')}。`);

      await loadProjects();
    } catch (err) {
      setBusy(null);
      alert(err instanceof Error ? err.message : '导入失败');
    }
  }

  /** 撞车了：备份里的这几本，顶掉本地同名的那本 */
  function handleOverwrite() {
    if (!conflict) return;
    const plans: ImportPlan[] = conflict.parsed.bundles.map((b) => {
      const targetId = conflict.byName.get(b.project.name);
      return targetId ? { bundle: b, mode: 'overwrite', targetId } : { bundle: b, mode: 'overwrite' };
    });
    runImport(conflict.parsed, plans);
  }

  /** 撞车了：备份额外存一份，本地那本原封不动 */
  function handleKeepBoth() {
    if (!conflict) return;
    const plans: ImportPlan[] = conflict.parsed.bundles.map((b) =>
      conflict.byName.has(b.project.name)
        ? { bundle: b, mode: 'duplicate' as const }
        : { bundle: b, mode: 'overwrite' as const }
    );
    runImport(conflict.parsed, plans);
  }

  return (
    <div className="w-full h-full flex bg-[#f5f3ef]">
      {/* 左侧书架区 */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* 左侧头部 */}
        <div className="h-16 flex items-center px-8 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-amber-600 to-amber-800 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-sm">
              书
            </div>
            <h1 className="text-xl font-semibold text-gray-800">我的照片书架</h1>
          </div>
        </div>

        {/* 备份提醒。
            放在这个位置是有意的：网站没法在"用户清浏览器数据/换电脑"的那一刻提醒他——
            那时候这个页面根本没在运行。所以唯一能做的，是每次他打开书架就把话说清楚，
            并且指明出路（右下角那两个按钮）。 */}
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

        {/* 书架内容 */}
        <div className="flex-1 overflow-auto p-8" style={{ paddingTop: '2rem' }}>
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <div className="text-6xl mb-4">📖</div>
              <p className="text-lg">还没有相册，点击右侧创建第一个吧</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
              {projects.map((project) => (
                <div key={project.id} className="group relative">
                  {/* 封面 */}
                  <div className="relative">
                    <div
                      className="aspect-[3/4] rounded-r-lg overflow-hidden shadow-md hover:shadow-2xl transition-all cursor-pointer relative"
                      onClick={(e) => handlePreview(project, e)}
                      style={{
                        boxShadow: '2px 2px 8px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.05)',
                      }}
                    >
                      {coverUrls[project.id] ? (
                        <img
                          src={coverUrls[project.id]}
                          alt={project.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400 text-4xl">
                          📷
                        </div>
                      )}
                      {/* hover 遮罩 */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                    </div>
                    {/* 左侧阴影（书的厚度感） */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-gradient-to-r from-gray-300 to-gray-200"
                      style={{ transform: 'translateX(-3px)' }}
                    />
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => handleDelete(project.id, e)}
                      className="absolute top-2 right-2 w-7 h-7 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 flex items-center justify-center text-sm z-10"
                    >
                      ×
                    </button>
                  </div>
                  {/* 书名 */}
                  <p className="mt-3 text-sm text-gray-700 text-center truncate">{project.name}</p>
                  {/* 按钮 */}
                  <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleEdit(project, e)}
                      className="flex-1 py-1.5 text-xs bg-white border border-gray-200 text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      ✏️ 编辑
                    </button>
                    <button
                      onClick={(e) => handlePreview(project, e)}
                      className="flex-1 py-1.5 text-xs bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors"
                    >
                      👁 预览
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* 右侧文字区 - 杂志风格 */}
      <div className="w-[380px] flex-shrink-0 p-8 bg-[#ede8df] flex flex-col">
        {/* 顶部小标签 */}
        <div className="text-xs text-gray-400 mb-2 tracking-wider">MY PHOTO BOOK SHELF</div>

        {/* 大标题 */}
        <h2 className="text-4xl font-bold text-gray-900 mb-4 tracking-tight" style={{ fontFamily: 'FangSong, 仿宋, STSong, serif' }}>
          是你的书
        </h2>

        {/* 正文介绍 */}
        <p className="text-sm text-gray-700 leading-relaxed mb-6">
          把照片做成一本书，记录你走过的路，遇见的树，和某一瞬间的小感悟。
        </p>

        {/* 引用语 */}
        <div className="border-l-2 border-gray-300 pl-4 mb-8">
          <p className="leading-relaxed text-gray-600 italic" style={{ fontSize: '0.75rem' }}>
            「当照片被重新排列，一段旅程也重新获得了时间。」
          </p>
          <p className="text-xs text-gray-400 mt-2">— 关于相册的意义</p>
        </div>

        {/* 信息栏 */}
        <div className="grid grid-cols-2 gap-4 py-5 border-t border-gray-300">
          <div>
            <div className="text-xs text-gray-400 mb-1">形式</div>
            <div className="text-sm text-gray-700">电子相册 · A5 竖版</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">收藏</div>
            <div className="text-sm text-gray-700">个人珍藏版</div>
          </div>
        </div>

        {/* 装饰插画：书架女孩（自动填充中间剩余空间） */}
        <div className="flex-1 flex items-center justify-center py-4">
          <img
            src="https://aka.doubaocdn.com/s/7Ac3nyqva8"
            alt="书架女孩"
            className="w-full max-w-xs"
            style={{ mixBlendMode: 'multiply' }}
          />
        </div>

        {/* 底部按钮区（自动推到最底部） */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate('/create')}
            className="w-full px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-800 text-white rounded-lg hover:from-amber-700 hover:to-amber-900 transition-all font-medium shadow-sm"
          >
            ✨ 智能生成
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="w-full px-5 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            + 空白相册
          </button>

          {/* 备份。单独一栏、样式更轻：它是偶尔才用一次的兜底动作，
              不该跟"新建相册"抢注意力，但也不能藏起来——上面那条横幅指着它。 */}
          <div className="mt-1 pt-3 border-t border-gray-400/40 grid grid-cols-2 gap-2">
            <button
              onClick={handleExport}
              disabled={busy !== null}
              title="把整个书架打包成一个 zip 文件下载下来"
              className="px-3 py-2 bg-white/70 border border-gray-300 text-gray-600 rounded-lg hover:bg-white transition-colors text-sm disabled:opacity-50"
            >
              📦 导出备份
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== null}
              title="从备份 zip 里恢复相册"
              className="px-3 py-2 bg-white/70 border border-gray-300 text-gray-600 rounded-lg hover:bg-white transition-colors text-sm disabled:opacity-50"
            >
              📥 导入备份
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </div>

      {/* 新建弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">新建相册</h2>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="输入相册名称..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-amber-600 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                取消
              </button>
              <button onClick={handleCreate} className="px-4 py-2 bg-amber-700 text-white rounded-lg hover:bg-amber-800">
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重名询问。整个导入过程只在这里停一次，之后一口气做完 */}
      {conflict && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[28rem] shadow-xl">
            <h2 className="text-lg font-semibold mb-3">
              有 {conflict.collisions.length} 本相册重名了
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              备份里有 {conflict.parsed.bundles.length} 本相册，其中这几本的书架上已经有了：
            </p>
            <ul className="mb-4 max-h-40 overflow-auto text-sm text-gray-800 bg-gray-50 rounded-lg p-3 space-y-1">
              {conflict.collisions.map((c) => (
                <li key={c.folder} className="truncate">
                  《{c.project.name}》
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleOverwrite}
                className="w-full px-4 py-2.5 bg-amber-700 text-white rounded-lg hover:bg-amber-800 text-left"
              >
                <div className="font-medium">用备份里的覆盖</div>
                <div className="text-xs text-amber-100 mt-0.5">
                  书架上那几本会被备份里的内容替换掉
                </div>
              </button>
              <button
                onClick={handleKeepBoth}
                className="w-full px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-left"
              >
                <div className="font-medium">两份都保留</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  备份里的会以「（导入）」为名新加进来，原有的不动
                </div>
              </button>
              <button
                onClick={() => setConflict(null)}
                className="w-full px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm"
              >
                取消，什么都不做
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 进度。几百 MB 的活儿要跑一阵，得让用户知道在动、以及别关页面 */}
      {busy && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-8 w-96 shadow-xl text-center">
            <div className="text-base font-medium text-gray-800 mb-4">{busy.title}</div>
            {busy.total > 0 ? (
              <>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-600 transition-all duration-200"
                    style={{ width: `${Math.round((busy.done / busy.total) * 100)}%` }}
                  />
                </div>
                <div className="text-sm text-gray-500 mt-2">
                  {busy.done} / {busy.total}
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-400">准备中…</div>
            )}
            <div className="text-xs text-gray-400 mt-4">请先不要关闭这个页面</div>
          </div>
        </div>
      )}

      {/* 结果提示 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-lg px-5 py-3 bg-gray-900/92 text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
