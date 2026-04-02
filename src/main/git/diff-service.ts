import simpleGit from 'simple-git';
import fs from 'node:fs';
import path from 'node:path';
import type { GitDiffFilesInput, GitDiffFilesResult, GitDiffFileEntry, GitDiffStatus, GitFileContentInput, GitFileContentResult } from '../../shared/types';

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.jsonc': 'json',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'html', '.htm': 'html',
  '.xml': 'xml', '.svg': 'xml',
  '.md': 'markdown', '.mdx': 'markdown',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.dockerfile': 'dockerfile',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.php': 'php',
  '.lua': 'lua',
  '.r': 'r',
  '.toml': 'toml',
  '.ini': 'ini',
};

function inferLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (EXTENSION_LANGUAGE_MAP[extension]) return EXTENSION_LANGUAGE_MAP[extension];

  // Handle special filenames without extensions
  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';

  return 'plaintext';
}

/**
 * Parse `git diff --name-status` output into a map of path -> status.
 * Format: `STATUS\tpath` or `R100\told-path\tnew-path` for renames.
 */
function parseNameStatus(output: string): Map<string, { status: GitDiffStatus; oldPath?: string }> {
  const result = new Map<string, { status: GitDiffStatus; oldPath?: string }>();
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;

    const statusCode = parts[0];
    if (statusCode.startsWith('R')) {
      // Rename: R100\told-path\tnew-path
      const oldPath = parts[1];
      const newPath = parts[2];
      if (newPath) {
        result.set(newPath, { status: 'R', oldPath });
      }
    } else if (statusCode.startsWith('C')) {
      // Copy: C100\told-path\tnew-path
      const newPath = parts[2];
      if (newPath) {
        result.set(newPath, { status: 'C' });
      }
    } else {
      const status = statusCode.charAt(0) as GitDiffStatus;
      if (['A', 'M', 'D'].includes(status)) {
        result.set(parts[1], { status });
      }
    }
  }
  return result;
}

export class DiffService {
  private readonly gitDirectory: string;
  private mergeBaseCache: Map<string, string> = new Map();

  constructor(gitDirectory: string) {
    this.gitDirectory = gitDirectory;
  }

  /**
   * Find the merge-base between the base branch and HEAD.
   * This is the fork point - where the task branch diverged from the base.
   * Diffing against this (instead of the base branch tip) shows only changes
   * made on this branch, excluding changes merged into the base after forking.
   * Result is cached per base branch to avoid redundant git subprocess calls
   * (getDiffFiles and getFileContent both need the merge-base).
   */
  private async getMergeBase(git: ReturnType<typeof simpleGit>, baseBranch: string): Promise<string> {
    const cached = this.mergeBaseCache.get(baseBranch);
    if (cached) return cached;

    try {
      const result = await git.raw(['merge-base', baseBranch, 'HEAD']);
      const ref = result.trim();
      this.mergeBaseCache.set(baseBranch, ref);
      return ref;
    } catch {
      // Base branch doesn't exist (e.g. repo uses 'master' not 'main') - fall back to HEAD
      // so the panel still shows uncommitted working tree changes.
      this.mergeBaseCache.set(baseBranch, 'HEAD');
      return 'HEAD';
    }
  }

