import { FolderGit2 } from 'lucide-react';

interface WorktreeChipProps {
  enabled: boolean;
  onToggle: () => void;
}

export function WorktreeChip({ enabled, onToggle }: WorktreeChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
        enabled
          ? 'border-edge-input text-fg-muted hover:text-fg-secondary hover:border-fg-faint'
          : 'border-edge-input text-fg-disabled hover:border-fg-faint'
      }`}
      title={enabled ? 'Worktree enabled -- click to disable' : 'Worktree disabled -- click to enable'}
      data-testid="worktree-toggle"
    >
      <FolderGit2 size={16} className={enabled ? '' : 'opacity-40'} />
      <span className={enabled ? '' : 'line-through opacity-60'}>Worktree</span>
    </button>
  );
}
