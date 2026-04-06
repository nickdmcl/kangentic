import { CodexDetector } from './detector';
import { CodexCommandBuilder } from './command-builder';
import { stripCodexHooks } from './hook-manager';
import type { AgentAdapter, AgentInfo, SpawnCommandOptions } from '../../agent-adapter';
import type { SessionUsage, SessionEvent, AgentPermissionEntry, PermissionMode } from '../../../../shared/types';

/**
 * Codex CLI adapter - wraps CodexDetector, CodexCommandBuilder, and
 * codex-hook-manager behind the generic AgentAdapter interface.
 */
export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';
  readonly displayName = 'Codex CLI';
  readonly sessionType = 'codex_agent';
  readonly supportsCallerSessionId = false;
  readonly permissions: AgentPermissionEntry[] = [
    { mode: 'plan', label: 'Safe Read-Only Browsing' },
    { mode: 'dontAsk', label: 'Read-Only Non-Interactive (CI)' },
    { mode: 'default', label: 'Automatically Edit, Ask for Untrusted' },
    { mode: 'acceptEdits', label: 'Auto (Preset)' },
    { mode: 'bypassPermissions', label: 'Dangerous Full Access' },
  ];
  readonly defaultPermission: PermissionMode = 'acceptEdits';

  private readonly detector = new CodexDetector();
  private readonly commandBuilder = new CodexCommandBuilder();

  async detect(overridePath?: string | null): Promise<AgentInfo> {
    return this.detector.detect(overridePath);
  }

  invalidateDetectionCache(): void {
    this.detector.invalidateCache();
  }

  async ensureTrust(_workingDirectory: string): Promise<void> {
    // Codex does not have a trust dialog - no pre-approval needed.
  }

  buildCommand(options: SpawnCommandOptions): string {
    const { agentPath, ...rest } = options;
    return this.commandBuilder.buildCodexCommand({ codexPath: agentPath, ...rest });
  }

  interpolateTemplate(template: string, variables: Record<string, string>): string {
    return this.commandBuilder.interpolateTemplate(template, variables);
  }

  parseStatus(_raw: string): SessionUsage | null {
    // Codex CLI does not expose real-time token usage or cost data
    // via a statusLine mechanism. Return null until a future version
    // adds equivalent support.
    return null;
  }

  parseEvent(line: string): SessionEvent | null {
    try {
      return JSON.parse(line) as SessionEvent;
    } catch {
      return null;
    }
  }

  stripHooks(directory: string): void {
    stripCodexHooks(directory);
  }

  clearSettingsCache(): void {
    // No settings cache to clear - Codex uses config.toml, not merged
    // settings files.
  }

  getExitSequence(): string[] {
    // Codex sessions are API-backed (server-side threads) - no local
    // conversation state to flush. Ctrl+C is sufficient.
    return ['\x03'];
  }

  detectFirstOutput(data: string): boolean {
    // Codex CLI hides the cursor when its TUI takes over the terminal.
    // Detecting ESC[?25l fires after the shell prompt noise but before
    // the TUI draws the startup banner. This keeps the shell command
    // hidden behind the shimmer overlay.
    return data.includes('\x1b[?25l');
  }

  transformHandoffPrompt(prompt: string, contextFilePath: string): string {
    return prompt + `\n\nPrior work context is at: ${contextFilePath}`;
  }

  extractSessionId(hookContext: string): string | null {
    try {
      const context = JSON.parse(hookContext);
      const threadId = context.thread_id ?? context.threadId;
      return typeof threadId === 'string' ? threadId : null;
    } catch { return null; }
  }

  captureSessionIdFromOutput(data: string): string | null {
    // Codex prints "To continue this session, run: codex resume thr_..."
    // in its terminal output. Extract the thread ID from this line.
    const match = data.match(/codex\s+resume\s+(thr_\S+)/);
    return match ? match[1] : null;
  }
}
