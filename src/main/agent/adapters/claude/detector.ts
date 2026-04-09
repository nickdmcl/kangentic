import { AgentDetector } from '../../shared/agent-detector';

/**
 * Claude Code CLI detector.
 *
 * Strips the `(Claude Code)` suffix from the raw version string
 * (e.g. `2.1.90 (Claude Code)` → `2.1.90`).
 *
 * Includes macOS Homebrew fallback paths for the GUI launch case
 * where Electron launched from Finder doesn't inherit the user's
 * shell PATH.
 */
export class ClaudeDetector extends AgentDetector {
  constructor() {
    super({
      binaryName: 'claude',
      fallbackPaths: [
        '/opt/homebrew/bin/claude',       // Homebrew on Apple Silicon
        '/usr/local/bin/claude',          // Homebrew on Intel Mac / manual installs
        '/home/linuxbrew/.linuxbrew/bin/claude', // Linuxbrew
      ],
      parseVersion: (raw) => raw.replace(/\s*\(Claude Code\)\s*$/i, '').trim() || null,
    });
  }
}
