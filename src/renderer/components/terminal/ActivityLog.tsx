import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatTime } from '../../lib/datetime';
import { useSessionStore } from '../../stores/session-store';
import { ChevronDown } from 'lucide-react';
import { EventType, IdleReason } from '../../../shared/types';
import type { SessionEvent } from '../../../shared/types';

const MAX_RENDERED_EVENTS = 500;
const SCROLL_RETURN_DELAY_MS = 3000;
const PROMPT_DISPLAY_CHARS = 160;

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
  // Narrow selector: only re-render when events for visible sessions change.
  // useShallow compares each value by reference, so background session events
  // don't trigger re-renders here.
  const sessionEvents = useSessionStore(
    useShallow(
      useCallback((s) => {
        const result: Record<string, SessionEvent[]> = {};
        for (const sid of sessionIds) {
          const events = s.sessionEvents[sid];
          if (events) result[sid] = events;
        }
        return result;
      }, [sessionIds]),
    ),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const colorMapRef = useRef(new Map<string, number>());
  const colorIndexRef = useRef(0);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isSmoothScrollingRef = useRef(false);
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

  // Cap display at last N events
  const displayEvents = useMemo(
    () => allEvents.length > MAX_RENDERED_EVENTS ? allEvents.slice(-MAX_RENDERED_EVENTS) : allEvents,
    [allEvents],
  );

  // Last user prompt text for the sticky header
  const lastPromptText = useMemo(() => {
    for (let i = displayEvents.length - 1; i >= 0; i--) {
      const { event } = displayEvents[i];
      if (event.type === EventType.Prompt && event.detail) return event.detail;
    }
    return null;
  }, [displayEvents]);

  // Smooth-scroll back to bottom and re-enable auto-scroll
  const smoothScrollToBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    // Already at bottom -- just re-enable
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 1) {
      autoScrollRef.current = true;
      return;
    }
    isSmoothScrollingRef.current = true;
    autoScrollRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // Track scroll position -- auto-scroll when at bottom
  const handleScroll = () => {
    if (isSmoothScrollingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 1;
    autoScrollRef.current = atBottom;
  };

  const handleMouseEnter = () => {
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
      returnTimerRef.current = undefined;
    }
  };

  const handleMouseLeave = () => {
    if (!autoScrollRef.current) {
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
      returnTimerRef.current = setTimeout(() => {
        returnTimerRef.current = undefined;
        smoothScrollToBottom();
      }, SCROLL_RETURN_DELAY_MS);
    }
  };

  // Auto-scroll to bottom when new events arrive (only when visible)
  useEffect(() => {
    if (active && autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [active, displayEvents.length]);

  // Clear isSmoothScrollingRef when scroll animation finishes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onEnd = () => { isSmoothScrollingRef.current = false; };
    el.addEventListener('scrollend', onEnd);
    return () => el.removeEventListener('scrollend', onEnd);
  }, []);

  // Instant-scroll to bottom when switching to the Activity tab
  // Also resets the smooth-scrolling guard -- if a scroll was in progress
  // when the tab was hidden (display:none), scrollend won't fire.
  useEffect(() => {
    isSmoothScrollingRef.current = false;
    if (active && !autoScrollRef.current) {
      autoScrollRef.current = true;
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [active]);

  // Cleanup return timer on unmount
  useEffect(() => {
    return () => {
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    };
  }, []);

  const showFilter = sessionIds.length >= 2;
  const filteredLabel = filterSessionId
    ? taskLabelMap.get(filterSessionId) || filterSessionId.slice(0, 8)
    : null;

  if (displayEvents.length === 0) {
    return (
      <div className="h-full w-full bg-surface flex flex-col font-mono">
        {showFilter && (
          <div className="bg-surface border-b border-edge pt-2 pb-1.5 px-2">
            <div className="relative inline-block">
              <select
                data-testid="activity-filter"
                value={filterSessionId ?? ''}
                onChange={(e) => setFilterSessionId(e.target.value || null)}
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
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`h-full w-full bg-surface overflow-y-auto font-mono text-xs leading-5 px-2 pb-2 ${showFilter || lastPromptText ? 'pt-0' : 'pt-2'}`}
    >
      {/* Single sticky header — prompt banner and/or session filter (combined to avoid two sticky top-0 elements overlapping) */}
      {(lastPromptText || showFilter) && (
        <div className="sticky top-0 z-10 bg-surface border-b border-edge pt-2.5 pb-2 mb-1 shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
          {lastPromptText && (
            <div className={`flex items-start gap-2 border-l-2 border-sky-500 bg-sky-500/15 px-2 py-1.5 rounded-r min-w-0${showFilter ? ' mb-1.5' : ''}`}>
              <span className="text-sky-400 font-semibold text-[10px] uppercase tracking-wider shrink-0 mt-0.5 select-none">You</span>
              <span className="text-fg-tertiary text-xs leading-4 truncate min-w-0">
                {lastPromptText.length > PROMPT_DISPLAY_CHARS
                  ? lastPromptText.slice(0, PROMPT_DISPLAY_CHARS) + '…'
                  : lastPromptText}
              </span>
            </div>
          )}
          {showFilter && (
            <div className="relative inline-block">
              <select
                data-testid="activity-filter"
                value={filterSessionId ?? ''}
                onChange={(e) => setFilterSessionId(e.target.value || null)}
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
          )}
        </div>
      )}
      {displayEvents.map((item, i) => {
        const isPrompt = item.event.type === EventType.Prompt && !!item.event.detail;
        return (
          <Fragment key={`${item.sessionId}-${item.event.ts}-${i}`}>
            {isPrompt && i > 0 && <div className="border-t border-edge-subtle my-3" />}
            <EventLine
              sessionId={item.sessionId}
              event={item.event}
              label={taskLabelMap.get(item.sessionId) || item.sessionId.slice(0, 8)}
              colorClass={BADGE_COLORS[getColorIndex(item.sessionId)]}
              showLabel={!filterSessionId && sessionIds.length > 1}
            />
          </Fragment>
        );
      })}
    </div>
  );
}


interface EventLineProps {
  sessionId: string;
  event: SessionEvent;
  label: string;
  colorClass: string;
  showLabel: boolean;
}

/** User prompt block — sky blue, visually distinct from the activity stream. */
function PromptLine({ ts, label, colorClass, showLabel, text }: {
  ts: number; label: string; colorClass: string; showLabel: boolean; text: string;
}) {
  const displayText = text.length > PROMPT_DISPLAY_CHARS
    ? text.slice(0, PROMPT_DISPLAY_CHARS) + '…'
    : text;
  return (
    <div className="flex items-start gap-1.5 my-1.5 border-l-2 border-sky-500 bg-sky-500/15 pl-2 pr-1 py-1 rounded-r min-w-0">
      <span className="text-zinc-600 shrink-0 mt-0.5">{formatTime(ts)}</span>
      {showLabel && <span className={`${colorClass} font-semibold shrink-0 mt-0.5`}>[{label}]</span>}
      <div className="flex flex-col min-w-0">
        <span className="text-sky-400 font-semibold text-[10px] uppercase tracking-wider select-none leading-4">You</span>
        <span className="text-fg-tertiary leading-4 break-words">{displayText}</span>
      </div>
    </div>
  );
}

/** AI-ready line — emerald green, signals the agent has stopped and is waiting for input. */
function AiReadyLine({ ts, label, colorClass, showLabel }: {
  ts: number; label: string; colorClass: string; showLabel: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5 my-1 border-l-2 border-emerald-500 bg-emerald-500/10 pl-2 pr-1 py-0.5 rounded-r">
      <span className="text-zinc-600 shrink-0">{formatTime(ts)}</span>
      {showLabel && <span className={`${colorClass} font-semibold shrink-0`}>[{label}]</span>}
      <span className="bg-emerald-900/30 text-emerald-400 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 select-none">AI Ready</span>
    </div>
  );
}

/** Dim italic text line (no detail). */
function DimLine({ ts, label, colorClass, showLabel, text, tinted = false }: {
  ts: number; label: string; colorClass: string; showLabel: boolean; text: string; tinted?: boolean;
}) {
  return (
    <div className={`flex items-baseline gap-1.5${tinted ? ' border-l-2 border-violet-500 bg-violet-500/[0.08] pl-2 pr-1 py-0.5 rounded-r' : ''}`}>
      <span className="text-zinc-600 shrink-0">{formatTime(ts)}</span>
      {showLabel && <span className={`${colorClass} font-semibold shrink-0`}>[{label}]</span>}
      <span className="text-fg-faint italic">{text}</span>
    </div>
  );
}

/** Dim italic text line with optional trailing detail. */
function DimDetailLine({ ts, label, colorClass, showLabel, text, detail, tinted = false }: {
  ts: number; label: string; colorClass: string; showLabel: boolean; text: string; detail?: string; tinted?: boolean;
}) {
  return (
    <div className={`flex items-baseline gap-1.5 min-w-0${tinted ? ' border-l-2 border-violet-500 bg-violet-500/[0.08] pl-2 pr-1 py-0.5 rounded-r' : ''}`}>
      <span className="text-zinc-600 shrink-0">{formatTime(ts)}</span>
      {showLabel && <span className={`${colorClass} font-semibold shrink-0`}>[{label}]</span>}
      <span className="text-fg-faint italic">{text}</span>
      {detail && <span className="text-fg-faint truncate min-w-0">{detail}</span>}
    </div>
  );
}

/** Badge line: colored pill label with optional trailing detail. */
function BadgeLine({ ts, label, colorClass, showLabel, badge, detail, variant = 'default', tinted = false }: {
  ts: number; label: string; colorClass: string; showLabel: boolean;
  badge: string; detail?: string; variant?: 'default' | 'warn'; tinted?: boolean;
}) {
  const badgeClass = variant === 'warn'
    ? 'bg-amber-900/30 text-amber-400'
    : tinted
      ? 'bg-violet-900/40 text-violet-300'
      : 'bg-surface-raised text-fg-secondary';
  return (
    <div className={`flex items-baseline gap-1.5 min-w-0${tinted ? ' border-l-2 border-violet-500 bg-violet-500/[0.08] pl-2 pr-1 py-0.5 rounded-r my-0.5' : ''}`}>
      <span className="text-zinc-600 shrink-0">{formatTime(ts)}</span>
      {showLabel && <span className={`${colorClass} font-semibold shrink-0`}>[{label}]</span>}
      <span className={`${badgeClass} px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 select-none`}>
        {badge}
      </span>
      {detail && <span className="text-fg-faint truncate min-w-0">{detail}</span>}
    </div>
  );
}

function EventLine({ event, label, colorClass, showLabel }: EventLineProps) {
  const common = { ts: event.ts, label, colorClass, showLabel };

  switch (event.type) {
    case EventType.ToolStart:
      return <BadgeLine {...common} badge={event.tool || 'Tool'} detail={event.detail} tinted />;

    case EventType.ToolEnd:
      return null;

    case EventType.Interrupted:
      return <BadgeLine {...common} badge={`${event.tool || 'Tool'} interrupted`} detail={event.detail} variant="warn" />;

    case EventType.Idle:
      return event.detail === IdleReason.Timeout
        ? <DimLine {...common} text="Idle (no activity detected)" tinted />
        : <AiReadyLine {...common} />;

    case EventType.Prompt:
      return event.detail
        ? <PromptLine {...common} text={event.detail} />
        : <DimLine {...common} text="Thinking..." tinted />;

    case EventType.SessionStart:
      return <DimLine {...common} text="Session started" />;

    case EventType.SessionEnd:
      return <DimLine {...common} text="Session ended" />;

    case EventType.SubagentStart:
      return <BadgeLine {...common} badge="Subagent" detail={event.detail} tinted />;

    case EventType.SubagentStop:
      return <BadgeLine {...common} badge="Subagent done" detail={event.detail} tinted />;

    case EventType.Notification:
      return <BadgeLine {...common} badge="Notice" detail={event.detail} variant="warn" />;

    case EventType.Compact:
      return <DimLine {...common} text="Compacting context..." tinted />;

    case EventType.TeammateIdle:
      return <DimDetailLine {...common} text="Teammate idle" detail={event.detail} />;

    case EventType.TaskCompleted:
      return <BadgeLine {...common} badge="Task done" detail={event.detail} />;

    case EventType.ConfigChange:
      return <DimLine {...common} text="Config changed" />;

    case EventType.WorktreeCreate:
      return <BadgeLine {...common} badge="Worktree" detail={event.detail} />;

    case EventType.WorktreeRemove:
      return <DimDetailLine {...common} text="Worktree removed" detail={event.detail} />;

    default:
      return null;
  }
}
