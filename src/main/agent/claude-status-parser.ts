import type { SessionUsage, ActivityState, SessionEvent } from '../../shared/types';

/**
 * Parses Claude Code status line, activity, and event bridge data.
 *
 * Encapsulates all Claude-specific data parsing so it can be swapped
 * for other agent solutions without touching session-manager.ts.
 */
export class ClaudeStatusParser {
  /**
   * Compute context window usage including output tokens.
   *
   * Claude Code's `used_percentage` only counts input tokens — it excludes
   * `output_tokens` from the latest response. After each response, output
   * tokens become part of the next call's input, so the gap grows over a
   * session (can be 10-20%).
   *
   * This method sums all token buckets (input, output, cache_creation,
   * cache_read) and divides by the context window size for a more accurate
   * representation of context fullness. Falls back to `used_percentage`
   * when `current_usage` is unavailable.
   */
  static computeContextPercentage(contextWindow: {
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
    used_percentage?: number;
    context_window_size?: number;
  } | null | undefined): number {
    if (!contextWindow) return 0;

    const usage = contextWindow.current_usage;
    const windowSize = contextWindow.context_window_size ?? 0;

    // If we have current_usage and a valid window size, compute accurately
    if (usage && windowSize > 0) {
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const cacheCreation = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const total = input + output + cacheCreation + cacheRead;
      return Math.min(100, (total / windowSize) * 100);
    }

    // Fall back to Claude Code's used_percentage (input-only)
    return contextWindow.used_percentage ?? 0;
  }

  /**
   * Parse raw status JSON from Claude Code's status line bridge into SessionUsage.
   * Returns null on parse errors or missing data.
   */
  static parseStatus(raw: string): SessionUsage | null {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const cw = data.context_window as Record<string, unknown> | undefined;
      const cost = data.cost as Record<string, unknown> | undefined;
      const model = data.model as Record<string, unknown> | undefined;

      // Extract current_usage for cache/used token computation
      const cu = cw?.current_usage as Record<string, unknown> | undefined | null;
      const cacheCreation = (cu?.cache_creation_input_tokens as number) ?? 0;
      const cacheRead = (cu?.cache_read_input_tokens as number) ?? 0;
      const inputTokens = (cu?.input_tokens as number) ?? 0;
      const outputTokens = (cu?.output_tokens as number) ?? 0;
      const windowSize = (cw?.context_window_size as number) ?? 0;

      // When current_usage is available, sum all buckets for precise counts.
      // When missing (early status updates), estimate from used_percentage.
      let usedTokens: number;
      let cacheTokens: number;
      if (cu) {
        usedTokens = inputTokens + outputTokens + cacheCreation + cacheRead;
        cacheTokens = cacheCreation + cacheRead;
      } else {
        const pct = (cw?.used_percentage as number) ?? 0;
        usedTokens = Math.round((pct / 100) * windowSize);
        cacheTokens = usedTokens; // without current_usage, all context is system/cache
      }

      return {
        contextWindow: {
          usedPercentage: ClaudeStatusParser.computeContextPercentage(
            cw as Parameters<typeof ClaudeStatusParser.computeContextPercentage>[0],
          ),
          usedTokens,
          cacheTokens,
          totalInputTokens: (cw?.total_input_tokens as number) ?? 0,
          totalOutputTokens: (cw?.total_output_tokens as number) ?? 0,
          contextWindowSize: windowSize,
        },
        cost: {
          totalCostUsd: (cost?.total_cost_usd as number) ?? 0,
          totalDurationMs: (cost?.total_duration_ms as number) ?? 0,
        },
        model: {
          id: (model?.id as string) ?? '',
          displayName: (model?.display_name as string) ?? '',
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse raw activity JSON from Claude Code's activity bridge into ActivityState.
   * Returns null on invalid data or parse errors.
   */
  static parseActivity(raw: string): ActivityState | null {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const state = data.state as string;
      if (state === 'thinking' || state === 'idle') {
        return state;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse a single JSONL line from Claude Code's event bridge into SessionEvent.
   * Returns null on malformed lines.
   */
  static parseEvent(line: string): SessionEvent | null {
    try {
      return JSON.parse(line) as SessionEvent;
    } catch {
      return null;
    }
  }
}
