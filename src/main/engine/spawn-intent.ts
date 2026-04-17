/**
 * Spawn intent resolver for agent sessions.
 *
 * Determines whether to resume an existing session or spawn fresh based on
 * agent type. The core simplification: always querying by session_type makes
 * cross-agent resume mismatches structurally impossible (no guard needed).
 *
 * Resume is only attempted when `agent_session_id` is non-null, meaning the
 * real CLI session ID has been captured (pre-specified for Claude, captured
 * from hooks for Gemini/Codex). If the ID was never captured (session killed
 * too fast, or agent doesn't expose it), `agent_session_id` stays null and
 * a fresh session is spawned.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { interpolateTemplate } from '../agent/shared';
import type { SessionRecord } from '../../shared/types';
import type { SessionRepository } from '../db/repositories/session-repository';

export interface SpawnIntent {
  mode: 'resume' | 'fresh';
  agentSessionId: string | null;
  prompt: string | undefined;
  /** Session record to retire when resuming (same agent type only). Null for fresh spawns. */
  retireRecordId: string | null;
}

export interface SpawnIntentOptions {
  taskId: string;
  /** The target adapter's session type (e.g. 'claude_agent', 'codex_agent'). */
  sessionType: string;
  sessionRepo: SessionRepository | null | undefined;
  promptTemplate: string | undefined;
  templateVars: Record<string, string>;
  /** Pre-computed prompt for resumed sessions (typically the auto_command). */
  resumePrompt: string | undefined;
}

/**
 * Check whether a session record is eligible for resume via --resume.
 *
 * Requires a real agent_session_id (captured or pre-specified), excludes
 * run_script sessions (no conversation to resume), and excludes queued
 * sessions (never started, no transcript).
 */
export function isResumeEligible(record: SessionRecord | undefined): boolean {
  return !!record?.agent_session_id
    && record.session_type !== 'run_script'
    && record.status !== 'queued';
}

/**
 * Claude stores conversation transcripts at ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl.
 * If that file is gone (user ran /clear, or Claude garbage-collected it), --resume fails with
 * "No conversation found" and the PTY dies instantly. A DB record with a stale agent_session_id
 * looks resumable to isResumeEligible but will always crash on spawn, so we verify the file
 * exists before committing to a resume.
 */
function claudeConversationFileExists(agentSessionId: string): boolean {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  let entries: string[];
  try {
    entries = fs.readdirSync(projectsDir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (fs.existsSync(path.join(projectsDir, entry, `${agentSessionId}.jsonl`))) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve the spawn strategy for a task and target agent.
 *
 * Looks for a resumable session matching the target agent's session_type
 * that has a captured agent_session_id (real CLI session ID, not a placeholder).
 * If found, returns 'resume' with the agent's session ID.
 * If not, returns 'fresh'.
 *
 * Cross-agent safety is structural: the WHERE clause filters by session_type,
 * so a Claude lookup never finds a Codex session and vice versa.
 */
export function resolveSpawnIntent(options: SpawnIntentOptions): SpawnIntent {
  const { taskId, sessionType, sessionRepo, promptTemplate, templateVars, resumePrompt } = options;

  const match = sessionRepo?.getLatestForTaskByType(taskId, sessionType);
  const canResume = isResumeEligible(match)
    && (match!.session_type !== 'claude_agent'
        || claudeConversationFileExists(match!.agent_session_id!));

  if (canResume) {
    return {
      mode: 'resume',
      agentSessionId: match!.agent_session_id!,
      prompt: resumePrompt,
      retireRecordId: match!.id,
    };
  }

  return {
    mode: 'fresh',
    agentSessionId: null,
    prompt: promptTemplate
      ? interpolateTemplate(promptTemplate, templateVars)
      : undefined,
    retireRecordId: null,
  };
}
