import { AgentDetector } from '../../shared/agent-detector';
import { interpolateTemplate } from '../../shared/template-utils';
import { quoteArg, isUnixLikeShell } from '../../../../shared/paths';
import type { AgentAdapter, AgentInfo, SpawnCommandOptions } from '../../agent-adapter';
import type { AgentPermissionEntry, PermissionMode, AdapterRuntimeStrategy } from '../../../../shared/types';
import { ActivityDetection } from '../../../../shared/types';

/**
 * Cursor CLI adapter - integrates the Cursor terminal agent
 * (https://cursor.com/cli) behind the generic AgentAdapter interface.
 *
 * Cursor CLI is simpler than Claude Code: no session resume via
 * caller-owned IDs, no structured hooks, no trust mechanism, and
 * no settings merging. Permissions are config-file based only
 * (~/.cursor/cli-config.json), with no CLI flags to control them.
 *
 * Two modes:
 *   - Interactive: `agent "prompt"` - user confirms changes in PTY
 *   - Non-interactive: `agent -p "prompt" --output-format stream-json`
 *     - Full write access, emits NDJSON events with session_id on each line
 *     - Enables session ID capture via the init event
 *
 * CLI reference: https://cursor.com/docs/cli/reference
 * Auth: browser-based (`agent login`) or env var (`CURSOR_API_KEY`)
 * Rules: `.cursor/rules/` auto-loaded from CWD (same as editor)
 * Config: `~/.cursor/cli-config.json` (global), `<project>/.cursor/cli.json` (project)
 * Sessions: `agent ls` lists past chats, `agent --resume="<id>"` resumes
 */
export class CursorAdapter implements AgentAdapter {
  readonly name = 'cursor';
  readonly displayName = 'Cursor CLI';
  readonly sessionType = 'cursor_agent';
  readonly supportsCallerSessionId = false;
  readonly permissions: AgentPermissionEntry[] = [
    { mode: 'default', label: 'Interactive (Confirm Changes)' },
    { mode: 'bypassPermissions', label: 'Non-Interactive (Full Access)' },
  ];
  readonly defaultPermission: PermissionMode = 'default';

  // Cursor CLI uses the shared AgentDetector via composition.
  // The binary is called `agent` - a generic name that may collide
  // with other tools, so parseVersion validates the output.
  private readonly detector = new AgentDetector({
    binaryName: 'agent',
    parseVersion: (raw) => {
      // `agent --version` output format is not yet confirmed.
      // Accept common patterns: "1.0.0", "agent 1.0.0", "Cursor Agent 1.0.0"
      const cleaned = raw
        .replace(/^(?:cursor\s+)?agent\s*/i, '')
        .trim();
      // Return null if the output doesn't look like a version
      return /^\d/.test(cleaned) ? cleaned : null;
    },
  });

  async detect(overridePath?: string | null): Promise<AgentInfo> {
    return this.detector.detect(overridePath);
  }

  invalidateDetectionCache(): void {
    this.detector.invalidateCache();
  }

  // Cursor CLI has no trust mechanism - permissions are config-file based
  async ensureTrust(_workingDirectory: string): Promise<void> {}

  buildCommand(options: SpawnCommandOptions): string {
    const { shell } = options;
    const parts: string[] = [quoteArg(options.agentPath, shell)];

    if (options.resume && options.sessionId) {
      // Resume an existing session: agent --resume="<chat-id>"
      // The = sits outside the quote boundary (--resume='id' on unix,
      // --resume="id" on Windows) which is standard --flag=value convention.
      parts.push(`--resume=${quoteArg(options.sessionId, shell)}`);
      return parts.join(' ');
    }

    // Shell-safe prompt: PowerShell/cmd interpret \" differently from bash,
    // so replace double quotes with single quotes before quoteArg wrapping.
    const quotedPrompt = options.prompt
      ? quoteArg(
          (shell ? !isUnixLikeShell(shell) : process.platform === 'win32')
            ? options.prompt.replace(/"/g, "'")
            : options.prompt,
          shell,
        )
      : null;

    if (options.permissionMode === 'bypassPermissions' || options.nonInteractive) {
      // Non-interactive mode: agent -p "prompt" --output-format stream-json
      // Has full write access. Uses stream-json (NDJSON) so the runtime
      // sessionId.fromOutput parser can capture the session_id from the
      // init event: {"type":"system","subtype":"init","session_id":"<uuid>",...}
      if (quotedPrompt) parts.push('-p', quotedPrompt);
      parts.push('--output-format', 'stream-json');
    } else {
      // Interactive mode: agent "prompt"
      // User confirms changes in the PTY.
      if (quotedPrompt) parts.push(quotedPrompt);
    }

    return parts.join(' ');
  }

  interpolateTemplate(template: string, variables: Record<string, string>): string {
    return interpolateTemplate(template, variables);
  }

  /**
   * Runtime strategy: Cursor CLI has no hooks and no caller-owned session IDs.
   *
   * - Activity: PTY silence timer only. Cursor CLI does not expose a
   *   known idle prompt pattern in interactive mode that we can regex-match.
   * - Session ID: captured from PTY output via two strategies:
   *   1. Non-interactive (stream-json): parse the NDJSON init event
   *      {"type":"system","subtype":"init","session_id":"<uuid>"}
   *   2. Interactive: match `--resume="<uuid>"` hint in output (if printed)
   */
  readonly runtime: AdapterRuntimeStrategy = {
    activity: ActivityDetection.pty(),
    sessionId: {
      fromOutput(data: string): string | null {
        // Strategy 1: NDJSON init event from --output-format stream-json
        // Each line is a JSON object; the init event has session_id.
        const initMatch = data.match(/"session_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
        if (initMatch) return initMatch[1];
        return null;
      },
    },
  };

  // Cursor CLI does not use hooks - no-op
  removeHooks(_directory: string): void {}

  // Cursor CLI has no merged settings - no-op
  clearSettingsCache(): void {}

  getExitSequence(): string[] {
    return ['\x03'];
  }

  detectFirstOutput(data: string): boolean {
    // Cursor CLI writes output immediately (no alternate screen buffer).
    // Any non-empty data means the agent is ready.
    return data.length > 0;
  }

  async locateSessionHistoryFile(_agentSessionId: string, _cwd: string): Promise<string | null> {
    // Cursor CLI session history location is not yet known.
    return null;
  }
}
