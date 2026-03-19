import fs from 'node:fs';
import path from 'node:path';
import { toForwardSlash, quoteArg, isUnixLikeShell } from '../../shared/paths';
import { buildEventHooks } from './hook-manager';
import type { ClaudeHookEntry } from './hook-manager';
import type { PermissionMode } from '../../shared/types';

/** Subset of Claude Code settings.json that we read/write. */
interface ClaudeSettings {
  statusLine?: { type: string; command: string };
  hooks?: Record<string, ClaudeHookEntry[]>;
  [key: string]: unknown; // preserve unknown keys from user's settings
}

// ---------------------------------------------------------------------------
// .mcp.json helpers (inject on spawn, clean up on exit)
// ---------------------------------------------------------------------------

interface McpServerConfig {
  command: string;
  args: string[];
}

/**
 * Atomically write JSON to a file via temp file + rename.
 * fs.renameSync is atomic on same-volume (always true here).
 */
function safeWriteMcpJson(mcpJsonPath: string, content: object): void {
  const tmpPath = mcpJsonPath + '.kangentic-tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(content, null, 2));
  fs.renameSync(tmpPath, mcpJsonPath);
}

/**
 * Read .mcp.json, returning null if the file contains invalid JSON.
 * Returns undefined if the file doesn't exist or is empty.
 */
function readMcpJson(mcpJsonPath: string): Record<string, unknown> | null | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(mcpJsonPath, 'utf-8');
  } catch {
    return undefined; // File doesn't exist
  }
  if (!raw.trim()) return undefined; // Empty file
  try {
    return JSON.parse(raw);
  } catch {
    return null; // Malformed JSON -- caller must not overwrite
  }
}

/**
 * Inject the kangentic MCP server into .mcp.json in the given CWD.
 * Preserves all existing servers and top-level keys. Uses atomic writes.
 * Skips injection if .mcp.json contains invalid JSON (logs warning).
 */
export function injectKangenticMcpServer(cwd: string, serverConfig: McpServerConfig): void {
  const mcpJsonPath = path.join(cwd, '.mcp.json');
  const existing = readMcpJson(mcpJsonPath);

  if (existing === null) {
    console.warn('[mcp] Skipping .mcp.json injection: file contains invalid JSON');
    return;
  }

  const data = existing ?? {};
  const servers = (data.mcpServers ?? {}) as Record<string, unknown>;

  const merged = {
    ...data,
    mcpServers: {
      ...servers,
      kangentic: serverConfig,
    },
  };

  safeWriteMcpJson(mcpJsonPath, merged);
}

/**
 * Remove the kangentic entry from .mcp.json in the given CWD.
 * Preserves all other servers and top-level keys. Uses atomic writes.
 * If removing kangentic leaves the file effectively empty, deletes it.
 * Never throws -- all errors are logged as warnings.
 */
