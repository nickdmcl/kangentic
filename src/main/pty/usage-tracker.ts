import fs from 'node:fs';
import { EventType, EventTypeActivity, AgentTool } from '../../shared/types';
import type { SessionUsage, ActivityState, SessionEvent, AgentParser } from '../../shared/types';
import { matchesPRCommand } from './pr-connectors';
import { PtyActivityTracker } from './pty-activity-tracker';

const MAX_EVENTS_PER_SESSION = 500; // Cap rendered events in renderer
const STALE_THINKING_THRESHOLD_MS = 45_000;
const STALE_THINKING_CHECK_MS = 15_000;

interface UsageTrackerCallbacks {
  onUsageChange(sessionId: string, usage: SessionUsage): void;
  onActivityChange(sessionId: string, activity: ActivityState, permissionIdle: boolean): void;
  onEvent(sessionId: string, event: SessionEvent): void;
  onIdleTimeout(sessionId: string): void;
  onPlanExit(sessionId: string): void;
  onPRCandidate(sessionId: string): void;
  /** Called when the agent reports its own session_id (from status.json). */
  onAgentSessionId?(sessionId: string, agentReportedId: string): void;
  requestSuspend(sessionId: string): void;
  isSessionRunning(sessionId: string): boolean;
}

/**
 * Tracks per-session usage data, activity state machine, and event log.
 *
 * Owns all caches (usage, activity, events) and timing logic (idle timeouts,
 * stale thinking detection). SessionManager wires callbacks in its constructor.
 */
export class UsageTracker {
  private usageCache = new Map<string, SessionUsage>();
  private activityCache = new Map<string, ActivityState>();
  private subagentDepth = new Map<string, number>();
  private pendingToolCount = new Map<string, number>();
  private pendingIdleWhileSubagent = new Map<string, boolean>();
  private pendingPRCommand = new Map<string, boolean>();
  private permissionIdle = new Map<string, boolean>();
  private idleTimestamp = new Map<string, number>();
  private lastThinkingSignal = new Map<string, number>();
  private firstThinkingTimestamp = new Map<string, number>();

  private sessionParsers = new Map<string, AgentParser>();
  private agentSessionIdChecked = new Set<string>();
  private eventCache = new Map<string, SessionEvent[]>();
  private _idleTimeoutMinutes = 0;
  private idleTimeoutInterval: ReturnType<typeof setInterval> | null = null;
  private staleThinkingInterval: ReturnType<typeof setInterval> | null = null;

  private callbacks: UsageTrackerCallbacks;
  private ptyTracker: PtyActivityTracker;

  constructor(callbacks: UsageTrackerCallbacks) {
    this.callbacks = callbacks;
    this.ptyTracker = new PtyActivityTracker({
      onThinking: (sessionId) => this.handlePtyThinking(sessionId),
      onIdle: (sessionId, detail) => this.handlePtyIdle(sessionId, detail),
      getActivity: (sessionId) => this.activityCache.get(sessionId),
      isSessionRunning: (sessionId) => callbacks.isSessionRunning(sessionId),
    });
    this.staleThinkingInterval = setInterval(
      () => this.checkStaleThinking(),
      STALE_THINKING_CHECK_MS,
    );
    this.staleThinkingInterval.unref();
  }

  get idleTimeoutMinutes(): number {
    return this._idleTimeoutMinutes;
  }

  setIdleTimeout(minutes: number): void {
    this._idleTimeoutMinutes = minutes;

    // Clear existing interval
    if (this.idleTimeoutInterval) {
      clearInterval(this.idleTimeoutInterval);
      this.idleTimeoutInterval = null;
    }

    // Start checking every 60s if timeout is enabled.
    // unref() ensures this interval doesn't keep the process alive during shutdown.
    if (minutes > 0) {
      this.idleTimeoutInterval = setInterval(() => this.checkIdleTimeouts(), 60_000);
      this.idleTimeoutInterval.unref();
    }
  }

