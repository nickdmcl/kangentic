/**
 * Unit tests for CommandBridge -- the file-based command queue processor
 * that bridges the MCP server process to the Electron main process.
 *
 * Uses a real in-memory SQLite database with project migrations to test
 * actual repository interactions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { CommandBridge } from '../../src/main/agent/command-bridge';
import { runProjectMigrations } from '../../src/main/db/migrations';
import { SwimlaneRepository } from '../../src/main/db/repositories/swimlane-repository';
import { TaskRepository } from '../../src/main/db/repositories/task-repository';
import type { Task } from '../../src/shared/types';

let tmpDir: string;
let database: Database.Database;
let backlogId: string;
let planningId: string;

/** Read seeded swimlane IDs (runProjectMigrations seeds default columns). */
function readSeededSwimlaneIds(): void {
  const swimlaneRepository = new SwimlaneRepository(database);
  const all = swimlaneRepository.list();
  const backlog = all.find((swimlane) => swimlane.role === 'backlog');
  const planning = all.find((swimlane) => swimlane.name === 'Planning');
  if (!backlog || !planning) throw new Error('Seeded swimlanes not found');
  backlogId = backlog.id;
  planningId = planning.id;
}

function createBridge(overrides?: {
  onTaskCreated?: (task: Task, columnName: string, swimlaneId: string) => void;
  onTaskUpdated?: (task: Task) => void;
}): CommandBridge {
  return new CommandBridge({
    commandsPath: path.join(tmpDir, 'commands.jsonl'),
    responsesDir: path.join(tmpDir, 'responses'),
    projectId: 'test-project',
    getProjectDb: () => database,
    onTaskCreated: overrides?.onTaskCreated ?? (() => {}),
    onTaskUpdated: overrides?.onTaskUpdated ?? (() => {}),
  });
}

/** Write a command and trigger processing by calling the internal method. */
function sendCommand(bridge: CommandBridge, method: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const commandLine = JSON.stringify({ id: requestId, method, params, ts: Date.now() });

  // Append to commands file
  fs.appendFileSync(path.join(tmpDir, 'commands.jsonl'), commandLine + '\n');

  // Trigger processing (bypass FileWatcher for synchronous testing)
  (bridge as unknown as { processNewCommands: () => void }).processNewCommands();

  // Read response
  const responsePath = path.join(tmpDir, 'responses', `${requestId}.json`);
  if (!fs.existsSync(responsePath)) {
    throw new Error(`No response file for request ${requestId}`);
  }
  return JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-bridge-'));
  fs.mkdirSync(path.join(tmpDir, 'responses'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'commands.jsonl'), '');

  database = new Database(':memory:');
  runProjectMigrations(database);
  readSeededSwimlaneIds();
});

afterEach(() => {
  database.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CommandBridge -- create_task', () => {
  it('creates a task in backlog by default', () => {
    const createdTasks: Array<{ task: Task; column: string }> = [];
    const bridge = createBridge({
      onTaskCreated: (task, columnName) => createdTasks.push({ task, column: columnName }),
    });
    bridge.start();

    const response = sendCommand(bridge, 'create_task', {
      title: 'Fix login bug',
      description: 'Users cannot log in',
    });

    bridge.stop();

    expect(response.success).toBe(true);
    expect(response.message).toContain('Fix login bug');
    expect(response.message).toContain('Backlog');

    // Verify task was created in DB
    const taskRepository = new TaskRepository(database);
    const tasks = taskRepository.list(backlogId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Fix login bug');
    expect(tasks[0].description).toBe('Users cannot log in');

    // Verify callback fired
    expect(createdTasks).toHaveLength(1);
    expect(createdTasks[0].column).toBe('Backlog');
  });

  it('creates a task in a named column (case-insensitive)', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'create_task', {
      title: 'Plan feature',
      column: 'planning',
    });

    bridge.stop();

    expect(response.success).toBe(true);
    expect(response.message).toContain('Planning');

    const taskRepository = new TaskRepository(database);
    const tasks = taskRepository.list(planningId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Plan feature');
  });

  it('returns error for non-existent column', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'create_task', {
      title: 'Some task',
      column: 'Nonexistent',
    });

    bridge.stop();

    expect(response.success).toBe(false);
    expect(response.error).toContain('Nonexistent');
    expect(response.error).toContain('Available columns');
  });

  it('returns error for empty title', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'create_task', { title: '   ' });

    bridge.stop();

    expect(response.success).toBe(false);
    expect(response.error).toContain('title is required');
  });

  it('truncates title to 200 chars', () => {
    const bridge = createBridge();
    bridge.start();

    const longTitle = 'x'.repeat(300);
    sendCommand(bridge, 'create_task', { title: longTitle });

    bridge.stop();

    const taskRepository = new TaskRepository(database);
    const tasks = taskRepository.list(backlogId);
    expect(tasks[0].title).toHaveLength(200);
  });
});

