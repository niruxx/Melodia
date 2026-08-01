import { create } from "zustand";
import type { LucideIcon } from "lucide-react";

export type MenuItem =
  | { kind: "separator" }
  | {
      kind?: "item";
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      danger?: boolean;
    };

type ContextMenuStore = {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  close: () => void;
};

export const useContextMenuStore = create<ContextMenuStore>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  openMenu: (x, y, items) => set({ open: true, x, y, items }),
  close: () => set({ open: false, items: [] }),
}));
