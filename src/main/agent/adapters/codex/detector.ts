import { AgentDetector } from '../../shared/agent-detector';

/**
 * Codex CLI detector.
 *
 * Strips the `codex-cli ` prefix from the raw version string
 * (e.g. `codex-cli 0.118.0` → `0.118.0`).
 */
export class CodexDetector extends AgentDetector {
  constructor() {
    super({
      binaryName: 'codex',
      parseVersion: (raw) => raw.replace(/^codex-cli\s+/i, '').trim() || null,
    });
  }
}
