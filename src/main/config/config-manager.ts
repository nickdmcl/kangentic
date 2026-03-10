import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDirs } from './paths';
import type { AppConfig } from '../../shared/types';
import { DEFAULT_CONFIG } from '../../shared/types';
import { deepMerge } from '../../shared/object-utils';

export class ConfigManager {
  private config: AppConfig | null = null;

  load(): AppConfig {
    if (this.config) return this.config;

    ensureDirs();
    let parsed: Record<string, unknown> | null = null;
    try {
      const raw = fs.readFileSync(PATHS.configFile, 'utf-8');
      parsed = JSON.parse(raw);
      this.config = deepMerge(DEFAULT_CONFIG, parsed as Partial<AppConfig>);
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }

    // One-time migration: legacy permission mode values → new names
    const pm = this.config.claude.permissionMode as string;
    if (pm === 'dangerously-skip' || pm === 'project-settings') {
      this.config.claude.permissionMode = pm === 'dangerously-skip' ? 'bypass-permissions' : 'default';
      this.save(this.config);
    }

    // One-time migration: notifyIdleOnInactiveProject → notifications.desktop.onAgentIdle
    if (parsed && 'notifyIdleOnInactiveProject' in parsed) {
      this.config.notifications.desktop.onAgentIdle = Boolean(parsed.notifyIdleOnInactiveProject);
      delete (this.config as unknown as Record<string, unknown>).notifyIdleOnInactiveProject;
      this.save(this.config);
    }

    return this.config;
  }

  save(partial: Partial<AppConfig>): void {
    const current = this.load();
    this.config = deepMerge(current, partial);
    ensureDirs();
    fs.writeFileSync(PATHS.configFile, JSON.stringify(this.config, null, 2));
  }

  loadProjectOverrides(projectPath: string): Partial<AppConfig> | null {
    const configPath = path.join(projectPath, '.kangentic', 'config.json');
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  saveProjectOverrides(projectPath: string, overrides: Partial<AppConfig>): void {
    const dir = path.join(projectPath, '.kangentic');
    fs.mkdirSync(dir, { recursive: true });
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(overrides, null, 2));
  }

  getEffectiveConfig(projectPath?: string): AppConfig {
    const global = this.load();
    if (!projectPath) return global;

    const overrides = this.loadProjectOverrides(projectPath);
    if (!overrides) return global;

    return deepMerge(global, overrides);
  }
}
