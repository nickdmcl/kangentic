import React, { useCallback } from 'react';
import { Bell, Bot, Check, CircleAlert, GitBranch, Palette, ShieldAlert, ShieldCheck, SlidersHorizontal, Terminal } from 'lucide-react';
import { useConfigStore } from '../../stores/config-store';
import { BranchPicker } from '../dialogs/BranchPicker';
import { SettingsPanelProvider, SectionHeader, SettingRow, Select, ToggleSwitch, CompactToggleList, INPUT_CLASS, useScopedUpdate, SearchTabGroupHeader, NoSearchResults } from './shared';
import type { SettingsTabDefinition, SettingScope, SettingsContentProps } from './shared';
import type { AppConfig, DeepPartial, NotificationConfig, PermissionMode, ThemeMode } from '../../../shared/types';
import { NAMED_THEMES } from '../../../shared/types';
import { settingProps } from './settings-registry';

/**
 * App Settings tab layout:
 *
 * Tabs ABOVE the separator are project-overridable settings (also shown in
 * ProjectSettingsPanel). Changes here set the global default. Projects without
 * explicit overrides inherit the new value automatically.
 *
 * Tabs BELOW the separator (after `separator: true`) are global-only settings
 * that apply to the entire app, not per-project. These tabs do NOT appear in
 * the ProjectSettingsPanel.
 */
export const APP_TABS: SettingsTabDefinition[] = [
  // -- Project-overridable defaults --
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'git', label: 'Git', icon: GitBranch },
  // -- Global-only (separator marks the boundary) --
  { id: 'behavior', label: 'Behavior', icon: SlidersHorizontal, separator: true },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
];

/** Tab IDs that are project-overridable (above the separator). */
export const PROJECT_OVERRIDABLE_TAB_IDS = new Set(
  APP_TABS.slice(0, APP_TABS.findIndex((tab) => tab.separator)).map((tab) => tab.id),
);

type NotifyEventKey = 'onAgentIdle' | 'onPlanComplete';

/** Map desktop/toast booleans to a single dropdown value. */
function notifyChannelValue(desktop: boolean, toast: boolean): string {
  if (desktop && toast) return 'both';
  if (desktop) return 'desktop';
  if (toast) return 'toast';
  return 'off';
}

/** Reusable row for a notification event with a Desktop/Toast channel dropdown. */
function NotifyChannelRow({ eventKey, config, searchId }: {
  eventKey: NotifyEventKey;
  config: NotificationConfig;
  searchId: string;
}) {
  const updateGlobal = useScopedUpdate('global');
  const value = notifyChannelValue(config.desktop[eventKey], config.toasts[eventKey]);
  const props = settingProps(searchId);
  return (
    <SettingRow {...props}>
      <Select
        value={value}
        onChange={(event) => {
          const selected = event.target.value;
          const desktop = selected === 'both' || selected === 'desktop';
          const toast = selected === 'both' || selected === 'toast';
          updateGlobal({
            notifications: {
              desktop: { [eventKey]: desktop },
              toasts: { [eventKey]: toast },
            },
          });
        }}
      >
        <option value="both">Desktop & Toast</option>
        <option value="desktop">Desktop Only</option>
        <option value="toast">Toast Only</option>
        <option value="off">Off</option>
      </Select>
    </SettingRow>
  );
}

/**
 * Global settings content. Rendered inside the unified SettingsPanel shell.
 * All changes save immediately to the global config. Projects without explicit
 * overrides inherit the new default automatically (VS Code-style).
 */
export function AppSettingsContent({ activeTab, isSearching, searchQuery, matchingTabs, navigateToTab, shells }: SettingsContentProps) {
  const globalConfig = useConfigStore((state) => state.globalConfig);
  const updateConfig = useConfigStore((state) => state.updateConfig);
  const claudeInfo = useConfigStore((state) => state.claudeInfo);

  /** Save directly to global config regardless of scope. */
  const updateSetting = useCallback((partial: DeepPartial<AppConfig>, _scope: SettingScope) => {
    updateConfig(partial);
  }, [updateConfig]);

  return (
    <SettingsPanelProvider value={{ panelType: 'app', updateSetting }}>
      {isSearching ? (
        // Search mode: render all matching tabs stacked
        matchingTabs.length > 0 ? (
          matchingTabs.map((tab, index) => (
            <div key={tab.id}>
              <SearchTabGroupHeader tab={tab} first={index === 0} onNavigate={navigateToTab} />
              <div className="space-y-4">
                {tab.id === 'appearance' && <AppearanceTab globalConfig={globalConfig} />}
                {tab.id === 'terminal' && <TerminalTab globalConfig={globalConfig} shells={shells} />}
                {tab.id === 'agent' && <AgentTab globalConfig={globalConfig} claudeInfo={claudeInfo} />}
                {tab.id === 'git' && <GitTab globalConfig={globalConfig} />}
                {tab.id === 'behavior' && <BehaviorTab globalConfig={globalConfig} />}
                {tab.id === 'notifications' && <NotificationsTab globalConfig={globalConfig} />}
                {tab.id === 'privacy' && <PrivacyTab />}
              </div>
            </div>
          ))
        ) : (
          <NoSearchResults query={searchQuery} />
        )
      ) : (
        // Normal mode: single active tab
        <>
          {activeTab === 'appearance' && <AppearanceTab globalConfig={globalConfig} />}
          {activeTab === 'terminal' && <TerminalTab globalConfig={globalConfig} shells={shells} />}
          {activeTab === 'agent' && <AgentTab globalConfig={globalConfig} claudeInfo={claudeInfo} />}
          {activeTab === 'behavior' && <BehaviorTab globalConfig={globalConfig} />}
          {activeTab === 'notifications' && <NotificationsTab globalConfig={globalConfig} />}
          {activeTab === 'privacy' && <PrivacyTab />}
          {activeTab === 'git' && <GitTab globalConfig={globalConfig} />}
        </>
      )}
    </SettingsPanelProvider>
  );
}

