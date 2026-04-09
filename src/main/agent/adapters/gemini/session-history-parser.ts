import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type SessionHistoryParseResult,
  type SessionUsage,
  type SessionEvent,
} from '../../../../shared/types';

/**
 * Parser for Gemini CLI's native session chat JSON file.
 *
 * Path: `~/.gemini/tmp/<projectDirName>/chats/session-<sessionId>.json`
 *
 * The `<projectDirName>` is the lowercased basename of the cwd (NOT a
 * hash despite the `projectHash` field inside the JSON body). Verified
 * empirically from live directory listings - Gemini uses the last path
 * segment of cwd, lowercased, as the directory name.
 *
 * Note: Gemini's dirname scheme has a collision risk if two projects
 * share the same basename. That's a Gemini design choice, not ours.
 *
 * File format: a single JSON object, rewritten on every message. The
 * parser always receives the full file content (isFullRewrite = true).
 *
 * Shape:
 * ```
 * {
 *   "sessionId": "<uuid>",
 *   "projectHash": "<sha256>",
 *   "startTime": "<ISO>",
 *   "lastUpdated": "<ISO>",
 *   "messages": [
 *     { "type": "user", "content": [...] },
 *     {
 *       "type": "gemini",
 *       "content": "...",
 *       "model": "gemini-3-flash-preview",
 *       "tokens": { "input": ..., "output": ..., "cached": ..., "total": ... }
 *     }
 *   ]
 * }
 * ```
 *
 * We walk `messages[]` backwards to find the most recent `"type": "gemini"`
 * entry (respects mid-session `/model` changes). Context window size is
 * not present in the file - we use a small model-name → window-size
 * lookup table based on Google's published model specs.
 */
export class GeminiSessionHistoryParser {
  /**
   * Locate the chat session file for a known session UUID. Gemini writes
   * the file synchronously when the session starts, so a single
   * readdirSync is usually sufficient. We poll up to 5 s as a safety net.
   *
   * The filename contains the session UUID, so we can match directly:
   * `session-<sessionId>.json` (possibly with a timestamp/shortId prefix).
   */
  static async locate(options: {
    agentSessionId: string;
    cwd: string;
  }): Promise<string | null> {
    const { agentSessionId, cwd } = options;

    const projectDirName = computeGeminiProjectDirName(cwd);
    const directory = path.join(os.homedir(), '.gemini', 'tmp', projectDirName, 'chats');

    const escapedId = agentSessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`session-.*${escapedId}.*\\.json$`, 'i');

    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const found = findMatchingFile(directory, pattern);
      if (found) return found;
      // Also check for a filename that is exactly `session-<id>.json`
      // in case Gemini doesn't include a prefix.
      const plain = path.join(directory, `session-${agentSessionId}.json`);
      if (fs.existsSync(plain)) return plain;
      await sleep(500);
    }
    return null;
  }

  /**
   * Parse the full Gemini chat JSON file. Receives the entire file
   * content on every change (isFullRewrite = true). Walks messages[]
   * backwards to find the most recent assistant message and extracts
   * its model + token totals.
   */
  static parse(content: string, _mode: 'full' | 'append'): SessionHistoryParseResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Partial write mid-flush or corruption - return empty result.
      return { usage: null, events: [], activity: null };
    }
    if (!isRecord(parsed)) {
      return { usage: null, events: [], activity: null };
    }

    const messages = parsed.messages;
    if (!Array.isArray(messages)) {
      return { usage: null, events: [], activity: null };
    }

    // Walk backwards to find the most recent gemini (assistant) message.
    // This gives us the latest model the agent reported, respecting any
    // mid-session /model changes.
    let latestGeminiMessage: Record<string, unknown> | null = null;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (isRecord(message) && message.type === 'gemini') {
        latestGeminiMessage = message;
        break;
      }
    }

    if (!latestGeminiMessage) {
      // No assistant messages yet - nothing to report.
      return { usage: null, events: [], activity: null };
    }

    const modelId = typeof latestGeminiMessage.model === 'string'
      ? latestGeminiMessage.model
      : '';
    const tokens = isRecord(latestGeminiMessage.tokens) ? latestGeminiMessage.tokens : null;
    const inputTokens = toNumber(tokens?.input) ?? 0;
    const outputTokens = toNumber(tokens?.output) ?? 0;
    const cachedTokens = toNumber(tokens?.cached) ?? 0;

    // contextWindowSize is null when the model isn't in our lookup table.
    // The card renderer falls through to a model-name-only pill in that
    // case rather than showing a progress bar against a guessed limit.
    const contextWindowSize = resolveGeminiContextWindowSize(modelId);
    const percentage = contextWindowSize !== null && contextWindowSize > 0
      ? (inputTokens / contextWindowSize) * 100
      : 0;

    const usage: SessionUsage = {
      contextWindow: {
        usedPercentage: percentage,
        usedTokens: inputTokens,
        cacheTokens: cachedTokens,
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        // 0 is our sentinel for "unknown size" - the TaskCard renderer
        // treats this as "don't show the progress bar, just the model
        // name" so we never display a bar computed against a guessed
        // context window.
        contextWindowSize: contextWindowSize ?? 0,
      },
      cost: {
        totalCostUsd: 0,
        totalDurationMs: 0,
      },
      model: {
        id: modelId,
        displayName: modelId,
      },
    };

    // Gemini writes the file on message completion, so by the time we
    // parse it the latest message already exists - no live "thinking"
    // signal. We leave activity null and let PtyActivityTracker (which
    // runs in parallel until suppressed) handle thinking/idle transitions
    // from the TUI output. Once tokens change between two parses, that
    // implicitly confirms the agent is progressing.
    const events: SessionEvent[] = [];
    return { usage, events, activity: null };
  }
}

