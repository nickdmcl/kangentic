import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { HandoffRecord } from '../../../shared/types';

/** Full DB row including the large packet_json blob (not exposed via IPC). */
export interface HandoffRecordFull extends HandoffRecord {
  packet_json: string;
}

export class HandoffRepository {
  constructor(private db: Database.Database) {}

  /**
   * Insert a new handoff record. The to_session_id is initially NULL
   * and filled after the target agent spawns.
   */
  insert(record: Omit<HandoffRecordFull, 'id' | 'created_at'>): HandoffRecordFull {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO handoffs (id, task_id, from_session_id, to_session_id, from_agent, to_agent, trigger, packet_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      record.task_id,
      record.from_session_id,
      record.to_session_id,
      record.from_agent,
      record.to_agent,
      record.trigger,
      record.packet_json,
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
   * Returns the full chain including the packet JSON.
   */
  listByTaskId(taskId: string): HandoffRecordFull[] {
    return this.db.prepare(
      'SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at',
    ).all(taskId) as HandoffRecordFull[];
  }

  /**
   * List handoffs for a task without the large packet_json column.
   * Used for IPC responses to the renderer where only metadata is needed.
   */
  listSummaryByTaskId(taskId: string): HandoffRecord[] {
    return this.db.prepare(
      'SELECT id, task_id, from_session_id, to_session_id, from_agent, to_agent, trigger, created_at FROM handoffs WHERE task_id = ? ORDER BY created_at',
    ).all(taskId) as HandoffRecord[];
  }

  /**
   * Get the most recent handoff for a task.
   */
  getLatestForTask(taskId: string): HandoffRecordFull | null {
    return this.db.prepare(
      'SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(taskId) as HandoffRecordFull | null;
  }

  /**
   * Forward lookup: where did this session's context go?
   */
  getByFromSession(sessionId: string): HandoffRecord | null {
    return this.db.prepare(
      'SELECT * FROM handoffs WHERE from_session_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(sessionId) as HandoffRecord | null;
  }

  /**
   * Backward lookup: where did this session's context come from?
   */
  getByToSession(sessionId: string): HandoffRecord | null {
    return this.db.prepare(
      'SELECT * FROM handoffs WHERE to_session_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(sessionId) as HandoffRecord | null;
  }
}
