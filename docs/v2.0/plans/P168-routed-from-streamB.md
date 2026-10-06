# P168 routed from Stream B

Findings from Stream B parts that need a Stream A- or Stream C-owned file. The orchestrator routes
each to its owning fixer.

## From Part 17 F2 (low): `wireError.Kind` is a dead field on every Go path

`internal/rpcstream/frame.go:11-19,84-90` (Part 8). `wireErrorFrom` never sets `Kind`; its
comment says no classified error carries one yet. TS `WireError.kind`/`RpcError.kind`
(`packages/git-ipc/src/rpc.ts:47-69`) is never read outside `IPC` tests; `mapGitError` folds the
git kind into the code (`E_GIT_<KIND>`).

Scenario: none at runtime today; a future consumer reading `RpcError.kind` gets `undefined` from
every Go server while the TS server (vscode proxy) can fill it, two behaviours on one field.

Fix: only if the Part 17 fixer drops `kind` from the TS contract (its preferred option), remove
the `Kind` field and update the struct comment in `rpcstream/frame.go`. If instead the fixer keeps
`kind` and sets it, no Stream A change is needed. Pointer: `P168-part17-findings.md` F2.

Update (Part 17 fixer): the fixer chose the preferred option and dropped `kind` from TS
`WireError`/`RpcError`. Stream A may now remove `wireError.Kind` and the "kind only for a
classified error" struct comment in `internal/rpcstream/frame.go`. No ordering constraint: the TS
decoder ignores an unknown `kind` field, so either order is safe.

## From Part 20 F2 (low, optional): no abort hook when a composed agent launch fails to open

`internal/terminal/bound.go:93-125` (Part 8). `BoundService.Open` calls `ComposeAgent` (Kira
Space's `ade.Tracker.Compose`, which persists a running session row), then can still fail: the
`MaxCommandBytes` recheck, `ErrDuplicateSession`, `ErrRegistryClosed`, or a spawn error.

Scenario: the tracker's row stays until its 30 s grace Reconcile marks it stopped. Its Claude
session id never ran, so a later resume of it fails. Part 20's own fix (length check inside
`Compose`, capped stage notes) removes the deterministic case; spawn failures remain.

Fix (optional): add an `AbortAgent func(terminalID string)` seam next to `ComposeAgent`, called on
every Open failure after a successful compose. Part 20's fixer then wires it to a `Tracker` method
that deletes a new row (or marks a resumed one stopped) at once. Pointer: `P168-part20-findings.md`
F2.
