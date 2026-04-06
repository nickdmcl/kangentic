# Cross-Agent Handoff

When a task moves to a column with a different agent (e.g. Claude Code to Codex), Kangentic packages the source agent's work context and delivers it to the target agent. This enables seamless continuation across different AI coding tools without losing progress.

## Overview

The handoff system lives in `src/main/agent/handoff/` and consists of four components:

| Component | File | Purpose |
|-----------|------|---------|
| Context Packet | `context-packet.ts` | Schema definition for the portable context bundle |
| Context Extractor | `context-extractor.ts` | Reads git, transcript, events, and metrics into a packet |
| XML Renderer | `markdown-renderer.ts` | Converts a packet into XML-structured context document |
| Prompt Builder | `prompt-builder.ts` | Builds the prompt prefix pointing the target agent to context |
| Orchestrator | `handoff-orchestrator.ts` | Top-level coordinator that ties the pipeline together |

## When Handoff Triggers

Handoff is triggered by `resolveTargetAgent()` in `src/main/engine/agent-resolver.ts` when all three conditions are met:

1. The task has a previous agent (`task.agent` is set)
2. The resolved target agent differs from `task.agent`
3. A previous session exists for the task

If `task.agent` is null (fresh task, never spawned), no handoff occurs even if the target column has an agent override.

## Handoff Flow

```
Task moves to column with different agent_override
    |
    v
resolveTargetAgent() detects isHandoff=true
    |
    v
spawnAgent() enters handoff path (agent-spawn.ts)
    |
    v
TranscriptWriter.finalize() flushes PTY output to DB
    |
    v
HandoffOrchestrator.prepareHandoff()
    |--- extractContext() reads git diff, transcript, events, metrics
    |--- Stores handoff record in DB (handoffs table)
    |--- renderHandoffMarkdown() builds the context document
    |--- buildHandoffPromptPrefix() creates a brief pointer prompt
    |
    v
engine.resumeSuspendedSession() spawns target agent with:
    - handoffPromptPrefix prepended to the task prompt
    - agentOverride set to target agent (forces fresh spawn, no resume)
    |
    v
Post-spawn: handoff-context.md written to session directory
    - .kangentic/sessions/<agentSessionId>/handoff-context.md
    - Handoff DB record updated with target session ID
```

## Context Packet

The `ContextPacket` interface defines the portable, agent-agnostic bundle transferred between agents:

```typescript
interface ContextPacket {
  version: 1;              // Schema version for forward compatibility
  id: string;              // Unique packet ID
  createdAt: string;       // ISO timestamp

  source: {
    agent: string;         // 'claude', 'codex', 'gemini', 'aider'
    agentSessionId: string | null;
    modelId: string | null;
  };

  target: {
    agent: string;
  };

  task: {
    id: string;
    displayId: number;
    title: string;
    description: string;
    branchName: string | null;
    worktreePath: string | null;
    baseBranch: string | null;
    labels: string[];
  };

  gitSummary: {
    commitMessages: string[];
    filesChanged: CodeReference[];
    diffPatch: string | null;
  };

  transcript: string | null;   // ANSI-stripped PTY output
  events: SessionEvent[] | null;  // Structured events from events.jsonl
  metrics: HandoffMetrics | null; // Token usage, cost, duration
  continuation: ContinuationState | null; // Future: multi-step workflow state
}
```

## Context Extraction

`extractContext()` is entirely read-only and mechanical: no LLM calls, no network, no side effects. All data sources are optional - missing sources produce null fields, never errors.

### Git Summary

Extracted from the task's branch using `simple-git`:

1. Find the merge-base between the task's base branch and HEAD
2. Run in parallel:
   - `git diff --stat <merge-base>` for file change statistics
   - `git log <merge-base>..HEAD` for commit messages
   - `git diff <merge-base>` for the full patch content

### Transcript

Read from the `session_transcripts` table via `TranscriptRepository`. The transcript is ANSI-stripped PTY output written by `TranscriptWriter` during the session. Before extraction, `TranscriptWriter.finalize()` flushes any pending buffered data to the database.

### Events

Pulled from the in-memory `UsageTracker` cache (already loaded for the running session). Contains structured events from `events.jsonl`: tool calls, prompts, idle/thinking transitions.

### Metrics

Extracted from the `sessions` DB record:

| Metric | Source |
|--------|--------|
| `totalCostUsd` | Cumulative API cost |
| `totalInputTokens` | Total input tokens consumed |
| `totalOutputTokens` | Total output tokens generated |
| `durationMs` | Session wall-clock duration |
| `toolCallCount` | Number of tool invocations |
| `linesAdded` | Lines added (from git) |
| `linesRemoved` | Lines removed (from git) |
| `filesChanged` | Number of files changed |

## XML Rendering

`renderHandoffMarkdown()` converts a `ContextPacket` into an XML-structured document. XML tags are used because all major LLM providers (Anthropic, OpenAI, Google) recommend XML for structuring context documents fed to language models - tags provide unambiguous section boundaries that LLMs parse reliably.

```xml
<handoff version="1" source_agent="claude" target_agent="codex"
         task_id="abc-123" task_display_id="42"
         created_at="2026-04-04T10:30:00Z" branch="feature/auth-fix">

<task>
Fix auth bug
Users can't login after password reset
Branch: feature/auth-fix
</task>

<metrics agent="claude" model="claude-opus-4-6" duration="3m 45s"
         cost="$0.42" input_tokens="150000" output_tokens="12000"
         tool_calls="23" />

<git_changes>
<commits>
- Fix password reset token validation
- Add integration test for reset flow
- Update error messages
</commits>
<files_changed>
| File | Status | +/- |
|------|--------|-----|
| src/auth/reset.ts | Modified | +45 -12 |
| tests/auth.test.ts | Added | +89 -0 |
</files_changed>
</git_changes>

<transcript>
(ANSI-stripped, agent-cleaned PTY output)
</transcript>

</handoff>
```

