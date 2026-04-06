#!/usr/bin/env node
/**
 * Event Bridge for Claude Code hooks → Kangentic Activity Log
 *
 * Claude Code invokes this script via hooks. Appends a single JSON line
 * to the events log.
 *
 * Usage:
 *   node event-bridge.js <events-file-path> <event-type>
 *
 * Event types:
 *   tool_start      -- from PreToolUse hook (reads tool name + input from stdin)
 *   tool_end        -- from PostToolUse hook (reads tool name from stdin)
 *   tool_failure    -- from PostToolUseFailure hook (reads tool name + is_interrupt from stdin)
 *   prompt          -- from UserPromptSubmit hook
 *   idle            -- from Stop / PermissionRequest hooks
 *   session_start   -- from SessionStart hook
 *   session_end     -- from SessionEnd hook
 *   subagent_start  -- from SubagentStart hook (reads agent_type from stdin)
 *   subagent_stop   -- from SubagentStop hook (reads agent_type from stdin)
 *   notification    -- from Notification hook (reads message from stdin)
 *   compact         -- from PreCompact hook
 *   teammate_idle   -- from TeammateIdle hook
 *   task_completed  -- from TaskCompleted hook
 *   config_change   -- from ConfigChange hook
 *   worktree_create -- from WorktreeCreate hook (reads name/path from stdin)
 *   worktree_remove -- from WorktreeRemove hook (reads name/path from stdin)
 *
 * Stdin: Claude Code pipes hook context as JSON. We parse it to extract
 * relevant fields for each event type.
 */
const fs = require('fs');
const outputPath = process.argv[2];
const eventType = process.argv[3] || 'idle';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  if (!outputPath) return;

  const event = { ts: Date.now(), type: eventType };

  // Parse stdin JSON to extract tool info
  if (eventType === 'tool_failure') {
    try {
      const ctx = JSON.parse(input);
      event.type = ctx.is_interrupt ? 'interrupted' : 'tool_end';
      if (ctx.tool_name) event.tool = ctx.tool_name;
      if (event.type === 'interrupted' && ctx.error) {
        event.detail = String(ctx.error).slice(0, 200);
      }
    } catch {
      event.type = 'tool_end';
    }
  } else if (eventType === 'tool_start' || eventType === 'tool_end') {
    try {
      const ctx = JSON.parse(input);
      // Claude Code hook context has tool_name at top level
      if (ctx.tool_name) event.tool = ctx.tool_name;
      // Extract a short detail from the tool input (first useful field)
      if (eventType === 'tool_start' && ctx.tool_input) {
        const ti = ctx.tool_input;
        // Common tool input patterns: file_path, command, query, pattern
        const detail = ti.file_path || ti.command || ti.query || ti.pattern
          || ti.url || ti.description || ti.content?.slice?.(0, 80);
        if (detail) event.detail = String(detail).slice(0, 200);
      }
    } catch {
      // Stdin wasn't valid JSON -- still write the event without tool info
    }
  } else if (eventType === 'subagent_start' || eventType === 'subagent_stop') {
    try {
      const ctx = JSON.parse(input);
      const detail = ctx.agent_type || ctx.subagent_type;
      if (detail) event.detail = String(detail).slice(0, 200);
    } catch { /* best effort */ }
  } else if (eventType === 'notification') {
    try {
      const ctx = JSON.parse(input);
      const detail = ctx.message || ctx.notification;
      if (detail) event.detail = String(detail).slice(0, 200);
    } catch { /* best effort */ }
  } else if (eventType === 'worktree_create' || eventType === 'worktree_remove') {
    try {
      const ctx = JSON.parse(input);
      const detail = ctx.name || ctx.path;
      if (detail) event.detail = String(detail).slice(0, 200);
    } catch { /* best effort */ }
  } else if (eventType === 'task_completed') {
    try {
      const ctx = JSON.parse(input);
      const detail = ctx.task || ctx.description || ctx.name;
      if (detail) event.detail = String(detail).slice(0, 200);
    } catch { /* best effort */ }
  } else if (eventType === 'teammate_idle') {
    try {
      const ctx = JSON.parse(input);
      const detail = ctx.agent || ctx.teammate || ctx.name;
      if (detail) event.detail = String(detail).slice(0, 200);
    } catch { /* best effort */ }
  } else if (eventType === 'idle') {
    const reason = process.argv[4];
    if (reason) event.detail = String(reason).slice(0, 200);
  }

  // Include raw hook stdin as hookContext for adapter-specific session ID extraction.
  // Only on session_start events (where the ID first appears) to avoid bloating
  // the JSONL file on every hook invocation. Truncated to 2KB for safety.
  if (eventType === 'session_start' && input && input.length > 0) {
    event.hookContext = input.slice(0, 2048);
  }

  try {
    fs.appendFileSync(outputPath, JSON.stringify(event) + '\n');
  } catch {
    // Best effort -- file may be locked or path may not exist
  }
});
