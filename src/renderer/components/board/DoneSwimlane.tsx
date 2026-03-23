import React, { useState, useMemo, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Pencil, ArrowDownToLine, Maximize2, ClipboardList } from 'lucide-react';
import { TaskCard } from './TaskCard';
import { EditColumnDialog } from '../dialogs/EditColumnDialog';
import { CompletedTasksDialog } from '../dialogs/CompletedTasksDialog';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { getSwimlaneIcon } from '../../utils/swimlane-icons';
import { useBoardStore } from '../../stores/board-store';
import { useConfigStore } from '../../stores/config-store';
import { Pill } from '../Pill';
import type { Swimlane as SwimlaneType, Task } from '../../../shared/types';

export interface DoneSwimlaneProps {
  swimlane: SwimlaneType;
  tasks: Task[];
  dragHandleProps?: Record<string, unknown>;
}

/** Cap rendered cards to avoid DOM bloat - overflow-hidden clips anything beyond the viewport anyway. */
const MAX_RENDERED_PREVIEW = 20;

export const DoneSwimlane = React.memo(function DoneSwimlane({ swimlane, tasks }: DoneSwimlaneProps) {
  const [showEditColumn, setShowEditColumn] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showCompletedDialog, setShowCompletedDialog] = useState(false);

  const archivedTasks = useBoardStore((state) => state.archivedTasks);
  const deleteArchivedTask = useBoardStore((state) => state.deleteArchivedTask);
  const recentlyArchivedId = useBoardStore((state) => state.recentlyArchivedId);
  const clearRecentlyArchived = useBoardStore((state) => state.clearRecentlyArchived);
  const skipDeleteConfirm = useConfigStore((state) => state.config.skipDeleteConfirm);
  const updateConfig = useConfigStore((state) => state.updateConfig);

  const handleDeleteRequest = useCallback((taskId: string) => {
    if (skipDeleteConfirm) {
      deleteArchivedTask(taskId);
    } else {
      setPendingDeleteId(taskId);
    }
  }, [skipDeleteConfirm, deleteArchivedTask]);

  const handleConfirmDelete = useCallback((dontAskAgain: boolean) => {
    if (pendingDeleteId) {
      deleteArchivedTask(pendingDeleteId);
      if (dontAskAgain) updateConfig({ skipDeleteConfirm: true });
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId, deleteArchivedTask, updateConfig]);

  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  const { setNodeRef, isOver } = useDroppable({
    id: swimlane.id,
    data: { type: 'swimlane' },
  });

  const searchQuery = useBoardStore((state) => state.searchQuery);

  const filteredArchivedTasks = useMemo(() => {
    if (!searchQuery) return archivedTasks;
    const query = searchQuery.toLowerCase();
    return archivedTasks.filter(
      (task) => task.title.toLowerCase().includes(query) || task.description.toLowerCase().includes(query),
    );
  }, [archivedTasks, searchQuery]);


  return (
    <div
      data-testid="swimlane"
      data-swimlane-name={swimlane.name}
      className="flex-shrink-0 w-72 h-full flex flex-col rounded-lg bg-surface-raised/70 ring-1 ring-edge/50"
    >
      {/* Accent bar */}
      <div
        className="h-0.5 rounded-t-lg"
        style={{ backgroundColor: swimlane.color }}
      />

      {/* Column header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-edge/50 w-full text-left hover:bg-surface-hover/30 transition-colors">
        {(() => {
          const Icon = getSwimlaneIcon(swimlane);
          return Icon ? (
            <span style={{ color: swimlane.color }}><Icon size={14} strokeWidth={1.75} /></span>
          ) : (
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: swimlane.color }}
            />
          );
        })()}

        <button
          type="button"
          onClick={() => setShowEditColumn(true)}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          <span className="text-sm font-medium truncate text-fg">
            {swimlane.name}
          </span>
        </button>

        <Pill size="sm" className="bg-surface-hover/40 text-fg-faint tabular-nums leading-5">{tasks.length}</Pill>

        <button
          type="button"
          data-testid="edit-column-btn"
          aria-label={`Edit ${swimlane.name} column`}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            setShowEditColumn(true);
          }}
          className="flex-shrink-0 p-0.5 text-fg-disabled hover:text-fg-muted transition-colors"
        >
          <Pencil size={12} />
        </button>
      </div>

      {/* Drop zone */}
      <div className="p-2 flex-shrink-0">
        <div
          ref={setNodeRef}
          data-done-drop-zone
          className={`rounded-lg p-4 text-center min-h-[180px] flex items-center justify-center ${
            isOver
              ? 'drop-zone-active'
              : 'border-2 border-dashed border-edge/50 text-fg-disabled'
          }`}
          style={isOver ? { '--drop-color': swimlane.color, color: swimlane.color } as React.CSSProperties : undefined}
        >
          <div className="relative z-10 w-full">
            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              {tasks.length > 0 ? (
                <div className="space-y-2 w-full">
                  {tasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <ArrowDownToLine size={20} className="opacity-50" />
                  <span className="text-xs">Drop here to complete</span>
                </div>
              )}
            </SortableContext>
          </div>
        </div>
      </div>

      {/* Completed tasks section -- always visible */}
      <div className="flex-1 min-h-0 flex flex-col gap-1 px-2 py-2 border-t border-edge/50">
        {/* Section header */}
        <button
          type="button"
          onClick={filteredArchivedTasks.length > 0 ? () => setShowCompletedDialog(true) : undefined}
          disabled={filteredArchivedTasks.length === 0}
          className={`py-2 px-2.5 flex-shrink-0 flex items-center justify-between rounded-md transition-colors w-full text-left border ${filteredArchivedTasks.length > 0 ? 'border-edge/30 bg-surface-hover/20 hover:bg-surface-hover/40 hover:border-edge/50 cursor-pointer group' : 'border-transparent'}`}
          data-testid="expand-completed-btn"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-fg-muted">
            <ClipboardList size={14} />
            Completed ({filteredArchivedTasks.length})
          </span>
          {filteredArchivedTasks.length > 0 && (
            <Maximize2 size={14} className="text-fg-disabled group-hover:text-fg-muted transition-colors" />
          )}
        </button>

        {/* Recent archived tasks - fills available space, clips overflow with fade */}
        <div className="relative flex-1 min-h-0 overflow-hidden space-y-1">
          {/* Fade-out gradient so clipped cards don't look broken */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-surface-raised/70 to-transparent z-10" />
          {filteredArchivedTasks.slice(0, MAX_RENDERED_PREVIEW).map((task) => {
            const isGrowingIn = recentlyArchivedId === task.id;
            return isGrowingIn ? (
              <div
                key={task.id}
                className="grow-in"
                onAnimationEnd={clearRecentlyArchived}
              >
                <TaskCard task={task} compact onDelete={handleDeleteRequest} />
              </div>
            ) : (
              <TaskCard
                key={task.id}
                task={task}
                compact
                onDelete={handleDeleteRequest}
              />
            );
          })}
          {filteredArchivedTasks.length === 0 && (
            <div className="text-xs text-fg-disabled text-center py-3">{searchQuery ? 'No matching completed tasks' : 'No completed tasks yet'}</div>
          )}
        </div>

        {/* View all button - always visible at bottom */}
        {filteredArchivedTasks.length > 0 && (
          <button
            type="button"
            onClick={() => setShowCompletedDialog(true)}
            className="flex-shrink-0 w-full text-xs text-fg-muted hover:text-fg-secondary hover:bg-surface-hover py-1.5 px-3 rounded-lg bg-surface-hover/30 border border-edge/30 transition-colors"
            data-testid="view-all-completed"
          >
            View all {filteredArchivedTasks.length} completed tasks
          </button>
        )}
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          title="Delete completed task"
          message={<>
            <p>This will permanently delete the task, its session history, and any associated worktree.</p>
            <p className="text-red-400 font-medium">This action cannot be undone.</p>
          </>}
          confirmLabel="Delete"
          variant="danger"
          showDontAskAgain
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}

      {showEditColumn && (
        <EditColumnDialog
          swimlane={swimlane}
          onClose={() => setShowEditColumn(false)}
        />
      )}

      {showCompletedDialog && (
        <CompletedTasksDialog
          onClose={() => setShowCompletedDialog(false)}
        />
      )}
    </div>
  );
});
