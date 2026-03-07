import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function getDataDirFromArgs(): string | null {
  for (let index = 0; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument.startsWith('--data-dir=')) {
      return argument.slice('--data-dir='.length);
    }
    if (argument === '--data-dir' && index + 1 < process.argv.length) {
      const nextArgument = process.argv[index + 1];
      if (!nextArgument.startsWith('-')) {
        return nextArgument;
      }
    }
  }
  return null;
}

function getConfigDir(): string {
  // Priority: env var > CLI flag > platform default
  if (process.env.KANGENTIC_DATA_DIR) {
    return process.env.KANGENTIC_DATA_DIR;
  }

  const dataDirFromArgs = getDataDirFromArgs();
  if (dataDirFromArgs) {
    return dataDirFromArgs;
  }

  const platform = process.platform;
  let base: string;
  if (platform === 'win32') {
    base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  }
  return path.join(base, 'kangentic');
}

export const PATHS = {
  configDir: getConfigDir(),
  get globalDb() { return path.join(this.configDir, 'index.db'); },
  get configFile() { return path.join(this.configDir, 'config.json'); },
  get projectsDir() { return path.join(this.configDir, 'projects'); },
  projectDb(projectId: string) { return path.join(this.projectsDir, `${projectId}.db`); },
};

export function ensureDirs(): void {
  fs.mkdirSync(PATHS.configDir, { recursive: true });
  fs.mkdirSync(PATHS.projectsDir, { recursive: true });
}
