import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { useSessionStore } from '../../stores/session-store';
import type { SessionEvent } from '../../../shared/types';

// 8 distinct colors for session badges (Tailwind-ish)
const BADGE_COLORS = [
  'text-blue-400',
  'text-amber-400',
  'text-purple-400',
  'text-emerald-400',
  'text-rose-400',
  'text-cyan-400',
  'text-orange-400',
  'text-pink-400',
];

interface ActivityLogProps {
  active: boolean;
  sessionIds: string[];
  taskLabelMap: Map<string, string>;
}

export function ActivityLog({ active, sessionIds, taskLabelMap }: ActivityLogProps) {
  const sessionEvents = useSessionStore((s) => s.sessionEvents);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const colorMapRef = useRef(new Map<string, number>());
  const colorIndexRef = useRef(0);
  const [filterSessionId, setFilterSessionId] = useState<string | null>(null);

  // Auto-clear filter when the filtered session exits
  useEffect(() => {
    if (filterSessionId && !sessionIds.includes(filterSessionId)) {
      setFilterSessionId(null);
    }
  }, [filterSessionId, sessionIds]);

  // Stable color assignment per session
  const getColorIndex = (sessionId: string): number => {
    if (!colorMapRef.current.has(sessionId)) {
      colorMapRef.current.set(sessionId, colorIndexRef.current % BADGE_COLORS.length);
      colorIndexRef.current++;
    }
    return colorMapRef.current.get(sessionId)!;
  };

  // Filter to selected session or show all
  const effectiveSessionIds = useMemo(
    () => filterSessionId ? [filterSessionId] : sessionIds,
    [filterSessionId, sessionIds],
  );

  // Merge events from active sessions, sorted by timestamp
  const allEvents = useMemo(() => {
    const events: Array<{ sessionId: string; event: SessionEvent }> = [];
    for (const sid of effectiveSessionIds) {
      const evts = sessionEvents[sid] || [];
      for (const event of evts) {
        events.push({ sessionId: sid, event });
      }
    }
    events.sort((a, b) => a.event.ts - b.event.ts);
    return events;
  }, [effectiveSessionIds, sessionEvents]);

  // Cap display at last 500 events
  const displayEvents = useMemo(
    () => allEvents.length > 500 ? allEvents.slice(-500) : allEvents,
    [allEvents],
  );

  // Track scroll position — auto-scroll when at bottom
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  };

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [displayEvents.length]);

  const showFilter = sessionIds.length >= 2;
  const filteredLabel = filterSessionId
    ? taskLabelMap.get(filterSessionId) || filterSessionId.slice(0, 8)
    : null;

  if (displayEvents.length === 0) {
    return (
      <div className="h-full w-full bg-surface flex flex-col font-mono">
        {showFilter && (
          <FilterPill
            sessionIds={sessionIds}
            taskLabelMap={taskLabelMap}
            filterSessionId={filterSessionId}
            onFilter={setFilterSessionId}
          />
        )}
        <div className="flex-1 flex items-center justify-center text-fg-disabled text-sm">
          {filteredLabel
            ? `No activity yet for ${filteredLabel}...`
            : 'Waiting for agent activity...'}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`h-full w-full bg-surface overflow-y-auto font-mono text-xs leading-5 px-2 pb-2 ${showFilter ? 'pt-0' : 'pt-2'}`}
    >
      {showFilter && (
        <FilterPill
          sessionIds={sessionIds}
          taskLabelMap={taskLabelMap}
          filterSessionId={filterSessionId}
          onFilter={setFilterSessionId}
        />
      )}
      {displayEvents.map((item, i) => (
        <EventLine
          key={`${item.sessionId}-${item.event.ts}-${i}`}
          sessionId={item.sessionId}
          event={item.event}
          label={taskLabelMap.get(item.sessionId) || item.sessionId.slice(0, 8)}
          colorClass={BADGE_COLORS[getColorIndex(item.sessionId)]}
          showLabel={!filterSessionId && sessionIds.length > 1}
        />
      ))}
    </div>
  );
}

/* ── Filter Pill ── */

interface FilterPillProps {
  sessionIds: string[];
  taskLabelMap: Map<string, string>;
  filterSessionId: string | null;
  onFilter: (id: string | null) => void;
}

function FilterPill({
  sessionIds,
  taskLabelMap,
  filterSessionId,
  onFilter,
}: FilterPillProps) {
  return (
    <div className="sticky top-0 z-10 bg-surface pt-2 pb-1.5 mb-1 border-b border-edge">
      <div className="relative inline-block">
        <select
          data-testid="activity-filter"
          value={filterSessionId ?? ''}
          onChange={(e) => onFilter(e.target.value || null)}
          className="appearance-none bg-surface-raised text-fg-muted pl-2.5 pr-7 py-0.5 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All</option>
          {sessionIds.map((sid) => (
            <option key={sid} value={sid}>
              {taskLabelMap.get(sid) || sid.slice(0, 8)}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-fg-muted"
        />
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  return format(ts, 'HH:mm:ss');
}

interface EventLineProps {
  sessionId: string;
  event: SessionEvent;
  label: string;
  colorClass: string;
  showLabel: boolean;
}

function EventLine({ event, label, colorClass, showLabel }: EventLineProps) {
  switch (event.type) {
    case 'tool_start':
      return (
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-zinc-600 shrink-0">{formatTime(event.ts)}</span>
          {showLabel && <span className={`${colorClass} font-semibold shrink-0`}>[{label}]</span>}
          <span className="bg-surface-raised text-fg-secondary px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0">
            {event.tool || 'Tool'}
          </span>
          {event.detail && (
            <span className="text-fg-faint truncate min-w-0">{event.detail}</span>
          )}
        </div>
      );

    case 'tool_end':
      // tool_end is typically not shown — the tool_start line is sufficient.
      // Only render if there's no tool_start context (e.g., tool name only).
      return null;

    case 'interrupted':
      return (
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-zinc-600 shrink-0">{formatTime(event.ts)}</span>
          {showLabel && <span className={`${colorClass} font-semibold shrink-0`}>[{label}]</span>}
          <span className="bg-amber-900/30 text-amber-400 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0">
            {event.tool || 'Tool'} interrupted
          </span>
          {event.detail && (
            <span className="text-fg-faint truncate min-w-0">{event.detail}</span>
          )}
        </div>
      );

    case 'idle':
      return (
        <div className="flex items-baseline gap-1.5">
          <span className="text-zinc-600 shrink-0">{formatTime(event.ts)}</span>
          {showLabel && <span className={`${colorClass} font-semibold shrink-0`}>[{label}]</span>}
          <span className="text-fg-faint italic">Idle — waiting for input</span>
        </div>
      );

    case 'prompt':
      return (
        <div className="flex items-baseline gap-1.5">
          <span className="text-zinc-600 shrink-0">{formatTime(event.ts)}</span>
          {showLabel && <span className={`${colorClass} font-semibold shrink-0`}>[{label}]</span>}
          <span className="text-fg-muted">Thinking...</span>
        </div>
      );

    default:
      return null;
  }
}
