import React from 'react';
import { Bot, GitBranch, Palette, Terminal } from 'lucide-react';
import { useConfigStore } from '../../stores/config-store';
import { BranchPicker } from '../dialogs/BranchPicker';
import { SettingsPanelProvider, SettingRow, Select, ToggleSwitch, INPUT_CLASS, SearchTabGroupHeader, NoSearchResults } from './shared';
import type { SettingsTabDefinition, SettingsContentProps } from './shared';
import type { AppConfig, DeepPartial, PermissionMode, ThemeMode } from '../../../shared/types';
import { NAMED_THEMES } from '../../../shared/types';
import { deepMergeConfig } from '../../../shared/object-utils';
import { SETTINGS_REGISTRY, settingProps } from './settings-registry';

/**
 * Project Settings only shows tabs that are project-overridable (the tabs
 * above the separator in AppSettingsPanel). Global-only tabs like Behavior,
 * Notifications, and Privacy are NOT shown here.
 */
export const PROJECT_TABS: SettingsTabDefinition[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'git', label: 'Git', icon: GitBranch },
];

/** Only project-overridable settings for search. */
const PROJECT_TAB_IDS = new Set(PROJECT_TABS.map((tab) => tab.id));
export const PROJECT_REGISTRY = SETTINGS_REGISTRY.filter(
  (setting) => PROJECT_TAB_IDS.has(setting.tabId) && setting.scope === 'project',
);

/**
 * Project settings content. Rendered inside the unified SettingsPanel shell.
 * Manages its own SettingsPanelProvider context for project override writes.
 */
export function ProjectSettingsContent({ activeTab, isSearching, searchQuery, matchingTabs, navigateToTab, shells }: SettingsContentProps) {
  const globalConfig = useConfigStore((state) => state.globalConfig);
  const projectOverrides = useConfigStore((state) => state.projectOverrides);
  const updateProjectOverride = useConfigStore((state) => state.updateProjectOverride);
  const removeProjectOverride = useConfigStore((state) => state.removeProjectOverride);
  const isOverridden = useConfigStore((state) => state.isOverridden);

  const displayConfig = projectOverrides
    ? deepMergeConfig(globalConfig, projectOverrides)
    : globalConfig;

  /** In the project panel, scope is ignored -- all updates write to project overrides. */
  const updateSetting = (partial: DeepPartial<AppConfig>) => {
    updateProjectOverride(partial);
  };

  const tabProps: ProjectTabProps = {
    displayConfig,
    isOverridden,
    removeProjectOverride,
    updateProjectOverride,
  };

  return (
    <SettingsPanelProvider value={{ panelType: 'project', updateSetting }}>
      {isSearching ? (
        // Search mode: render all matching tabs stacked
        matchingTabs.length > 0 ? (
          matchingTabs.map((tab, index) => (
            <div key={tab.id}>
              <SearchTabGroupHeader tab={tab} first={index === 0} onNavigate={navigateToTab} />
              <div className="space-y-4">
                {tab.id === 'appearance' && <AppearanceTabProject {...tabProps} />}
                {tab.id === 'terminal' && <TerminalTabProject {...tabProps} shells={shells} />}
                {tab.id === 'agent' && <AgentTabProject {...tabProps} />}
                {tab.id === 'git' && <GitTabProject {...tabProps} />}
              </div>
            </div>
          ))
        ) : (
          <NoSearchResults query={searchQuery} />
        )
      ) : (
        // Normal mode: single active tab
        <>
          {activeTab === 'appearance' && <AppearanceTabProject {...tabProps} />}
          {activeTab === 'terminal' && <TerminalTabProject {...tabProps} shells={shells} />}
          {activeTab === 'agent' && <AgentTabProject {...tabProps} />}
          {activeTab === 'git' && <GitTabProject {...tabProps} />}
        </>
      )}
    </SettingsPanelProvider>
  );
}

/* ── Tab Components ── */

interface ProjectTabProps {
  displayConfig: AppConfig;
  isOverridden: (path: string) => boolean;
  removeProjectOverride: (path: string) => void;
  updateProjectOverride: (partial: DeepPartial<AppConfig>) => void;
}

function AppearanceTabProject({ displayConfig, isOverridden, removeProjectOverride, updateProjectOverride }: ProjectTabProps) {
  return (
    <SettingRow
      {...settingProps('theme')}
      isOverridden={isOverridden('theme')}
      onReset={() => removeProjectOverride('theme')}
    >
      <Select
        value={displayConfig.theme}
        onChange={(event) => updateProjectOverride({ theme: event.target.value as ThemeMode })}
      >
        <optgroup label="Standard">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </optgroup>
        <optgroup label="Dark Palette">
          {NAMED_THEMES.filter(theme => theme.base === 'dark').map(theme => (
            <option key={theme.id} value={theme.id}>{theme.label}</option>
          ))}
        </optgroup>
        <optgroup label="Light Palette">
          {NAMED_THEMES.filter(theme => theme.base === 'light').map(theme => (
            <option key={theme.id} value={theme.id}>{theme.label}</option>
          ))}
        </optgroup>
      </Select>
    </SettingRow>
  );
}

