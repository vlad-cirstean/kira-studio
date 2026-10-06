# P170 studio-go findings

Delta review of P168 Parts 2-8 fixes (Studio Go, persistence, adapters, engine data plane, app
shell, API client backend, shared Go base, tooling). Report only; Sonnet fixer follows.

- Base commit: `f40cd35`
- Reviewed HEAD: `1ff382e`
- Scope: `git diff f40cd35..HEAD -- apps/kira-studio/internal internal scripts docs/pending-changes
  apps/kira-studio/main.go`, fixer commits of Parts 2-8 only, plus one-hop callers and tests.
- Out of scope: parked P172-P180, `docs/ARCHITECTURE.md` Known open items (view definitions,
  correlation-tag provenance, JSON over-refusal, unmasked response history).

Severity: high = data loss, security, crash, wrong result in a common path. Masking threat model
per Known open items: accidental exposure to an AI client, not a deliberate exfiltration attempt.

## Part 6: Go shell, bridge, DB MCP

### S1 (medium, security) masked-projection tokenizer desyncs on dialect quoting
`apps/kira-studio/internal/dbmcp/render.go:428` (`tokenizeSQL`), `:472` (`skipQuoted`).
Fix `4037466` (Part 6 F9) moved the alias check onto a token scan. The tokenizer knows only
ANSI quoting, so text the server executes can vanish from the scan:
- backslash escape (MySQL/MariaDB default, Postgres `E'...'`): `SELECT email, E'\'' AS a, email AS
  leak FROM t` and `SELECT email, '\'' AS a, email AS leak FROM t` (MySQL) return `false`; the
  `'\'` run swallows the rest of the statement.
- Postgres dollar quotes: `SELECT email, $$'$$ AS a, email AS leak FROM t` returns `false`.
- MySQL executable comments: `SELECT email /*!, email AS leak */ FROM t` returns `false`; MySQL runs
  the comment body.
Each returns column `leak` with the real email, unmasked, to the MCP client. Probe confirmed
against `maskColumnRenamedViaAlias` (scratch test, deleted). Same bug class P168 Part 3 F2 closed
for the read-only gate (`classify.go` MySQL comment handling), not carried here.
Fix: on a masked connection, refuse a statement whose text contains `$` followed by a dollar-quote
tag, `/*!`/`/*M!`, or a backslash inside a single-quoted run (fail closed via
`refuseRiskyStatementSyntax`), or reuse the adapter-aware lexer the read-only gate already uses.
Add the three probes to `render_test.go`.

### S2 (medium, security) set operations rename a masked column positionally
`apps/kira-studio/internal/dbmcp/render.go:347` (`maskColumnRenamedViaAlias`).
`SELECT name, email FROM t UNION ALL SELECT email, name FROM t` passes: every `email` occurrence is
a bare projection item, `email` is present in the result, so no refusal. The second branch's
emails land under result column `name`, which has no rule, and render unmasked. Same for
`INTERSECT`/`EXCEPT`. F9's stated goal is "refuse any non-bare projection of a masked column"; a
set-operation branch is a positional rename the bare check cannot see. Pre-existing before
`4037466`, but inside the bug class F9 claimed closed.
Fix: when the statement has a top-level `union`/`intersect`/`except` (outside parens and quotes,
via `tokenizeSQL`) and mentions a masked name, require that name at the same projection ordinal in
every branch, or refuse set operations on masked connections outright (fail closed, simpler).

### S3 (low, concurrency) keep-awake agent count read outside the serialising lock
`apps/kira-studio/main.go:390-392`, `apps/kira-studio/internal/bridge/keepawake.go:120`.
Fix `ba1fcbf` (Part 6 F14) holds `s.mu` across settings read and `Ctl.Set`, but the count argument
is computed by the caller before the lock: `len(terminalSvc.Registry.AgentSessions())`.
`Registry.OnChange` fires outside the registry mutex from `Open` and `remove` on different
goroutines. Agent A opens (reads count 1), agent A exits (reads count 0, applies 0), then the first
callback applies 1: the assertion stays held with no agent running until the next PTY change.
Fix: pass a `func() int` (or the registry) into `KeepAwakeAgentSessionsChanged` and read the count
under `s.mu`.

Checked, nothing real found: plan-metric allowlist (`1f6e069`; every label emitted by
`queryplan/*.go` checked, condition and filter labels dropped), maskrules generation counter
(`cda9ca9`; every write path calls `invalidate`), tool-handler cancellation (`174a733`),
approval-queue outcome (`7dc2b0d`), `mcpinstall` quoting and atomic helper write (`a237498`),
boot start error surfacing and install lock release (`8fa92d2`), deferred Wails pointers
(`aa218aa`), unbound terminal `Shutdown` (`07e7387`; no other exported mutating method on
`BoundService` or its promoted set), `E_NOT_FOUND` mapping (`ee9a71e`), write-error labels
(`3616f54`).

