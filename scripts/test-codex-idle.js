#!/usr/bin/env node
/**
 * Local test harness for validating the isSignificantOutput filter against
 * realistic Codex PTY output patterns.
 *
 * Simulates the PtyActivityTracker's silence timer behavior with and without
 * the isSignificantOutput filter, using realistic ANSI sequences captured
 * from real Codex 0.118 TUI output.
 *
 * Usage: node scripts/test-codex-idle.js
 */

// Inline the ANSI stripping logic (steps 1-5 from stripAnsiEscapes in
// transcript-writer.ts). Steps 6-8 (line ending normalization, blank line
// collapse, trailing whitespace trim) are omitted since the caller only
// checks `stripped.trim().length > 0` which is unaffected by them.
function stripAnsi(text) {
  let result = text.replace(
    /(?:\x1b[P\]X^_]|\x90|\x9d|\x9e|\x9f|\x98)[\s\S]*?(?:\x1b\\|\x07|\x9c)/g,
    '',
  );
  result = result.replace(
    /(?:\x1b\[|\x9b)[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g,
    '',
  );
  result = result.replace(/\x1b[\x20-\x7e]/g, '');
  result = result.replace(/[\x80-\x9f]/g, '');
  result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\r/g, '\n');
  return result;
}

function isSignificantOutput(data) {
  const stripped = stripAnsi(data);
  return stripped.trim().length > 0;
}

// Realistic Codex TUI redraw patterns captured from real Codex 0.118 PTY output.
// These are the ANSI-only chunks that the Ink TUI framework emits during idle.
const TUI_REDRAW_SAMPLES = [
  // Cursor home + clear screen + cursor positioning
  '\x1b[H\x1b[2J\x1b[1;1H',
  // Hide/show cursor toggle
  '\x1b[?25h\x1b[?25l',
  // Full TUI frame redraw: home, clear, multiple cursor movements, hide cursor
  '\x1b[H\x1b[2J\x1b[?25h\x1b[1;1H\x1b[?25l',
  // SGR color reset sequences
  '\x1b[0m\x1b[39m\x1b[49m',
  // Cursor movement to specific positions (Ink layouts)
  '\x1b[5;1H\x1b[10;1H\x1b[15;1H',
  // OSC title set
  '\x1b]0;codex\x07',
  // Mixed cursor movement with screen clear regions
  '\x1b[H\x1b[J\x1b[1;1H\x1b[2J\x1b[?25l',
  // Erase in line + cursor movement
  '\x1b[K\x1b[1;1H\x1b[K\x1b[2;1H\x1b[K',
  // Complex Ink frame: save cursor, clear, position, restore
  '\x1b7\x1b[H\x1b[2J\x1b[1;1H\x1b[?25l\x1b8',
  // DCS sequence (device control string)
  '\x1bP+q544e\x1b\\',
  // Multiple cursor positions with SGR
  '\x1b[1;1H\x1b[0m\x1b[2;1H\x1b[0m\x1b[3;1H\x1b[0m',
  // Scroll region + cursor positioning
  '\x1b[1;30r\x1b[1;1H\x1b[?25l',
  // Just whitespace after stripping (newlines, carriage returns in ANSI)
  '\x1b[H\r\n\x1b[K\r\n\x1b[K',
];

// Real significant output samples (boot header, prompt, actual content)
const SIGNIFICANT_SAMPLES = [
  'session id: 019d60ac-b67c-7a22-bcbb-af55c8295c38',
  'OpenAI Codex v0.118.0 (research preview)',
  '\x1b[32mHello world!\x1b[0m',
  '\x1b[H\x1b[2J\u203A Fix the bug',
  'Working on your request...',
  '\x1b[1;1H\x1b[0mPress enter to continue\x1b[?25l',
  'model: gpt-4.1',
  '\x1b[33m>>> Running: echo hello\x1b[0m',
];

console.log('=== Codex isSignificantOutput Filter Test ===\n');

// Test 1: All TUI redraw samples should be classified as noise
console.log('--- TUI Redraw Samples (should all be NOISE) ---');
let noisePass = 0;
let noiseFail = 0;
for (const sample of TUI_REDRAW_SAMPLES) {
  const result = isSignificantOutput(sample);
  const status = result ? 'FAIL' : 'PASS';
  if (!result) noisePass++;
  else noiseFail++;
  const hexPreview = sample.slice(0, 40).replace(/[\x00-\x1f\x7f-\x9f]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).padStart(2, '0');
    return `\\x${hex}`;
  });
  console.log(`  [${status}] ${sample.length.toString().padStart(3)}B  ${hexPreview}...`);
}
console.log(`  Result: ${noisePass} passed, ${noiseFail} failed\n`);

