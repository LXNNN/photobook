import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from '@/store';
import { setCurrentProject } from '@/store/projectSlice';
import { setCurrentPage as setCurrentPageAction } from '@/store/editorSlice';
import { THEMES } from '@/templates/themes';
import { autoGenerateAlbum, type AutoPhoto } from '@/utils/autoLayout';
import { analyzePhotoWeight } from '@/utils/photoAnalysis';
import { createPreviewImage, fileToImageAsset, isImageFile, toDisplayableFile } from '@/utils/image';
import { saveImageAsset } from '@/utils/assetStore';
import { generateId } from '@/utils/units';
import { ensureFolderReady, ensureAlbumFolder, persistProject } from '@/utils/folderLibrary';
import { PRESET_FORMATS } from '@/types';
import type { ImageAsset } from '@/types';

// 启动守卫在 StrictMode 下会跑两遍，提示只弹一次
let folderGuardAlerted = false;

/** 上传页格子里的照片。`file` 是原图（落盘、印刷都用它），`preview` 只是给格子看的小图 */
type PickedImage = {
  /** 拖动排序会让下标变来变去，异步生成预览要靠这个稳定 id 找回来 */
  id: string;
  file: File;
  /** 小预览图（dataURL）。还没生成好时是 null，格子上先显示转圈 */
  preview: string | null;
  /** 预览图两种做法都没啃动（罕见的损坏文件）。别再转圈了，直接说一声 */
  previewFailed?: boolean;
};

/** 同时做几张预览图。4 路是实测的甜点：40 张 30MP 照片 3.9 秒做完；
 *  再往上收益就小了，而且同时解码的大图越多越吃内存 */
const PREVIEW_CONCURRENCY = 4;

type Step = 'upload' | 'settings' | 'generating';

