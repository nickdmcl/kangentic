import { useMemo } from 'react';
import { useSessionStore } from '../stores/session-store';
import type { Task, Session, SessionUsage, ActivityState, SessionDisplayState } from '../../shared/types';

/**
 * Pure derivation of display state from raw session data.
 * Centralizes the boolean logic that was previously scattered
 * across TaskCard, TaskDetailDialog, and TerminalPanel.
 *
 * Display lifecycle:
 *
 *   none → queued → initializing → running → exited
 *                                           → suspended
 *
 * - none:         No session exists for this task
 * - queued:       Waiting for a concurrency slot (no PTY yet)
 * - initializing: PTY spawned, waiting for first usage report from Claude CLI
 * - running:      Claude CLI active with usage data (progress bar visible)
 * - suspended:    Session paused (PTY killed, files preserved for resume)
 * - exited:       PTY process terminated
 */
export function getSessionDisplayState(
  taskSession: Session | undefined,
  usage: SessionUsage | undefined,
  activity: ActivityState | undefined,
): SessionDisplayState {
  if (!taskSession) return { kind: 'none' };

  switch (taskSession.status) {
    case 'exited':
      return { kind: 'exited', exitCode: taskSession.exitCode ?? 0 };
    case 'suspended':
      return { kind: 'suspended' };
    case 'queued':
      return { kind: 'queued' };
    case 'running': {
      // "Initializing" = PTY is running but Claude CLI hasn't reported usage
      // yet (model name, context window %). Hook events may arrive earlier,
      // but they don't carry enough info for the progress bar -- keep showing
      // the "Initializing..." spinner until the first usage report lands.
      if (!usage) {
        return { kind: 'initializing' };
      }
      return {
        kind: 'running',
        activity: activity ?? 'thinking',
        usage,
      };
    }
  }
}

/**
 * React hook that derives SessionDisplayState from store data for a given task.
 * Subscribes to the minimal store slices needed to avoid unnecessary re-renders.
 */
export function useSessionDisplayState(task: Task): SessionDisplayState {
  // Select only this task's session -- avoids re-rendering when unrelated sessions change.
  // Zustand's Object.is check on the returned Session object is stable because the store
  // replaces session objects only when their data actually changes.
  const taskSession = useSessionStore((s) => s.sessions.find((sess) => sess.taskId === task.id));
  const usage = useSessionStore((s) => {
    const id = s.sessions.find((sess) => sess.taskId === task.id)?.id;
    return id ? s.sessionUsage[id] : undefined;
  });
  const activity = useSessionStore((s) => {
    const id = s.sessions.find((sess) => sess.taskId === task.id)?.id;
    return id ? s.sessionActivity[id] : undefined;
  });

  return useMemo(
    () => getSessionDisplayState(taskSession, usage, activity),
    [taskSession, usage, activity],
  );
}
