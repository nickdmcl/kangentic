/**
 * Validate a git branch name according to git-check-ref-format rules.
 * Returns true if the name is valid, false otherwise.
 *
 * Rejects: leading `-`, `..`, spaces, control chars, `~^:*?[\`,
 * `@{`, consecutive or trailing slashes, `.lock` suffix, trailing `.`,
 * and empty/whitespace-only input.
 */
export function isValidGitBranchName(name: string): boolean {
  if (!name || !name.trim()) return false;

  // No ASCII control characters or space, DEL
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f ]/.test(name)) return false;

  // Forbidden characters: ~ ^ : * ? [ \
  if (/[~^:*?[\\]/.test(name)) return false;

  // No `..` anywhere
  if (name.includes('..')) return false;

  // No `@{` anywhere
  if (name.includes('@{')) return false;

  // Cannot start with `-` or `/`
  if (name.startsWith('-') || name.startsWith('/')) return false;

  // Cannot end with `/` or `.`
  if (name.endsWith('/') || name.endsWith('.')) return false;

  // Cannot end with `.lock`
  if (name.endsWith('.lock')) return false;

  // No consecutive slashes
  if (name.includes('//')) return false;

  // No component can start with `.`
  if (name.split('/').some(component => component.startsWith('.'))) return false;

  return true;
}
