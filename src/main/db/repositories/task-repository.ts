import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Task, TaskCreateInput, TaskUpdateInput, TaskMoveInput } from '../../../shared/types';

export class TaskRepository {
  constructor(private db: Database.Database) {}

  private static readonly SELECT_WITH_COUNT = `
    SELECT t.*, COALESCE(ac.cnt, 0) as attachment_count
    FROM tasks t
    LEFT JOIN (
      SELECT task_id, COUNT(*) as cnt
      FROM task_attachments
      GROUP BY task_id
    ) ac ON ac.task_id = t.id`;

  list(swimlaneId?: string): Task[] {
    if (swimlaneId) {
      return this.db.prepare(`${TaskRepository.SELECT_WITH_COUNT}
        WHERE t.swimlane_id = ? AND t.archived_at IS NULL
        ORDER BY t.position ASC`).all(swimlaneId) as Task[];
    }
    return this.db.prepare(`${TaskRepository.SELECT_WITH_COUNT}
      WHERE t.archived_at IS NULL
      ORDER BY t.swimlane_id, t.position ASC`).all() as Task[];
  }

  getById(id: string): Task | undefined {
    return this.db.prepare(`${TaskRepository.SELECT_WITH_COUNT}
      WHERE t.id = ?`).get(id) as Task | undefined;
  }

  getByDisplayId(displayId: number): Task | undefined {
    return this.db.prepare(`${TaskRepository.SELECT_WITH_COUNT}
      WHERE t.display_id = ?`).get(displayId) as Task | undefined;
  }

  getBySessionId(sessionId: string): Task | undefined {
    return this.db.prepare(`${TaskRepository.SELECT_WITH_COUNT}
      WHERE t.session_id = ? AND t.archived_at IS NULL
      LIMIT 1`).get(sessionId) as Task | undefined;
  }

  create(input: TaskCreateInput): Task {
    const now = new Date().toISOString();
    const id = uuidv4();
    // Get next position in the target swimlane
    const maxPos = this.db.prepare('SELECT COALESCE(MAX(position), -1) as max FROM tasks WHERE swimlane_id = ?').get(input.swimlane_id) as { max: number };
    const position = maxPos.max + 1;

    // Get next display_id (auto-incrementing human-readable ID)
    const maxDisplayId = this.db.prepare('SELECT COALESCE(MAX(display_id), 0) as max FROM tasks').get() as { max: number };
    const displayId = maxDisplayId.max + 1;

    const task: Task = {
      id,
      display_id: displayId,
      title: input.title,
      description: input.description,
      swimlane_id: input.swimlane_id,
      position,
      agent: null,
      session_id: null,
      worktree_path: null,
      branch_name: input.customBranchName?.trim() || null,
      pr_number: null,
      pr_url: null,
      base_branch: input.baseBranch || null,
      use_worktree: input.useWorktree != null ? (input.useWorktree ? 1 : 0) : null,
      attachment_count: 0,
      archived_at: null,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO tasks (id, display_id, title, description, swimlane_id, position, agent, session_id, worktree_path, branch_name, pr_number, pr_url, base_branch, use_worktree, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, task.display_id, task.title, task.description, task.swimlane_id, task.position, task.agent, task.session_id, task.worktree_path, task.branch_name, task.pr_number, task.pr_url, task.base_branch, task.use_worktree, task.created_at, task.updated_at);

    return task;
  }

  update(input: TaskUpdateInput): Task {
    const existing = this.getById(input.id);
    if (!existing) throw new Error(`Task ${input.id} not found`);

    const updated: Task = {
      ...existing,
      ...Object.fromEntries(Object.entries(input).filter(([_, v]) => v !== undefined)),
      updated_at: new Date().toISOString(),
    };

    this.db.prepare(`
      UPDATE tasks SET title = ?, description = ?, swimlane_id = ?, position = ?, agent = ?, session_id = ?, worktree_path = ?, branch_name = ?, pr_number = ?, pr_url = ?, base_branch = ?, use_worktree = ?, updated_at = ?
      WHERE id = ?
    `).run(updated.title, updated.description, updated.swimlane_id, updated.position, updated.agent, updated.session_id, updated.worktree_path, updated.branch_name, updated.pr_number, updated.pr_url, updated.base_branch, updated.use_worktree, updated.updated_at, updated.id);

    return updated;
  }

  move(input: TaskMoveInput): void {
    const { taskId, targetSwimlaneId, targetPosition } = input;
    const task = this.getById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const tx = this.db.transaction(() => {
      // Remove from old position - shift down tasks above in old swimlane
      this.db.prepare('UPDATE tasks SET position = position - 1 WHERE swimlane_id = ? AND position > ?')
        .run(task.swimlane_id, task.position);

      // Make room in new position - shift up tasks at and above target position
      this.db.prepare('UPDATE tasks SET position = position + 1 WHERE swimlane_id = ? AND position >= ?')
        .run(targetSwimlaneId, targetPosition);

      // Move the task
      this.db.prepare('UPDATE tasks SET swimlane_id = ?, position = ?, updated_at = ? WHERE id = ?')
        .run(targetSwimlaneId, targetPosition, new Date().toISOString(), taskId);
    });
    tx();
  }

  archive(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  unarchive(id: string, targetSwimlaneId: string, position: number): Task {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE tasks SET archived_at = NULL, swimlane_id = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(targetSwimlaneId, position, now, id);
    return this.getById(id)!;
  }

  listArchived(): Task[] {
    return this.db.prepare(`${TaskRepository.SELECT_WITH_COUNT}
      WHERE t.archived_at IS NOT NULL
      ORDER BY t.archived_at DESC`).all() as Task[];
  }

  delete(id: string): void {
    const task = this.getById(id);
    if (!task) return;

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      // Shift down tasks above the deleted one
      this.db.prepare('UPDATE tasks SET position = position - 1 WHERE swimlane_id = ? AND position > ?')
        .run(task.swimlane_id, task.position);
    });
    tx();
  }
}
