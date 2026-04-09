import { ClaudeDetector } from './detector';
import { CommandBuilder } from './command-builder';
import { ClaudeStatusParser } from './status-parser';
import { ClaudeSessionHistoryParser } from './session-history-parser';
import { ensureWorktreeTrust, ensureMcpServerTrust } from './trust-manager';
import { stripKangenticHooks } from './hook-manager';
import type { AgentAdapter, AgentInfo, SpawnCommandOptions } from '../../agent-adapter';
import type { AgentPermissionEntry, PermissionMode, AdapterRuntimeStrategy } from '../../../../shared/types';
import { ActivityDetection } from '../../../../shared/types';

/**
 * Claude Code adapter - wraps ClaudeDetector, CommandBuilder,
 * ClaudeStatusParser, trust-manager, and hook-manager behind
 * the generic AgentAdapter interface.
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude';
  readonly displayName = 'Claude Code';
  readonly sessionType = 'claude_agent';
  readonly supportsCallerSessionId = true;
  readonly permissions: AgentPermissionEntry[] = [
    { mode: 'plan', label: 'Plan (Read-Only)' },
    { mode: 'dontAsk', label: "Don't Ask (Deny Unless Allowed)" },
    { mode: 'default', label: 'Default (Allowlist)' },
    { mode: 'acceptEdits', label: 'Accept Edits' },
    { mode: 'auto', label: 'Auto (Classifier)' },
    { mode: 'bypassPermissions', label: 'Bypass (Unsafe)' },
  ];
  readonly defaultPermission: PermissionMode = 'acceptEdits';

  private readonly detector = new ClaudeDetector();
  private readonly commandBuilder = new CommandBuilder();

  async detect(overridePath?: string | null): Promise<AgentInfo> {
    return this.detector.detect(overridePath);
  }

  invalidateDetectionCache(): void {
    this.detector.invalidateCache();
  }

  async ensureTrust(workingDirectory: string): Promise<void> {
    await ensureWorktreeTrust(workingDirectory);
    await ensureMcpServerTrust(workingDirectory);
  }

  buildCommand(options: SpawnCommandOptions): string {
    const { agentPath, ...rest } = options;
    return this.commandBuilder.buildClaudeCommand({ cliPath: agentPath, ...rest });
  }

  interpolateTemplate(template: string, variables: Record<string, string>): string {
    return this.commandBuilder.interpolateTemplate(template, variables);
  }

  // Claude uses caller-owned session IDs via --session-id, so no capture needed.
  // Claude exposes telemetry through two parallel on-disk pipelines, both
  // declared here so this file is the single source of truth for what
  // Claude reads from disk:
  //   - statusFile: hook-driven status.json + events.jsonl, written by
  //     Kangentic's injected event-bridge.js / status-bridge.js into
  //     .kangentic/sessions/<sessionId>/. Watched by StatusFileReader.
  //   - sessionHistory: Claude Code's native session log at
  //     ~/.claude/projects/<slug>/<sessionId>.jsonl. Watched by
  //     SessionHistoryReader.
  // Both feed UsageTracker.setSessionUsage, which merges partial updates safely.
  readonly runtime: AdapterRuntimeStrategy = {
    activity: ActivityDetection.hooks(),
    statusFile: {
      parseStatus: ClaudeStatusParser.parseStatus,
      parseEvent: ClaudeStatusParser.parseEvent,
      isFullRewrite: true,
    },
    sessionHistory: {
      locate: ClaudeSessionHistoryParser.locate,
      parse: ClaudeSessionHistoryParser.parse,
      isFullRewrite: false,
    },
  };

  stripHooks(directory: string): void {
    stripKangenticHooks(directory);
  }

  clearSettingsCache(): void {
    this.commandBuilder.clearSettingsCache();
  }

  getExitSequence(): string[] {
    return ['\x03', '/exit\r'];
  }

  detectFirstOutput(data: string): boolean {
    // Claude Code hides the cursor when its TUI takes over the terminal.
    // Detecting ESC[?25l fires after the shell prompt noise but before
    // the TUI draws the startup banner, keeping the shell command hidden
    // behind the shimmer overlay.
    return data.includes('\x1b[?25l');
  }

  transformHandoffPrompt(prompt: string, _contextFilePath: string): string {
    return prompt + '\n\nYou can also use the `kangentic_get_handoff_context` MCP tool for structured access to the prior work context.';
  }
}
