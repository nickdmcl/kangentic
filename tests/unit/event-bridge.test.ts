/**
 * Unit tests for event-bridge.js - generic directive-based hook-to-JSONL bridge.
 *
 * Tests verify the directive mechanism (tool:, detail:, nested-detail:,
 * env:, remap:, arg-detail) that adapters use to control field extraction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BRIDGE = path.resolve(__dirname, '../../src/main/agent/event-bridge.js');

let tmpDir: string;
let outputFile: string;

function runBridge(stdin: string, args: string[]): void {
  execFileSync(process.execPath, [BRIDGE, ...args], {
    input: stdin,
    timeout: 5000,
  });
}

function readEvent(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evtbridge-'));
  outputFile = path.join(tmpDir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('event-bridge', () => {
  // --- Core behavior ---

  it('writes event with type and timestamp', () => {
    runBridge('{}', [outputFile, 'idle']);
    const line = readEvent();
    expect(line.type).toBe('idle');
    expect(typeof line.ts).toBe('number');
    expect(line.tool).toBeUndefined();
    expect(line.detail).toBeUndefined();
  });

  it('appends to existing file', () => {
    runBridge('{}', [outputFile, 'idle']);
    runBridge('{}', [outputFile, 'prompt']);
    const lines = fs.readFileSync(outputFile, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).type).toBe('idle');
    expect(JSON.parse(lines[1]).type).toBe('prompt');
  });

  it('no output path does not crash', () => {
    runBridge('{}', []);
    expect(fs.existsSync(outputFile)).toBe(false);
  });

  it('malformed JSON stdin produces event without extracted fields', () => {
    runBridge('not json', [outputFile, 'tool_start', 'tool:tool_name']);
    const line = readEvent();
    expect(line.type).toBe('tool_start');
    expect(line.tool).toBeUndefined();
    expect(line.detail).toBeUndefined();
  });

  // --- tool: directive ---

  it('tool: directive extracts tool name', () => {
    const stdin = JSON.stringify({ tool_name: 'Read' });
    runBridge(stdin, [outputFile, 'tool_start', 'tool:tool_name']);
    const line = readEvent();
    expect(line.tool).toBe('Read');
  });

  it('tool: directive with missing field produces no tool', () => {
    const stdin = JSON.stringify({ other: 'data' });
    runBridge(stdin, [outputFile, 'tool_end', 'tool:tool_name']);
    const line = readEvent();
    expect(line.tool).toBeUndefined();
  });

  // --- detail: directive ---

  it('detail: directive extracts first non-null field', () => {
    const stdin = JSON.stringify({ message: 'Context getting full' });
    runBridge(stdin, [outputFile, 'notification', 'detail:message,notification']);
    const line = readEvent();
    expect(line.detail).toBe('Context getting full');
  });

  it('detail: directive falls through to second field', () => {
    const stdin = JSON.stringify({ notification: 'Alert' });
    runBridge(stdin, [outputFile, 'notification', 'detail:message,notification']);
    const line = readEvent();
    expect(line.detail).toBe('Alert');
  });

  it('detail: directive truncates to 200 chars', () => {
    const stdin = JSON.stringify({ name: 'a'.repeat(250) });
    runBridge(stdin, [outputFile, 'task_completed', 'detail:name']);
    const line = readEvent();
    expect((line.detail as string).length).toBe(200);
  });

  // --- nested-detail: directive ---

  it('nested-detail: extracts from nested object', () => {
    const stdin = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: 'src/main.ts' },
    });
    runBridge(stdin, [outputFile, 'tool_start', 'tool:tool_name', 'nested-detail:tool_input:file_path,command']);
    const line = readEvent();
    expect(line.tool).toBe('Read');
    expect(line.detail).toBe('src/main.ts');
  });

  it('nested-detail: falls through to second field', () => {
    const stdin = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    runBridge(stdin, [outputFile, 'tool_start', 'tool:tool_name', 'nested-detail:tool_input:file_path,command']);
    const line = readEvent();
    expect(line.tool).toBe('Bash');
    expect(line.detail).toBe('npm test');
  });

  it('nested-detail: with missing parent produces no detail', () => {
    const stdin = JSON.stringify({ tool_name: 'Read' });
    runBridge(stdin, [outputFile, 'tool_start', 'nested-detail:tool_input:file_path']);
    const line = readEvent();
    expect(line.detail).toBeUndefined();
  });

  // --- remap: directive ---

  it('remap: changes event type when field matches value', () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', is_interrupt: true, error: 'User cancelled' });
    runBridge(stdin, [outputFile, 'tool_end', 'tool:tool_name', 'remap:is_interrupt:true:interrupted', 'detail:error']);
    const line = readEvent();
    expect(line.type).toBe('interrupted');
    expect(line.tool).toBe('Bash');
    expect(line.detail).toBe('User cancelled');
  });

  it('remap: keeps original type when field does not match', () => {
    const stdin = JSON.stringify({ tool_name: 'Read', is_interrupt: false });
    runBridge(stdin, [outputFile, 'tool_end', 'tool:tool_name', 'remap:is_interrupt:true:interrupted']);
    const line = readEvent();
    expect(line.type).toBe('tool_end');
    expect(line.tool).toBe('Read');
  });

  it('remap: keeps original type with malformed JSON', () => {
    runBridge('not json', [outputFile, 'tool_end', 'remap:is_interrupt:true:interrupted']);
    const line = readEvent();
    expect(line.type).toBe('tool_end');
  });

  // --- arg-detail directive ---

  it('arg-detail uses next argv as detail', () => {
    runBridge('{}', [outputFile, 'idle', 'arg-detail', 'permission']);
    const line = readEvent();
    expect(line.type).toBe('idle');
    expect(line.detail).toBe('permission');
  });

  // --- env: directive (session_start only) ---

  it('env: directive captures env var into hookContext', () => {
    const threadId = '019d60ac-b67c-7a22-bcbb-af55c8295c38';
    execFileSync(process.execPath, [BRIDGE, outputFile, 'session_start', 'env:thread_id=CODEX_THREAD_ID'], {
      input: '',
      timeout: 5000,
      env: { ...process.env, CODEX_THREAD_ID: threadId },
    });
    const line = readEvent();
    const hookCtx = JSON.parse(line.hookContext as string);
    expect(hookCtx.thread_id).toBe(threadId);
  });

  it('env: directive does not overwrite stdin field', () => {
    const stdin = JSON.stringify({ thread_id: 'from-stdin' });
    execFileSync(process.execPath, [BRIDGE, outputFile, 'session_start', 'env:thread_id=CODEX_THREAD_ID'], {
      input: stdin,
      timeout: 5000,
      env: { ...process.env, CODEX_THREAD_ID: 'from-env' },
    });
    const line = readEvent();
    const hookCtx = JSON.parse(line.hookContext as string);
    expect(hookCtx.thread_id).toBe('from-stdin');
  });

  it('env: directive ignored when env var not set', () => {
    execFileSync(process.execPath, [BRIDGE, outputFile, 'session_start', 'env:thread_id=NONEXISTENT_VAR'], {
      input: '',
      timeout: 5000,
    });
    const line = readEvent();
    expect(line.hookContext).toBeUndefined();
  });

  // --- session_start hookContext ---

  it('session_start captures stdin JSON as hookContext', () => {
    const stdin = JSON.stringify({
      session_id: '4231e6aa-5409-4749-9272-270e9aab079b',
      cwd: '/home/dev/project',
    });
    runBridge(stdin, [outputFile, 'session_start']);
    const line = readEvent();
    const hookCtx = JSON.parse(line.hookContext as string);
    expect(hookCtx.session_id).toBe('4231e6aa-5409-4749-9272-270e9aab079b');
  });

  it('session_start omits hookContext when no stdin and no env', () => {
    runBridge('', [outputFile, 'session_start']);
    const line = readEvent();
    expect(line.type).toBe('session_start');
    expect(line.hookContext).toBeUndefined();
  });

  // --- No directives (events that need no extraction) ---

  it('event with no directives writes type only', () => {
    runBridge('{}', [outputFile, 'session_end']);
    const line = readEvent();
    expect(line.type).toBe('session_end');
  });

  it('prompt event with no directives', () => {
    runBridge('{}', [outputFile, 'prompt']);
    const line = readEvent();
    expect(line.type).toBe('prompt');
  });

  it('compact event with no directives', () => {
    runBridge('{}', [outputFile, 'compact']);
    const line = readEvent();
    expect(line.type).toBe('compact');
  });

  // --- Combined directives (real-world patterns) ---

  it('tool + nested-detail combined (Claude PreToolUse pattern)', () => {
    const stdin = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: 'src/main.ts' },
    });
    runBridge(stdin, [outputFile, 'tool_start', 'tool:tool_name', 'nested-detail:tool_input:file_path,command,query']);
    const line = readEvent();
    expect(line.type).toBe('tool_start');
    expect(line.tool).toBe('Read');
    expect(line.detail).toBe('src/main.ts');
  });

  it('detail with multiple candidates (subagent pattern)', () => {
    const stdin = JSON.stringify({ agent_type: 'Explore' });
    runBridge(stdin, [outputFile, 'subagent_start', 'detail:agent_type,subagent_type']);
    const line = readEvent();
    expect(line.type).toBe('subagent_start');
    expect(line.detail).toBe('Explore');
  });
});
