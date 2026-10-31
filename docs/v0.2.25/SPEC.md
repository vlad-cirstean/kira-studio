# v0.2.25

Branch `chapter/v0.2.25`. First `P` is 436 (highest in v0.2.24 is P435). Draft: opens after v0.2.24 merges.

Source: user request. Phases run top to bottom, two phases in parallel where file ownership allows (worktree per stream). Ends with two code review rounds, then close, then PR.

| Phase | Title | Status |
|---|---|---|
| P436 | ADE session tab context menu: close and restart a Claude session | Todo |
| P437 | ADE sessions dropdown redesign | Todo |
| P438 | Code review (2 rounds) | Todo |
| P439 | Close chapter v0.2.25 | Todo |

## Rows

### P436 ADE session tab context menu: close and restart a Claude session

- Right click on a session tab in the ADE module offers Close session and Restart session, next to the existing Copy session id.

### P437 ADE sessions dropdown redesign

- The sessions dropdown looks ugly and works clunkily. Redesign both looks and interactions.

### P438 Code review (2 rounds)

Two rounds. Each round: one Opus review over the full diff since `main`, findings file under `plans/`, then one Sonnet fixer.

### P439 Close chapter v0.2.25

Hand-written close per CLAUDE.md "Closing a chapter". Push, open PR to `main`.
