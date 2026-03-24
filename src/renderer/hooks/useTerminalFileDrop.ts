import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook that manages file drag-and-drop onto a terminal.
 *
 * xterm.js renders a canvas that swallows all drag events, so a permanent
 * overlay div sits on top of the terminal. Normally it has pointer-events:none
 * (invisible to interaction). When a file drag enters the window, pointer-events
 * switches to 'auto' so the overlay captures dragover/drop instead of xterm.
 *
 * A window-level dragenter listener detects when files enter the app, and the
 * overlay's own dragleave/drop reset the state when the cursor leaves or drops.
 */
export function useTerminalFileDrop(
  sessionId: string | null,
  focusTerminal: () => void,
) {
  const [fileDragActive, setFileDragActive] = useState(false);
  const windowDragCounterRef = useRef(0);

  // Track when ANY file drag enters/leaves the window so overlays become interactive.
  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        windowDragCounterRef.current++;
        if (windowDragCounterRef.current === 1) {
          setFileDragActive(true);
        }
      }
    };
    const handleDragLeave = () => {
      windowDragCounterRef.current--;
      if (windowDragCounterRef.current <= 0) {
        windowDragCounterRef.current = 0;
        setFileDragActive(false);
      }
    };
    const handleReset = () => {
      windowDragCounterRef.current = 0;
      setFileDragActive(false);
    };
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragend', handleReset);
    document.addEventListener('drop', handleReset);
    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragend', handleReset);
      document.removeEventListener('drop', handleReset);
    };
  }, []);

  // Track whether the cursor is hovering over THIS terminal's overlay.
  const [hoveringOverlay, setHoveringOverlay] = useState(false);
  const overlayDragCounterRef = useRef(0);

  const handleOverlayDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    overlayDragCounterRef.current++;
    if (overlayDragCounterRef.current === 1) {
      setHoveringOverlay(true);
    }
  }, []);

  const handleOverlayDragLeave = useCallback(() => {
    overlayDragCounterRef.current--;
    if (overlayDragCounterRef.current <= 0) {
      overlayDragCounterRef.current = 0;
      setHoveringOverlay(false);
    }
  }, []);

  const handleOverlayDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleOverlayDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setHoveringOverlay(false);
    overlayDragCounterRef.current = 0;
    setFileDragActive(false);
    windowDragCounterRef.current = 0;

    if (!event.dataTransfer?.files.length || !sessionId) return;

    const paths: string[] = [];
    for (const file of event.dataTransfer.files) {
      const filePath = window.electronAPI.webUtils.getPathForFile(file);
      if (filePath) {
        paths.push(filePath.includes(' ') ? `"${filePath}"` : filePath);
      }
    }
    if (paths.length > 0) {
      window.electronAPI.sessions.write(sessionId, paths.join(' '));
      focusTerminal();
    }
  }, [sessionId, focusTerminal]);

  return {
    /** True when a file drag is active anywhere in the window (overlay becomes interactive). */
    fileDragActive,
    /** True when the cursor is hovering over this specific terminal's overlay. */
    hoveringOverlay,
    handleOverlayDragEnter,
    handleOverlayDragLeave,
    handleOverlayDragOver,
    handleOverlayDrop,
  };
}
