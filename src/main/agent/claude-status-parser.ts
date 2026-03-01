import type { SessionUsage, SessionEvent } from '../../shared/types';

/**
 * Parses Claude Code status line and event bridge data.
 *
 * Encapsulates all Claude-specific data parsing so it can be swapped
 * for other agent solutions without touching session-manager.ts.
 */

/** Shape of the `context_window` object from Claude Code's status line JSON. */
export interface StatusContextWindow {
  current_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null;
  used_percentage?: number;
  context_window_size?: number;
}

export class ClaudeStatusParser {
  /**
   * Auto-compaction triggers at approximately 95% of the context window.
   * The progress bar scales raw usage so that 95% raw = 100% displayed.
   */
  private static COMPACTION_THRESHOLD = 95;

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
   *
   * Note: Claude Code's status line reports these four fields as separate
   * non-overlapping buckets (unlike the Anthropic API billing response
   * where `input_tokens` includes cache reads). Verified against real
   * session data — additive summation is correct here.
   *
   * The result is scaled by the compaction threshold (95%) so the bar
   * reaches 100% when compaction is imminent.
   */
  static computeContextPercentage(contextWindow: StatusContextWindow | null | undefined): number {
    if (!contextWindow) return 0;

    const usage = contextWindow.current_usage;
    const windowSize = contextWindow.context_window_size ?? 0;

    let rawPct: number;

    // If we have current_usage and a valid window size, compute accurately
    if (usage && windowSize > 0) {
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const cacheCreation = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const total = input + output + cacheCreation + cacheRead;
      rawPct = Math.min(100, (total / windowSize) * 100);
    } else {
      // Fall back to Claude Code's used_percentage (input-only)
      rawPct = contextWindow.used_percentage ?? 0;
    }

    // Scale so compaction threshold (95%) shows as 100%
    return Math.min(100, (rawPct / ClaudeStatusParser.COMPACTION_THRESHOLD) * 100);
  }

  /**
   * Parse raw status JSON from Claude Code's status line bridge into SessionUsage.
   * Returns null on parse errors or missing data.
   */
  static parseStatus(raw: string): SessionUsage | null {
    const result = ClaudeStatusParser.parseStatusWithMeta(raw);
    return result ? result.usage : null;
  }

  /**
   * Parse raw status JSON and return both the SessionUsage and raw metadata
   * (model ID, raw used_percentage) needed for logging/debugging.
   * Avoids the caller having to re-parse the same JSON.
   */
  static parseStatusWithMeta(raw: string): { usage: SessionUsage; meta: { modelId: string; rawUsedPercentage: number } } | null {
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

      const modelId = (model?.id as string) ?? '';
      const rawUsedPercentage = (cw?.used_percentage as number) ?? 0;

      return {
        usage: {
          contextWindow: {
            usedPercentage: ClaudeStatusParser.computeContextPercentage(
              cw as StatusContextWindow | undefined,
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
            id: modelId,
            displayName: (model?.display_name as string) ?? '',
          },
        },
        meta: { modelId, rawUsedPercentage },
      };
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
