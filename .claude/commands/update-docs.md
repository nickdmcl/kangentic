---
description: Review and update documentation to match current source code
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(git:*), Agent
---

# Update Docs

Review and update `docs/` to match the current source code. Uses the source-to-doc mapping and anchor points from `.claude/skills/docs-maintenance/SKILL.md`.

## Step 1 -- Scope Detection

Determine what source files changed:

1. Check if on a branch with unpushed commits:
   - Run `git log origin/HEAD..HEAD --name-only --pretty=format:""` to get changed files
   - If that produces results, use those files as the scope
2. If no unpushed commits (e.g., on main after pushing), diff against the latest release tag:
   - Run `git describe --tags --abbrev=0` to find the latest release tag
   - Run `git diff --name-only <tag>..HEAD` to get all files changed since that release
3. Filter to source files only (exclude `docs/`, `.claude/`, `tests/`)
4. Map changed source files to affected docs using the source-to-doc mapping in the skill
5. If no source files changed (docs-only or config-only commit), report "No source changes detected -- skipping doc review" and stop

## Step 2 -- Anchor Point Verification

Check if any changed source files are anchor sources (see SKILL.md Anchor Points tables):
- `src/shared/types.ts`
- `src/shared/ipc-channels.ts`
- `src/main/db/migrations.ts`
- `src/renderer/components/settings/AppSettingsPanel.tsx`
- `src/renderer/components/settings/settings-registry.ts`
- `src/shared/template-vars.ts`

If any anchor source files appear in the changed-file list:

1. Spawn a `doc-auditor` agent with the list of changed anchor source files
2. The agent returns a structured gap report listing missing and extra items per anchor
3. Save the gap report for use in Step 4

If no anchor source files changed, skip this step.

## Step 3 -- Prose Audit

For each affected doc (from Step 1 mapping):

1. Read the doc file
2. Read the source files it references (from the mapping)
3. Check for prose staleness -- details that are no longer accurate:
   - Changed behavior or algorithm descriptions
   - Stale default value explanations
   - Feature interaction descriptions that no longer hold
   - Renamed parameters or function signatures
   - New or removed CLI flags
   - Changed function signatures or behavior

This step focuses on prose accuracy only. Enumerable completeness is handled by the anchor audit in Step 2.

## Step 4 -- Update Pass

For each doc with stale content (from Steps 2 and 3):

1. Fix all anchor gaps reported by the doc-auditor:
   - Add missing items to tables/lists
   - Remove extra items no longer in source
   - Update counts in section headers if applicable
2. Fix prose staleness found in Step 3:
   - Update stale facts (numbers, type names, default values, descriptions)
   - Add sections for significant new features not yet documented
   - Remove sections for removed features
3. Update cross-references if docs were added/removed
4. Update `docs/README.md` index if docs were added/removed

**Constraints:**
- Only edit files in `docs/` and `README.md` (Documentation section only)
- Never modify source code, tests, or config files
- Respect the single-command Bash rule

## Step 5 -- Feature Summary

Scan for undocumented features and determine where to document them:

1. Find the latest release tag: `git describe --tags --abbrev=0`
2. List `feat:` and `feat!:` commits since that tag: `git log <tag>..HEAD --oneline --grep="^feat"` (use `--grep` flag, not a pipe)
3. For each feature commit:
   - Extract the feature description from the commit message
   - Check if it appears in `docs/user-guide.md` or `docs/overview.md`
4. For each undocumented feature, determine placement:
   - Read the source files touched by the commit to understand the feature scope
   - Use the source-to-doc mapping in SKILL.md to identify the target doc
   - Identify the specific section within the target doc where the feature belongs (e.g., "user-guide.md > Task Detail Dialog")
   - Only create a new doc when the feature introduces a new subsystem or integration point (per "When to Create a New Doc" in SKILL.md). Otherwise append to the existing doc.
5. For each undocumented feature, write the documentation into the target doc in the identified section. Use the Edit tool to add content inline, matching the existing style and level of detail.
6. Report what was written in the Step 7 report (feature, target doc, section, what was added).

## Step 6 -- Structural Review

Check overall doc health:

1. Verify all internal links between docs resolve (no broken `[text](file.md)` links)
2. Check that `docs/README.md` lists all docs in `docs/`
3. Check that the `README.md` Documentation section is current
4. Flag any doc over 500 lines that could benefit from splitting

## Step 7 -- Report

Summarize what was done:

- Anchor audit results (if run): anchors checked, gaps found, gaps fixed
- Prose updates: list of docs updated with brief change descriptions
- Docs created or deleted (if any)
- Feature documentation: list of features documented, where they were placed, and what was written
- Items that need human review (ambiguous changes, major restructuring)
- "No changes needed" if everything is current
