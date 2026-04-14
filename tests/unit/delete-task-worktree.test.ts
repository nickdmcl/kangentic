import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock WorktreeManager: the helper constructs `new WorktreeManager(projectPath)`
// and calls `withLock(fn)` + `removeWorktree(path)`. We capture the last-created
// instance so each test can configure its behavior and assert against it.
const { worktreeManagerInstances, mockRemoveWorktree } = vi.hoisted(() => ({
  worktreeManagerInstances: [] as Array<{ removeWorktree: ReturnType<typeof vi.fn>; withLock: ReturnType<typeof vi.fn> }>,
  mockRemoveWorktree: vi.fn<(path: string) => Promise<boolean>>(),
}));

vi.mock('../../src/main/git/worktree-manager', () => ({
  WorktreeManager: class {
    removeWorktree = mockRemoveWorktree;
    withLock = vi.fn(async (operation: () => Promise<unknown>) => operation());
    constructor() {
      worktreeManagerInstances.push({ removeWorktree: this.removeWorktree, withLock: this.withLock });
    }
  },
}));

// DB-layer mocks aren't exercised by deleteTaskWorktree (it doesn't touch the
// session repo or DB), but the module imports them at the top level.
vi.mock('../../src/main/db/database', () => ({
  getProjectDb: vi.fn(),
}));
vi.mock('../../src/main/db/repositories/task-repository', () => ({
  TaskRepository: class {},
}));
vi.mock('../../src/main/db/repositories/session-repository', () => ({
  SessionRepository: class {},
}));

import { deleteTaskWorktree } from '../../src/main/ipc/helpers/task-cleanup';

type MockTaskRepo = { update: ReturnType<typeof vi.fn> };
type MockContext = {
  currentProjectPath: string | null;
  sessionManager: Record<string, unknown>;
  configManager: Record<string, unknown>;
};

function createMockTaskRepo(): MockTaskRepo {
  return { update: vi.fn() };
}

function createMockContext(overrides: Partial<MockContext> = {}): MockContext {
  return {
    currentProjectPath: '/mock/project',
    sessionManager: {},
    configManager: {},
    ...overrides,
  };
}

describe('deleteTaskWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worktreeManagerInstances.length = 0;
    mockRemoveWorktree.mockReset();
  });

  it('removes the worktree dir and nulls worktree_path, preserving branch_name', async () => {
    const tasks = createMockTaskRepo();
    const context = createMockContext();
    const task = {
      id: 'task-1',
      worktree_path: '/mock/project/.kangentic/worktrees/task-1-abcd',
      branch_name: 'feature-x-abcd',
    };

    mockRemoveWorktree.mockResolvedValue(true);

    const result = await deleteTaskWorktree(context as never, task, tasks as never, context.currentProjectPath);

    expect(result).toBe(true);
    expect(mockRemoveWorktree).toHaveBeenCalledWith(task.worktree_path);
    expect(tasks.update).toHaveBeenCalledTimes(1);
    expect(tasks.update).toHaveBeenCalledWith({ id: 'task-1', worktree_path: null });
    // Critical: branch_name is NOT cleared. Moving out of Done re-creates the
    // worktree from the preserved branch.
    const updateArgs = tasks.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArgs).not.toHaveProperty('branch_name');
    expect(updateArgs).not.toHaveProperty('session_id');
  });

  it('returns false and is a no-op when task has no worktree_path', async () => {
    const tasks = createMockTaskRepo();
    const context = createMockContext();
    const task = { id: 'task-2', worktree_path: null, branch_name: 'something-else' };

    const result = await deleteTaskWorktree(context as never, task, tasks as never, context.currentProjectPath);

    expect(result).toBe(false);
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(tasks.update).not.toHaveBeenCalled();
  });

  it('returns false and is a no-op when no project path is available', async () => {
    const tasks = createMockTaskRepo();
    const context = createMockContext({ currentProjectPath: null });
    const task = {
      id: 'task-3',
      worktree_path: '/some/path',
      branch_name: 'branch-3',
    };

    const result = await deleteTaskWorktree(context as never, task, tasks as never, null);

    expect(result).toBe(false);
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(tasks.update).not.toHaveBeenCalled();
  });

  it('returns false and does not null worktree_path when the directory could not be removed', async () => {
    const tasks = createMockTaskRepo();
    const context = createMockContext();
    const task = {
      id: 'task-4',
      worktree_path: '/mock/project/.kangentic/worktrees/task-4-abcd',
      branch_name: 'branch-4',
    };

    mockRemoveWorktree.mockResolvedValue(false);

    const result = await deleteTaskWorktree(context as never, task, tasks as never, context.currentProjectPath);

    expect(result).toBe(false);
    expect(mockRemoveWorktree).toHaveBeenCalled();
    // worktree_path preserved so the next attempt retries the removal
    expect(tasks.update).not.toHaveBeenCalled();
  });

  it('swallows worktree manager errors, returns false, and leaves DB unchanged', async () => {
    const tasks = createMockTaskRepo();
    const context = createMockContext();
    const task = {
      id: 'task-5',
      worktree_path: '/mock/project/.kangentic/worktrees/task-5-abcd',
      branch_name: 'branch-5',
    };

    mockRemoveWorktree.mockRejectedValue(new Error('locked file'));

    const result = await deleteTaskWorktree(context as never, task, tasks as never, context.currentProjectPath);

    expect(result).toBe(false);
    expect(tasks.update).not.toHaveBeenCalled();
  });
});
