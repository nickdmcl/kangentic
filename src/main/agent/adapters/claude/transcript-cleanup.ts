/**
 * Claude Code transcript cleanup.
 *
 * Claude Code is a full-screen TUI that redraws the entire viewport on every
 * spinner tick and token render. The raw PTY stream contains multiple copies
 * of the conversation, with intermediate renders showing garbled text (words
 * joined without spaces from cursor-positioned character overwrites).
 *
 * Markers: ❯ (user prompt), ● (assistant response)
 *
 * Strategy:
 * 1. Filter Claude-specific noise (banner, spinners, status lines)
 * 2. Detect garbled lines (no spaces between words - partial TUI redraws)
 * 3. Find the last clean conversation (final TUI redraw)
 */

import { filterNoiseLines, finalizeTranscript } from '../../handoff/transcript-cleanup';

const CLAUDE_NOISE_PATTERNS: RegExp[] = [
  // Banner art (block drawing characters)
  /[▐▛▜▌▝█▘]{2,}/,
  // Lines of block chars (▀ ▄ used as TUI borders)
  /^[▀▄]{10,}$/,
  // Spinner animation frames (Claude rotates verbs: Sublimating, Combobulating, etc.)
  /^[✶✻✽✢·◐◑◒◓●*]+(?:\w+ing|thinking|main|tg|in|la|bm|ui|Sl|b\b|u\b|S\b|C\b|M\b)/,
  /^(?:✶|✻|✽|✢|·|\*|◐|◑|◒|◓)(?:\s*\w+ing…?)?(?:\s*\(thinking\))*\s*$/,
  // Status line fragments
  /^\s*⏸\s*plan mode/,
  /^\s*◐\s*medium\s*·\s*\/effort/,
  /^\s*\/buddy\s*$/,
  /^claude --resume /,
  // Pure spinner residue or short garbled fragments
  // NOTE: ● is excluded - it's Claude's response marker, not a spinner
  /^[✶✻✽✢·◐◑◒◓*\s]{1,5}$/,
  /^[✶✻✽✢·◐◑◒◓*].{0,25}$/,
  // Standalone "(thinking)" lines
  /^\s*\(thinking\)\s*$/,
  // UI hints
  /Press up to edit queued messages/,
  // Tip lines that appear in the TUI chrome
  /^\s*⎿\s*Tip:/,
  // Shortcuts/buddy hint from status bar
  /^\s*\?\s*for shortcuts/,
  // "esc to interrupt" hint
  /esc\s*to\s*interrupt/,
];

/** Claude prompt marker: ❯ followed by content. */
const CLAUDE_PROMPT = /^❯\s+\S/;
/** Claude response marker: ● followed by content. Multiline for gap scanning. */
const CLAUDE_RESPONSE = /^●\s/m;

/**
 * Detect garbled TUI redraw lines - words joined without spaces.
 * Claude's cursor-positioned redraws produce lines like:
 *   "●Here are 5 notablebirds:" instead of "● Here are 5 notable birds:"
 *   "Tellmeabout5birds" instead of "Tell me about 5 birds"
 *
 * Heuristic: a line of 30+ chars with fewer than 8% spaces is garbled.
 */
function isGarbledLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 30) return false;
  const spaceCount = (trimmed.match(/ /g) || []).length;
  const spaceRatio = spaceCount / trimmed.length;
  return spaceRatio < 0.08;
}

export function cleanClaudeTranscript(rawText: string): string | null {
  const lines = rawText.split('\n');

  // Step 1: Filter noise and garbled lines
  const filtered = filterNoiseLines(lines, CLAUDE_NOISE_PATTERNS)
    .filter((line) => !isGarbledLine(line));

  const text = filtered.join('\n').replace(/\n{3,}/g, '\n\n');

  // Step 2: Find the last clean conversation block.
  // Scan backward for the last ❯ prompt that has a ● response.
  const cleanLines = text.split('\n');
  const promptPositions: number[] = [];
  for (let index = 0; index < cleanLines.length; index++) {
    if (CLAUDE_PROMPT.test(cleanLines[index])) {
      promptPositions.push(index);
    }
  }

  if (promptPositions.length === 0) return finalizeTranscript(text);

  // Find the last prompt with a clean ● response within the next few lines
  for (let positionIndex = promptPositions.length - 1; positionIndex >= 0; positionIndex--) {
    const promptLine = promptPositions[positionIndex];

    let hasCleanResponse = false;
    for (let offset = 1; offset <= 5 && promptLine + offset < cleanLines.length; offset++) {
      const nextLine = cleanLines[promptLine + offset].trim();
      if (!nextLine) continue;
      if (CLAUDE_RESPONSE.test(nextLine)) {
        hasCleanResponse = true;
        break;
      }
      break;
    }

    if (hasCleanResponse) {
      // Walk backward to include earlier prompts in the same clean conversation.
      // Stop when we find a prompt WITHOUT a ● response (garbled redraw boundary).
      let conversationStart = promptLine;
      for (let scanBack = positionIndex - 1; scanBack >= 0; scanBack--) {
        const candidateLine = promptPositions[scanBack];
        const nextPromptLine = promptPositions[scanBack + 1];
        const gapText = cleanLines.slice(candidateLine, nextPromptLine).join('\n');

        // Must have a clean ● response between these two prompts
        if (!CLAUDE_RESPONSE.test(gapText)) break;

        // Content dedup: if this prompt has identical text to a later prompt,
        // it's a TUI redraw duplicate - skip it
        const candidateText = cleanLines[candidateLine];
        const laterPrompts = promptPositions.slice(scanBack + 1);
        const isDuplicate = laterPrompts.some(
          (laterLine) => cleanLines[laterLine] === candidateText,
        );
        if (isDuplicate) break;

        conversationStart = candidateLine;
      }

      return finalizeTranscript(cleanLines.slice(conversationStart).join('\n'));
    }
  }

  return finalizeTranscript(text);
}
