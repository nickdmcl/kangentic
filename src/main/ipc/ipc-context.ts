import type { BrowserWindow } from 'electron';
import type { ProjectRepository } from '../db/repositories/project-repository';
import type { ProjectGroupRepository } from '../db/repositories/project-group-repository';
import type { SessionManager } from '../pty/session-manager';
import type { ConfigManager } from '../config/config-manager';
import type { BoardConfigManager } from '../config/board-config-manager';
import type { ClaudeDetector } from '../agent/claude-detector';
import type { GitDetector } from '../agent/git-detector';
import type { ShellResolver } from '../pty/shell-resolver';
import type { CommandBuilder } from '../agent/command-builder';
import type { CommandInjector } from '../engine/command-injector';

export interface IpcContext {
  mainWindow: BrowserWindow;
  projectRepo: ProjectRepository;
  projectGroupRepo: ProjectGroupRepository;
  sessionManager: SessionManager;
  configManager: ConfigManager;
  boardConfigManager: BoardConfigManager;
  claudeDetector: ClaudeDetector;
  gitDetector: GitDetector;
  shellResolver: ShellResolver;
  commandBuilder: CommandBuilder;
  commandInjector: CommandInjector;
  currentProjectId: string | null;
  currentProjectPath: string | null;
}
