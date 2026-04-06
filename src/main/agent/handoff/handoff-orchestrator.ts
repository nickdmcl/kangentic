import type { Task, SessionRecord, SessionEvent } from '../../../shared/types';
import type { SessionRepository } from '../../db/repositories/session-repository';
import type { TranscriptRepository } from '../../db/repositories/transcript-repository';
import type { HandoffRepository } from '../../db/repositories/handoff-repository';
import { extractContext } from './context-extractor';
import { renderHandoffMarkdown } from './markdown-renderer';
import { buildHandoffPromptPrefix } from './prompt-builder';

export interface HandoffParams {
  task: Task;
  sourceAgent: string;
  targetAgent: string;
  projectRoot: string;
  baseBranch: string;
  /** Events from UsageTracker cache (already in memory). */
  events: SessionEvent[] | null;
}

export interface HandoffResult {
  handoffId: string;
  promptPrefix: string;
  /** Rendered markdown content for handoff-context.md. Written to disk by the caller after spawn. */
  markdown: string;
}

/**
 * Top-level coordinator for cross-agent context handoff.
 *
 * Called when a task moves to a column with a different agent_override.
 * Extracts context from the source session, stores the handoff record,
 * and returns delivery artifacts. The caller is responsible for writing
 * handoff-context.md to the target session directory after spawn (when
 * the real session dir is known).
 */
export class HandoffOrchestrator {
  constructor(
    private sessionRepo: SessionRepository,
    private transcriptRepo: TranscriptRepository,
    private handoffRepo: HandoffRepository,
  ) {}

  /**
   * Prepare a context handoff from one agent to another.
   *
   * Steps:
   * 1. Read transcript from DB
   * 2. Extract context (git + events + transcript + metrics)
   * 3. Build ContextPacket
   * 4. Store in handoffs table (to_session_id filled later by caller)
   * 5. Build prompt prefix and markdown (returned in memory, not written to disk)
   */
  async prepareHandoff(params: HandoffParams): Promise<HandoffResult> {
    const { task, sourceAgent, targetAgent, projectRoot, baseBranch, events } = params;

    // Get the latest session record for the source agent
    const sourceSessionRecord = this.sessionRepo.getLatestForTask(task.id) ?? null;

    // Extract context from all sources
    const packet = await extractContext({
      task,
      sourceSessionRecord,
      sourceAgent,
      targetAgent,
      projectRoot,
      baseBranch,
      events,
      transcriptRepo: this.transcriptRepo,
    });

    // Store the handoff record (transcript is in session_transcripts table,
    // so we exclude it from packet_json to avoid duplication)
    const packetForStorage = { ...packet, transcript: null };
    const handoffRecord = this.handoffRepo.insert({
      task_id: task.id,
      from_session_id: sourceSessionRecord?.id ?? null,
      to_session_id: null, // Filled after target agent spawns
      from_agent: sourceAgent,
      to_agent: targetAgent,
      trigger: 'column_transition',
      packet_json: JSON.stringify(packetForStorage),
    });

    // Render the markdown for handoff-context.md (returned in memory)
    const markdown = renderHandoffMarkdown(packet);

    // The actual handoff-context.md is written by the caller after spawn
    // into .kangentic/sessions/<agentSessionId>/handoff-context.md.
    // At this point the session ID isn't known yet, so we use a
    // placeholder that the caller replaces after spawn.
    const contextFilePath = '{{handoffContextPath}}';
    const promptPrefix = buildHandoffPromptPrefix(packet, contextFilePath);

    return {
      handoffId: handoffRecord.id,
      promptPrefix,
      markdown,
    };
  }

  /**
   * Update the handoff record with the target session ID after spawn.
   */
  linkTargetSession(handoffId: string, targetSessionId: string): void {
    this.handoffRepo.updateToSession(handoffId, targetSessionId);
  }
}