/* ── Tab Components ── */

function AppearanceTab({ globalConfig }: { globalConfig: AppConfig }) {
  const updateProject = useScopedUpdate('project');
  return (
    <SettingRow {...settingProps('theme')}>
      <Select
        value={globalConfig.theme}
        onChange={(event) => updateProject({ theme: event.target.value as ThemeMode })}
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

function TerminalTab({ globalConfig, shells }: { globalConfig: AppConfig; shells: Array<{ name: string; path: string }> }) {
  const updateProject = useScopedUpdate('project');
  const updateGlobal = useScopedUpdate('global');
  return (
    <>
      <SettingRow {...settingProps('terminal.shell')}>
        <Select
          value={globalConfig.terminal.shell || ''}
          onChange={(event) => updateProject({ terminal: { shell: event.target.value || null } })}
        >
          <option value="">Auto-detect</option>
          {shells.map((shell) => (
            <option key={shell.path} value={shell.path}>{shell.name}</option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow {...settingProps('terminal.fontSize')}>
        <input
          type="number"
          value={globalConfig.terminal.fontSize}
          onChange={(event) => updateProject({ terminal: { fontSize: Number(event.target.value) } })}
          min={8}
          max={32}
          className={INPUT_CLASS}
        />
      </SettingRow>
      <SettingRow {...settingProps('terminal.fontFamily')}>
        <input
          type="text"
          value={globalConfig.terminal.fontFamily}
          onChange={(event) => updateProject({ terminal: { fontFamily: event.target.value } })}
          className={INPUT_CLASS}
        />
      </SettingRow>
      <SettingRow {...settingProps('terminal.scrollbackLines')}>
        <input
          type="number"
          value={globalConfig.terminal.scrollbackLines}
          onChange={(event) => updateProject({ terminal: { scrollbackLines: Number(event.target.value) } })}
          min={1000}
          max={100000}
          step={1000}
          className={INPUT_CLASS}
        />
      </SettingRow>
      <SettingRow {...settingProps('terminal.cursorStyle')}>
        <Select
          value={globalConfig.terminal.cursorStyle}
          onChange={(event) => updateProject({ terminal: { cursorStyle: event.target.value as 'block' | 'underline' | 'bar' } })}
        >
          <option value="block">Block</option>
          <option value="underline">Underline</option>
          <option value="bar">Bar</option>
        </Select>
      </SettingRow>

      <SectionHeader
        label="Context Bar"
        searchIds={[
          'contextBar.showShell', 'contextBar.showVersion', 'contextBar.showModel',
          'contextBar.showCost', 'contextBar.showTokens', 'contextBar.showContextFraction',
          'contextBar.showProgressBar',
        ]}
      />
      <CompactToggleList scope="global" items={[
        { label: 'Shell', description: 'Detected shell name', checked: globalConfig.contextBar.showShell, onChange: (value) => updateGlobal({ contextBar: { showShell: value } }), searchId: 'contextBar.showShell' },
        { label: 'Version', description: 'Claude Code version', checked: globalConfig.contextBar.showVersion, onChange: (value) => updateGlobal({ contextBar: { showVersion: value } }), searchId: 'contextBar.showVersion' },
        { label: 'Model', description: 'Active model name', checked: globalConfig.contextBar.showModel, onChange: (value) => updateGlobal({ contextBar: { showModel: value } }), searchId: 'contextBar.showModel' },
        { label: 'Cost', description: 'Session API cost', checked: globalConfig.contextBar.showCost, onChange: (value) => updateGlobal({ contextBar: { showCost: value } }), searchId: 'contextBar.showCost' },
        { label: 'Token Counts', description: 'Input / output totals', checked: globalConfig.contextBar.showTokens, onChange: (value) => updateGlobal({ contextBar: { showTokens: value } }), searchId: 'contextBar.showTokens' },
        { label: 'Context Window', description: 'Used / total tokens', checked: globalConfig.contextBar.showContextFraction, onChange: (value) => updateGlobal({ contextBar: { showContextFraction: value } }), searchId: 'contextBar.showContextFraction' },
        { label: 'Progress Bar', description: 'Usage bar and percentage', checked: globalConfig.contextBar.showProgressBar, onChange: (value) => updateGlobal({ contextBar: { showProgressBar: value } }), searchId: 'contextBar.showProgressBar' },
      ]} />
    </>
  );
}

function AgentTab({ globalConfig, claudeInfo }: { globalConfig: AppConfig; claudeInfo: { found: boolean; path: string | null; version: string | null } | null }) {
  const updateGlobal = useScopedUpdate('global');
  const updateProject = useScopedUpdate('project');
  return (
    <>
      <SettingRow {...settingProps('claude.cliPath')}>
        <div className="relative">
          <input
            type="text"
            value={globalConfig.claude.cliPath || ''}
            onChange={(event) => updateGlobal({ claude: { cliPath: event.target.value || null } })}
            placeholder={claudeInfo?.found ? (claudeInfo.path ?? undefined) : 'Not found -- enter path manually'}
            className={`${INPUT_CLASS} pr-8 ${claudeInfo?.found ? 'placeholder-fg-muted' : 'placeholder-red-400/70'}`}
          />
          {claudeInfo && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2" title={claudeInfo.found ? `Detected: ${claudeInfo.version || 'unknown version'}` : 'Claude CLI not found'}>
              {claudeInfo.found
                ? <Check size={16} className="text-green-400" />
                : <CircleAlert size={16} className="text-red-400" />}
            </div>
          )}
        </div>
      </SettingRow>
      <SettingRow {...settingProps('claude.maxConcurrentSessions')}>
        <input
          type="number"
          value={globalConfig.claude.maxConcurrentSessions}
          onChange={(event) => updateGlobal({ claude: { maxConcurrentSessions: Number(event.target.value) } })}
          min={1}
          max={20}
          className={INPUT_CLASS}
        />
      </SettingRow>
      <SettingRow {...settingProps('claude.queueOverflow')}>
        <Select
          value={globalConfig.claude.queueOverflow}
          onChange={(event) => updateGlobal({ claude: { queueOverflow: event.target.value as 'queue' | 'reject' } })}
        >
          <option value="queue">Queue</option>
          <option value="reject">Reject</option>
        </Select>
      </SettingRow>
      <SettingRow {...settingProps('claude.idleTimeoutMinutes')}>
        <input
          type="number"
          value={globalConfig.claude.idleTimeoutMinutes}
          onChange={(event) => updateGlobal({ claude: { idleTimeoutMinutes: Number(event.target.value) } })}
          min={0}
          max={120}
          className={INPUT_CLASS}
        />
      </SettingRow>
      <SettingRow {...settingProps('claude.permissionMode')}>
        <Select
          value={globalConfig.claude.permissionMode}
          onChange={(event) => updateProject({ claude: { permissionMode: event.target.value as PermissionMode } })}
        >
          <option value="default">Default (Allowlist)</option>
          <option value="acceptEdits">Accept Edits</option>
          <option value="bypass-permissions">Bypass (Unsafe)</option>
        </Select>
      </SettingRow>
    </>
  );
}

function BehaviorTab({ globalConfig }: { globalConfig: AppConfig }) {
  const updateGlobal = useScopedUpdate('global');
  return (
    <>
      <SettingRow {...settingProps('skipDeleteConfirm')}>
        <ToggleSwitch
          checked={globalConfig.skipDeleteConfirm}
          onChange={(value) => updateGlobal({ skipDeleteConfirm: value })}
        />
      </SettingRow>
      <SettingRow {...settingProps('autoFocusIdleSession')}>
        <ToggleSwitch
          checked={globalConfig.autoFocusIdleSession}
          onChange={(value) => updateGlobal({ autoFocusIdleSession: value })}
        />
      </SettingRow>
      <SettingRow {...settingProps('activateAllProjectsOnStartup')}>
        <ToggleSwitch
          checked={globalConfig.activateAllProjectsOnStartup}
          onChange={(value) => updateGlobal({ activateAllProjectsOnStartup: value })}
        />
      </SettingRow>
      <SettingRow {...settingProps('restoreWindowPosition')}>
        <ToggleSwitch
          checked={globalConfig.restoreWindowPosition}
          onChange={(value) => updateGlobal({ restoreWindowPosition: value })}
        />
      </SettingRow>
    </>
  );
}

function NotificationsTab({ globalConfig }: { globalConfig: AppConfig }) {
  const updateGlobal = useScopedUpdate('global');
  return (
    <>
      <NotifyChannelRow
        eventKey="onAgentIdle"
        config={globalConfig.notifications}
        searchId="notifications.onAgentIdle"
      />
      <NotifyChannelRow
        eventKey="onPlanComplete"
        config={globalConfig.notifications}
        searchId="notifications.onPlanComplete"
      />
      <div className="border-t border-edge my-2" />
      <SettingRow {...settingProps('notifications.toasts.durationSeconds')}>
        <input
          type="number"
          value={globalConfig.notifications.toasts.durationSeconds}
          onChange={(event) => updateGlobal({ notifications: { toasts: { durationSeconds: Number(event.target.value) } } })}
          min={1}
          max={30}
          className={INPUT_CLASS}
        />
      </SettingRow>
      <SettingRow {...settingProps('notifications.toasts.maxCount')}>
        <input
          type="number"
          value={globalConfig.notifications.toasts.maxCount}
          onChange={(event) => updateGlobal({ notifications: { toasts: { maxCount: Number(event.target.value) } } })}
          min={1}
          max={10}
          className={INPUT_CLASS}
        />
      </SettingRow>
    </>
  );
}

function PrivacyTab() {
  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-2 rounded-full bg-surface-hover px-3.5 py-1.5">
        <ShieldAlert className="size-5 text-fg-muted shrink-0" />
        <span className="text-[1em] text-fg-secondary">Anonymous analytics only -- no personal data collected.</span>
      </div>

      <SectionHeader label="What We Collect" />
      <ul className="list-disc list-inside text-sm text-fg-muted space-y-1 ml-1">
        <li>App launches, platform, and architecture</li>
        <li>App crashes and errors (sanitized, no file paths)</li>
        <li>Task and project creation counts</li>
        <li>Agent session starts, exit codes, and duration</li>
      </ul>

      <SectionHeader label="What We Don't Collect" />
      <ul className="list-disc list-inside text-sm text-fg-muted space-y-1 ml-1">
        <li>Task titles, descriptions, or any user-generated content</li>
        <li>File paths, project names, or code</li>
        <li>Usernames, emails, or any personally identifiable information</li>
      </ul>

      <SectionHeader label="How It Works" />
      <p className="text-sm text-fg-muted leading-relaxed">
        Analytics are powered by Aptabase, a privacy-first platform.
        No cookies or persistent identifiers. IP addresses are used
        for geographic lookup only, then discarded. GDPR-compliant by design.
      </p>

      <SectionHeader label="How to Opt Out" />
      <p className="text-sm text-fg-muted leading-relaxed">
        Set <code className="font-mono">KANGENTIC_TELEMETRY=0</code> as an environment variable to disable analytics.
      </p>
    </div>
  );
}

function GitTab({ globalConfig }: { globalConfig: AppConfig }) {
  const updateProject = useScopedUpdate('project');
  return (
    <>
      <SettingRow {...settingProps('git.worktreesEnabled')}>
        <ToggleSwitch
          checked={globalConfig.git.worktreesEnabled}
          onChange={(value) => updateProject({ git: { worktreesEnabled: value } })}
        />
      </SettingRow>
      <SettingRow {...settingProps('git.autoCleanup')}>
        <ToggleSwitch
          checked={globalConfig.git.autoCleanup}
          onChange={(value) => updateProject({ git: { autoCleanup: value } })}
        />
      </SettingRow>
      <SettingRow {...settingProps('git.defaultBaseBranch')}>
        <BranchPicker
          variant="input"
          value={globalConfig.git.defaultBaseBranch}
          defaultBranch="main"
          onChange={(branch) => updateProject({ git: { defaultBaseBranch: branch } })}
        />
      </SettingRow>
      <SettingRow {...settingProps('git.copyFiles')}>
        <input
          type="text"
          value={globalConfig.git.copyFiles.join(', ')}
          onChange={(event) => {
            const files = event.target.value.split(',').map((file) => file.trim()).filter(Boolean);
            updateProject({ git: { copyFiles: files } });
          }}
          placeholder=".env, .env.local"
          className={`${INPUT_CLASS} placeholder-fg-faint`}
        />
      </SettingRow>
      <SettingRow {...settingProps('git.initScript')}>
        <input
          type="text"
          value={globalConfig.git.initScript || ''}
          onChange={(event) => updateProject({ git: { initScript: event.target.value || null } })}
          placeholder="npm install"
          className={`${INPUT_CLASS} placeholder-fg-faint`}
        />
      </SettingRow>
    </>
  );
}
