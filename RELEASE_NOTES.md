## What's New
- Custom branch names for tasks. Configure the branch name directly when creating or editing tasks, with full branch config UI in the backlog edit dialog.
- Default base branch setting in team-shared `kangentic.json`, so all team members use the same base branch without per-user configuration.
- Moving tasks out of Backlog is now a destructive move (kills existing session), preventing stale sessions from lingering.

## Bug Fixes
- Fixed prompt template being incorrectly applied when starting tasks from non-backlog columns (e.g. resuming).
- Fixed terminal color corruption caused by scrollback replay sending raw ANSI sequences.
- Fixed CWD validation for PTY spawning with enhanced diagnostics for posix_spawnp failures on macOS/Linux.
- Fixed task detail dialog disappearing when the board reloads in the background.
- Fixed garbled terminal output when resuming sessions by preserving scrollback correctly during handoff.
- Fixed launcher version detection to use a cross-platform version marker instead of fragile OS-specific checks.
