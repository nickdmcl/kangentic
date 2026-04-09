import { GeminiDetector } from './detector';
import { GeminiCommandBuilder } from './command-builder';
import { GeminiStatusParser } from './status-parser';
import { stripGeminiKangenticHooks } from './hook-manager';
import type { AgentAdapter, AgentInfo, SpawnCommandOptions } from '../../agent-adapter';
import type { SessionUsage, SessionEvent, AgentPermissionEntry, PermissionMode, AdapterRuntimeStrategy } from '../../../../shared/types';
import { ActivityDetection } from '../../../../shared/types';

/**
 * Gemini CLI adapter - wraps GeminiDetector, GeminiCommandBuilder,
 * GeminiStatusParser, and gemini-hook-manager behind the generic
 * AgentAdapter interface.
 */
export class GeminiAdapter implements AgentAdapter {
  readonly name = 'gemini';
  readonly displayName = 'Gemini CLI';
  readonly sessionType = 'gemini_agent';
  readonly supportsCallerSessionId = false;
  readonly permissions: AgentPermissionEntry[] = [
    { mode: 'plan', label: 'Plan (Read-Only Research)' },
    { mode: 'default', label: 'Default (Confirm Actions)' },
    { mode: 'acceptEdits', label: 'Auto Edit (Auto-Approve Edits)' },
    { mode: 'bypassPermissions', label: 'YOLO (Auto-Approve All)' },
  ];
  readonly defaultPermission: PermissionMode = 'acceptEdits';

  private readonly detector = new GeminiDetector();
  private readonly commandBuilder = new GeminiCommandBuilder();

  async detect(overridePath?: string | null): Promise<AgentInfo> {
    return this.detector.detect(overridePath);
  }

  invalidateDetectionCache(): void {
    this.detector.invalidateCache();
  }

  async ensureTrust(_workingDirectory: string): Promise<void> {
    // No-op: Gemini CLI does not have a trust/directory-approval system.
  }

  buildCommand(options: SpawnCommandOptions): string {
    const { agentPath, ...rest } = options;
    return this.commandBuilder.buildGeminiCommand({ geminiPath: agentPath, ...rest });
  }

  interpolateTemplate(template: string, variables: Record<string, string>): string {
    return this.commandBuilder.interpolateTemplate(template, variables);
  }

  parseStatus(raw: string): SessionUsage | null {
    return GeminiStatusParser.parseStatus(raw);
  }

  parseEvent(line: string): SessionEvent | null {
    return GeminiStatusParser.parseEvent(line);
  }

  /**
   * Runtime strategy: how Gemini exposes activity state and session IDs.
   *
   * - Activity: hook-based primary (Gemini's documented base hook schema
   *   includes activity events), with PTY silence-timer fallback if hooks
   *   fail at runtime.
   * - Session ID (fromHook): Gemini's base hook input schema includes
   *   `session_id` (and sometimes camelCase `sessionId`) on every hook stdin.
   * - Session ID (fromOutput): Gemini prints "gemini --resume '<uuid>'" and
   *   "Session ID: <uuid>" in the shutdown summary. Used as a scrollback
   *   fallback by session-manager.suspend() if hooks never fired.
   */
  readonly runtime: AdapterRuntimeStrategy = {
    activity: ActivityDetection.hooksAndPty((data: string) => {
      // Patterns derived from real Gemini 0.37 PTY captures (see
      // tests/unit/agent-pty-detection.test.ts and the .bin fixtures).
      // Gemini's TUI paints box-drawing borders (`╰────╯`) around every
      // interactive surface - the trust dialog, the input prompt, and
      // the auth dialog all close with this border. The presence of a
      // closed box border in a chunk's tail means the TUI has finished
      // painting a frame and is waiting for input.
      const clean = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07\x1b]*[\x07\x1b]/g, '');
      return /\u2570[\u2500]+\u256F/.test(clean) || /I'm ready\./.test(clean);
    }),
    sessionId: {
      fromHook(hookContext) {
        try {
          const context = JSON.parse(hookContext);
          const sessionId = context.session_id ?? context.sessionId;
          if (typeof sessionId === 'string' && sessionId.length > 0) {
            console.log(`[gemini] Captured session ID from hook: ${sessionId.slice(0, 16)}...`);
            return sessionId;
          }
          console.warn(`[gemini] SessionStart hookContext missing session_id. Keys: ${Object.keys(context).join(', ')}`);
          return null;
        } catch {
          console.warn('[gemini] Failed to parse SessionStart hookContext');
          return null;
        }
      },
      fromOutput(data) {
        const resumeMatch = data.match(/gemini\s+--resume\s+'?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'?/);
        if (resumeMatch) return resumeMatch[1];
        const headerMatch = data.match(/Session ID:\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
        return headerMatch ? headerMatch[1] : null;
      },
    },
  };

  stripHooks(directory: string): void {
    stripGeminiKangenticHooks(directory);
  }

  clearSettingsCache(): void {
    this.commandBuilder.clearSettingsCache();
  }

  getExitSequence(): string[] {
    return ['\x03', '/quit\r'];
  }

  detectFirstOutput(data: string): boolean {
    // Gemini CLI hides the cursor when its TUI takes over the terminal.
    // Detecting ESC[?25l fires after the shell prompt noise but before
    // the TUI draws the startup banner. This keeps the shell command
    // hidden behind the shimmer overlay.
    return data.includes('\x1b[?25l');
  }

  transformHandoffPrompt(prompt: string, contextFilePath: string): string {
    return prompt + `\n\nPrior work context is at: ${contextFilePath}`;
  }
}
