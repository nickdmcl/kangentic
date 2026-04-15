#!/usr/bin/env node
/**
 * Mock Warp CLI (oz) for E2E tests.
 *
 * Warp command shapes (see src/main/agent/adapters/warp/warp-adapter.ts):
 *   oz dump-debug-info                              -> detector probe (no --version)
 *   oz agent run --prompt "<text>" -C <cwd> ...     -> new session
 *
 * Markers for test assertions:
 *   MOCK_WARP_SESSION:<id>   -> new session started
 *   MOCK_WARP_PROMPT:<text>  -> prompt text delivered
 *
 * Warp has no session resume mechanism, no hooks, no rollout files, and no
 * structured event output. This mock is intentionally simple - it validates
 * that the adapter correctly builds the `oz agent run` command shape and
 * that the PTY activity detection pipeline settles to idle.
 *
 * Env knobs:
 *   MOCK_WARP_ACTIVE_OUTPUT=1 -> emit periodic "working..." lines (1s interval)
 *                                to simulate active agent output before settling.
 */

const { randomUUID } = require('node:crypto');

const args = process.argv.slice(2);

// --- Version probe via dump-debug-info ---
// The real oz CLI does not support --version. It uses `dump-debug-info`.
if (args.includes('dump-debug-info') || args.includes('--dump-debug-info')) {
  console.log('Warp version: Some("v0.0.0-mock-test")');
  console.log('gpu_power_preference: HighPerformance');
  process.exit(0);
}

// --- Help probe ---
if (args.includes('help') || args.includes('--help') || args.includes('-h')) {
  console.log('oz - Warp CLI');
  console.log('');
  console.log('USAGE:');
  console.log('  oz agent run --prompt <PROMPT> [OPTIONS]');
  process.exit(0);
}

// --- Validate subcommand ---
// Warp CLI uses `oz agent run` subcommand form
if (args[0] !== 'agent' || args[1] !== 'run') {
  console.error('mock-warp: expected "agent run" subcommand');
  console.error('Got:', args.join(' '));
  process.exit(1);
}

// Parse flags from `oz agent run --prompt "..." -C <cwd> --name <name>`
const subArgs = args.slice(2);
let prompt = null;
let cwd = null;
let name = null;

for (let i = 0; i < subArgs.length; i++) {
  const flag = subArgs[i];
  if (flag === '--') continue; // end-of-options marker
  if (flag === '--prompt' && subArgs[i + 1]) {
    prompt = subArgs[++i];
  } else if (flag === '-C' && subArgs[i + 1]) {
    cwd = subArgs[++i];
  } else if (flag === '--name' && subArgs[i + 1]) {
    name = subArgs[++i];
  } else if ((flag === '--model' || flag === '--profile' || flag === '--skill' || flag === '--mcp' || flag === '--environment' || flag === '-e' || flag === '-n' || flag === '--file' || flag === '-f') && subArgs[i + 1]) {
    i++; // skip value for known flags
  }
  // Ignore unknown flags (--share, etc.)
}

const sessionId = randomUUID();

// --- PTY output ---

// Emit session marker immediately
console.log('MOCK_WARP_SESSION:' + sessionId);

if (prompt) {
  console.log('MOCK_WARP_PROMPT:' + prompt);
}

if (name) {
  console.log('MOCK_WARP_NAME:' + name);
}

if (cwd) {
  console.log('MOCK_WARP_CWD:' + cwd);
}

// Simulate real oz output format: Run ID header, then streamed response.
// The real oz CLI is a one-shot cloud agent runner - it streams output
// then exits (no interactive prompt).
console.log('');
console.log('Run ID: ' + sessionId);
console.log('Open in Oz: https://oz.warp.dev/runs/' + sessionId);
console.log('');
console.log('New conversation started with debug ID: ' + sessionId);
console.log('');

// Optional active output simulation
let activeInterval = null;
let activeCount = 0;
if (process.env.MOCK_WARP_ACTIVE_OUTPUT) {
  activeInterval = setInterval(() => {
    activeCount++;
    if (activeCount <= 3) {
      console.log(`Working on step ${activeCount}...`);
    } else {
      // Stop active output after 3 lines, then go silent.
      // The silence timer will detect idle.
      clearInterval(activeInterval);
      activeInterval = null;
    }
  }, 1000);
}

// Stay alive for 30s (matches other mock agents).
// Real oz exits when done, but we keep the mock alive so the PTY
// silence timer can fire and test the idle transition.
const timeout = setTimeout(() => {
  if (activeInterval) clearInterval(activeInterval);
  process.exit(0);
}, 30000);

// Signal handlers for clean shutdown
process.on('SIGTERM', () => {
  clearTimeout(timeout);
  if (activeInterval) clearInterval(activeInterval);
  process.exit(0);
});
process.on('SIGINT', () => {
  clearTimeout(timeout);
  if (activeInterval) clearInterval(activeInterval);
  process.exit(0);
});

// Handle Ctrl+C from PTY
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  if (data.includes('\x03')) {
    clearTimeout(timeout);
    if (activeInterval) clearInterval(activeInterval);
    process.exit(0);
  }
});