## Part 2: Studio persistence, secrets, connection lifecycle

### S4 (medium, concurrency) a Connect waiter restarts mid-teardown after Disconnect or Remove
`apps/kira-studio/internal/connections/service.go:648-686` (`Connect` loop), `:705` (`abortInFlight`),
`:483` (`Remove`), `:829` (`Disconnect`).
Fix `51e6259` (Part 2 F3, F4) makes a Connect that waited on an aborted attempt loop and start a
fresh one. `abortInFlight` returns as soon as the aborted attempt closes `done`, and the caller's
teardown runs after that. Any Connect already waiting on the attempt (a second window, the tree
auto-connect racing a tab open, or Update's own reconnect) wakes in the same instant, sees
`aborted`, and starts attempt C concurrently with the teardown:
- Disconnect: C may reach `Backend.Connect` after Disconnect's `Backend.Disconnect`, then emit
  `connected` after Disconnect emitted `disconnected`. The connection the user just closed comes
  back; or C's adapter is torn down under it and the state still says `connected`.
- Remove: C reads the row before `Conns.Delete`, spawns its pre-connect script after Remove's
  `Preconnect.Stop`, and writes `states[id]` after Remove deleted it. Result: a leaked sidecar
  process and a live adapter for a deleted connection id, until app quit.
Before `51e6259` such a waiter returned the aborted attempt's `disconnected` result, so this race
is new.
Fix: hold a per-id lifecycle lock across abort plus teardown in Disconnect/Remove/Update, and take
it in Connect before registering an attempt; or keep the old "waiter returns the aborted result"
behaviour and only start fresh for a Connect that arrives after the teardown finished. Add a
race test: Connect A in flight, Connect B waiting, Remove; assert no adapter, no sidecar, no state.

### S5 (low, security) URIs stored before the query-secret fix keep their plaintext secret
`apps/kira-studio/internal/connections/uri.go:68` (`stripQueryPassword`), `input.go:139`.
Fix `11e910f` (Part 2 F2, F8) strips `?password=` and refuses `sslpassword`/
`tlsCertificateKeyFilePassword`/`proxyPassword` only on Create/Update. Rows already stored keep the
secret in plaintext in `connections.uri`, and `List` still returns that URI to the renderer, so the
"List never leaks a password" guarantee (D9) stays broken for every pre-existing row until the user
re-saves it. No migration or resolve-time strip was added.
Fix: a one-time Go migration step (or a `resolve`/`List` pass) that moves a stored `password`
query pair into the encrypted secret and blanks the three refused keys from `List` output, with the
connection flagged for the user to re-enter that value.

Checked, nothing real found: pre-connect one-shot classification and group reap (`00a42fe`;
`os.Pipe` read end is pollable so the drain deadline works; pgid stays reserved while a member
lives), localauth prompt serialisation and wall-clock grace (`95e7f0f`), FK child indexes
(`3d5e53d`; no existing covering index duplicated), UTF-16 name counts and rune-safe caps
(`9c19663`, `db5f2f8`), `Reorder` validation (`66174c8`).

## Part 7: API client backend

Nothing real found. Checked: URL redaction from transport errors (`9df3f04`; remaining
`err.Error()` sites in `httpclient` carry a local path or multipart error, never the URL),
port-change and downgrade header strip (net/http re-copies headers from the original request each
hop, so comparing every hop against `via[0]` holds), cookie delete candidates (`b06ab01`,
`9df3f04`), cloned transport and header cap, shared gRPC resolution detached from one caller's
cancel (`9f0547c`; both resolution modes are timeout-bounded), byte-weighted coalescer (oversized
single message flushes alone), Postman single-pass decode, depth cap and example auth strip
(`82d92b1`, `b6d129d`), elision flags on stored snapshots (`a083091`), `apivars` dead dep
(`624952b`). `fab7dca` is TypeScript (`packages/api-core`), outside this area.

## Part 8: shared Go base and tooling

Nothing real found in Go. Checked: `localsock` Close race and token floor (`efc14be`; both real
callers use 32 bytes), `toolexec` group SIGKILL on cancel (`9f92a40`), terminal registry
pending/doomed handling and `ErrRegistryClosed` mapping (`2ffdb82`; `AbortAgent` still runs on
that error), keep-awake toggle lock, `startupfail` rune cut, `Quitter` atomic app (`8c9030d`),
early `CancelOp` memory (`469cf3f`; renderer op ids are `crypto.randomUUID`, so a remembered
cancel cannot hit a reused id).