// ---------- Internal helpers ----------

/** Type guard for a plain JSON object (not null, not array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coerce an unknown value to a finite number, or undefined. */
function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

/**
 * Compute the directory name Gemini uses under `~/.gemini/tmp/` for a
 * given cwd. Empirically verified from live Gemini directory listings:
 * the dir name is the lowercased basename of the cwd, NOT a hash.
 *
 * Collision risk: two projects sharing the same basename (e.g. two
 * different `app/` directories) will share this Gemini dir. That's
 * Gemini's design choice, not ours. Worktrees typically have unique
 * names so this is rarely an issue in practice.
 */
function computeGeminiProjectDirName(cwd: string): string {
  const basename = path.basename(path.normalize(cwd));
  return basename.toLowerCase();
}

/**
 * Set of model names we've already warned about, so the WARN log
 * fires at most once per unique unknown model per process lifetime.
 * Prevents log spam when a session continually updates.
 */
const unknownModelWarningsLogged = new Set<string>();

/**
 * Look up the context window size for a given Gemini model name.
 * Source: Google's published model cards, hardcoded here because
 * Gemini's session JSON doesn't include the window size.
 *
 * Returns `null` for unknown models (not in the table). The caller
 * uses this sentinel to gracefully degrade - hide the progress bar
 * and show only the model name, rather than rendering a misleading
 * percentage computed against a guessed limit.
 *
 * When a new Gemini model is released, add it to the lookup chain
 * below and bump the version range accordingly.
 */
function resolveGeminiContextWindowSize(modelId: string): number | null {
  const lower = modelId.toLowerCase();
  // Gemini 3 generation
  if (lower.startsWith('gemini-3-flash')) return 1_000_000;
  if (lower.startsWith('gemini-3-pro')) return 2_000_000;
  if (lower.startsWith('gemini-3')) return 1_000_000;
  // Gemini 2.5 generation
  if (lower.startsWith('gemini-2.5-pro')) return 2_000_000;
  if (lower.startsWith('gemini-2.5-flash')) return 1_000_000;
  if (lower.startsWith('gemini-2.5')) return 1_000_000;
  // Gemini 2.0 generation
  if (lower.startsWith('gemini-2.0')) return 1_000_000;
  // Unknown model: warn once and return null so the caller can
  // gracefully degrade. Do not guess - showing a bar against a
  // guessed limit would give the user false precision.
  if (!unknownModelWarningsLogged.has(lower)) {
    unknownModelWarningsLogged.add(lower);
    console.warn(
      `[gemini-session-history] unknown model "${modelId}" - context window size not in lookup table. `
      + `Card will show model name without progress bar. Update resolveGeminiContextWindowSize() `
      + `in src/main/agent/adapters/gemini/session-history-parser.ts with the window size from Google's model card.`
    );
  }
  return null;
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
