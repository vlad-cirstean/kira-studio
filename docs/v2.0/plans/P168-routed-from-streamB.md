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
