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
is new. Probe (scratch test on the package's own `fakeBackend`, deleted): Connect A on
`slow-conn`, Connect B waiting, `Disconnect` returns `disconnected`, release the backend; final
state is `connected` with 2 backend connects, 3 runs of 3. The Remove variant did not reproduce
with the instant fake `Disconnect` (C's `Conns.Get` lands after the delete); a real adapter's
slower `Disconnect` widens that window.
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

### S6 (medium, tooling) release workflow lint now fails on macOS: no GNU grep
`scripts/check-theme-classes.sh:28-40`, `docs/pending-changes/.github__workflows__release.yml.patch`,
`.github/workflows/release.yml:111`.
Fix `32f37fc` (Part 8 F12) makes `check-theme-classes.sh` exit 1 when no grep with `-P` exists
(macOS BSD grep). `bun run lint` runs that script. The `release` job runs on `macos-15` and runs
`bun run lint`. The pr.yml patch (`21cbb53`) adds `brew install grep`; the release.yml patch does
not. Applying both patches as written still leaves the next tagged release red at its lint step,
before packaging. Until a human applies the pr.yml patch, the macOS PR job fails the same way
(expected, but the patch's `Why` line is the only place that says so).
Fix: add the same `brew install grep` step before `bun run lint` in the release.yml patch. Action
SHA pins in both patches checked against `git ls-remote`: all match their tags.

Go: nothing real found. Checked: `localsock` Close race and token floor (`efc14be`; both real
callers use 32 bytes), `toolexec` group SIGKILL on cancel (`9f92a40`), terminal registry
pending/doomed handling and `ErrRegistryClosed` mapping (`2ffdb82`; `AbortAgent` still runs on
that error), keep-awake toggle lock, `startupfail` rune cut, `Quitter` atomic app (`8c9030d`),
early `CancelOp` memory (`469cf3f`; renderer op ids are `crypto.randomUUID`, so a remembered
cancel cannot hit a reused id).

## Part 3: SQL adapters

Nothing real found. Checked: dialect-aware comment lexer, `ANALYSE`/`ABORT`/`INTO`, parse_bool
prefixes and per-statement read-only re-verification for Postgres and MySQL/MariaDB (`140b4a7`;
every `ClassifySQL`/`StripSQLComments` caller passes its dialect), `ConnGuard` acquire, release,
cancel bookkeeping and bounded close (`3ab6aa5`; `BeginCancel` runs under the tracker lock that the
query's own release takes, so a cancel cannot slip past `Release`), binary keyset tokens
(`5831d1d`; ClickHouse has no keyset path, so no sibling missed), sqlite `draining` guard
(`71453e9`), ClickHouse NULL flag, `#` comments, command drain and param escaping (`7e67680`),
Postgres identity DDL (`c048264`), ClickHouse select list (`800c6b5`).

## Part 4: document, key-value, stream, object-store adapters

Nothing real found. Checked: Redis no-retry console client, blocking-command timeouts, container
subcommand read-only gate and ref-counted eviction (`7b45362`; `WithTimeout` clones options, so
`MaxRetries = 0` stays on the console clone), S3 bucket scope on every path-taking method, ACL
re-send, pinned preview read, regular-file uploads (`187efdf`), Mongo per-call cancel handle,
bare-delete refusal and collection-name parsing (`e4dc5c5`; classifier and executor share
`parseStatement`), Kafka estimated count, partial-produce report, ordered headers, Connect cancel
(`2352bc4`, `2908620`). Read at diff depth only, no probe: Mongo literal parser depth and
`NumberInt` range (`299d617`), `awscfg` (`7bae46e`), Redis/SQS Connect cancel (`2c77874`).

## Part 5: data plane and page wire

Nothing real found. Checked: bounded adapter `Cancel`, per-id connect epoch in `Router`, cache
drop before teardown, 64 KiB error cap, writer closing the conn on `Send` failure, oversized pages
kept out of L2 (`6d144c8`). Read at diff depth only: null stream bodies (`21c1338`), wire schema
removal and error codes (`f33f54f`, `1dca4ef`), golden frames and fixture capture (`c013e93`,
`e901ab0`, `c8e0b4f`, `7f20a8f`), e2e-real build target (`b879003`).

## Routed

- space-go: `apps/kira-space/internal/bridge/agentsessions.go:41` `AgentSessionsChanged` has the
  S3 shape: `Registry.OnChange` fires outside the registry lock on several goroutines, each takes
  its own `AgentSessions()` snapshot and emits it, so an older snapshot can land last and the
  renderer's agent list shows a closed session as live until the next change. Pre-existing, not a
  P168 fix; low.

## Dropped candidates

- `EnsureOnScreen` (`a6e5ef2`) treats a 1 px overlap as on screen. The real case (display
  unplugged, window wholly off screen) is handled; a sliver overlap needs a deliberate drag there.
  Not verifiable without macOS.
- `maskrules` `gen` and `adapterhost` `connects` maps never shrink: one entry per connection id
  ever seen, bytes each. Not a real cost.
- `InstallClaudeCode` (`8fa92d2`) can run with a URL of a server stopped meanwhile: the URL is
  fixed (`DefaultPort`), so the registration stays correct.
- Postman `originalRequest.header` may hold an `Authorization` header in `origin_json`: request
  headers are stored as live data anyway, so this is consistent with the import model, not a
  regression of F13.
- `toolexec` group SIGKILL after reap could hit a recycled pgid: a pgid stays reserved while any
  member lives, and an empty group returns ESRCH.

## Coverage

Every fixer commit of Parts 2-8 in `f40cd35..1ff382e` touching `apps/kira-studio/internal`,
`internal`, `scripts`, `docs/pending-changes` or `apps/kira-studio/main.go` was read in full at
diff level, with one-hop callers via `codegraph_explore` for the masking scanner and keyset
binder. Probes (scratch tests, deleted): masked-projection tokenizer and set operations (S1, S2),
Connect waiter versus Disconnect and Remove (S4, `-race`, no data race reported; the bug is
logical ordering), grep wrapper error capture under `dash` (no finding). `fab7dca` (TypeScript
`packages/api-core`) and the Part 6 TS mask parity change are outside this area.

Counts: high 0, medium 4 (S1, S2, S4, S6), low 2 (S3, S5). Routed 1.
