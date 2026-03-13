import { EventType } from '../../../shared/types';
import type { SessionRepository } from '../../db/repositories/session-repository';
import type { SessionManager } from '../../pty/session-manager';

/**
 * Capture session metrics (cost, tokens, model, duration, tool calls) from
 * the in-memory caches and persist them to the session record in the DB.
 *
 * Must be called BEFORE the session is removed from the manager (caches
 * are cleared on remove). Safe to call from both exit and suspend paths.
 *
 * Best-effort: swallows all errors so it never breaks the calling flow.
 */
export function captureSessionMetrics(
  sessionManager: SessionManager,
  sessionRepo: SessionRepository,
  sessionId: string,
  recordId: string,
): void {
  try {
    const usageCache = sessionManager.getUsageCache();
    const usage = usageCache[sessionId];
    const events = sessionManager.getEventsForSession(sessionId);
    const toolCallCount = events.filter((event) => event.type === EventType.ToolEnd).length;

    if (usage) {
      sessionRepo.updateMetrics(recordId, {
        totalCostUsd: usage.cost.totalCostUsd,
        totalInputTokens: usage.contextWindow.totalInputTokens,
        totalOutputTokens: usage.contextWindow.totalOutputTokens,
        modelId: usage.model.id,
        modelDisplayName: usage.model.displayName,
        totalDurationMs: usage.cost.totalDurationMs,
        toolCallCount,
      });
    }
  } catch {
    // Metrics capture is best-effort -- never break the calling flow
  }
}
