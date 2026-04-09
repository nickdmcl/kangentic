import type { SessionUsage, SessionEvent } from '../../../../shared/types';

/**
 * Parses Codex CLI status and event data.
 *
 * Codex CLI does NOT expose real-time token usage via a statusline
 * file - telemetry (model, context window, tokens) comes from the
 * native rollout JSONL in `~/.codex/sessions/...` (see
 * `CodexSessionHistoryParser` for that pipeline). This stub conforms
 * to the AgentParser interface so Codex can be wired into pipelines
 * that expect both parsers (e.g. the StatusFileReader path).
 *
 * `parseStatus` always returns null. `parseEvent` parses the generic
 * event-bridge JSONL format for any lines that might arrive via
 * hooks - note that the current Codex Rust CLI does not read
 * `.codex/hooks.json` at runtime, so this is a no-op in practice
 * today, but the interface conformance is preserved for symmetry
 * with Claude and Gemini adapters.
 */
export class CodexStatusParser {
  /**
   * Parse raw status data into SessionUsage.
   * Returns null because Codex CLI has no statusline feature.
   */
  static parseStatus(_raw: string): SessionUsage | null {
    return null;
  }

  /**
   * Parse a single JSONL line from the event bridge into SessionEvent.
   * The event-bridge output format is agent-agnostic.
   */
  static parseEvent(line: string): SessionEvent | null {
    try {
      return JSON.parse(line) as SessionEvent;
    } catch {
      return null;
    }
  }
}
