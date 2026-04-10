import { HandoffRepository } from '../../db/repositories/handoff-repository';
import { TaskRepository } from '../../db/repositories/task-repository';
import { resolveTask } from './task-resolver';
import type { CommandContext, CommandResponse } from './types';

/**
 * MCP command handler: get_handoff_context
 *
 * Returns the handoff record for a task - the session history file path
 * and metadata from the most recent handoff. Agents can call this to
 * discover the prior agent's native session file.
 */
export function handleGetHandoffContext(
  params: Record<string, unknown>,
  context: CommandContext,
): CommandResponse {
  const rawTaskId = params.taskId as string | undefined;

  if (!rawTaskId) {
    return { success: false, error: 'taskId is required' };
  }

  try {
    const db = context.getProjectDb();
    const tasks = new TaskRepository(db);
    const task = resolveTask(tasks, rawTaskId);
    if (!task) {
      return { success: false, error: `Task not found: ${rawTaskId}` };
    }
    const taskId = task.id;

    const handoffRepo = new HandoffRepository(db);
    const latestHandoff = handoffRepo.getLatestForTask(taskId);

    if (!latestHandoff) {
      return { success: true, message: 'No handoff history for this task.' };
    }

    const lines: string[] = [];
    lines.push(`Handoff from ${latestHandoff.from_agent} to ${latestHandoff.to_agent} at ${latestHandoff.created_at}`);
    lines.push(`Task: ${task.title}`);

    if (latestHandoff.session_history_path) {
      lines.push(`Session history file: ${latestHandoff.session_history_path}`);
    } else {
      lines.push('No session history file available for the prior session.');
    }

    return {
      success: true,
      message: lines.join('\n'),
      data: {
        handoffId: latestHandoff.id,
        fromAgent: latestHandoff.from_agent,
        toAgent: latestHandoff.to_agent,
        fromSessionId: latestHandoff.from_session_id,
        toSessionId: latestHandoff.to_session_id,
        sessionHistoryPath: latestHandoff.session_history_path,
        createdAt: latestHandoff.created_at,
      },
    };
  } catch (error) {
    return { success: false, error: `Failed to get handoff context: ${error instanceof Error ? error.message : String(error)}` };
  }
}
