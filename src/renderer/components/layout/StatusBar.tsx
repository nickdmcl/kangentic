import React from 'react';
import { SquareTerminal, ClipboardCheck } from 'lucide-react';
import { useSessionStore } from '../../stores/session-store';
import { useConfigStore } from '../../stores/config-store';
import { useBoardStore } from '../../stores/board-store';
import { useProjectStore } from '../../stores/project-store';
import { formatTokenCount } from '../../utils/format-tokens';

export function StatusBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const sessionUsage = useSessionStore((s) => s.sessionUsage);
  const claudeInfo = useConfigStore((s) => s.claudeInfo);
  const claudeVersionLabel = useConfigStore((s) => s.claudeVersionLabel);
  const tasks = useBoardStore((s) => s.tasks);
  const swimlanes = useBoardStore((s) => s.swimlanes);
  const currentProject = useProjectStore((s) => s.currentProject);

  const activeSessions = sessions.filter(
    (s) => s.status === 'running' || s.status === 'queued',
  ).length;
  const queued = sessions.filter((s) => s.status === 'queued').length;

  // Count tasks not in "done" role swimlanes
  const doneSwimlaneIds = new Set(
    swimlanes.filter((s) => s.role === 'done').map((s) => s.id),
  );
  const activeTasks = tasks.filter((t) => !doneSwimlaneIds.has(t.swimlane_id)).length;

  // Aggregate token usage across all sessions
  const usageValues = Object.values(sessionUsage);
  const hasUsage = usageValues.length > 0;
  const totalInput = usageValues.reduce((sum, u) => sum + u.contextWindow.totalInputTokens, 0);
  const totalOutput = usageValues.reduce((sum, u) => sum + u.contextWindow.totalOutputTokens, 0);
  const totalCost = usageValues.reduce((sum, u) => sum + u.cost.totalCostUsd, 0);

  return (
    <div className="h-9 bg-zinc-900 border-t border-zinc-700 flex items-center px-3 text-xs text-zinc-500 select-none flex-shrink-0">
      {currentProject && (
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5" data-testid="session-count">
            <SquareTerminal size={14} className={activeSessions > 0 ? 'text-green-400' : 'text-zinc-500'} />
            <span className={activeSessions > 0 ? 'text-green-400' : ''}>
              {activeSessions} agents
            </span>
            {queued > 0 && <span className="text-yellow-400">({queued} queued)</span>}
          </span>
          <span className="flex items-center gap-1.5" data-testid="task-count">
            <ClipboardCheck size={14} />
            {activeTasks} tasks
          </span>
          {hasUsage && (
            <>
              <div className="w-px h-3.5 bg-zinc-700 flex-shrink-0" />
              <span className="tabular-nums" data-testid="aggregate-usage">
                {formatTokenCount(totalInput)} ↑ / {formatTokenCount(totalOutput)} ↓&nbsp;&nbsp;${totalCost.toFixed(2)}
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-4">
        {claudeInfo && (
          claudeInfo.found ? (
            <span className="px-2 py-1 rounded bg-zinc-800 text-zinc-500">{claudeVersionLabel}</span>
          ) : (
            <span className="text-red-400">claude not found</span>
          )
        )}
      </div>
    </div>
  );
}
