/**
 * Unit tests for GeminiAdapter session ID extraction - both hook-based
 * (extractSessionId) and PTY output-based (captureSessionIdFromOutput).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GeminiAdapter } from '../../src/main/agent/adapters/gemini';
import { GeminiSessionHistoryParser } from '../../src/main/agent/adapters/gemini/session-history-parser';

describe('Gemini Adapter - session ID capture', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter();
  });

  describe('extractSessionId', () => {
    it('extracts session_id from hookContext JSON', () => {
      const hookContext = JSON.stringify({ session_id: '4231e6aa-5409-4749-9272-270e9aab079b' });
      expect(adapter.runtime.sessionId!.fromHook!(hookContext)).toBe('4231e6aa-5409-4749-9272-270e9aab079b');
    });

    it('extracts sessionId (camelCase) as fallback', () => {
      const hookContext = JSON.stringify({ sessionId: 'abc-123-def' });
      expect(adapter.runtime.sessionId!.fromHook!(hookContext)).toBe('abc-123-def');
    });

    it('prefers session_id over sessionId', () => {
      const hookContext = JSON.stringify({ session_id: 'preferred', sessionId: 'fallback' });
      expect(adapter.runtime.sessionId!.fromHook!(hookContext)).toBe('preferred');
    });

    it('extracts from full Gemini hook base schema', () => {
      const hookContext = JSON.stringify({
        session_id: '4231e6aa-5409-4749-9272-270e9aab079b',
        transcript_path: '/tmp/transcript.json',
        cwd: '/home/dev/project',
        hook_event_name: 'SessionStart',
        timestamp: '2026-04-05T12:00:00Z',
      });
      expect(adapter.runtime.sessionId!.fromHook!(hookContext)).toBe('4231e6aa-5409-4749-9272-270e9aab079b');
    });

    it('returns null when hookContext has no session_id', () => {
      const hookContext = JSON.stringify({ thread_id: 'not-a-session' });
      expect(adapter.runtime.sessionId!.fromHook!(hookContext)).toBeNull();
    });

    it('returns null for empty session_id string', () => {
      const hookContext = JSON.stringify({ session_id: '' });
      expect(adapter.runtime.sessionId!.fromHook!(hookContext)).toBeNull();
    });

    it('returns null for non-string session_id', () => {
      const hookContext = JSON.stringify({ session_id: 12345 });
      expect(adapter.runtime.sessionId!.fromHook!(hookContext)).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(adapter.runtime.sessionId!.fromHook!('not json')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(adapter.runtime.sessionId!.fromHook!('')).toBeNull();
    });
  });

  describe('captureSessionIdFromOutput', () => {
    it('captures UUID from gemini --resume line', () => {
      const output = "To resume this session: gemini --resume '4231e6aa-5409-4749-9272-270e9aab079b'";
      expect(adapter.runtime.sessionId!.fromOutput!(output)).toBe('4231e6aa-5409-4749-9272-270e9aab079b');
    });

    it('captures UUID from gemini --resume without quotes', () => {
      const output = 'To resume this session: gemini --resume 4231e6aa-5409-4749-9272-270e9aab079b';
      expect(adapter.runtime.sessionId!.fromOutput!(output)).toBe('4231e6aa-5409-4749-9272-270e9aab079b');
    });

    it('captures UUID from Session ID header line', () => {
      const output = 'Session ID:           4231e6aa-5409-4749-9272-270e9aab079b';
      expect(adapter.runtime.sessionId!.fromOutput!(output)).toBe('4231e6aa-5409-4749-9272-270e9aab079b');
    });

    it('captures from full Gemini shutdown summary', () => {
      const output = [
        'Agent powering down. Goodbye!',
        '',
        'Interaction Summary',
        'Session ID:           4231e6aa-5409-4749-9272-270e9aab079b',
        'Tool Calls:           0 ( 0 x 0 )',
        'Success Rate:         0.0%',
        '',
        'Performance',
        'Wall Time:            10.2s',
        '',
        "To resume this session: gemini --resume '4231e6aa-5409-4749-9272-270e9aab079b'",
      ].join('\n');
      expect(adapter.runtime.sessionId!.fromOutput!(output)).toBe('4231e6aa-5409-4749-9272-270e9aab079b');
    });

    it('returns null for unrelated output', () => {
      expect(adapter.runtime.sessionId!.fromOutput!('Hello world')).toBeNull();
      expect(adapter.runtime.sessionId!.fromOutput!('')).toBeNull();
    });

    it('returns null for partial UUID', () => {
      expect(adapter.runtime.sessionId!.fromOutput!('Session ID: 4231e6aa')).toBeNull();
    });
  });
});

describe('GeminiSessionHistoryParser.locate', () => {
  // REGRESSION: Gemini 0.37 embeds only the FIRST 8 CHARS of the
  // session UUID in the chat filename, e.g. for
  // "08889b8d-c485-4aaa-b91d-ae966fa0ab4a" it writes
  // "session-2026-04-01T23-37-08889b8d.json". The original locate()
  // regex looked for the full UUID and never matched, so the session
  // history reader never attached and the task card was stuck on
  // "Loading agent..." forever. This test exercises the real layout.
  const FULL_UUID = '08889b8d-c485-4aaa-b91d-ae966fa0ab4a';
  const SHORT_ID = '08889b8d';

  let sandbox: string;
  let chatsDir: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-locate-'));
    const projectDirName = path.basename(sandbox).toLowerCase();
    chatsDir = path.join(os.homedir(), '.gemini', 'tmp', projectDirName, 'chats');
    fs.mkdirSync(chatsDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(chatsDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('finds a chat file whose filename embeds only the short (8-char) prefix', async () => {
    const filename = `session-2026-04-01T23-37-${SHORT_ID}.json`;
    const filepath = path.join(chatsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify({ sessionId: FULL_UUID, messages: [] }));

    const result = await GeminiSessionHistoryParser.locate({
      agentSessionId: FULL_UUID,
      cwd: sandbox,
    });

    expect(result).toBe(filepath);
  });

  it('still matches filenames with the full UUID if Gemini ever changes the scheme', async () => {
    const filename = `session-${FULL_UUID}.json`;
    const filepath = path.join(chatsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify({ sessionId: FULL_UUID, messages: [] }));

    const result = await GeminiSessionHistoryParser.locate({
      agentSessionId: FULL_UUID,
      cwd: sandbox,
    });

    expect(result).toBe(filepath);
  });
});
