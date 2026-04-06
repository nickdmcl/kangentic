import { TranscriptRepository } from '../../db/repositories/transcript-repository';
import { SessionRepository } from '../../db/repositories/session-repository';
import { TaskRepository } from '../../db/repositories/task-repository';
import { resolveTask } from './task-resolver';
import type { CommandContext, CommandResponse } from './types';

/**
 * MCP command handler: get_transcript
 *
 * Returns the ANSI-stripped session transcript for a task's most recent
 * (or specified) session. Useful for debugging, auditing, and reviewing
 * what an agent actually did.
 */
export function handleGetTranscript(
  params: Record<string, unknown>,
  context: CommandContext,
): CommandResponse {
  const rawTaskId = params.taskId as string | undefined;
  const sessionId = params.sessionId as string | undefined;

  if (!rawTaskId && !sessionId) {
    return { success: false, error: 'Provide either taskId or sessionId.' };
  }

  try {
    const db = context.getProjectDb();
    const transcriptRepo = new TranscriptRepository(db);

    let targetSessionId: string | null = null;

    if (sessionId) {
      targetSessionId = sessionId;
    } else if (rawTaskId) {
      const taskRepo = new TaskRepository(db);
      const task = resolveTask(taskRepo, rawTaskId);
      if (!task) {
        return { success: false, error: `Task not found: ${rawTaskId}` };
      }
      // Use the task's current session, or find the latest from session history
      if (task.session_id) {
        targetSessionId = task.session_id;
      } else {
        const sessionRepo = new SessionRepository(db);
        const latest = sessionRepo.getLatestForTask(task.id);
        if (latest) {
          targetSessionId = latest.id;
        }
      }
    }

    if (!targetSessionId) {
      return { success: true, message: 'No session found for this task.' };
    }

    const record = transcriptRepo.getBySessionId(targetSessionId);
    if (!record || !record.transcript) {
      return { success: true, message: `No transcript captured for session ${targetSessionId.slice(0, 8)}.` };
    }

    const sizeKb = (record.size_bytes / 1024).toFixed(1);
    const header = `Session: ${targetSessionId.slice(0, 8)}... | Size: ${sizeKb} KB | Updated: ${record.updated_at}`;

    return {
      success: true,
      message: `${header}\n\n${record.transcript}`,
      data: {
        sessionId: targetSessionId,
        sizeBytes: record.size_bytes,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      },
    };
  } catch (error) {
    return { success: false, error: `Failed to get transcript: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Maximum rows returned by query_db to prevent accidental large result sets. */
const MAX_QUERY_ROWS = 100;

/**
 * MCP command handler: query_db
 *
 * Runs a read-only SQL query against the current project's SQLite database.
 * Uses SQLite's PRAGMA query_only for bulletproof write protection - no regex
 * bypass is possible because the database engine itself rejects mutations.
 * Returns up to 100 rows in a formatted table.
 */
export function handleQueryDb(
  params: Record<string, unknown>,
  context: CommandContext,
): CommandResponse {
  const sql = (params.sql as string | undefined)?.trim();

  if (!sql) {
    return { success: false, error: 'sql parameter is required.' };
  }

  try {
    const db = context.getProjectDb();

    // Enable query_only mode - SQLite will reject any write operations
    // at the engine level (INSERT, UPDATE, DELETE, DROP, ALTER, etc.).
    // This is safer than regex pattern matching which can be bypassed.
    // Safe to toggle on a shared connection because better-sqlite3 is
    // synchronous - no other operations can interleave.
    db.pragma('query_only = ON');
    let rows: Record<string, unknown>[];
    try {
      rows = db.prepare(sql).all() as Record<string, unknown>[];
    } finally {
      // Always restore write capability for other operations
      db.pragma('query_only = OFF');
    }

    if (rows.length === 0) {
      return { success: true, message: 'Query returned 0 rows.' };
    }

    const truncated = rows.length > MAX_QUERY_ROWS;
    const displayRows = truncated ? rows.slice(0, MAX_QUERY_ROWS) : rows;
    const columns = Object.keys(displayRows[0]);

    // Format as markdown table
    const lines: string[] = [];
    lines.push(`| ${columns.join(' | ')} |`);
    lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of displayRows) {
      const values = columns.map((column) => {
        const value = row[column];
        if (value === null) return 'NULL';
        const stringValue = String(value);
        // Truncate long values (e.g. transcript text)
        if (stringValue.length > 120) return stringValue.slice(0, 117) + '...';
        return stringValue.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      });
      lines.push(`| ${values.join(' | ')} |`);
    }

    const summary = truncated
      ? `Showing ${MAX_QUERY_ROWS} of ${rows.length} rows (truncated).`
      : `${rows.length} row(s).`;
    lines.push('');
    lines.push(summary);

    return {
      success: true,
      message: lines.join('\n'),
      data: displayRows,
    };
  } catch (error) {
    return { success: false, error: `Query failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
