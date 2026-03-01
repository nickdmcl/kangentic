import fs from 'node:fs';
import path from 'node:path';
import { toForwardSlash, quoteArg } from '../../shared/paths';
import { buildEventHooks } from './hook-manager';
import type { ClaudeHookEntry } from './hook-manager';
import type { PermissionMode, Task } from '../../shared/types';

/** Subset of Claude Code settings.json that we read/write. */
interface ClaudeSettings {
  statusLine?: { type: string; command: string };
  hooks?: Record<string, ClaudeHookEntry[]>;
  [key: string]: unknown; // preserve unknown keys from user's settings
}

interface CommandOptions {
  claudePath: string;
  taskId: string;
  prompt?: string;
  cwd: string;
  permissionMode: PermissionMode;
  projectRoot?: string; // main repo root (for worktree settings resolution)
  sessionId?: string;
  resume?: boolean; // true = --resume (existing session), false = --session-id (new session)
  nonInteractive?: boolean;
  statusOutputPath?: string; // path where the status bridge writes JSON
  eventsOutputPath?: string; // path where the event bridge appends JSONL
}

/**
 * Replace `{{key}}` placeholders in a template string with values from `vars`.
 */
export function interpolateTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Merge hook arrays per event type. Local hooks come after project hooks;
 * Kangentic hooks are appended last by the caller.
 */
function mergeHookArrays(
  base: Record<string, ClaudeHookEntry[]> | undefined,
  overlay: Record<string, ClaudeHookEntry[]> | undefined,
): Record<string, ClaudeHookEntry[]> {
  if (!base && !overlay) return {};
  if (!base) return { ...overlay! };
  if (!overlay) return { ...base };

  const merged: Record<string, ClaudeHookEntry[]> = { ...base };
  for (const [event, entries] of Object.entries(overlay)) {
    merged[event] = [...(merged[event] || []), ...entries];
  }
  return merged;
}

/** Deep-merge permissions: deduplicate allow/deny arrays. */
function mergePermissions(
  base: { allow?: string[]; deny?: string[] } | undefined,
  overlay: { allow?: string[]; deny?: string[] } | undefined,
): { allow: string[]; deny: string[] } | undefined {
  if (!base && !overlay) return undefined;
  const allow = [...new Set([...(base?.allow || []), ...(overlay?.allow || [])])];
  const deny = [...new Set([...(base?.deny || []), ...(overlay?.deny || [])])];
  return { allow, deny };
}

/**
 * Resolve a bridge script path using the standard 3-candidate pattern:
 * 1. Production build (next to main bundle)
 * 2. Forge dev (.vite/build/ → project root)
 * 3. Fallback from CWD
 */
