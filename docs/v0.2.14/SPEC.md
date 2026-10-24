# v0.2.14

Branch `chapter/v0.2.14`. First `P` is 340 (highest in HISTORY is P339).

| Phase | Title | Status |
|---|---|---|
| P340 | Docker restore-containers dialog redesign; Redis + S3 folder nav fix | Done |
| P341 | Remove "keychain access for sandboxed agents" option and alternative token-injection paths | Done |
| P342 | Git graph keeps state and does not reload from scratch after opening a diff | Done |

## P340

Two small fixes, one phase.

1. Docker "restore running containers" UI: dropdown is small; text and button overlap. Redesign with shadcn-vue + Tailwind.
2. Redis and S3 browsers: double-click a value in the "folder" navigation makes the navigation disappear. It must stay.

Result: Done. Docker: banner action moved out of `AlertAction` (absolute, 72px reserve) into an in-flow wrapper; text and Review button wrap, never overlap. Restore dialog: chevron + Badge disclosure, truncating unit labels, indented lists. Browse: `onRowOpen` on a leaf now previews in the split instead of opening a KeyValue tab that replaced the browse tab; context menu Open stays the way to a standalone tab. New `browse-folder-nav.spec.ts` was red before the fix; `openS3Browse` moved to `s3Fixture.ts`; `openBrowseLeaf` added to `support/tree.ts`; 5 specs updated. Also fixed: stale gitignored Wails bindings (env, regenerated via `scripts/setup.sh`); flaky push race in `docker-restore.spec.ts` (re-emit until subscribed). Checks: typecheck, lint, full `test:ui:studio` and `test:ipc:fe:studio` green; `budgets`/`perf` ui-timing tripped once under full-suite load, passed on rerun.

## P341

Remove the "keychain access for sandboxed agents" option. Harness needs keychain access to work, so the option has no purpose. Remove the alternative token-injection mechanisms too. Planner enumerates every setting, UI, backend path and doc touching it.

Result: Done. Profiles always render the keychain-on branch: `Policy.Keychain`/`Input.Keychain` gone, no `SecurityServer` mach-lookup deny, `~/Library/Keychains` readable, writes still denied; policy guard unchanged. Auth-failure path removed (`AuthReason`, `IsAuthFailure`, `authFailed`, `setup-token` hint, i18n `backend.space.ade.sandbox.auth`); `Namer` narrowed to `Label()`. Setting `ade.sandboxKeychain` removed across model, repo, wire, appwire, scriptruns, ADE board, settings pane, popover row and i18n; migration 0046 deletes the stale row. Docs: ARCHITECTURE, DEV_ENVIRONMENT Mac checklist, site agents and settings pages. Tests: `TestSandboxAuth`, the keychain switch UI test and `keychain_on` golden deleted; goldens and `ade-sandbox.json` contract regenerated. Checks green: `lint`, `lint:go`, `lint:dead`, `typecheck`, `test:unit`, Go tests for `internal/...` and `apps/kira-space/...` (flows included), full `test:ui:space` (670), `test:visual:space` (19), real `claude` `TestAdeSandbox*`. Fixed pre-existing: all other space visual baselines were 4px short of the current render; rebaselined with the sandbox popover. Open risk (Mac checklist step 9): token refresh writes the keychain, and sandboxed runs deny keychain file writes. A run after the OAuth token expires may fail to sign in; unverified on a real Mac. Record a failure as a Known open item.

## P342

Git graph reloads entirely from scratch after opening a diff (or similar tab switch). Visually distracting; loses graph state (scroll, selection, expansion). Keep state across tab switches and refresh in place. Planner root-causes: tab unmount/remount, store reset, or refetch.

Result: Done. Root cause: MainView rendered only the active tab, so RepoGraphView unmounted on every tab switch and remounted with a fresh git-ui app and re-walk. Fix: opt-in `TabKindDef.keepMounted` (set on `repo-graph`); MainView keeps visited kept tabs mounted with v-show until the tab closes; RepoGraphView takes `active` and drives `MountHandle.setVisible` (sync on hide, post on show). Viewport scroll survives display:none without a CommitGrid change. Also fixed a RepoDiffView null deref when unmounted during `mount()` await. New spec `repo-graph-keep-state.spec.ts` (3 cases); lifecycle spec and ARCHITECTURE.md updated. test:ui:space 673 pass, visual 19 pass, test:ui:studio 611 pass; perf.spec p95<80ms is timing-flaky and fails on the base commit too.
