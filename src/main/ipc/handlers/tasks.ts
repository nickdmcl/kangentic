/**
 * Barrel file - delegates to focused handler modules.
 *
 * Re-exports preserve existing import paths in:
 *   - src/main/ipc/register-all.ts (registerTaskHandlers)
 *   - src/main/ipc/handlers/sessions.ts (handleTaskMove, guardActiveNonWorktreeSessions)
 *   - tests/unit/carry-uncommitted-changes.test.ts (carryUncommittedChanges)
 */

import type { IpcContext } from '../ipc-context';
import { registerTaskCrudHandlers } from './task-crud';
import { registerTaskMoveHandlers } from './task-move';
import { registerTaskBranchHandlers } from './task-branch';

// Re-exports for external consumers
export { handleTaskMove, guardActiveNonWorktreeSessions } from './task-move';
export { carryUncommittedChanges } from './task-branch';
export type { CarryResult } from './task-branch';

export function registerTaskHandlers(context: IpcContext): void {
  registerTaskCrudHandlers(context);
  registerTaskMoveHandlers(context);
  registerTaskBranchHandlers(context);
}
