import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { UIState } from '@/types';

const initialState: UIState = {
  mode: 'edit',
  sidebarTab: 'pages',
  leftPanelOpen: true,
  rightPanelOpen: true,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setMode(state, action: PayloadAction<'edit' | 'view'>) {
      state.mode = action.payload;
    },
    setSidebarTab(state, action: PayloadAction<UIState['sidebarTab']>) {
      state.sidebarTab = action.payload;
    },
    toggleLeftPanel(state) {
      state.leftPanelOpen = !state.leftPanelOpen;
    },
    toggleRightPanel(state) {
      state.rightPanelOpen = !state.rightPanelOpen;
    },
  },
});

export const { setMode, setSidebarTab, toggleLeftPanel, toggleRightPanel } = uiSlice.actions;
export default uiSlice.reducer;
