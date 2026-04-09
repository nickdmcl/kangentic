#!/usr/bin/env node
/**
 * Validate that Gemini hooks are firing in your real Kangentic install.
 *
 * Usage:
 *   1. Open Kangentic (npm start or your installed build)
 *   2. Spawn a Gemini task in any swimlane (move a task to a column with
 *      a Gemini agent action, or create one fresh)
 *   3. Run this script with the task's session ID:
 *
 *        node scripts/validate-gemini-hooks.js <session-id>
 *
 *      Or pass --latest to auto-pick the most recent Gemini session in
 *      the current project:
 *
 *        node scripts/validate-gemini-hooks.js --latest
 *
 * The script reads the events.jsonl file from the session directory and
 * tells you exactly which hooks fired, with timestamps. If the file is
 * empty, the hook bridge is not working - check the diagnostic output.
 *
 * This is the gold-standard validation: it uses real Gemini auth, real
 * project state, and the real Kangentic hook configuration. If this
 * shows events, hooks work in production.
 */
const fs = require('node:fs');
const path = require('node:path');

function findProjectRoot() {
  // Walk up from CWD looking for .kangentic/sessions/
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.kangentic', 'sessions'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function listSessions(projectRoot) {
  const sessionsDir = path.join(projectRoot, '.kangentic', 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];
  return fs
    .readdirSync(sessionsDir)
    .map((name) => {
      const dir = path.join(sessionsDir, name);
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) return null;
      const eventsPath = path.join(dir, 'events.jsonl');
      const hasEvents = fs.existsSync(eventsPath);
      const eventsSize = hasEvents ? fs.statSync(eventsPath).size : 0;
      return {
        sessionId: name,
        dir,
        eventsPath,
        hasEvents,
        eventsSize,
        mtime: stat.mtimeMs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

function readEvents(eventsPath) {
  if (!fs.existsSync(eventsPath)) return [];
  const raw = fs.readFileSync(eventsPath, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    console.error('ERROR: No .kangentic/sessions/ directory found in CWD or any parent.');
    console.error('Run this script from inside a Kangentic project directory.');
    process.exit(1);
  }

  console.log(`Project root: ${projectRoot}`);

  const sessions = listSessions(projectRoot);
  if (sessions.length === 0) {
    console.error('ERROR: No sessions found in .kangentic/sessions/.');
    console.error('Spawn a task in Kangentic first, then re-run this script.');
    process.exit(1);
  }

  let target;
  if (args[0] === '--latest' || args.length === 0) {
    target = sessions[0];
    console.log(`Using most recent session: ${target.sessionId}`);
  } else {
    target = sessions.find((session) => session.sessionId === args[0]);
    if (!target) {
      console.error(`ERROR: Session "${args[0]}" not found. Available:`);
      for (const session of sessions.slice(0, 10)) {
        const tag = session.hasEvents ? `${session.eventsSize}B` : 'no events.jsonl';
        console.error(`  ${session.sessionId}  (${tag})`);
      }
      process.exit(1);
    }
  }

  console.log(`Session dir: ${target.dir}`);
  console.log(`Events path: ${target.eventsPath}`);
  console.log('');

  if (!target.hasEvents) {
    console.error('FAIL: events.jsonl does NOT exist for this session.');
    console.error('');
    console.error('Diagnostics:');
    console.error('  - Was the session spawned with eventsOutputPath set?');
    console.error('    (Production transition-engine.ts always passes it - check that');
    console.error('     the session record was created via spawnAgent, not registerSuspendedPlaceholder.)');
    console.error('  - Did the agent adapter write its hook config?');
    console.error('    For Gemini, look for .gemini/settings.json in the task cwd');
    console.error('    (worktree path or project root). It should contain "kangentic-" hook entries.');
    process.exit(2);
  }

  const events = readEvents(target.eventsPath);
  console.log(`Events file size: ${target.eventsSize} bytes, parsed ${events.length} events.`);
  console.log('');

  if (events.length === 0) {
    console.error('FAIL: events.jsonl exists but contains zero parseable events.');
    console.error('');
    console.error('Raw contents (first 500 chars):');
    console.error(fs.readFileSync(target.eventsPath, 'utf-8').slice(0, 500));
    process.exit(3);
  }

  // Group by event type for a clean summary.
  const byType = {};
  for (const event of events) {
    byType[event.type] = (byType[event.type] || 0) + 1;
  }

  console.log('Event type breakdown:');
  for (const type of Object.keys(byType).sort()) {
    console.log(`  ${type.padEnd(20)} ${byType[type]}`);
  }
  console.log('');

  console.log('First 5 events (chronological):');
  for (const event of events.slice(0, 5)) {
    const ts = new Date(event.ts).toISOString().slice(11, 23);
    const extras = Object.keys(event)
      .filter((key) => key !== 'ts' && key !== 'type')
      .map((key) => `${key}=${JSON.stringify(event[key])}`)
      .join(' ');
    console.log(`  ${ts}  ${event.type.padEnd(18)} ${extras}`);
  }
  console.log('');

  // Verdict
  const sawSessionStart = byType.session_start > 0;
  const sawTool = Object.keys(byType).some((type) => type.startsWith('tool_'));
  const sawIdle = byType.idle > 0;

  if (sawSessionStart || sawTool || sawIdle) {
    console.log('PASS: Gemini hook bridge is firing events end-to-end.');
    console.log(`  session_start: ${sawSessionStart ? 'yes' : 'no'}`);
    console.log(`  tool_*:        ${sawTool ? 'yes' : 'no'}`);
    console.log(`  idle:          ${sawIdle ? 'yes' : 'no'}`);
    process.exit(0);
  } else {
    console.warn('PARTIAL: events fired but none of the expected types (session_start, tool_*, idle).');
    console.warn('The bridge is wired but Gemini may not be reaching the hook events you expect.');
    process.exit(0);
  }
}

main();
