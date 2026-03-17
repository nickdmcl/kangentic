import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Trash2, GripVertical, Folder, FolderOpen, ChevronsLeft,
  Loader2, Mail, Settings, ChevronDown, ChevronRight, FolderPlus,
  Pencil, FolderTree, ArrowUp, ArrowDown,
} from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useConfigStore } from '../../stores/config-store';
import { useSessionStore } from '../../stores/session-store';
import { useToastStore } from '../../stores/toast-store';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { Pill } from '../Pill';
import type { Project, ProjectGroup } from '../../../shared/types';

/** Show last 3 path segments, e.g. "Users/dev/my-project" */
function shortenPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return parts.join('/');
  return '.../' + parts.slice(-3).join('/');
}

interface SortableProjectItemProps {
  project: Project;
  isActive: boolean;
  thinkingCount: number;
  idleCount: number;
  isGrouped: boolean;
  onSelect: (id: string) => void;
  onOpenSettings: (e: React.MouseEvent, project: Project) => void;
  onOpenInExplorer: (e: React.MouseEvent, project: Project) => void;
  onDeleteClick: (e: React.MouseEvent, project: Project) => void;
  onContextMenu: (e: React.MouseEvent, project: Project) => void;
}

function SortableProjectItem({
  project,
  isActive,
  thinkingCount,
  idleCount,
  isGrouped,
  onSelect,
  onOpenSettings,
  onOpenInExplorer,
  onDeleteClick,
  onContextMenu,
}: SortableProjectItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(project.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(project.id); }}
      onContextMenu={(e) => onContextMenu(e, project)}
      className={`group w-full text-left py-2 text-sm transition-colors border-l-2 cursor-pointer outline-none px-3 ${
        isGrouped ? 'pl-7' : ''
      } ${
        isActive
          ? 'border-accent bg-surface-hover text-fg'
          : 'border-transparent text-fg-muted hover:bg-surface-hover/50 hover:text-fg-secondary'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex-shrink-0">
            <Folder size={16} className={`${isActive ? 'text-accent-fg' : 'text-fg-faint'} group-hover:hidden`} />
            <GripVertical size={16} className={`${isActive ? 'text-accent-fg' : 'text-fg-faint'} hidden group-hover:block cursor-grab`} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{project.name}</span>
              {idleCount > 0 && (
                <span
                  className="flex items-center gap-1 text-xs tabular-nums flex-shrink-0 text-amber-400"
                  title={`${idleCount} idle. Needs attention`}
                >
                  <Mail size={12} />
                  {idleCount}
                </span>
              )}
              {thinkingCount > 0 && (
                <span
                  className="flex items-center gap-1 text-xs tabular-nums text-green-400 flex-shrink-0"
                  title={`${thinkingCount} thinking`}
                >
                  <Loader2 size={12} className="animate-spin" />
                  {thinkingCount}
                </span>
              )}
            </div>
            <div
              className="truncate text-xs text-fg-faint mt-0.5"
              title={project.path}
            >
              {shortenPath(project.path)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={(e) => onOpenInExplorer(e, project)}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-fg-disabled hover:text-fg-tertiary hover:bg-edge-input/50 transition-all"
            title="Open in file explorer"
          >
            <FolderOpen size={16} />
          </button>
          <button
            onClick={(e) => onOpenSettings(e, project)}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-fg-disabled hover:text-fg-tertiary hover:bg-edge-input/50 transition-all"
            title="Project settings"
            data-testid={`project-settings-${project.id}`}
          >
            <Settings size={16} />
          </button>
          <button
            onClick={(e) => onDeleteClick(e, project)}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-fg-disabled hover:text-red-400 hover:bg-red-400/10 transition-all"
            title="Delete project"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Group Header ──────────────────────────────────────────────

interface GroupHeaderProps {
  group: ProjectGroup;
  projectCount: number;
  isFirst: boolean;
  isLast: boolean;
  onToggleCollapsed: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (group: ProjectGroup) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function GroupHeader({
  group,
  projectCount,
  isFirst,
  isLast,
  onToggleCollapsed,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: GroupHeaderProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `group:${group.id}` });
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSubmitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== group.name) {
      onRename(group.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleRowClick = (event: React.MouseEvent) => {
    if (isEditing) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-group-actions]')) return;
    onToggleCollapsed(group.id);
  };

  return (
    <div
      ref={setNodeRef}
      onClick={handleRowClick}
      className={`group flex items-center gap-1.5 px-3 py-2 border-l-2 border-t cursor-pointer bg-surface-hover/20 hover:bg-surface-hover/40 transition-colors ${
        isOver ? 'border-l-accent bg-accent/10 border-t-accent/50' : 'border-l-transparent border-t-edge/50'
      }`}
      data-testid={`project-group-${group.id}`}
    >
      {/* Chevron indicator */}
      <span className="flex-shrink-0 p-0.5 text-fg-muted">
        {group.is_collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </span>

      {isEditing ? (
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSubmitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmitRename();
            if (e.key === 'Escape') {
              setEditName(group.name);
              setIsEditing(false);
            }
          }}
          className="flex-1 min-w-0 text-xs font-semibold uppercase tracking-wider bg-transparent border-b border-accent text-fg outline-none px-0.5"
        />
      ) : (
        <span
          className="flex-1 min-w-0 text-xs font-semibold uppercase tracking-wider text-fg-muted truncate select-none"
        >
          {group.name}
          {group.is_collapsed && (
            <Pill size="sm" as="span" className="ml-1.5 align-middle bg-surface-hover text-[11px] text-fg-faint font-normal normal-case tracking-normal">
              {projectCount} {projectCount === 1 ? 'project' : 'projects'}
            </Pill>
          )}
        </span>
      )}

      <div data-group-actions className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onMoveUp(group.id)}
          disabled={isFirst}
          className="p-1.5 rounded-full text-fg-disabled hover:text-fg-tertiary hover:bg-edge-input/50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move group up"
        >
          <ArrowUp size={16} />
        </button>
        <button
          onClick={() => onMoveDown(group.id)}
          disabled={isLast}
          className="p-1.5 rounded-full text-fg-disabled hover:text-fg-tertiary hover:bg-edge-input/50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move group down"
        >
          <ArrowDown size={16} />
        </button>
        <button
          onClick={() => {
            setEditName(group.name);
            setIsEditing(true);
          }}
          className="p-1.5 rounded-full text-fg-disabled hover:text-fg-tertiary hover:bg-edge-input/50 transition-all"
          title="Rename group"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={() => onDelete(group)}
          className="p-1.5 rounded-full text-fg-disabled hover:text-red-400 hover:bg-red-400/10 transition-all"
          title="Delete group"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────

interface ProjectContextMenuProps {
  position: { x: number; y: number };
  project: Project;
  groups: ProjectGroup[];
  onMoveToGroup: (projectId: string, groupId: string) => void;
  onRemoveFromGroup: (projectId: string) => void;
  onClose: () => void;
}

function ProjectContextMenu({
  position,
  project,
  groups,
  onMoveToGroup,
  onRemoveFromGroup,
  onClose,
}: ProjectContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const availableGroups = groups.filter((group) => group.id !== project.group_id);
  const isGrouped = !!project.group_id;

  if (availableGroups.length === 0 && !isGrouped) return null;

  return (
    <div
      ref={containerRef}
      className="fixed bg-surface-raised border border-edge rounded-md shadow-lg z-50 py-1 min-w-[160px]"
      style={{ left: position.x, top: position.y }}
    >
      {availableGroups.length > 0 && (
        <>
          <div className="px-3 py-1 text-xs text-fg-disabled">Move to</div>
          {availableGroups.map((group) => (
            <button
              key={group.id}
              onClick={() => {
                onMoveToGroup(project.id, group.id);
                onClose();
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-fg-secondary hover:bg-surface-hover transition-colors text-left"
            >
              <FolderTree size={14} className="text-fg-faint" />
              {group.name}
            </button>
          ))}
        </>
      )}
      {isGrouped && (
        <>
          {availableGroups.length > 0 && <div className="border-t border-edge my-1" />}
          <button
            onClick={() => {
              onRemoveFromGroup(project.id);
              onClose();
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-fg-secondary hover:bg-surface-hover transition-colors text-left"
          >
            <Folder size={14} className="text-fg-faint" />
            Remove from group
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main Sidebar ──────────────────────────────────────────────

interface ProjectSidebarProps {
  onToggleSidebar?: () => void;
}

export function ProjectSidebar({ onToggleSidebar }: ProjectSidebarProps) {
  const projects = useProjectStore((s) => s.projects);
  const groups = useProjectStore((s) => s.groups);
  const currentProject = useProjectStore((s) => s.currentProject);
  const openProject = useProjectStore((s) => s.openProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const reorderProjects = useProjectStore((s) => s.reorderProjects);
  const setProjectGroup = useProjectStore((s) => s.setProjectGroup);
  const createGroup = useProjectStore((s) => s.createGroup);
  const updateGroup = useProjectStore((s) => s.updateGroup);
  const deleteGroup = useProjectStore((s) => s.deleteGroup);
  const reorderGroups = useProjectStore((s) => s.reorderGroups);
  const toggleGroupCollapsed = useProjectStore((s) => s.toggleGroupCollapsed);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionActivity = useSessionStore((s) => s.sessionActivity);
  const openProjectSettings = useConfigStore((state) => state.openProjectSettings);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<ProjectGroup | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ position: { x: number; y: number }; project: Project } | null>(null);

  const openProjectByPath = useProjectStore((s) => s.openProjectByPath);

  useEffect(() => {
    if (creatingGroup && newGroupInputRef.current) {
      newGroupInputRef.current.focus();
    }
  }, [creatingGroup]);

  const handleNewProject = async () => {
    const selectedPath = await window.electronAPI.dialog.selectFolder();
    if (!selectedPath) return;

    const project = await openProjectByPath(selectedPath);
    const wasExisting = projects.some(
      (p) => p.path.replace(/\\/g, '/') === selectedPath.replace(/\\/g, '/'),
    );
    useToastStore.getState().addToast({
      message: wasExisting ? `Opened project "${project.name}"` : `Created project "${project.name}"`,
      variant: 'info',
    });
  };

  const handleNewGroup = () => {
    setCreatingGroup(!creatingGroup);
    setNewGroupName('');
  };

  const handleSubmitNewGroup = async () => {
    const trimmed = newGroupName.trim();
    if (trimmed) {
      await createGroup({ name: trimmed });
    }
    setCreatingGroup(false);
    setNewGroupName('');
  };

  const handleOpenSettings = (event: React.MouseEvent, project: Project) => {
    event.stopPropagation();
    openProjectSettings(project.path, project.name);
  };

  const handleOpenInExplorer = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    window.electronAPI.shell.openPath(project.path);
  };

  const handleDeleteClick = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setProjectToDelete(project);
  };

  const handleConfirmDelete = async (_dontAskAgain: boolean) => {
    if (!projectToDelete) return;
    const wasActive = currentProject?.id === projectToDelete.id;
    const name = projectToDelete.name;
    await deleteProject(projectToDelete.id);
    setProjectToDelete(null);
    useToastStore.getState().addToast({
      message: `Deleted project "${name}"`,
      variant: 'info',
    });

    // Auto-select the first remaining project if the deleted one was active
    if (wasActive) {
      const remaining = useProjectStore.getState().projects;
      if (remaining.length > 0) {
        openProject(remaining[0].id);
      }
    }
  };

  const handleConfirmDeleteGroup = async (_dontAskAgain: boolean) => {
    if (!groupToDelete) return;
    await deleteGroup(groupToDelete.id);
    setGroupToDelete(null);
  };

  const handleGroupRename = async (id: string, name: string) => {
    await updateGroup(id, name);
  };

  const handleGroupMoveUp = useCallback((groupId: string) => {
    const index = sortedGroups.findIndex((g) => g.id === groupId);
    if (index <= 0) return;
    const reordered = arrayMove(sortedGroups, index, index - 1);
    reorderGroups(reordered.map((g) => g.id));
  }, [groups, reorderGroups]);

  const handleGroupMoveDown = useCallback((groupId: string) => {
    const index = sortedGroups.findIndex((g) => g.id === groupId);
    if (index === -1 || index >= sortedGroups.length - 1) return;
    const reordered = arrayMove(sortedGroups, index, index + 1);
    reorderGroups(reordered.map((g) => g.id));
  }, [groups, reorderGroups]);

  const handleContextMenu = useCallback((event: React.MouseEvent, project: Project) => {
    event.preventDefault();
    event.stopPropagation();
    if (groups.length === 0) return;
    setContextMenu({ position: { x: event.clientX, y: event.clientY }, project });
  }, [groups]);

  const handleContextMenuMoveToGroup = useCallback((projectId: string, groupId: string) => {
    setProjectGroup(projectId, groupId);
  }, [setProjectGroup]);

  const handleContextMenuRemoveFromGroup = useCallback((projectId: string) => {
    setProjectGroup(projectId, null);
  }, [setProjectGroup]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Build sorted groups and project maps
  const hasGroups = groups.length > 0;
  const sortedGroups = [...groups].sort((a, b) => a.position - b.position);
  const ungroupedProjects = hasGroups
    ? projects.filter((p) => !p.group_id)
    : projects;
  const groupedProjectsMap = new Map<string, Project[]>();
  if (hasGroups) {
    for (const group of sortedGroups) {
      groupedProjectsMap.set(
        group.id,
        projects
          .filter((p) => p.group_id === group.id)
          .sort((a, b) => a.position - b.position),
      );
    }
  }

  // Build sortable IDs: only project IDs, groups first then ungrouped
  const sortableIds: string[] = [];
  for (const group of sortedGroups) {
    if (!group.is_collapsed) {
      const groupProjects = groupedProjectsMap.get(group.id) || [];
      for (const project of groupProjects) {
        sortableIds.push(project.id);
      }
    }
  }
  for (const project of ungroupedProjects) {
    sortableIds.push(project.id);
  }

  // Collision detection that skips the dragged project's own group header,
  // so within-group reorder targets sibling projects instead of the header.
  const activeProject = activeId ? projects.find((p) => p.id === activeId) : null;
  const collisionDetection: CollisionDetection = useMemo(() => {
    const ownGroupHeaderId = activeProject?.group_id ? `group:${activeProject.group_id}` : null;
    return (args) => {
      const collisions = closestCenter(args);
      if (!ownGroupHeaderId || collisions.length === 0) return collisions;
      // If the closest hit is the project's own group header, skip it
      if (String(collisions[0].id) === ownGroupHeaderId) {
        const filtered = collisions.filter((c) => String(c.id) !== ownGroupHeaderId);
        if (filtered.length > 0) return filtered;
      }
      return collisions;
    };
  }, [activeProject?.group_id]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  // Build the full visual order: all groups' projects (by group position),
  // then ungrouped. Includes collapsed groups' projects so reorderProjects
  // always receives the complete list.
  const buildVisualOrder = useCallback((): Project[] => {
    const order: Project[] = [];
    for (const group of sortedGroups) {
      const groupProjects = groupedProjectsMap.get(group.id) || [];
      order.push(...groupProjects);
    }
    order.push(...ungroupedProjects);
    return order;
  }, [sortedGroups, groupedProjectsMap, ungroupedProjects]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    const draggedProject = projects.find((p) => p.id === activeIdStr);
    if (!draggedProject) return;

    // Dropped on a group header: assign to that group (top position)
    if (overIdStr.startsWith('group:')) {
      const targetGroupId = overIdStr.replace('group:', '');
      if (draggedProject.group_id !== targetGroupId) {
        setProjectGroup(activeIdStr, targetGroupId);
      }
      // Move to top of target group
      const visualOrder = buildVisualOrder();
      const oldIndex = visualOrder.findIndex((p) => p.id === activeIdStr);
      // Find first project in the target group to insert before it
      const firstInGroup = visualOrder.findIndex(
        (p) => p.group_id === targetGroupId && p.id !== activeIdStr,
      );
      const insertIndex = firstInGroup !== -1 ? firstInGroup : oldIndex;
      if (oldIndex === -1) return;
      const reordered = arrayMove(visualOrder, oldIndex, insertIndex);
      reorderProjects(reordered.map((p) => p.id));
      return;
    }

    // Dropped on another project
    const targetProject = projects.find((p) => p.id === overIdStr);
    if (!targetProject) return;

    // Cross-group: reassign to target's group
    if (draggedProject.group_id !== targetProject.group_id) {
      setProjectGroup(activeIdStr, targetProject.group_id);
    }

    // Reorder using visual order
    const visualOrder = buildVisualOrder();
    const oldIndex = visualOrder.findIndex((p) => p.id === activeIdStr);
    const newIndex = visualOrder.findIndex((p) => p.id === overIdStr);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(visualOrder, oldIndex, newIndex);
    reorderProjects(reordered.map((p) => p.id));
  }, [projects, buildVisualOrder, reorderProjects, setProjectGroup]);

  const renderProjectItem = (project: Project, isGrouped: boolean) => {
    const isActive = currentProject?.id === project.id;
    const runningSessions = sessions.filter(
      (s) => s.projectId === project.id && s.status === 'running',
    );
    const thinkingCount = runningSessions.filter(
      (s) => sessionActivity[s.id] !== 'idle',
    ).length;
    const idleCount = runningSessions.filter(
      (s) => sessionActivity[s.id] === 'idle',
    ).length;
    return (
      <SortableProjectItem
        key={project.id}
        project={project}
        isActive={isActive}
        thinkingCount={thinkingCount}
        idleCount={idleCount}
        isGrouped={isGrouped}
        onSelect={openProject}
        onOpenSettings={handleOpenSettings}
        onOpenInExplorer={handleOpenInExplorer}
        onDeleteClick={handleDeleteClick}
        onContextMenu={handleContextMenu}
      />
    );
  };

  return (
    <div className="w-full h-full bg-surface-raised flex flex-col flex-shrink-0">
      <div className="px-3 pt-3 pb-2 border-b border-edge">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="p-1 hover:bg-surface-hover rounded text-fg-muted hover:text-fg transition-colors"
                title="Hide sidebar"
              >
                <ChevronsLeft size={16} />
              </button>
            )}
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Projects</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Pill
              onClick={handleNewProject}
              className="border border-accent/40 text-accent-fg hover:bg-accent/15 transition-colors"
              title="Open folder as project"
            >
              <FolderPlus size={14} />
              Project
            </Pill>
            <Pill
              onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
              onClick={handleNewGroup}
              className="border border-edge/60 text-fg-muted hover:text-fg-tertiary hover:bg-surface-hover transition-colors"
              title="New group"
            >
              <FolderTree size={14} />
              Group
            </Pill>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            {/* Groups with their projects */}
            {sortedGroups.map((group, groupIndex) => {
              const groupProjects = groupedProjectsMap.get(group.id) || [];
              return (
                <React.Fragment key={group.id}>
                  <GroupHeader
                    group={group}
                    projectCount={groupProjects.length}
                    isFirst={groupIndex === 0}
                    isLast={groupIndex === sortedGroups.length - 1}
                    onToggleCollapsed={toggleGroupCollapsed}
                    onRename={handleGroupRename}
                    onDelete={setGroupToDelete}
                    onMoveUp={handleGroupMoveUp}
                    onMoveDown={handleGroupMoveDown}
                  />
                  {!group.is_collapsed && groupProjects.length > 0 && (
                    <div>
                      {groupProjects.map((project) => renderProjectItem(project, true))}
                    </div>
                  )}
                  {groupIndex === sortedGroups.length - 1 && ungroupedProjects.length > 0 && !group.is_collapsed && groupProjects.length > 0 && (
                    <div className="my-1.5 mx-3 border-b border-fg-disabled/50" />
                  )}
                </React.Fragment>
              );
            })}

            {/* Ungrouped projects below all groups */}
            {ungroupedProjects.map((project) => renderProjectItem(project, false))}

            {/* Inline group creation input */}
            {creatingGroup && (
              <div className="mx-2 my-1.5 flex items-center gap-2 px-3 py-2.5 rounded-md border border-accent/50 bg-surface-hover/30">
                <FolderTree size={16} className="text-accent-fg flex-shrink-0" />
                <input
                  ref={newGroupInputRef}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onBlur={() => {
                    setCreatingGroup(false);
                    setNewGroupName('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitNewGroup();
                    if (e.key === 'Escape') {
                      setCreatingGroup(false);
                      setNewGroupName('');
                    }
                  }}
                  placeholder="Group name"
                  className="flex-1 min-w-0 text-sm bg-transparent text-fg outline-none placeholder:text-fg-disabled"
                />
              </div>
            )}
          </SortableContext>

          <DragOverlay>
            {activeId && (() => {
              const project = projects.find((p) => p.id === activeId);
              if (!project) return null;
              const isActive = currentProject?.id === project.id;
              return (
                <div className="bg-surface-raised border border-edge rounded px-3 py-2 text-sm text-fg shadow-lg opacity-90">
                  <div className="flex items-center gap-2">
                    <Folder size={16} className={`${isActive ? 'text-accent-fg' : 'text-fg-faint'} flex-shrink-0`} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{project.name}</div>
                      <div className="truncate text-xs text-fg-faint mt-0.5">{shortenPath(project.path)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>
        {projects.length === 0 && (
          <div className="p-6 text-center">
            <Folder size={32} className="mx-auto text-fg-disabled mb-2" />
            <div className="text-sm text-fg-faint">No projects yet</div>
            <div className="text-xs text-fg-disabled mt-1">Click "+ New" to open a folder</div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-edge text-xs text-fg-disabled">
        {projects.length} project{projects.length !== 1 ? 's' : ''}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ProjectContextMenu
          position={contextMenu.position}
          project={contextMenu.project}
          groups={sortedGroups}
          onMoveToGroup={handleContextMenuMoveToGroup}
          onRemoveFromGroup={handleContextMenuRemoveFromGroup}
          onClose={() => setContextMenu(null)}
        />
      )}

      {projectToDelete && (
        <ConfirmDialog
          title="Delete Project"
          message={
            <p>
              Are you sure you want to delete <strong>&quot;{projectToDelete.name}&quot;</strong>? This will
              remove the project from Kangentic but won&apos;t delete any files on disk.
            </p>
          }
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setProjectToDelete(null)}
        />
      )}

      {groupToDelete && (() => {
        const groupProjectCount = projects.filter((p) => p.group_id === groupToDelete.id).length;
        return (
        <ConfirmDialog
          title="Delete Group"
          message={
            <p>
              Delete group <strong>&quot;{groupToDelete.name}&quot;</strong>?
              Its {groupProjectCount} project{groupProjectCount !== 1 ? 's' : ''} will become ungrouped.
            </p>
          }
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleConfirmDeleteGroup}
          onCancel={() => setGroupToDelete(null)}
        />
        );
      })()}
    </div>
  );
}
