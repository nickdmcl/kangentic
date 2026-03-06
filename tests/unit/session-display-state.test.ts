/**
 * Unit tests for getSessionDisplayState -- the pure function that derives
 * the discriminated-union display state from raw session, usage, and
 * activity data.  Covers all 6 state kinds plus edge cases.
 */
import { describe, it, expect } from 'vitest';
import { getSessionDisplayState } from '../../src/renderer/utils/session-display-state';
import type { Session, SessionUsage, ActivityState } from '../../src/shared/types';

/** Minimal session factory -- only fields that matter for the function. */
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    taskId: 'task-1',
    pid: 123,
    status: 'running',
    shell: 'bash',
    cwd: '/tmp',
    startedAt: new Date().toISOString(),
    exitCode: null,
    ...overrides,
  };
}

const MOCK_USAGE: SessionUsage = {
  contextWindow: {
    usedPercentage: 42,
    usedTokens: 1500,
    cacheTokens: 0,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    contextWindowSize: 200000,
  },
  cost: { totalCostUsd: 0.05, totalDurationMs: 10000 },
  model: { id: 'claude-sonnet', displayName: 'Claude Sonnet' },
};

describe('getSessionDisplayState', () => {
  it('returns { kind: "none" } when taskSession is undefined', () => {
    expect(getSessionDisplayState(undefined, undefined, undefined))
      .toEqual({ kind: 'none' });
  });

  it('returns { kind: "exited" } with explicit exitCode', () => {
    const session = makeSession({ status: 'exited', exitCode: 1 });
    expect(getSessionDisplayState(session, undefined, undefined))
      .toEqual({ kind: 'exited', exitCode: 1 });
  });

  it('returns { kind: "exited", exitCode: 0 } when exitCode is null', () => {
    const session = makeSession({ status: 'exited', exitCode: null });
    expect(getSessionDisplayState(session, undefined, undefined))
      .toEqual({ kind: 'exited', exitCode: 0 });
  });

  it('returns { kind: "suspended" }', () => {
    const session = makeSession({ status: 'suspended' });
    expect(getSessionDisplayState(session, undefined, undefined))
      .toEqual({ kind: 'suspended' });
  });

  it('returns { kind: "queued" }', () => {
    const session = makeSession({ status: 'queued' });
    expect(getSessionDisplayState(session, undefined, undefined))
      .toEqual({ kind: 'queued' });
  });

  it('returns { kind: "initializing" } when running with no usage', () => {
    const session = makeSession({ status: 'running' });
    expect(getSessionDisplayState(session, undefined, undefined))
      .toEqual({ kind: 'initializing' });
  });

  it('returns { kind: "initializing" } when running with activity but no usage', () => {
    const session = makeSession({ status: 'running' });
    expect(getSessionDisplayState(session, undefined, 'idle' as ActivityState))
      .toEqual({ kind: 'initializing' });
  });

  it('returns { kind: "running" } when running with usage', () => {
    const session = makeSession({ status: 'running' });
    const result = getSessionDisplayState(session, MOCK_USAGE, 'thinking' as ActivityState);
    expect(result).toEqual({ kind: 'running', activity: 'thinking', usage: MOCK_USAGE });
  });

  it('defaults activity to "thinking" when activity is undefined', () => {
    const session = makeSession({ status: 'running' });
    const result = getSessionDisplayState(session, MOCK_USAGE, undefined);
    expect(result).toEqual({ kind: 'running', activity: 'thinking', usage: MOCK_USAGE });
  });

  it('preserves activity "idle" when explicitly set', () => {
    const session = makeSession({ status: 'running' });
    const result = getSessionDisplayState(session, MOCK_USAGE, 'idle' as ActivityState);
    expect(result).toEqual({ kind: 'running', activity: 'idle', usage: MOCK_USAGE });
  });
});
