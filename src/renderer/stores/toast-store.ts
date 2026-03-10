import { create } from 'zustand';
import { useConfigStore } from './config-store';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  action?: ToastAction;
}

export interface ToastInput {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (input: ToastInput) => string;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (input) => {
    const id = crypto.randomUUID();
    const toastConfig = useConfigStore.getState().config.notifications.toasts;
    const defaultDuration = toastConfig.durationSeconds * 1000;
    const maxCount = toastConfig.maxCount;
    const toast: Toast = {
      id,
      message: input.message,
      variant: input.variant ?? 'info',
      duration: input.duration ?? defaultDuration,
      action: input.action,
    };
    set((s) => ({
      toasts: [...s.toasts, toast].slice(-maxCount),
    }));
    return id;
  },

  dismissToast: (id) => {
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    }));
  },
}));
