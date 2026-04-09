import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Activity,
  EventType,
  AgentTool,
  type SessionHistoryParseResult,
  type SessionUsage,
  type SessionEvent,
} from '../../../../shared/types';

/**
 * Parser for Codex CLI's native session history files (rollout JSONL).
 *
 * Path: `~/.codex/sessions/<UTC-YYYY>/<MM>/<DD>/rollout-<ts>-<sessionId>.jsonl`
 *
 * File format: append-only JSONL, one JSON object per line. Each entry
 * has `timestamp`, `type`, and `payload` fields. Recognized types we care
 * about for telemetry:
 *
 * - `session_meta`     → session UUID + cli_version + cwd (line 1)
 * - `task_started`     → `model_context_window` (context window size)
 *                        + triggers Activity.Thinking
 * - `turn_context`     → `model` field, follows mid-session `/model` changes
 * - `token_count`      → `info.total_token_usage` (input/output/cached totals)
 * - `task_complete`    → triggers Activity.Idle
 * - `response_item`    → `type: "function_call"` → SessionEvent ToolStart/ToolEnd
 *
 * All other entries are ignored. Defensive parsing throughout: any
 * malformed line is skipped without throwing.
 *
 * Cross-platform: uses os.homedir() + path.join for all filesystem
 * operations. No shell-outs. CRLF-tolerant line splitting.
 */
