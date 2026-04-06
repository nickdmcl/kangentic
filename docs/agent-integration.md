# Agent Integration

Kangentic supports four AI coding agents: Claude Code, Codex CLI, Gemini CLI, and Aider. Each agent is wrapped behind a common `AgentAdapter` interface that handles CLI detection, command building, permission mapping, session lifecycle hooks, and cross-agent handoff. This doc covers the adapter system, agent-specific details, and shared infrastructure.

## Agent Adapter Interface

`src/main/agent/agent-adapter.ts`

Every agent implements the `AgentAdapter` interface. Each adapter lives in `src/main/agent/adapters/<name>/`. TUI agents also have a `transcript-cleanup.ts` file for handoff transcript processing (see [Handoff - Per-Agent Transcript Cleanup](handoff.md#per-agent-transcript-cleanup)).

| Method | Purpose |
|--------|---------|
| `detect(overridePath?)` | Locate the CLI binary and return path + version |
| `invalidateDetectionCache()` | Reset cached detection (e.g. after user changes CLI path) |
| `ensureTrust(workingDirectory)` | Pre-approve a directory so the agent doesn't prompt for trust |
| `buildCommand(options)` | Build the shell command string to spawn the agent |
| `interpolateTemplate(template, variables)` | Replace `{{key}}` placeholders in prompt templates |
| `parseStatus(raw)` | Parse agent-specific status data into `SessionUsage` |
| `parseEvent(line)` | Parse a single JSONL event line into `SessionEvent` |
| `stripHooks(directory)` | Remove monitoring hooks on cleanup |
| `clearSettingsCache()` | Clear cached merged settings |
| `detectFirstOutput(data)` | Detect when the agent TUI is ready (lifts shimmer overlay) |
| `getExitSequence()` | Return PTY write sequence for graceful exit |
| `transformHandoffPrompt(prompt, contextFilePath)` | Add agent-specific hints to handoff prompts |

### Required Properties

| Property | Type | Purpose |
|----------|------|---------|
| `name` | `string` | Unique identifier (`'claude'`, `'codex'`, `'gemini'`, `'aider'`) |
| `displayName` | `string` | Human-readable product name |
| `sessionType` | `SessionRecord['session_type']` | Value stored in the sessions DB table |
| `permissions` | `AgentPermissionEntry[]` | Supported permission modes with agent-specific labels |
| `defaultPermission` | `PermissionMode` | Recommended default permission mode |

## Supported Agents

| Agent | Adapter | CLI Binary | Session Resume | Status/Events | Settings Merge | Trust |
|-------|---------|-----------|----------------|---------------|----------------|-------|
| Claude Code | `claude-adapter.ts` | `claude` | `--resume <id>` | Yes (status.json + events.jsonl) | Yes (`--settings`) | Yes (`~/.claude.json`) |
| Codex CLI | `codex-adapter.ts` | `codex` | `resume <id>` | Partial (events.jsonl only) | No | No |
| Gemini CLI | `gemini-adapter.ts` | `gemini` | `--resume <id>` | Yes (status.json + events.jsonl) | Yes (`.gemini/settings.json`) | No |
| Aider | `aider-adapter.ts` | `aider` | No | No | No | No |

## Agent Resolution

`src/main/engine/agent-resolver.ts`

When a task moves to a column, `resolveTargetAgent()` determines which agent to spawn:

1. **Column agent_override** (per-column setting) - highest priority
2. **Project default_agent** (per-project setting)
3. **Global fallback** (`DEFAULT_AGENT` constant, currently `'claude'`)

`task.agent` is intentionally NOT in the resolution chain. It records which agent last ran on the task (for resume and handoff detection), but column and project settings are the authority for which agent should run. Including `task.agent` caused bugs where tasks that previously ran Claude would always resolve to Claude even when moved to a Codex column.

**Handoff detection:** When `task.agent` is set and differs from the resolved agent, a cross-agent handoff is triggered. See [Handoff](handoff.md) for the full context transfer flow.

## First-Output Detection

Each adapter implements `detectFirstOutput(data)` to signal when the agent's TUI is ready. This controls when the shimmer overlay lifts in the terminal UI.

| Agent | Detection Strategy | Rationale |
|-------|-------------------|-----------|
| Claude Code | `\x1b[?25l` (cursor hide) | TUI hides cursor when it takes over the terminal |
| Codex CLI | `\x1b[?25l` (cursor hide) | Same TUI pattern as Claude |
| Gemini CLI | `\x1b[?25l` (cursor hide) | Same TUI pattern as Claude |
| Aider | `data.length > 0` | Aider writes output immediately (no TUI alternate screen) |

The `\x1b[?25l` (ANSI cursor hide) sequence fires after the shell prompt noise but before the TUI draws its startup banner. This keeps the shell command hidden behind the shimmer overlay.

## Exit Sequences

Graceful exit sequences written to the PTY during `SessionManager.suspend()`:

| Agent | Sequence | Notes |
|-------|----------|-------|
| Claude Code | `Ctrl+C`, `/exit` | Flushes conversation state to JSONL transcript |
| Codex CLI | `Ctrl+C` | API-backed sessions, no local state to flush |
| Gemini CLI | `Ctrl+C`, `/quit` | Triggers clean shutdown |
| Aider | `Ctrl+C` | No session resume, clean exit sufficient |

## Handoff Prompt Transform

During cross-agent handoff, each adapter can add agent-specific hints to the handoff prompt:

| Agent | Transform |
|-------|-----------|
| Claude Code | Appends hint to use the `kangentic_get_handoff_context` MCP tool |
| Codex CLI | Appends file path reference to `handoff-context.md` |
| Gemini CLI | Appends file path reference to `handoff-context.md` |
| Aider | Appends file path reference to `handoff-context.md` |

## Claude Code

### CLI Detection

`src/main/agent/adapters/claude/detector.ts`

On first use, `ClaudeDetector` locates the Claude CLI:

1. If `config.agent.cliPaths.claude` is set, use that path directly
2. Otherwise, search `PATH` using the `which` package
3. Run `claude --version` (5s timeout) to capture the version string
4. Cache the result for the app lifetime (`invalidateCache()` resets)

Returns `{ found: boolean, path: string | null, version: string | null }`.

### Command Building

`src/main/agent/adapters/claude/command-builder.ts`

#### New Session

```
claude --settings <mergedSettingsPath> --session-id <uuid> -- "prompt text"
```

- `--session-id <uuid>` creates a new conversation with a known ID (enables resume later)
- `--` separates options from the prompt (prevents prompt content like `--flag` from being parsed as CLI options)
- Prompt has double quotes replaced with single quotes to avoid PowerShell quoting issues

#### Resumed Session

```
claude --settings <mergedSettingsPath> --resume <uuid>
```

- `--resume <uuid>` continues an existing conversation
- No prompt is injected - Claude resumes from its saved context

### Permission Modes

| Mode | CLI Flag |
|------|----------|
| `plan` | `--permission-mode plan` |
| `dontAsk` | `--permission-mode dontAsk` |
| `default` | `--settings <path>` (uses project-settings) |
| `acceptEdits` | `--permission-mode acceptEdits` |
| `auto` | `--permission-mode auto` |
| `bypassPermissions` | `--dangerously-skip-permissions` |

#### Permission Mode Resolution (Priority Order)

1. Swimlane's `permission_mode` (if set)
2. Global `config.agent.permissionMode`

### Non-Interactive Mode

When `nonInteractive` is set, `--print` is added. The agent runs, prints output, and exits without waiting for user input.

### Settings Merge

For every session, a merged settings file is built at `.kangentic/sessions/<claudeSessionId>/settings.json` and passed via `--settings`:

1. Read `.claude/settings.json` from project root (committed, shared)
2. Deep-merge `.claude/settings.local.json` from project root (gitignored, personal)
   - Hooks: concatenated per event type (local hooks appended after project hooks)
   - Permissions: deduplicated union of allow/deny arrays
3. For worktrees: merge permissions from the worktree's `.claude/settings.local.json`
   - Only permissions are merged (captures "always allow" grants from user)
   - Hooks from the worktree are skipped (may be stale leftovers)
4. Inject `statusLine` config pointing to the status bridge script
5. Inject event-bridge hooks into all registered hook points
6. Write merged file to session directory
7. Pass `--settings <mergedSettingsPath>` to the CLI

All Kangentic artifacts stay in `.kangentic/` - nothing is written to `.claude/settings.local.json`.

### Hook Injection

Kangentic subscribes to 17 Claude Code hook points via the event bridge:

| Hook Event | Event Type | Purpose |
|------------|-----------|---------|
| `PreToolUse` (blank) | `tool_start` | Agent began using a tool |
| `PostToolUse` (blank) | `tool_end` | Tool execution completed |
| `PostToolUseFailure` (blank) | `tool_failure` | Tool execution failed |
| `UserPromptSubmit` | `prompt` | User submitted a prompt |
| `Stop` | `idle` | Agent stopped naturally |
| `PermissionRequest` | `idle` | Agent hit a permission wall |
| `SessionStart` | `session_start` | Session began |
| `SessionEnd` | `session_end` | Session ended |
| `SubagentStart` | `subagent_start` | Main agent launched a subagent |
| `SubagentStop` | `subagent_stop` | Subagent finished |
| `Notification` | `notification` | Informational notification |
| `PreCompact` | `compact` | Context compaction starting |
| `TeammateIdle` | `teammate_idle` | Teammate agent went idle |
| `TaskCompleted` | `task_completed` | Task marked complete |
| `ConfigChange` | `config_change` | Configuration changed |
| `WorktreeCreate` | `worktree_create` | Worktree created |
| `WorktreeRemove` | `worktree_remove` | Worktree removed |

All hooks use blank matchers (fire for every invocation regardless of tool name). See [Activity Detection](activity-detection.md) for the full event-to-state mapping and state derivation logic.

#### Hook Identification

Kangentic hooks are identified by two markers in the command string:
- Contains `.kangentic` (path component)
- Contains a known bridge name (`activity-bridge` or `event-bridge`)

Both must match. This two-marker pattern prevents false positives on user-defined hooks with similar names. The `activity-bridge` check is for backwards compatibility with older session directories - the current bridge script is `event-bridge`.

#### Hook Cleanup

`stripKangenticHooks()` in `hook-manager.ts` removes all Kangentic hooks from `.claude/settings.local.json` on project close or delete. This is a backward-compatibility function - the unified `--settings` approach means Kangentic no longer writes hooks to `settings.local.json`, but older worktrees may still have them.

Safety guarantees:
- Backs up the original file before modification
- Validates JSON integrity before writing
- Restores from backup on any error
- Deletes empty settings files and `.claude/` directories

### Trust Management

`src/main/agent/adapters/claude/trust-manager.ts`

When spawning an agent in a worktree (CWD differs from project root), `ensureWorktreeTrust()` pre-populates `~/.claude.json` so Claude Code doesn't prompt for trust:

1. Read `~/.claude.json` (or start from empty object if missing/malformed)
2. Find the parent project's trust entry in `projects`
3. Create a new entry for the worktree path with `hasTrustDialogAccepted: true`
4. Copy `enabledMcpjsonServers` from the parent entry (MCP server inheritance)
5. Write back to `~/.claude.json`

Idempotent - skips write if the worktree is already trusted.

## Codex CLI

### CLI Detection

`src/main/agent/adapters/codex/detector.ts`

Detection follows the same pattern as Claude: check `config.agent.cliPaths.codex`, fall back to `PATH` search via `which`, run `codex --version`.

### Command Building

`src/main/agent/adapters/codex/command-builder.ts`

#### New Session

```
codex -C <cwd> --sandbox <level> --ask-for-approval <level> "prompt text"
```

#### Resumed Session

```
codex resume <sessionId> -C <cwd>
```

Resume is a subcommand in Codex (not a flag like Claude).

### Permission Modes

| Mode | Flags | Codex Preset |
|------|-------|--------------|
| `plan` | `--sandbox read-only --ask-for-approval on-request` | Safe Read-Only Browsing |
| `dontAsk` | `--sandbox read-only --ask-for-approval never` | Read-Only Non-Interactive (CI) |
| `default` | `--sandbox workspace-write --ask-for-approval untrusted` | Automatically Edit, Ask for Untrusted |
| `acceptEdits` / `auto` | `--full-auto` | Auto (Preset) |
| `bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` | Dangerous Full Access |

### Hook Integration

Codex hooks are written to `config.toml` in the project root via `writeCodexHooks()`. Unlike Claude's per-session `--settings` approach, Codex reads hooks from the project directory directly.

### Limitations

- No real-time token usage or cost data (no statusLine equivalent)
- No merged settings file mechanism
- No trust/directory-approval system

## Gemini CLI

### CLI Detection

`src/main/agent/adapters/gemini/detector.ts`

Detection follows the same pattern: check `config.agent.cliPaths.gemini`, fall back to `PATH` via `which`, run `gemini --version`.

### Command Building

`src/main/agent/adapters/gemini/command-builder.ts`

#### New Session

```
gemini --approval-mode <mode> "prompt text"
```

Gemini creates sessions implicitly (no `--session-id` equivalent).

#### Resumed Session

```
gemini --resume <sessionId>
```

### Permission Modes

| Mode | Flag | Gemini Mode |
|------|------|-------------|
| `plan` / `dontAsk` | `--approval-mode plan` | Plan (Read-Only Research) |
| `default` | (no flag) | Default (Confirm Actions) |
| `acceptEdits` / `auto` | `--approval-mode auto_edit` | Auto Edit (Auto-Approve Edits) |
| `bypassPermissions` | `--approval-mode yolo` | YOLO (Auto-Approve All) |

### Settings Merge

Gemini reads settings from `.gemini/settings.json` in the project directory. Unlike Claude's `--settings` flag, Gemini has no way to point to a per-session settings file. Kangentic writes merged settings (with event-bridge hooks) directly to `.gemini/settings.json` in the CWD.

Known limitation: concurrent Gemini sessions in the same project race on this file, and a crash may leave hooks in the user's settings. `stripHooks()` cleans up on normal shutdown.

## Aider

### CLI Detection

Detection is inlined in the adapter (no separate detector class): check `config.agent.cliPaths.aider`, fall back to `PATH` via `which`, run `aider --version`. The version output (`aider 86.2`) is parsed to strip the product name prefix.

### Command Building

`src/main/agent/adapters/aider/aider-adapter.ts`

```
aider --message "prompt text" --chat-mode <mode> --no-auto-commits
```

- `--message` delivers the prompt (shell-safe quoting applied)
- `--no-auto-commits` prevents Aider from auto-committing (Kangentic manages git)

### Permission Modes

| Mode | Flags | Aider Mode |
|------|-------|------------|
| `plan` / `dontAsk` | `--chat-mode ask` | Ask (Read-Only Questions) |
| `default` | (no flags) | Code (Confirm Changes) |
| `acceptEdits` / `auto` | `--architect` | Architect (Two-Model Design) |
| `bypassPermissions` | `--yes` | Auto Yes (Skip Confirmations) |

### Limitations

- No session resume (no `--resume` equivalent)
- No structured status or event output
- No hooks, settings merge, or trust mechanism
- No TUI alternate screen - uses streaming text output

## Prompt Templates

Actions of type `spawn_agent` can define a `promptTemplate` with placeholders:

| Variable | Value |
|----------|-------|
| `{{title}}` | Task title (PTY-sanitized) |
| `{{description}}` | Task description with `: ` prefix when non-empty, empty string otherwise |
| `{{taskId}}` | Task UUID |
| `{{worktreePath}}` | Worktree directory path (empty if no worktree) |
| `{{branchName}}` | Git branch name (empty if no worktree) |
| `{{prUrl}}` | Pull request URL (empty if none) |
| `{{prNumber}}` | Pull request number as string (empty if none) |
| `{{attachments}}` | Bare file paths (one per line) when attachments exist, empty otherwise |

Default template: `{{title}}{{description}}{{attachments}}`

This produces prompts like:
- `Fix auth bug: Users can't login after password reset` followed by `/path/to/screenshot.png` on the next line
- `Add dark mode` (no description, no attachments)

Shortcut commands use a separate set of template variables. See [Configuration](configuration.md#shortcuts) for the full list.

## Bridge Scripts

Two standalone Node.js scripts in `src/main/agent/`:

### `status-bridge.js`

- **Hook point:** `statusLine` (not a hook - uses Claude Code's status line feature)
- **Output:** `status.json` (overwritten on each invocation)
- **Data:** Token usage, cost, model, context window percentage
- **Watched by:** SessionManager with 100ms debounce
- **Supported by:** Claude Code, Gemini CLI (via status parser)

### `event-bridge.js`

- **Hook point:** All registered hooks
- **Output:** `events.jsonl` (append-only, one JSON line per event)
- **Data:** Timestamps, event types, tool names, file paths
- **Watched by:** SessionManager with 50ms debounce, incremental byte-offset reads
- **Supported by:** Claude Code (17 hook points), Codex CLI (via config.toml hooks), Gemini CLI (via .gemini/settings.json hooks)

Both scripts are stateless (no persistent process), read JSON from stdin, write to their output file, and exit. All writes are try/catch wrapped for non-fatal failures.

## CWD Strategy

All agent CLIs are invoked with `cwd` set to:
- **Worktree path** if the task has a worktree
- **Project directory** otherwise

This ensures agents load project-level configuration (`.claude/`, `.gemini/`, `CLAUDE.md`, etc.) from the correct location.

## See Also

- [Handoff](handoff.md) - Cross-agent context transfer: extraction, packaging, delivery
- [Activity Detection](activity-detection.md) - Event processing, state derivation, subagent-aware transitions
- [Session Lifecycle](session-lifecycle.md) - Spawn flow, resume, crash recovery
- [Worktree Strategy](worktree-strategy.md) - Worktree creation, sparse-checkout, hook delivery
- [Configuration](configuration.md) - Permission modes
