import fs from 'node:fs';
import path from 'node:path';
import { CommandBridge } from '../agent/command-bridge';
import { getProjectDb } from '../db/database';
import type { Task, Swimlane } from '../../shared/types';

interface SessionFileWatcherCallbacks {
  onTaskCreated(sessionId: string, task: Task, columnName: string, swimlaneId: string): void;
  onTaskUpdated(sessionId: string, task: Task): void;
  onTaskDeleted(sessionId: string, task: Task): void;
  onTaskMove(sessionId: string, input: { taskId: string; targetSwimlaneId: string; targetPosition: number }): Promise<void>;
  onSwimlaneUpdated(sessionId: string, swimlane: Swimlane): void;
  onBacklogChanged(sessionId: string): void;
  onLabelColorsChanged(sessionId: string, colors: Record<string, string>): void;
}

interface WatcherState {
  commandBridge: CommandBridge | null;
  mergedSettingsPath: string | null;
  sessionDir: string | null;
}

/**
 * Manages per-session non-telemetry infrastructure: the MCP command
 * bridge for agent → Kangentic task operations, plus cleanup of the
 * merged Claude hook settings file and the per-session directory.
 *
 * Telemetry file watching (status.json, events.jsonl) is owned by
 * StatusFileReader, not this class. This class stays out of the
 * telemetry pipeline entirely.
 */
export class SessionFileWatcher {
  private watchers = new Map<string, WatcherState>();
  private callbacks: SessionFileWatcherCallbacks;

  constructor(callbacks: SessionFileWatcherCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Start the MCP command bridge for a session and record the paths
   * that `cleanupAndRemove` is responsible for deleting on shutdown.
   *
   * `statusOutputPath` is used only to derive the session directory
   * (via path.dirname) - the actual status.json watching belongs to
   * StatusFileReader.
   */
  startAll(info: {
    sessionId: string;
    projectId: string;
    cwd: string;
    statusOutputPath: string | null;
  }): void {
    const { sessionId, projectId, statusOutputPath } = info;

    // Derive session dir + merged settings path from statusOutputPath.
    // statusOutputPath = <project>/.kangentic/sessions/<sessionId>/status.json
    // mergedSettingsPath = <project>/.kangentic/sessions/<sessionId>/settings.json
    let sessionDir: string | null = null;
    let mergedSettingsPath: string | null = null;
    if (statusOutputPath) {
      sessionDir = statusOutputPath.replace(/[/\\][^/\\]+$/, '');
      mergedSettingsPath = sessionDir + '/settings.json';
    }

    const state: WatcherState = {
      commandBridge: null,
      mergedSettingsPath,
      sessionDir,
    };
    this.watchers.set(sessionId, state);

    // Start command bridge for MCP server communication (if session dir exists)
    if (sessionDir) {
      const commandsPath = path.join(sessionDir, 'commands.jsonl');
      const responsesDir = path.join(sessionDir, 'responses');

      // Derive project path from statusOutputPath pattern:
      // <projectPath>/.kangentic/sessions/<sessionId>/status.json
      const projectPath = path.resolve(sessionDir, '..', '..', '..');

      state.commandBridge = new CommandBridge({
        commandsPath,
        responsesDir,
        projectId,
        getProjectDb: () => getProjectDb(projectId),
        getProjectPath: () => projectPath,
        onTaskCreated: (task, columnName, swimlaneId) => {
          this.callbacks.onTaskCreated(sessionId, task, columnName, swimlaneId);
        },
        onTaskUpdated: (task) => {
          this.callbacks.onTaskUpdated(sessionId, task);
        },
        onTaskDeleted: (task) => {
          this.callbacks.onTaskDeleted(sessionId, task);
        },
        onTaskMove: (input) => {
          return this.callbacks.onTaskMove(sessionId, input);
        },
        onSwimlaneUpdated: (swimlane) => {
          this.callbacks.onSwimlaneUpdated(sessionId, swimlane);
        },
        onBacklogChanged: () => {
          this.callbacks.onBacklogChanged(sessionId);
        },
        onLabelColorsChanged: (colors) => {
          this.callbacks.onLabelColorsChanged(sessionId, colors);
        },
      });
      state.commandBridge.start();
    }
  }

  /** Stop the command bridge but preserve session files on disk. */
  stopAll(sessionId: string): void {
    const state = this.watchers.get(sessionId);
    if (!state) return;

    state.commandBridge?.stop();
    state.commandBridge = null;
  }

  /**
   * Null out the merged settings path + session dir to prevent onExit
   * cleanup race. When resuming a session, the old and new sessions
   * share the same claudeSessionId, so the session dir resolves to
   * the same path. Nulling prevents the old onExit handler from
   * deleting files the new session needs.
   *
   * Status/events paths live on StatusFileReader, not here - their
   * own detach path handles the resume race via `detachWithoutCleanup`.
   */
  nullifyPaths(sessionId: string): void {
    const state = this.watchers.get(sessionId);
    if (!state) return;
    state.mergedSettingsPath = null;
    state.sessionDir = null;
  }

  /** Stop watchers and clean up merged settings file + session directory. */
  cleanupAndRemove(sessionId: string): void {
    const state = this.watchers.get(sessionId);
    if (!state) return;

    this.stopAll(sessionId);

    // NOTE: No .mcp.json cleanup here. The suspend() and onExit() paths
    // handle their own cleanup. killAll() (app shutdown) should NOT clean up -
    // the entry will be re-injected on next session spawn.

    // Clean up merged settings file (written by Claude's command-builder).
    // status.json and events.jsonl are StatusFileReader's responsibility.
    if (state.mergedSettingsPath) {
      try { fs.unlinkSync(state.mergedSettingsPath); } catch { /* may not exist */ }
    }

    // Try to remove the now-empty session directory.
    if (state.sessionDir) {
      try { fs.rmdirSync(state.sessionDir); } catch { /* dir may not be empty or already gone */ }
    }

    this.watchers.delete(sessionId);
  }

  removeSession(sessionId: string): void {
    this.watchers.delete(sessionId);
  }
}
