import { create } from 'zustand';
import type { AppConfig, DeepPartial } from '../../shared/types';
import { DEFAULT_CONFIG } from '../../shared/types';
import { deepEqual, deepMergeConfig, getNestedValue, hasNestedKey, removeNestedKey } from '../../shared/object-utils';

/** Extract the version number from the raw string (e.g. "2.1.50 (Claude Code)" → "2.1.50"). */
function parseClaudeVersion(version: string | null): string | null {
  return version?.replace(/\s*\(.*\)/, '') || null;
}

export type SettingsScope = 'global' | 'project';

interface ConfigStore {
  // -- App config --
  config: AppConfig;
  globalConfig: AppConfig;
  loading: boolean;
  loadConfig: () => Promise<void>;
  updateConfig: (partial: DeepPartial<AppConfig>) => Promise<void>;

  // -- Claude CLI detection --
  claudeInfo: { found: boolean; path: string | null; version: string | null } | null;
  claudeVersionLabel: string;
  claudeVersionNumber: string | null;
  detectClaude: () => Promise<void>;

  // -- Settings panel UI --
  settingsOpen: boolean;
  settingsInitialTab: string | null;
  settingsScope: SettingsScope;
  settingsScopeProjectPath: string | null;
  projectOverrides: DeepPartial<AppConfig> | null;
  setSettingsOpen: (open: boolean) => void;
  openSettingsTab: (tab: string) => void;
  setSettingsScope: (scope: SettingsScope, projectPath?: string) => void;
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
  claudeInfo: null,
  claudeVersionLabel: 'Claude Code',
  claudeVersionNumber: null,
  loading: false,
  settingsOpen: false,
  settingsInitialTab: null,
  settingsScope: 'global',
  settingsScopeProjectPath: null,
  projectOverrides: null,

  loadConfig: async () => {
    set({ loading: true });
    set({ ...await refreshConfigs(), loading: false });
  },

  updateConfig: async (partial) => {
    await window.electronAPI.config.set(partial);
    set(await refreshConfigs());
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

  setSettingsOpen: (open) => set({
    settingsOpen: open,
    ...(!open && { settingsInitialTab: null, settingsScope: 'global', settingsScopeProjectPath: null }),
  }),
  openSettingsTab: (tab) => set({ settingsOpen: true, settingsInitialTab: tab }),

  setSettingsScope: (scope, projectPath) => {
    const resolvedPath = scope === 'project' ? (projectPath ?? null) : null;
    set({ settingsScope: scope, settingsScopeProjectPath: resolvedPath, projectOverrides: null });
    if (scope === 'project') {
      get().loadProjectOverrides();
    } else {
      // Re-fetch global config to pick up any changes made in project scope
      window.electronAPI.config.getGlobal().then((globalConfig) => set({ globalConfig }));
    }
  },

  loadProjectOverrides: async () => {
    const projectPath = get().settingsScopeProjectPath;
    if (!projectPath) return;
    const overrides = await window.electronAPI.config.getProjectOverridesByPath(projectPath);
    // Only apply if the scope hasn't changed during the async call
    if (get().settingsScopeProjectPath === projectPath) {
      set({ projectOverrides: overrides });
    }
  },

  updateProjectOverride: async (partial) => {
    const projectPath = get().settingsScopeProjectPath;
    if (!projectPath) return;
    const current = get().projectOverrides || {};
    const merged = deepMergeConfig(current, partial as Record<string, unknown>) as DeepPartial<AppConfig>;
    await window.electronAPI.config.setProjectOverridesByPath(projectPath, merged);
    const effective = deepMergeConfig(get().globalConfig, merged as Record<string, unknown>);
    set({ projectOverrides: merged, config: effective });
  },

  removeProjectOverride: async (keyPath) => {
    const projectPath = get().settingsScopeProjectPath;
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
    const projectPath = get().settingsScopeProjectPath;
    if (!projectPath) return;
    await window.electronAPI.config.setProjectOverridesByPath(projectPath, {});
    set({ projectOverrides: {}, config: { ...get().globalConfig } });
  },

  // Re-renders rely on `projectOverrides` being selected as state in the consuming
  // component (SettingsPanel), which triggers re-render when overrides change.
  isOverridden: (keyPath) => {
    const overrides = get().projectOverrides;
    if (!overrides) return false;
    if (!hasNestedKey(overrides, keyPath)) return false;
    const overrideValue = getNestedValue(overrides, keyPath);
    const globalValue = getNestedValue(get().globalConfig, keyPath);
    return !deepEqual(overrideValue, globalValue);
  },
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
