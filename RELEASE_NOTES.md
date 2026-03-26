## What's New
- **Backlog View** - stage tasks in a dedicated backlog before promoting them to the board. Includes priorities, labels, drag-to-reorder, filtering, multi-select bulk operations, and right-click context menus
- **External Import** - pull issues from GitHub Issues, GitHub Projects, and Azure DevOps into the backlog with full metadata (descriptions, labels, attachments, comments)
- **Board Filtering** - filter board tasks by priority level and label using a new filter popover. A search bar (Ctrl+F) filters across all columns
- **Labels and Priorities on Board** - labels and priority levels now carry from backlog to board tasks. Edit them in task forms and see label pills on cards
- **Markdown Descriptions** - task descriptions render full GitHub Flavored Markdown (tables, task lists, strikethrough, links)
- **File Attachments** - paste or drag-and-drop any file type as an attachment, not just images. Drag files onto the terminal to insert file paths
- **Task Display IDs** - each task gets a sequential numeric ID (e.g., #42) shown on cards and in the task detail dialog. Click to copy
- **Status Bar** - aggregate cost and token usage at the bottom of the window with a time period dropdown (Live, Today, This Week, This Month, All Time)
- **Context Menus** - right-click task cards and backlog rows for quick access to move, edit, delete, and archive actions
- **Amber Idle Indicator** - idle sessions now show a pulsing amber dot on their tab instead of auto-focusing the panel (auto-focus remains available as an opt-in setting)
- **Background Command Terminal** - command terminal sessions persist when closed and can be reattached, including across project switches
- **MCP Enhancements** - display IDs, label color support, file attachment support, and an external command bridge for preview isolation
- **Column Drop Highlights** - drag-and-drop targets now use the column's configured color for visual feedback

## Bug Fixes
- Fixed large paste truncation in terminals with chunked PTY writes and bracketed paste
- Fixed xterm cursor flickering by making cursor transparent
- Preserved command terminal sessions across project switches
- Fixed stale agent spawns when tasks are moved quickly between columns (AbortSignal throughout)
- Fixed backlog promotion to ensure all promoted tasks get agents
- Enabled core.longpaths for git worktree creation on Windows (fixes deeply nested paths)
- Fixed UNC path support for SMB network share projects
- Fixed context menu paste to be consistent with Ctrl+V behavior
