# Documentation Maintenance

Contextual knowledge for keeping `docs/` in sync with source code.

## Source-to-Doc Mapping

Each doc file and the source files that are its authority:

| Doc | Primary Source Files |
|-----|---------------------|
| `architecture.md` | `src/shared/ipc-channels.ts`, `src/preload/preload.ts`, `src/renderer/stores/`, `src/main/pty/session-manager.ts` |
| `session-lifecycle.md` | `src/main/pty/session-manager.ts`, `src/main/pty/session-queue.ts`, `src/main/engine/session-recovery.ts` |
| `configuration.md` | `src/shared/types.ts` (AppConfig, DEFAULT_CONFIG, GLOBAL_ONLY_PATHS), `src/main/config/config-manager.ts` |
| `claude-integration.md` | `src/main/agent/command-builder.ts`, `src/main/agent/hook-manager.ts`, `src/main/agent/trust-manager.ts`, `src/main/agent/claude-detector.ts` |
| `transition-engine.md` | `src/main/engine/transition-engine.ts`, `src/shared/types.ts` (ActionType, ActionConfig) |
| `database.md` | `src/main/db/migrations.ts`, `src/main/db/database.ts`, `src/main/db/repositories/*.ts` |
| `cross-platform.md` | `src/main/pty/shell-resolver.ts`, `electron-builder.yml`, `scripts/build.js` |
| `worktree-strategy.md` | `src/main/git/worktree-manager.ts`, `src/main/agent/hook-manager.ts`, `src/main/agent/trust-manager.ts` |
| `activity-detection.md` | `src/main/agent/event-bridge.js`, `src/shared/types.ts` (EventType, EventTypeActivity, HookEvent) |
| `overview.md` | `README.md`, high-level features |
| `user-guide.md` | `src/renderer/components/`, `src/renderer/stores/`, `src/shared/types.ts` |
| `developer-guide.md` | `scripts/`, `tests/`, `electron-builder.yml`, `package.json` |
| `docs/README.md` | All other docs (index) |

## Doc Conventions

- Flat structure in `docs/` -- no subdirectories
- Each doc has a clear H1 title and opening paragraph stating purpose
- Cross-reference other docs with relative links (`[Title](filename.md)`)
- Technical docs include "See Also" sections at the bottom
- No emojis
- Tables for structured data (schema, config keys, constants)
- Code blocks for CLI commands and file structures

## When to Create a New Doc

- A new major subsystem is added (new directory under `src/main/`)
- An existing doc exceeds ~500 lines and covers two distinct topics
- A new integration point is added (new agent type, new build target)

## When to Delete a Doc

- The subsystem it documents has been removed entirely
- Its content has been fully merged into another doc
- Always update `docs/README.md` and `README.md` when adding/removing

## Anchor Points

Anchors are enumerable source-code structures that must be exhaustively listed in docs. A mechanical audit counts items in source, counts items in docs, and reports the diff.

### Type System Anchors (src/shared/types.ts)

| Anchor | What to extract | Target doc |
|--------|----------------|------------|
| `PermissionMode` | Union variants | configuration.md, database.md |
| `ActionType` | Union variants | transition-engine.md |
| `SessionStatus` | Union variants | session-lifecycle.md |
| `SessionRecordStatus` | Union variants | session-lifecycle.md, database.md |
| `SwimlaneRole` | Union variants | database.md |
| `SuspendedBy` | Union variants | database.md |
| `ThemeMode` | Union variants | configuration.md |
| `EventType` | Object keys | activity-detection.md |
| `HookEvent` | Object keys | claude-integration.md |
| `EventTypeActivity` | Mapping entries | activity-detection.md |
| `AppConfig` / `DEFAULT_CONFIG` | Flattened dot-paths + defaults | configuration.md |
| `BoardConfig` | Interface fields | configuration.md |
| `BoardColumnConfig` | Interface fields | configuration.md |

### IPC Anchors (src/shared/ipc-channels.ts)

| Anchor | What to extract | Target doc |
|--------|----------------|------------|
| IPC channels | All string values from `IPC` object | architecture.md (per-group tables) |
| IPC group counts | Count per section header | architecture.md (section headers) |

### Database Anchors (src/main/db/migrations.ts)

| Anchor | What to extract | Target doc |
|--------|----------------|------------|
| Table schemas | All `CREATE TABLE` columns + `ALTER TABLE ADD COLUMN` | database.md (schema tables) |
| Seed data | Default swimlanes, actions, transitions | database.md |
| Migration list | Numbered migrations with descriptions | database.md (migration history) |

### UI Anchors

| Anchor | Source file | Target doc |
|--------|-----------|------------|
| Settings tabs | `src/renderer/components/settings/AppSettingsPanel.tsx` tab array | user-guide.md, configuration.md |
| Settings registry | `src/renderer/components/settings/settings-registry.ts` entries | configuration.md |

### Template Anchors

| Anchor | Source file | Target doc |
|--------|-----------|------------|
| Template variables | `src/shared/template-vars.ts` | configuration.md (canonical), transition-engine.md and claude-integration.md (cross-reference only) |

### Verification Procedures

See `references/verification-procedures.md` for step-by-step extraction instructions per anchor type.

## Categories of Drift

Anchors catch ~70% of drift (missing enumerable items). The remaining ~30% is prose drift that requires reading and comparing:

- Changed behavior or algorithm descriptions
- Stale default value explanations
- Feature interaction descriptions
- Renamed parameters or function signatures
- New or removed CLI flags in command builder
- Altered shell detection order or platform-specific logic
