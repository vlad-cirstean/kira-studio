# v0.2.14

Branch `chapter/v0.2.14`. First `P` is 340 (highest in HISTORY is P339).

| Phase | Title | Status |
|---|---|---|
| P340 | Docker restore-containers dialog redesign; Redis + S3 folder nav fix | Todo |
| P341 | Remove "keychain access for sandboxed agents" option and alternative token-injection paths | Todo |
| P342 | Git graph keeps state and does not reload from scratch after opening a diff | Todo |

## P340

Two small fixes, one phase.

1. Docker "restore running containers" UI: dropdown is small; text and button overlap. Redesign with shadcn-vue + Tailwind.
2. Redis and S3 browsers: double-click a value in the "folder" navigation makes the navigation disappear. It must stay.

Result: _pending_

## P341

Remove the "keychain access for sandboxed agents" option. Harness needs keychain access to work, so the option has no purpose. Remove the alternative token-injection mechanisms too. Planner enumerates every setting, UI, backend path and doc touching it.

Result: _pending_

## P342

Git graph reloads entirely from scratch after opening a diff (or similar tab switch). Visually distracting; loses graph state (scroll, selection, expansion). Keep state across tab switches and refresh in place. Planner root-causes: tab unmount/remount, store reset, or refetch.

Result: _pending_
