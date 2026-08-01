import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export type Toast = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ToastStore = {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
};

const DURATION_MS = 3000;
let nextId = 1;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  push: (message, kind = "info") => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => get().dismiss(id), DURATION_MS);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-component code (stores, hooks). */
export const toast = {
  info: (message: string) => useToastStore.getState().push(message, "info"),
  success: (message: string) => useToastStore.getState().push(message, "success"),
  error: (message: string) => useToastStore.getState().push(message, "error"),
};
