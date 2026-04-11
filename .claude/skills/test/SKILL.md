---
description: Run tests, audit coverage, or write missing tests
allowed-tools: Read, Glob, Grep, Task, Bash(npm:*), Bash(npx:*), Bash(git:*)
argument-hint: [all|audit|write|unit|ui|e2e]
---

# Test - Unified Smart Test Runner

Thin driver for test execution and coverage audit. **The skill runs tests
directly but delegates all test-writing and coverage analysis to the
`test-builder` agent** (`.claude/agents/test-builder.md`). The agent is the
single source of truth for tier classification, anti-flake patterns, the
10-second E2E rule, and canonical helpers - this skill does not re-implement
any of that knowledge inline.

**Usage:** `/test [mode]`

| Argument | Mode | Description |
|----------|------|-------------|
| *(none)* | **Smart Run** | Detect branch, select relevant tiers, typecheck, build (if needed), run tests, then delegate coverage-gap analysis to `test-builder` |
| `all` | **Full Run** | Run all 3 tiers unconditionally |
| `audit` | **Coverage Audit** | Delegate to `test-builder` agent in audit-only mode - no test execution |
| `write` | **Write Tests** | Delegate to `test-builder` agent to audit and implement missing tests |
| `unit` | **Unit Only** | Run unit tests only |
| `ui` | **UI Only** | Run UI tests only |
| `e2e` | **E2E Only** | Build + run E2E tests only |

**Selected mode:** $ARGUMENTS

---

## Mode: Smart Run (`/test`)

### Step 1 - Detect branch and changed files

All git commands below run from the **current working directory** (no `cd` needed). If the CWD is already a worktree, git will operate on it automatically.

1. Run `git rev-parse --abbrev-ref HEAD` to get the current branch.
2. If the branch is `main`, treat this as a **Full Run** - run ALL tiers and skip to Step 2 with tiers = `[unit, ui, e2e]`.
3. Otherwise, determine the base branch:
   - Run `git config kangentic.baseBranch` to get the stored base branch.
   - If not set, default to `main`.
4. Collect changed files (union of all three):
   - `git diff --name-only <base>...HEAD` (committed changes on branch)
   - `git diff --name-only` (unstaged changes)
   - `git diff --name-only --staged` (staged changes)

### Step 2 - Map changed files to tiers (for TEST RUNNING, not test placement)

This table decides **which tiers to execute** based on the files that changed. It is *not* the same as the `test-builder` agent's tier decision tree (which decides where NEW tests should live). Two different questions, two different tables.

Collect the **union** of all matched tiers:

| Changed file pattern | Tiers to run |
|---|---|
| `tests/unit/**` | unit |
| `tests/ui/**` | ui |
| `tests/e2e/**` | e2e |
| `src/main/**` | e2e |
| `src/preload/**` | e2e |
| `src/renderer/components/terminal/**`, `src/renderer/hooks/useTerminal*.ts`, `src/renderer/stores/session-store.ts` | ui + e2e |
| `src/renderer/**` (other) | ui |
| `src/shared/**` | Grep for imports of the changed file in `src/main/` (→ e2e), `src/renderer/` (→ ui), and test dirs (→ matching tier). Include all tiers that import it. |
| `package.json`, `tsconfig*.json`, `vite.*.ts`, `playwright.config.ts`, `vitest.config.ts`, `electron-builder.yml`, `scripts/**` | unit + ui + e2e |
| `.claude/**`, `*.md`, `.gitignore` | none (docs only - skip testing) |

If **no tiers** are selected (docs-only change), report "No testable changes detected" and stop.

### Step 3 - Plan summary

Before running anything, output a short summary so the user knows what will happen:

```
### Test Plan

Branch: `<branch>` | Base: `<base>` | Changed: N files
Selected tiers: Unit, UI, E2E (or whichever subset)

| Tier | Why |
|------|-----|
| Unit | tests/unit/foo.test.ts changed |
| UI   | src/renderer/components/Bar.tsx changed |
| E2E  | src/main/engine/baz.ts changed |
```

Keep the "Why" column to one short reason per tier (the most significant changed file or pattern that triggered it). Then proceed immediately - no need to wait for confirmation.

### Step 4 - Execute

1. **Typecheck first** - run `npm run typecheck`. If it fails, report type errors and **stop**. Do not proceed to build or tests.
2. Launch tiers in parallel, respecting dependencies:
   - **Unit tests** (`npm run test:unit`) - start immediately (no build needed).
   - **UI tests** (`npx playwright test --project=ui`) - start immediately (no build needed).
   - **Build** (`npm run build`) - start immediately, but **only if E2E is in the selected tiers**.
   - **E2E tests** (`npx playwright test --project=electron`) - wait for build to complete, then start.
3. If only unit and/or UI are selected, skip the build entirely.

### Step 5 - Coverage gap analysis (delegate to agent)

After all tests complete and results are reported, **launch the `test-builder` agent** to analyze changed files for coverage gaps. Do not attempt to classify or recommend tests independently - that is the agent's job.

Launch the agent with:

- `subagent_type: "test-builder"`
- `description: "Audit coverage gaps for current changes"`
- `prompt`: include (a) the list of changed files from Step 1, (b) the current test results summary (pass/fail counts per tier), and (c) an explicit instruction: **"Audit-only mode. Do NOT write any tests. Return the standard Coverage Gaps report."**

Relay the agent's Coverage Gaps report verbatim to the user. If there are gaps, end the response with:

