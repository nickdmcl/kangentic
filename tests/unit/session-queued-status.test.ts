/**
 * Tests for queued session status behavior in SessionManager.
 *
 * Verifies that:
 * - spawn() returns status='queued' when at concurrency limit
 * - queued sessions emit 'running' on promotion
 * - the session ID is preserved across queue promotion
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
  adaptCommandForShell: (cmd: string) => cmd,
}));

vi.mock('../../src/main/analytics/analytics', () => ({
  trackEvent: vi.fn(),
  sanitizeErrorMessage: (message: string) => message,
}));

import * as pty from 'node-pty';
import { SessionManager } from '../../src/main/pty/session-manager';

function createMockPty() {
  let exitHandler: ((e: { exitCode: number }) => void) | null = null;

  const mockPty = {
    pid: 12345,
    onData: vi.fn(),
    onExit: vi.fn((cb: (e: { exitCode: number }) => void) => {
      exitHandler = cb;
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
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kangentic-queued-'));
    manager = new SessionManager(tmpDir);
    manager.setMaxConcurrent(1);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('spawn returns queued status when at concurrency limit', async () => {
    const firstMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(firstMock.mockPty as unknown as pty.IPty);
    await manager.spawn({ taskId: 'task-1', command: '', cwd: '/tmp/test' });

    // Second spawn should be queued (max concurrent = 1)
    const secondMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(secondMock.mockPty as unknown as pty.IPty);
    const queued = await manager.spawn({ taskId: 'task-2', command: '', cwd: '/tmp/test' });

    expect(queued.status).toBe('queued');
    expect(queued.pid).toBeNull();
    expect(manager.queuedCount).toBe(1);
  });

  it('spawn emits queued status event', async () => {
    const firstMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(firstMock.mockPty as unknown as pty.IPty);
    await manager.spawn({ taskId: 'task-1', command: '', cwd: '/tmp/test' });

    const statusEvents: Array<{ sessionId: string; status: string }> = [];
    manager.on('status', (sessionId: string, status: string) => {
      statusEvents.push({ sessionId, status });
    });

    const secondMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(secondMock.mockPty as unknown as pty.IPty);
    const queued = await manager.spawn({ taskId: 'task-2', command: '', cwd: '/tmp/test' });

    const queuedEvent = statusEvents.find(
      (event) => event.sessionId === queued.id && event.status === 'queued',
    );
    expect(queuedEvent).toBeDefined();
  });

  it('queued session transitions to running on promotion and preserves session ID', async () => {
    const firstMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(firstMock.mockPty as unknown as pty.IPty);
    const firstSession = await manager.spawn({ taskId: 'task-1', command: '', cwd: '/tmp/test' });

    const secondMock = createMockPty();
    vi.mocked(pty.spawn).mockReturnValue(secondMock.mockPty as unknown as pty.IPty);
    const queued = await manager.spawn({ taskId: 'task-2', command: '', cwd: '/tmp/test' });
    const queuedId = queued.id;

    expect(queued.status).toBe('queued');

    // Collect status events for the queued session
    const statusEvents: string[] = [];
    manager.on('status', (sessionId: string, status: string) => {
      if (sessionId === queuedId) statusEvents.push(status);
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
