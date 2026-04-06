/**
 * Gemini CLI transcript cleanup.
 *
 * Gemini CLI redraws its viewport on each token, producing many copies
 * of the response at increasing levels of completeness. Each redraw
 * starts with ✦ followed by the response-so-far. The LAST ✦ block
 * is always the most complete.
 *
 * Markers: > (user prompt), ✦ (assistant response)
 *
 * Strategy:
 * 1. Filter Gemini-specific noise (banner, spinners, auth, workspace status)
 * 2. Find the last ✦ response block (most complete)
 * 3. Find the prompt that precedes it
 * 4. Return prompt + last response
 *
 * Limitation: multi-turn conversations only capture the last turn.
 * Earlier turns are discarded because each ✦ redraw replaces the previous.
 * Can be extended with scan-back logic (like Claude) if multi-turn Gemini
 * handoffs become common.
 */

import { filterNoiseLines, finalizeTranscript } from '../../handoff/transcript-cleanup';

const GEMINI_NOISE_PATTERNS: RegExp[] = [
  // Banner art
  /[▝▜▄▗▟▀]{2,}/,
  // Lines of block chars (full-width bars used as TUI borders)
  /^[▀▄\s]{10,}$/,
  // Braille spinners with "Thinking..." status
  /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*Thinking/,
  // YOLO mode indicator
  /^\s*YOLO\s+Ctrl\+Y/,
  // Input prompt placeholder (with or without leading spaces, * or > prefix)
  /[>*]\s+Type your message/,
  // Workspace/model status bar
  /^\s*workspace\s*\(\/directory\)/,
  /^\s*~\\.*worktrees\\/,
  /^\s*~\\\.{3}\\/,
  /^\s*no sandbox/,
  /^\s*branch\s/,
  /^\s*sandbox\s/,
  /Auto\s*\(Gemini\s*\d/,
  /\/model\s*$/,
  // Shortcuts hint
  /\?\s*for shortcuts/,
  // Info messages
  /^ℹ\s*Positional arguments/,
  // Authenticated with line
  /^\s*Authenticated with/,
  // Tips for getting started
  /^\s*Tips for getting started/,
  /^\s*\d\.\s*(Create GEMINI\.md|\/help|Ask coding|Be specific)/,
  // Shift+Tab hint
  /Shift\+Tab to accept/,
  // Tip lines in status bar
  /Tip:\s/,
  // "esc to cancel" in spinner lines
  /esc to cancel/,
];

/** Gemini prompt marker: > followed by content (optional leading whitespace). */
const GEMINI_PROMPT = /^\s*>\s+\S/;
/** Gemini response marker: ✦ followed by content. */
const GEMINI_RESPONSE = /^\s*✦\s/;

export function cleanGeminiTranscript(rawText: string): string | null {
  // Step 0: Strip inline TUI chrome that gets concatenated onto content lines.
  // Gemini sometimes appends "? for shortcuts" directly to the last response
  // line without a newline separator.
  const preClean = rawText.replace(/\?\s*for shortcuts/g, '');

  const lines = preClean.split('\n');

  // Step 1: Filter noise
  const filtered = filterNoiseLines(lines, GEMINI_NOISE_PATTERNS);
  const text = filtered.join('\n').replace(/\n{3,}/g, '\n\n');
  const cleanLines = text.split('\n');

  // Step 2: Find the LAST ✦ response block.
  // Gemini redraws the response on each token, each prefixed with ✦.
  // The last ✦ block is always the most complete.
  let lastResponseStart = -1;
  for (let index = cleanLines.length - 1; index >= 0; index--) {
    if (GEMINI_RESPONSE.test(cleanLines[index])) {
      lastResponseStart = index;
      break;
    }
  }

  if (lastResponseStart === -1) return finalizeTranscript(text);

  // Step 3: Find the prompt that precedes the last ✦ response.
  // Walk backward from the last ✦ to find the nearest > prompt.
  let promptStart = -1;
  for (let index = lastResponseStart - 1; index >= 0; index--) {
    if (GEMINI_PROMPT.test(cleanLines[index])) {
      promptStart = index;
      break;
    }
  }

  if (promptStart === -1) {
    // No prompt found - just return the last response block
    return finalizeTranscript(cleanLines.slice(lastResponseStart).join('\n'));
  }

  // Step 4: Take prompt + last ✦ block only (skip any intermediate ✦ blocks between them)
  const promptLine = cleanLines[promptStart];
  const responseLines = cleanLines.slice(lastResponseStart);

  return finalizeTranscript(promptLine + '\n\n' + responseLines.join('\n'));
}
