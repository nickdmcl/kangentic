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

  it('no output path does not crash', () => {
    // No args at all — should exit 0 without creating any file
    runBridge('{}', []);
    expect(fs.existsSync(outputFile)).toBe(false);
  });
});
