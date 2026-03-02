import { describe, it, expect } from 'vitest';
import { ClaudeStatusParser } from '../../src/main/agent/claude-status-parser';
import { EventType } from '../../src/shared/types';

describe('ClaudeStatusParser', () => {
  // -------------------------------------------------------------------------
  // computeContextPercentage
  // -------------------------------------------------------------------------
  describe('computeContextPercentage', () => {
    it('uses hybrid approach when both used_percentage and current_usage are available', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: {
          input_tokens: 5000,
          output_tokens: 3000,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 1000,
        },
        context_window_size: 100_000,
        used_percentage: 50, // primary signal: covers all input including cached system prompt
      });
      // Hybrid: used_percentage + output/window*100 = 50 + 3000/100000*100 = 53
      // Scaled: 53 / 95 * 100 ≈ 55.79
      expect(pct).toBeCloseTo(55.79, 1);
    });

    it('caps at 100 when tokens exceed 95% of window', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: {
          input_tokens: 80_000,
          output_tokens: 30_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        context_window_size: 100_000,
      });
      expect(pct).toBe(100);
    });

    it('falls back to used_percentage when current_usage is missing', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        used_percentage: 42,
        context_window_size: 200_000,
      });
      // 42 / 95 * 100 ≈ 44.21
      expect(pct).toBeCloseTo(44.21, 1);
    });

    it('falls back to used_percentage when current_usage is null', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: null,
        used_percentage: 37,
        context_window_size: 200_000,
      });
      // 37 / 95 * 100 ≈ 38.95
      expect(pct).toBeCloseTo(38.95, 1);
    });

    it('falls back to used_percentage when context_window_size is 0', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: {
          input_tokens: 5000,
          output_tokens: 3000,
        },
        used_percentage: 60,
        context_window_size: 0,
      });
      // 60 / 95 * 100 ≈ 63.16
      expect(pct).toBeCloseTo(63.16, 1);
    });

    it('returns 0 for null context_window', () => {
      expect(ClaudeStatusParser.computeContextPercentage(null)).toBe(0);
    });

    it('returns 0 for undefined context_window', () => {
      expect(ClaudeStatusParser.computeContextPercentage(undefined)).toBe(0);
    });

    it('defaults missing token fields to 0', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: {
          input_tokens: 10_000,
          // output_tokens, cache_creation, cache_read all missing
        },
        context_window_size: 100_000,
      });
      // Raw: 10000/100000*100 = 10, scaled: 10/95*100 ≈ 10.53
      expect(pct).toBeCloseTo(10.53, 1);
    });

    it('computes higher than used_percentage when output tokens are significant', () => {
      // Simulates real scenario: Claude Code reports 75% (input-only)
      // but with output tokens the real usage is higher
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: {
          input_tokens: 60_000,
          output_tokens: 15_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        used_percentage: 75, // Claude Code's input-only number
        context_window_size: 80_000,
      });
      // Hybrid: 75 + 15000/80000*100 = 75 + 18.75 = 93.75
      // Scaled: 93.75 / 95 * 100 ≈ 98.68
      expect(pct).toBeCloseTo(98.68, 1);
    });

    it('hybrid path produces higher result than pure token sum when cache gap exists', () => {
      // Simulates scenario where used_percentage=40 (includes cached system prompt)
      // but token fields only sum to 20% (system prompt tokens missing from buckets)
      const contextWindow = {
        current_usage: {
          input_tokens: 15_000,
          output_tokens: 5_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        used_percentage: 40, // 40% input-side (includes ~20% cached system prompt)
        context_window_size: 100_000,
      };
      const pct = ClaudeStatusParser.computeContextPercentage(contextWindow);
      // Hybrid: 40 + 5000/100000*100 = 45
      // Scaled: 45 / 95 * 100 ≈ 47.37
      expect(pct).toBeCloseTo(47.37, 1);
      // Pure token sum would give: (15000+5000)/100000*100 = 20, scaled ≈ 21.05
      // Hybrid is significantly higher, correctly accounting for cached system prompt
      expect(pct).toBeGreaterThan(30);
    });

    it('near-compaction scenario reaches ~100% with hybrid approach', () => {
      // Real-world: used_percentage=82 (input-side) + significant output tokens
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: {
          input_tokens: 120_000,
          output_tokens: 25_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        used_percentage: 82,
        context_window_size: 200_000,
      });
      // Hybrid: 82 + 25000/200000*100 = 82 + 12.5 = 94.5
      // Scaled: 94.5 / 95 * 100 ≈ 99.47
      expect(pct).toBeCloseTo(99.47, 0);
      expect(pct).toBeGreaterThan(99);
    });

    // --- 95% compaction threshold tests ---

    it('shows 100% at exactly 95% raw usage (compaction imminent)', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        used_percentage: 95,
        context_window_size: 200_000,
      });
      expect(pct).toBe(100);
    });

    it('shows ~15.8% for 15% raw usage (fresh session)', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        used_percentage: 15,
        context_window_size: 200_000,
      });
      // 15 / 95 * 100 ≈ 15.79
      expect(pct).toBeCloseTo(15.79, 1);
    });

    it('caps at 100% when raw usage exceeds 95%', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        used_percentage: 98,
        context_window_size: 200_000,
      });
      expect(pct).toBe(100);
    });

    it('scales current_usage-based calculation by 95% threshold', () => {
      // 95% from token sum → 100%
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: {
          input_tokens: 170_000,
          output_tokens: 20_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        context_window_size: 200_000,
      });
      // Raw: (170000+20000)/200000*100 = 95, scaled: 95/95*100 = 100
      expect(pct).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // parseStatus
  // -------------------------------------------------------------------------
  describe('parseStatus', () => {
    it('parses valid Claude Code JSON into SessionUsage', () => {
      const raw = JSON.stringify({
        context_window: {
          current_usage: {
            input_tokens: 20_000,
            output_tokens: 5_000,
            cache_creation_input_tokens: 1_000,
            cache_read_input_tokens: 4_000,
          },
          used_percentage: 20,
          total_input_tokens: 20_000,
          total_output_tokens: 5_000,
          context_window_size: 200_000,
        },
        cost: {
          total_cost_usd: 0.15,
          total_duration_ms: 12345,
        },
        model: {
          id: 'claude-sonnet-4-20250514',
          display_name: 'Claude Sonnet 4',
        },
      });
      const usage = ClaudeStatusParser.parseStatus(raw);
      expect(usage).not.toBeNull();
      // Hybrid: used_percentage(20) + output(5000)/window(200000)*100 = 22.5
      // Scaled: 22.5 / 95 * 100 ≈ 23.68
      expect(usage!.contextWindow.usedPercentage).toBeCloseTo(23.68, 1);
      // usedTokens: inputFromPct(20%*200k=40000) + output(5000) = 45000
      expect(usage!.contextWindow.usedTokens).toBe(45_000);
      // cacheTokens: inputFromPct(40000) - input_tokens(20000) = 20000
      expect(usage!.contextWindow.cacheTokens).toBe(20_000);
      expect(usage!.contextWindow.totalInputTokens).toBe(20_000);
      expect(usage!.contextWindow.totalOutputTokens).toBe(5_000);
      expect(usage!.contextWindow.contextWindowSize).toBe(200_000);
      expect(usage!.cost.totalCostUsd).toBe(0.15);
      expect(usage!.cost.totalDurationMs).toBe(12345);
      expect(usage!.model.id).toBe('claude-sonnet-4-20250514');
      expect(usage!.model.displayName).toBe('Claude Sonnet 4');
    });

    it('returns null for invalid JSON', () => {
      expect(ClaudeStatusParser.parseStatus('not json')).toBeNull();
    });

    it('estimates usedTokens from used_percentage when current_usage is absent', () => {
      // Early status updates often have used_percentage but no current_usage
      const raw = JSON.stringify({
        context_window: {
          used_percentage: 14,
          total_input_tokens: 3,
          total_output_tokens: 0,
          context_window_size: 200_000,
        },
        cost: { total_cost_usd: 0, total_duration_ms: 0 },
        model: { id: 'claude-opus-4-6', display_name: 'Opus 4.6' },
      });
      const usage = ClaudeStatusParser.parseStatus(raw);
      expect(usage).not.toBeNull();
      // 14% of 200k = 28000
      expect(usage!.contextWindow.usedTokens).toBe(28_000);
      // Without current_usage, all context is assumed to be cache
      expect(usage!.contextWindow.cacheTokens).toBe(28_000);
      // Scaled: 14 / 95 * 100 ≈ 14.74
      expect(usage!.contextWindow.usedPercentage).toBeCloseTo(14.74, 1);
    });

    it('returns SessionUsage with zero defaults when context_window is missing', () => {
      const raw = JSON.stringify({ cost: { total_cost_usd: 0.01 } });
      const usage = ClaudeStatusParser.parseStatus(raw);
      expect(usage).not.toBeNull();
      expect(usage!.contextWindow.usedPercentage).toBe(0);
      expect(usage!.contextWindow.usedTokens).toBe(0);
      expect(usage!.contextWindow.cacheTokens).toBe(0);
      expect(usage!.contextWindow.totalInputTokens).toBe(0);
      expect(usage!.contextWindow.contextWindowSize).toBe(0);
      expect(usage!.model.id).toBe('');
    });

    it('real-world: 14% raw shows ~15% on bar (not 100%)', () => {
      // This was the original bug — fresh session showed 100%
      const raw = JSON.stringify({
        context_window: {
          used_percentage: 14,
          context_window_size: 200_000,
        },
        cost: { total_cost_usd: 0 },
        model: { id: 'claude-opus-4-6' },
      });
      const usage = ClaudeStatusParser.parseStatus(raw);
      expect(usage).not.toBeNull();
      // 14 / 95 * 100 ≈ 14.74 — should be ~15%, never 100%
      expect(usage!.contextWindow.usedPercentage).toBeLessThan(20);
      expect(usage!.contextWindow.usedPercentage).toBeGreaterThan(10);
    });
  });

  // -------------------------------------------------------------------------
  // parseEvent
  // -------------------------------------------------------------------------
  describe('parseEvent', () => {
    it('parses a valid event JSON line', () => {
      const line = JSON.stringify({
        ts: 1700000000,
        type: EventType.ToolStart,
        tool: 'Read',
        detail: '/src/main.ts',
      });
      const event = ClaudeStatusParser.parseEvent(line);
      expect(event).not.toBeNull();
      expect(event!.ts).toBe(1700000000);
      expect(event!.type).toBe(EventType.ToolStart);
      expect(event!.tool).toBe('Read');
      expect(event!.detail).toBe('/src/main.ts');
    });

    it('returns null for malformed line', () => {
      expect(ClaudeStatusParser.parseEvent('not valid json {')).toBeNull();
    });
  });
});
