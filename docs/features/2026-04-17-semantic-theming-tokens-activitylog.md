---
status: shipped
task: "#37"
date: 2026-04-17
---

# Semantic Theming Tokens for AI-Activity Rails in ActivityLog

## What

Replace hardcoded Tailwind color utilities in `ActivityLog.tsx` (`bg-sky-500/15`, `bg-violet-500/[0.08]`, `shadow-[0_2px_8px_rgba(0,0,0,0.15)]`, etc.) with semantic `--kng-*` / `--color-*` tokens, overridden per theme. Adds 14 new tokens (user-turn rail/bg/label, ai-activity rail/bg/badge, ai-ready rail/bg/badge, warn badge, sticky shadow) to all 10 theme blocks in `index.css`.

## Why

The hardcoded colors bypass Kangentic's semantic token system and cause confirmed contrast degradation:
- `.theme-sky`: user-turn block disappears (sky-500 on sky-tinted surface)
- `.theme-sand`, `.theme-mint`, `.theme-peach`, `.theme-light`: AI-activity grouping invisible (8% alpha violet on pale surfaces)
- Sticky-header shadow is a static compromise that's too subtle on dark themes and too harsh on some light themes

Semantic tokens let each theme tune these values for its surface, ensuring visible contrast everywhere.

## Key Decisions

- **14 tokens, not 3:** Each lane (user-turn, ai-activity, ai-ready) needs rail, background, and badge/label sub-tokens — plus warn badge and sticky shadow. This granularity lets themes tune contrast independently.
- **Per-theme tuning over formula:** Light themes get darker shades (sky-600, violet-600) and softer shadows (`rgba(0,0,0,0.12)`), dark themes get brighter variants (sky-400, violet-400) with stronger shadows. `.theme-sky` swaps user-turn to indigo-600 to avoid surface clash.
- **Tailwind `@theme inline` mapping:** New tokens mapped through `--color-*` intermediaries in the `@theme inline` block so they work as native Tailwind utilities (e.g., `bg-user-turn-bg`, `border-ai-activity-rail`).

## Files Changed

- `src/renderer/index.css` — 14 new `--kng-*` tokens across all 10 theme blocks + `@theme inline` mapping
- `src/renderer/components/terminal/ActivityLog.tsx` — replaced all hardcoded sky/violet/emerald/shadow classes with semantic token utilities

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint src/` — clean
- Playwright UI suite (`tests/ui/activity-log.spec.ts`): 16/16 passed
