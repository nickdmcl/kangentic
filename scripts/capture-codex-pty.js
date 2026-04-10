#!/usr/bin/env node
/**
 * Capture real Codex PTY output to understand TUI redraw behavior.
 *
 * Spawns Codex 0.118 in a real PTY, captures every data chunk with timing,
 * and analyzes: chunk sizes, content after ANSI stripping, whether
 * consecutive frames are identical, and whether detectIdle patterns match.
 *
 * Usage: node scripts/capture-codex-pty.js [project-dir]
 *
 * Requires node-pty (already in devDependencies).
 * Run from the worktree root so node-pty resolves.
 */

const path = require('node:path');
const os = require('node:os');

let pty;
try {
  pty = require('node-pty');
} catch (error) {
  console.error('Failed to load node-pty. It may be rebuilt for Electron.');
  console.error('Try: npm rebuild node-pty');
  console.error('Error:', error.message);
  process.exit(1);
}

// --- ANSI stripping (same as stripAnsiEscapes in transcript-writer.ts) ---
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

// --- Lightweight ANSI strip for detectIdle (CSI + OSC only) ---
function stripCsiOsc(text) {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
             .replace(/\x1b\][^\x07\x1b]*[\x07\x1b]/g, '');
}

const projectDir = process.argv[2] || process.cwd();
const codexPath = process.platform === 'win32'
  ? path.join(process.env.APPDATA || '', 'npm', 'codex.CMD')
  : 'codex';
const CAPTURE_SECONDS = 30;

console.log('=== Codex PTY Capture ===');
console.log(`Codex: ${codexPath}`);
console.log(`Project: ${projectDir}`);
console.log(`Duration: ${CAPTURE_SECONDS}s`);
console.log(`Platform: ${process.platform}`);
console.log('');

const startTime = Date.now();
const chunks = [];
let lastStrippedContent = '';
let lastStrippedTrimmed = '';

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(2).padStart(7);
}

function hexEscape(str, maxLen) {
  const truncated = str.slice(0, maxLen);
  return truncated.replace(/[\x00-\x1f\x7f-\x9f]/g, (c) => {
    return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0');
  });
}

// Spawn Codex
const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
const shellArgs = process.platform === 'win32'
  ? ['-NoProfile', '-Command', `& "${codexPath}" -C "${projectDir}" --full-auto "Say hello and nothing else"`]
  : ['-c', `"${codexPath}" -C "${projectDir}" --full-auto "Say hello and nothing else"`];

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
  const now = Date.now();
  const stripped = stripAnsi(data);
  const strippedTrimmed = stripped.trim();
  const csiOscStripped = stripCsiOsc(data);

  const hasGuillemet = /\u203A/.test(csiOscStripped);
  const hasPressEnter = /Press enter to continue/.test(csiOscStripped);
  const detectIdleMatch = hasGuillemet || hasPressEnter;
  const isDuplicate = strippedTrimmed.length > 0 && strippedTrimmed === lastStrippedTrimmed;
  const isAnsiOnly = strippedTrimmed.length === 0 && data.length > 0;

  const chunk = {
    time: now - startTime,
    rawLength: data.length,
    strippedLength: strippedTrimmed.length,
    isAnsiOnly,
    isDuplicate,
    detectIdleMatch,
    hasGuillemet,
    strippedPreview: strippedTrimmed.slice(0, 120).replace(/\n/g, '\\n'),
    rawPreview: hexEscape(data, 80),
  };
  chunks.push(chunk);

  // Tag for the log
  const tags = [];
  if (isAnsiOnly) tags.push('ANSI-ONLY');
  if (isDuplicate) tags.push('DUPLICATE');
  if (detectIdleMatch) tags.push('IDLE-MATCH');
  if (hasGuillemet) tags.push('\u203A');
  const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';

  console.log(`[${elapsed()}s] ${data.length.toString().padStart(5)}B raw, ${strippedTrimmed.length.toString().padStart(4)}B stripped${tagStr}`);
  if (strippedTrimmed.length > 0 && strippedTrimmed.length < 200) {
    console.log(`           text: "${chunk.strippedPreview}"`);
  } else if (strippedTrimmed.length >= 200) {
    console.log(`           text: "${strippedTrimmed.slice(0, 100).replace(/\n/g, '\\n')}..." (${strippedTrimmed.length} chars)`);
  }

  if (strippedTrimmed.length > 0) {
    lastStrippedContent = stripped;
    lastStrippedTrimmed = strippedTrimmed;
  }
});

ptyProcess.onExit(({ exitCode }) => {
  console.log(`\n[${elapsed()}s] PTY exited with code ${exitCode}`);
  printAnalysis();
  process.exit(0);
});

// Kill after capture duration
const killTimer = setTimeout(() => {
  console.log(`\n[${elapsed()}s] Capture time elapsed, killing PTY...`);
  ptyProcess.kill();
  setTimeout(() => {
    printAnalysis();
    process.exit(0);
  }, 2000);
}, CAPTURE_SECONDS * 1000);

