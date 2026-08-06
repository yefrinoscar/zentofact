import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  activeCompanyId: number | null;
  setActiveCompanyId: (id: number | null) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeCompanyId: null,
      setActiveCompanyId: (id) => set({ activeCompanyId: id }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: 'boletas.app',
      partialize: (state) => ({
        activeCompanyId: state.activeCompanyId,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
