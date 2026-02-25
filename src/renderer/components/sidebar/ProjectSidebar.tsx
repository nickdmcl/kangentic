import React, { useState } from 'react';
import { Trash2, Plus, Folder } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import type { Project, ProjectCreateInput } from '../../../shared/types';

/** Show last 3 path segments, e.g. "Users/dev/my-project" */
function shortenPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return parts.join('/');
  return '.../' + parts.slice(-3).join('/');
}

export function ProjectSidebar() {
  const projects = useProjectStore((s) => s.projects);
  const currentProject = useProjectStore((s) => s.currentProject);
  const openProject = useProjectStore((s) => s.openProject);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const handleCreate = async () => {
    if (!newName.trim() || !newPath.trim()) return;
    const projectName = newName.trim();
    const project = await createProject({ name: projectName, path: newPath.trim() });
    useToastStore.getState().addToast({
      message: `Created project "${projectName}"`,
      variant: 'info',
    });
    await openProject(project.id);
    setShowNew(false);
    setNewName('');
    setNewPath('');
  };

  const handleCancelNew = () => {
    setShowNew(false);
    setNewName('');
    setNewPath('');
  };

  const handleDeleteClick = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setProjectToDelete(project);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    const name = projectToDelete.name;
    await deleteProject(projectToDelete.id);
    setProjectToDelete(null);
    useToastStore.getState().addToast({
      message: `Deleted project "${name}"`,
      variant: 'info',
    });
  };

  return (
    <div className="w-full h-full bg-zinc-800 flex flex-col flex-shrink-0">
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Projects</span>
          <button
            onClick={() => setShowNew(!showNew)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
            title="New project"
          >
            <Plus size={12} />
            New
          </button>
        </div>
      </div>

      {showNew && (
        <div className="mx-3 mb-2 p-2.5 border border-zinc-600 rounded-md space-y-2">
          <input
            type="text"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <input
            type="text"
            placeholder="Project path"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-2 py-1 transition-colors"
            >
              Create
            </button>
            <button
              onClick={handleCancelNew}
              className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded px-2 py-1 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {projects.map((project) => {
          const isActive = currentProject?.id === project.id;
          return (
            <button
              key={project.id}
              onClick={() => openProject(project.id)}
              className={`group w-full text-left px-3 py-2 text-sm transition-colors border-l-2 ${
                isActive
                  ? 'border-blue-500 bg-zinc-700/50 text-zinc-100'
                  : 'border-transparent text-zinc-400 hover:bg-zinc-750 hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Folder size={14} className={isActive ? 'text-blue-400' : 'text-zinc-500'} />
                <span className="truncate font-medium flex-1">{project.name}</span>
                <button
                  onClick={(e) => handleDeleteClick(e, project)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-all"
                  title="Delete project"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div
                className="truncate text-xs text-zinc-500 mt-0.5 ml-[22px]"
                title={project.path}
              >
                {shortenPath(project.path)}
              </div>
            </button>
          );
        })}
        {projects.length === 0 && (
          <div className="p-6 text-center">
            <Folder size={32} className="mx-auto text-zinc-600 mb-2" />
            <div className="text-sm text-zinc-500">No projects yet</div>
            <div className="text-xs text-zinc-600 mt-1">Click "+ New" to get started</div>
          </div>
        )}
      </div>

      {projectToDelete && (
        <ConfirmDialog
          title="Delete Project"
          message={
            <p>
              Are you sure you want to delete <strong>"{projectToDelete.name}"</strong>? This will
              remove the project from Kangentic but won't delete any files on disk.
            </p>
          }
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setProjectToDelete(null)}
        />
      )}
    </div>
  );
}