describe('CommandBridge -- list_columns', () => {
  it('returns all non-archived columns with task counts', () => {
    // Add a task to backlog
    const taskRepository = new TaskRepository(database);
    taskRepository.create({ title: 'Task 1', description: '', swimlane_id: backlogId });
    taskRepository.create({ title: 'Task 2', description: '', swimlane_id: backlogId });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'list_columns');

    bridge.stop();

    expect(response.success).toBe(true);
    const columns = response.data as Array<{ name: string; role: string; taskCount: number }>;
    // Default seed creates 7 columns: Backlog, Planning, Executing, Code Review, Tests, Ship It, Done
    // Done is archived, so 6 non-archived columns are returned
    expect(columns).toHaveLength(6);

    const backlogColumn = columns.find((column) => column.name === 'Backlog');
    expect(backlogColumn?.taskCount).toBe(2);
    expect(backlogColumn?.role).toBe('backlog');
  });
});

describe('CommandBridge -- list_tasks', () => {
  it('returns all tasks when no column specified', () => {
    const taskRepository = new TaskRepository(database);
    taskRepository.create({ title: 'Task A', description: '', swimlane_id: backlogId });
    taskRepository.create({ title: 'Task B', description: '', swimlane_id: planningId });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'list_tasks', {});

    bridge.stop();

    expect(response.success).toBe(true);
    const tasks = response.data as Array<{ title: string; column: string }>;
    expect(tasks).toHaveLength(2);
  });

  it('filters tasks by column name', () => {
    const taskRepository = new TaskRepository(database);
    taskRepository.create({ title: 'Backlog Task', description: '', swimlane_id: backlogId });
    taskRepository.create({ title: 'Planning Task', description: '', swimlane_id: planningId });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'list_tasks', { column: 'Planning' });

    bridge.stop();

    expect(response.success).toBe(true);
    const tasks = response.data as Array<{ title: string; column: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Planning Task');
    expect(tasks[0].column).toBe('Planning');
  });
});

describe('CommandBridge -- update_task', () => {
  it('updates task title and description', () => {
    const taskRepository = new TaskRepository(database);
    const task = taskRepository.create({ title: 'Old Title', swimlane_id: backlogId, description: 'Old desc' });

    const updatedTasks: Task[] = [];
    const bridge = createBridge({
      onTaskUpdated: (updatedTask) => updatedTasks.push(updatedTask),
    });
    bridge.start();

    const response = sendCommand(bridge, 'update_task', {
      taskId: task.id,
      title: 'New Title',
      description: 'New description',
    });

    bridge.stop();

    expect(response.success).toBe(true);
    expect(response.message).toContain('title');
    expect(response.message).toContain('description');

    // Verify DB was updated
    const updated = taskRepository.getById(task.id);
    expect(updated?.title).toBe('New Title');
    expect(updated?.description).toBe('New description');

    // Verify callback fired
    expect(updatedTasks).toHaveLength(1);
    expect(updatedTasks[0].title).toBe('New Title');
  });

  it('returns error for non-existent task', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'update_task', {
      taskId: 'non-existent-id',
      title: 'New Title',
    });

    bridge.stop();

    expect(response.success).toBe(false);
    expect(response.error).toContain('not found');
  });
});

describe('CommandBridge -- unknown command', () => {
  it('returns error for unknown method', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'delete_everything', {});

    bridge.stop();

    expect(response.success).toBe(false);
    expect(response.error).toContain('Unknown command');
  });
});

describe('CommandBridge -- board_summary', () => {
  it('returns board summary with column counts and metrics', () => {
    const taskRepository = new TaskRepository(database);
    taskRepository.create({ title: 'Task 1', description: '', swimlane_id: backlogId });
    taskRepository.create({ title: 'Task 2', description: '', swimlane_id: planningId });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'board_summary');

    bridge.stop();

    expect(response.success).toBe(true);
    expect(response.message).toContain('Board Summary');
    expect(response.message).toContain('Active tasks: 2');

    const data = response.data as { totalActiveTasks: number; columns: Array<{ name: string }> };
    expect(data.totalActiveTasks).toBe(2);
    expect(data.columns).toHaveLength(6);
  });
});

