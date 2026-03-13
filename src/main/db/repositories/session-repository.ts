import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { SessionRecord, SessionRecordStatus, SessionSummary, SuspendedBy } from '../../../shared/types';

/** Fields accepted by insert(). Excludes `id` (auto-generated) and metric columns (set via updateMetrics). */
type SessionInsertInput = Omit<SessionRecord,
  'id' | 'total_cost_usd' | 'total_input_tokens' | 'total_output_tokens' | 'model_id' | 'model_display_name' | 'total_duration_ms' | 'tool_call_count' | 'lines_added' | 'lines_removed' | 'files_changed'
>;

export interface SessionMetricsInput {
  totalCostUsd: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  modelId: string | null;
  modelDisplayName: string | null;
  totalDurationMs: number | null;
  toolCallCount: number | null;
}

export class SessionRepository {
  constructor(private db: Database.Database) {}

  insert(record: SessionInsertInput): SessionRecord {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO sessions (id, task_id, session_type, claude_session_id, command, cwd, permission_mode, prompt, status, exit_code, started_at, suspended_at, exited_at, suspended_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      record.task_id,
      record.session_type,
      record.claude_session_id,
      record.command,
      record.cwd,
      record.permission_mode,
      record.prompt,
      record.status,
      record.exit_code,
      record.started_at,
      record.suspended_at,
      record.exited_at,
      record.suspended_by,
    );
    return {
      id,
      ...record,
      total_cost_usd: null,
      total_input_tokens: null,
      total_output_tokens: null,
      model_id: null,
      model_display_name: null,
      total_duration_ms: null,
      tool_call_count: null,
      lines_added: null,
      lines_removed: null,
      files_changed: null,
    };
  }

