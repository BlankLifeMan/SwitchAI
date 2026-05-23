import { create } from "zustand";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (type: ToastItem["type"], message: string) => void;
  removeToast: (id: string) => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, message) => {
    const id = String(++toastId);
    set((s) => ({
      toasts: [...s.toasts, { id, type, message }],
    }));
    setTimeout(() => {
      set((s) => ({
        toasts: s.toasts.filter((t) => t.id !== id),
      }));
    }, 4000);
  },

  removeToast: (id) => {
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    }));
  },
}));
