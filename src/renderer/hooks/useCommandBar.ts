import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../stores/project-store';
import { useToastStore } from '../stores/toast-store';

/** Preserved across HMR so the command bar overlay stays mounted during
 *  hot module replacement instead of resetting to closed. */
// @ts-expect-error -- Vite handles import.meta.hot
const hmrCommandBarOpen: boolean = import.meta.hot?.data?.commandBarOpen ?? false;

// @ts-expect-error -- Vite handles import.meta.hot
if (import.meta.hot) {
  // @ts-expect-error -- Vite handles import.meta.hot
  import.meta.hot.dispose((data: Record<string, unknown>) => {
    data.commandBarOpen = _lastIsOpen;
  });
}

/** Tracks the latest isOpen value so dispose() can snapshot it. */
let _lastIsOpen = hmrCommandBarOpen;

/**
 * Registers Ctrl+Shift+P / Cmd+Shift+P to open the command bar overlay.
 * Returns open/close state and handlers.
 */
export function useCommandBar() {
  const [isOpen, setIsOpen] = useState(hmrCommandBarOpen);
  const currentProjectId = useProjectStore((s) => s.currentProject?.id);

  // Keep module-scoped tracker in sync for HMR dispose()
  useEffect(() => {
    _lastIsOpen = isOpen;
  }, [isOpen]);

  // Close command bar when project changes - it will reattach on next open
  useEffect(() => {
    setIsOpen(false);
  }, [currentProjectId]);

  const open = useCallback(() => {
    const currentProject = useProjectStore.getState().currentProject;
    if (!currentProject) {
      useToastStore.getState().addToast({
        message: 'Open a project first',
        variant: 'warning',
      });
      return;
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'P') {
        event.preventDefault();
        event.stopPropagation();
        if (isOpen) {
          close();
        } else {
          open();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, open, close]);

  return { isOpen, open, close };
}