  async getDiffFiles(input: GitDiffFilesInput): Promise<GitDiffFilesResult> {
    const git = simpleGit(this.gitDirectory);
    const { baseBranch } = input;

    // Always diff working tree against the merge-base (fork point).
    // This shows changes made on this branch including uncommitted edits.
    // When on the base branch itself (e.g. main), merge-base resolves to HEAD,
    // so only uncommitted working tree changes are shown.
    const diffRef = await this.getMergeBase(git, baseBranch);

    // Run git commands in parallel for faster initial load.
    // git.status() fetches untracked files that git diff ignores.
    const [summary, nameStatusOutput, gitStatus] = await Promise.all([
      git.diffSummary([diffRef]),
      git.diff(['--name-status', diffRef]),
      git.status(),
    ]);
    const statusMap = parseNameStatus(nameStatusOutput);

    const files: GitDiffFileEntry[] = summary.files.map((file) => {
      const filePath = file.file;
      const statusInfo = statusMap.get(filePath);
      const isBinary = file.binary;

      // Determine status: prefer --name-status, fall back to heuristic
      let status: GitDiffStatus = 'M';
      let oldPath: string | undefined;
      if (statusInfo) {
        status = statusInfo.status;
        oldPath = statusInfo.oldPath;
      } else if (!isBinary) {
        if (file.insertions > 0 && file.deletions === 0) status = 'A';
        else if (file.insertions === 0 && file.deletions > 0) status = 'D';
      }

      return {
        path: filePath,
        status,
        insertions: isBinary ? 0 : file.insertions,
        deletions: isBinary ? 0 : file.deletions,
        oldPath,
        binary: isBinary,
      };
    });

    // Merge untracked (new) files from git status. git diff only covers
    // tracked files, so newly created files need to come from status.not_added.
    const trackedPaths = new Set(files.map((file) => file.path));
    const untrackedPaths = gitStatus.not_added.filter((filePath) => !trackedPaths.has(filePath));

    const untrackedEntries = await Promise.all(
      untrackedPaths.map(async (filePath): Promise<GitDiffFileEntry> => {
        const absolutePath = path.join(this.gitDirectory, filePath);
        try {
          const buffer = await fs.promises.readFile(absolutePath);
          // Binary detection: check first 8KB for null bytes (same heuristic as git)
          const checkLength = Math.min(buffer.length, 8192);
          let isBinary = false;
          for (let index = 0; index < checkLength; index++) {
            if (buffer[index] === 0) { isBinary = true; break; }
          }
          // Count newline bytes directly on the buffer to avoid a full string allocation.
          // Add 1 for the last line if the file doesn't end with a newline.
          let insertions = 0;
          if (!isBinary) {
            for (let index = 0; index < buffer.length; index++) {
              if (buffer[index] === 0x0A) insertions++;
            }
            if (buffer.length > 0 && buffer[buffer.length - 1] !== 0x0A) insertions++;
          }
          return { path: filePath, status: 'U', insertions, deletions: 0, binary: isBinary };
        } catch {
          // File may have been deleted between status and read
          return { path: filePath, status: 'U', insertions: 0, deletions: 0, binary: false };
        }
      }),
    );

    files.push(...untrackedEntries);
    const untrackedInsertions = untrackedEntries.reduce((sum, entry) => sum + entry.insertions, 0);

    return {
      files,
      totalInsertions: summary.insertions + untrackedInsertions,
      totalDeletions: summary.deletions,
    };
  }

  async getFileContent(input: GitFileContentInput): Promise<GitFileContentResult> {
    const git = simpleGit(this.gitDirectory);
    const { baseBranch, filePath, status, oldPath } = input;
    const language = inferLanguage(filePath);

    const needsOriginal = status !== 'A' && status !== 'U';
    const needsModified = status !== 'D';

    // Fetch original (from git) and modified (from disk) in parallel.
    // These are independent I/O operations - overlapping them cuts latency
    // for modified files (the most common case) by ~30-50%.
    const [original, modified] = await Promise.all([
      needsOriginal
        ? (async () => {
            try {
              const showPath = oldPath ?? filePath;
              const mergeBase = await this.getMergeBase(git, baseBranch);
              return await git.show([`${mergeBase}:${showPath}`]);
            } catch {
              return '';
            }
          })()
        : '',
      needsModified
        ? (async () => {
            const workingDirectory = input.worktreePath ?? input.projectPath;
            const absolutePath = path.join(workingDirectory, filePath);
            try {
              return await fs.promises.readFile(absolutePath, 'utf-8');
            } catch {
              return '';
            }
          })()
        : '',
    ]);

    return { original, modified, language };
  }
}
