import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Project, Page, Element, BookFormat, ImageElement } from '@/types';
import { PRESET_FORMATS } from '@/types';

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
      // 互换 imageId 和 crop
      const tempImageId = source.imageId;
      const tempCrop = { ...source.crop };
      source.imageId = target.imageId;
      source.crop = { ...target.crop };
      target.imageId = tempImageId;
      target.crop = tempCrop;
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
  setPageBackground,
  replacePageElements,
  setPageTemplateId,
  addElement,
  updateElement,
  deleteElement,
  swapImages,
  bringElementForward,
  sendElementBackward,
  pushHistory,
  undo,
} = projectSlice.actions;

export default projectSlice.reducer;
