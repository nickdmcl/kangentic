import React, { useEffect, useState } from 'react';
import { Bot, FolderOpen, GitBranch, Palette, Terminal } from 'lucide-react';
import { useConfigStore } from '../../stores/config-store';
import { BranchPicker } from '../dialogs/BranchPicker';
import { SettingsPanelShell, SettingsPanelProvider, SettingRow, Select, ToggleSwitch, ResetOverridesFooter, INPUT_CLASS, useScopedUpdate } from './shared';
import type { SettingsTabDefinition } from './shared';
import type { AppConfig, DeepPartial, PermissionMode, ThemeMode } from '../../../shared/types';
import { NAMED_THEMES } from '../../../shared/types';
import { deepMergeConfig } from '../../../shared/object-utils';

/**
 * Project Settings only shows tabs that are project-overridable (the tabs
 * above the separator in AppSettingsPanel). Global-only tabs like Behavior,
 * Notifications, and Privacy are NOT shown here.
 */
const PROJECT_TABS: SettingsTabDefinition[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'git', label: 'Git', icon: GitBranch },
];

export function ProjectSettingsPanel() {
  const globalConfig = useConfigStore((state) => state.globalConfig);
  const projectSettingsProjectName = useConfigStore((state) => state.projectSettingsProjectName);
  const projectOverrides = useConfigStore((state) => state.projectOverrides);
  const updateProjectOverride = useConfigStore((state) => state.updateProjectOverride);
  const removeProjectOverride = useConfigStore((state) => state.removeProjectOverride);
  const resetAllProjectOverrides = useConfigStore((state) => state.resetAllProjectOverrides);
  const isOverridden = useConfigStore((state) => state.isOverridden);
  const setProjectSettingsOpen = useConfigStore((state) => state.setProjectSettingsOpen);

  const [shells, setShells] = useState<Array<{ name: string; path: string }>>([]);

  useEffect(() => {
    window.electronAPI.shell.getAvailable().then(setShells).catch(() => {});
  }, []);

  const handleClose = () => setProjectSettingsOpen(false);

  const displayConfig = projectOverrides
    ? deepMergeConfig(globalConfig, projectOverrides)
    : globalConfig;

  /** In the project panel, scope is ignored -- all updates write to project overrides. */
  const updateSetting = (partial: DeepPartial<AppConfig>) => {
    updateProjectOverride(partial);
  };

  const hasAnyOverrides = projectOverrides != null && Object.keys(projectOverrides).length > 0;

  /** Format a global default value for display as an inherited hint. */
  const defaultHint = (value: unknown): string => {
    if (value === null || value === undefined) return 'Auto-detect';
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '(none)';
    return String(value);
  };

  const [activeTab, setActiveTab] = useState('appearance');

  const resetFooter = hasAnyOverrides ? (
    <ResetOverridesFooter onReset={resetAllProjectOverrides} />
  ) : undefined;

  return (
    <SettingsPanelProvider value={{ panelType: 'project', updateSetting }}>
      <SettingsPanelShell
        subtitle={projectSettingsProjectName ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs">
            <FolderOpen size={14} />
            {projectSettingsProjectName}
          </span>
        ) : undefined}
        onClose={handleClose}
        tabs={PROJECT_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        footer={resetFooter}
      >
        {/* ── Appearance ── */}
        {activeTab === 'appearance' && (
          <SettingRow
            label="Theme"
            description="Color scheme for the interface"
            scope="project"
            isOverridden={isOverridden('theme')}
            onReset={() => removeProjectOverride('theme')}
            inheritedHint={defaultHint(globalConfig.theme)}
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
        )}

        {/* ── Terminal ── */}
        {activeTab === 'terminal' && (
          <>
            <SettingRow
              label="Shell"
              description="Terminal shell used for agent sessions"
              scope="project"
              isOverridden={isOverridden('terminal.shell')}
              onReset={() => removeProjectOverride('terminal.shell')}
              inheritedHint={defaultHint(globalConfig.terminal.shell)}
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
              label="Font Size"
              description="Terminal text size in pixels"
              scope="project"
              isOverridden={isOverridden('terminal.fontSize')}
              onReset={() => removeProjectOverride('terminal.fontSize')}
              inheritedHint={defaultHint(globalConfig.terminal.fontSize)}
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
              label="Font Family"
              description="CSS font-family for the terminal"
              scope="project"
              isOverridden={isOverridden('terminal.fontFamily')}
              onReset={() => removeProjectOverride('terminal.fontFamily')}
              inheritedHint={defaultHint(globalConfig.terminal.fontFamily)}
            >
              <input
                type="text"
                value={displayConfig.terminal.fontFamily}
                onChange={(event) => updateProjectOverride({ terminal: { fontFamily: event.target.value } })}
                className={INPUT_CLASS}
              />
            </SettingRow>
          </>
        )}

        {/* ── Agent ── */}
        {activeTab === 'agent' && (
          <SettingRow
            label="Permissions"
            description="How Claude handles tool approvals"
            scope="project"
            isOverridden={isOverridden('claude.permissionMode')}
            onReset={() => removeProjectOverride('claude.permissionMode')}
            inheritedHint={defaultHint(globalConfig.claude.permissionMode)}
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
        )}

        {/* ── Git ── */}
        {activeTab === 'git' && (
          <>
            <SettingRow
              label="Enable Worktrees"
              description="Create git worktrees for agent tasks"
              scope="project"
              isOverridden={isOverridden('git.worktreesEnabled')}
              onReset={() => removeProjectOverride('git.worktreesEnabled')}
              inheritedHint={defaultHint(globalConfig.git.worktreesEnabled)}
            >
              <ToggleSwitch
                checked={displayConfig.git.worktreesEnabled}
                onChange={(value) => updateProjectOverride({ git: { worktreesEnabled: value } })}
              />
            </SettingRow>
            <SettingRow
              label="Auto-cleanup"
              description="Remove worktrees when tasks complete"
              scope="project"
              isOverridden={isOverridden('git.autoCleanup')}
              onReset={() => removeProjectOverride('git.autoCleanup')}
              inheritedHint={defaultHint(globalConfig.git.autoCleanup)}
            >
              <ToggleSwitch
                checked={displayConfig.git.autoCleanup}
                onChange={(value) => updateProjectOverride({ git: { autoCleanup: value } })}
              />
            </SettingRow>
            <SettingRow
              label="Default Base Branch"
              description="Branch to create worktrees from"
              scope="project"
              isOverridden={isOverridden('git.defaultBaseBranch')}
              onReset={() => removeProjectOverride('git.defaultBaseBranch')}
              inheritedHint={defaultHint(globalConfig.git.defaultBaseBranch)}
            >
              <BranchPicker
                variant="input"
                value={displayConfig.git.defaultBaseBranch}
                defaultBranch="main"
                onChange={(branch) => updateProjectOverride({ git: { defaultBaseBranch: branch } })}
              />
            </SettingRow>
            <SettingRow
              label="Copy Files"
              description="Additional files copied into each worktree"
              scope="project"
              isOverridden={isOverridden('git.copyFiles')}
              onReset={() => removeProjectOverride('git.copyFiles')}
              inheritedHint={defaultHint(globalConfig.git.copyFiles)}
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
              label="Post-Worktree Script"
              description="Shell script to run after worktree creation"
              scope="project"
              isOverridden={isOverridden('git.initScript')}
              onReset={() => removeProjectOverride('git.initScript')}
              inheritedHint={defaultHint(globalConfig.git.initScript)}
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
        )}
      </SettingsPanelShell>
    </SettingsPanelProvider>
  );
}
