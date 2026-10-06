# P168 Part 18 findings: `git-core` and `git-ui` logic

Plan: `P168-part18-git-ui-logic.md`. Base `c9e3647`; HEAD reviewed `6882b22` (plan commit only on
top). Reviewer reports only; no source edited. Paths as in plan: `GC` = `packages/git-core/src`,
`GU` = `packages/git-ui/src`, `IPC` = `packages/git-ipc/src`.

## Checks (at `6882b22`)

- `bun test packages/git-core/src packages/git-ui/src/state packages/git-ui/src/graph`: 375 pass,
  0 fail, 33 files, 4.0 s.
- `bun run typecheck:git`: clean.
- `KIRA_GIT_DIFFERENTIAL=1 go test -count=1 -v -run 'Conformance|Differential'
  ./apps/kira-space/internal/gitsearch/`: `TestConformanceCorpus_NonEmpty`,
  `TestConformanceCorpus_AgreesWithCompileAndMatchFields`, `TestDifferential` (0.74 s) all PASS.
- Probes: throwaway `GU/state/zzprobe*.test.ts`, deleted before each commit.

## Block status

- Block 1 (bridge, Part 17 consumers): done.

## Findings

(Severity order within each block; ids are stable once committed.)

### Block 1: bridge and Part 17 consumers

Nothing real in `GU/bridge/client.ts`, `latestRequest.ts`, `repoScopedReload.ts`,
`pendingSlot.ts`, `bootstrap.ts`. Ops-side error exits found while checking candidate 6 are
reported under block 5.

## Candidate fates (plan §9)

1. Dropped. Webview-side cancel is local: the webview's own `createRpcClient` rejects with a
   local `TransportError('cancelled')` and posts `cancel`; `createRpcServer`'s `cancel` handler
   deletes `activeWork` first, so no `res` is ever posted (`IPC/rpc.ts:403-405,466-472`). The
   extension never aborts an upstream call except on webview cancel or server dispose (webview
   gone). A forwarded `transport-closed` (extension socket drop mid-request) arrives as
   `RpcError`; announcing it is correct, since the view is alive and the request failed. The
   `transport-closed` skip in `App.vue:312`/`ReviewView.vue:126` exists only for the view's own
   dispose, which is still a local `TransportError`. Code-read.
2. Dropped as its own finding. No path needs to branch on an `E_*` code: reconnect re-opens via
   `onReconnect`; `E_FRAME_TOO_LARGE` is parked (§6.7). Raw-message exits are covered by the
   OpsState error-exit finding (block 5).
