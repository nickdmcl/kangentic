import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Globe } from 'lucide-react';
import { useConfigStore } from '../../stores/config-store';
import { useProjectStore } from '../../stores/project-store';
import { SettingsPanelShell, ResetOverridesFooter } from './shared';
import type { ScopeTabItem, SettingsContentProps } from './shared';
import { SettingsSearchProvider, computeSearchResults } from './settings-search';
import { APP_TABS, PROJECT_OVERRIDABLE_TAB_IDS, AppSettingsContent } from './AppSettingsPanel';
import { PROJECT_TABS, PROJECT_REGISTRY, ProjectSettingsContent } from './ProjectSettingsPanel';
import { SETTINGS_REGISTRY } from './settings-registry';

/**
 * Unified settings panel that renders a single SettingsPanelShell and switches
 * between global and project content based on `settingsScope`. The shell stays
 * mounted when switching scopes, so there is no close/reopen animation.
 */
export function SettingsPanel() {
  const settingsScope = useConfigStore((state) => state.settingsScope);
  const setSettingsOpen = useConfigStore((state) => state.setSettingsOpen);
  const setSettingsScope = useConfigStore((state) => state.setSettingsScope);
  const openProjectSettings = useConfigStore((state) => state.openProjectSettings);
  const projectSettingsProjectName = useConfigStore((state) => state.projectSettingsProjectName);
  const projectOverrides = useConfigStore((state) => state.projectOverrides);
  const resetAllProjectOverrides = useConfigStore((state) => state.resetAllProjectOverrides);
  const currentProject = useProjectStore((state) => state.currentProject);
  const detectClaude = useConfigStore((state) => state.detectClaude);

  const [shells, setShells] = useState<Array<{ name: string; path: string }>>([]);
  const [activeTab, setActiveTab] = useState(() => {
    const initialTab = useConfigStore.getState().projectSettingsInitialTab;
    const scope = useConfigStore.getState().settingsScope;
    if (scope === 'project' && initialTab) return initialTab;
    return 'appearance';
  });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    window.electronAPI.shell.getAvailable().then(setShells).catch(() => {});
    detectClaude();
  }, []);

  // Clamp activeTab when scope changes (e.g. global-only tab -> project scope)
  const previousScopeRef = useRef(settingsScope);
  useEffect(() => {
    if (settingsScope === previousScopeRef.current) return;
    previousScopeRef.current = settingsScope;

    const currentTabs = settingsScope === 'project' ? PROJECT_TABS : APP_TABS;
    const validIds = currentTabs.map((tab) => tab.id);

    if (!validIds.includes(activeTab)) {
      const initialTab = useConfigStore.getState().projectSettingsInitialTab;
      setActiveTab(initialTab && validIds.includes(initialTab) ? initialTab : validIds[0]);
    }
  }, [settingsScope, activeTab]);

  const scope = settingsScope || 'global';
  const tabs = scope === 'project' ? PROJECT_TABS : APP_TABS;
  const registry = scope === 'project' ? PROJECT_REGISTRY : SETTINGS_REGISTRY;

  // Search computation
  const searchResults = useMemo(
    () => computeSearchResults(searchQuery, registry),
    [searchQuery, registry],
  );
  const isSearching = searchQuery.trim().length > 0;

  /** When clearing search, if results were in exactly one tab, switch to it. */
  const handleSearchChange = useCallback((query: string) => {
    if (!query && searchQuery) {
      const tabsWithMatches = Array.from(searchResults.tabMatchCounts.keys());
      if (tabsWithMatches.length === 1) {
        setActiveTab(tabsWithMatches[0]);
      }
    }
    setSearchQuery(query);
  }, [searchQuery, searchResults.tabMatchCounts]);

  /** Ordered list of tabs that have search matches. */
  const matchingTabs = useMemo(() => {
    if (!isSearching) return [];
    return tabs.filter((tab) => (searchResults.tabMatchCounts.get(tab.id) || 0) > 0);
  }, [isSearching, searchResults.tabMatchCounts, tabs]);

  /** Clear search and navigate to a specific tab. */
  const navigateToTab = useCallback((tabId: string) => {
    setSearchQuery('');
    setActiveTab(tabId);
  }, []);

  const handleClose = useCallback(() => {
    setSettingsOpen(false);
  }, [setSettingsOpen]);

  // Scope tabs
  const scopeTabs = useMemo((): ScopeTabItem[] => {
    if (scope === 'global') {
      const result: ScopeTabItem[] = [
        { label: 'Global', icon: Globe, active: true, testId: 'scope-tab-global' },
      ];
      if (currentProject && PROJECT_OVERRIDABLE_TAB_IDS.has(activeTab) && !isSearching) {
        result.push({
          label: currentProject.name,
          icon: FolderOpen,
          active: false,
          testId: 'scope-tab-project',
          onClick: () => {
            openProjectSettings(currentProject.path, currentProject.name, activeTab);
          },
        });
      }
      return result;
    }
    return [
      {
        label: 'Global',
        icon: Globe,
        active: false,
        testId: 'scope-tab-global',
        onClick: () => setSettingsScope('global'),
      },
      {
        label: projectSettingsProjectName || 'Project',
        icon: FolderOpen,
        active: true,
        testId: 'scope-tab-project',
      },
    ];
  }, [scope, currentProject, activeTab, isSearching, projectSettingsProjectName, openProjectSettings, setSettingsScope]);

  // Footer (project scope only, when overrides exist)
  const hasAnyOverrides = projectOverrides != null && Object.keys(projectOverrides).length > 0;
  const footer = scope === 'project' && hasAnyOverrides ? (
    <ResetOverridesFooter onReset={resetAllProjectOverrides} />
  ) : undefined;

  const contentProps: SettingsContentProps = {
    activeTab,
    isSearching,
    searchQuery,
    matchingTabs,
    navigateToTab,
    shells,
  };

  return (
    <SettingsPanelShell
      scopeTabs={scopeTabs}
      onClose={handleClose}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      footer={footer}
      searchQuery={searchQuery}
      onSearchChange={handleSearchChange}
      tabMatchCounts={searchResults.tabMatchCounts}
      isSearching={isSearching}
    >
      <SettingsSearchProvider query={searchQuery} matchingIds={searchResults.matchingIds}>
        {scope === 'global' ? (
          <AppSettingsContent {...contentProps} />
        ) : (
          <ProjectSettingsContent {...contentProps} />
        )}
      </SettingsSearchProvider>
    </SettingsPanelShell>
  );
}