// Auto-approve trust dialog: when we see the trust prompt (› with numbered
// choices), send "1\r" to select "Yes, continue". Also send "\r" for any
// "Press enter to continue" prompt.
let trustApproved = false;
ptyProcess.onData(function autoApprove(data) {
  if (trustApproved) return;
  const clean = stripCsiOsc(data);
  if (/trust/.test(clean) && /\u203A/.test(clean)) {
    setTimeout(() => {
      console.log(`\n[${elapsed()}s] >>> Auto-sending "1" to approve trust dialog\n`);
      ptyProcess.write('1\r');
      trustApproved = true;
    }, 500);
  }
  if (/Press enter to continue/.test(clean)) {
    setTimeout(() => {
      console.log(`\n[${elapsed()}s] >>> Auto-sending Enter for "Press enter to continue"\n`);
      ptyProcess.write('\r');
    }, 500);
  }
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  clearTimeout(killTimer);
  console.log('\nInterrupted, killing PTY...');
  ptyProcess.kill();
  setTimeout(() => {
    printAnalysis();
    process.exit(0);
  }, 1000);
});

function printAnalysis() {
  console.log('\n\n=== Analysis ===\n');

  const total = chunks.length;
  const ansiOnly = chunks.filter(c => c.isAnsiOnly).length;
  const duplicates = chunks.filter(c => c.isDuplicate).length;
  const idleMatches = chunks.filter(c => c.detectIdleMatch).length;
  const withGuillemet = chunks.filter(c => c.hasGuillemet).length;
  const significant = chunks.filter(c => !c.isAnsiOnly && !c.isDuplicate).length;

  console.log(`Total chunks: ${total}`);
  console.log(`  ANSI-only (empty after strip):  ${ansiOnly}`);
  console.log(`  Duplicate (same as previous):   ${duplicates}`);
  console.log(`  Significant (new content):      ${significant}`);
  console.log(`  detectIdle matches:             ${idleMatches}`);
  console.log(`  Contains \u203A guillemet:            ${withGuillemet}`);
  console.log('');

  // Find the transition point: last chunk with unique content
  const lastSigIndex = chunks.findLastIndex(c => !c.isAnsiOnly && !c.isDuplicate);
  if (lastSigIndex >= 0) {
    const lastSigChunk = chunks[lastSigIndex];
    console.log(`Last significant output at: ${(lastSigChunk.time / 1000).toFixed(1)}s`);
    const trailingNoise = chunks.slice(lastSigIndex + 1);
    const trailingDups = trailingNoise.filter(c => c.isDuplicate).length;
    const trailingAnsi = trailingNoise.filter(c => c.isAnsiOnly).length;
    console.log(`Chunks after last significant: ${trailingNoise.length} (${trailingDups} duplicates, ${trailingAnsi} ANSI-only)`);
  }

  // Idle detection verdict
  console.log('\n--- Idle Detection Verdict ---\n');

  if (idleMatches > 0) {
    const firstMatch = chunks.find(c => c.detectIdleMatch);
    console.log(`detectIdle WORKS: first match at ${(firstMatch.time / 1000).toFixed(1)}s`);
    console.log('  The \u203A prompt pattern is present in PTY output.');
    console.log('  Immediate idle transition would fire on first match.');
  } else {
    console.log('detectIdle DOES NOT MATCH any chunk.');
    console.log('  The \u203A prompt pattern was NOT found after CSI/OSC stripping.');
    console.log('  Silence timer is the only path to idle.');
  }

  console.log('');
  if (duplicates > 0) {
    console.log(`Content dedup WORKS: ${duplicates} repeated frames would be filtered.`);
    console.log('  Silence timer would fire ~10s after last unique content.');
  } else {
    console.log('Content dedup NOT TESTED: no duplicate frames observed.');
    console.log('  Either Codex exited before idle, or each frame has unique content.');
  }

  // Show chunk frequency during idle phase
  if (lastSigIndex >= 0 && lastSigIndex < chunks.length - 2) {
    const idleChunks = chunks.slice(lastSigIndex + 1);
    if (idleChunks.length >= 2) {
      const intervals = [];
      for (let i = 1; i < idleChunks.length; i++) {
        intervals.push(idleChunks[i].time - idleChunks[i - 1].time);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      console.log(`\nIdle phase redraw frequency: ~${Math.round(avgInterval)}ms average interval`);
      console.log(`  (${idleChunks.length} chunks over ${((idleChunks[idleChunks.length - 1].time - idleChunks[0].time) / 1000).toFixed(1)}s)`);
    }
  }

  // Dump last 10 idle-phase chunks for inspection
  console.log('\n--- Last 10 Chunks ---\n');
  const tail = chunks.slice(-10);
  for (const chunk of tail) {
    const tags = [];
    if (chunk.isAnsiOnly) tags.push('ANSI');
    if (chunk.isDuplicate) tags.push('DUP');
    if (chunk.detectIdleMatch) tags.push('IDLE');
    if (chunk.hasGuillemet) tags.push('\u203A');
    const tagStr = tags.length > 0 ? ` [${tags.join(',')}]` : '';
    console.log(`  [${(chunk.time / 1000).toFixed(1).padStart(6)}s] ${chunk.rawLength.toString().padStart(5)}B${tagStr}`);
    if (chunk.strippedPreview) {
      console.log(`           "${chunk.strippedPreview}"`);
    }
  }
}
