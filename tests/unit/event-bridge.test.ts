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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evtbridge-'));
  outputFile = path.join(tmpDir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('event-bridge', () => {
  it('tool_start with tool name and detail', () => {
    const stdin = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: 'src/main.ts' },
    });
    runBridge(stdin, [outputFile, 'tool_start']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('tool_start');
    expect(line.tool).toBe('Read');
    expect(line.detail).toBe('src/main.ts');
    expect(typeof line.ts).toBe('number');
  });

  it('tool_start picks first available detail field', () => {
    const stdin = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    runBridge(stdin, [outputFile, 'tool_start']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.tool).toBe('Bash');
    expect(line.detail).toBe('npm test');
  });

  it('tool_end with tool name only', () => {
    const stdin = JSON.stringify({ tool_name: 'Read' });
    runBridge(stdin, [outputFile, 'tool_end']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('tool_end');
    expect(line.tool).toBe('Read');
    expect(line.detail).toBeUndefined();
  });

  it('idle event', () => {
    runBridge('{}', [outputFile, 'idle']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('idle');
    expect(line.tool).toBeUndefined();
  });

  it('prompt event', () => {
    runBridge('{}', [outputFile, 'prompt']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('prompt');
  });

  it('truncates detail to 200 chars', () => {
    const longPath = 'a'.repeat(250);
    const stdin = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: longPath },
    });
    runBridge(stdin, [outputFile, 'tool_start']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.detail.length).toBe(200);
  });

  it('malformed JSON stdin produces event without tool/detail', () => {
    runBridge('not json', [outputFile, 'tool_start']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('tool_start');
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

  it('tool_failure with is_interrupt emits interrupted event', () => {
    const stdin = JSON.stringify({
      tool_name: 'Bash',
      is_interrupt: true,
      error: 'User cancelled the tool',
    });
    runBridge(stdin, [outputFile, 'tool_failure']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('interrupted');
    expect(line.tool).toBe('Bash');
    expect(line.detail).toBe('User cancelled the tool');
    expect(typeof line.ts).toBe('number');
  });

  it('tool_failure without is_interrupt emits tool_end event', () => {
    const stdin = JSON.stringify({
      tool_name: 'Read',
      is_interrupt: false,
    });
    runBridge(stdin, [outputFile, 'tool_failure']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('tool_end');
    expect(line.tool).toBe('Read');
    expect(line.detail).toBeUndefined();
  });

  it('tool_failure with malformed JSON defaults to tool_end', () => {
    runBridge('not json', [outputFile, 'tool_failure']);

    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('tool_end');
    expect(line.tool).toBeUndefined();
  });

  it('no output path does not crash', () => {
    // No args at all -- should exit 0 without creating any file
    runBridge('{}', []);
    expect(fs.existsSync(outputFile)).toBe(false);
  });

  // --- New event types ---

  it('session_start event', () => {
    runBridge('{}', [outputFile, 'session_start']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('session_start');
    expect(typeof line.ts).toBe('number');
  });

  it('session_end event', () => {
    runBridge('{}', [outputFile, 'session_end']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('session_end');
  });

  it('subagent_start extracts agent_type', () => {
    const stdin = JSON.stringify({ agent_type: 'Explore' });
    runBridge(stdin, [outputFile, 'subagent_start']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('subagent_start');
    expect(line.detail).toBe('Explore');
  });

  it('subagent_stop extracts agent_type', () => {
    const stdin = JSON.stringify({ agent_type: 'Plan' });
    runBridge(stdin, [outputFile, 'subagent_stop']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('subagent_stop');
    expect(line.detail).toBe('Plan');
  });

  it('notification extracts message', () => {
    const stdin = JSON.stringify({ message: 'Context getting full' });
    runBridge(stdin, [outputFile, 'notification']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('notification');
    expect(line.detail).toBe('Context getting full');
  });

  it('compact event', () => {
    runBridge('{}', [outputFile, 'compact']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('compact');
  });

  it('teammate_idle extracts agent info', () => {
    const stdin = JSON.stringify({ agent: 'agent-2' });
    runBridge(stdin, [outputFile, 'teammate_idle']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('teammate_idle');
    expect(line.detail).toBe('agent-2');
  });

  it('task_completed extracts task info', () => {
    const stdin = JSON.stringify({ task: 'Fix login bug' });
    runBridge(stdin, [outputFile, 'task_completed']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('task_completed');
    expect(line.detail).toBe('Fix login bug');
  });

  it('config_change event', () => {
    runBridge('{}', [outputFile, 'config_change']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('config_change');
  });

  it('worktree_create extracts name', () => {
    const stdin = JSON.stringify({ name: 'feature-branch' });
    runBridge(stdin, [outputFile, 'worktree_create']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('worktree_create');
    expect(line.detail).toBe('feature-branch');
  });

  it('worktree_remove extracts path', () => {
    const stdin = JSON.stringify({ path: '/tmp/worktree-1' });
    runBridge(stdin, [outputFile, 'worktree_remove']);
    const line = JSON.parse(fs.readFileSync(outputFile, 'utf-8').trim());
    expect(line.type).toBe('worktree_remove');
    expect(line.detail).toBe('/tmp/worktree-1');
  });
});
