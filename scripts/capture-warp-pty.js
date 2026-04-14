#!/usr/bin/env node
/**
 * Capture real Warp (oz) PTY output to understand output and idle behavior.
 *
 * Spawns `oz agent run` in a real PTY, captures every data chunk with timing,
 * and analyzes: chunk sizes, content after ANSI stripping, whether consecutive
 * frames are identical, and whether the detectIdle regex matches.
 *
 * Usage: node scripts/capture-warp-pty.js [project-dir]
 *
 * Requires node-pty (already in devDependencies) and `oz` on PATH.
 * Run from the worktree root so node-pty resolves.
 *
 * This is a development diagnostic tool, not used in production. Useful for
 * investigating Warp PTY behavior and tuning the idle detection regex.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

let pty;
try {
  pty = require('node-pty');
} catch (error) {
  console.error('Failed to load node-pty. It may be rebuilt for Electron.');
  console.error('Try: npm rebuild node-pty');
  console.error('Error:', error.message);
  process.exit(1);
}

// --- ANSI stripping ---
function stripAnsi(text) {
  let result = text.replace(
    /(?:\x1b[P\]X^_]|\x90|\x9d|\x9e|\x9f|\x98)[\s\S]*?(?:\x1b\\|\x07|\x9c)/g, '');
  result = result.replace(
    /(?:\x1b\[|\x9b)[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '');
  result = result.replace(/\x1b[\x20-\x7e]/g, '');
  result = result.replace(/[\x80-\x9f]/g, '');
  result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\r/g, '\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/[ \t]+$/gm, '');
  return result;
}

// --- Idle detection regex (same as warp-adapter.ts) ---
function detectIdle(data) {
  const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  return /(?:^|\n)\s*>\s*$/.test(clean);
}

// --- Resolve oz binary ---
const projectDir = process.argv[2] || process.cwd();
let ozPath = null;

// Try which/where first
try {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, ['oz'], { encoding: 'utf8' });
  if (result.status === 0) {
    ozPath = result.stdout.trim().split('\n')[0].trim();
  }
} catch { /* ignore */ }

if (!ozPath) {
  console.error('Error: `oz` not found on PATH.');
  console.error('Install Warp CLI: https://docs.warp.dev/reference/cli/cli');
  process.exit(1);
}

const CAPTURE_SECONDS = 30;
const PROMPT_TEXT = 'Say hello and nothing else';

console.log('=== Warp (oz) PTY Capture ===');
console.log(`Binary: ${ozPath}`);
console.log(`Project: ${projectDir}`);
console.log(`Duration: ${CAPTURE_SECONDS}s`);
console.log(`Platform: ${process.platform}`);
console.log('');

const startTime = Date.now();
const chunks = [];
let lastStrippedTrimmed = '';

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(2).padStart(7);
}

// Warp uses `oz agent run --prompt "..." -C <dir>`
const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
const shellArgs = process.platform === 'win32'
  ? ['-NoProfile', '-Command', `& "${ozPath}" agent run --prompt "${PROMPT_TEXT}" -C "${projectDir}"`]
  : ['-c', `"${ozPath}" agent run --prompt "${PROMPT_TEXT}" -C "${projectDir}"`];

console.log(`Spawning: ${shell} ${shellArgs.join(' ')}\n`);

const ptyProcess = pty.spawn(shell, shellArgs, {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: projectDir,
  env: { ...process.env, TERM: 'xterm-256color' },
});

console.log(`PID: ${ptyProcess.pid}\n`);
console.log('--- Live Chunk Log ---');

ptyProcess.onData((data) => {
  const stripped = stripAnsi(data);
  const strippedTrimmed = stripped.trim();
  const isDuplicate = strippedTrimmed.length > 0 && strippedTrimmed === lastStrippedTrimmed;
  const isAnsiOnly = strippedTrimmed.length === 0 && data.length > 0;
  const isIdle = detectIdle(data);

  chunks.push({
    time: Date.now() - startTime,
    rawLength: data.length,
    strippedLength: strippedTrimmed.length,
    isAnsiOnly,
    isDuplicate,
    isIdle,
    strippedPreview: strippedTrimmed.slice(0, 120).replace(/\n/g, '\\n'),
  });

  const tags = [];
  if (isAnsiOnly) tags.push('ANSI');
  if (isDuplicate) tags.push('DUP');
  if (isIdle) tags.push('IDLE');
  const tagStr = tags.length > 0 ? ` [${tags.join(',')}]` : '';

  console.log(`[${elapsed()}s] ${data.length.toString().padStart(5)}B raw, ${strippedTrimmed.length.toString().padStart(4)}B stripped${tagStr}`);
  if (strippedTrimmed.length > 0 && strippedTrimmed.length < 200) {
    console.log(`           "${strippedTrimmed.slice(0, 120).replace(/\n/g, '\\n')}"`);
  }

  if (strippedTrimmed.length > 0) {
    lastStrippedTrimmed = strippedTrimmed;
  }
});

ptyProcess.onExit(({ exitCode }) => {
  console.log(`\n[${elapsed()}s] PTY exited with code ${exitCode}`);
  printAnalysis();
  process.exit(0);
});

setTimeout(() => {
  console.log(`\n[${elapsed()}s] Capture time elapsed, killing PTY...`);
  ptyProcess.kill();
  setTimeout(() => { printAnalysis(); process.exit(0); }, 1000);
}, CAPTURE_SECONDS * 1000);

process.on('SIGINT', () => {
  console.log('\nInterrupted, killing PTY...');
  ptyProcess.kill();
  setTimeout(() => { printAnalysis(); process.exit(0); }, 500);
});

function printAnalysis() {
  console.log('\n=== Analysis ===\n');
  const total = chunks.length;
  const ansiOnly = chunks.filter(c => c.isAnsiOnly).length;
  const duplicates = chunks.filter(c => c.isDuplicate).length;
  const significant = chunks.filter(c => !c.isAnsiOnly && !c.isDuplicate).length;
  const idleHits = chunks.filter(c => c.isIdle).length;

  console.log(`Total chunks: ${total}`);
  console.log(`  Significant (new content): ${significant}`);
  console.log(`  Duplicate frames:          ${duplicates}`);
  console.log(`  ANSI-only chunks:          ${ansiOnly}`);
  console.log(`  Idle regex matches:        ${idleHits}`);

  const lastSigIndex = chunks.findLastIndex(c => !c.isAnsiOnly && !c.isDuplicate);
  if (lastSigIndex >= 0) {
    const lastSigChunk = chunks[lastSigIndex];
    console.log(`\nLast significant output at: ${(lastSigChunk.time / 1000).toFixed(2)}s`);
    const tail = chunks.slice(lastSigIndex + 1);
    if (tail.length > 0) {
      console.log(`Chunks after: ${tail.length} (${tail.filter(c => c.isDuplicate).length} dups, ${tail.filter(c => c.isAnsiOnly).length} ANSI)`);
    } else {
      console.log('Complete silence after final significant chunk.');
    }
  }

  if (idleHits > 0) {
    const firstIdle = chunks.find(c => c.isIdle);
    console.log(`\nFirst idle match at: ${(firstIdle.time / 1000).toFixed(2)}s`);
    console.log('Idle detection regex is working correctly.');
  } else {
    console.log('\nWARNING: Idle regex never matched. The detectIdle pattern');
    console.log('in warp-adapter.ts may need adjustment for real oz output.');
    console.log('Review the chunk log above and update the regex.');
  }
}
