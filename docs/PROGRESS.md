# Progress log

The handoff between working windows. Start every window by reading
CLAUDE.md and this file; end every task by updating this file.

Kickoff message for a new window:
> Let's move forward. Read CLAUDE.md and docs/PROGRESS.md, then do the next task.

## Status

| # | Task | Status |
|---|---|---|
| 0 | Handoff system | done |
| 1 | Pack builder | next |

## Task log

### Task 0 — Handoff system
- Branch `offline-and-ui` created from `main`.
- CLAUDE.md added (rules block from the handoff doc, plus a "where things are" section).
- Design file moved to docs/design/curious-dictionary-desktop.dc.html; handoff doc moved to docs/.
- .gitignore: added data/, dist-pack/, *.db.
- electron-builder.yml: excluded data/, dist-pack/, tools/, docs/ so raw data and packs never end up inside the installer.
