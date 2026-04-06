import type { SessionEvent } from '../../../shared/types';

/** Schema version for forward compatibility. Increment on breaking changes. */
export const CONTEXT_PACKET_VERSION = 1;

/**
 * Portable, agent-agnostic context packet for cross-agent handoff.
 *
 * Contains the full context of a source agent's session: task metadata,
 * git changes, session transcript, structured events, and metrics.
 * No lossy compression - the receiving agent gets everything and decides
 * what's relevant.
 */
export interface ContextPacket {
  version: typeof CONTEXT_PACKET_VERSION;
  id: string;
  createdAt: string;

  /** Which agent produced this context. */
  source: HandoffSource;

  /** Which agent will consume this context. */
  target: HandoffTarget;

  /** Task metadata. */
  task: HandoffTaskMeta;

  /** Git changes on the task branch (base...HEAD). */
  gitSummary: GitSummary;

  /**
   * Full session transcript (ANSI-stripped PTY output).
   * Null if no transcript was captured (e.g. session had no output).
   * Note: stored in session_transcripts table, not in packet_json column.
   * Joined at read time.
   */
  transcript: string | null;

  /** Structured events from events.jsonl (tool calls, prompts, etc.). */
  events: SessionEvent[] | null;

  /** Session metrics from the source session record. */
  metrics: HandoffMetrics | null;

  /** Future state machine hook for complex multi-step handoffs. */
  continuation: ContinuationState | null;
}

export interface HandoffSource {
  /** Agent identifier: 'claude', 'gemini', 'codex', 'aider'. */
  agent: string;
  /** Agent's internal session ID (e.g. Claude's JSONL transcript UUID). */
  agentSessionId: string | null;
  /** Model identifier from status.json (e.g. 'claude-opus-4-6'). */
  modelId: string | null;
}

export interface HandoffTarget {
  /** Agent identifier: 'claude', 'gemini', 'codex', 'aider'. */
  agent: string;
}

export interface HandoffTaskMeta {
  id: string;
  displayId: number;
  title: string;
  description: string;
  branchName: string | null;
  worktreePath: string | null;
  baseBranch: string | null;
  labels: string[];
}

export interface GitSummary {
  /** Commit messages from git log base...HEAD. */
  commitMessages: string[];
  /** Per-file change statistics from git diff --stat. */
  filesChanged: CodeReference[];
  /** Full git diff patch content. Null if diff failed or was empty. */
  diffPatch: string | null;
}

/** A reference to a changed file in the git diff. */
export interface CodeReference {
  /** Path relative to the repository root. */
  relativePath: string;
  /** Git status: Added, Modified, Deleted, Renamed. */
  status: 'A' | 'M' | 'D' | 'R';
  /** Number of lines added. */
  insertions: number;
  /** Number of lines removed. */
  deletions: number;
}

export interface HandoffMetrics {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  durationMs: number;
  toolCallCount: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
}

/**
 * Continuation state for future state machine handoffs.
 * The handoff system stores and delivers this opaquely -
 * the state machine defines the semantics.
 */
export interface ContinuationState {
  /** Current workflow phase (e.g. 'planning', 'implementation', 'review'). */
  phase: string;
  /** Steps that have been completed. */
  completedSteps: string[];
  /** Steps that remain to be done. */
  pendingSteps: string[];
  /** Arbitrary state machine data. */
  metadata: Record<string, unknown>;
}
