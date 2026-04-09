import { describe, it, expect } from 'vitest';
import { GeminiSessionHistoryParser } from '../../src/main/agent/adapters/gemini/session-history-parser';

/**
 * GeminiSessionHistoryParser unit tests. Uses inline JSON fixtures derived from
 * real Gemini CLI chat files at ~/.gemini/tmp/<dir>/chats/session-*.json.
 */
describe('GeminiSessionHistoryParser', () => {
  describe('parse', () => {
    it('extracts model and tokens from the latest gemini message', () => {
      const json = JSON.stringify({
        sessionId: '08889b8d-c485-4aaa-b91d-ae966fa0ab4a',
        projectHash: '35ad1238',
        startTime: '2026-04-01T23:38:36.391Z',
        lastUpdated: '2026-04-01T23:38:37.971Z',
        messages: [
          {
            id: 'user-1',
            timestamp: '2026-04-01T23:38:36.391Z',
            type: 'user',
            content: [{ text: 'hello' }],
          },
          {
            id: 'gemini-1',
            timestamp: '2026-04-01T23:38:37.971Z',
            type: 'gemini',
            content: 'Hello! I am Gemini.',
            tokens: {
              input: 11199,
              output: 47,
              cached: 0,
              thoughts: 0,
              tool: 0,
              total: 11246,
            },
            model: 'gemini-3-flash-preview',
          },
        ],
        kind: 'main',
      });

      const result = GeminiSessionHistoryParser.parse(json, 'full');

      expect(result.usage).not.toBeNull();
      expect(result.usage!.model.id).toBe('gemini-3-flash-preview');
      expect(result.usage!.contextWindow.totalInputTokens).toBe(11199);
      expect(result.usage!.contextWindow.totalOutputTokens).toBe(47);
      expect(result.usage!.contextWindow.contextWindowSize).toBe(1_000_000);
      expect(result.usage!.contextWindow.usedPercentage).toBeCloseTo(11199 / 1_000_000 * 100, 5);
    });

    it('walks messages backwards and finds the most recent gemini entry', () => {
      const json = JSON.stringify({
        sessionId: 'test',
        messages: [
          {
            type: 'gemini',
            model: 'gemini-2.5-flash',
            tokens: { input: 100, output: 10, total: 110 },
          },
          { type: 'user', content: [{ text: 'follow up' }] },
          {
            type: 'gemini',
            model: 'gemini-3-pro',
            tokens: { input: 500, output: 20, total: 520 },
          },
        ],
      });

      const result = GeminiSessionHistoryParser.parse(json, 'full');
      expect(result.usage!.model.id).toBe('gemini-3-pro');
      expect(result.usage!.contextWindow.totalInputTokens).toBe(500);
      expect(result.usage!.contextWindow.contextWindowSize).toBe(2_000_000);
    });

    it('resolves context window sizes for known model families', () => {
      const cases: Array<{ model: string; expected: number }> = [
        { model: 'gemini-3-flash-preview', expected: 1_000_000 },
        { model: 'gemini-3-pro', expected: 2_000_000 },
        { model: 'gemini-2.5-pro', expected: 2_000_000 },
        { model: 'gemini-2.5-flash', expected: 1_000_000 },
        { model: 'gemini-2.0-flash', expected: 1_000_000 },
      ];
      for (const { model, expected } of cases) {
        const json = JSON.stringify({
          sessionId: 'test',
          messages: [
            { type: 'gemini', model, tokens: { input: 0, output: 0, total: 0 } },
          ],
        });
        const result = GeminiSessionHistoryParser.parse(json, 'full');
        expect(result.usage!.contextWindow.contextWindowSize).toBe(expected);
      }
    });

    it('uses 0 as sentinel contextWindowSize for unknown models', () => {
      // Unknown models must NOT get a guessed context window. The
      // 0 sentinel tells the TaskCard renderer to hide the progress
      // bar and show only the model name (graceful degradation).
      const json = JSON.stringify({
        sessionId: 'test',
        messages: [
          {
            type: 'gemini',
            model: 'gemini-5-hypothetical-future-model',
            tokens: { input: 1234, output: 56, total: 1290 },
          },
        ],
      });
      const result = GeminiSessionHistoryParser.parse(json, 'full');
      expect(result.usage).not.toBeNull();
      expect(result.usage!.model.id).toBe('gemini-5-hypothetical-future-model');
      expect(result.usage!.contextWindow.contextWindowSize).toBe(0);
      expect(result.usage!.contextWindow.usedPercentage).toBe(0);
      // Token counts are still reported - only the window size / % is hidden.
      expect(result.usage!.contextWindow.totalInputTokens).toBe(1234);
    });

    it('returns null usage when no gemini messages exist', () => {
      const json = JSON.stringify({
        sessionId: 'test',
        messages: [{ type: 'user', content: [{ text: 'hi' }] }],
      });

      const result = GeminiSessionHistoryParser.parse(json, 'full');
      expect(result.usage).toBeNull();
    });

    it('handles malformed JSON without throwing', () => {
      const result = GeminiSessionHistoryParser.parse('{not valid', 'full');
      expect(result.usage).toBeNull();
      expect(result.events).toHaveLength(0);
    });

    it('handles missing token fields (treats as 0)', () => {
      const json = JSON.stringify({
        sessionId: 'test',
        messages: [
          { type: 'gemini', model: 'gemini-3-flash-preview' },
        ],
      });

      const result = GeminiSessionHistoryParser.parse(json, 'full');
      expect(result.usage).not.toBeNull();
      expect(result.usage!.contextWindow.totalInputTokens).toBe(0);
      expect(result.usage!.contextWindow.totalOutputTokens).toBe(0);
    });

    it('handles empty messages array', () => {
      const json = JSON.stringify({ sessionId: 'test', messages: [] });
      const result = GeminiSessionHistoryParser.parse(json, 'full');
      expect(result.usage).toBeNull();
    });

    it('does not emit activity hints (lets PtyActivityTracker handle transitions)', () => {
      const json = JSON.stringify({
        sessionId: 'test',
        messages: [
          { type: 'gemini', model: 'gemini-3-flash-preview', tokens: { input: 100, output: 5, total: 105 } },
        ],
      });
      const result = GeminiSessionHistoryParser.parse(json, 'full');
      expect(result.activity).toBeNull();
    });
  });
});
