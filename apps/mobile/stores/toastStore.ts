/**
 * Toast store — lightweight transient feedback ("Publication envoyée", "Erreur
 * réseau"). Replaces the fragmented mix of native Alert.alert + per-screen
 * banners for *transient* confirmations.
 *
 * Single toast at a time; a newer call replaces the current one. The `toast()`
 * helper is callable from anywhere (mutations, services) without hooks, so a
 * success handler can fire feedback without prop-drilling.
 */
import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Auto-hide delay in ms. */
  duration: number;
}

interface ToastState {
  current: ToastItem | null;
  show: (message: string, variant?: ToastVariant, duration?: number) => void;
  dismiss: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  current: null,
  show(message, variant = 'info', duration = 2600) {
    set({
      current: { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, message, variant, duration },
    });
  },
  dismiss() {
    set({ current: null });
  },
}));

/**
 * Imperative helpers — call from anywhere (no hook needed):
 *   toast.success('Publication envoyée ✨')
 *   toast.error('Échec de l’envoi')
 */
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().show(message, 'success', duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().show(message, 'error', duration ?? 3600),
  info: (message: string, duration?: number) =>
    useToastStore.getState().show(message, 'info', duration),
};
