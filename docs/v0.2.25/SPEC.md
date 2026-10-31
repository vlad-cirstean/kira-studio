# v0.2.25

Branch `chapter/v0.2.25`. First `P` is 436 (highest in v0.2.24 is P435). Draft: opens after v0.2.24 merges.

Source: user request. Phases run top to bottom, two phases in parallel where file ownership allows (worktree per stream). Ends with two code review rounds, then close, then PR.

| Phase | Title | Status |
|---|---|---|
| P436 | ADE session tab context menu: close and restart a Claude session | Todo |
| P437 | ADE sessions dropdown redesign | Todo |
| P438 | Rename Automations to Runs; icon-only module tabs | Todo |
| P439 | Kubernetes module (read only) | Todo |
| P440 | Code review (2 rounds) | Todo |
| P441 | Close chapter v0.2.25 | Todo |

## Rows

### P436 ADE session tab context menu: close and restart a Claude session

- Right click on a session tab in the ADE module offers Close session and Restart session, next to the existing Copy session id.

### P437 ADE sessions dropdown redesign

- The sessions dropdown looks ugly and works clunkily. Redesign both looks and interactions.

### P438 Rename Automations to Runs; icon-only module tabs

- Module tabs (the mode strip, both apps) show icons only, no labels, to leave room for more modules. Each icon keeps an accessible name and a tooltip with the module name (and shortcut if any); active and attention states stay visible.

- The Automations module is renamed Runs everywhere the user sees it: mode label, tab, panel, dialogs, menus, palette commands, Settings, tooltips, docs.
- Internal identifiers (mode key `automations`, `<app home>/automations/<id>` folders, DB columns, i18n namespace) stay unless the plan finds a safe, worthwhile rename; the plan decides and justifies each.
- Check wording collisions with the existing "run" concept (step runs, script runs, Operations panel history) and resolve them in the copy.

### P439 Kubernetes module (read only)

- New read-only Kubernetes module. Host app: Kira Studio next to Docker (the plan confirms or changes this).
- Pick a namespace, pick a resource kind, list resources, view describe and logs.
- Every list, describe and logs view supports filtering.
- UI design consistent with the app, taking its cues from the Studio (database) module.
- Read only: no create, edit, delete, exec or port-forward.

### P440 Code review (2 rounds)

Two rounds. Each round: one Opus review over the full diff since `main`, findings file under `plans/`, then one Sonnet fixer.

### P441 Close chapter v0.2.25

Hand-written close per CLAUDE.md "Closing a chapter". Push, open PR to `main`.
