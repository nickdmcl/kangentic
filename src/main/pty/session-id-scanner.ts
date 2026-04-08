import { stripAnsiEscapes } from './transcript-writer';

/**
 * Chunk-boundary-safe scanner for extracting agent session IDs from PTY output.
 *
 * PTY data arrives in arbitrary chunks. On Windows ConPTY that flushes at
 * ~4KB boundaries, a UUID printed at exactly the boundary splits across two
 * chunks and a per-chunk regex misses it. This scanner maintains a rolling
 * window (default 8KB = 2x ConPTY chunk size) of the most recent output and
 * runs the adapter's regex against the concatenation, so matches spanning any
 * single chunk boundary are preserved.
 *
 * ANSI escape sequences are stripped before matching so Windows ConPTY
 * cursor-positioning that interleaves with printable characters doesn't
 * break regexes that work on Unix pty.
 */
export class SessionIdScanner {
  /** Rolling buffer of the most recent PTY output (capped at `bufferMax`). */
  private buffer = '';

  constructor(private readonly bufferMax: number = 8192) {}

  /**
   * Feed a raw PTY chunk. Returns the captured session ID on first match,
   * or null. Caller should stop invoking after a non-null return.
   */
  scanChunk(data: string, fromOutput: (d: string) => string | null): string | null {
    let combined = this.buffer + data;
    if (combined.length > this.bufferMax) {
      combined = combined.slice(combined.length - this.bufferMax);
    }
    this.buffer = combined;
    return fromOutput(stripAnsiEscapes(combined));
  }

  /**
   * Scan a full scrollback buffer once at suspend time. Does not mutate
   * the rolling buffer. Used as the last-resort fallback after the PTY exits.
   */
  scanScrollback(scrollback: string, fromOutput: (d: string) => string | null): string | null {
    return fromOutput(stripAnsiEscapes(scrollback));
  }

  /** Free the rolling buffer once a capture has succeeded. */
  reset(): void {
    this.buffer = '';
  }
}
