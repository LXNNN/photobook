# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

电子相册网站（photo-book）：纯前端照片书编辑器。用户上传照片 → 自动排版（智能生成）或手动排版 → 翻书预览 → 导出 300dpi PDF 交给打印社。数据默认存在浏览器 IndexedDB，不上传服务器；推荐用户启用**文件夹模式**把相册写进电脑文件夹（见下文「文件夹模式」）。

- 技术栈：React 18 + TypeScript（strict）+ Vite 5 + Redux Toolkit + Tailwind CSS + page-flip（翻书动画）+ idb + jspdf + fflate + heic-to
- 部署：GitHub Pages，地址 `https://LXNNN.github.io/photobook/`
- 完整需求背景见 `项目设计文档.md` 和 `电子相册网站开发提示词.md`（后者是给 AI 的完整开发提示词，包含全部关键设计规则）
- 文字的「标题 / 正文」标记、默认字号颜色、封面尾页为什么排除——改字号、加模板、做全局样式弹窗之前，先看 `文字系统说明.md`
- 这些设计文档和 `docs/` **不上传 GitHub**（已写进 .gitignore 且已 `git rm --cached`），只保留在本地
- 面向用户的使用指南是 `电子相册网站-使用指南.md`（同步到飞书文档发给用户）；网站功能有变化时，提醒同步更新这份指南
- 这是一个个人项目，没有测试、没有 lint、没有 CI。验证靠真实浏览器手动测试（无头浏览器画不出书页，别用它验证渲染）

## 常用命令

```bash
npm run dev       # 开发服务器，端口固定 5173
npm run build     # tsc && vite build（类型检查 + 构建）
npm run preview   # 预览构建产物
```

- **不要改 dev 端口**：IndexedDB 按源（协议+域名+端口）隔离，换端口 = 换源 = 空书架，用户会以为数据丢了
- **装了新依赖要重启 dev server**：否则 Vite 预打包缓存里没有它，import 直接失败
- 构建部署：`npm run build` 后把 dist 推到 gh-pages 分支（dist 里有独立 git 仓库，细节见「部署注意」）

## 架构总览

### 数据模型与单位

- 所有元素几何量（x/y/width/height）以 **mm** 存储；开本 `BookFormat` 定义在 `src/types/index.ts`（默认 A5：148×210mm）
- `Project { pages: Page[] }`，`Page { background, elements: Element[], templateId? }`，`Element = ImageElement | TextElement | StickerElement`（含 rotation/opacity/zIndex/locked）
- `ImageElement.imageId` 指向 IndexedDB 里单独存储的 `ImageAsset`（blob 原图 + 200px 缩略图 dataURL）。`crop` 是相对原图 0-1 的裁剪区
- **裁剪属于「区域」不属于照片**：换位互换只换 `imageId`，永远不搬 `crop`（`projectSlice.swapImages`）。裁剪框的宽高比必须和所在框一致，否则 drawImage 会把照片拉变形——`fitCropToRatio` 是安全网，渲染时都会走一遍
- **删除相册会连照片记录一起清**：`storage.deleteProject` 先删相册记录，再把「它引用过、且其余相册都不再引用」的 id 从 `images` 表删掉（要查引用是因为备份重复导入会让两本相册共用照片 id；收集 id 用 `collectAssetIds`，别自己遍历 pages）。顺序不能反——中途失败最多留孤儿（无害），反过来会「相册还在、照片没了」

### 页面绘制只有一份实现（最重要）

`src/engine/drawPageContent.ts` 的 `drawPageContent(ctx, page, format, dpi, assets)` 是全站唯一的页面绘制规则，以下所有地方都调它，**任何改动都不能另写一套**：

- 编辑器主画布（`CanvasRenderer`，96dpi）
- 左侧页缩略图（`PageThumbnail`，先 `ctx.setTransform(scale,...)` 整体缩放，dpi 仍传 96，坐标/字号/折行点与主画布逐字一致）
- 首页书架封面（48dpi）
- 预览页整页渲染（150dpi）
- PDF 导出（300dpi）

同文件的 `collectAssetIds(pages)` 收集全部图片/贴纸 id——绘制依赖它收得全不全，新增元素类型时两边都要记得。历史上 Viewer 自己抄过一份绘制逻辑，漏了旋转和 cover 裁剪，缩略图/预览全错。

