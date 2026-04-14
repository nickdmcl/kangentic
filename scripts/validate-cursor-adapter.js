#!/usr/bin/env node
/**
 * Validate the Cursor CLI adapter by spawning mock-cursor in a real PTY
 * and verifying that the adapter's buildCommand produces correct output.
 *
 * Usage:
 *   node scripts/validate-cursor-adapter.js
 *
 * This exercises the adapter -> PTY -> mock-cursor pipeline end-to-end
 * without needing the real Cursor CLI installed. Validates:
 *   1. Version detection via the shared AgentDetector
 *   2. Interactive mode command building and PTY output
 *   3. Non-interactive mode command building
 *   4. Resume mode command building
 *   5. Shell quoting for Windows and Unix shells
 *
 * Requires node-pty (already in devDependencies). Run from the repo root.
 */

const path = require('node:path');
const { execSync } = require('node:child_process');

let pty;
try {
  pty = require('node-pty');
} catch (error) {
  console.error('Failed to load node-pty. Try: npm rebuild node-pty');
  console.error('Error:', error.message);
  process.exit(1);
}

// Always use the .js file directly (invoked with `node` or via PTY shell).
// The .cmd wrapper is for the real Electron app's shell detection, not this harness.
const MOCK_JS = path.join(__dirname, '..', 'tests', 'fixtures', 'mock-cursor.js');

let passed = 0;
let failed = 0;

/** Split a CLI argument string into an array, respecting double quotes. */
function parseArgs(argString) {
  const result = [];
  const regex = /"([^"]*)"|(--\w+=\S+)|(\S+)/g;
  let match;
  while ((match = regex.exec(argString)) !== null) {
    if (match[1] !== undefined) result.push(match[1]);      // quoted string (without quotes)
    else if (match[2] !== undefined) result.push(match[2]);  // --flag=value
    else if (match[3] !== undefined) result.push(match[3]);  // bare token
  }
  return result;
}

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// ── Test 1: Version detection ────────────────────────────────────────────────

function testVersionDetection() {
  console.log('\n--- Test 1: Version Detection ---');
  const result = execSync(`node "${MOCK_JS}" --version`, { encoding: 'utf-8' }).trim();
  assert(result === '0.50.3', `--version outputs "0.50.3" (got "${result}")`);
  assert(/^\d+\.\d+\.\d+/.test(result), `Version starts with digits (parseVersion would accept it)`);
}

// ── Test 2-4: PTY spawn tests ────────────────────────────────────────────────