describe('CommandBridge -- search_tasks', () => {
  it('finds tasks matching query in title', () => {
    const taskRepository = new TaskRepository(database);
    taskRepository.create({ title: 'Fix login bug', description: '', swimlane_id: backlogId });
    taskRepository.create({ title: 'Add signup flow', description: '', swimlane_id: planningId });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'search_tasks', { query: 'login' });

    bridge.stop();

    expect(response.success).toBe(true);
    const data = response.data as { tasks: Array<{ title: string }>; totalActive: number };
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe('Fix login bug');
    expect(data.totalActive).toBe(1);
  });

  it('finds tasks matching query in description', () => {
    const taskRepository = new TaskRepository(database);
    taskRepository.create({ title: 'Task A', description: 'OAuth integration needed', swimlane_id: backlogId });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'search_tasks', { query: 'oauth' });

    bridge.stop();

    expect(response.success).toBe(true);
    const data = response.data as { tasks: Array<{ title: string }> };
    expect(data.tasks).toHaveLength(1);
  });

  it('returns empty when no tasks match', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'search_tasks', { query: 'nonexistent' });

    bridge.stop();

    expect(response.success).toBe(true);
    const data = response.data as { tasks: Array<unknown> };
    expect(data.tasks).toHaveLength(0);
  });

  it('returns error for empty query', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'search_tasks', { query: '   ' });

    bridge.stop();

    expect(response.success).toBe(false);
    expect(response.error).toContain('required');
  });
});

describe('CommandBridge -- find_task', () => {
  it('finds task by branch name', () => {
    const taskRepository = new TaskRepository(database);
    const task = taskRepository.create({ title: 'Feature X', description: '', swimlane_id: backlogId });
    taskRepository.update({ id: task.id, branch_name: 'feature/x-abc123' });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'find_task', { branch: 'feature/x' });

    bridge.stop();

    expect(response.success).toBe(true);
    const data = response.data as Array<{ title: string; branchName: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Feature X');
    expect(data[0].branchName).toBe('feature/x-abc123');
  });

  it('finds task by title keyword', () => {
    const taskRepository = new TaskRepository(database);
    taskRepository.create({ title: 'Refactor auth module', description: '', swimlane_id: backlogId });
    taskRepository.create({ title: 'Add logging', description: '', swimlane_id: backlogId });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'find_task', { title: 'auth' });

    bridge.stop();

    expect(response.success).toBe(true);
    const data = response.data as Array<{ title: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Refactor auth module');
  });

  it('returns empty when no match found', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'find_task', { branch: 'nonexistent' });

    bridge.stop();

    expect(response.success).toBe(true);
    expect(response.message).toContain('No tasks found');
  });
});

describe('CommandBridge -- get_column_detail', () => {
  it('returns column configuration details', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'get_column_detail', { column: 'Backlog' });

    bridge.stop();

    expect(response.success).toBe(true);
    expect(response.message).toContain('Backlog');
    expect(response.message).toContain('Role: backlog');

    const data = response.data as { name: string; role: string; autoSpawn: boolean };
    expect(data.name).toBe('Backlog');
    expect(data.role).toBe('backlog');
    expect(data.autoSpawn).toBe(false);
  });

  it('returns error for non-existent column', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'get_column_detail', { column: 'Nonexistent' });

    bridge.stop();

    expect(response.success).toBe(false);
    expect(response.error).toContain('not found');
  });
});

describe('CommandBridge -- get_session_history', () => {
  it('returns empty history for task with no sessions', () => {
    const taskRepository = new TaskRepository(database);
    const task = taskRepository.create({ title: 'No sessions', description: '', swimlane_id: backlogId });

    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'get_session_history', { taskId: task.id });

    bridge.stop();

    expect(response.success).toBe(true);
    expect(response.message).toContain('No session history');
    const data = response.data as Array<unknown>;
    expect(data).toHaveLength(0);
  });

  it('returns error for non-existent task', () => {
    const bridge = createBridge();
    bridge.start();

    const response = sendCommand(bridge, 'get_session_history', { taskId: 'non-existent' });

    bridge.stop();

    expect(response.success).toBe(false);
    expect(response.error).toContain('not found');
  });
});
