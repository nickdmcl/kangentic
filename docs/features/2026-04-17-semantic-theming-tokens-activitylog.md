---
status: executing
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
