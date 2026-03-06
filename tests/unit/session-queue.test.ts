/**
 * Unit tests for SessionQueue -- the reentrancy-safe concurrency queue
 * that manages session spawning order and slot limits.
 */
import { describe, it, expect, vi } from 'vitest';
import { SessionQueue } from '../../src/main/pty/session-queue';
import type { SpawnSessionInput } from '../../src/shared/types';

function makeInput(taskId: string): SpawnSessionInput {
  return { taskId, command: 'mock-claude', cwd: '/tmp' };
}

describe('SessionQueue', () => {
  it('enqueue adds entries and length reflects them', () => {
    const queue = new SessionQueue({
      spawner: vi.fn(),
      getActiveCount: () => 0,
      maxConcurrent: 5,
    });
    queue.enqueue(makeInput('t1'), 'sess-1');
    queue.enqueue(makeInput('t2'), 'sess-2');
    expect(queue.length).toBe(2);
  });

  it('remove returns true when found, false when not', () => {
    const queue = new SessionQueue({
      spawner: vi.fn(),
      getActiveCount: () => 5, // at limit, so enqueue won't trigger processQueue
      maxConcurrent: 5,
    });
    queue.enqueue(makeInput('t1'), 'sess-1');

    expect(queue.remove('sess-1')).toBe(true);
    expect(queue.length).toBe(0);
    expect(queue.remove('sess-nonexistent')).toBe(false);
  });

  it('shouldQueue returns true when active >= max', () => {
    const queue = new SessionQueue({
      spawner: vi.fn(),
      getActiveCount: () => 3,
      maxConcurrent: 3,
    });
    expect(queue.shouldQueue()).toBe(true);
  });

  it('shouldQueue returns false when active < max', () => {
    const queue = new SessionQueue({
      spawner: vi.fn(),
      getActiveCount: () => 2,
      maxConcurrent: 3,
    });
    expect(queue.shouldQueue()).toBe(false);
  });

  it('notifySlotFreed calls spawner for queued entry', async () => {
    const spawner = vi.fn().mockResolvedValue(undefined);
    let active = 1;
    const queue = new SessionQueue({
      spawner,
      getActiveCount: () => active,
      maxConcurrent: 2,
    });
    queue.enqueue(makeInput('t1'), 'sess-1');
    queue.notifySlotFreed();

    // Give the async processQueue a tick to complete
    await vi.waitFor(() => expect(spawner).toHaveBeenCalledTimes(1));
    expect(spawner).toHaveBeenCalledWith(makeInput('t1'));
    expect(queue.length).toBe(0);
  });

  it('notifySlotFreed respects concurrency limit', async () => {
    const spawner = vi.fn().mockResolvedValue(undefined);
    let active = 2;
    const queue = new SessionQueue({
      spawner,
      // After each spawn, active increases
      getActiveCount: () => active,
      maxConcurrent: 3,
    });
    spawner.mockImplementation(async () => { active++; });

    queue.enqueue(makeInput('t1'), 'sess-1');
    queue.enqueue(makeInput('t2'), 'sess-2');
    queue.enqueue(makeInput('t3'), 'sess-3');
    queue.notifySlotFreed();

    // Only 1 slot open (active=2, max=3), so only 1 should spawn
    await vi.waitFor(() => expect(spawner).toHaveBeenCalledTimes(1));
    // After spawning, active=3 -- remaining 2 stay queued
    expect(queue.length).toBe(2);
  });

  it('setMaxConcurrent triggers promotion', async () => {
    const spawner = vi.fn().mockResolvedValue(undefined);
    let active = 2;
    const queue = new SessionQueue({
      spawner,
      getActiveCount: () => active,
      maxConcurrent: 2,
    });
    queue.enqueue(makeInput('t1'), 'sess-1');

    // Raise limit -- should trigger promotion
    queue.setMaxConcurrent(3);

    await vi.waitFor(() => expect(spawner).toHaveBeenCalledTimes(1));
    expect(queue.length).toBe(0);
  });

  it('clear empties the queue', () => {
    const queue = new SessionQueue({
      spawner: vi.fn(),
      getActiveCount: () => 5,
      maxConcurrent: 5,
    });
    queue.enqueue(makeInput('t1'), 'sess-1');
    queue.enqueue(makeInput('t2'), 'sess-2');
    queue.enqueue(makeInput('t3'), 'sess-3');

    queue.clear();
    expect(queue.length).toBe(0);
  });

  it('failed spawn does not stall queue -- next entry still processes', async () => {
    const spawner = vi.fn();
    const queue = new SessionQueue({
      spawner,
      getActiveCount: () => 0,
      maxConcurrent: 5,
    });

    spawner.mockRejectedValueOnce(new Error('spawn failed'));
    spawner.mockResolvedValueOnce(undefined);

    queue.enqueue(makeInput('t-fail'), 'sess-fail');
    queue.enqueue(makeInput('t-ok'), 'sess-ok');
    queue.notifySlotFreed();

    await vi.waitFor(() => expect(spawner).toHaveBeenCalledTimes(2));
    expect(spawner).toHaveBeenNthCalledWith(1, makeInput('t-fail'));
    expect(spawner).toHaveBeenNthCalledWith(2, makeInput('t-ok'));
    expect(queue.length).toBe(0);
  });

  it('reentrancy guard: concurrent notifySlotFreed does not over-spawn', async () => {
    const spawnOrder: string[] = [];
    let active = 0;
    let resolveFirst: (() => void) | null = null;

    const spawner = vi.fn().mockImplementation(async (input: SpawnSessionInput) => {
      active++;
      spawnOrder.push(input.taskId);
      if (input.taskId === 't1') {
        // First spawn blocks until we release it
        await new Promise<void>((resolve) => { resolveFirst = resolve; });
      }
    });

    const queue = new SessionQueue({
      spawner,
      getActiveCount: () => active,
      maxConcurrent: 2,
    });

    queue.enqueue(makeInput('t1'), 'sess-1');
    queue.enqueue(makeInput('t2'), 'sess-2');
    queue.enqueue(makeInput('t3'), 'sess-3');

    // Fire two concurrent notifySlotFreed calls
    queue.notifySlotFreed();
    queue.notifySlotFreed(); // should set _dirty, not start a second loop

    // Wait for first spawn to start
    await vi.waitFor(() => expect(spawner).toHaveBeenCalledTimes(1));
    expect(active).toBe(1);

    // Release the first spawn -- loop continues with _dirty re-check
    resolveFirst!();

    // Should spawn t2 (active=1 < max=2), then stop (active=2 >= max=2)
    await vi.waitFor(() => expect(spawner).toHaveBeenCalledTimes(2));
    expect(active).toBe(2);
    expect(queue.length).toBe(1); // t3 still queued
    expect(spawnOrder).toEqual(['t1', 't2']);
  });

  it('maxConcurrentSessions getter reflects current limit', () => {
    const queue = new SessionQueue({
      spawner: vi.fn(),
      getActiveCount: () => 0,
      maxConcurrent: 7,
    });
    expect(queue.maxConcurrentSessions).toBe(7);
    queue.setMaxConcurrent(3);
    expect(queue.maxConcurrentSessions).toBe(3);
  });
});
