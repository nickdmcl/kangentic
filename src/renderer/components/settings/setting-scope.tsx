import { createContext, useCallback, useContext } from 'react';
import type { AppConfig, DeepPartial } from '../../../shared/types';

/**
 * Determines how a setting behaves across app and project panels:
 *
 * - `'project'` -- Project-overridable. In AppSettingsPanel, changing this
 *   triggers the "Apply to all projects?" sync modal. Visible in both
 *   AppSettingsPanel and ProjectSettingsPanel.
 *
 * - `'global'` -- App-wide only. Changes apply immediately without a sync
 *   modal. Hidden in ProjectSettingsPanel (auto-filtered).
 */
export type SettingScope = 'global' | 'project';

interface SettingsPanelContextValue {
  panelType: 'app' | 'project';
  /** Dispatch a config update. Scope determines the handler:
   *  - In AppSettingsPanel: 'project' triggers sync modal, 'global' applies directly.
   *  - In ProjectSettingsPanel: scope is ignored, always writes to project overrides. */
  updateSetting: (partial: DeepPartial<AppConfig>, scope: SettingScope) => void;
}

const SettingsPanelContext = createContext<SettingsPanelContextValue>({
  panelType: 'app',
  updateSetting: () => {},
});

export const SettingsPanelProvider = SettingsPanelContext.Provider;

/** Returns a scoped update handler. Call with a config partial to dispatch
 *  to the correct handler (sync modal vs direct update) automatically. */
export function useScopedUpdate(scope: SettingScope) {
  const { updateSetting } = useContext(SettingsPanelContext);
  return useCallback(
    (partial: DeepPartial<AppConfig>) => updateSetting(partial, scope),
    [updateSetting, scope],
  );
}

/** Returns the current panel type ('app' or 'project'). */
export function useSettingsPanelType() {
  return useContext(SettingsPanelContext).panelType;
}

/** Returns the raw context value. Used by shared UI components (SettingRow,
 *  CompactToggleList) that need panelType for visibility filtering. */
export function useSettingsPanelContext() {
  return useContext(SettingsPanelContext);
}
