import fs from 'node:fs';
import path from 'node:path';
import type {
  SessionHistoryParseResult,
  SessionUsage,
} from '../../../../shared/types';

/**
 * Parser for Aider's chat history markdown file.
 *
 * Path: `<cwd>/.aider.chat.history.md` (configurable via --chat-history-file)
 *
 * Aider appends to this file on every chat exchange. Format (from source:
 * aider/io.py):
 *
 *   # aider chat started at 2026-04-12 14:30:00     (session start, H1)
 *   #### user prompt here                            (user input, H4)
 *   plain assistant response text                    (assistant output)
 *   > Tokens: 1.2k sent, 500 received.              (tool output, blockquote)
 *   > Cost: $0.01 message, $0.05 session.            (tool output, blockquote)
 *
 * Key facts verified from Aider source (aider-ai/aider):
 * - Session start header has NO model name (just timestamp)
 * - #### headers are USER prompts, not model names
 * - Assistant responses are plain text with no prefix
 * - Token/cost info appears as > blockquoted tool output
 * - Model name is only printed to terminal, not to the history file
 *
 * We parse the > blockquotes for session cost, which is the only
 * structured telemetry available from this file.
 */
export class AiderSessionHistoryParser {
  /**
   * Locate the chat history file in the working directory. Aider writes
   * one history file per project directory (no session ID in filename).
   * The file lives in the git root (or cwd if no git repo).
   */
  static async locate(options: {
    agentSessionId: string;
    cwd: string;
  }): Promise<string | null> {
    const filePath = path.join(options.cwd, '.aider.chat.history.md');
    try {
      return fs.existsSync(filePath) ? filePath : null;
    } catch {
      return null;
    }
  }

  /**
   * Parse the chat history markdown to extract session cost from
   * blockquoted tool output lines.
   *
   * Aider writes lines like:
   *   > Cost: $0.01 message, $0.05 session.
   *   > Tokens: 1.2k sent, 500 cache write, 800 cache hit, 300 received.
   *
   * We extract the session cost (cumulative) from the last Cost line,
   * and sent/received token counts from the last Tokens line.
   *
   * Model name is NOT available in this file - it's only printed to
   * the terminal at startup (e.g. "Model: claude-3-5-sonnet").
   */
  static parse(content: string, _mode: 'full' | 'append'): SessionHistoryParseResult {
    if (!content.trim()) {
      return { usage: null, events: [], activity: null };
    }

    const sessionCost = findLastSessionCost(content);
    const tokenCounts = findLastTokenCounts(content);

    // If we have neither cost nor token info, nothing to report.
    if (sessionCost === null && tokenCounts === null) {
      return { usage: null, events: [], activity: null };
    }

    const inputTokens = tokenCounts?.sent ?? 0;
    const outputTokens = tokenCounts?.received ?? 0;
    const cacheTokens = (tokenCounts?.cacheWrite ?? 0) + (tokenCounts?.cacheHit ?? 0);

    const usage: SessionUsage = {
      contextWindow: {
        usedPercentage: 0,
        usedTokens: inputTokens,
        cacheTokens,
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        // 0 = "unknown size" sentinel - card shows no progress bar.
        // Aider supports hundreds of models, so no lookup table.
        contextWindowSize: 0,
      },
      cost: {
        totalCostUsd: sessionCost ?? 0,
        totalDurationMs: 0,
      },
      model: {
        // Model name is not available in the history file.
        // Empty string signals "no model info" to the renderer.
        id: '',
        displayName: '',
      },
    };

    return { usage, events: [], activity: null };
  }
}

// ---------- Internal helpers ----------

/**
 * Extract session cost from the last Cost line containing "$X.XX session".
 * The session cost is cumulative, so the last one is the most up-to-date.
 *
 * Two formats exist depending on whether cache tokens are present:
 * - Single line: `> Tokens: 2.1k sent, 456 received. Cost: $0.01 message, $0.01 session.`
 * - Split line:  `> Tokens: 1.8k sent, 500 cache write, 1.1k cache hit, 234 received.\n`
 *                `Cost: $0.02 message, $0.05 session.`
 *
 * In the split case, `Cost:` appears on its own line without the `> ` prefix
 * because Aider's tool_output only adds `> ` to the first line of multi-line
 * output. We match both formats.
 */
function findLastSessionCost(content: string): number | null {
  // Match Cost: with optional > prefix to handle both single-line and split-line formats
  const pattern = /^>?\s*Cost:.*\$([0-9.]+)\s+session/gm;
  let lastCost: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const parsed = parseFloat(match[1]);
    if (Number.isFinite(parsed)) lastCost = parsed;
  }
  return lastCost;
}

interface TokenCounts {
  sent: number;
  received: number;
  cacheWrite: number;
  cacheHit: number;
}

/**
 * Extract token counts from the last `> Tokens: Xk sent, Yk received.` line.
 *
 * Aider format (from coders/base_coder.py calculate_and_show_tokens_and_cost):
 *   > Tokens: 1.2k sent, 500 cache write, 800 cache hit, 300 received.
 *
 * Token values may use k/M suffixes (e.g. "1.2k" = 1200, "1.5M" = 1500000).
 * Not all parts are always present (cache fields are optional).
 */
function findLastTokenCounts(content: string): TokenCounts | null {
  // Match the full Tokens line as a blockquote
  const linePattern = /^>\s*Tokens:\s*(.+)$/gm;
  let lastLine: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(content)) !== null) {
    lastLine = match[1];
  }
  if (!lastLine) return null;

  const sent = extractTokenValue(lastLine, 'sent');
  const received = extractTokenValue(lastLine, 'received');
  const cacheWrite = extractTokenValue(lastLine, 'cache write');
  const cacheHit = extractTokenValue(lastLine, 'cache hit');

  if (sent === 0 && received === 0) return null;

  return { sent, received, cacheWrite, cacheHit };
}

/**
 * Extract a numeric token value with optional k/M suffix preceding a label.
 * E.g. "1.2k sent" -> 1200, "500 received" -> 500, "1.5M sent" -> 1500000.
 */
function extractTokenValue(line: string, label: string): number {
  const pattern = new RegExp(`([0-9][0-9,.]*)(k|M)?\\s+${label}`, 'i');
  const match = pattern.exec(line);
  if (!match) return 0;

  // Remove commas from number (e.g. "1,234" -> "1234")
  const raw = parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(raw)) return 0;

  const suffix = match[2];
  if (suffix === 'k') return Math.round(raw * 1000);
  if (suffix === 'M') return Math.round(raw * 1_000_000);
  return Math.round(raw);
}