  private checkIdleTimeouts(): void {
    if (this._idleTimeoutMinutes <= 0) return;

    const timeoutMs = this._idleTimeoutMinutes * 60_000;
    const now = Date.now();

    for (const [sessionId, activity] of this.activityCache) {
      if (activity !== 'idle') continue;
      if (!this.callbacks.isSessionRunning(sessionId)) continue;

      const idleStart = this.idleTimestamp.get(sessionId);
      if (idleStart && (now - idleStart) > timeoutMs) {
        this.callbacks.requestSuspend(sessionId);
        this.callbacks.onIdleTimeout(sessionId);
      }
    }
  }

  private checkStaleThinking(): void {
    const now = Date.now();
    for (const [sessionId, activity] of this.activityCache) {
      if (activity !== 'thinking') continue;
      if (!this.callbacks.isSessionRunning(sessionId)) continue;

      // Skip sessions still in nucleation (first 45s after entering thinking).
      // During nucleation, agents read local context before making API calls.
      // No hooks fire initially, so the stale threshold doesn't apply yet.
      // Time-based guard works for all agents (not just Claude Code which has usageCache).
      const firstThinking = this.firstThinkingTimestamp.get(sessionId);
      if (firstThinking && (now - firstThinking) < STALE_THINKING_THRESHOLD_MS) continue;

      const lastSignal = this.lastThinkingSignal.get(sessionId);
      if (lastSignal && (now - lastSignal) > STALE_THINKING_THRESHOLD_MS) {
        // If tools are in-flight, the agent is busy (not stale). Reset the
        // timer and re-check later instead of transitioning to idle.
        if ((this.pendingToolCount.get(sessionId) || 0) > 0) {
          this.lastThinkingSignal.set(sessionId, now);
          continue;
        }

        this.activityCache.set(sessionId, 'idle');
        this.permissionIdle.set(sessionId, false);
        this.idleTimestamp.set(sessionId, Date.now());
        this.lastThinkingSignal.delete(sessionId);

        // Emit a synthetic idle event so the activity log shows why it went idle
        const timeoutEvent: SessionEvent = { ts: Date.now(), type: EventType.Idle, detail: 'timeout' };
        let events = this.eventCache.get(sessionId);
        if (!events) {
          events = [];
          this.eventCache.set(sessionId, events);
        }
        events.push(timeoutEvent);
        this.callbacks.onEvent(sessionId, timeoutEvent);

        this.callbacks.onActivityChange(sessionId, 'idle', false);
      }
    }
  }

  /**
   * Read and emit usage data from a session's status output file.
   * Shared by both the fs.watch callback and polling fallback.
   */
  readAndEmitUsage(sessionId: string, statusOutputPath: string): void {
    try {
      const raw = fs.readFileSync(statusOutputPath, 'utf-8');
      const parser = this.sessionParsers.get(sessionId);
      const usage = parser?.parseStatus(raw) ?? null;
      if (!usage) return;

      // Extract agent-reported session_id from raw status.json for stale ID recovery.
      // Only check once per session - after the first status update the DB is corrected
      // and subsequent calls would be no-op lookups.
      if (this.callbacks.onAgentSessionId && !this.agentSessionIdChecked.has(sessionId)) {
        this.agentSessionIdChecked.add(sessionId);
        if (usage.sessionId && typeof usage.sessionId === 'string') {
          this.callbacks.onAgentSessionId(sessionId, usage.sessionId);
        }
      }

      const previousUsage = this.usageCache.get(sessionId);

      this.usageCache.set(sessionId, usage);
      this.callbacks.onUsageChange(sessionId, usage);

      // Usage update proves the agent is working. Reset stale thinking timer.
      if (this.activityCache.get(sessionId) === 'thinking') {
        this.lastThinkingSignal.set(sessionId, Date.now());
      }

      // Heartbeat recovery: if tokens increased while idle for >1s, agent resumed work.
      // During any true idle, the model is blocked and token counts are frozen.
      // Only when work genuinely resumes do tokens climb. The 1-second grace period
      // prevents race conditions from status updates arriving slightly after an idle event.
      if (previousUsage && this.activityCache.get(sessionId) === 'idle') {
        const previousTokens = previousUsage.contextWindow.totalInputTokens
                             + previousUsage.contextWindow.totalOutputTokens;
        const currentTokens = usage.contextWindow.totalInputTokens
                            + usage.contextWindow.totalOutputTokens;
        const idleStart = this.idleTimestamp.get(sessionId);
        if (currentTokens > previousTokens && idleStart && (Date.now() - idleStart) > 1000) {
          this.activityCache.set(sessionId, 'thinking');
          this.lastThinkingSignal.set(sessionId, Date.now());
          this.idleTimestamp.delete(sessionId);
          this.permissionIdle.delete(sessionId);
          this.callbacks.onActivityChange(sessionId, 'thinking', false);
        }
      }
    } catch {
      // File may not exist yet - ignore
    }
  }