export default function CreateWizard() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 还在列表里的照片 id：预览图是慢慢生成的，动手前先确认用户没把它删掉/清空
  const liveIdsRef = useRef<Set<string>>(new Set());

  const [step, setStep] = useState<Step>('upload');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [projectName, setProjectName] = useState('');
  const [nameError, setNameError] = useState('');
  const [selectedTheme, setSelectedTheme] = useState(THEMES[0].id);
  const [includeCover, setIncludeCover] = useState(true);
  const [includeEnding, setIncludeEnding] = useState(true);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [converting, setConverting] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // 启动时已启用文件夹模式但还没连上：不进入（§5.3），先回书架重连
  useEffect(() => {
    if (ensureFolderReady()) return;
    if (!folderGuardAlerted) {
      folderGuardAlerted = true;
      alert('文件夹还没连上。先回书架页点「重新连接」，连上再生成相册吧');
    }
    navigate('/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========== 图片上传 ==========
  /**
   * 给格子生成小预览图，边做边往界面上贴。
   *
   * 不能把原图直接塞进 `<img src>`：40 张 30MP 的照片，浏览器要解码出 4.33GB 位图，
   * 实测主线程卡死 2.4 秒；格子上的鼠标扫过都会卡成幻灯片（33 秒里积了 31 秒长任务）。
   * 缩成 400px 的小图之后，最长阻塞降到 150ms 以内，鼠标扫过格子的长任务归零。
   *
   * 只影响格子：生成相册走的是 `PickedImage.file`，一个像素都不动。
   */
  const buildPreviews = useCallback(async (items: PickedImage[]) => {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        // 已经被删掉/清空了就别白解码了（一次要几十毫秒到几百毫秒）
        if (!liveIdsRef.current.has(item.id)) continue;
        try {
          const preview = await createPreviewImage(item.file);
          if (!liveIdsRef.current.has(item.id)) continue;
          setImages((prev) => prev.map((im) => (im.id === item.id ? { ...im, preview } : im)));
        } catch (err) {
          // 不影响后续：生成相册用的是原文件，不依赖预览
          console.error('预览图生成失败:', item.file.name, err);
          setImages((prev) => prev.map((im) => (im.id === item.id ? { ...im, previewFailed: true } : im)));
        }
      }
    };
    await Promise.all(Array.from({ length: PREVIEW_CONCURRENCY }, worker));
  }, []);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files).filter(isImageFile);
    if (picked.length === 0) return;

    // HEIC 在这里就转成 JPEG：Chrome 渲染不了 HEIC，不转的话预览和画布都是破图。
    // 转好之后生成阶段拿到的已经是 JPEG，不用再转第二次。
    setConverting(true);
    try {
      const newImages: PickedImage[] = [];
      for (const file of picked) {
        const usable = await toDisplayableFile(file);
        newImages.push({ id: generateId(), file: usable, preview: null });
      }
      newImages.forEach((im) => liveIdsRef.current.add(im.id));
      setImages((prev) => [...prev, ...newImages]);
      // 格子先出来，预览图随后一张张填进去（不 await，别让上传按钮干等）
      void buildPreviews(newImages);
    } catch (err) {
      console.error('读取照片失败:', err);
      alert(`照片读取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConverting(false);
    }
  }, [buildPreviews]);

  const handleRemoveImage = (index: number) => {
    const removed = images[index];
    if (removed) liveIdsRef.current.delete(removed.id);
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearImages = () => {
    liveIdsRef.current.clear();
    setImages([]);
  };

  // 离开页面时让还在跑的预览流水线停下
  useEffect(() => () => liveIdsRef.current.clear(), []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (converting) return;
    handleFileSelect(e.dataTransfer.files);
  };

  // ========== 生成相册 ==========
  const handleGenerate = async () => {
    if (images.length === 0) return;
    if (!projectName.trim()) {
      setNameError('请输入相册名称');
      return;
    }
    setStep('generating');
    setProgress(0);

    try {
      // 1. 先把照片处理成资产（这一步还不落盘），顺便在本地算「画面分量」
      //    给智能排版挑主角用 —— 只读 200px 缩略图，照片不出电脑
      const imageAssets: ImageAsset[] = [];
      const autoPhotos: AutoPhoto[] = [];
      for (let i = 0; i < images.length; i++) {
        const asset = await fileToImageAsset(images[i].file);
        imageAssets.push(asset);
        autoPhotos.push({
          id: asset.id,
          width: asset.width,
          height: asset.height,
          weight: await analyzePhotoWeight(asset.thumbnail),
        });
        setProgress(Math.round(((i + 1) / images.length) * 40));
      }

      // 2. 自动排版生成项目（先有相册，照片才知道该写进哪个文件夹）
      const project = autoGenerateAlbum({
        projectName: projectName.trim(),
        themeId: selectedTheme,
        photos: autoPhotos,
        format: PRESET_FORMATS.A5,
        // 正文字号不在这里选了，统一用默认的 13pt（DEFAULT_BODY_FONT_SIZE）；
        // 想改的话是生成之后在编辑页「🎨 正文样式」里改
        includeCover,
        includeEnding,
      });

      // 3. 已连接文件夹时，先把这本相册的文件夹建好
      await ensureAlbumFolder(project);

      // 4. 照片逐张写盘（已连接 → 写进相册文件夹；未启用 → IndexedDB，现状）
      for (let i = 0; i < imageAssets.length; i++) {
        await saveImageAsset(project.id, imageAssets[i]);
        setProgress(40 + Math.round(((i + 1) / imageAssets.length) * 50));
      }

      // 5. 保存项目：IndexedDB + 文件夹里的 相册数据.json
      await persistProject(project);
      dispatch(setCurrentProject(project));
      // 跳转到编辑页面前，把当前页设置成第一页（封面）
      dispatch(setCurrentPageAction(0));

      setProgress(100);

      // 6. 跳转到编辑器
      setTimeout(() => {
        navigate(`/editor/${project.id}`);
      }, 500);
    } catch (error) {
      console.error('生成失败:', error);
      alert('生成失败，请重试');
      setStep('settings');
    }
  };

  // ========== 渲染 ==========
  return (
    <div className="w-full h-full flex flex-col bg-[#f5f5f0]">
      {/* 顶部栏 */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700 text-sm">
            ← 返回
          </button>
          <div className="w-9 h-9 bg-gradient-to-br from-amber-600 to-amber-800 rounded-lg flex items-center justify-center text-white font-bold text-lg">
            册
          </div>
          <h1 className="text-xl font-semibold text-gray-800">智能生成相册</h1>
        </div>

        {/* 步骤指示 */}
        <div className="flex items-center gap-2">
          <StepBadge number={1} label="上传图片" active={step === 'upload'} done={step !== 'upload'} />
          <div className="w-8 h-px bg-gray-300" />
          <StepBadge number={2} label="设置" active={step === 'settings'} done={step === 'generating'} />
          <div className="w-8 h-px bg-gray-300" />
          <StepBadge number={3} label="生成" active={step === 'generating'} done={false} />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-8">
        {/* ========== 步骤1：上传图片 ========== */}
        {step === 'upload' && (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-lg font-medium text-gray-700 mb-4">选择照片</h2>
            <p className="text-sm text-gray-500 mb-6">一次可以选择多张照片，系统会自动排版生成相册。建议上传 4-20 张效果最佳。</p>

            {/* 拖拽上传区域 */}
            <div
              onClick={() => { if (!converting) fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); if (!converting) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                converting ? 'border-amber-400 bg-amber-50 cursor-wait'
                  : dragOver ? 'border-amber-500 bg-amber-50 cursor-pointer'
                  : 'border-gray-300 hover:border-amber-400 hover:bg-gray-50 cursor-pointer'
              }`}
            >
              <div className="text-5xl mb-4">{converting ? '⏳' : '📷'}</div>
              <p className="text-gray-600 mb-2">
                {converting ? '正在读取照片…' : '点击选择照片，或拖拽照片到此处'}
              </p>
              <p className="text-xs text-gray-400">支持 JPG、PNG、WEBP、HEIC 格式</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              onChange={(e) => handleFileSelect(e.target.files)}
              className="hidden"
            />

            {/* 已选图片预览 */}
            {images.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-gray-700">已选 {images.length} 张照片</h3>
                  <button onClick={handleClearImages} className="text-xs text-gray-400 hover:text-red-500">
                    清空全部
                  </button>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                  {images.map((img, index) => (
                    <div
                      key={img.id}
                      draggable
                      onDragStart={(e) => {
                        setDragIndex(index);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragIndex !== null && dragIndex !== index) {
                          setDragOverIndex(index);
                        }
                      }}
                      onDragLeave={() => setDragOverIndex(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIndex !== null && dragIndex !== index) {
                          // 交换位置
                          setImages((prev) => {
                            const newImages = [...prev];
                            const [moved] = newImages.splice(dragIndex, 1);
                            newImages.splice(index, 0, moved);
                            return newImages;
                          });
                        }
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      className={`relative group aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-move transition-all ${dragOverIndex === index ? 'ring-2 ring-amber-500 scale-105' : ''} ${dragIndex === index ? 'opacity-50' : ''}`}
                    >
                      {img.preview ? (
                        <img src={img.preview} alt="" className="w-full h-full object-cover" />
                      ) : img.previewFailed ? (
                        // 生成不出预览（罕见的损坏文件）。照片本身还在，生成相册不受影响
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-400">
                          <span className="text-lg">🖼️</span>
                          <span className="text-[10px]">无法预览</span>
                        </div>
                      ) : (
                        // 预览还没做出来。转圈而不是空灰块，免得看起来像加载失败
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-amber-600 animate-spin" />
                        </div>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveImage(index); }}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 flex items-center justify-center text-xs"
                      >
                        ×
                      </button>
                      <div className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">
                        {index + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 下一步按钮 */}
            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setStep('settings')}
                disabled={images.length === 0 || converting}
                className="px-6 py-2.5 bg-amber-700 text-white rounded-lg hover:bg-amber-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                下一步 →
              </button>
            </div>
          </div>
        )}

        {/* ========== 步骤2：设置 ========== */}
        {step === 'settings' && (
          <div className="max-w-3xl mx-auto">
            <h2 className="text-lg font-medium text-gray-700 mb-6">相册设置</h2>

            {/* 相册名称 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                相册名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (nameError) setNameError('');
                }}
                placeholder="给相册起个名字吧..."
                className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none text-sm ${
                  nameError
                    ? 'border-red-400 focus:border-red-500'
                    : 'border-gray-300 focus:border-amber-600'
                }`}
              />
              {nameError && (
                <p className="text-xs text-red-500 mt-1.5">{nameError}</p>
              )}
            </div>

            {/* 主题选择 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">选择文案主题</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => setSelectedTheme(theme.id)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      selectedTheme === theme.id
                        ? 'border-amber-500 bg-amber-50 shadow-md'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="text-2xl mb-2">{theme.icon}</div>
                    <div className="text-sm font-medium text-gray-800">{theme.name}</div>
                    <div className="text-xs text-gray-400 mt-1 line-clamp-2">{theme.description}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                主题仅影响文案内容，不改变排版布局
              </p>
            </div>

            {/* 高级选项 */}
            <div className="mb-8 p-4 bg-gray-50 rounded-lg">
              <label className="block text-sm font-medium text-gray-700 mb-3">高级选项</label>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCover}
                    onChange={(e) => setIncludeCover(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm text-gray-600">生成封面页（大标题+首图）</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeEnding}
                    onChange={(e) => setIncludeEnding(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm text-gray-600">生成结尾页（寄语）</span>
                </label>
              </div>
            </div>

            {/* 按钮 */}
            <div className="flex justify-between">
              <button
                onClick={() => setStep('upload')}
                className="px-6 py-2.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ← 上一步
              </button>
              <button
                onClick={handleGenerate}
                className="px-8 py-2.5 bg-amber-700 text-white rounded-lg hover:bg-amber-800 transition-colors font-medium"
              >
                ✨ 开始生成
              </button>
            </div>
          </div>
        )}

        {/* ========== 步骤3：生成中 ========== */}
        {step === 'generating' && (
          <div className="max-w-md mx-auto text-center py-20">
            <div className="text-6xl mb-6 animate-pulse">🎨</div>
            <h2 className="text-xl font-medium text-gray-700 mb-4">正在智能生成相册...</h2>
            <p className="text-sm text-gray-500 mb-8">
              {progress < 50 ? '正在处理照片...' : progress < 80 ? '正在自动排版...' : '正在保存...'}
            </p>

            {/* 进度条 */}
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-700 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-400">{progress}%</p>
          </div>
        )}
      </main>
    </div>
  );
}

/** 步骤徽章 */
function StepBadge({ number, label, active, done }: { number: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
          done ? 'bg-green-500 text-white' : active ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-500'
        }`}
      >
        {done ? '✓' : number}
      </div>
      <span className={`text-xs ${active ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>{label}</span>
    </div>
  );
}
