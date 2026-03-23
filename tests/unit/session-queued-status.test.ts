/**
 * Tests for queued session status behavior in SessionManager.
 *
 * Verifies that:
 * - spawn() returns status='queued' when at concurrency limit
 * - queued sessions emit 'session-changed' with queued status on creation
 * - the session ID is preserved across queue promotion
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../src/main/pty/shell-resolver', () => {
  class MockShellResolver {
    async getDefaultShell() { return '/bin/bash'; }
  }
  return { ShellResolver: MockShellResolver };
});

vi.mock('../../src/shared/paths', () => ({
  adaptCommandForShell: (command: string) => command,
}));

vi.mock('../../src/main/analytics/analytics', () => ({
  trackEvent: vi.fn(),
  sanitizeErrorMessage: (message: string) => message,
}));

import type { Session } from '../../src/shared/types';
import * as pty from 'node-pty';
import { SessionManager } from '../../src/main/pty/session-manager';

function createMockPty() {
  let exitHandler: ((event: { exitCode: number }) => void) | null = null;

  const mockPty = {
    pid: 12345,
    onData: vi.fn(),
    onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
      exitHandler = callback;
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      if (exitHandler) setTimeout(() => exitHandler!({ exitCode: 0 }), 0);
    }),
  };

  return {
    mockPty,
    triggerExit: (exitCode = 0) => exitHandler?.({ exitCode }),
  };
}

describe('SessionManager queued status', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager();
    manager.setMaxConcurrent(1);
  });

  it('spawn returns queued status when at concurrency limit', async () => {
    const firstMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(firstMock.mockPty as unknown as pty.IPty);
    await manager.spawn({ taskId: 'task-1', projectId: 'project-1', command: '', cwd: '/tmp/test' });

    // Second spawn should be queued (max concurrent = 1)
    const secondMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(secondMock.mockPty as unknown as pty.IPty);
    const queued = await manager.spawn({ taskId: 'task-2', projectId: 'project-1', command: '', cwd: '/tmp/test' });

    expect(queued.status).toBe('queued');
    expect(queued.pid).toBeNull();
    expect(manager.queuedCount).toBe(1);
  });

  it('spawn emits session-changed event with queued status', async () => {
    const firstMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(firstMock.mockPty as unknown as pty.IPty);
    await manager.spawn({ taskId: 'task-1', projectId: 'project-1', command: '', cwd: '/tmp/test' });

    const statusEvents: Array<{ sessionId: string; status: string }> = [];
    manager.on('session-changed', (sessionId: string, session: Session) => {
      statusEvents.push({ sessionId, status: session.status });
    });

    const secondMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(secondMock.mockPty as unknown as pty.IPty);
    const queued = await manager.spawn({ taskId: 'task-2', projectId: 'project-1', command: '', cwd: '/tmp/test' });

    const queuedEvent = statusEvents.find(
      (event) => event.sessionId === queued.id && event.status === 'queued',
    );
    expect(queuedEvent).toBeDefined();
  });

  it('queued session transitions to running on promotion and preserves session ID', async () => {
    const firstMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(firstMock.mockPty as unknown as pty.IPty);
    await manager.spawn({ taskId: 'task-1', projectId: 'project-1', command: '', cwd: '/tmp/test' });

    const secondMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(secondMock.mockPty as unknown as pty.IPty);
    const queued = await manager.spawn({ taskId: 'task-2', projectId: 'project-1', command: '', cwd: '/tmp/test' });
    const queuedId = queued.id;

    expect(queued.status).toBe('queued');

    // Collect status events for the queued session
    const statusEvents: string[] = [];
    manager.on('session-changed', (sessionId: string, session: Session) => {
      if (sessionId === queuedId) statusEvents.push(session.status);
    });

    // Kill first session to free a slot and trigger promotion
    firstMock.triggerExit(0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Queued session should now be running with the same ID
    const promoted = manager.getSession(queuedId);
    expect(promoted?.status).toBe('running');
    expect(promoted?.id).toBe(queuedId);
    expect(statusEvents).toContain('running');
    expect(manager.queuedCount).toBe(0);
  });
});