  /**
   * Read new lines from a session's events JSONL file and process them.
   * Uses eventsFileOffset as cursor - safe to call from multiple triggers.
   * Returns the new file offset.
   */
  readAndProcessEvents(sessionId: string, eventsOutputPath: string, fileOffset: number): number {
    try {
      const stat = fs.statSync(eventsOutputPath);
      if (stat.size <= fileOffset) return fileOffset;

      const fd = fs.openSync(eventsOutputPath, 'r');
      const buf = Buffer.alloc(stat.size - fileOffset);
      fs.readSync(fd, buf, 0, buf.length, fileOffset);
      fs.closeSync(fd);
      const newOffset = stat.size;

      const chunk = buf.toString('utf-8');
      const lines = chunk.split('\n').filter(Boolean);

      // Get or create event cache for this session
      let events = this.eventCache.get(sessionId);
      if (!events) {
        events = [];
        this.eventCache.set(sessionId, events);
      }

      const parser = this.sessionParsers.get(sessionId);
      for (const line of lines) {
        // Extract agent session ID from hookContext (written by event-bridge.js).
        // Each adapter's runtime.sessionId.fromHook() parses agent-specific fields.
        const fromHook = parser?.runtime?.sessionId?.fromHook;
        if (!this.agentSessionIdChecked.has(sessionId) && fromHook) {
          try {
            const rawEvent = JSON.parse(line);
            if (rawEvent.hookContext) {
              const capturedId = fromHook(rawEvent.hookContext);
              if (capturedId) {
                this.agentSessionIdChecked.add(sessionId);
                this.callbacks.onAgentSessionId?.(sessionId, capturedId);
              }
            }
          } catch { /* best effort - line may not be valid JSON */ }
        }

        const event = parser?.parseEvent(line) ?? null;
        if (event) {
          // Any event proves the agent is alive. Reset stale thinking timer.
          if (this.activityCache.get(sessionId) === 'thinking') {
            this.lastThinkingSignal.set(sessionId, Date.now());
          }

          events.push(event);
          this.callbacks.onEvent(sessionId, event);

          // Track pending tool count so checkStaleThinking() knows when
          // a long-running tool (e.g. npm run build) is legitimately active.
          if (event.type === EventType.ToolStart) {
            const currentCount = this.pendingToolCount.get(sessionId) || 0;
            this.pendingToolCount.set(sessionId, currentCount + 1);
          } else if (event.type === EventType.ToolEnd || event.type === EventType.Interrupted) {
            const currentCount = this.pendingToolCount.get(sessionId) || 0;
            this.pendingToolCount.set(sessionId, Math.max(0, currentCount - 1));
          }

          // Detect ExitPlanMode -> emit plan-exit
          // Uses ToolStart (PreToolUse) because ExitPlanMode is a mode-transition
          // tool that may not fire PostToolUse (ToolEnd).
          if (event.type === EventType.ToolStart && event.tool === AgentTool.ExitPlanMode) {
            this.callbacks.onPlanExit(sessionId);
          }

          // Detect GitHub PR commands -> scan scrollback on tool_end.
          // On tool_start for Bash with a gh pr command, set a flag.
          // On the corresponding tool_end, fire the callback so the
          // session manager can scan scrollback for PR URLs.
          if (event.type === EventType.ToolStart
              && event.tool === AgentTool.Bash
              && event.detail
              && matchesPRCommand(event.detail)) {
            this.pendingPRCommand.set(sessionId, true);
          } else if (event.type === EventType.ToolEnd
              && event.tool === AgentTool.Bash
              && this.pendingPRCommand.get(sessionId)) {
            this.pendingPRCommand.delete(sessionId);
            this.callbacks.onPRCandidate(sessionId);
          }

          // Track subagent nesting depth so we can distinguish main-agent
          // tool events from subagent tool events during idle state.
          if (event.type === EventType.SubagentStart) {
            const currentDepth = this.subagentDepth.get(sessionId) || 0;
            this.subagentDepth.set(sessionId, currentDepth + 1);
          } else if (event.type === EventType.SubagentStop) {
            const currentDepth = this.subagentDepth.get(sessionId) || 0;
            const newDepth = Math.max(0, currentDepth - 1);
            this.subagentDepth.set(sessionId, newDepth);

            // Emit deferred idle when the last subagent finishes
            if (newDepth === 0 && this.pendingIdleWhileSubagent.get(sessionId)) {
              this.pendingIdleWhileSubagent.delete(sessionId);
              if (this.activityCache.get(sessionId) !== 'idle') {
                this.activityCache.set(sessionId, 'idle');
                this.callbacks.onActivityChange(sessionId, 'idle', false);
              }
            }
          }

          // Derive activity state from events via declarative lookup.
          // Only emit when state actually changes (dedup defense-in-depth
          // against multiple hooks firing the same state).
          const newActivity = EventTypeActivity[event.type];

          // For 'hooks_and_pty' agents, suppress PTY detection once hooks
          // prove they work (by delivering at least one thinking event).
          // Pure 'pty' agents never get hook events; pure 'hooks' agents
          // don't have PTY detection enabled.
          if (newActivity === 'thinking') {
            const parser = this.sessionParsers.get(sessionId);
            if (parser?.runtime?.activity?.kind === 'hooks_and_pty') {
              this.ptyTracker.suppress(sessionId);
            }
          }

          // Clear pending idle flag when the main agent resumes thinking
          // (prompt or subagent_start), even if deduped.
          if (newActivity === 'thinking'
              && (event.type === EventType.Prompt
                  || event.type === EventType.SubagentStart
                  || (this.subagentDepth.get(sessionId) || 0) === 0)) {
            this.pendingIdleWhileSubagent.delete(sessionId);
          }

          if (newActivity && this.activityCache.get(sessionId) !== newActivity) {
            // Subagent-aware transition guard: when transitioning from
            // idle -> thinking, suppress the transition if it's caused by
            // a subagent's tool event (not the main agent resuming).
            const currentActivity = this.activityCache.get(sessionId);
            const depth = this.subagentDepth.get(sessionId) || 0;
            if (currentActivity === 'idle' && newActivity === 'thinking'
                && event.type !== EventType.Prompt
                && event.type !== EventType.SubagentStart
                && depth > 0) {
              // Suppress: subagent tool event while main agent is idle
              continue;
            }

            // Guard 2: thinking -> idle suppression while subagents are active.
            if (currentActivity === 'thinking' && newActivity === 'idle'
                && event.type !== EventType.Interrupted
                && event.detail !== 'permission'
                && depth > 0) {
              this.pendingIdleWhileSubagent.set(sessionId, true);
              continue;
            }

            // Clear stale pending idle when permission idle bypasses Guard 2
            if (newActivity === 'idle' && event.detail === 'permission') {
              this.pendingIdleWhileSubagent.delete(sessionId);
            }

            this.activityCache.set(sessionId, newActivity);

            // Track permission-idle flag and idle timestamp for recovery
            if (newActivity === 'idle') {
              this.lastThinkingSignal.delete(sessionId);
              this.permissionIdle.set(sessionId, event.detail === 'permission');
              this.idleTimestamp.set(sessionId, Date.now());
            } else if (newActivity === 'thinking') {
              this.lastThinkingSignal.set(sessionId, Date.now());
              if (!this.firstThinkingTimestamp.has(sessionId)) {
                this.firstThinkingTimestamp.set(sessionId, Date.now());
              }
              this.permissionIdle.delete(sessionId);
              this.idleTimestamp.delete(sessionId);
            }

            this.callbacks.onActivityChange(sessionId, newActivity, newActivity === 'idle' && event.detail === 'permission');
          }
        }
      }

      // Cap cached events per session
      if (events.length > MAX_EVENTS_PER_SESSION) {
        const trimmed = events.slice(-MAX_EVENTS_PER_SESSION);
        this.eventCache.set(sessionId, trimmed);
      }

      return newOffset;
    } catch {
      // File may not exist yet, or be partially written - ignore
      return fileOffset;
    }
  }

