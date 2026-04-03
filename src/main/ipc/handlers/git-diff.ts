import { ipcMain } from 'electron';
import simpleGit from 'simple-git';
import { IPC } from '../../../shared/ipc-channels';
import { DiffService } from '../../git/diff-service';
import { DiffWatcher } from '../../git/diff-watcher';
import type { GitDiffFilesInput, GitFileContentInput, GitPendingChangesInput, GitPendingChangesResult } from '../../../shared/types';
import type { IpcContext } from '../ipc-context';

export function registerGitDiffHandlers(context: IpcContext): void {
  const watcher = new DiffWatcher();

  // Cache DiffService instances per directory so the merge-base cache persists
  // across getDiffFiles and getFileContent calls, avoiding redundant git
  // merge-base subprocess spawns on every file click.
  const serviceCache = new Map<string, DiffService>();

  function getOrCreateService(gitDirectory: string): DiffService {
    const existing = serviceCache.get(gitDirectory);
    if (existing) return existing;
    const service = new DiffService(gitDirectory);
    serviceCache.set(gitDirectory, service);
    return service;
  }

  ipcMain.handle(IPC.GIT_DIFF_FILES, async (_, input: GitDiffFilesInput) => {
    const service = getOrCreateService(input.worktreePath ?? input.projectPath);
    return service.getDiffFiles(input);
  });

  ipcMain.handle(IPC.GIT_FILE_CONTENT, async (_, input: GitFileContentInput) => {
    const service = getOrCreateService(input.worktreePath ?? input.projectPath);
    return service.getFileContent(input);
  });

  ipcMain.on(IPC.GIT_DIFF_SUBSCRIBE, (_, worktreePath: string) => {
    watcher.subscribe(worktreePath, () => {
      if (!context.mainWindow.isDestroyed()) {
        context.mainWindow.webContents.send(IPC.GIT_DIFF_CHANGED);
      }
    });
  });

  ipcMain.handle(IPC.GIT_CHECK_PENDING_CHANGES, async (_, input: GitPendingChangesInput): Promise<GitPendingChangesResult> => {
    try {
      const git = simpleGit(input.checkPath);
      const status = await git.status();

      const uncommittedFileCount = status.files.length;

      let unpushedCommitCount = 0;
      try {
        const countOutput = (await git.raw(['rev-list', 'HEAD', '--not', '--remotes', '--count'])).trim();
        unpushedCommitCount = parseInt(countOutput, 10) || 0;
      } catch {
        // No remotes or detached HEAD - treat as 0 unpushed
      }

      const hasPendingChanges = uncommittedFileCount > 0 || unpushedCommitCount > 0;
      return { hasPendingChanges, uncommittedFileCount, unpushedCommitCount };
    } catch {
      // If git fails (missing directory, corrupted repo, etc.), assume changes exist as safe default
      return { hasPendingChanges: true, uncommittedFileCount: 0, unpushedCommitCount: 0 };
    }
  });

  ipcMain.on(IPC.GIT_DIFF_UNSUBSCRIBE, (_, worktreePath: string) => {
    watcher.unsubscribe(worktreePath);
    serviceCache.delete(worktreePath);
  });
}
