/**
 * Unit tests for ConfigManager permission mode migrations.
 *
 * Uses KANGENTIC_DATA_DIR to isolate config files in a temp directory.
 * Each test gets a fresh ConfigManager via vi.resetModules() + dynamic import
 * (the PATHS singleton caches configDir at module load time).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kangentic-config-'));
  fs.mkdirSync(path.join(tmpDir, 'projects'), { recursive: true });
  configPath = path.join(tmpDir, 'config.json');
  process.env.KANGENTIC_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.KANGENTIC_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a fresh ConfigManager (resets module cache so PATHS picks up new env). */
async function createConfigManager() {
  const { ConfigManager } = await import('../../src/main/config/config-manager');
  return new ConfigManager();
}

describe('Config Manager -- Permission Mode Migration', () => {
  it("migrates 'dangerously-skip' → 'bypassPermissions'", async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      claude: { permissionMode: 'dangerously-skip' },
    }));

    const cm = await createConfigManager();
    const config = cm.load();

    expect(config.claude.permissionMode).toBe('bypassPermissions');

    // Verify persisted to disk
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.claude.permissionMode).toBe('bypassPermissions');
  });

  it("migrates 'project-settings' → 'default'", async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      claude: { permissionMode: 'project-settings' },
    }));

    const cm = await createConfigManager();
    const config = cm.load();

    expect(config.claude.permissionMode).toBe('default');

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.claude.permissionMode).toBe('default');
  });

  it("preserves 'default' without re-migration", async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      claude: { permissionMode: 'default', maxConcurrentSessions: 4 },
    }));

    const cm = await createConfigManager();
    const config = cm.load();

    expect(config.claude.permissionMode).toBe('default');
    expect(config.claude.maxConcurrentSessions).toBe(4);
  });

  it("migrates 'bypass-permissions' → 'bypassPermissions'", async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      claude: { permissionMode: 'bypass-permissions' },
    }));

    const cm = await createConfigManager();
    const config = cm.load();

    expect(config.claude.permissionMode).toBe('bypassPermissions');

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.claude.permissionMode).toBe('bypassPermissions');
  });

  it("migrates 'manual' → 'default'", async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      claude: { permissionMode: 'manual' },
    }));

    const cm = await createConfigManager();
    const config = cm.load();

    expect(config.claude.permissionMode).toBe('default');

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.claude.permissionMode).toBe('default');
  });

  it("preserves valid modes: plan, acceptEdits, dontAsk, bypassPermissions", async () => {
    for (const mode of ['plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const) {
      // Reset modules for each sub-case so PATHS re-reads env
      vi.resetModules();
      fs.writeFileSync(configPath, JSON.stringify({
        claude: { permissionMode: mode },
      }));

      const { ConfigManager } = await import('../../src/main/config/config-manager');
      const cm = new ConfigManager();
      const config = cm.load();

      expect(config.claude.permissionMode).toBe(mode);
    }
  });

  it("fresh config (no file) defaults to 'default'", async () => {
    // No config file written -- should fall back to DEFAULT_CONFIG
    const cm = await createConfigManager();
    const config = cm.load();

    expect(config.claude.permissionMode).toBe('default');
  });
});