  /**
   * Initialize tracking state for a new session.
   * Sets default activity to 'idle' and clears all tracking maps.
   */
  initSession(sessionId: string, agentParser?: AgentParser): void {
    if (agentParser) {
      this.sessionParsers.set(sessionId, agentParser);
    }
    this.activityCache.set(sessionId, 'idle');
    this.subagentDepth.delete(sessionId);
    this.pendingToolCount.delete(sessionId);
    this.pendingIdleWhileSubagent.delete(sessionId);
    this.permissionIdle.delete(sessionId);
    this.idleTimestamp.set(sessionId, Date.now());
    this.lastThinkingSignal.delete(sessionId);
    this.firstThinkingTimestamp.delete(sessionId);
    this.ptyTracker.clearSession(sessionId);
    this.callbacks.onActivityChange(sessionId, 'idle', false);
  }

  /** True if an agent session ID has already been captured for this session. */
  hasAgentSessionId(sessionId: string): boolean {
    return this.agentSessionIdChecked.has(sessionId);
  }

  /**
   * Notify that an agent session ID was captured from PTY output.
   * Called by SessionManager when an adapter's runtime.sessionId.fromOutput
   * returns a non-null value. Delegates to the same callback used for
   * hook-based and status.json-based capture.
   */
  notifyAgentSessionId(sessionId: string, agentReportedId: string): void {
    if (!this.agentSessionIdChecked.has(sessionId)) {
      this.agentSessionIdChecked.add(sessionId);
      this.callbacks.onAgentSessionId?.(sessionId, agentReportedId);
    }
  }

