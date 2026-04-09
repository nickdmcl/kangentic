import { describe, it, expect } from 'vitest';
import { CodexSessionHistoryParser } from '../../src/main/agent/adapters/codex/session-history-parser';
import { Activity, EventType } from '../../src/shared/types';

/**
 * CodexSessionHistoryParser unit tests. Uses inline JSONL fixtures derived from
 * real Codex v0.118 rollout files (sanitized - no PII, trimmed
 * base_instructions blobs).
 */
describe('CodexSessionHistoryParser', () => {
  describe('parse', () => {
    it('extracts model, context window, and token counts from a full turn', () => {
      const jsonl = [
        JSON.stringify({
          timestamp: '2026-04-09T04:36:51.068Z',
          type: 'session_meta',
          payload: {
            id: '019d7087-5456-7f83-977b-d06b857bed26',
            timestamp: '2026-04-09T04:36:50.394Z',
            cwd: 'C:/Users/dev/project',
            cli_version: '0.118.0',
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-09T04:36:51.070Z',
          type: 'task_started',
          payload: {
            turn_id: 'turn-1',
            model_context_window: 258400,
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-09T04:36:51.071Z',
          type: 'turn_context',
          payload: {
            turn_id: 'turn-1',
            model: 'gpt-5.3-codex',
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-09T04:36:52.379Z',
          type: 'token_count',
          payload: {
            info: {
              // Parser uses last_token_usage (per-turn context snapshot),
              // not total_token_usage (cumulative billed spend).
              total_token_usage: {
                input_tokens: 11214,
                cached_input_tokens: 0,
                output_tokens: 35,
                total_tokens: 11249,
              },
              last_token_usage: {
                input_tokens: 11214,
                cached_input_tokens: 0,
                output_tokens: 35,
                total_tokens: 11249,
              },
              model_context_window: 258400,
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-09T04:36:52.380Z',
          type: 'task_complete',
          payload: { turn_id: 'turn-1' },
        }),
      ].join('\n') + '\n';

      const result = CodexSessionHistoryParser.parse(jsonl, 'append');

      expect(result.usage).not.toBeNull();
      expect(result.usage!.model.id).toBe('gpt-5.3-codex');
      expect(result.usage!.model.displayName).toBe('gpt-5.3-codex');
      expect(result.usage!.contextWindow.contextWindowSize).toBe(258400);
      expect(result.usage!.contextWindow.totalInputTokens).toBe(11214);
      expect(result.usage!.contextWindow.totalOutputTokens).toBe(35);
      expect(result.usage!.contextWindow.usedTokens).toBe(11214);
      expect(result.usage!.contextWindow.usedPercentage).toBeCloseTo(11214 / 258400 * 100, 2);
      // Last activity seen is task_complete, so we should report Idle.
      expect(result.activity).toBe(Activity.Idle);
    });

    it('reports Activity.Thinking when task_started is the last activity event', () => {
      const jsonl = [
        JSON.stringify({
          timestamp: '2026-04-09T04:36:51.070Z',
          type: 'task_started',
          payload: { turn_id: 'turn-1', model_context_window: 258400 },
        }),
        JSON.stringify({
          timestamp: '2026-04-09T04:36:51.071Z',
          type: 'turn_context',
          payload: { turn_id: 'turn-1', model: 'gpt-5.3-codex' },
        }),
      ].join('\n') + '\n';

      const result = CodexSessionHistoryParser.parse(jsonl, 'append');
      expect(result.activity).toBe(Activity.Thinking);
    });

    it('emits ToolStart events for function_call response_items', () => {
      const jsonl = JSON.stringify({
        timestamp: '2026-04-09T04:36:52.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell',
          arguments: JSON.stringify({ command: ['ls'] }),
        },
      }) + '\n';

      const result = CodexSessionHistoryParser.parse(jsonl, 'append');
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe(EventType.ToolStart);
      expect(result.events[0].detail).toBe('shell');
    });

    it('ignores malformed JSON lines without throwing', () => {
      const jsonl = [
        'not valid json',
        JSON.stringify({
          timestamp: '2026-04-09T04:36:51.071Z',
          type: 'turn_context',
          payload: { model: 'gpt-5.3-codex' },
        }),
        '{incomplete',
      ].join('\n') + '\n';

      const result = CodexSessionHistoryParser.parse(jsonl, 'append');
      expect(result.usage).not.toBeNull();
      expect(result.usage!.model.id).toBe('gpt-5.3-codex');
    });

    it('returns null usage when no relevant events seen', () => {
      const jsonl = JSON.stringify({
        timestamp: '2026-04-09T04:36:51.068Z',
        type: 'unrelated_event',
        payload: { foo: 'bar' },
      }) + '\n';

      const result = CodexSessionHistoryParser.parse(jsonl, 'append');
      expect(result.usage).toBeNull();
      expect(result.events).toHaveLength(0);
      expect(result.activity).toBeNull();
    });

    it('handles CRLF line endings (Windows)', () => {
      const jsonl = [
        JSON.stringify({
          timestamp: '2026-04-09T04:36:51.071Z',
          type: 'turn_context',
          payload: { model: 'gpt-5.3-codex' },
        }),
        JSON.stringify({
          timestamp: '2026-04-09T04:36:52.379Z',
          type: 'token_count',
          payload: {
            info: {
              last_token_usage: { input_tokens: 500, output_tokens: 10, total_tokens: 510 },
              model_context_window: 100_000,
            },
          },
        }),
      ].join('\r\n') + '\r\n';

      const result = CodexSessionHistoryParser.parse(jsonl, 'append');
      expect(result.usage).not.toBeNull();
      expect(result.usage!.model.id).toBe('gpt-5.3-codex');
      expect(result.usage!.contextWindow.totalInputTokens).toBe(500);
    });

    it('later turn_context overrides earlier (mid-session /model change)', () => {
      const jsonl = [
        JSON.stringify({
          type: 'turn_context',
          payload: { model: 'gpt-5.3-codex' },
          timestamp: '2026-04-09T04:36:51.071Z',
        }),
        JSON.stringify({
          type: 'turn_context',
          payload: { model: 'gpt-5.4' },
          timestamp: '2026-04-09T04:40:00.000Z',
        }),
      ].join('\n') + '\n';

      const result = CodexSessionHistoryParser.parse(jsonl, 'append');
      expect(result.usage!.model.id).toBe('gpt-5.4');
    });

    it('handles empty content (no-op)', () => {
      const result = CodexSessionHistoryParser.parse('', 'append');
      expect(result.usage).toBeNull();
      expect(result.events).toHaveLength(0);
      expect(result.activity).toBeNull();
    });

    it('uses last_token_usage (per-turn) not total_token_usage (cumulative)', () => {
      // Regression test for context % bar climbing past 100% on long
      // sessions. Codex reports total_token_usage as cumulative billed
      // spend across all turns - using it for the context % would be
      // wrong. The parser must read info.last_token_usage instead,
      // which is a per-turn snapshot of current context occupancy.
      const jsonl = JSON.stringify({
        timestamp: '2026-04-09T04:38:53.854Z',
        type: 'token_count',
        payload: {
          info: {
            total_token_usage: {
              input_tokens: 33693, // cumulative - would be 13% of 258400
              cached_input_tokens: 22272,
              output_tokens: 47,
              total_tokens: 33740,
            },
            last_token_usage: {
              input_tokens: 11246, // per-turn - should be 4.3% of 258400
              cached_input_tokens: 11136,
              output_tokens: 6,
              total_tokens: 11252,
            },
            model_context_window: 258400,
          },
        },
      }) + '\n';

      const result = CodexSessionHistoryParser.parse(jsonl, 'append');
      expect(result.usage).not.toBeNull();
      // Must match last_token_usage, not total_token_usage.
      expect(result.usage!.contextWindow.totalInputTokens).toBe(11246);
      expect(result.usage!.contextWindow.totalOutputTokens).toBe(6);
      expect(result.usage!.contextWindow.cacheTokens).toBe(11136);
      expect(result.usage!.contextWindow.usedPercentage).toBeCloseTo(11246 / 258400 * 100, 2);
    });
  });
});
