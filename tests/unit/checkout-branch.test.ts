/**
 * Unit tests for WorktreeManager.checkoutBranch() and the
 * ensureTaskBranchCheckout / guardActiveNonWorktreeSessions helpers.
 *
 * These functions handle branch checkout for non-worktree tasks,
 * with guards for dirty repos and concurrent non-worktree sessions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGit = {
  revparse: vi.fn(),
  status: vi.fn(),
  checkout: vi.fn(),
};

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    copyFileSync: vi.fn(),
  },
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import fs from 'node:fs';
import { WorktreeManager } from '../../src/main/git/worktree-manager';
import { ensureTaskBranchCheckout } from '../../src/main/ipc/helpers';
import type { Task } from '../../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1234',
    title: 'Test task',
    description: '',
    swimlane_id: 'lane-1',
    position: 0,
    session_id: null,
    worktree_path: null,
    branch_name: null,
    base_branch: null,
    use_worktree: null,
    agent: null,
    pr_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Task;
}

// ── checkoutBranch tests ───────────────────────────────────────────────────

describe('WorktreeManager.checkoutBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops when already on the target branch', async () => {
    mockGit.revparse.mockResolvedValue('feature/my-branch\n');

    const manager = new WorktreeManager('/project');
    await manager.checkoutBranch('feature/my-branch');

    expect(mockGit.status).not.toHaveBeenCalled();
    expect(mockGit.checkout).not.toHaveBeenCalled();
  });

  it('checks out the branch when repo is clean', async () => {
    mockGit.revparse.mockResolvedValue('main\n');
    mockGit.status.mockResolvedValue({ files: [] });
    mockGit.checkout.mockResolvedValue(undefined);

    const manager = new WorktreeManager('/project');
    await manager.checkoutBranch('develop');

    expect(mockGit.checkout).toHaveBeenCalledWith('develop');
  });

  it('throws when repo has tracked modifications', async () => {
    mockGit.revparse.mockResolvedValue('main\n');
    mockGit.status.mockResolvedValue({
      files: [
        { path: 'src/index.ts', index: 'M', working_dir: ' ' },
      ],
    });

    const manager = new WorktreeManager('/project');
    await expect(manager.checkoutBranch('develop')).rejects.toThrow(
      /uncommitted changes/,
    );
    expect(mockGit.checkout).not.toHaveBeenCalled();
  });

  it('throws when repo has staged changes', async () => {
    mockGit.revparse.mockResolvedValue('main\n');
    mockGit.status.mockResolvedValue({
      files: [
        { path: 'src/app.ts', index: 'A', working_dir: ' ' },
      ],
    });

    const manager = new WorktreeManager('/project');
    await expect(manager.checkoutBranch('develop')).rejects.toThrow(
      /uncommitted changes/,
    );
  });

  it('allows checkout when repo only has untracked files', async () => {
    mockGit.revparse.mockResolvedValue('main\n');
    mockGit.status.mockResolvedValue({
      files: [
        { path: 'scratch.txt', index: '?', working_dir: '?' },
        { path: 'notes.md', index: '?', working_dir: '?' },
      ],
    });
    mockGit.checkout.mockResolvedValue(undefined);

    const manager = new WorktreeManager('/project');
    await manager.checkoutBranch('develop');

    expect(mockGit.checkout).toHaveBeenCalledWith('develop');
  });

  it('allows checkout when repo has mix of untracked and clean tracked', async () => {
    mockGit.revparse.mockResolvedValue('main\n');
    mockGit.status.mockResolvedValue({
      files: [
        { path: 'scratch.txt', index: '?', working_dir: '?' },
      ],
    });
    mockGit.checkout.mockResolvedValue(undefined);

    const manager = new WorktreeManager('/project');
    await manager.checkoutBranch('feature/test');

    expect(mockGit.checkout).toHaveBeenCalledWith('feature/test');
  });

  it('propagates git error when branch does not exist', async () => {
    mockGit.revparse.mockResolvedValue('main\n');
    mockGit.status.mockResolvedValue({ files: [] });
    mockGit.checkout.mockRejectedValue(new Error("pathspec 'nonexistent' did not match any file(s) known to git"));

    const manager = new WorktreeManager('/project');
    await expect(manager.checkoutBranch('nonexistent')).rejects.toThrow(/pathspec/);
  });

  it('error message suggests worktree mode', async () => {
    mockGit.revparse.mockResolvedValue('main\n');
    mockGit.status.mockResolvedValue({
      files: [{ path: 'dirty.ts', index: 'M', working_dir: ' ' }],
    });

    const manager = new WorktreeManager('/project');
    await expect(manager.checkoutBranch('develop')).rejects.toThrow(
      /worktree mode/,
    );
  });

  it('handles detached HEAD (revparse returns "HEAD")', async () => {
    mockGit.revparse.mockResolvedValue('HEAD\n');
    mockGit.status.mockResolvedValue({ files: [] });
    mockGit.checkout.mockResolvedValue(undefined);

    const manager = new WorktreeManager('/project');
    await manager.checkoutBranch('main');

    expect(mockGit.checkout).toHaveBeenCalledWith('main');
  });
});

// ── ensureTaskBranchCheckout tests ─────────────────────────────────────────

describe('ensureTaskBranchCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when projectPath is null', async () => {
    const task = makeTask({ base_branch: 'develop' });
    await ensureTaskBranchCheckout(task, null);

    expect(mockGit.revparse).not.toHaveBeenCalled();
  });

  it('skips when task has a worktree_path', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const task = makeTask({ base_branch: 'develop', worktree_path: '/project/.kangentic/worktrees/test' });
    await ensureTaskBranchCheckout(task, '/project');

    expect(mockGit.revparse).not.toHaveBeenCalled();
  });

  it('skips when task has no base_branch', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const task = makeTask({ base_branch: null });
    await ensureTaskBranchCheckout(task, '/project');

    expect(mockGit.revparse).not.toHaveBeenCalled();
  });

  it('skips when project is not a git repo', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const task = makeTask({ base_branch: 'develop' });
    await ensureTaskBranchCheckout(task, '/project');

    expect(mockGit.revparse).not.toHaveBeenCalled();
  });

  it('calls checkoutBranch when all guards pass', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGit.revparse.mockResolvedValue('main\n');
    mockGit.status.mockResolvedValue({ files: [] });
    mockGit.checkout.mockResolvedValue(undefined);

    const task = makeTask({ base_branch: 'develop' });
    await ensureTaskBranchCheckout(task, '/project');

    expect(mockGit.checkout).toHaveBeenCalledWith('develop');
  });
});
