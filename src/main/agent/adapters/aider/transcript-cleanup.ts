/**
 * Aider CLI transcript cleanup for PTY output.
 *
 * Aider's terminal output uses prompt markers (aider>, architect>) and
 * interspersed status lines (token counts, repo map, git output, model
 * announcements). Unlike Gemini/Codex, Aider does not redraw the viewport
 * per token - output is append-only, making extraction simpler.
 *
 * PTY prompt markers: `aider> ` or `architect> ` (user prompt with content)
 *
 * Strategy:
 * 1. Filter Aider-specific noise (tokens, repo map, git, model/version info)
 * 2. Find the last prompt line with content
 * 3. Take prompt + everything after it as the response
 * 4. Apply finalizeTranscript()
 *
 * Limitation: multi-turn conversations only capture the last turn.
 * Earlier turns are discarded to keep handoff context focused.
 */

import { filterNoiseLines, finalizeTranscript } from '../../handoff/transcript-cleanup';

const AIDER_NOISE_PATTERNS: RegExp[] = [
  // Empty prompt lines (no content after marker)
  /^\s*(?:aider|architect)?>\s*$/,
  // Token usage and cost reporting
  /^Tokens:\s/,
  /^Tokens remaining/,
  /^Cost:\s/,
  /^\$[\d.]+\s*$/,
  // Repo map indicators
  /^Repo-map:\s/,
  /^Added .+ to the chat/,
  /^Dropped .+ from the chat/,
  /^Files in chat:/,
  // Git output
  /^Git repo:\s/,
  /^Commit [0-9a-f]{7,}/,
  /^Applied edit to/,
  // Model and version info (base_coder.py get_announcements prints
  // "Model:" when no weak model, "Main model:" when separate weak model)
  /^(?:Main )?[Mm]odel:\s/,
  /^Weak model:\s/,
  /^Editor model:\s/,
  /^aider v[\d.]/,
  // Warnings and update notices
  /^Warning:/,
  /^Aider v[\d.]+ is available/,
  // Lint/test output markers
  /^running lint/i,
  /^Linter output:/,
  // Use /help hint
  /^Use \/help /,
];

/** Aider prompt marker: > or aider> or architect> followed by content. */
const AIDER_PROMPT = /^\s*(?:aider|architect)?>\s+\S/;

export function cleanAiderTranscript(rawText: string): string | null {
  const lines = rawText.split('\n');

  // Step 1: Filter noise
  const filtered = filterNoiseLines(lines, AIDER_NOISE_PATTERNS);
  const text = filtered.join('\n').replace(/\n{3,}/g, '\n\n');
  const cleanLines = text.split('\n');

  // Step 2: Find the last prompt line with content.
  let lastPromptIndex = -1;
  for (let index = cleanLines.length - 1; index >= 0; index--) {
    if (AIDER_PROMPT.test(cleanLines[index])) {
      lastPromptIndex = index;
      break;
    }
  }

  if (lastPromptIndex === -1) {
    // No prompt found - return all filtered content as-is
    return finalizeTranscript(text);
  }

  // Step 3: Take prompt + everything after it (the response follows the prompt)
  const lastTurn = cleanLines.slice(lastPromptIndex).join('\n');

  return finalizeTranscript(lastTurn);
}
