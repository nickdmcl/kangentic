import React from 'react';
import { Folder, Minus, Settings, Square, X } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useConfigStore } from '../../stores/config-store';
import logoSrc from '../../assets/logo-32.png';

interface TitleBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const isMac = window.electronAPI.platform === 'darwin';

export function TitleBar({ sidebarOpen, onToggleSidebar }: TitleBarProps) {
  const currentProject = useProjectStore((s) => s.currentProject);
  const setSettingsOpen = useConfigStore((s) => s.setSettingsOpen);
  const settingsOpen = useConfigStore((s) => s.settingsOpen);

  const isWorktree = currentProject?.path
    ? currentProject.path.replace(/\\/g, '/').includes('.kangentic/worktrees/')
    : false;

  return (
    <div className={`h-10 bg-surface border-b border-edge flex items-center select-none flex-shrink-0 relative ${isMac ? 'pl-20 pr-3' : 'px-3'}`}
         style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {!sidebarOpen && (
        <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={onToggleSidebar}
            className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-surface-hover rounded text-fg-muted hover:text-fg transition-colors text-sm"
            title="Show sidebar"
          >
            <Folder size={16} />
            <span>Projects</span>
          </button>
        </div>
      )}

      {/* Absolute-centered title so it doesn't shift when sidebar toggle appears/disappears */}
      <div className={`absolute inset-0 flex items-center justify-center text-sm text-fg-muted pointer-events-none ${isMac ? 'pl-20' : ''}`}>
        <img src={logoSrc} alt="Kangentic" className="w-5 h-5 mr-1.5" />
        <span className="font-semibold text-fg-secondary">Kangentic</span>
        {currentProject && (
          <span className="ml-2 text-fg-faint">
            &mdash; {currentProject.name}
            {isWorktree && (
              <span className="ml-1.5 text-xs text-amber-500/70">(worktree)</span>
            )}
          </span>
        )}
      </div>

      {/* Spacer to push right-aligned controls to the edge */}
      <div className="flex-1" />

      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={`p-1.5 hover:bg-surface-hover rounded transition-colors ${
            settingsOpen ? 'text-fg bg-surface-hover' : 'text-fg-muted hover:text-fg'
          }`}
          title="App Settings"
        >
          <Settings size={20} />
        </button>
        {!isMac && (
          <>
            <div className="w-px h-4 bg-edge mx-1" />
            <button
              onClick={() => window.electronAPI.window.minimize()}
              className="p-1.5 hover:bg-surface-hover rounded text-fg-muted hover:text-fg transition-colors"
              title="Minimize"
            >
              <Minus size={16} />
            </button>
            <button
              onClick={() => window.electronAPI.window.maximize()}
              className="p-1.5 hover:bg-surface-hover rounded text-fg-muted hover:text-fg transition-colors"
              title="Maximize"
            >
              <Square size={14} />
            </button>
            <button
              onClick={() => window.electronAPI.window.close()}
              className="p-1.5 hover:bg-red-600 rounded text-fg-muted hover:text-white transition-colors"
              title="Close"
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
