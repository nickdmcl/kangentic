import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TitleBar } from './TitleBar';
import { StatusBar } from './StatusBar';
import { ProjectSidebar } from '../sidebar/ProjectSidebar';
import { KanbanBoard } from '../board/KanbanBoard';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { SettingsPage } from '../settings/SettingsPage';
import { useConfigStore } from '../../stores/config-store';
import { useProjectStore } from '../../stores/project-store';
import { ToastContainer } from './ToastContainer';

const MIN_TERMINAL_HEIGHT = 100;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 400;
const SIDEBAR_COLLAPSE_THRESHOLD = 120;

export function AppLayout() {
  const settingsOpen = useConfigStore((s) => s.settingsOpen);
  const config = useConfigStore((s) => s.config);
  const currentProject = useProjectStore((s) => s.currentProject);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initialSidebarWidth = config.sidebar?.width ?? 224;
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);
  const latestSidebarWidthRef = useRef(sidebarWidth);
  const [terminalHeight, setTerminalHeight] = useState(config.terminal.panelHeight);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentColRef = useRef<HTMLDivElement>(null);
  const latestHeightRef = useRef(terminalHeight);
  const availableHeightRef = useRef(0);

  // Sync sidebar width and terminal height from config on load
  useEffect(() => {
    const saved = config.sidebar?.width;
    if (typeof saved === 'number' && saved >= MIN_SIDEBAR_WIDTH && saved <= MAX_SIDEBAR_WIDTH) {
      setSidebarWidth(saved);
      latestSidebarWidthRef.current = saved;
    }
    const savedHeight = config.terminal?.panelHeight;
    if (typeof savedHeight === 'number' && savedHeight >= MIN_TERMINAL_HEIGHT) {
      setTerminalHeight(savedHeight);
      latestHeightRef.current = savedHeight;
    }
    // Enable transitions after the first config-driven update
    requestAnimationFrame(() => setSidebarReady(true));
  }, [config]);

  // Compute max terminal height: 50% of the content column so the board
  // is always at least 50% visible.  Subtract the 4px resize handle.
  const getMaxHeight = useCallback(() => {
    return Math.floor(availableHeightRef.current / 2) - 4;
  }, []);

  const clampHeight = useCallback((h: number) => {
    if (availableHeightRef.current === 0) {
      // Not measured yet — only enforce minimum, skip max constraint
      return Math.max(MIN_TERMINAL_HEIGHT, h);
    }
    const max = getMaxHeight();
    if (max <= MIN_TERMINAL_HEIGHT) return MIN_TERMINAL_HEIGHT;
    return Math.max(MIN_TERMINAL_HEIGHT, Math.min(max, h));
  }, [getMaxHeight]);

  // Track the content column height via ResizeObserver.
  // When the window (or column) shrinks, clamp terminalHeight so the
  // board never drops below 50%.
  useEffect(() => {
    const el = contentColRef.current;
    if (!el) return;

    // Initialize immediately so clampHeight works before ResizeObserver fires
    availableHeightRef.current = el.getBoundingClientRect().height;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        availableHeightRef.current = entry.contentRect.height;
      }
      const clamped = clampHeight(latestHeightRef.current);
      if (clamped !== latestHeightRef.current) {
        latestHeightRef.current = clamped;
        setTerminalHeight(clamped);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [clampHeight]);

  const handleToggleCollapse = useCallback(() => {
    setTerminalCollapsed((prev) => {
      // Fire resize event after the layout settles so terminals refit
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('terminal-panel-resize'));
      });
      return !prev;
    });
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const startY = e.clientY;
    const startHeight = terminalHeight;

    // Signal terminals to defer fit() until drag ends, preventing
    // incremental scrollback eviction from repeated row-count changes.
    window.dispatchEvent(new CustomEvent('terminal-panel-drag-start'));

    const onMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      const newHeight = clampHeight(startHeight + delta);
      setTerminalHeight(newHeight);
      latestHeightRef.current = newHeight;
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Persist the final panel height
      window.electronAPI.config.set({
        terminal: { ...config.terminal, panelHeight: latestHeightRef.current },
      });
      // End drag suppression then signal terminals to refit.
      window.dispatchEvent(new CustomEvent('terminal-panel-drag-end'));
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('terminal-panel-resize'));
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [terminalHeight, config.terminal, clampHeight]);

  // Track sidebarOpen in a ref so the resize handler always reads the latest value
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  // Track whether the sidebar was closed by drag-collapse vs hamburger toggle
  const collapsedByDragRef = useRef(false);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      if (!prev) {
        // Restore to max if auto-collapsed by drag, otherwise use persisted width
        const w = collapsedByDragRef.current ? MAX_SIDEBAR_WIDTH : latestSidebarWidthRef.current;
        const restored = w >= MIN_SIDEBAR_WIDTH ? w : MAX_SIDEBAR_WIDTH;
        setSidebarWidth(restored);
        latestSidebarWidthRef.current = restored;
        collapsedByDragRef.current = false;
      }
      return !prev;
    });
  }, []);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const wasClosed = !sidebarOpenRef.current;
    const startWidth = wasClosed ? 0 : latestSidebarWidthRef.current;
    let didCollapse = false;

    window.dispatchEvent(new CustomEvent('terminal-panel-drag-start'));

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const rawWidth = startWidth + delta;

      if (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
        // Below threshold — visually collapse
        setSidebarWidth(0);
        didCollapse = true;
      } else {
        const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, rawWidth));
        setSidebarWidth(newWidth);
        latestSidebarWidthRef.current = newWidth;
        didCollapse = false;
        if (!sidebarOpenRef.current) setSidebarOpen(true);
      }
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsSidebarResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (didCollapse) {
        collapsedByDragRef.current = true;
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
        window.electronAPI.config.set({
          sidebar: { width: latestSidebarWidthRef.current },
        });
      }
      window.dispatchEvent(new CustomEvent('terminal-panel-drag-end'));
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('terminal-panel-resize'));
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  if (settingsOpen) {
    return (
      <div className="h-screen flex flex-col bg-zinc-900">
        <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        <SettingsPage />
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-900" ref={containerRef}>
      <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />

      <div className="flex flex-1 min-h-0">
        <div
          className={`flex-shrink-0 overflow-hidden border-r border-zinc-700 ${
            !sidebarOpen && !isSidebarResizing ? 'w-0 border-r-0' : ''
          } ${sidebarReady && !isSidebarResizing ? 'transition-[width] duration-200 ease-in-out' : ''}`}
          style={sidebarOpen || isSidebarResizing ? { width: sidebarWidth } : undefined}
        >
          <ProjectSidebar onToggleSidebar={toggleSidebar} />
        </div>

        {/* Sidebar resize handle — wider hit target when collapsed so it's easy to drag open */}
        <div
          className={`flex-shrink-0 cursor-col-resize transition-colors ${
            sidebarOpen
              ? 'w-1 bg-zinc-700 hover:bg-zinc-500'
              : 'w-1.5 bg-zinc-700/50 hover:bg-zinc-500'
          }`}
          onMouseDown={handleSidebarResizeStart}
        />

        <div className="flex-1 flex flex-col min-w-0" ref={contentColRef}>
          {currentProject ? (
            <>
              <div className="flex-1 min-h-0 overflow-hidden">
                <KanbanBoard />
              </div>

              {/* Resize handle — hidden when collapsed */}
              {!terminalCollapsed && (
                <div
                  className="resize-handle h-1 bg-zinc-700 flex-shrink-0 cursor-row-resize hover:bg-zinc-500 transition-colors"
                  onMouseDown={handleResizeStart}
                />
              )}

              {/* Terminal panel */}
              <div
                style={terminalCollapsed ? undefined : { height: terminalHeight }}
                className={`flex-shrink-0 ${isResizing || isSidebarResizing ? 'pointer-events-none' : ''}`}
              >
                <TerminalPanel
                  collapsed={terminalCollapsed}
                  onToggleCollapse={handleToggleCollapse}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-500">
              <div className="text-center">
                <div className="text-4xl mb-4">&#9776;</div>
                <div className="text-lg">Select or create a project to get started</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <StatusBar />
      <ToastContainer />
    </div>
  );
}
