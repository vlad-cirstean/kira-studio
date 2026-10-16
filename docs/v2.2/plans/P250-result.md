# P250 result

Plan `plans/P250-plan.md`. Every v2.2 gap in the plan now has a Go flow test and a UI spec tied by a
contract fixture. One real bug fixed (S1). Base `v2.0` at `af14ac15f`; branch `p250-W`.

## Commits

1. `fix(space)` S1 fix round counts against its result's loop budget (`stageBlocks.ts backMax`), S2, S3 flow half.
2. `test(space)` workflow results editor (S3 UI half).
3. `test(space)` notification and usage (S4, S5).
4. `test(space)` prompt routing and rebase needs (S6, S7).
5. `test(space)` ADE error path and environments (S11, S18).
6. `test(space)` automations folder, overlap, task picker, smart failed (S8, S9, S10, S23).
7. `test(space)` memory (S12, S13, S14).
8. `test(mobile)` pairing, expiry, backlog, hold overlay (S15, S16, S17).
9. `test(space)` git blame and worktree (S19).
10. `fix(space)` `removeLegacyGitSocket` moves into `appwire.Build` plus `appflow` startup test (S20).
11. `test(space)` smart runs leave Claude config untouched, flow and real-claude (S21, C1).
12. `test(studio)` collection move, script collections, legacy folder, overlap (T2-T5).
13. `test(studio)` prompt routing (T6).
14. `test(studio)` docker exec opt-in (T7).
15. `test(studio)` cache pane readout and clear (T1); `mockStream.ts` gains `pushCacheStats`.
16. Fixes from the end-of-phase run: `contractVersion` masked in `git-path` (wire bump to 47 drifted
    the fixture), `adeflow` automation fixture settles both branches, `dbmcp-approval` spec routes its
    prompt to the window. All three predate this phase (none of the failing files changed by it).
17. Docs: SPEC rows and stubs, ARCHITECTURE, DEV_ENVIRONMENT, this file.

## Suite results (workers 2, load average 20-36 from the parallel P252 agent)

- `lint`, `typecheck`, `lint:go` (0 issues), `lint:dead`, `lint:claude` (0 issues): pass.
- `test:unit`: 1792 pass, 0 fail, 16 s.
- `test:flows:space`: 16 packages ok, 105 s. `test:flows:studio`: all ok, 88 s. Both `exempt.txt` empty.
- `test:flows:space:complete`: 161 s. `adeflow.TestAutomationRun/held_step_survives_a_restart` failed once
  ("a run is working on feat/api-login", the fixture returned while the second branch's run was still
  active). Fixed in the fixture; `-count=3 -run TestAutomation` with complete passes (54 s). Other 15 packages ok.
- `test:flows:studio:complete` with Docker: 11 packages ok, 65 s.
- `test:ui:space`: 417 pass, 15.4 min. `test:ui:space-mobile`: 53 pass, 1 skipped, 45 s with build.
- `test:ui:studio`: 399 pass, 1 fail (`dbmcp-approval`, fixed, passes alone). `ui-timing`: 3 pass, 1 fail
  (`budgets` interaction p95: 76 ms vs 50, then 19 vs 16 on rerun, load average 20; no source in
  that path changed by this phase). Left open; rerun on an idle machine.
- `test:e2e-real:space`: 4 pass, 104 s. `test:e2e-real:studio`: 9 pass with Docker (219 s); 4 pass, 5 skipped
  when dockerd was down.
- `test:claude:space -run TestRealClaudeSettingsUntouched`: pass, 46 s, 0.0022 USD (both new subtests ran).
- Normal (no `KIRA_CONTRACT`) runs of every flow suite leave `git status` clean: no fixture drift.

## Deviations

- S3 landed in two commits (flow half with S1, UI half separate). S7 landed with S6.
- S4: `TestClickRevealsAdeSession` emits open-session, so reveal-task got its own flow test (`TestClickRevealsTask`).
- S6: `PromptsService.MainWindow` and `#queued` not recorded; no UI consumer.
- S12: the paused-with-usage-limit reason is hand-written (backend cannot produce it); files come from the contract.
- Some conversions are shape-level (open-session, unsaved-script, `args:` keys compared as key sets where
  the UI mints its own ids: docker exec, script and collection moves).
- S16 backlog read uses a one-item backend backlog; the four-item fixture assertions in `tabs.spec.ts` stay.
- T2 adds `TestMoveRequest` (HTTP request move) beside the existing gRPC folder move.
- Free disk fell to 4.6 GB during e2e-real (guardrail 6 GB); the builds still passed.

## Skipped

- Real `claude` tests other than `TestRealClaudeSettingsUntouched` (opt-in, cost).
- Visual and perf suites (not in the plan's list).
