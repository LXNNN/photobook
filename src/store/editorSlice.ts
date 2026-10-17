import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { EditorState } from '@/types';

const initialState: EditorState = {
  currentPageIndex: 0,
  activePageIndex: 0,
  selectedElementIds: [],
  zoom: 1,
  pan: { x: 0, y: 0 },
  showGuides: true,
  showBleed: true,
};

export const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    /** 切到某个跨页（参数是锚页）：活动页跟着回到这一组的第一页，选中清空 */
    setCurrentPage(state, action: PayloadAction<number>) {
      state.currentPageIndex = action.payload;
      state.activePageIndex = action.payload;
      state.selectedElementIds = [];
    },
    /** 切换活动页（点跨页里的另一页/点元素）：不动选中，支持跨页多选 */
    setActivePage(state, action: PayloadAction<number>) {
      state.activePageIndex = action.payload;
    },
    selectElement(state, action: PayloadAction<string>) {
      state.selectedElementIds = [action.payload];
    },
    multiSelectElement(state, action: PayloadAction<string>) {
      if (state.selectedElementIds.includes(action.payload)) {
        state.selectedElementIds = state.selectedElementIds.filter((id) => id !== action.payload);
      } else {
        state.selectedElementIds.push(action.payload);
      }
    },
    clearSelection(state) {
      state.selectedElementIds = [];
    },
    setZoom(state, action: PayloadAction<number>) {
      state.zoom = Math.max(0.1, Math.min(5, action.payload));
    },
    zoomIn(state) {
      state.zoom = Math.min(5, state.zoom * 1.2);
    },
    zoomOut(state) {
      state.zoom = Math.max(0.1, state.zoom / 1.2);
    },
    resetZoom(state) {
      state.zoom = 1;
      state.pan = { x: 0, y: 0 };
    },
    setPan(state, action: PayloadAction<{ x: number; y: number }>) {
      state.pan = action.payload;
    },
    toggleGuides(state) {
      state.showGuides = !state.showGuides;
    },
    toggleBleed(state) {
      state.showBleed = !state.showBleed;
    },
    resetEditor(state) {
      return initialState;
    },
  },
});

export const {
  setCurrentPage,
  setActivePage,
  selectElement,
  multiSelectElement,
  clearSelection,
  setZoom,
  zoomIn,
  zoomOut,
  resetZoom,
  setPan,
  toggleGuides,
  toggleBleed,
  resetEditor,
} = editorSlice.actions;

export default editorSlice.reducer;
