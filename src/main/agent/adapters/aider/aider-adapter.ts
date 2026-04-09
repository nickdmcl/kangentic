import { AgentDetector } from '../../shared/agent-detector';
import { interpolateTemplate } from '../../shared/template-utils';
import { quoteArg, isUnixLikeShell, toForwardSlash } from '../../../../shared/paths';
import { resolveBridgeScript } from '../../shared/bridge-utils';
import type { AgentAdapter, AgentInfo, SpawnCommandOptions } from '../../agent-adapter';
import type { AgentPermissionEntry, PermissionMode, AdapterRuntimeStrategy } from '../../../../shared/types';
import { ActivityDetection } from '../../../../shared/types';

/**
 * Aider CLI adapter - integrates the Aider AI pair programming tool
 * (https://aider.chat) behind the generic AgentAdapter interface.
 *
 * Aider is simpler than Claude Code: no session resume, no structured
 * status/event output, no trust mechanism, no hooks, and no settings
 * merging. Detection and command building are inlined.
 */
export class AiderAdapter implements AgentAdapter {
  readonly name = 'aider';
  readonly displayName = 'Aider';
  readonly sessionType = 'aider_agent';
  readonly supportsCallerSessionId = false;
  readonly permissions: AgentPermissionEntry[] = [
    { mode: 'plan', label: 'Ask (Read-Only Questions)' },
    { mode: 'default', label: 'Code (Confirm Changes)' },
    { mode: 'acceptEdits', label: 'Architect (Two-Model Design)' },
    { mode: 'bypassPermissions', label: 'Auto Yes (Skip Confirmations)' },
  ];
  readonly defaultPermission: PermissionMode = 'bypassPermissions';

  // Aider uses the shared AgentDetector via composition (keeps the
  // single-file layout while deduplicating detection logic across
  // all four adapters).
  private readonly detector = new AgentDetector({
    binaryName: 'aider',
    parseVersion: (raw) => raw.replace(/^aider\s+/i, '').trim() || null,
  });

  async detect(overridePath?: string | null): Promise<AgentInfo> {
    return this.detector.detect(overridePath);
  }

  invalidateDetectionCache(): void {
    this.detector.invalidateCache();
  }

  // Aider has no trust mechanism - no-op
  async ensureTrust(_workingDirectory: string): Promise<void> {}

  buildCommand(options: SpawnCommandOptions): string {
    const { shell } = options;
    const parts: string[] = [quoteArg(options.agentPath, shell)];

    // --message with shell-safe quoting (only when prompt is provided)
    if (options.prompt) {
      const needsDoubleQuoteReplacement = shell
        ? !isUnixLikeShell(shell)
        : process.platform === 'win32';
      const safePrompt = needsDoubleQuoteReplacement
        ? options.prompt.replace(/"/g, "'")
        : options.prompt;
      parts.push('--message', quoteArg(safePrompt, shell));
    }

    // Chat mode: plan → ask (read-only), acceptEdits → architect (two-model)
    // default and bypassPermissions use the default code mode (no flag needed)
    if (options.permissionMode === 'plan' || options.permissionMode === 'dontAsk') {
      parts.push('--chat-mode', 'ask');
    } else if (options.permissionMode === 'acceptEdits' || options.permissionMode === 'auto') {
      parts.push('--architect');
    }

    // Auto-approve: --yes skips all confirmation prompts
    if (options.permissionMode === 'bypassPermissions') {
      parts.push('--yes');
    }

    // Prevent Aider from auto-committing (Kangentic manages git)
    parts.push('--no-auto-commits');

    // Inject --notifications-command to write idle events via event-bridge.
    // Aider fires this when the LLM finishes generating and is waiting for input.
    if (options.eventsOutputPath) {
      const eventBridge = toForwardSlash(resolveBridgeScript('event-bridge'));
      const eventsPath = toForwardSlash(options.eventsOutputPath);
      parts.push('--notifications');
      parts.push('--notifications-command',
        quoteArg(`node "${eventBridge}" "${eventsPath}" idle`, shell));
    }

    return parts.join(' ');
  }

  interpolateTemplate(template: string, variables: Record<string, string>): string {
    return interpolateTemplate(template, variables);
  }

  /**
   * Runtime strategy: Aider has no hooks and no session resume.
   *
   * - Activity: PTY-only. Idle is detected via prompt regex matching
   *   "> ", "aider> ", or "architect> " at end of output.
   * - Session ID: omitted - Aider has no resume mechanism.
   */
  readonly runtime: AdapterRuntimeStrategy = {
    activity: ActivityDetection.pty((data: string) => {
      const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      return /(?:^|\n)\s*(?:aider|architect)?>\s*$/.test(clean);
    }),
  };

  // Aider does not use hooks - no-op
  stripHooks(_directory: string): void {}

  // Aider has no merged settings - no-op
  clearSettingsCache(): void {}

  getExitSequence(): string[] {
    // Aider has no session resume mechanism. Ctrl+C exits cleanly.
    return ['\x03'];
  }

  detectFirstOutput(data: string): boolean {
    // Aider writes output immediately (no alternate screen buffer).
    // Any non-empty data means the agent is ready.
    return data.length > 0;
  }

  transformHandoffPrompt(prompt: string, contextFilePath: string): string {
    // Aider supports --read for reference files. Include the path inline
    // since Aider can't be given extra flags mid-session.
    return prompt + `\n\nPrior work context is at: ${contextFilePath}`;
  }
}