export function cleanupMcpJson(cwd: string): void {
  try {
    const mcpJsonPath = path.join(cwd, '.mcp.json');
    const existing = readMcpJson(mcpJsonPath);

    if (existing === undefined) return; // File doesn't exist -- no-op
    if (existing === null) {
      console.warn('[mcp] Skipping .mcp.json cleanup: file contains invalid JSON');
      return;
    }

    const servers = existing.mcpServers as Record<string, unknown> | undefined;
    if (!servers || !('kangentic' in servers)) return; // Nothing to clean up

    // Remove kangentic entry
    const { kangentic: _kangenticEntry, ...remainingServers } = servers;

    // Check if there's anything left worth keeping
    const hasOtherServers = Object.keys(remainingServers).length > 0;
    const { mcpServers: _mcpServersKey, ...otherTopLevelKeys } = existing;
    const hasOtherKeys = Object.keys(otherTopLevelKeys).length > 0;

    if (!hasOtherServers && !hasOtherKeys) {
      // File was effectively just our injection -- delete it
      try { fs.unlinkSync(mcpJsonPath); } catch { /* already gone */ }
      // Clean up temp file if it exists
      try { fs.unlinkSync(mcpJsonPath + '.kangentic-tmp'); } catch { /* not there */ }
      return;
    }

    // Write back without kangentic
    const cleaned: Record<string, unknown> = { ...otherTopLevelKeys };
    if (hasOtherServers) {
      cleaned.mcpServers = remainingServers;
    }
    safeWriteMcpJson(mcpJsonPath, cleaned);
  } catch (error) {
    console.warn('[mcp] Failed to clean up .mcp.json:', error);
  }
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
  shell?: string; // target shell name -- controls quoting style (single vs double quotes)
  mcpServerEnabled?: boolean; // whether to inject kangentic MCP server into settings
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
 * 2. Dev build (.vite/build/ → project root)
 * 3. Fallback from CWD
 */
function resolveBridgeScript(name: string): string {
  const candidates = [
    path.join(__dirname, `${name}.js`),
    path.resolve(__dirname, '..', '..', 'src', 'main', 'agent', `${name}.js`),
    path.resolve(process.cwd(), 'src', 'main', 'agent', `${name}.js`),
  ];
  const resolved = candidates.find(p => fs.existsSync(p)) || candidates[0];
  // Bridge scripts run in an external node process (Claude Code hooks), which
  // cannot read files inside an asar archive. In production builds the scripts
  // are unpacked via asarUnpack, so rewrite the path to the unpacked location.
  if (resolved.includes('app.asar')) {
    return resolved.replace('app.asar', 'app.asar.unpacked');
  }
  return resolved;
}

export class CommandBuilder {
  /** Cache of merged base settings (project + local) keyed by project root path. */
  private projectSettingsCache = new Map<string, ClaudeSettings>();

  /** Clear the cached project settings (e.g., when settings files change). */
  clearSettingsCache(): void {
    this.projectSettingsCache.clear();
  }

  buildClaudeCommand(options: CommandOptions): string {
    const { shell } = options;
    const parts = [quoteArg(options.claudePath, shell)];

    // Build the --settings path. When statusOutputPath is provided we always
    // create a merged settings file that includes the statusLine config so
    // Claude Code pipes usage data to our bridge script.
    const mergedSettingsPath = options.statusOutputPath
      ? this.createMergedSettings(options)
      : null;

    // Permission mode flags
    switch (options.permissionMode) {
      case 'bypassPermissions':
        parts.push('--dangerously-skip-permissions');
        break;
      case 'plan':
        parts.push('--permission-mode', 'plan');
        break;
      case 'acceptEdits':
        parts.push('--permission-mode', 'acceptEdits');
        break;
      case 'dontAsk':
        parts.push('--permission-mode', 'dontAsk');
        break;
      case 'default':
        break;
    }

    // --settings flag: all sessions (main repo and worktree) use a merged
    // settings file in the session directory
    if (mergedSettingsPath) {
      parts.push('--settings', quoteArg(toForwardSlash(mergedSettingsPath), shell));
    }

    // Session: --resume for existing conversations, --session-id for new ones
    if (options.sessionId) {
      const flag = options.resume ? '--resume' : '--session-id';
      parts.push(flag, quoteArg(options.sessionId, shell));
    }

    // Non-interactive mode (print and exit) vs interactive
    if (options.nonInteractive) {
      parts.push('--print');
    }

    // The prompt as positional argument (omitted for resumed sessions)
    if (options.prompt) {
      // For double-quoted shells (PowerShell, cmd), replace double quotes
      // with single quotes to prevent quoting breakage: quoteArg wraps in
      // "..." and escapes " as \" which PowerShell misinterprets.
      // For single-quoted shells (bash, zsh, WSL), double quotes inside
      // single-quoted strings are preserved literally -- no replacement needed.
      const needsDoubleQuoteReplacement = shell
        ? !isUnixLikeShell(shell)
        : process.platform === 'win32';
      const safePrompt = needsDoubleQuoteReplacement
        ? options.prompt.replace(/"/g, "'")
        : options.prompt;
      // -- (end-of-options) prevents content like -> or --flag from being
      // parsed as CLI options regardless of shell quoting behavior.
      parts.push('--', quoteArg(safePrompt, shell));
    }

    return parts.join(' ');
  }

  interpolateTemplate(template: string, vars: Record<string, string>): string {
    return interpolateTemplate(template, vars);
  }

  /** Read and merge project + local settings, with per-projectRoot caching. */
  private readBaseSettings(projectRoot: string): ClaudeSettings {
    const cached = this.projectSettingsCache.get(projectRoot);
    if (cached) return structuredClone(cached);

    // 1. Read project settings (committed, shared)
    let baseSettings: ClaudeSettings = {};
    const projectSettingsPath = path.join(projectRoot, '.claude', 'settings.json');
    try {
      const raw = fs.readFileSync(projectSettingsPath, 'utf-8');
      baseSettings = JSON.parse(raw);
    } catch {
      // No existing settings -- start fresh
    }

    // 2. Deep-merge local settings from project root (gitignored, personal)
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

    this.projectSettingsCache.set(projectRoot, baseSettings);
    return structuredClone(baseSettings);
  }

  /**
   * Create a merged Claude settings file that includes the statusLine config
   * and event-bridge hooks. Deep-merges project + local settings (cached),
   * injects our hooks, and writes to the session directory.
   *
   * All sessions (main repo and worktree) use `--settings` pointing to
   * `.kangentic/sessions/<sessionId>/settings.json`. For worktrees, we also
   * read the worktree's `.claude/settings.local.json` to capture "always
   * allow" permission grants written by Claude during the session.
   */
  private createMergedSettings(options: CommandOptions): string {
    const isWorktree = options.projectRoot != null && options.cwd !== options.projectRoot;
    const projectRoot = options.projectRoot || options.cwd;

    let baseSettings = this.readBaseSettings(projectRoot);

    // 3. For worktrees: merge permissions from the worktree's settings.local.json.
    //    Claude writes "always allow" grants here during sessions. Without reading
    //    this on resume, grants would be lost since --settings (CLI precedence)
    //    overrides the local layer. We only merge permissions, not hooks (which
    //    are either empty or stale leftovers from before this unified approach).
    if (isWorktree) {
      const wtLocalPath = path.join(options.cwd, '.claude', 'settings.local.json');
      try {
        const raw = fs.readFileSync(wtLocalPath, 'utf-8');
        const wtLocal: ClaudeSettings = JSON.parse(raw);
        const wtPerms = wtLocal.permissions as { allow?: string[]; deny?: string[] } | undefined;
        if (wtPerms) {
          const mergedPerms = mergePermissions(
            baseSettings.permissions as { allow?: string[]; deny?: string[] } | undefined,
            wtPerms,
          );
          if (mergedPerms) {
            baseSettings = { ...baseSettings, permissions: mergedPerms };
          }
        }
      } catch {
        // No worktree local settings (first run or no grants yet)
      }
    }

    // Resolve bridge scripts. In production, bridge scripts are copied next
    // to the main bundle by scripts/build.js. In dev (esbuild watch),
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

    // Session directory (used for MCP server paths and merged settings file)
    const sessionDir = path.join(projectRoot, '.kangentic', 'sessions', options.sessionId || options.taskId);

    // Inject kangentic MCP server into .mcp.json in the CWD so Claude Code
    // auto-discovers it. Claude Code reads MCP servers from .mcp.json, not
    // from the --settings file. We merge with any existing .mcp.json to
    // preserve user-configured servers (e.g. context7).
    if (options.mcpServerEnabled !== false) {
      const mcpServerScript = toForwardSlash(resolveBridgeScript('mcp-server'));
      const commandsPath = toForwardSlash(path.join(sessionDir, 'commands.jsonl'));
      const responsesDir = toForwardSlash(path.join(sessionDir, 'responses'));

      injectKangenticMcpServer(options.cwd, {
        command: 'node',
        args: [mcpServerScript, commandsPath, responsesDir],
      });
    } else {
      // When MCP is disabled, clean up any stale kangentic entry from a prior session
      cleanupMcpJson(options.cwd);
    }

    // Write to .kangentic/sessions/<sessionId>/settings.json (used with --settings flag)
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
    } catch (err) {
      console.error(`[spawn_agent] Failed to create session directory: ${sessionDir}`, err);
      throw new Error(`Cannot create session directory at ${sessionDir}: ${(err as Error).message}`);
    }
    const mergedPath = path.join(sessionDir, 'settings.json');
    fs.writeFileSync(mergedPath, JSON.stringify(merged, null, 2));

    return mergedPath;
  }
}