interface TerminalTabProjectProps extends ProjectTabProps {
  shells: Array<{ name: string; path: string }>;
}

function TerminalTabProject({ displayConfig, shells, isOverridden, removeProjectOverride, updateProjectOverride }: TerminalTabProjectProps) {
  return (
    <>
      <SettingRow
        {...settingProps('terminal.shell')}
        isOverridden={isOverridden('terminal.shell')}
        onReset={() => removeProjectOverride('terminal.shell')}
      >
        <Select
          value={displayConfig.terminal.shell || ''}
          onChange={(event) => updateProjectOverride({ terminal: { shell: event.target.value || null } })}
        >
          <option value="">Auto-detect</option>
          {shells.map((shell) => (
            <option key={shell.path} value={shell.path}>{shell.name}</option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow
        {...settingProps('terminal.fontSize')}
        isOverridden={isOverridden('terminal.fontSize')}
        onReset={() => removeProjectOverride('terminal.fontSize')}
      >
        <input
          type="number"
          value={displayConfig.terminal.fontSize}
          onChange={(event) => updateProjectOverride({ terminal: { fontSize: Number(event.target.value) } })}
          min={8}
          max={32}
          className={INPUT_CLASS}
        />
      </SettingRow>
      <SettingRow
        {...settingProps('terminal.fontFamily')}
        isOverridden={isOverridden('terminal.fontFamily')}
        onReset={() => removeProjectOverride('terminal.fontFamily')}
      >
        <input
          type="text"
          value={displayConfig.terminal.fontFamily}
          onChange={(event) => updateProjectOverride({ terminal: { fontFamily: event.target.value } })}
          className={INPUT_CLASS}
        />
      </SettingRow>
    </>
  );
}

function AgentTabProject({ displayConfig, isOverridden, removeProjectOverride, updateProjectOverride }: ProjectTabProps) {
  return (
    <SettingRow
      {...settingProps('claude.permissionMode')}
      isOverridden={isOverridden('claude.permissionMode')}
      onReset={() => removeProjectOverride('claude.permissionMode')}
    >
      <Select
        value={displayConfig.claude.permissionMode}
        onChange={(event) => updateProjectOverride({ claude: { permissionMode: event.target.value as PermissionMode } })}
      >
        <option value="default">Default (Allowlist)</option>
        <option value="acceptEdits">Accept Edits</option>
        <option value="bypass-permissions">Bypass (Unsafe)</option>
      </Select>
    </SettingRow>
  );
}

function GitTabProject({ displayConfig, isOverridden, removeProjectOverride, updateProjectOverride }: ProjectTabProps) {
  return (
    <>
      <SettingRow
        {...settingProps('git.worktreesEnabled')}
        isOverridden={isOverridden('git.worktreesEnabled')}
        onReset={() => removeProjectOverride('git.worktreesEnabled')}
      >
        <ToggleSwitch
          checked={displayConfig.git.worktreesEnabled}
          onChange={(value) => updateProjectOverride({ git: { worktreesEnabled: value } })}
        />
      </SettingRow>
      <SettingRow
        {...settingProps('git.autoCleanup')}
        isOverridden={isOverridden('git.autoCleanup')}
        onReset={() => removeProjectOverride('git.autoCleanup')}
      >
        <ToggleSwitch
          checked={displayConfig.git.autoCleanup}
          onChange={(value) => updateProjectOverride({ git: { autoCleanup: value } })}
        />
      </SettingRow>
      <SettingRow
        {...settingProps('git.defaultBaseBranch')}
        isOverridden={isOverridden('git.defaultBaseBranch')}
        onReset={() => removeProjectOverride('git.defaultBaseBranch')}
      >
        <BranchPicker
          variant="input"
          value={displayConfig.git.defaultBaseBranch}
          defaultBranch="main"
          onChange={(branch) => updateProjectOverride({ git: { defaultBaseBranch: branch } })}
        />
      </SettingRow>
      <SettingRow
        {...settingProps('git.copyFiles')}
        isOverridden={isOverridden('git.copyFiles')}
        onReset={() => removeProjectOverride('git.copyFiles')}
      >
        <input
          type="text"
          value={displayConfig.git.copyFiles.join(', ')}
          onChange={(event) => {
            const files = event.target.value.split(',').map((file) => file.trim()).filter(Boolean);
            updateProjectOverride({ git: { copyFiles: files } });
          }}
          placeholder=".env, .env.local"
          className={`${INPUT_CLASS} placeholder-fg-faint`}
        />
      </SettingRow>
      <SettingRow
        {...settingProps('git.initScript')}
        isOverridden={isOverridden('git.initScript')}
        onReset={() => removeProjectOverride('git.initScript')}
      >
        <input
          type="text"
          value={displayConfig.git.initScript || ''}
          onChange={(event) => updateProjectOverride({ git: { initScript: event.target.value || null } })}
          placeholder="npm install"
          className={`${INPUT_CLASS} placeholder-fg-faint`}
        />
      </SettingRow>
    </>
  );
}