function resolveBridgeScript(name: string): string {
  const candidates = [
    path.join(__dirname, `${name}.js`),
    path.resolve(__dirname, '..', '..', 'src', 'main', 'agent', `${name}.js`),
    path.resolve(process.cwd(), 'src', 'main', 'agent', `${name}.js`),
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
}

export class CommandBuilder {
  buildClaudeCommand(options: CommandOptions): string {
    const parts = [quoteArg(options.claudePath)];

    // Build the --settings path. When statusOutputPath is provided we always
    // create a merged settings file that includes the statusLine config so
    // Claude Code pipes usage data to our bridge script.
    const mergedSettingsPath = options.statusOutputPath
      ? this.createMergedSettings(options)
      : null;

    // Permission mode flags
    switch (options.permissionMode) {
      case 'bypass-permissions':
        parts.push('--dangerously-skip-permissions');
        if (mergedSettingsPath) {
          parts.push('--settings', quoteArg(toForwardSlash(mergedSettingsPath)));
        }
        break;
      case 'default':
        if (mergedSettingsPath) {
          parts.push('--settings', quoteArg(toForwardSlash(mergedSettingsPath)));
        }
        // When mergedSettingsPath is null (worktree with hooks written to
        // settings.local.json), no --settings flag needed — Claude resolves
        // settings.json from the worktree's .claude/ directory naturally.
        break;
      case 'plan':
        parts.push('--permission-mode', 'plan');
        if (mergedSettingsPath) {
          parts.push('--settings', quoteArg(toForwardSlash(mergedSettingsPath)));
        }
        break;
      case 'acceptEdits':
        parts.push('--permission-mode', 'acceptEdits');
        if (mergedSettingsPath) {
          parts.push('--settings', quoteArg(toForwardSlash(mergedSettingsPath)));
        }
        break;
      case 'manual':
        if (mergedSettingsPath) {
          parts.push('--settings', quoteArg(toForwardSlash(mergedSettingsPath)));
        }
        break;
    }

    // Session: --resume for existing conversations, --session-id for new ones
    if (options.sessionId) {
      const flag = options.resume ? '--resume' : '--session-id';
      parts.push(flag, quoteArg(options.sessionId));
    }

    // Non-interactive mode (print and exit) vs interactive
    if (options.nonInteractive) {
      parts.push('--print');
    }

    // The prompt as positional argument (omitted for resumed sessions)
    if (options.prompt) {
      // Replace double quotes to prevent PowerShell quoting breakage:
      // quoteArg wraps in "..." on Windows and escapes " as \" which
      // PowerShell misinterprets (it uses "" or `" not \").
      // Single quotes are safe inside double-quoted strings on all shells.
      const safePrompt = options.prompt.replace(/"/g, "'");
      // -- (end-of-options) prevents content like -> or --flag from being
      // parsed as CLI options regardless of shell quoting behavior.
      parts.push('--', quoteArg(safePrompt));
    }

    return parts.join(' ');
  }

  interpolateTemplate(template: string, vars: Record<string, string>): string {
    return interpolateTemplate(template, vars);
  }

  /**
   * Create a merged Claude settings file that includes the statusLine config
   * pointing to our bridge script. Reads the project's existing settings.json
   * (if any) and deep-merges the statusLine key.
   *
   * For worktrees (cwd !== projectRoot): writes hooks to the worktree's
   * `.claude/settings.local.json` so Claude resolves settings naturally.
   * Returns `null` (no `--settings` flag needed).
   *
   * For main repo: writes to session directory and returns the path
   * (used with `--settings` flag).
   */
  private createMergedSettings(options: CommandOptions): string | null {
    const isWorktree = options.projectRoot != null && options.cwd !== options.projectRoot;
    const projectRoot = options.projectRoot || options.cwd;

    // Base settings depend on context:
    // - Worktree: only settings.local.json (Claude reads settings.json from
    //   the worktree's .claude/ directory via sparse-checkout)
    // - Main repo: full merge of settings.json + settings.local.json (the
    //   --settings flag replaces settings.json, so we must include everything)
    let baseSettings: ClaudeSettings = {};

    if (isWorktree) {
      // Only read the user's local settings from the project root
      const localSettingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
      try {
        const raw = fs.readFileSync(localSettingsPath, 'utf-8');
        baseSettings = JSON.parse(raw);
      } catch {
        // No local settings — start fresh
      }
    } else {
      // Read project settings (committed, shared)
      const projectSettingsPath = path.join(projectRoot, '.claude', 'settings.json');
      try {
        const raw = fs.readFileSync(projectSettingsPath, 'utf-8');
        baseSettings = JSON.parse(raw);
      } catch {
        // No existing settings — start fresh
      }

      // Deep-merge local settings (gitignored, personal)
      const localSettingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
      try {
        const raw = fs.readFileSync(localSettingsPath, 'utf-8');
        const localSettings: ClaudeSettings = JSON.parse(raw);
        const { hooks: localHooks, permissions: localPerms, ...localRest } = localSettings;
        const mergedPerms = mergePermissions(
          baseSettings.permissions as { allow?: string[]; deny?: string[] } | undefined,
          localPerms as { allow?: string[]; deny?: string[] } | undefined,
        );
        baseSettings = {
          ...baseSettings,
          ...localRest,
          hooks: mergeHookArrays(baseSettings.hooks, localHooks),
          ...(mergedPerms ? { permissions: mergedPerms } : {}),
        };
      } catch {
        // No local settings
      }
    }

    // Resolve bridge scripts. In production, bridge scripts are copied next
    // to the main bundle by scripts/build.js. In dev (Forge Vite plugin),
    // __dirname is .vite/build/ so we fall back to the source tree.
    const statusBridge = toForwardSlash(resolveBridgeScript('status-bridge'));
    const statusPath = toForwardSlash(options.statusOutputPath!);

    const merged: ClaudeSettings = {
      ...baseSettings,
      statusLine: {
        type: 'command',
        command: `node "${statusBridge}" "${statusPath}"`,
      },
    };

    // Merge event-bridge hooks (preserve existing user hooks)
    const eventsPath = options.eventsOutputPath ? toForwardSlash(options.eventsOutputPath) : null;
    if (eventsPath) {
      const eventBridge = toForwardSlash(resolveBridgeScript('event-bridge'));
      merged.hooks = buildEventHooks(eventBridge, eventsPath, baseSettings.hooks || {});
    }

    // Write to .kangentic/sessions/<sessionId>/settings.json (for session recovery reference)
    const sessionDir = path.join(projectRoot, '.kangentic', 'sessions', options.sessionId || options.taskId);
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
    } catch (err) {
      console.error(`Failed to create session directory: ${sessionDir}`, err);
      throw new Error(`Cannot create session directory at ${sessionDir}: ${(err as Error).message}`);
    }
    const mergedPath = path.join(sessionDir, 'settings.json');
    fs.writeFileSync(mergedPath, JSON.stringify(merged, null, 2));

    if (isWorktree) {
      // Write hooks to the worktree's .claude/settings.local.json so Claude
      // resolves settings naturally (settings.json from git + local overrides).
      const wtClaudeDir = path.join(options.cwd, '.claude');
      fs.mkdirSync(wtClaudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(wtClaudeDir, 'settings.local.json'),
        JSON.stringify(merged, null, 2),
      );
      return null; // no --settings flag needed
    }

    return mergedPath;
  }
}
