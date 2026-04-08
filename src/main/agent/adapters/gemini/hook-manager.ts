import path from 'node:path';
import { EventType } from '../../../../shared/types';
import { isKangenticHookCommand, buildBridgeCommand, safelyUpdateSettingsFile } from '../../shared/hook-utils';

/** Hook entry in Gemini CLI's settings.json. */
export interface GeminiHookEntry {
  matcher: string;
  hooks: Array<{ name: string; type: string; command: string }>;
}

/**
 * Gemini CLI hook event names (settings.json keys).
 * Not all events are mapped to our event-bridge; BeforeModel, AfterModel,
 * and BeforeToolSelection are available but currently unused.
 */
export const GeminiHookEvent = {
  SessionStart: 'SessionStart',
  SessionEnd: 'SessionEnd',
  BeforeAgent: 'BeforeAgent',
  AfterAgent: 'AfterAgent',
  BeforeModel: 'BeforeModel',
  AfterModel: 'AfterModel',
  BeforeToolSelection: 'BeforeToolSelection',
  BeforeTool: 'BeforeTool',
  AfterTool: 'AfterTool',
  PreCompress: 'PreCompress',
  Notification: 'Notification',
} as const;
export type GeminiHookEvent = (typeof GeminiHookEvent)[keyof typeof GeminiHookEvent];

/** Filter out Kangentic-injected entries from a Gemini hook event array. */
function filterOurHooks(entries: GeminiHookEntry[] | undefined): GeminiHookEntry[] {
  return (entries || []).filter(
    (entry) => !entry?.hooks?.some?.((hook) => isKangenticHookCommand(hook.command)),
  );
}

/** Build a single Gemini hook entry for the event bridge. */
function bridgeEntry(eventBridge: string, eventsPath: string, eventType: string, ...directives: string[]): GeminiHookEntry {
  return {
    matcher: '*',
    hooks: [{
      name: `kangentic-${eventType}`,
      type: 'command',
      command: buildBridgeCommand(eventBridge, eventsPath, eventType, ...directives),
    }],
  };
}

/**
 * Build event-bridge hook entries to merge into Gemini CLI settings.
 * Maps available Gemini hook events to our event-bridge script.
 */
export function buildGeminiEventHooks(
  eventBridge: string,
  eventsPath: string,
  existingHooks: Record<string, GeminiHookEntry[]>,
): Record<string, GeminiHookEntry[]> {
  // Gemini CLI stdin field extraction directives:
  // - tool_name: tool identifier at top level
  // - tool_input: nested object with file_path, content, etc.
  // - message: notification text
  const H = GeminiHookEvent;
  const E = EventType;
  return {
    ...existingHooks,
    [H.BeforeTool]: [
      ...(existingHooks[H.BeforeTool] || []),
      bridgeEntry(eventBridge, eventsPath, E.ToolStart,
        'tool:tool_name', 'nested-detail:tool_input:file_path,command,query'),
    ],
    [H.AfterTool]: [
      ...(existingHooks[H.AfterTool] || []),
      bridgeEntry(eventBridge, eventsPath, E.ToolEnd, 'tool:tool_name'),
    ],
    [H.SessionStart]: [
      ...(existingHooks[H.SessionStart] || []),
      bridgeEntry(eventBridge, eventsPath, E.SessionStart),
    ],
    [H.SessionEnd]: [
      ...(existingHooks[H.SessionEnd] || []),
      bridgeEntry(eventBridge, eventsPath, E.SessionEnd),
    ],
    [H.AfterAgent]: [
      ...(existingHooks[H.AfterAgent] || []),
      bridgeEntry(eventBridge, eventsPath, E.Idle),
    ],
    [H.BeforeAgent]: [
      ...(existingHooks[H.BeforeAgent] || []),
      bridgeEntry(eventBridge, eventsPath, E.Prompt),
    ],
    [H.Notification]: [
      ...(existingHooks[H.Notification] || []),
      bridgeEntry(eventBridge, eventsPath, E.Notification, 'detail:message,notification'),
    ],
    [H.PreCompress]: [
      ...(existingHooks[H.PreCompress] || []),
      bridgeEntry(eventBridge, eventsPath, E.Compact),
    ],
  };
}

/**
 * Return the path to `.gemini/settings.json` for the given directory.
 */
function geminiSettingsPath(directory: string): string {
  return path.join(directory, '.gemini', 'settings.json');
}

/**
 * Strip ALL Kangentic hook entries from `.gemini/settings.json` at the
 * given directory. Preserves all other user hooks and settings.
 *
 * Known race: Gemini has no `--settings <path>` flag (unlike Claude), so we
 * must write to the project-level `.gemini/settings.json` in the cwd.
 * Concurrent Gemini sessions in the same project race on this file, and
 * an abnormal termination may leave orphan Kangentic hook entries behind.
 * This stripper is the cleanup path on normal shutdown + project deletion.
 * See follow-up task to submit an upstream Gemini PR for per-session settings.
 */
export function stripGeminiKangenticHooks(directory: string): void {
  safelyUpdateSettingsFile(geminiSettingsPath(directory), (parsed) => {
    const settings = parsed as { hooks?: Record<string, GeminiHookEntry[]> };
    if (!settings?.hooks || typeof settings.hooks !== 'object') return null;

    let changed = false;
    for (const key of Object.keys(settings.hooks)) {
      if (!Array.isArray(settings.hooks[key])) continue;
      const before = settings.hooks[key].length;
      settings.hooks[key] = filterOurHooks(settings.hooks[key]);
      if (settings.hooks[key].length !== before) changed = true;
      if (settings.hooks[key].length === 0) delete settings.hooks[key];
    }
    if (!changed) return null;

    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    return settings;
  }, 'stripGeminiKangenticHooks');
}
