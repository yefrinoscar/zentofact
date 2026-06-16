import { create } from 'zustand';

interface AppState {
  activeCompanyId: number | null;
  setActiveCompanyId: (id: number | null) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeCompanyId: null,
  setActiveCompanyId: (id) => set({ activeCompanyId: id }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
