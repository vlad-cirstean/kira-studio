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
