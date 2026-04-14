import fs from 'node:fs';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * Extract the Warp version from `oz dump-debug-info` output.
 *
 * The oz CLI does not support `--version`. Instead, `dump-debug-info`
 * prints lines like:
 *   Warp version: Some("v0.2026.04.08.08.36.stable_02")
 *
 * We extract the version string from the `Some("...")` wrapper.
 */
export function parseWarpVersion(output: string): string | null {
  const match = output.match(/Warp version:\s*Some\("([^"]+)"\)/);
  return match ? match[1] : null;
}

/**
 * Run `<binary> dump-debug-info` and extract the version.
 * Uses exec() on Windows (for .cmd shim support) and execFile() elsewhere.
 */
export async function execWarpVersion(candidatePath: string, timeout = 5000): Promise<string | null> {
  try {
    if (!fs.existsSync(candidatePath)) return null;
    const { stdout, stderr } = process.platform === 'win32'
      ? await execAsync(`"${candidatePath}" dump-debug-info`, { timeout })
      : await execFileAsync(candidatePath, ['dump-debug-info'], { timeout });
    const raw = stdout || stderr || '';
    return parseWarpVersion(raw);
  } catch {
    return null;
  }
}
