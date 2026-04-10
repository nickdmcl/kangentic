import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { HandoffRecord } from '../../../shared/types';

export class HandoffRepository {
  constructor(private db: Database.Database) {}

  /**
   * Insert a new handoff record. The to_session_id is initially NULL
   * and filled after the target agent spawns.
   */
  insert(record: Omit<HandoffRecord, 'id' | 'created_at'>): HandoffRecord {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO handoffs (id, task_id, from_session_id, to_session_id, from_agent, to_agent, trigger, session_history_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      record.task_id,
      record.from_session_id,
      record.to_session_id,
      record.from_agent,
      record.to_agent,
      record.trigger,
      record.session_history_path,
      createdAt,
    );
    return { id, ...record, created_at: createdAt };
  }

  /**
   * Fill in the target session ID after the new agent spawns.
   */
  updateToSession(handoffId: string, toSessionId: string): void {
    this.db.prepare(
      'UPDATE handoffs SET to_session_id = ? WHERE id = ?',
    ).run(toSessionId, handoffId);
  }

  /**
   * Get all handoffs for a task, ordered by creation time.
   */
  listByTaskId(taskId: string): HandoffRecord[] {
    return this.db.prepare(
      'SELECT id, task_id, from_session_id, to_session_id, from_agent, to_agent, trigger, session_history_path, created_at FROM handoffs WHERE task_id = ? ORDER BY created_at',
    ).all(taskId) as HandoffRecord[];
  }

  /**
   * Get the most recent handoff for a task.
   */
  getLatestForTask(taskId: string): HandoffRecord | null {
    return this.db.prepare(
      'SELECT id, task_id, from_session_id, to_session_id, from_agent, to_agent, trigger, session_history_path, created_at FROM handoffs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(taskId) as HandoffRecord | null;
  }

  /**
   * Forward lookup: where did this session's context go?
   */
  getByFromSession(sessionId: string): HandoffRecord | null {
    return this.db.prepare(
      'SELECT id, task_id, from_session_id, to_session_id, from_agent, to_agent, trigger, session_history_path, created_at FROM handoffs WHERE from_session_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(sessionId) as HandoffRecord | null;
  }

  /**
   * Backward lookup: where did this session's context come from?
   */
  getByToSession(sessionId: string): HandoffRecord | null {
    return this.db.prepare(
      'SELECT id, task_id, from_session_id, to_session_id, from_agent, to_agent, trigger, session_history_path, created_at FROM handoffs WHERE to_session_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(sessionId) as HandoffRecord | null;
  }
}