  updateStatus(
    id: string,
    status: SessionRecordStatus,
    extra?: { exit_code?: number; suspended_at?: string; exited_at?: string; suspended_by?: SuspendedBy | null },
  ): void {
    const sets = ['status = ?'];
    const params: unknown[] = [status];

    if (extra?.exit_code !== undefined) {
      sets.push('exit_code = ?');
      params.push(extra.exit_code);
    }
    if (extra?.suspended_at !== undefined) {
      sets.push('suspended_at = ?');
      params.push(extra.suspended_at);
    }
    if (extra?.exited_at !== undefined) {
      sets.push('exited_at = ?');
      params.push(extra.exited_at);
    }
    if (extra?.suspended_by !== undefined) {
      sets.push('suspended_by = ?');
      params.push(extra.suspended_by);
    }

    params.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  /** Get suspended claude_agent sessions that can be resumed */
  getResumable(): SessionRecord[] {
    return this.db.prepare(
      `SELECT * FROM sessions WHERE status = 'suspended' AND session_type = 'claude_agent'`
    ).all() as SessionRecord[];
  }

  /** Mark all currently 'running' sessions as 'orphaned' (crash recovery) */
  markAllRunningAsOrphaned(): void {
    this.db.prepare(
      `UPDATE sessions SET status = 'orphaned' WHERE status = 'running'`
    ).run();
  }

  /**
   * Mark 'running' sessions as 'orphaned', but SKIP records whose task_id
   * is in the exclusion set. This prevents re-entrant recovery calls (e.g.
   * Vite hot-reload) from orphaning sessions that are actively running.
   */
  markRunningAsOrphanedExcluding(excludeTaskIds: Set<string>): void {
    if (excludeTaskIds.size === 0) {
      this.markAllRunningAsOrphaned();
      return;
    }
    const ids = Array.from(excludeTaskIds);
    const placeholders = ids.map(() => '?').join(', ');
    this.db.prepare(
      `UPDATE sessions SET status = 'orphaned' WHERE status = 'running' AND task_id NOT IN (${placeholders})`
    ).run(...ids);
  }

  /** Get orphaned claude_agent sessions */
  getOrphaned(): SessionRecord[] {
    return this.db.prepare(
      `SELECT * FROM sessions WHERE status = 'orphaned' AND session_type = 'claude_agent'`
    ).all() as SessionRecord[];
  }

  /** Delete all session records for a given task */
  deleteByTaskId(taskId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE task_id = ?').run(taskId);
  }

  /** Find the latest session record for a given task */
  getLatestForTask(taskId: string): SessionRecord | undefined {
    return this.db.prepare(
      `SELECT * FROM sessions WHERE task_id = ? ORDER BY started_at DESC LIMIT 1`
    ).get(taskId) as SessionRecord | undefined;
  }

  /** Get task IDs whose latest session was user-paused (for reconciliation). */
  getUserPausedTaskIds(): Set<string> {
    const rows = this.db.prepare(`
      SELECT s.task_id FROM sessions s
      INNER JOIN (
        SELECT task_id, MAX(started_at) as max_started_at
        FROM sessions GROUP BY task_id
      ) latest ON s.task_id = latest.task_id AND s.started_at = latest.max_started_at
      WHERE s.status = 'suspended' AND s.suspended_by = 'user'
    `).all() as Array<{ task_id: string }>;
    return new Set(rows.map(r => r.task_id));
  }

  /** Get all distinct Claude session IDs (for stale directory cleanup). */
  listAllClaudeSessionIds(): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT claude_session_id FROM sessions WHERE claude_session_id IS NOT NULL`
    ).all() as Array<{ claude_session_id: string }>;
    return rows.map(r => r.claude_session_id);
  }

  /** Update the 7 metric columns for a session record. */
  updateMetrics(id: string, metrics: SessionMetricsInput): void {
    this.db.prepare(`
      UPDATE sessions SET
        total_cost_usd = ?,
        total_input_tokens = ?,
        total_output_tokens = ?,
        model_id = ?,
        model_display_name = ?,
        total_duration_ms = ?,
        tool_call_count = ?
      WHERE id = ?
    `).run(
      metrics.totalCostUsd,
      metrics.totalInputTokens,
      metrics.totalOutputTokens,
      metrics.modelId,
      metrics.modelDisplayName,
      metrics.totalDurationMs,
      metrics.toolCallCount,
      id,
    );
  }

  /** Update git diff stats for a session record. */
  updateGitStats(id: string, stats: { linesAdded: number; linesRemoved: number; filesChanged: number }): void {
    this.db.prepare(`
      UPDATE sessions SET lines_added = ?, lines_removed = ?, files_changed = ?
      WHERE id = ?
    `).run(stats.linesAdded, stats.linesRemoved, stats.filesChanged, id);
  }

  /** Get session summary for a task (latest session with metrics). Returns null if no metrics. */
  getSummaryForTask(taskId: string): SessionSummary | null {
    const record = this.db.prepare(
      `SELECT * FROM sessions WHERE task_id = ? AND total_cost_usd IS NOT NULL ORDER BY started_at DESC LIMIT 1`
    ).get(taskId) as SessionRecord | undefined;
    if (!record) return null;
    return this.recordToSummary(record);
  }

  /** Get summaries for all tasks that have metric data, keyed by task_id. */
  listAllSummaries(): Record<string, SessionSummary> {
    const rows = this.db.prepare(
      `SELECT * FROM sessions WHERE total_cost_usd IS NOT NULL ORDER BY started_at DESC`
    ).all() as SessionRecord[];

    const result: Record<string, SessionSummary> = {};
    for (const row of rows) {
      // Keep only the latest session per task (first seen wins since sorted DESC)
      if (!result[row.task_id]) {
        result[row.task_id] = this.recordToSummary(row);
      }
    }
    return result;
  }

  private recordToSummary(record: SessionRecord): SessionSummary {
    return {
      sessionId: record.claude_session_id ?? record.id,
      totalCostUsd: record.total_cost_usd ?? 0,
      totalInputTokens: record.total_input_tokens ?? 0,
      totalOutputTokens: record.total_output_tokens ?? 0,
      modelDisplayName: record.model_display_name ?? '',
      durationMs: record.total_duration_ms ?? 0,
      toolCallCount: record.tool_call_count ?? 0,
      linesAdded: record.lines_added ?? 0,
      linesRemoved: record.lines_removed ?? 0,
      filesChanged: record.files_changed ?? 0,
      startedAt: record.started_at,
      // Use suspended_at as fallback -- sessions moved to Done are suspended, not exited
      exitedAt: record.exited_at ?? record.suspended_at,
      exitCode: record.exit_code,
    };
  }
}