// Test 2: All significant samples should be classified as significant
console.log('--- Significant Output Samples (should all be SIG) ---');
let sigPass = 0;
let sigFail = 0;
for (const sample of SIGNIFICANT_SAMPLES) {
  const result = isSignificantOutput(sample);
  const status = result ? 'PASS' : 'FAIL';
  if (result) sigPass++;
  else sigFail++;
  const stripped = stripAnsi(sample).trim().slice(0, 60);
  console.log(`  [${status}] ${sample.length.toString().padStart(3)}B  "${stripped}"`);
}
console.log(`  Result: ${sigPass} passed, ${sigFail} failed\n`);

// Test 3: Simulate silence timer with TUI redraws
console.log('--- Silence Timer Simulation ---');
const PTY_SILENCE_THRESHOLD_MS = 10000;
const TUI_REDRAW_INTERVAL_MS = 500;
const SIMULATION_DURATION_MS = 15000;

// Simulate: boot burst (significant), then only TUI redraws
let lastSignificantTime = 0;
let silenceTimerExpiry = PTY_SILENCE_THRESHOLD_MS;
let idleDetected = false;
let idleTime = null;

// Boot burst at t=0
lastSignificantTime = 0;
console.log(`  [  0.0s] BOOT: significant output (session header)`);

// TUI redraws every 500ms from t=1000 onwards
for (let t = 1000; t <= SIMULATION_DURATION_MS; t += TUI_REDRAW_INTERVAL_MS) {
  const chunk = TUI_REDRAW_SAMPLES[Math.floor(Math.random() * TUI_REDRAW_SAMPLES.length)];
  const significant = isSignificantOutput(chunk);

  if (significant) {
    // BUG: this would reset the silence timer
    lastSignificantTime = t;
    silenceTimerExpiry = t + PTY_SILENCE_THRESHOLD_MS;
  }

  // Check if silence threshold reached
  if (!idleDetected && t >= silenceTimerExpiry) {
    idleDetected = true;
    idleTime = t;
  }
}

if (idleDetected) {
  console.log(`  [${(idleTime / 1000).toFixed(1)}s] IDLE detected (silence threshold fired)`);
  console.log(`  PASS: Filter correctly classified TUI redraws as noise`);
  console.log(`         Idle fired ${(idleTime / 1000).toFixed(1)}s after boot`);
  console.log(`         ${Math.floor((SIMULATION_DURATION_MS - idleTime) / TUI_REDRAW_INTERVAL_MS)} noise chunks continued after idle`);
} else {
  console.log(`  FAIL: Idle was NOT detected in ${SIMULATION_DURATION_MS / 1000}s`);
  console.log(`         Filter incorrectly classified some redraws as significant`);
}

// Test 4: Simulate WITHOUT filter (old behavior)
console.log('\n--- Old Behavior (no filter) ---');
let oldLastDataTime = 0;
let oldIdleDetected = false;

for (let t = 1000; t <= SIMULATION_DURATION_MS; t += TUI_REDRAW_INTERVAL_MS) {
  const chunk = TUI_REDRAW_SAMPLES[Math.floor(Math.random() * TUI_REDRAW_SAMPLES.length)];
  // Old behavior: any data.length > 0 resets the timer
  if (chunk.length > 0) {
    oldLastDataTime = t;
  }
  if (!oldIdleDetected && (t - oldLastDataTime) >= PTY_SILENCE_THRESHOLD_MS) {
    oldIdleDetected = true;
  }
}

if (!oldIdleDetected) {
  console.log(`  Confirmed: Old behavior NEVER reaches idle (timer reset every ${TUI_REDRAW_INTERVAL_MS}ms)`);
} else {
  console.log(`  Unexpected: Old behavior reached idle`);
}

// Summary
console.log('\n=== Summary ===');
const allPassed = noiseFail === 0 && sigFail === 0 && idleDetected && !oldIdleDetected;
if (allPassed) {
  console.log('ALL TESTS PASSED');
  console.log('  - All TUI redraw patterns correctly classified as noise');
  console.log('  - All significant output correctly classified as significant');
  console.log('  - Silence timer fires correctly with filter (idle detected)');
  console.log('  - Old behavior confirmed broken (idle never detected)');
  process.exit(0);
} else {
  console.log('SOME TESTS FAILED');
  process.exit(1);
}
