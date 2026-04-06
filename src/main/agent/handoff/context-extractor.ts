import simpleGit from 'simple-git';
import { randomUUID } from 'node:crypto';
import type { Task, SessionRecord, SessionEvent } from '../../../shared/types';
import type { TranscriptRepository } from '../../db/repositories/transcript-repository';
import {
  CONTEXT_PACKET_VERSION,
  type ContextPacket,
  type CodeReference,
  type HandoffMetrics,
} from './context-packet';

export interface ExtractionInput {
  task: Task;
  sourceSessionRecord: SessionRecord | null;
  sourceAgent: string;
  targetAgent: string;
  projectRoot: string;
  baseBranch: string;
  /** Events from UsageTracker cache (already in memory). */
  events: SessionEvent[] | null;
  /** Transcript repository for reading persisted PTY output. */
  transcriptRepo: TranscriptRepository | null;
}

/**
 * Build a ContextPacket from existing session data.
 *
 * Entirely read-only and mechanical: no LLM calls, no network, no side effects.
 * All data sources are optional - missing sources produce null fields, never errors.
 */
export async function extractContext(input: ExtractionInput): Promise<ContextPacket> {
  const { task, sourceSessionRecord, sourceAgent, targetAgent, projectRoot, baseBranch } = input;

  // Run git operations in parallel (both are independent)
  const [gitSummary, transcript] = await Promise.all([
    extractGitSummary(projectRoot, baseBranch),
    extractTranscript(input.transcriptRepo, sourceSessionRecord),
  ]);

  const metrics = extractMetrics(sourceSessionRecord);

  return {
    version: CONTEXT_PACKET_VERSION,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    source: {
      agent: sourceAgent,
      agentSessionId: sourceSessionRecord?.agent_session_id ?? null,
      modelId: sourceSessionRecord?.model_id ?? null,
    },
    target: {
      agent: targetAgent,
    },
    task: {
      id: task.id,
      displayId: task.display_id,
      title: task.title,
      description: task.description,
      branchName: task.branch_name,
      worktreePath: task.worktree_path,
      baseBranch: task.base_branch,
      labels: task.labels ?? [],
    },
    gitSummary,
    transcript,
    events: input.events,
    metrics,
    continuation: null,
  };
}

/**
 * Extract git changes from the task branch.
 * Returns commit messages, file change statistics, and the full diff patch.
 * Best-effort: returns empty/null on failure.
 */
async function extractGitSummary(
  projectRoot: string,
  baseBranch: string,
): Promise<ContextPacket['gitSummary']> {
  const empty: ContextPacket['gitSummary'] = {
    commitMessages: [],
    filesChanged: [],
    diffPatch: null,
  };

  try {
    const git = simpleGit(projectRoot);

    // Find the merge-base (fork point) for accurate diffs
    let mergeBase: string;
    try {
      const mergeBaseResult = await git.raw(['merge-base', baseBranch, 'HEAD']);
      mergeBase = mergeBaseResult.trim();
    } catch {
      // Base branch doesn't exist - fall back to showing nothing
      return empty;
    }

    // Run git operations in parallel (diff stat + log only; raw patch is
    // omitted because the receiving agent can run `git diff` itself)
    const [diffSummaryResult, logResult] = await Promise.all([
      git.diffSummary([mergeBase]).catch(() => null),
      git.log({ from: mergeBase, to: 'HEAD' }).catch(() => null),
    ]);

    const commitMessages = logResult?.all.map((commit) => commit.message) ?? [];

    const filesChanged: CodeReference[] = diffSummaryResult?.files.map((file) => {
      const insertions = file.binary ? 0 : ('insertions' in file ? file.insertions : 0);
      const deletions = file.binary ? 0 : ('deletions' in file ? file.deletions : 0);
      return {
        relativePath: file.file,
        status: inferFileStatus(insertions, deletions),
        insertions,
        deletions,
      };
    }) ?? [];

    return {
      commitMessages,
      filesChanged,
      diffPatch: null,
    };
  } catch (error) {
    console.error('[context-extractor] Git extraction failed:', error);
    return empty;
  }
}

/**
 * Read the persisted transcript from the database.
 */
async function extractTranscript(
  transcriptRepo: TranscriptRepository | null,
  sessionRecord: SessionRecord | null,
): Promise<string | null> {
  if (!transcriptRepo || !sessionRecord) return null;

  try {
    return transcriptRepo.getTranscriptText(sessionRecord.id);
  } catch (error) {
    console.error('[context-extractor] Transcript read failed:', error);
    return null;
  }
}

/**
 * Extract session metrics from the DB record.
 */
export function extractMetrics(sessionRecord: SessionRecord | null): HandoffMetrics | null {
  if (!sessionRecord) return null;

  return {
    totalCostUsd: sessionRecord.total_cost_usd ?? 0,
    totalInputTokens: sessionRecord.total_input_tokens ?? 0,
    totalOutputTokens: sessionRecord.total_output_tokens ?? 0,
    durationMs: sessionRecord.total_duration_ms ?? 0,
    toolCallCount: sessionRecord.tool_call_count ?? 0,
    linesAdded: sessionRecord.lines_added ?? 0,
    linesRemoved: sessionRecord.lines_removed ?? 0,
    filesChanged: sessionRecord.files_changed ?? 0,
  };
}

/**
 * Infer file status from insertions/deletions when git --name-status is not available.
 */
export function inferFileStatus(insertions: number, deletions: number): CodeReference['status'] {
  if (insertions > 0 && deletions === 0) return 'A';
  if (insertions === 0 && deletions > 0) return 'D';
  return 'M';
}
