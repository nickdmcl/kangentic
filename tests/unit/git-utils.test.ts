import { describe, it, expect } from 'vitest';
import { isWorktreePath, resolveProjectRoot } from '../../src/shared/git-utils';

describe('isWorktreePath', () => {
  it('returns true for a standard worktree path', () => {
    expect(isWorktreePath('/home/dev/my-project/.kangentic/worktrees/fix-bug-abc123')).toBe(true);
  });

  it('returns true for a Windows worktree path with backslashes', () => {
    expect(isWorktreePath('C:\\Users\\dev\\project\\.kangentic\\worktrees\\feature-branch')).toBe(true);
  });

  it('returns true for a Windows worktree path with forward slashes', () => {
    expect(isWorktreePath('C:/Users/dev/project/.kangentic/worktrees/feature-branch')).toBe(true);
  });

  it('returns false for a normal project path', () => {
    expect(isWorktreePath('/home/dev/my-project')).toBe(false);
  });

  it('returns false for a path that contains .kangentic but not worktrees', () => {
    expect(isWorktreePath('/home/dev/my-project/.kangentic/sessions/abc123')).toBe(false);
  });

  it('returns false when .kangentic/worktrees appears in the middle but not at the end', () => {
    // The app itself may run from inside a worktree - the CWD contains the marker
    // early in the path, but the project path is a subdirectory within it.
    expect(isWorktreePath('/home/dev/.kangentic/worktrees/my-worktree/subdir/project')).toBe(false);
  });

  it('returns false for a path that is too short', () => {
    expect(isWorktreePath('/worktrees')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isWorktreePath('')).toBe(false);
  });
});

describe('resolveProjectRoot', () => {
  it('strips worktree suffix and returns main repo root', () => {
    expect(resolveProjectRoot('/home/dev/my-project/.kangentic/worktrees/fix-bug-abc123'))
      .toBe('/home/dev/my-project');
  });

  it('handles Windows backslash paths', () => {
    const result = resolveProjectRoot('C:\\Users\\dev\\project\\.kangentic\\worktrees\\feature-branch');
    // Should strip the worktree suffix but preserve native separators in the root portion
    expect(result).toBe('C:\\Users\\dev\\project');
  });

  it('handles Windows forward-slash paths', () => {
    expect(resolveProjectRoot('C:/Users/dev/project/.kangentic/worktrees/feature-branch'))
      .toBe('C:/Users/dev/project');
  });

  it('returns original path when not a worktree', () => {
    const normalPath = '/home/dev/my-project';
    expect(resolveProjectRoot(normalPath)).toBe(normalPath);
  });

  it('returns original Windows path when not a worktree', () => {
    const normalPath = 'C:\\Users\\dev\\project';
    expect(resolveProjectRoot(normalPath)).toBe(normalPath);
  });

  it('does not resolve when marker is in the middle of the path', () => {
    // The marker appears early but the path continues beyond the slug
    const nestedPath = '/home/dev/.kangentic/worktrees/my-worktree/subdir/project';
    expect(resolveProjectRoot(nestedPath)).toBe(nestedPath);
  });
});