### 状态管理（Redux）

- `projectSlice`：当前项目 + 撤销栈 `past[]`（深拷贝快照，最多 50 步）。**任何改动操作前先 `pushHistory()`**
- `editorSlice`：当前页码、选中元素、zoom/pan；`uiSlice`：模式等
- `serializableCheck: false`（存 blob URL 等）
- 持久化：IndexedDB `photo-book-db`（`src/utils/storage.ts`），editor 里对 project 变更做了 3 秒防抖自动保存 + 手动保存

### 模板系统（src/templates/ + utils/templateLibrary.ts）

- `TEMPLATES` 是**模块级可变数组**（不是 Redux state）。React 组件必须用 `useSyncExternalStore(subscribeTemplates, getTemplatesVersion)` 订阅，否则增删模板后不重渲染
- 模板元素用相对坐标（0-1），`applyTemplate()` 时乘开本尺寸落成 mm
- 模板库 = 内置模板 + 用户自定义覆盖 − 用户删除。落盘在 IndexedDB（customTemplates / deletedTemplates 墓碑）。`initTemplateLibrary()` 在 `main.tsx` 里 React 渲染前 await
- **内置模板删除必须记墓碑**（deletedTemplates store），否则下次启动随内置模板一起复活
- `templates/` 不能反向 import `utils/storage`（循环引用）——持久化对齐都走 `utils/templateLibrary.ts`
- 文案填充规则：`fixed: true` 的文字（装饰性小字，如 TIME 竖排字母、"旅行碎片"）保持 placeholder 不动；`shortBody: true` 的小文字框取主题 `shortParagraphs` 里的一行短句；标题/正文优先看显式的 `title` / `body` 标记，没标记时按 `fontSizeRatio ≥ 0.04` 区分；正文字号用 `project.bodyFontSize`（默认 13）；旅行/日常主题用模板专属文案库，其他主题用主题文案库
- `pageElementsToTemplateElements` 写回模板时**必须带上 fixed / body / shortBody 标记**，否则存出来的模板下次应用时装饰文字会被随机文案顶掉、小框短句会被长正文撑出去
- 隐藏模板：`HIDDEN_TEMPLATE_IDS = ['full-image']`

### 智能排版（src/utils/autoLayout.ts + utils/photoAnalysis.ts）

- 创建页「✨ 开始生成」走 `autoGenerateAlbum({ photos })`。照片先转成 `AutoPhoto`（宽高 + `weight` 画面分量），`weight` 由 `photoAnalysis.analyzePhotoWeight` 读 200px 缩略图在本地算（对比度 / 边缘密度 / 饱和度），只活在内存、不落盘，照片不出电脑
- **按跨页成对规划**：正文页先复用 `spreadGroups()` 配成 `[1,2]`、`[3,4]`…，每对照片总数最多 `MAX_PHOTOS_PER_SPREAD = 8`（没有下限，小相册 1+1、2+2 都允许）。九宫格那一对固定 `[10,1]` 是唯一例外——九宫格要 ≥30 张才启用、一本最多一次
- 单图页有四个模板参与轮换：满版（`full-image-bordered`）、上图下文、上文下图、左图右文。**满版图必须和 ≥4 张照片的另一页配对**（满版没有文案，小跨页里会显得空）；1+1 / 1+2 / 1+3 时该页改用带文字的三个单图模板。落单页旁边是封面/尾页，不受这条限制
- 6 图模板在 ≥12 张时随机挑一对排 `[6,1]` / `[6,2]`（选页数时按 7 张给它预留容量，分配时那一对的下限也钉在 7，免得被前面的页吃光），一本最多一页；四图的 `four-magazine` **不参与智能排版**，只在模板面板供手动选用
- 图位分配 `orderPhotosForTemplate`：按图位面积从大到小贪心，`cropLoss` 衡量横竖裁切；最大图位有 `0.18 × weight` 的主角加成，但形状差太多时会让位（形状合适时 100% 进主角位，不合适时不硬塞）
- 模板整本轮换：`usage` 计整本使用次数，`usedInUnit` 保证同一对不重复，`lastTemplateId` 避开上一页。同一对里两张 `full-image-bordered` 允许重复（满版单图并排是正常节奏）
- `fillTextElements` 认 `body` / `shortBody` / 标题线；`shortBody` 只给 `five-collage-whitespace` 那种小文字框取一行短句。`applyTemplate` 必须把 `shortBody` 写进 `TextElement`，否则会被长正文顶出框
- 总页数永远是偶数（封面/结尾的奇偶一起算），落单页上限 `MAX_LONE_COUNT = 5`，保证结尾页不会和前一页挤进同一个跨页

