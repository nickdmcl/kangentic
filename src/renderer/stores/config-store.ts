import { create } from 'zustand';
import type { AppConfig, DeepPartial } from '../../shared/types';
import { DEFAULT_CONFIG } from '../../shared/types';
import { deepEqual, deepMergeConfig, getNestedValue, hasNestedKey, removeNestedKey } from '../../shared/object-utils';

/** Extract the version number from the raw string (e.g. "2.1.50 (Claude Code)" -> "2.1.50"). */
function parseClaudeVersion(version: string | null): string | null {
  return version?.replace(/\s*\(.*\)/, '') || null;
}

interface ConfigStore {
  // -- App config --
  config: AppConfig;
  globalConfig: AppConfig;
  loading: boolean;
  loadConfig: () => Promise<void>;
  updateConfig: (partial: DeepPartial<AppConfig>) => Promise<void>;

  // -- App version --
  appVersion: string | null;
  loadAppVersion: () => Promise<void>;

  // -- Claude CLI detection --
  claudeInfo: { found: boolean; path: string | null; version: string | null } | null;
  claudeVersionNumber: string | null;
  detectClaude: () => Promise<void>;

  // -- Git detection --
  gitInfo: { found: boolean; path: string | null; version: string | null; meetsMinimum: boolean } | null;
  detectGit: () => Promise<void>;

  // -- App Settings panel UI --
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  // -- Project Settings panel UI --
  projectSettingsOpen: boolean;
  projectSettingsPath: string | null;
  projectSettingsProjectName: string | null;
  openProjectSettings: (projectPath: string, projectName: string) => void;
  setProjectSettingsOpen: (open: boolean) => void;

  // -- Project overrides --
  projectOverrides: DeepPartial<AppConfig> | null;
  loadProjectOverrides: () => Promise<void>;
  updateProjectOverride: (partial: DeepPartial<AppConfig>) => Promise<void>;
  removeProjectOverride: (keyPath: string) => Promise<void>;
  resetAllProjectOverrides: () => Promise<void>;
  isOverridden: (keyPath: string) => boolean;

}

/** Fetch both effective and global configs from main process. */
async function refreshConfigs(): Promise<{ config: AppConfig; globalConfig: AppConfig }> {
  const [config, globalConfig] = await Promise.all([
    window.electronAPI.config.get(),
    window.electronAPI.config.getGlobal(),
  ]);
  return { config, globalConfig };
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  globalConfig: DEFAULT_CONFIG,
  appVersion: null,
  claudeInfo: null,
  claudeVersionNumber: null,
  gitInfo: null,
  loading: false,
  settingsOpen: false,
  projectSettingsOpen: false,
  projectSettingsPath: null,
  projectSettingsProjectName: null,
  projectOverrides: null,
  loadConfig: async () => {
    set({ loading: true });
    const configs = await refreshConfigs();
    set({ ...configs, loading: false });
  },

  updateConfig: async (partial) => {
    await window.electronAPI.config.set(partial);
    const configs = await refreshConfigs();
    set(configs);
  },

  loadAppVersion: async () => {
    const appVersion = await window.electronAPI.app.getVersion();
    set({ appVersion });
  },

  detectClaude: async () => {
    const claudeInfo = await window.electronAPI.claude.detect();
    const version = parseClaudeVersion(claudeInfo?.version ?? null);
    set({
      claudeInfo,
      claudeVersionNumber: version,
    });
  },

  detectGit: async () => {
    const gitInfo = await window.electronAPI.git.detect();
    set({ gitInfo });
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  // -- Project settings --
  openProjectSettings: (projectPath, projectName) => {
    set({
      projectSettingsOpen: true,
      projectSettingsPath: projectPath,
      projectSettingsProjectName: projectName,
      projectOverrides: null,
    });
    // Load overrides asynchronously
    window.electronAPI.config.getProjectOverridesByPath(projectPath).then((overrides) => {
      // Only apply if the path hasn't changed during the async call
      if (get().projectSettingsPath === projectPath) {
        set({ projectOverrides: overrides });
      }
    });
  },

  setProjectSettingsOpen: (open) => {
    if (!open) {
      set({
        projectSettingsOpen: false,
        projectSettingsPath: null,
        projectSettingsProjectName: null,
        projectOverrides: null,
      });
      // Re-fetch effective config in case overrides changed
      refreshConfigs().then((configs) => set(configs));
    } else {
      set({ projectSettingsOpen: open });
    }
  },

  loadProjectOverrides: async () => {
    const projectPath = get().projectSettingsPath;
    if (!projectPath) return;
    const overrides = await window.electronAPI.config.getProjectOverridesByPath(projectPath);
    if (get().projectSettingsPath === projectPath) {
      set({ projectOverrides: overrides });
    }
  },

  updateProjectOverride: async (partial) => {
    const projectPath = get().projectSettingsPath;
    if (!projectPath) return;
    const current = get().projectOverrides || {};
    const merged = deepMergeConfig(current, partial) as DeepPartial<AppConfig>;
    await window.electronAPI.config.setProjectOverridesByPath(projectPath, merged);
    const effective = deepMergeConfig(get().globalConfig, merged);
    set({ projectOverrides: merged, config: effective });
  },

  removeProjectOverride: async (keyPath) => {
    const projectPath = get().projectSettingsPath;
    if (!projectPath) return;
    const current = get().projectOverrides;
    if (!current) return;
    const cloned = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    removeNestedKey(cloned, keyPath);
    const updated = cloned as DeepPartial<AppConfig>;
    await window.electronAPI.config.setProjectOverridesByPath(projectPath, updated);
    const effective = deepMergeConfig(get().globalConfig, cloned);
    set({ projectOverrides: updated, config: effective });
  },

  resetAllProjectOverrides: async () => {
    const projectPath = get().projectSettingsPath;
    if (!projectPath) return;
    await window.electronAPI.config.setProjectOverridesByPath(projectPath, {});
    set({ projectOverrides: {}, config: { ...get().globalConfig } });
  },

  isOverridden: (keyPath) => {
    const overrides = get().projectOverrides;
    if (!overrides) return false;
    if (!hasNestedKey(overrides, keyPath)) return false;
    const overrideValue = getNestedValue(overrides, keyPath);
    const globalValue = getNestedValue(get().globalConfig, keyPath);
    return !deepEqual(overrideValue, globalValue);
  },

}));

// Sync resolved theme -> localStorage + <html> class whenever it changes.
// Runs outside React render so the DOM is always in sync, including for
// the FOUC-prevention script on next load.
useConfigStore.subscribe((state, prevState) => {
  if (state.config.theme !== prevState.config.theme) {
    try { localStorage.setItem('kng-resolved-theme', state.config.theme); } catch {}
    const classList = document.documentElement.classList;
    classList.forEach(className => { if (className.startsWith('theme-')) classList.remove(className); });
    if (state.config.theme !== 'dark') classList.add(`theme-${state.config.theme}`);
  }
});
