import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Project, Page, Element, BookFormat, ImageElement } from '@/types';
import { PRESET_FORMATS } from '@/types';
import { isBodyText } from '@/utils/bodyText';
import { spreadGroupAt } from '@/utils/spreadLayout';

interface ProjectState {
  current: Project | null;
  list: Project[];
  loading: boolean;
  past: Project[]; // 撤销历史栈
}

const initialState: ProjectState = {
  current: null,
  list: [],
  loading: false,
  past: [],
};

const generateId = () => Math.random().toString(36).substring(2, 11);

export const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    setCurrentProject(state, action: PayloadAction<Project | null>) {
      state.current = action.payload;
      state.past = []; // 切换项目时清空历史
    },
    /** 保存当前状态到历史栈（操作前调用） */
    pushHistory(state) {
      if (!state.current) return;
      state.past.push(JSON.parse(JSON.stringify(state.current)));
      // 最多保存 50 步历史
      if (state.past.length > 50) {
        state.past.shift();
      }
    },
    /** 撤销：回到上一步 */
    undo(state) {
      if (state.past.length === 0 || !state.current) return;
      const previous = state.past.pop()!;
      state.current = previous;
      state.current.updatedAt = Date.now();
    },
    /**
     * 清空撤销历史（预览时清理了未使用的照片之后调用）。
     * 被删的照片已经不在磁盘/库里，旧快照再留着，撤销回去只会得到空白图。
     */
    clearHistory(state) {
      state.past = [];
    },
    setProjectList(state, action: PayloadAction<Project[]>) {
      state.list = action.payload;
    },
    createProject(state, action: PayloadAction<{ name: string; format?: BookFormat }>) {
      const format = action.payload.format || PRESET_FORMATS.A5;
      const now = Date.now();
      const newProject: Project = {
        id: generateId(),
        name: action.payload.name,
        format,
        pages: [
          {
            id: generateId(),
            background: { type: 'color', value: '#ffffff' },
            elements: [],
          },
        ],
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      state.current = newProject;
      state.list.unshift(newProject);
    },
    updateProjectName(state, action: PayloadAction<string>) {
      if (state.current) {
        state.current.name = action.payload;
        state.current.updatedAt = Date.now();
      }
    },
    addPage(state, action: PayloadAction<{ afterIndex?: number; elements?: Element[] }>) {
      if (!state.current) return;
      const newPage: Page = {
        id: generateId(),
        background: { type: 'color', value: '#ffffff' },
        elements: action.payload.elements || [],
      };
      const index = action.payload.afterIndex ?? state.current.pages.length - 1;
      state.current.pages.splice(index + 1, 0, newPage);
      state.current.updatedAt = Date.now();
    },
    deletePage(state, action: PayloadAction<number>) {
      if (!state.current || state.current.pages.length <= 1) return;
      state.current.pages.splice(action.payload, 1);
      state.current.updatedAt = Date.now();
    },
    duplicatePage(state, action: PayloadAction<number>) {
      if (!state.current) return;
      const source = state.current.pages[action.payload];
      const copy: Page = JSON.parse(JSON.stringify(source));
      copy.id = generateId();
      copy.elements = copy.elements.map((el) => ({ ...el, id: generateId() }));
      state.current.pages.splice(action.payload + 1, 0, copy);
      state.current.updatedAt = Date.now();
    },
    reorderPages(state, action: PayloadAction<{ from: number; to: number }>) {
      if (!state.current) return;
      const { from, to } = action.payload;
      const [moved] = state.current.pages.splice(from, 1);
      state.current.pages.splice(to, 0, moved);
      state.current.updatedAt = Date.now();
    },
    /**
     * 成对插入两页（双页编辑的新建页面）。`atIndex` 要传 spreadLayout 的
     * insertAfterSpread / appendPairIndex 算出来的插入位——那是保持整本
     * 页面配对不断开的唯一下标规则，别手算。
     * `elements` 只落在这一对的第一页（模板溢出的情况），第二页是空白页。
     */
    addPagePair(state, action: PayloadAction<{ atIndex?: number; elements?: Element[] }>) {
      if (!state.current) return;
      const total = state.current.pages.length;
      // 封面永远第一页；越界插到末尾
      const at = Math.max(1, Math.min(total, action.payload.atIndex ?? total));
      const blank = (elements: Element[] = []): Page => ({
        id: generateId(),
        background: { type: 'color', value: '#ffffff' },
        elements,
      });
      state.current.pages.splice(at, 0, blank(action.payload.elements), blank());
      state.current.updatedAt = Date.now();
    },
    /** 成对删除。只删真正的两页组；封面/结尾落单页删不掉（缩略图上也不给按钮） */
    deletePagePair(state, action: PayloadAction<number>) {
      if (!state.current) return;
      const total = state.current.pages.length;
      const group = spreadGroupAt(action.payload, total);
      if (group.length !== 2) return;
      if (total - 2 < 1) return;
      state.current.pages.splice(group[0], 2);
      state.current.updatedAt = Date.now();
    },
    /** 把 from 开始的 count 页整体挪到 to（to 是「先删掉这批之后」的插入下标） */
    movePages(state, action: PayloadAction<{ from: number; to: number; count: number }>) {
      if (!state.current) return;
      const pages = state.current.pages;
      const { from, to, count } = action.payload;
      if (from < 0 || count <= 0 || from + count > pages.length) return;
      if (to < 0 || to > pages.length - count) return;
      const moved = pages.splice(from, count);
      pages.splice(to, 0, ...moved);
      state.current.updatedAt = Date.now();
    },
    setPageBackground(state, action: PayloadAction<{ pageIndex: number; background: Page['background'] }>) {
      if (!state.current) return;
      state.current.pages[action.payload.pageIndex].background = action.payload.background;
      state.current.updatedAt = Date.now();
    },
    replacePageElements(state, action: PayloadAction<{ pageIndex: number; elements: Element[]; templateId?: string }>) {
      if (!state.current) return;
      const page = state.current.pages[action.payload.pageIndex];
      page.elements = action.payload.elements;
      if (action.payload.templateId !== undefined) {
        page.templateId = action.payload.templateId;
      }
      state.current.updatedAt = Date.now();
    },
    setPageTemplateId(state, action: PayloadAction<{ pageIndex: number; templateId: string }>) {
      if (!state.current) return;
      const page = state.current.pages[action.payload.pageIndex];
      if (page) page.templateId = action.payload.templateId;
    },
    addElement(state, action: PayloadAction<{ pageIndex: number; element: Element }>) {
      if (!state.current) return;
      state.current.pages[action.payload.pageIndex].elements.push(action.payload.element);
      state.current.updatedAt = Date.now();
    },
    /**
     * 一键换全书正文的颜色 + 字号（「🎨 正文样式」弹窗）。
     * 判定「正文」用 isBodyText：文字、不是 fixed 装饰小字、字号没到标题线 ——
     * 标题和装饰小字一律不碰。
     *
     * 同时把这一套记成相册自己的正文样式（bodyColor / bodyFontSize）：之后点
     * 「📝 添加文字」新建的文字直接用这套，不用再手动调。字号本来就有 bodyFontSize
     * 这个字段（模板填充正文时也用它），颜色是这次一起加的。
     *
     * 注意：调用方要自己先 pushHistory()（跟其它改动操作一个规矩），这样 Ctrl+Z 能退回来。
     */
    setBodyStyle(state, action: PayloadAction<{ color: string; fontSize: number }>) {
      if (!state.current) return;
      const { color, fontSize } = action.payload;
      state.current.bodyColor = color;
      state.current.bodyFontSize = fontSize;
      for (const page of state.current.pages) {
        for (const el of page.elements) {
          if (!isBodyText(el, state.current.format)) continue;
          el.color = color;
          el.fontSize = fontSize;
        }
      }
      state.current.updatedAt = Date.now();
    },
    updateElement(state, action: PayloadAction<{ pageIndex: number; elementId: string; updates: Partial<Element> }>) {
      if (!state.current) return;
      const page = state.current.pages[action.payload.pageIndex];
      const idx = page.elements.findIndex((el) => el.id === action.payload.elementId);
      if (idx !== -1) {
        page.elements[idx] = { ...page.elements[idx], ...action.payload.updates } as Element;
        state.current.updatedAt = Date.now();
      }
    },
    swapImages(state, action: PayloadAction<{ pageIndex: number; sourceId: string; targetId: string }>) {
      if (!state.current) return;
      const page = state.current.pages[action.payload.pageIndex];
      const sourceIdx = page.elements.findIndex((el) => el.id === action.payload.sourceId);
      const targetIdx = page.elements.findIndex((el) => el.id === action.payload.targetId);
      if (sourceIdx === -1 || targetIdx === -1) return;
      const source = page.elements[sourceIdx] as ImageElement;
      const target = page.elements[targetIdx] as ImageElement;
      // 只换照片，不换裁剪。
      //
      // 裁剪是「当前图片区域」的属性，不是照片的属性：crop 归一化到源图片上，
      // 形状天生等于它所在那个框的形状。跟着照片搬的话，一块按竖框裁的框落到
      // 横框里就没法保持原样了 —— 要贴合横框只能往里缩，同一个框看起来会
      // 莫名其妙变小（照片等于被放大）。而"换了照片"并不等于"换了区域大小"：
      // 框原样不动，新照片照旧从这个窗口往外看，不合适重新裁一次就好。
      const tempImageId = source.imageId;
      source.imageId = target.imageId;
      target.imageId = tempImageId;
      state.current.updatedAt = Date.now();
    },
    deleteElement(state, action: PayloadAction<{ pageIndex: number; elementId: string }>) {
      if (!state.current) return;
      const page = state.current.pages[action.payload.pageIndex];
      page.elements = page.elements.filter((el) => el.id !== action.payload.elementId);
      state.current.updatedAt = Date.now();
    },
    bringElementForward(state, action: PayloadAction<{ pageIndex: number; elementId: string }>) {
      if (!state.current) return;
      const page = state.current.pages[action.payload.pageIndex];
      const idx = page.elements.findIndex((el) => el.id === action.payload.elementId);
      if (idx !== -1 && idx < page.elements.length - 1) {
        [page.elements[idx], page.elements[idx + 1]] = [page.elements[idx + 1], page.elements[idx]];
        state.current.updatedAt = Date.now();
      }
    },
    sendElementBackward(state, action: PayloadAction<{ pageIndex: number; elementId: string }>) {
      if (!state.current) return;
      const page = state.current.pages[action.payload.pageIndex];
      const idx = page.elements.findIndex((el) => el.id === action.payload.elementId);
      if (idx > 0) {
        [page.elements[idx], page.elements[idx - 1]] = [page.elements[idx - 1], page.elements[idx]];
        state.current.updatedAt = Date.now();
      }
    },
  },
});

export const {
  setCurrentProject,
  setProjectList,
  createProject,
  updateProjectName,
  addPage,
  deletePage,
  duplicatePage,
  reorderPages,
  addPagePair,
  deletePagePair,
  movePages,
  setPageBackground,
  replacePageElements,
  setPageTemplateId,
  addElement,
  updateElement,
  setBodyStyle,
  deleteElement,
  swapImages,
  bringElementForward,
  sendElementBackward,
  pushHistory,
  undo,
  clearHistory,
} = projectSlice.actions;

export default projectSlice.reducer;
