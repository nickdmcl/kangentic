## Bug Fixes
- Fixed app showing the welcome screen instead of the last-opened project on startup. This was a regression in v0.7.0 caused by IPC handlers initializing after the project preload. Also fixes a pre-existing macOS crash when re-clicking the dock icon after closing all windows.
