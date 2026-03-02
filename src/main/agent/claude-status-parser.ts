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
   * Compute context window usage as a percentage, scaled to the compaction
   * threshold (95% raw = 100% displayed).
   *
   * Uses a three-tier approach to handle the gap between what Claude Code
   * reports and what's actually consumed:
   *
   * 1. **Primary** (both `used_percentage` > 0 AND `current_usage` available):
   *    `used_percentage + (output_tokens / window_size * 100)`.
   *    `used_percentage` accurately accounts for all input-side tokens
   *    (including initial cached system prompt tokens that aren't broken out
   *    in `current_usage`), and we add the output token contribution on top.
   *
   * 2. **Fallback** (`current_usage` only, `used_percentage` absent or 0):
   *    Sums all four token buckets (input, output, cache_creation, cache_read)
   *    and divides by window size. May under-report if cached system prompt
   *    tokens are missing from the buckets.
   *
   * 3. **Last resort** (no `current_usage`):
   *    `used_percentage` alone (input-only, excludes output tokens).
   *
   * The result is scaled by the compaction threshold (95%) so the bar
   * reaches 100% when compaction is imminent.
   */
  static computeContextPercentage(contextWindow: StatusContextWindow | null | undefined): number {
    if (!contextWindow) return 0;

    const usage = contextWindow.current_usage;
    const windowSize = contextWindow.context_window_size ?? 0;
    const usedPercentage = contextWindow.used_percentage ?? 0;

    let rawPercentage: number;

    if (usage && windowSize > 0 && usedPercentage > 0) {
      // Primary: used_percentage covers all input tokens (including cached
      // system prompt); add output token contribution on top.
      const output = usage.output_tokens ?? 0;
      rawPercentage = Math.min(100, usedPercentage + (output / windowSize) * 100);
    } else if (usage && windowSize > 0) {
      // Fallback: sum all four token buckets when used_percentage is unavailable
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const cacheCreation = usage.cache_creation_input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const total = input + output + cacheCreation + cacheRead;
      rawPercentage = Math.min(100, (total / windowSize) * 100);
    } else {
      // Last resort: used_percentage alone (input-only, no output tokens)
      rawPercentage = usedPercentage;
    }

    // Scale so compaction threshold (95%) shows as 100%
    return Math.min(100, (rawPercentage / ClaudeStatusParser.COMPACTION_THRESHOLD) * 100);
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

      // Three-tier token computation, matching computeContextPercentage:
      const rawUsedPercentage = (cw?.used_percentage as number) ?? 0;
      let usedTokens: number;
      let cacheTokens: number;
      if (cu && windowSize > 0 && rawUsedPercentage > 0) {
        // Primary: used_percentage covers all input tokens (including cached
        // system prompt not broken out in current_usage). Add output on top.
        const inputFromPct = Math.round((rawUsedPercentage / 100) * windowSize);
        usedTokens = inputFromPct + outputTokens;
        cacheTokens = Math.max(0, inputFromPct - inputTokens);
      } else if (cu) {
        // Fallback: sum all four token buckets
        usedTokens = inputTokens + outputTokens + cacheCreation + cacheRead;
        cacheTokens = cacheCreation + cacheRead;
      } else {
        // Last resort: estimate from used_percentage alone
        usedTokens = Math.round((rawUsedPercentage / 100) * windowSize);
        cacheTokens = usedTokens; // without current_usage, all context is system/cache
      }

      const modelId = (model?.id as string) ?? '';

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