  /**
   * Inject a synthetic session_end event into the event cache and emit it.
   * Claude Code's SessionEnd hook won't fire when we kill the PTY, so we
   * synthesize one ourselves so the activity log always shows session end.
   */
  emitSessionEnd(sessionId: string): void {
    let events = this.eventCache.get(sessionId);
    // Skip if the last event is already session_end (Claude Code may have fired it)
    if (events && events.length > 0 && events[events.length - 1].type === EventType.SessionEnd) {
      return;
    }
    const event: SessionEvent = { ts: Date.now(), type: EventType.SessionEnd };
    if (!events) {
      events = [];
      this.eventCache.set(sessionId, events);
    }
    events.push(event);
    this.callbacks.onEvent(sessionId, event);
  }

  /** Check if a PR command was flagged but ToolEnd was never processed. */
  hasPendingPRCommand(sessionId: string): boolean {
    return this.pendingPRCommand.get(sessionId) === true;
  }

  /** Clear the pending PR command flag (used by fallback scan on exit). */
  clearPendingPRCommand(sessionId: string): void {
    this.pendingPRCommand.delete(sessionId);
  }

  /** Clear subagent depth and pending state (used by suspend). */
  clearSessionTracking(sessionId: string): void {
    this.subagentDepth.delete(sessionId);
    this.pendingToolCount.delete(sessionId);
    this.pendingIdleWhileSubagent.delete(sessionId);
    this.pendingPRCommand.delete(sessionId);
    this.permissionIdle.delete(sessionId);
    this.idleTimestamp.delete(sessionId);
    this.lastThinkingSignal.delete(sessionId);
    this.firstThinkingTimestamp.delete(sessionId);
    this.ptyTracker.clearSession(sessionId);
  }

