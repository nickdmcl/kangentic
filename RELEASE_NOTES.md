## Bug Fixes
- Fixed packaged builds failing to start due to @aptabase/electron not being bundled correctly
- Fixed macOS spawn-helper lacking execute permissions, preventing PTY sessions from starting
- Fixed garbled TUI output when replaying terminal scrollback at a different width than the original session
