/**
 * Turn a string into a filesystem-safe slug.
 * e.g. "Fix login bug (urgent!)" → "fix-login-bug-urgent"
 */
export function slugify(text: string, maxLen = 20): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
}

/**
 * Compute max slug length to keep worktree paths under Windows MAX_PATH (260).
 * On non-Windows platforms this is not called - the static default (20) is used.
 *
 * Budget = 260 - projectPath - ".kangentic/worktrees/" - "-{shortId}" - reserve
 * Capped at 20 (readable) and floored at 0 (hash-only fallback).
 */
export function computeSlugBudget(projectPath: string): number {
  const WINDOWS_MAX_PATH = 260;
  const WORKTREE_PREFIX_LENGTH = '.kangentic/worktrees/'.length; // 21
  const SHORT_ID_SUFFIX_LENGTH = 9; // '-' + 8-char hash
  const RESERVED_FOR_BUILD_OUTPUT = 80;

  const available = WINDOWS_MAX_PATH
    - projectPath.length
    - WORKTREE_PREFIX_LENGTH
    - SHORT_ID_SUFFIX_LENGTH
    - RESERVED_FOR_BUILD_OUTPUT;

  return Math.max(0, Math.min(available, 20));
}

/**
 * Compose the auto-generated branch name. When branching off a non-default
 * base, the base is encoded as a namespace prefix (with any '/' flattened to
 * '-') so `git branch` / GitHub branch lists group work by base.
 *
 * Example: base='bugfix/inacc-adjustments', default='main',
 * slug='task-title', shortId='ab12cd34'
 *   produces 'bugfix-inacc-adjustments/task-title-ab12cd34'
 *
 * When base equals default (or is empty), the legacy unprefixed form is used:
 *   produces 'task-title-ab12cd34'
 */
export function computeAutoBranchName(
  baseBranch: string,
  defaultBaseBranch: string,
  slug: string,
  shortId: string,
): string {
  const trimmedBase = (baseBranch ?? '').trim();
  const trimmedDefault = (defaultBaseBranch ?? '').trim();
  const suffix = `${slug}-${shortId}`;
  if (!trimmedBase || trimmedBase === trimmedDefault) return suffix;
  const flattenedBase = trimmedBase.replace(/\//g, '-');
  return `${flattenedBase}/${suffix}`;
}
