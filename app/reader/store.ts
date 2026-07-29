import { create } from "zustand";
import { persist } from "zustand/middleware";

type Panel = "outline" | "highlights";
export type PaneId = "primary" | "secondary";
export type ReaderView =
  | { kind: "parent"; paperId: string; language: "ko" | "en" }
  | { kind: "child"; parentId: string; paperId: string }
  | { kind: "pdf"; paperId: string };
export type PaneHistory = {
  back: ReaderView[];
  forward: ReaderView[];
};

type UiStore = {
  primaryPane: ReaderView | null;
  secondaryPane: ReaderView | null;
  paneHistory: Record<PaneId, PaneHistory>;
  splitRatio: number;
  focusedPane: PaneId;
  panel: Panel;
  openView: (view: ReaderView) => void;
  setPaneView: (pane: PaneId, view: ReaderView) => void;
  replacePaneView: (pane: PaneId, view: ReaderView) => void;
  setFocusedPane: (pane: PaneId) => void;
  goBack: (pane: PaneId) => void;
  goForward: (pane: PaneId) => void;
  setSplitRatio: (ratio: number) => void;
  toggleSplit: () => void;
  closeSplit: () => void;
  setPanel: (value: Panel) => void;
};

const emptyHistory = (): PaneHistory => ({ back: [], forward: [] });
const sameView = (left: ReaderView | null, right: ReaderView) =>
  Boolean(left) && JSON.stringify(left) === JSON.stringify(right);

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      primaryPane: null,
      secondaryPane: null,
      paneHistory: {
        primary: emptyHistory(),
        secondary: emptyHistory(),
      },
      splitRatio: 50,
      focusedPane: "primary",
      panel: "outline",
      openView: (view) =>
        set((state) => {
          const pane: PaneId = state.focusedPane === "secondary" && state.secondaryPane
            ? "secondary"
            : "primary";
          const current = pane === "secondary" ? state.secondaryPane : state.primaryPane;
          if (sameView(current, view)) return state;
          return {
            [pane === "secondary" ? "secondaryPane" : "primaryPane"]: view,
            focusedPane: pane,
            paneHistory: {
              ...state.paneHistory,
              [pane]: {
                back: current ? [...state.paneHistory[pane].back, current] : [],
                forward: [],
              },
            },
          };
        }),
      setPaneView: (pane, view) =>
        set((state) => {
          const current = pane === "secondary" ? state.secondaryPane : state.primaryPane;
          if (sameView(current, view)) return { focusedPane: pane };
          return {
            [pane === "secondary" ? "secondaryPane" : "primaryPane"]: view,
            focusedPane: pane,
            paneHistory: {
              ...state.paneHistory,
              [pane]: {
                back: current ? [...state.paneHistory[pane].back, current] : [],
                forward: [],
              },
            },
          };
        }),
      replacePaneView: (pane, view) =>
        set((state) => ({
          [pane === "secondary" ? "secondaryPane" : "primaryPane"]: view,
          focusedPane: pane,
          paneHistory: {
            ...state.paneHistory,
            [pane]: emptyHistory(),
          },
        })),
      setFocusedPane: (focusedPane) => set({ focusedPane }),
      goBack: (pane) =>
        set((state) => {
          const history = state.paneHistory[pane];
          const current = pane === "secondary" ? state.secondaryPane : state.primaryPane;
          if (!current || !history.back.length) return state;
          const previous = history.back[history.back.length - 1];
          return {
            [pane === "secondary" ? "secondaryPane" : "primaryPane"]: previous,
            focusedPane: pane,
            paneHistory: {
              ...state.paneHistory,
              [pane]: {
                back: history.back.slice(0, -1),
                forward: [current, ...history.forward],
              },
            },
          };
        }),
      goForward: (pane) =>
        set((state) => {
          const history = state.paneHistory[pane];
          const current = pane === "secondary" ? state.secondaryPane : state.primaryPane;
          if (!current || !history.forward.length) return state;
          const next = history.forward[0];
          return {
            [pane === "secondary" ? "secondaryPane" : "primaryPane"]: next,
            focusedPane: pane,
            paneHistory: {
              ...state.paneHistory,
              [pane]: {
                back: [...history.back, current],
                forward: history.forward.slice(1),
              },
            },
          };
        }),
      setSplitRatio: (splitRatio) => set({
        splitRatio: Math.max(20, Math.min(80, splitRatio)),
      }),
      toggleSplit: () =>
        set((state) => state.secondaryPane
          ? {
              secondaryPane: null,
              focusedPane: "primary",
              paneHistory: {
                ...state.paneHistory,
                secondary: emptyHistory(),
              },
            }
          : {
              secondaryPane: state.focusedPane === "secondary"
                ? state.secondaryPane
                : state.primaryPane,
              focusedPane: "secondary",
              paneHistory: {
                ...state.paneHistory,
                secondary: emptyHistory(),
              },
            }),
      closeSplit: () => set((state) => ({
        secondaryPane: null,
        focusedPane: "primary",
        paneHistory: {
          ...state.paneHistory,
          secondary: emptyHistory(),
        },
      })),
      setPanel: (panel) => set({ panel }),
    }),
    {
      name: "paper-library-v2-ui",
      version: 4,
      migrate: (persisted: unknown, version) => {
        const old = (persisted || {}) as Record<string, unknown>;
        if (version >= 4) return old as unknown as UiStore;
        if (version === 3) {
          return {
            ...old,
            splitRatio: 50,
          } as unknown as UiStore;
        }
        if (version === 2) {
          return {
            ...old,
            splitRatio: 50,
            paneHistory: {
              primary: emptyHistory(),
              secondary: emptyHistory(),
            },
          } as unknown as UiStore;
        }
        const selectedPaperId = String(old.selectedPaperId || "");
        const selectedParentId = String(old.selectedParentId || "");
        const selectedChildId = String(old.selectedChildId || "");
        const language = old.language === "en" ? "en" : "ko";
        const primaryPane: ReaderView | null = selectedPaperId
          ? { kind: "parent", paperId: selectedPaperId, language }
          : selectedParentId && selectedChildId
            ? { kind: "child", parentId: selectedParentId, paperId: selectedChildId }
            : null;
        return {
          primaryPane,
          secondaryPane: null,
          paneHistory: {
            primary: emptyHistory(),
            secondary: emptyHistory(),
          },
          splitRatio: 50,
          focusedPane: "primary",
          panel: old.panel === "highlights" ? "highlights" : "outline",
        } as unknown as UiStore;
      },
      partialize: (state) => ({
        primaryPane: state.primaryPane,
        secondaryPane: state.secondaryPane,
        paneHistory: state.paneHistory,
        splitRatio: state.splitRatio,
        focusedPane: state.focusedPane,
        panel: state.panel,
      }),
    },
  ),
);