  /** Delete all maps for a session (full removal). */
  removeSession(sessionId: string): void {
    this.usageCache.delete(sessionId);
    this.activityCache.delete(sessionId);
    this.subagentDepth.delete(sessionId);
    this.pendingToolCount.delete(sessionId);
    this.pendingIdleWhileSubagent.delete(sessionId);
    this.permissionIdle.delete(sessionId);
    this.idleTimestamp.delete(sessionId);
    this.lastThinkingSignal.delete(sessionId);
    this.firstThinkingTimestamp.delete(sessionId);
    this.ptyTracker.clearSession(sessionId);
    this.eventCache.delete(sessionId);
    this.sessionParsers.delete(sessionId);
    this.agentSessionIdChecked.delete(sessionId);
  }

  // -- PTY-based activity detection (delegated to PtyActivityTracker) --------

  /** Forward PTY data to the tracker. Called by SessionManager for agents
   *  with 'pty' or 'hooks_and_pty' activity strategies. */
  notifyPtyData(sessionId: string): void {
    this.ptyTracker.onData(sessionId);
  }

  /** Forward definitive idle signal to the tracker. */
  notifyPtyIdle(sessionId: string): void {
    this.ptyTracker.onIdleDetected(sessionId);
  }

  /** Callback from PtyActivityTracker: PTY data indicates agent is working. */
  private handlePtyThinking(sessionId: string): void {
    this.activityCache.set(sessionId, 'thinking');
    this.lastThinkingSignal.set(sessionId, Date.now());
    if (!this.firstThinkingTimestamp.has(sessionId)) {
      this.firstThinkingTimestamp.set(sessionId, Date.now());
    }
    this.idleTimestamp.delete(sessionId);
    this.permissionIdle.delete(sessionId);

    const event: SessionEvent = { ts: Date.now(), type: EventType.Prompt, detail: 'pty-activity' };
    this.pushEvent(sessionId, event);
    this.callbacks.onActivityChange(sessionId, 'thinking', false);
  }

  /** Callback from PtyActivityTracker: silence or prompt detected. */
  private handlePtyIdle(sessionId: string, detail: string): void {
    this.activityCache.set(sessionId, 'idle');
    this.permissionIdle.set(sessionId, false);
    this.idleTimestamp.set(sessionId, Date.now());
    this.lastThinkingSignal.delete(sessionId);

    const event: SessionEvent = { ts: Date.now(), type: EventType.Idle, detail };
    this.pushEvent(sessionId, event);
    this.callbacks.onActivityChange(sessionId, 'idle', false);
  }

  /** Append an event to the session cache and notify listeners. */
  private pushEvent(sessionId: string, event: SessionEvent): void {
    let events = this.eventCache.get(sessionId);
    if (!events) { events = []; this.eventCache.set(sessionId, events); }
    events.push(event);
    this.callbacks.onEvent(sessionId, event);
  }

  dispose(): void {
    if (this.idleTimeoutInterval) {
      clearInterval(this.idleTimeoutInterval);
      this.idleTimeoutInterval = null;
    }
    if (this.staleThinkingInterval) {
      clearInterval(this.staleThinkingInterval);
      this.staleThinkingInterval = null;
    }
    this.ptyTracker.dispose();
  }

  /** Return cached usage data for all sessions. */
  getUsageCache(): Record<string, SessionUsage> {
    const result: Record<string, SessionUsage> = {};
    for (const [id, usage] of this.usageCache) {
      result[id] = usage;
    }
    return result;
  }

  /** Return cached activity state for all sessions. */
  getActivityCache(): Record<string, ActivityState> {
    const result: Record<string, ActivityState> = {};
    for (const [id, state] of this.activityCache) {
      result[id] = state;
    }
    return result;
  }

  /** Return cached events for a specific session. */
  getEventsForSession(sessionId: string): SessionEvent[] {
    return this.eventCache.get(sessionId) || [];
  }

  /** Return cached events for all sessions. */
  getEventsCache(): Record<string, SessionEvent[]> {
    const result: Record<string, SessionEvent[]> = {};
    for (const [id, events] of this.eventCache) {
      result[id] = events;
    }
    return result;
  }
}
