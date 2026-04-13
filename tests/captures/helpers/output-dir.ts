import path from 'node:path';
import fs from 'node:fs';

/**
 * Shared timestamped output directory for all captures in a single run.
 * Structure: captures/<timestamp>/agent-orchestration/, captures/<timestamp>/task-detail/, etc.
 *
 * The timestamp is created once per process so all capture specs in the same
 * `npm run capture` invocation share the same folder.
 */
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const CAPTURES_ROOT = path.join(__dirname, '..', '..', '..', 'captures', timestamp);

export function getOutputDir(feature: string): string {
  const dir = path.join(CAPTURES_ROOT, feature);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export { CAPTURES_ROOT };
