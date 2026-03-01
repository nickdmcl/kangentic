import { create } from 'zustand';
import type { AppConfig } from '../../shared/types';
import { DEFAULT_CONFIG } from '../../shared/types';

/** Extract the version number from the raw string (e.g. "2.1.50 (Claude Code)" → "2.1.50"). */
function parseClaudeVersion(version: string | null): string | null {
  return version?.replace(/\s*\(.*\)/, '') || null;
}

interface ConfigStore {
  config: AppConfig;
  claudeInfo: { found: boolean; path: string | null; version: string | null } | null;
  /** Pre-formatted display label for status bar */
  claudeVersionLabel: string;
  /** Just the version number, e.g. "2.1.51" */
  claudeVersionNumber: string | null;
  loading: boolean;
  settingsOpen: boolean;
  settingsInitialTab: string | null;
  loadConfig: () => Promise<void>;
  updateConfig: (partial: Partial<AppConfig>) => Promise<void>;
  detectClaude: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  openSettingsTab: (tab: string) => void;
}

export const useConfigStore = create<ConfigStore>((set) => ({
  config: DEFAULT_CONFIG,
  claudeInfo: null,
  claudeVersionLabel: 'Claude Code',
  claudeVersionNumber: null,
  loading: false,
  settingsOpen: false,
  settingsInitialTab: null,

  loadConfig: async () => {
    set({ loading: true });
    const config = await window.electronAPI.config.get();
    set({ config, loading: false });
  },

  updateConfig: async (partial) => {
    await window.electronAPI.config.set(partial);
    const config = await window.electronAPI.config.get();
    set({ config });
  },

  detectClaude: async () => {
    const claudeInfo = await window.electronAPI.claude.detect();
    const ver = parseClaudeVersion(claudeInfo?.version ?? null);
    set({
      claudeInfo,
      claudeVersionLabel: ver ? `Claude Code | v${ver}` : 'Claude Code',
      claudeVersionNumber: ver,
    });
  },

  setSettingsOpen: (open) => set({ settingsOpen: open, ...(!open && { settingsInitialTab: null }) }),
  openSettingsTab: (tab) => set({ settingsOpen: true, settingsInitialTab: tab }),
}));

// Sync resolved theme → localStorage + <html> class whenever it changes.
// Runs outside React render so the DOM is always in sync, including for
// the FOUC-prevention script on next load.
useConfigStore.subscribe((state, prevState) => {
  if (state.config.theme !== prevState.config.theme) {
    try { localStorage.setItem('kng-resolved-theme', state.config.theme); } catch {}
    const cl = document.documentElement.classList;
    cl.forEach(c => { if (c.startsWith('theme-')) cl.remove(c); });
    if (state.config.theme !== 'dark') cl.add(`theme-${state.config.theme}`);
  }
});
