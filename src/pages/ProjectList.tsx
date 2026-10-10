import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, store } from '@/store';
import { setCurrentProject, setProjectList, createProject } from '@/store/projectSlice';
import { getAllProjects, deleteProject } from '@/utils/storage';
import { getImageAsset, getImageMeta } from '@/utils/assetStore';
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
import FolderBanner from '@/components/FolderBanner';
import { subscribeFolderStatus, getFolderStatus, pickFolderHandle } from '@/utils/folderMode';
import type { ConnectPreview } from '@/utils/folderLibrary';
import {
  ensureFolderReady,
  prepareConnect,
  runSync,
  reconnectFolder,
  deleteAlbum,
  getAlbumFolderName,
  takeFolderNotices,
  persistProject,
} from '@/utils/folderLibrary';
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

/** 连接文件夹前的确认弹窗（迁移 or 载入已有数据） */
interface ConnectDialogState {
  handle: FileSystemDirectoryHandle;
  preview: ConnectPreview;
  mode: 'fresh' | 'migrate' | 'load';
}

/** 删除相册确认（已连接文件夹时：磁盘上的文件夹也会一起删，§6.10） */
interface DeleteDialogState {
  project: Project;
  folderName: string;
  photoCount: number;
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

  // 文件夹连接状态（模块级可订阅对象，同 templates 的既有模式）
  const folderStatus = useSyncExternalStore(subscribeFolderStatus, getFolderStatus);
  const [connectDialog, setConnectDialog] = useState<ConnectDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // 连接/合并在后台完成时 dataVersion 会 +1，书架跟着刷新；
  // 顺带取走文件夹层攒下的轻提示（同步移除、模板文件读坏等）
  useEffect(() => {
    loadProjects();
    const notes = takeFolderNotices();
    if (notes.length > 0) setToast(notes.join(' '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderStatus.dataVersion]);

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
          // 启用文件夹模式后这条路更重要：读全图要逐个读磁盘文件。
          const imageElements = firstPage.elements.filter(el => el.type === 'image') as ImageElement[];
          const assets = new Map<string, HTMLImageElement>();

          await Promise.all(imageElements.map(async (el) => {
            const img = new Image();
            const meta = await getImageMeta(el.imageId);
            if (meta?.thumbnail) {
              img.src = meta.thumbnail;
              await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              });
              assets.set(el.imageId, img);
              return;
            }

            // 老数据可能没存缩略图，退回原图（已启用文件夹时从磁盘读）
            const asset = await getImageAsset(el.imageId);
            if (!asset) return;
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
            // 缩略图优先：它本来就只是个封面，够用，而且不会留下没人回收的 objectURL
            const meta = await getImageMeta(firstImage.imageId);
            if (meta?.thumbnail) {
              setCoverUrls(prev => ({ ...prev, [project.id]: meta.thumbnail }));
            } else {
              const asset = await getImageAsset(firstImage.imageId);
              if (asset) setCoverUrls(prev => ({ ...prev, [project.id]: getImageURL(asset) }));
            }
          }
        }
      }
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    if (!guarded('创建')) return;
    dispatch(createProject({ name: newName.trim() }));
    setTimeout(async () => {
      const state = store.getState();
      if (state.project.current) {
        // 已连接文件夹时，persistProject 顺手把新相册的文件夹建好（§6.1）
        await persistProject(state.project.current);
        navigate(`/editor/${state.project.current.id}`);
      }
    }, 50);
    setShowCreate(false);
    setNewName('');
  }

  /** 守卫（§5.3）：文件夹模式已启用但没连上时，拦下需要读写磁盘的动作 */
  function guarded(action: string): boolean {
    if (ensureFolderReady()) return true;
    setToast(`文件夹还没连上，先点上面的「重新连接」再${action}`);
    return false;
  }

  async function handleDelete(project: Project, e: React.MouseEvent) {
    e.stopPropagation();
    if (!ensureFolderReady()) {
      setToast('文件夹还没连上，先点上面的「重新连接」再删除（删除时要同时清理磁盘上的照片）');
      return;
    }
    if (getFolderStatus().state !== 'connected') {
      // 未启用文件夹模式：删浏览器里的记录（deleteProject 会顺带清掉它不再被任何相册引用的照片记录）
      if (!confirm('确定删除这个相册吗？此操作不可恢复。')) return;
      await deleteProject(project.id);
      await loadProjects();
      return;
    }
    // 已连接：删之前必须说清磁盘上的文件夹也会一起删（§6.10；网站里唯一删磁盘文件的地方）
    const photoCount = new Set(
      project.pages
        .flatMap((p) => p.elements)
        .filter((el) => el.type === 'image' && el.imageId)
        .map((el) => (el as ImageElement).imageId)
    ).size;
    setDeleteDialog({
      project,
      folderName: getAlbumFolderName(project.id) ?? project.name,
      photoCount,
    });
  }

  function handleEdit(project: Project, e: React.MouseEvent) {
    e.stopPropagation();
    if (!guarded('编辑')) return;
    dispatch(setCurrentProject(project));
    navigate(`/editor/${project.id}`);
  }

  function handlePreview(project: Project, e: React.MouseEvent) {
    e.stopPropagation();
    if (!guarded('预览')) return;
    dispatch(setCurrentProject(project));
    navigate(`/viewer/${project.id}`);
  }

  // ==================== 文件夹模式：连接 / 重连 / 删除 ====================

  /** 选择 / 重新选择 / 重新指认文件夹：统一「先看两边有什么 → 需要时弹窗确认 → 合并」 */
  async function handlePickFolder() {
    if (busy) return;
    let handle: FileSystemDirectoryHandle | undefined;
    try {
      // 必须在点击手势里直接弹选择框，前面不能有别的 await
      handle = await pickFolderHandle();
    } catch {
      setToast('没能打开文件夹选择框，请再试一次');
      return;
    }
    if (!handle) return; // 用户取消了选择

    setBusy({ title: '正在看看文件夹里有什么…', done: 0, total: 0 });
    try {
      const prep = await prepareConnect(handle);
      setBusy(null);
      if (!prep.ok) {
        setToast(
          prep.reason === 'denied'
            ? '没有连接成功。照片都还在，可以再试一次，或在浏览器设置里允许本站的文件夹访问'
            : '连接文件夹失败，请再试一次'
        );
        return;
      }
      const p = prep.preview;
      const mode: ConnectDialogState['mode'] =
        p.hasPhotoBook && p.folderAlbumCount > 0
          ? 'load' // 文件夹里已经有相册（换电脑/换浏览器场景）
          : p.localAlbumCount > 0
            ? 'migrate' // 本机有相册要搬进去
            : 'fresh'; // 两边都空：直接建结构
      if (mode === 'fresh') {
        await runConnect(handle, p, 'fresh');
      } else {
        setConnectDialog({ handle, preview: p, mode });
      }
    } catch (err) {
      setBusy(null);
      console.error('检查文件夹失败', err);
      setToast('连接文件夹时出了点问题，可以再试一次');
    }
  }

  /** 弹窗确认后（或全新文件夹直接）开始合并。迁移与载入共用 runSync 一套规则（§6.5） */
  async function runConnect(
    handle: FileSystemDirectoryHandle,
    preview: ConnectPreview,
    mode: ConnectDialogState['mode']
  ) {
    setConnectDialog(null);
    const migrating = mode === 'migrate';
    setBusy({ title: migrating ? '正在把照片写进文件夹…' : '正在连接文件夹…', done: 0, total: 0 });
    try {
      const result = await runSync(handle, {
        // load 时文件夹里已有结构；fresh / migrate 都要先建好
        createRoot: mode !== 'load',
        onProgress: (p) =>
          setBusy((prev) => (prev ? { ...prev, done: p.done, total: p.total } : prev)),
      });
      setBusy(null);
      const parts: string[] = [];
      if (migrating) {
        parts.push(
          `搬家完成！照片已经在「${preview.folderName}」\\photo-book\\ 里（每本相册一个文件夹），现在清浏览器数据也不怕了`
        );
      } else {
        if (result.loaded > 0) parts.push(`已从文件夹载入 ${result.loaded} 本相册`);
        if (result.pushed > 0) parts.push(`已把 ${result.pushed} 本相册写进文件夹`);
        if (parts.length === 0) parts.push(`已连接文件夹：「${preview.folderName}」`);
      }
      const notes = takeFolderNotices();
      if (notes.length > 0) parts.push(notes.join(' '));
      setToast(parts.join(' '));
    } catch (err) {
      setBusy(null);
      console.error('连接文件夹失败', err);
      setToast('连接中途出了点问题。磁盘和浏览器里的数据都没丢，可以重试（已写好的会跳过）');
    }
  }

  /** 浏览器重启后权限待确认：在点击手势里重新申请，通过后立刻合并（§6.4） */
  async function handleReconnect() {
    if (busy) return;
    setBusy({ title: '正在重新连接…', done: 0, total: 0 });
    const r = await reconnectFolder();
    setBusy(null);
    if (r.ok) {
      const parts = [`已重新连接文件夹：「${getFolderStatus().folderName}」`];
      if (r.result.pushed > 0) parts.push(`有 ${r.result.pushed} 本相册的改动已补写进文件夹`);
      const notes = takeFolderNotices();
      if (notes.length > 0) parts.push(notes.join(' '));
      setToast(parts.join(' '));
    } else if (r.reason === 'denied') {
      setToast('没有连接成功。照片都还在，可以再试一次，或在浏览器设置里允许本站的文件夹访问');
    } else if (r.reason === 'folder-missing') {
      setToast('找不到相册文件夹了。请点「重新指认文件夹」重新选一下，数据不会丢');
    } else {
      setToast('重新连接失败，请再试一次');
    }
  }

  /** 删除确认弹窗里点了「删除」：书架记录 + 磁盘文件夹一起删 */
  async function confirmDelete() {
    if (!deleteDialog) return;
    const { project } = deleteDialog;
    setBusy({ title: '正在删除相册…', done: 0, total: 0 });
    try {
      const r = await deleteAlbum(project.id);
      setBusy(null);
      setDeleteDialog(null);
      if (r.failed.length > 0) {
        setToast(
          `相册已删除，但文件夹里有 ${r.failed.length} 个文件没能删掉（可能被占用），可以在电脑上手动删除 photo-book\\${r.folderName}`
        );
      } else {
        setToast(`《${project.name}》已删除，电脑文件夹里的数据也清干净了`);
      }
      // deleteAlbum 内部已 bumpDataVersion，上面的 effect 会刷新书架
    } catch (err) {
      setBusy(null);
      setDeleteDialog(null);
      setToast(err instanceof Error ? err.message : '删除失败，文件夹没有动');
    }
  }

  // ==================== 备份：导出 / 导入 ====================
  // 相册平时就存在浏览器里，这一对按钮负责"搬出去"和"搬回来"。
  // 都是重活（几百 MB 要读、要压、要写），全程盖一层进度，并且明说别关页面。

  async function handleExport() {
    if (!guarded('导出备份')) return;
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

        {/* 文件夹状态横幅（§5.2）。
            放在这个位置是有意的：网站没法在"用户清浏览器数据/换电脑"的那一刻提醒他——
            那时候这个页面根本没在运行。所以唯一能做的，是每次他打开书架就把「数据在哪」
            说清楚。浏览器不支持文件夹模式时，组件内部会退回原来那条琥珀色备份提醒。 */}
        <FolderBanner
          status={folderStatus}
          busy={busy !== null}
          onPick={handlePickFolder}
          onReconnect={handleReconnect}
        />

        {/* 书架内容 */}
        <div className="flex-1 overflow-auto p-8" style={{ paddingTop: '2rem' }}>
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <div className="text-6xl mb-4">📖</div>
              <p className="text-lg">还没有相册，点击右侧创建第一个吧</p>
              {/* 换电脑/换浏览器恢复的入口（§5.3） */}
              {folderStatus.state !== 'unsupported' && folderStatus.state !== 'connected' && (
                <button
                  onClick={handlePickFolder}
                  disabled={busy !== null}
                  className="mt-6 px-5 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
                >
                  📁 连接已有的相册文件夹
                </button>
              )}
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
                      onClick={(e) => handleDelete(project, e)}
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

      {/* 右侧文字区 - 杂志风格（响应式） */}
      <div className="w-[280px] sm:w-[320px] md:w-[360px] lg:w-[380px] flex-shrink-0 p-4 sm:p-6 md:p-7 lg:p-8 bg-[#ede8df] flex flex-col overflow-hidden">
        {/* 顶部小标签 */}
        <div className="text-[10px] sm:text-xs text-gray-400 mb-1 sm:mb-2 tracking-wider">MY PHOTO BOOK SHELF</div>

        {/* 大标题 */}
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-2 sm:mb-4 tracking-tight" style={{ fontFamily: 'FangSong, 仿宋, STSong, serif' }}>
          是你的书
        </h2>

        {/* 正文介绍 */}
        <p className="text-xs sm:text-sm text-gray-700 leading-relaxed mb-3 sm:mb-6">
          把照片做成一本书，记录你走过的路，遇见的树，和某一瞬间的小感悟。
        </p>

        {/* 引用语 */}
        <div className="border-l-2 border-gray-300 pl-3 sm:pl-4 mb-4 sm:mb-8 flex-shrink-0">
          <p className="leading-relaxed text-gray-600 italic" style={{ fontSize: '0.7rem' }}>
            「当照片被重新排列，一段旅程也重新获得了时间。」
          </p>
          <p className="text-[10px] sm:text-xs text-gray-400 mt-1 sm:mt-2">— 关于相册的意义</p>
        </div>

        {/* 信息栏 */}
        <div className="grid grid-cols-2 gap-2 sm:gap-4 py-3 sm:py-5 border-t border-gray-300 flex-shrink-0">
          <div>
            <div className="text-[10px] sm:text-xs text-gray-400 mb-0.5 sm:mb-1">形式</div>
            <div className="text-xs sm:text-sm text-gray-700">电子相册 · A5 竖版</div>
          </div>
          <div>
            <div className="text-[10px] sm:text-xs text-gray-400 mb-0.5 sm:mb-1">收藏</div>
            <div className="text-xs sm:text-sm text-gray-700">个人珍藏版</div>
          </div>
        </div>

        {/* 装饰插画：书架女孩（自适应填充中间剩余空间） */}
        <div className="flex-1 flex items-center justify-center py-2 sm:py-4 min-h-0">
          <img
            src="https://aka.doubaocdn.com/s/7Ac3nyqva8"
            alt="书架女孩"
            className="w-full max-w-[160px] sm:max-w-[180px] md:max-w-[200px] lg:max-w-xs object-contain"
            style={{ mixBlendMode: 'multiply' }}
          />
        </div>

        {/* 底部按钮区（自动推到最底部） */}
        <div className="flex flex-col gap-2 sm:gap-3 flex-shrink-0">
          <button
            onClick={() => { if (guarded('创建')) navigate('/create'); }}
            className="w-full px-4 sm:px-5 py-2 sm:py-2.5 bg-gradient-to-r from-amber-600 to-amber-800 text-white rounded-lg hover:from-amber-700 hover:to-amber-900 transition-all font-medium shadow-sm text-sm"
          >
            ✨ 智能生成
          </button>
          <button
            onClick={() => { if (guarded('创建')) setShowCreate(true); }}
            className="w-full px-4 sm:px-5 py-2 sm:py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
          >
            + 空白相册
          </button>

          {/* 备份。单独一栏、样式更轻：它是偶尔才用一次的兜底动作，
              不该跟"新建相册"抢注意力，但也不能藏起来——上面那条横幅指着它。 */}
          <div className="mt-1 pt-2 sm:pt-3 border-t border-gray-400/40 grid grid-cols-2 gap-2">
            <button
              onClick={handleExport}
              disabled={busy !== null}
              title="把整个书架打包成一个 zip 文件下载下来"
              className="px-2 sm:px-3 py-1.5 sm:py-2 bg-white/70 border border-gray-300 text-gray-600 rounded-lg hover:bg-white transition-colors text-xs sm:text-sm disabled:opacity-50"
            >
              📦 导出备份
            </button>
            <button
              onClick={() => { if (guarded('导入备份')) fileInputRef.current?.click(); }}
              disabled={busy !== null}
              title="从备份 zip 里恢复相册"
              className="px-2 sm:px-3 py-1.5 sm:py-2 bg-white/70 border border-gray-300 text-gray-600 rounded-lg hover:bg-white transition-colors text-xs sm:text-sm disabled:opacity-50"
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

      {/* 连接文件夹前的确认：迁移（本机 → 文件夹）或载入（文件夹 → 本机），文案 §9.2 */}
      {connectDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setConnectDialog(null)}>
          <div className="bg-white rounded-xl p-6 w-[30rem] shadow-xl" onClick={(e) => e.stopPropagation()}>
            {connectDialog.mode === 'migrate' ? (
              <>
                <h2 className="text-lg font-semibold mb-3">把书架上的相册搬进文件夹？</h2>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">
                  书架上现有 {connectDialog.preview.localAlbumCount} 本相册、{connectDialog.preview.localPhotoCount} 张照片。
                  照片会一张一张写进「{connectDialog.preview.folderName}\photo-book\」下各本相册自己的文件夹里，
                  全部验证无误后再清理浏览器里的大图（缩略图保留）。中途关掉页面也没关系，下次接着搬。
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold mb-3">
                  这个文件夹里已经有相册（{connectDialog.preview.folderAlbumCount} 本）
                </h2>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">
                  要载入到这台电脑吗？两边都有的相册会保留更新的那本；这台电脑书架上有、文件夹里没有的，会一并写进文件夹。其余的原样都在。
                </p>
              </>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConnectDialog(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={() => runConnect(connectDialog.handle, connectDialog.preview, connectDialog.mode)}
                className="px-4 py-2 bg-amber-700 text-white rounded-lg hover:bg-amber-800"
              >
                {connectDialog.mode === 'migrate' ? '开始搬家' : '载入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除相册确认（已连接文件夹：磁盘上的文件夹会一起删，§6.10 / 文案 §9.2） */}
      {deleteDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteDialog(null)}>
          <div className="bg-white rounded-xl p-6 w-[30rem] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-3">删除《{deleteDialog.project.name}》？</h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              这本相册会从书架里删掉，{deleteDialog.photoCount} 张照片和它的排版数据也会从电脑文件夹（photo-book\
              {deleteDialog.folderName}）里一并删除，
              <span className="font-semibold text-red-600">不进回收站，不可恢复</span>。
            </p>
            <p className="text-xs text-gray-400 mb-4">
              想留个底的话，可以先用「导出备份」，或把这个文件夹复制一份。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteDialog(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 结果提示。背景必须用实心色：别写成 /92 这类透明度 —— Tailwind 只认档位值
          （/90、/75…），非档位的会被静默丢掉，背景直接变透明，白字落在白页上完全看不清 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-lg px-5 py-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