export class CodexSessionHistoryParser {
  /**
   * Locate the rollout JSONL file for a known session UUID. Called after
   * the PTY scraper captures the session ID. Polls for up to 5 seconds
   * (disk write latency varies on slow storage).
   *
   * The filename suffix contains the session UUID, so a single
   * readdirSync + regex match is sufficient - no cross-session ambiguity.
   */
  static async locate(options: {
    agentSessionId: string;
    cwd: string;
  }): Promise<string | null> {
    const { agentSessionId } = options;
    // UTC date for the directory structure. Codex writes the file under
    // the current UTC date regardless of local timezone.
    const directory = codexSessionsDirForToday();
    // Embed the session UUID in the filename regex. Codex writes:
    //   rollout-<ISO-timestamp>-<sessionUUID>.jsonl
    // We don't know the timestamp prefix, but the UUID suffix is unique.
    const escapedId = agentSessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^rollout-.*-${escapedId}\\.jsonl$`);

    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const found = findMatchingFile(directory, pattern);
      if (found) return found;
      // On the first attempt, also check yesterday's dir in case the
      // session spans a UTC date rollover.
      if (attempt === 0) {
        const yesterday = codexSessionsDirForYesterday();
        if (yesterday !== directory) {
          const foundYesterday = findMatchingFile(yesterday, pattern);
          if (foundYesterday) return foundYesterday;
        }
      }
      await sleep(500);
    }
    return null;
  }

  /**
   * Parse newly-appended JSONL content (for append-only mode, Codex
   * isFullRewrite === false). Walks the entries in order and builds a
   * consolidated SessionHistoryParseResult representing the state after this
   * chunk. Usage fields are last-wins; events are append-only.
   */
  static parse(content: string, _mode: 'full' | 'append'): SessionHistoryParseResult {
    // State we accumulate across this chunk. Usage starts empty and
    // only gets populated if we see a relevant event.
    let modelId: string | undefined;
    let contextWindowSize: number | undefined;
    let totalInputTokens: number | undefined;
    let totalOutputTokens: number | undefined;
    let cachedInputTokens: number | undefined;
    const events: SessionEvent[] = [];
    let activity: Activity | null = null;

    // CRLF-tolerant split. Drops empty lines (final \n produces one).
    const lines = content.split(/\r?\n/).filter((line) => line.length > 0);

    for (const line of lines) {
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        // Malformed line (partial write mid-flush, corruption) - skip.
        continue;
      }
      if (!isRecord(entry)) continue;

      const entryType = entry.type;
      const payload = entry.payload;
      const timestamp = parseTimestamp(entry.timestamp);

      if (entryType === 'turn_context' && isRecord(payload)) {
        const model = payload.model;
        if (typeof model === 'string' && model.length > 0) {
          modelId = model;
        }
      } else if (entryType === 'task_started' && isRecord(payload)) {
        const windowSize = payload.model_context_window;
        if (typeof windowSize === 'number' && windowSize > 0) {
          contextWindowSize = windowSize;
        }
        // task_started = agent is actively working on a turn.
        activity = Activity.Thinking;
      } else if (entryType === 'token_count' && isRecord(payload)) {
        const info = payload.info;
        if (isRecord(info)) {
          // IMPORTANT: use `last_token_usage`, NOT `total_token_usage`.
          // `total_token_usage.input_tokens` is cumulative billed input
          // across all turns and grows without bound. `last_token_usage`
          // is a per-turn snapshot of what was sent to the model on the
          // most recent turn, which is the authoritative measure of
          // current context occupancy. Verified empirically:
          //   total: 11214 → 22447 → 33693 (cumulative)
          //   last:  11214 → 11233 → 11246 (current context, grows slowly)
          // Using total would make the context % bar climb past 100% on
          // long sessions even though actual context barely changed.
          const lastTurn = info.last_token_usage;
          if (isRecord(lastTurn)) {
            const input = lastTurn.input_tokens;
            const output = lastTurn.output_tokens;
            const cached = lastTurn.cached_input_tokens;
            if (typeof input === 'number') totalInputTokens = input;
            if (typeof output === 'number') totalOutputTokens = output;
            if (typeof cached === 'number') cachedInputTokens = cached;
          }
          // task_started may have been missed if we joined mid-session;
          // prefer the live model_context_window if it's here too.
          const windowSize = info.model_context_window;
          if (typeof windowSize === 'number' && windowSize > 0) {
            contextWindowSize = windowSize;
          }
        }
      } else if (entryType === 'task_complete') {
        // Turn ended - agent is idle waiting for next prompt.
        activity = Activity.Idle;
      } else if (entryType === 'response_item' && isRecord(payload)) {
        const responseType = payload.type;
        if (responseType === 'function_call') {
          const toolName = typeof payload.name === 'string' ? payload.name : 'function';
          events.push({
            ts: timestamp,
            type: EventType.ToolStart,
            tool: mapCodexToolName(toolName),
            detail: toolName,
          });
        }
      }
    }

    // Build usage if we captured any token/model signal in this chunk.
    const usage = buildUsage({
      modelId,
      contextWindowSize,
      totalInputTokens,
      totalOutputTokens,
      cachedInputTokens,
    });

    return { usage, events, activity };
  }
}

// ---------- Internal helpers ----------

/** Type guard for a plain JSON object (not null, not array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse an ISO timestamp string into epoch ms; fall back to Date.now() on bad input. */
function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Compute `~/.codex/sessions/<YYYY>/<MM>/<DD>/` using the current UTC
 * date. Cross-platform path construction via path.join.
 */
function codexSessionsDirForToday(): string {
  const now = new Date();
  return codexSessionsDirForDate(now);
}

function codexSessionsDirForYesterday(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return codexSessionsDirForDate(yesterday);
}

function codexSessionsDirForDate(date: Date): string {
  // toISOString() always returns UTC; slice(0, 10) → "YYYY-MM-DD".
  const iso = date.toISOString();
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const day = iso.slice(8, 10);
  return path.join(os.homedir(), '.codex', 'sessions', year, month, day);
}

/**
 * Find the first file in `directory` whose basename matches `pattern`.
 * Returns the absolute path, or null if the directory doesn't exist
 * or no file matches.
 */
function findMatchingFile(directory: string, pattern: RegExp): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return null;
  }
  const match = entries.find((name) => pattern.test(name));
  return match ? path.join(directory, match) : null;
}

/** Simple async sleep helper for polling loops. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map a Codex function_call name to Kangentic's AgentTool enum. The
 * enum only has two values (Bash, ExitPlanMode); any Codex tool call
 * that isn't an exit-plan action gets bucketed as Bash. Activity
 * tracking only cares about ToolStart/ToolEnd transitions, not the
 * specific tool identity, so this coarse mapping is sufficient.
 */
function mapCodexToolName(_name: string): AgentTool {
  return AgentTool.Bash;
}

/**
 * Build a partial SessionUsage from the fields captured in a parse pass.
 * Returns null if no relevant fields were seen (avoids noisy no-op usage
 * updates).
 */
function buildUsage(captured: {
  modelId: string | undefined;
  contextWindowSize: number | undefined;
  totalInputTokens: number | undefined;
  totalOutputTokens: number | undefined;
  cachedInputTokens: number | undefined;
}): SessionUsage | null {
  const {
    modelId,
    contextWindowSize,
    totalInputTokens,
    totalOutputTokens,
    cachedInputTokens,
  } = captured;

  const hasModel = modelId !== undefined;
  const hasTokens = totalInputTokens !== undefined || totalOutputTokens !== undefined;
  if (!hasModel && !hasTokens && contextWindowSize === undefined) {
    return null;
  }

  // Context window used percentage. If we know both the size and the
  // total tokens, compute it; otherwise leave at 0 and let the renderer
  // show the minimal pill until more data arrives.
  const inputTokens = totalInputTokens ?? 0;
  const outputTokens = totalOutputTokens ?? 0;
  const windowSize = contextWindowSize ?? 0;
  const usedTokens = inputTokens; // input tokens reflect context held
  const percentage = windowSize > 0 ? (usedTokens / windowSize) * 100 : 0;

  return {
    contextWindow: {
      usedPercentage: percentage,
      usedTokens,
      cacheTokens: cachedInputTokens ?? 0,
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      contextWindowSize: windowSize,
    },
    cost: {
      totalCostUsd: 0,
      totalDurationMs: 0,
    },
    model: {
      id: modelId ?? '',
      displayName: modelId ?? '',
    },
  };
}