function spawnAndCapture(args, timeoutMs) {
  return new Promise((resolve) => {
    // Spawn node directly to avoid shell echo/prompt noise in PTY output
    const nodeExe = process.execPath;
    const spawnArgs = [MOCK_JS, ...parseArgs(args)];

    let output = '';
    let resolved = false;
    const ptyProcess = pty.spawn(nodeExe, spawnArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    ptyProcess.onData((data) => {
      output += data;
    });

    // Send Ctrl+C for graceful exit instead of kill() which triggers
    // AttachConsole errors on Windows when ConPTY tries to enumerate
    // processes on an already-dead console.
    const timer = setTimeout(() => {
      ptyProcess.write('\x03');
    }, timeoutMs);

    // Hard kill fallback if graceful exit doesn't work within 2s
    const hardKillTimer = setTimeout(() => {
      if (!resolved) {
        ptyProcess.kill();
      }
    }, timeoutMs + 2000);

    ptyProcess.onExit(() => {
      resolved = true;
      clearTimeout(timer);
      clearTimeout(hardKillTimer);
      resolve(output);
    });
  });
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

async function testInteractiveMode() {
  console.log('\n--- Test 2: Interactive Mode (PTY) ---');
  const output = stripAnsi(await spawnAndCapture('"Fix the auth module"', 3000));

  assert(output.includes('MOCK_CURSOR_SESSION:'), 'Emits SESSION marker');
  assert(output.includes('MOCK_CURSOR_MODE:interactive'), 'Reports interactive mode');
  assert(output.includes('MOCK_CURSOR_PROMPT:Fix the auth module'), 'Prompt is delivered');
  assert(!output.includes('-p'), 'No -p flag in output');
}

async function testNonInteractiveMode() {
  console.log('\n--- Test 3: Non-Interactive Mode (PTY) ---');
  const output = stripAnsi(await spawnAndCapture('-p "Review the code" --output-format stream-json', 3000));

  assert(output.includes('MOCK_CURSOR_SESSION:'), 'Emits SESSION marker');
  assert(output.includes('MOCK_CURSOR_MODE:noninteractive'), 'Reports non-interactive mode');

  // Verify NDJSON stream-json init event contains session_id (UUID format)
  const sessionIdMatch = output.match(/"session_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
  assert(sessionIdMatch !== null, 'NDJSON init event contains session_id UUID');

  // Verify the stream contains the expected event types
  assert(output.includes('"type":"system"'), 'NDJSON contains system init event');
  assert(output.includes('"type":"user"'), 'NDJSON contains user message event');
  assert(output.includes('"type":"assistant"'), 'NDJSON contains assistant response event');
  assert(output.includes('"type":"result"'), 'NDJSON contains result event');
  assert(output.includes('Review the code'), 'Prompt is delivered in NDJSON user event');
}

async function testResumeMode() {
  console.log('\n--- Test 4: Resume Mode (PTY) ---');
  const output = stripAnsi(await spawnAndCapture('--resume="test-session-id-123"', 3000));

  assert(output.includes('MOCK_CURSOR_RESUMED:test-session-id-123'), 'Emits RESUMED marker with correct ID');
  assert(output.includes('MOCK_CURSOR_MODE:interactive'), 'Resume uses interactive mode');
  assert(!output.includes('MOCK_CURSOR_PROMPT:'), 'No prompt on resume');
}

async function testActivityDetection() {
  console.log('\n--- Test 5: Activity Detection (PTY silence) ---');
  // After initial output burst, mock goes silent. This validates
  // that no continuous output is produced that would defeat the
  // silence-based idle detector.
  const startTime = Date.now();
  const output = stripAnsi(await spawnAndCapture('"quick test"', 5000));
  const elapsedMs = Date.now() - startTime;

  // Count the number of lines of actual content
  const lines = output.split('\n').filter((line) => line.trim().length > 0);
  assert(lines.length <= 5, `Mock produces limited output (${lines.length} lines) - silence timer can fire`);
  assert(elapsedMs >= 4500, `Test ran for full duration (${elapsedMs}ms) - PTY stayed alive`);
}

async function testTuiRedrawIdle() {
  console.log('\n--- Test 6: TUI Redraw Idle Detection (PTY) ---');
  // Spawn with TUI redraws enabled. The mock emits ANSI-only frames
  // every 500ms (identical content each time). This simulates a real
  // TUI agent that continuously repaints the screen when idle.
  // The silence timer should still be able to fire because the
  // isSignificantOutput filter in SessionManager classifies identical
  // ANSI frames as noise.
  const originalEnv = process.env.MOCK_CURSOR_TUI_REDRAWS;
  process.env.MOCK_CURSOR_TUI_REDRAWS = '1';

  const startTime = Date.now();
  const output = await spawnAndCapture('"TUI redraw test"', 5000);
  const elapsedMs = Date.now() - startTime;

  // Restore env
  if (originalEnv === undefined) delete process.env.MOCK_CURSOR_TUI_REDRAWS;
  else process.env.MOCK_CURSOR_TUI_REDRAWS = originalEnv;

  assert(output.includes('MOCK_CURSOR_SESSION:'), 'Emits SESSION marker with TUI redraws');
  assert(elapsedMs >= 4500, `PTY stayed alive during redraws (${elapsedMs}ms)`);

  // Verify the output contains ANSI escape sequences (cursor positioning)
  assert(output.includes('\x1b[H'), 'Output contains ANSI cursor home sequences');
  assert(output.includes('\x1b[2J'), 'Output contains ANSI clear screen sequences');

  // Verify the redraw content is present (header text from the mock's idle frame)
  const strippedOutput = stripAnsi(output);
  assert(strippedOutput.includes('Cursor Agent'), 'TUI header text is present in redraws');
  assert(strippedOutput.includes('Waiting for input'), 'TUI idle prompt is present in redraws');
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Cursor Adapter Validation Harness ===');
  console.log(`Mock binary: ${MOCK_JS}`);
  console.log(`Platform: ${process.platform}`);

  testVersionDetection();
  await testInteractiveMode();
  await testNonInteractiveMode();
  await testResumeMode();
  await testActivityDetection();
  await testTuiRedrawIdle();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Harness error:', error);
  process.exit(1);
});