### 编辑器（src/pages/Editor.tsx + engine/）

- `CanvasRenderer` 和 `InteractionManager` 是命令式类，通过 ref 持有，**每个项目只创建一次**（重建会中断拖拽）。交互事件通过回调桥接到 Redux dispatch；回调里用 `store.getState()` 取最新页码，避免闭包旧值
- `InteractionManager` 处理：命中检测（含旋转包围盒）、8 个缩放手柄 + 旋转手柄、拖拽 + 对齐辅助线吸附、拖到另一张图片上高亮并换位（`swapImages`）、双击文字 → 覆盖 textarea 编辑、双击图片 → 裁剪弹窗
- 屏幕→画布坐标换算用 `getBoundingClientRect()` 比例，已包含外层 CSS transform（zoom/pan），**不要再手动减 pan 除 zoom**
- 空图片区域（模板里没填照片的 imageId 为空的元素）：加载资源时**必须跳过**，`getImageAsset(undefined)` 会抛 DataError 中断整个循环，排它后面的照片永远画不出来
- 编辑器画布固定 96dpi，放大看必糊——这是已知的、用户接受的设计，别顺手"修"（和上传压缩是两回事）
- **进编辑页一律重置**：Editor 挂载/切 projectId 时 `dispatch(resetEditor())`——页码回第 1 页、zoom/pan/选中全复位（辅助线开关也回默认）。用户明确要求「不要有缓存」，别加「恢复上次编辑位置」这类功能

### 预览页（src/pages/Viewer.tsx + page-flip）

- 先把所有页渲染成 150dpi JPEG blob（`toBlob` + object URL，离开时统一 revoke）；所有图片只解码一次（`decodeAssets`，按 id 并行，解码用的临时 object URL 解完立刻 revoke）——`decodeAssets` 在 `utils/assetStore.ts`，预览页加载、PDF 导出、图片导出三处共用同一份，别在页面里另写
- PageFlip 在异步链里创建（等图片加载 + 动态 import）。必须：① 用 `cancelled` 标志 + `created` 变量防 StrictMode/依赖变化导致**同一容器上建两套书**（症状：残页、互相盖）；② 传**自己造的 div 壳**给 PageFlip，绝不能传 React 管的节点——`pageFlip.destroy()` 会把它删掉，React 不知道，书就永远消失
- 翻页一律走 `flipNext/flipPrev`（点击书页、方向键、左右按钮、放大镜都是这一条路，带翻页动画）；**别用 `turnToNextPage/turnToPrevPage`**——它内部 `showNext()` 差一，末页再翻越界抛 TypeError（已修，绕开的）。`turnToPage` 是瞬跳，只用于重建书之后恢复页码
- 「📥 导出」下拉在顶栏：PDF + 图片单面 + 图片双面三项。图片两项的开关是 `SHOW_IMAGE_EXPORT_ENTRY`（`utils/exportImages.ts`，同 Editor 的 `SHOW_BODY_STYLE_ENTRY` 套路）——**2026-10-16 起开放**，想再藏只改那一个值，实现别删。图片导出 300dpi + JPEG 0.95（与 PDF 同规格），zip 用 ZipPassThrough 只封装不压缩（同 `backup.ts` 的做法），跨页中间压一条灰书缝（`SPINE_*` 常量）
- 双面导出的跨页分组（`spreadGroups`）必须与 page-flip `showCover` 的翻开规律一致：`[0]`（封面单独）、`[1,2]`、`[3,4]`…、总页数为偶数时末页单独在左。改开本/页序逻辑时两边一起想
- 闭合态/摊开态的投影、书脊、居中偏移是精细调过的视觉状态，改动前先读懂 `Viewer.tsx` 里的注释（合起态是镜像不是重合、摊开投影的亮灭时机与书脊相反）

### 图片处理（src/utils/image.ts）

