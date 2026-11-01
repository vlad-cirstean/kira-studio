# P434 code review, round 2

Base: `f8865886e` (v0.2.23 squash merge on `main`), same base as round 1. Head: `f68972137`.
Scope: full diff base..HEAD. Unreviewed since round 1: round-1 fixer commits (`c069d550a`, `56abc4052`,
`f4ebe75fe`, `471e0cde4`, `ea34a47b1`, `4a5abd30e`, `b53a85f99`), P429 iter2 (`118c22064` attachments
removed, `9a9a46463` G5 guard, ReplyKinds) and P429 Part 2 (`2d19d3b69`, `f68972137`: `internal/docker`
via `tlsconfig.Client` and `docker context show`).

Dimensions: (1) architecture, structure, maintainability, security; (2) functional correctness;
(3) performance and resource use. Known violation `internal/harness/claude/usermcp.go` excluded (Known
open items).

## Findings

### R2-F1 (medium) `docker context show` needs docker CLI 23.0 or later

- File: `internal/docker/clicontext.go:61`
- Defect: the current context comes only from `docker context show`. That subcommand shipped in docker
  CLI 23.0. Older CLIs (Debian 12 `docker.io` is 20.10) exit non-zero with a usage error. `query`
  returns `""`, so `resolveEndpoint` skips the current context and takes the default socket.
- Failure: Debian 12 user, `docker context use remote` (ssh or tcp) and a local engine on
  `/var/run/docker.sock`. Before P429 Part 2 Kira followed `remote` (read from `config.json`). Now Kira
  silently shows the local engine; the endpoint chip says source `default`. With no local engine, the
  status says daemon down while `docker ps` in a shell works.
- Fix: on `context show` failure, fall back to
  `docker context ls --format '{{if .Current}}{{.Name}}{{end}}'` (`.Current` exists in 19.03+; take the one
  non-empty line). Keep `show` first. Neither reads `config.json` in Kira.

### R2-F2 (low) Transient `context show` failure cached as "no context"

- File: `internal/docker/clicontext.go:33,62-64`
- Defect: `name()` stores `""` with `known = true` on every failure, timeout included. A cached `""`
  is the same as "CLI says default". It is dropped only by `resetLocked` (Retry, context switch,
  shutdown) or `dropFallbackClient`. `dropFallbackClient` fires only after 3 failed restore ticks.
- Failure: app launch under load, `docker context show` exceeds the 3 s timeout once. Current
  context is `colima`, and Docker Desktop also answers on the default socket. Kira connects to
  Desktop. Ticks succeed, so `dropFallbackClient` never fires, and Kira stays on the wrong engine
  until the user clicks Retry or switches context.
- Fix: cache only a definite answer: a name, or "CLI not found". On spawn error or timeout leave
  `known = false`, so the next resolve asks again. Cost: one spawn per client rebuild at most.

### R2-F3 (low) KQL value lookups no longer cancel their backend op

- File: `apps/kira-studio/frontend/src/views/console/kibana/kqlCompletion.ts:160-189`
- Defect: the R1-F5 fix wires `opsCancel` to the `queryFn` signal of `queryClient.fetchQuery`.
  `fetchQuery` adds no observer. In query-core 5.103.2 that signal aborts only on `query.cancel()` or
  on removal: `removeObserver` (`query.js:249`) never runs for it. Nothing calls `cancelQueries` on
  `['kibana', 'suggest', ...]`. So `opsCancel` never fires. Before the fix the first caller's abort at
  least cancelled the op.
- Failure: the user types a value prefix on a large index. Each narrowed lookup the completion drops
  keeps running a Kibana terms aggregation to the end. Each one holds an op slot and adds an op-log
  row. Many keystrokes queue several abandoned aggregations on the cluster.
- Fix: count callers per key. When the last caller's own `signal` aborts while the fetch is
  in flight, call `queryClient.cancelQueries({ queryKey, exact: true })`. That aborts the query signal,
  and the existing listener sends `opsCancel`. Also move this call (and the new `fetchQuery` calls in
  `apps/kira-space/frontend/src/main.ts:133,140`) to `queryClient.query()`. `fetchQuery` is deprecated
  in this TanStack version, as `apiQueries.ts` already notes.

### R2-F4 (low) v0.2.25 P443 still asks to extend G5 to `internal/docker`

- File: `docs/v0.2.25/SPEC.md:76`
- Defect: the bullet says "Extend guard G5 to the claude harness and `internal/docker` once clean".
  `f68972137` already extended G5 to `internal/docker` and narrowed the row title and intro.
- Failure: P443's planner re-plans finished docker work, or reads the row as docker still open.
- Fix: narrow the bullet to the claude harness only (no `.claude.json` header reads or forwarding).

## Checked and clean

- Attachment removal (`118c22064`): no Go, TS, Vue, i18n or contract-fixture leftovers.
  (`frontend/bindings` still has `StageAttachment`, but it is gitignored generated output and
  regenerates.) `HostViewCompose` is `maxBodyBytes` plus `replyKinds`. Provider `ReplyKinds` (GitHub
  `code`; Azure `comment`, `code`; fake all three) match the fixtures. The frontend gates reply on
  `replyKinds`. The single-post guard is `beginPost`/`endPost` with a deferred release. The stale-window
  path and window close forget targets; no staged bytes remain anywhere. fakeaz flags any unsupported
  argv, `account get-access-token` included. Docs (ARCHITECTURE host view, CLI credentials, Known
  open items) say text only.
- G5 guard: catches token commands, credential env names, CLI config paths, auth headers, `net/http`
  imports and `os.Getenv`/`UserHomeDir` under `githost/` and `issuetracker/`. Under `internal/docker` it
  catches `LoadX509KeyPair`, `X509KeyPair`, `AppendCertsFromPEM` and `config.json` literals. The
  `internal/conventiontest`, `internal/docker` and `internal/shell` tests pass.
- Docker Part 2: `buildTLS` hands only paths to `tlsconfig.Client`
  (`ExclusiveRootPools`, TLS 1.2 floor). An empty CA keeps the system pool. The CLI runs argv-only
  through `toolexec.RunIO`, with process-group kill on the 3 s timeout and 1 MiB stdout cap. It
  inherits `DOCKER_CONFIG`. `Locate` covers a minimal GUI `PATH` (Desktop, Homebrew, OrbStack,
  Rancher). Cache use: one spawn per client rebuild. The status poll uses `status(false)` and never
  resets. Restore ticks with no client reuse the cache. `dropFallbackClient` costs one spawn per 3
  failed ticks (about 90 s) while the engine is down. Not a leak. `forget` during an in-flight `name`
  waits on `c.mu`; no race.
- Round-1 fixes: R1-F1 64 MiB `LimitReader` plus a typed error. R1-F7 `DefaultConsoleCap` with
  `Truncated`. R1-F4: the new chord registers before the old one unregisters. Wails beta.28 rejects
  synchronously after start, so a failed OS registration keeps the old chord. R1-F2 suggestion key
  carries connection, data view and scope. R1-F3 `gcTime` dropped. R1-F6 `FULL_COMMIT_ID` plus the
  backend pinning a ref to its oid. R1-F8 subsumed by the removal.
- P433 memory work: every `KEEP_WHILE_OPEN` key names its removal (history tab close, `reconcileTree`,
  `reconcileEnvironments`, histogram per run and tab close, mask rules, schema). `usePersistedState`
  uses a detached `effect` with no component capture. One `storage` listener per app.
- Dimension 1 (security): nothing beyond R2-F1/F2 robustness. No new credential read or forward
  found outside the tracked `usermcp.go`.