> Run `/test write` to spawn the `test-builder` agent and implement these.

If the agent reports no gaps, output: `No coverage gaps - all changes are tested or trivial.`

---

## Mode: Full Run (`/test all`)

Same as Smart Run Step 3-4, but with all three tiers selected unconditionally. Always typecheck → build → run all three tiers. Then run the Step 5 coverage-gap delegation.

---

## Mode: Unit Only (`/test unit`)

1. Run `npm run typecheck`. Stop on failure.
2. Run `npm run test:unit`.

## Mode: UI Only (`/test ui`)

1. Run `npm run typecheck`. Stop on failure.
2. Run `npx playwright test --project=ui`.

## Mode: E2E Only (`/test e2e`)

1. Run `npm run typecheck`. Stop on failure.
2. Run `npm run build`.
3. Run `npx playwright test --project=electron`.

---

## Mode: Coverage Audit (`/test audit`)

**Launch the `test-builder` agent in audit-only mode.** Do not run any tests, and do not attempt any classification or recommendation yourself.

1. Gather context locally:
   - `git diff --staged`
   - `git diff`
   - `git status`
2. Launch the agent with:
   - `subagent_type: "test-builder"`
   - `description: "Coverage audit for current changes"`
   - `prompt`: include the full git diff output and an explicit instruction: **"Audit-only mode. Read each changed file, apply your tier decision tree, and return the standard Coverage Gaps report. Do NOT write, modify, or validate any tests."**
3. Relay the agent's report verbatim.

---

## Mode: Write Tests (`/test write`)

**Launch the `test-builder` agent to audit AND implement the missing tests.** This skill does not write tests inline.

1. Gather context locally:
   - `git diff --staged`
   - `git diff`
   - `git status`
2. Launch the agent with:
   - `subagent_type: "test-builder"`
   - `description: "Write missing tests for current changes"`
   - `prompt`: include the full git diff output, any extra arguments the user passed to `/test write`, and an explicit instruction: **"Write mode. Audit coverage, then implement the missing tests following your tier rules, anti-flake patterns, and the 10-second E2E gate. Validate with multi-run stability checks. Report back with: tier chosen per file, files modified, helpers reused vs added, stability run count, and any anti-patterns you noticed in neighboring tests."**
3. When the agent returns, relay its summary. If any gaps remain (e.g. the agent could not write a test due to missing mock support or ambiguous requirements), flag them clearly so the user can resolve and retry.

---

## Reporting Format (for test RUN modes only)

After test execution, present results in this format. **Never use emojis** - they render as broken boxes in the terminal. Use plain text only.

```
## Test Results

Branch: `<branch-name>` | Base: `<base-branch>` | Changed: N files
Selected: Unit, UI (skipped E2E - no main process changes)

| Tier | Status  | Passed | Failed | Duration |
|------|---------|--------|--------|----------|
| Unit | PASS    | 92     | 0      | 3.9s     |
| UI   | PASS    | 72     | 0      | 20.1s    |
| E2E  | skipped | -      | -      | -        |

All green. No regressions.
```

**Rules for the table:**
- Only include tiers that were selected or explicitly skipped. Use `PASS`, `FAIL`, or `skipped` in the Status column - never emojis.
- Skipped tiers show `-` for numeric columns.
- Omit the Skipped count column (Playwright skips are rare and noisy).
- If all tiers pass, end with: `All green. No regressions.`

**On failures, add after the table:**

```
### Failures

1. `tests/ui/app.spec.ts:42` - "can create a task in Backlog"
   Error: expected 'visible' but got 'hidden'
   Likely cause: TaskCard render change in src/renderer/components/TaskCard.tsx

### Recommendations
- Investigate <file> - <what the error indicates>
```

---

## Rules

- **Test implementation is delegated to the `test-builder` agent.** This skill runs tests and presents results. It does not write tests inline. The only exception is trivial, single-line additions to *existing* passing tests (e.g. an extra `expect` assertion in a stable spec). Any new file, new describe block, or >3-line change MUST go through the agent so the tier rules, anti-flake patterns, and 10-second gate are applied consistently.
- **Coverage gap analysis is delegated to the `test-builder` agent.** In Smart Run Step 5 and in `/test audit` mode, the skill's job is to gather git diff context and pass it to the agent. The skill does not duplicate the agent's tier decision tree.
- **No chained commands.** Do not use `&&`, `||`, `|`, `;`, or stderr redirection. Each command runs in its own Bash tool call.
- **No `cd && git`.** Never use `cd <path> && git ...` - this triggers an unbypasable Claude Code security prompt. All git commands run from the current working directory (which is already the correct repo/worktree). If you must target a different directory, use `git -C <path>`.
- **Parallel execution.** Launch independent tiers concurrently using parallel tool calls or background tasks. Unit and UI tests never depend on the build step.
- **Build only when needed.** Only run `npm run build` when E2E tests are selected.
- **Typecheck is a gate.** Always typecheck first. If it fails, stop immediately.
- **Use dedicated tools.** Use `Read`, `Glob`, `Grep` for file operations. Reserve `Bash` for `npm`, `npx`, and `git` commands only.

## Allowed Tools

- `Read`, `Glob`, `Grep` - for file exploration (Smart Run's changed-file detection)
- `Bash` - for `npm`, `npx`, and `git` commands only
- `Task` - for delegating to the `test-builder` agent in audit/write/Smart Run Step 5 modes