- 上传策略按**印刷分辨率**定：长边 ≤ 4096 一律原样通过（iPhone 12MP 长边 4032 特意保住）；超过才缩到 4096。**不要按 MB 压缩**——那会同时砍分辨率，等于砍印刷质量
- HEIC 用 `heic-to`（动态 import 懒加载，3MB 库），**不要换回 heic2any**（内置 libheif 太老，解不了新 iPhone 的 HEIC）
- 书架封面优先用上传时存的 200px 缩略图（实测 699ms→35ms），别用原图下采样

### 备份（src/utils/backup.ts）

- 整库 zip（fflate `ZipPassThrough`，照片已是 JPEG 不再压缩），逐张流式读取，几百 MB 不压内存
- zip 解开就是普通文件夹（相册数据.json + 照片/0001.jpg），用户照片不被锁在网站格式里
- 导入分两遍：先读清单停下问重名（**覆盖要用本地相册的 id**，不是备份里的 id），再解照片写库。模板冲突规则：id 相同 = 同一模板直接更新；仅名字撞 = 两个都留、后导入的改名
- 文件名的非法字符正则必须写 `\p{Cc}` 形式——**源码里永远别写裸控制字符**（会落成真实 NUL，整个文件变二进制）

### 文件夹模式（src/utils/folderMode.ts + folderLibrary.ts + components/FolderBanner.tsx）

用户可选用 File System Access API 把相册存到电脑文件夹：磁盘文件夹才是主数据，IndexedDB 从「仓库」降级成「工作台」。只有 Chromium 系浏览器支持；Firefox/Safari 走 `unsupported` 状态（横幅退回琥珀色备份提醒，文案别动）。

- 磁盘结构：`<用户选的文件夹>\photo-book\{相册名}\相册数据.json + 照片\0001.jpg`；根目录还有 `我的模板.json` 和 `先看我-说明.txt`
- 权限：浏览器重启后要在点击手势里「重新连接」（授权框选「每次访问时允许」即可长期免点）；文件夹被移动/改名 = `folder-missing`，引导「重新指认文件夹」，数据不丢
- **合并只走 `runSync` 一条路**（首次启用迁移、重新连接、重新指认、换电脑载入全用同一套规则）：同 id 以文件夹为准；仅文件夹有 → 载入；仅名字撞 → 后并入的改名。改这块前先读 `docs/` 下的文件夹模式设计文档（仅本地）
- 迁移后**验证磁盘写入成功才**从 IndexedDB 清照片 blob（verifiedIds）；孤儿 blob（没人引用的）不自动清理，历史攒下的也先留着（删除相册时才会顺带清，见「数据模型与单位」）
- 在网站上删除相册 = 连磁盘数据一起删（先弹窗确认；不进回收站）

### Tailwind：非档位透明度类会被静默丢弃

`bg-gray-900/92` 这类不在透明度档位（0/5/10/…/90/95/100）的值**不生成 CSS、也不报错**，类被静默丢掉 → 背景透明、白字白底（toast 翻过车）。只用档位值或方括号写法（`bg-gray-900/[0.92]`）。排查「写了类但样式没生效」：grep `dist/assets/*.css` 看类有没有生成（CSS 里斜杠写作 `\/` 转义）

## 部署注意

- `vite.config.ts` 的 `base: '/photobook/'` 和 `main.tsx` 的 `<BrowserRouter basename="/photobook">` 必须一致，改仓库名要两处一起改
- **`dist/` 里是一个独立的 git 仓库**（`dist/.git`，remote = `github.com/LXNNN/photobook.git`，分支 `gh-pages`）。部署流程：`npm run build` → 进 dist → `git add -A && git commit -m "deploy: …"` → `git push origin gh-pages`。增量提交，**不要 force push**；重新构建不影响 `dist/.git`

## 数据安全红线

- 所有数据在用户本地：默认在浏览器 IndexedDB；启用文件夹模式后**磁盘文件夹才是主数据**，IndexedDB 只是工作台。会让数据"看起来没了"的操作（换端口、清浏览器数据、动 IndexedDB schema 不迁移）都要先想清楚、先向用户解释
- 不要手动动用户的 IndexedDB 记录（DevTools 里删行、脚本清库都不行）——看着像「清理」，对用户就是数据没了
