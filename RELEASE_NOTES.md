## What's New
- Git diff viewer in the task detail dialog - see all file changes for any task with split or inline view modes
- Ctrl+V paste support for images in the terminal - clipboard images are saved to a temp file and the path is written to the PTY for Claude Code vision input, with shell-aware path quoting

## Bug Fixes
- Currency values now display with thousands separators
- Fixed exit events not firing for killed queued sessions
- Fixed dialog header clipping when rawBody content overflows
- Git diffs now use merge-base to show only branch-specific changes
