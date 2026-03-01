import { useSessionStore } from '../stores/session-store';
import type { Task, Session, SessionUsage, ActivityState, SessionEvent, SessionDisplayState } from '../../shared/types';

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
  _events: SessionEvent[] | undefined,
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
      // but they don't carry enough info for the progress bar — keep showing
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
  const sessions = useSessionStore((s) => s.sessions);
  const usage = useSessionStore((s) => task.session_id ? s.sessionUsage[task.session_id] : undefined);
  const activity = useSessionStore((s) => task.session_id ? s.sessionActivity[task.session_id] : undefined);
  const events = useSessionStore((s) => task.session_id ? s.sessionEvents[task.session_id] : undefined);

  // Find session by taskId (more robust than by session_id — catches
  // sessions not yet linked back to the task record, e.g. during resume)
  const taskSession = sessions.find((s) => s.taskId === task.id);

  return getSessionDisplayState(taskSession, usage, activity, events);
}
