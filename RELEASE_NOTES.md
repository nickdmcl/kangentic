## What's New
- Cross-platform desktop Kanban board purpose-built for Claude Code agents
- Drag-and-drop task management with automatic agent spawning on column transitions
- Live terminal output streaming from Claude Code sessions
- Session persistence -- resume agents across app restarts
- Git worktree integration for isolated agent workspaces
- Hook-based activity log showing structured tool calls and agent state
- Image attachments in task dialogs
- Multi-theme support with 8 named color themes and light/dark/system switching
- Token usage display in task detail and app footer
- Desktop notifications when agents go idle or need input
- Auto-command feature for swimlane columns
- Persistent project reordering via drag-and-drop in sidebar
- Per-project config overrides with global/project settings scope
- Resizable sidebar with auto-collapse
- npx launcher for easy installation (`npx kangentic`)

## Bug Fixes
- Synchronous shutdown eliminates zombie processes and phantom auto-restart on Windows
- Fixed task cards stuck on Idle after permission prompts during subagent work
- Fixed drag-and-drop grey screen crash with error boundaries
- Fixed CLI option parsing for prompts containing `->`, `--`, and double quotes
- Fixed context window progress bar showing inflated percentages
- Fixed Windows taskbar icon showing Electron logo instead of Kangentic
- Fixed desktop notification click-to-open and icon quality
