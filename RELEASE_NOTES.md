## What's New
- **Configurable shortcuts**: Add custom command buttons to the task detail dialog header and menu. Launch VS Code, TortoiseGit, terminals, or any tool with one click. Template variables (`{{cwd}}`, `{{branchName}}`, etc.) resolve at runtime. Presets for 16+ popular tools included. Team and personal scopes via board config files.
- **Claude commands popover**: Browse and run project-specific Claude Code commands directly from the task detail dialog. Search by name, navigate with keyboard.
- **Session summary for completed tasks**: View cost, duration, token usage, tool calls, and lines changed for finished sessions. Sort and search completed tasks in the Done column.
- **Task card status indicators**: Cards now show contextual status at a glance: model name with context percentage while running, idle icon when waiting for input, "Queued...", "Paused", or "Initializing..." during transitions.
- **Mechanical documentation audit**: New doc-auditor agent mechanically verifies that docs enumerate all source-code structures (IPC channels, DB columns, config keys, type unions). Integrated into the release, commit, and doc-update workflows.

## Bug Fixes
- Fixed terminal viewport snapping to top on resize or fit
- Fixed scroll position lost when terminal reflows during user scroll
- Fixed false idle detection during Claude Code nucleation and long-running tool executions
- Fixed "Rendered more hooks" crash when archiving a task from the detail dialog
- Fixed false "config changed" dialog appearing when no actual changes occurred
- Fixed generic "Resuming agent" label showing instead of the auto_command name during transitions
- Fixed session suspend/resume triggering unnecessarily when only permission mode differs
- Fixed IPC listeners not re-registering after HMR store replacement
- Fixed worktree checkout not including `.claude/skills/` and `.claude/agents/`
- Fixed shortcut preset using wrong Lucide icon name for TortoiseGit Commit
