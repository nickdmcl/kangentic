import fs from 'node:fs';
import path from 'node:path';
import { toForwardSlash } from '../../../../shared/paths';
import { EventType } from '../../../../shared/types';
import { resolveBridgeScript } from '../../shared/bridge-utils';
import { isKangenticHookCommand, buildBridgeCommand, safelyUpdateSettingsFile } from '../../shared/hook-utils';

/** A single entry in Codex's .codex/hooks.json array. */
export interface CodexHookEntry {
  event: string;
  command: string;
  timeout_secs?: number;
}

/**
 * Codex hook events mapped to event-bridge event types with extraction
 * directives. Directives tell event-bridge how to extract fields from
 * Codex's hook stdin JSON format.
 */
export const CODEX_HOOK_EVENTS: Array<{
  event: string;
  bridgeEventType: EventType;
  /** Extraction directives for event-bridge (tool:, detail:, env:, etc). */
  directives?: string[];
}> = [
  {
    event: 'SessionStart',
    bridgeEventType: EventType.SessionStart,
    // Codex injects CODEX_THREAD_ID into child process env (openai/codex#10096).
    directives: ['env:thread_id=CODEX_THREAD_ID'],
  },
  { event: 'UserPromptSubmit', bridgeEventType: EventType.Prompt },
  { event: 'PreToolUse', bridgeEventType: EventType.ToolStart, directives: ['tool:tool_name'] },
  { event: 'PostToolUse', bridgeEventType: EventType.ToolEnd, directives: ['tool:tool_name'] },
  { event: 'Stop', bridgeEventType: EventType.Idle },
];

/** Path to .codex/hooks.json for a given project directory. */
function codexHooksPath(directory: string): string {
  return path.join(directory, '.codex', 'hooks.json');
}

/**
 * Write Kangentic event-bridge hooks into .codex/hooks.json at the project
 * root. Merges with any existing user-defined hooks (our entries are filtered
 * out first to avoid duplicates).
 */
export function writeCodexHooks(projectRoot: string, eventsOutputPath: string): void {
  const hooksFile = codexHooksPath(projectRoot);
  const eventBridge = toForwardSlash(resolveBridgeScript('event-bridge'));
  const eventsPath = toForwardSlash(eventsOutputPath);

  // Read existing hooks and filter out stale Kangentic entries
  let existingHooks: CodexHookEntry[] = [];
  try {
    const raw = fs.readFileSync(hooksFile, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      existingHooks = (parsed as CodexHookEntry[]).filter(
        entry => !isKangenticHookCommand(entry.command),
      );
    }
  } catch {
    // No existing hooks file or invalid JSON - start fresh
  }

  // Build our hook entries
  const kangenticHooks: CodexHookEntry[] = CODEX_HOOK_EVENTS.map(({ event, bridgeEventType, directives }) => ({
    event,
    command: buildBridgeCommand(eventBridge, eventsPath, bridgeEventType, ...(directives || [])),
    timeout_secs: 10,
  }));

  const merged = [...existingHooks, ...kangenticHooks];

  // Ensure .codex/ directory exists
  const codexDir = path.dirname(hooksFile);
  fs.mkdirSync(codexDir, { recursive: true });

  fs.writeFileSync(hooksFile, JSON.stringify(merged, null, 2));
}

/**
 * Strip ALL Kangentic hook entries from .codex/hooks.json at the given
 * directory. Preserves all other user hooks.
 */
export function stripCodexHooks(directory: string): void {
  safelyUpdateSettingsFile(codexHooksPath(directory), (parsed) => {
    if (!Array.isArray(parsed)) return null;
    const hooks = parsed as CodexHookEntry[];
    const filtered = hooks.filter(entry => !isKangenticHookCommand(entry.command));
    return filtered.length === hooks.length ? null : filtered;
  }, 'stripCodexHooks');
}
