import { HandoffRepository } from '../../db/repositories/handoff-repository';
import { TranscriptRepository } from '../../db/repositories/transcript-repository';
import { SessionRepository } from '../../db/repositories/session-repository';
import { TaskRepository } from '../../db/repositories/task-repository';
import { resolveTask } from './task-resolver';
import type { CommandContext, CommandResponse } from './types';
import type { ContextPacket } from '../handoff/context-packet';

/**
 * MCP command handler: get_handoff_context
 *
 * Returns the handoff context for a task - the full context packet from the
 * most recent handoff, including the session transcript. Agents can call this
 * to get structured access to prior work without reading the markdown file.
 */
export function handleGetHandoffContext(
  params: Record<string, unknown>,
  context: CommandContext,
): CommandResponse {
  const rawTaskId = params.taskId as string | undefined;
  const section = (params.section as string | undefined) ?? 'all';

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

    // Parse the stored packet and enrich with transcript
    const packet: ContextPacket = JSON.parse(latestHandoff.packet_json);

    // The transcript is stored separately - join it in
    if (latestHandoff.from_session_id) {
      const transcriptRepo = new TranscriptRepository(db);
      const transcript = transcriptRepo.getTranscriptText(latestHandoff.from_session_id);
      packet.transcript = transcript;
    }

    // Return the requested section
    if (section === 'all') {
      return {
        success: true,
        message: formatFullHandoffContext(packet, latestHandoff.from_agent, latestHandoff.to_agent),
        data: packet,
      };
    }

    if (section === 'decisions') {
      return {
        success: true,
        message: formatGitSection(packet),
      };
    }

    if (section === 'changes') {
      return {
        success: true,
        message: formatChangesSection(packet),
      };
    }

    if (section === 'transcript') {
      return {
        success: true,
        message: packet.transcript ?? 'No transcript available.',
      };
    }

    if (section === 'metrics') {
      return {
        success: true,
        message: formatMetricsSection(packet),
      };
    }

    return { success: false, error: `Unknown section: ${section}. Use: all, decisions, changes, transcript, metrics` };
  } catch (error) {
    return { success: false, error: `Failed to get handoff context: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function formatFullHandoffContext(packet: ContextPacket, fromAgent: string, toAgent: string): string {
  const lines: string[] = [];
  lines.push(`Handoff from ${fromAgent} to ${toAgent} at ${packet.createdAt}`);
  lines.push(`Task: ${packet.task.title}`);
  if (packet.task.branchName) lines.push(`Branch: ${packet.task.branchName}`);
  lines.push('');

  if (packet.metrics) {
    lines.push(formatMetricsSection(packet));
    lines.push('');
  }

  if (packet.gitSummary.commitMessages.length > 0) {
    lines.push(formatGitSection(packet));
    lines.push('');
  }

  if (packet.gitSummary.filesChanged.length > 0) {
    lines.push(formatChangesSection(packet));
    lines.push('');
  }

  if (packet.transcript) {
    lines.push('## Session Transcript');
    lines.push(packet.transcript);
  }

  return lines.join('\n');
}

function formatGitSection(packet: ContextPacket): string {
  if (packet.gitSummary.commitMessages.length === 0) return 'No commits on this branch.';
  const lines = ['## Commits'];
  for (const message of packet.gitSummary.commitMessages) {
    lines.push(`- ${message}`);
  }
  return lines.join('\n');
}

function formatChangesSection(packet: ContextPacket): string {
  if (packet.gitSummary.filesChanged.length === 0) return 'No files changed.';
  const lines = ['## Files Changed'];
  for (const file of packet.gitSummary.filesChanged) {
    lines.push(`- ${file.relativePath} (${file.status}) +${file.insertions} -${file.deletions}`);
  }
  return lines.join('\n');
}

function formatMetricsSection(packet: ContextPacket): string {
  if (!packet.metrics) return 'No metrics available.';
  const metrics = packet.metrics;
  const lines = ['## Session Metrics'];
  if (metrics.durationMs > 0) {
    const minutes = Math.floor(metrics.durationMs / 60000);
    const seconds = Math.floor((metrics.durationMs % 60000) / 1000);
    lines.push(`- Duration: ${minutes}m ${seconds}s`);
  }
  if (metrics.totalCostUsd > 0) lines.push(`- Cost: $${metrics.totalCostUsd.toFixed(2)}`);
  if (metrics.toolCallCount > 0) lines.push(`- Tool calls: ${metrics.toolCallCount}`);
  if (metrics.filesChanged > 0) lines.push(`- Files changed: ${metrics.filesChanged} (+${metrics.linesAdded} -${metrics.linesRemoved})`);
  return lines.join('\n');
}