The function name `renderHandoffMarkdown` is retained for backward compatibility, though the output format is XML.

## Per-Agent Transcript Cleanup

TUI agents (Claude Code, Codex CLI, Gemini CLI) produce raw PTY output with agent-specific rendering artifacts: viewport redraws, spinner frames, box borders, tool narration, and garbled partial renders. A universal cleanup function kept breaking one agent when fixing another, so cleanup is dispatched per-agent.

`cleanTranscriptForHandoff(rawTranscript, sourceAgent)` in `src/main/agent/handoff/transcript-cleanup.ts` dispatches to agent-specific cleanup functions, then applies shared finalization (collapse blank lines, strip trailing duplicates, trim).

Each agent's cleanup lives in its adapter folder, following the project convention that agent-specific logic lives in `src/main/agent/adapters/<name>/`:

| Agent | File | Strategy |
|-------|------|----------|
| Claude Code | `adapters/claude/transcript-cleanup.ts` | Filters banner art, spinner frames, `(thinking)` status. Detects garbled lines (< 8% spaces in 30+ char lines from partial TUI redraws). Finds last clean `❯`/`●` conversation block with content dedup in scan-back. |
| Codex CLI | `adapters/codex/transcript-cleanup.ts` | Extracts content from `│...│` box borders. Filters spinner fragments, tool narration (`• I'll...`, `• Running...`), and tool output (git status, JSON, XML). Removes auto-prompts (prompt text appearing 3+ times = TUI redraws). Deduplicates response blocks within prompt sections (streamed vs compact render). |
| Gemini CLI | `adapters/gemini/transcript-cleanup.ts` | Strips inline `? for shortcuts` TUI chrome. Filters banner art, braille spinners, auth lines. Finds the LAST `✦` response block (most complete from incremental redraws) with nearest preceding `>` prompt. |
| Aider | (no cleanup) | Plain text output, no TUI - passes through with shared finalization only. |

Shared utilities in `src/main/agent/handoff/transcript-cleanup.ts`:
- `filterNoiseLines(lines, agentPatterns)` - removes lines matching agent-specific noise patterns plus shared patterns (separator bars, shell prompts, exit hints)
- `finalizeTranscript(text)` - collapses blank lines, strips trailing duplicate paragraphs, trims whitespace

## Prompt Delivery

The handoff prompt is built in two layers:

### 1. Generic Prompt Prefix

`buildHandoffPromptPrefix()` creates a brief, agent-agnostic pointer:

```
You are continuing work on this task that was previously handled by Claude Code.
Full context of prior work (transcript, git changes, metrics) is at:
.kangentic/sessions/<sessionId>/handoff-context.md
Read this file before continuing.

Prior work: 5 files changed, 3 commits.
```

### 2. Agent-Specific Transform

Each adapter's `transformHandoffPrompt()` adds agent-specific hints:

- **Claude Code:** Appends a hint to use the `kangentic_get_handoff_context` MCP tool for structured access
- **Codex, Gemini, Aider:** Append a file path reference to `handoff-context.md`

The `{{handoffContextPath}}` placeholder in the prompt is replaced with the real session directory path after spawn, when the agent session ID is known.

## Database Storage

Handoff records are stored in the `handoffs` table:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Unique handoff ID |
| `task_id` | TEXT FK | Task being handed off |
| `from_session_id` | TEXT FK | Source session (nullable) |
| `to_session_id` | TEXT FK | Target session (filled post-spawn) |
| `from_agent` | TEXT | Source agent name |
| `to_agent` | TEXT | Target agent name |
| `trigger` | TEXT | What caused the handoff (`column_transition`) |
| `packet_json` | TEXT | Serialized ContextPacket (transcript excluded) |
| `created_at` | TEXT | ISO timestamp |

The transcript is stored separately in the `session_transcripts` table (keyed by session ID) and joined at read time. This avoids duplicating large text blobs in the packet JSON.

## MCP Access

Claude Code sessions can access handoff context via the `kangentic_get_handoff_context` MCP tool, which returns the structured `ContextPacket` data. This provides programmatic access to metrics, file lists, and events without parsing the markdown file. See [MCP Server](mcp-server.md) for details.

## Timing Considerations

The `handoff-context.md` file is written after spawn but before the agent can read it. This works because:

1. CLI startup (detection, trust check, command building) takes 1-3 seconds
2. File write is synchronous (`fs.writeFileSync`) and completes in ~1ms
3. By the time the agent's TUI is ready, the file is already on disk

## Disabling Handoff Context

Each column has a `handoff_context` toggle (default: **off**). When disabled, cross-agent transitions still detect the agent change and spawn the correct target agent, but no context is packaged - no transcript extraction, no `handoff-context.md` file, no handoff DB record. The new agent receives only the task title and description, starting with a clean slate.

This is useful for workflows where independent review is desired. For example, a "Code Review" column with `agent_override` set to a different agent can disable handoff context so the reviewing agent assesses the code without being influenced by the previous agent's conversation or reasoning.

The toggle is a per-column setting in the Edit Column dialog, under the Agent section. It can also be set in `kangentic.json` via the `handoffContext` field on column configs.

## See Also

- [Agent Integration](agent-integration.md) - Adapter interface, per-agent CLI details
- [Session Lifecycle](session-lifecycle.md) - Spawn flow, suspend, resume
- [Database](database.md) - Schema for handoffs and session_transcripts tables
- [MCP Server](mcp-server.md) - `kangentic_get_handoff_context` tool
