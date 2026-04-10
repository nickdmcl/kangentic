#!/usr/bin/env node
/**
 * Test harness for Codex idle detection via silence timer + content dedup.
 *
 * Validates the agent-agnostic approach using empirically captured Codex
 * PTY behavior: character-by-character streaming during active work,
 * then complete silence when idle.
 *
 * Usage: node scripts/test-codex-idle.js
 */

// --- ANSI stripping (same as stripAnsiEscapes in transcript-writer.ts) ---
function stripAnsi(text) {
  let result = text.replace(
    /(?:\x1b[P\]X^_]|\x90|\x9d|\x9e|\x9f|\x98)[\s\S]*?(?:\x1b\\|\x07|\x1b\\)/g, '');
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

const PTY_SILENCE_THRESHOLD_MS = 10000;
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (error) {
    console.log(`  [FAIL] ${name}`);
    console.log(`         ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Simulates the session-manager dispatch + PtyActivityTracker behavior
function createSimulator() {
  const lastContent = new Map();
  let state = 'idle';
  let silenceTimerExpiry = null;

  return {
    get state() { return state; },

    /** Process a PTY data chunk (mirrors session-manager dispatch) */
    onChunk(data, time) {
      const stripped = stripAnsi(data).trim();
      const previousContent = lastContent.get('session');

      if (stripped.length > 0 && stripped !== previousContent) {
        lastContent.set('session', stripped);
        // This is what notifyPtyData does: idle→thinking + reset timer
        if (state === 'idle') state = 'thinking';
        silenceTimerExpiry = time + PTY_SILENCE_THRESHOLD_MS;
      }
      // ANSI-only or duplicate: no-op (timer keeps counting)
    },

    /** Check if silence timer has fired */
    checkTimer(time) {
      if (silenceTimerExpiry !== null && time >= silenceTimerExpiry && state === 'thinking') {
        state = 'idle';
        silenceTimerExpiry = null;
      }
    },
  };
}

console.log('=== Codex Idle Detection - Empirical Validation ===\n');

// --- Test 1: Real Codex behavior (from PTY capture) ---
console.log('--- Test 1: Real Codex behavior (empirical) ---');
console.log('    Boot → active streaming → silence → idle\n');

test('active streaming keeps state as thinking', () => {
  const sim = createSimulator();
  // Boot burst
  sim.onChunk('\x1b[H\x1b[2J', 0);          // ANSI-only
  sim.onChunk('session id: fake-uuid', 100);   // boot header
  // Active work: character-by-character fragments (empirically observed)
  sim.onChunk('\x1b[1;1H\x1b[0mW', 1500);
  sim.onChunk('\x1b[1;2H\x1b[0mor', 1600);
  sim.onChunk('\x1b[1;4H\x1b[0mki', 1700);
  sim.onChunk('\x1b[1;6H\x1b[0mng', 1800);

  assert(sim.state === 'thinking', `Expected thinking, got ${sim.state}`);
});

test('ANSI-only chunks do not reset silence timer', () => {
  const sim = createSimulator();
  sim.onChunk('boot output', 0);               // significant
  sim.onChunk('\x1b[H\x1b[2J\x1b[?25l', 500); // ANSI-only
  sim.onChunk('\x1b[?25h\x1b[?25l', 1000);     // ANSI-only
  // Timer was set at t=0, ANSI chunks didn't reset it
  sim.checkTimer(10000);
  assert(sim.state === 'idle', `Expected idle at 10s, got ${sim.state}`);
});

test('silence after active work triggers idle at 10s', () => {
  const sim = createSimulator();
  // Active work ends at t=3000
  sim.onChunk('Working...', 1000);
  sim.onChunk('\x1b[0mhello', 2000);
  sim.onChunk('\x1b[0m• Done', 3000);

  // Check at various times
  sim.checkTimer(5000);
  assert(sim.state === 'thinking', `Expected thinking at 5s, got ${sim.state}`);
  sim.checkTimer(12000);
  assert(sim.state === 'thinking', `Expected thinking at 12s, got ${sim.state}`);
  sim.checkTimer(13000);
  assert(sim.state === 'idle', `Expected idle at 13s (3s + 10s), got ${sim.state}`);
});

test('guillemet in active frames does NOT cause false idle (no detectIdle)', () => {
  const sim = createSimulator();
  // Frame with › during active work (always visible in Codex TUI)
  sim.onChunk('\x1b[1;1H\u203A Say hello\x1b[2;1H• Working (0s)', 1000);
  sim.onChunk('\x1b[1;1H\x1b[0mW', 1500);  // streaming char
  sim.onChunk('\x1b[1;1H\u203A Say hello\x1b[2;1H• Working (1s)', 2000);

  // Without detectIdle, › doesn't trigger idle. State stays thinking.
  assert(sim.state === 'thinking', `Expected thinking, got ${sim.state}`);
});

// --- Test 2: Content dedup (safety net for TUI redraws) ---
console.log('\n--- Test 2: Content dedup (agent-agnostic safety net) ---');
console.log('    Repeated TUI frames are filtered as noise\n');

test('first frame is significant, repeated frames are noise', () => {
  const sim = createSimulator();
  const idleFrame = '\x1b[H\x1b[2J\x1b[1;1H\u203A Implement {feature}\x1b[?25l';
  sim.onChunk('boot', 0);
  sim.onChunk(idleFrame, 1000);  // first occurrence: significant → timer reset to 11s
  sim.onChunk(idleFrame, 1500);  // duplicate: filtered → no timer reset
  sim.onChunk(idleFrame, 2000);  // duplicate: filtered
  sim.onChunk(idleFrame, 5000);  // duplicate: filtered
  sim.onChunk(idleFrame, 9000);  // duplicate: filtered

  // Timer was set at t=1000 (first unique idle frame), fires at t=11000
  sim.checkTimer(10500);
  assert(sim.state === 'thinking', `Expected thinking at 10.5s, got ${sim.state}`);
  sim.checkTimer(11000);
  assert(sim.state === 'idle', `Expected idle at 11s, got ${sim.state}`);
});

test('content change after idle redraws resets timer', () => {
  const sim = createSimulator();
  const frame1 = '\x1b[1mStatus: idle\x1b[0m';
  const frame2 = '\x1b[1mStatus: working\x1b[0m';
  sim.onChunk(frame1, 0);      // significant
  sim.onChunk(frame1, 500);    // duplicate
  sim.onChunk(frame1, 1000);   // duplicate
  sim.onChunk(frame2, 5000);   // DIFFERENT content → significant → timer reset to 15s

  sim.checkTimer(10000);
  assert(sim.state === 'thinking', `Expected thinking at 10s (timer reset at 5s), got ${sim.state}`);
  sim.checkTimer(15000);
  assert(sim.state === 'idle', `Expected idle at 15s, got ${sim.state}`);
});

// --- Test 3: End-to-end simulation matching empirical capture ---
console.log('\n--- Test 3: End-to-end simulation (matches real capture) ---');
console.log('    Replay of actual Codex PTY capture timing\n');

test('empirical Codex session: boot → trust → active → silence → idle', () => {
  const sim = createSimulator();

  // From capture: boot ANSI at t=0.07-0.57 (all ANSI-only, no effect)
  sim.onChunk('\x1b[H\x1b[2J', 70);
  sim.onChunk('\x1b[?25h', 480);
  sim.onChunk('\x1b[0m', 570);

  // Trust dialog at t=0.77 (significant - has text)
  sim.onChunk('\x1b[1;1H\u203A You are in C:\\project\nDo you trust?', 770);

  // After trust approval, active work at t=1.3-2.8 (streaming chars)
  sim.onChunk('\x1b[H\x1b[2J\x1b[1;1H\u203A Say hello\x1b[?25l', 1310);
  sim.onChunk('\x1b[1;1H\x1b[1mOpenAI Codex (v0.118.0)\x1b[0m', 1320);
  sim.onChunk('\x1b[1;1HTip: New Build faster\n\u203A Say hello\n• Working (0s)', 1330);
  // Character-by-character streaming (real behavior)
  sim.onChunk('\x1b[5;1H\x1b[0mW', 1860);
  sim.onChunk('\x1b[5;1H\x1b[0m\u25E6Wo', 1950);
  sim.onChunk('\x1b[5;3H\x1b[0mor', 2040);
  sim.onChunk('\x1b[5;5H\x1b[0mrk', 2080);
  sim.onChunk('\x1b[5;7H\x1b[0mki', 2170);
  sim.onChunk('\x1b[5;9H\x1b[0min', 2230);
  sim.onChunk('\x1b[5;11H\x1b[0mng', 2330);
  sim.onChunk('\x1b[5;13H\x1b[0m1', 2360);

  // Final output at t=2.84-2.87
  sim.onChunk('\x1b[5;1H\x1b[0m\u2022 hello\n\n\u2022 Working (1s)\n\n\u203A Explain this codebase', 2840);
  sim.onChunk('\x1b[8;1H\u203A Explain this codebase\ngpt-5.3-codex medium \u00B7 100% left', 2870);

  // Then COMPLETE SILENCE (empirically verified)
  assert(sim.state === 'thinking', `Expected thinking during active work`);

  // Silence timer fires at t=2870 + 10000 = 12870
  sim.checkTimer(10000);
  assert(sim.state === 'thinking', `Expected thinking at 10s`);
  sim.checkTimer(12000);
  assert(sim.state === 'thinking', `Expected thinking at 12s`);
  sim.checkTimer(12870);
  assert(sim.state === 'idle', `Expected idle at 12.87s (last output + 10s), got ${sim.state}`);
});

// Summary
console.log('\n=== Summary ===');
const total = passed + failed;
if (failed === 0) {
  console.log(`ALL ${total} TESTS PASSED`);
  console.log('');
  console.log('Approach validated:');
  console.log('  1. No detectIdle for Codex (guillemet is not idle-specific)');
  console.log('  2. Silence timer (10s) fires reliably after Codex goes silent');
  console.log('  3. Content dedup filters repeated TUI frames (safety net)');
  console.log('  4. ANSI-only chunks are filtered (stripped to empty)');
  console.log('  5. Character-by-character streaming correctly resets timer');
  process.exit(0);
} else {
  console.log(`${failed}/${total} TESTS FAILED`);
  process.exit(1);
}
