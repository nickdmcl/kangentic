import { describe, it, expect } from 'vitest';
import { ClaudeStatusParser } from '../../src/main/agent/claude-status-parser';

describe('ClaudeStatusParser', () => {
  // -------------------------------------------------------------------------
  // computeContextPercentage
  // -------------------------------------------------------------------------
  describe('computeContextPercentage', () => {
    it('includes all four token fields in the result', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: {
          input_tokens: 5000,
          output_tokens: 3000,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 1000,
        },
        context_window_size: 100_000,
        used_percentage: 50, // should be ignored when current_usage is available
      });
      // (5000 + 3000 + 1000 + 1000) / 100000 * 100 = 10
      expect(pct).toBe(10);
    });

    it('caps at 100 when tokens exceed window size', () => {
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
      expect(pct).toBe(42);
    });

    it('falls back to used_percentage when current_usage is null', () => {
      const pct = ClaudeStatusParser.computeContextPercentage({
        current_usage: null,
        used_percentage: 37,
        context_window_size: 200_000,
      });
      expect(pct).toBe(37);
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
      expect(pct).toBe(60);
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
      // (10000 + 0 + 0 + 0) / 100000 * 100 = 10
      expect(pct).toBe(10);
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
      // (60000 + 15000) / 80000 * 100 = 93.75
      expect(pct).toBeCloseTo(93.75);
      expect(pct).toBeGreaterThan(75);
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
      // (20000 + 5000 + 1000 + 4000) / 200000 * 100 = 15
      expect(usage!.contextWindow.usedPercentage).toBe(15);
      expect(usage!.contextWindow.usedTokens).toBe(30_000); // 20000+5000+1000+4000
      expect(usage!.contextWindow.cacheTokens).toBe(5_000);  // 1000+4000
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
      expect(usage!.contextWindow.usedPercentage).toBe(14);
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
  });

  // -------------------------------------------------------------------------
  // parseActivity
  // -------------------------------------------------------------------------
  describe('parseActivity', () => {
    it('parses thinking state', () => {
      expect(ClaudeStatusParser.parseActivity('{"state":"thinking"}')).toBe('thinking');
    });

    it('parses idle state', () => {
      expect(ClaudeStatusParser.parseActivity('{"state":"idle"}')).toBe('idle');
    });

    it('returns null for invalid state value', () => {
      expect(ClaudeStatusParser.parseActivity('{"state":"unknown"}')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(ClaudeStatusParser.parseActivity('bad json')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // parseEvent
  // -------------------------------------------------------------------------
  describe('parseEvent', () => {
    it('parses a valid event JSON line', () => {
      const line = JSON.stringify({
        ts: 1700000000,
        type: 'tool_start',
        tool: 'Read',
        detail: '/src/main.ts',
      });
      const event = ClaudeStatusParser.parseEvent(line);
      expect(event).not.toBeNull();
      expect(event!.ts).toBe(1700000000);
      expect(event!.type).toBe('tool_start');
      expect(event!.tool).toBe('Read');
      expect(event!.detail).toBe('/src/main.ts');
    });

    it('returns null for malformed line', () => {
      expect(ClaudeStatusParser.parseEvent('not valid json {')).toBeNull();
    });
  });
});
