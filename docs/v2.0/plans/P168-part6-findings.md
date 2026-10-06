# P168 Part 6 findings: Studio Go app shell, Wails bridge and DB MCP

Plan: `P168-part6-go-shell.md`. Base `d7f1da9`. HEAD reviewed: `0705586` (`p168-stream-a`; plan
commit only on top of base, no code change). Reviewer reports only; fixer follows plan §8.

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SF` = `apps/kira-studio/frontend/src`,
`SD` = `packages/shared/domain`.

## Checks run

Filled in block 7.

## Findings

### F1 (low) `mcpinstall.Command` copy-paste text drops the inner `headersHelper` quotes

`SI/mcpinstall/install.go:190-194`. `Command` wraps the JSON payload in a literal `'...'`. The
payload's `headersHelper` value is `shellSingleQuote(helperPath)`, which itself holds `'`. The
shell ends the outer quote at the first inner `'`. P108 F10 fixed `Install` (argv, unaffected);
the copy-paste path still regresses.

Probe (scratch Go program rendering the exact payload, run through `sh`):
- `/Users/a/.kira/...`: stored `headersHelper` is `/Users/a/.kira/mcp-header-helper.sh`, unquoted.
  Works only because the path has no space.
- `/Users/a b/.kira/...`: `add-json` receives two argv words,
  `{"type":...,"headersHelper":"/Users/a` and `b/.kira/mcp-header-helper.sh"}`. Registration fails.
- `/Users/o'n/...`: `sh: Unterminated quoted string`.

`name` is also unquoted (constant `kira-db` today; harmless but inconsistent).

Fix: build the add-json word with `shellSingleQuote(string(payload))` and quote `name` the same
way. Add a `sh -c` round-trip case to `install_test.go` (space and `'` in the path) asserting the
argv the shell produces equals what `Install` passes. This is shell-escaping with interacting
rules, so it clears the unit-test bar.

### F2 (medium) MCP tool handlers keep running after the client disconnects; a stale approval still executes

`SI/dbmcp/http.go:54-56`, `SI/dbmcp/tools.go` (`runQuery`, `awaitApproval`, `explainQuery`),
`SI/dbmcp/approval.go` (`Request`). go-sdk v1.8.0 `NewConnection` wraps the session context in
`notDone{ctx}` unless `PropagateCancellation` is set (`internal/jsonrpc2/conn.go:212-233`). The
stateless handler only sets it for protocol `>= 2026-07-28` with
`StreamableHTTPOptions.PropagateRequestCancellation` (`mcp/streamable.go:431`). A client cancel
notification arrives on a separate stateless POST, so it reaches a different ephemeral session
and cancels nothing.

Probe (scratch test, deleted): stateless handler, tool blocks on `ctx.Done()` or a 3 s timer;
client POSTs `tools/call` with a 300 ms deadline. For protocol `2025-06-18` and `2025-11-25`, the
client got `context deadline exceeded` and the handler logged `ran to completion after 3.0s`.
`ctx.Done()` never fired.

Scenario: Claude Code calls `run_query` with a `write` statement on a prompt-mode connection.
The user presses Esc in Claude Code, or its request times out. The approval dialog stays up for
up to `ApprovalTimeout` (2 min). The user later clicks Approve, assuming the agent still waits.
The write executes with no client to receive the result. Same for an auto-explain heavy-plan
approval, and for a long `Execute` with no approval: the query runs to completion and holds the
connection. `session.Close()` waits for the handler, so the HTTP goroutine is pinned too.

Fix: wrap `protected` in a small middleware that stores `r.Context()` under a private context
key (`context.WithValue`). `notDone` keeps values, so each tool handler (in `withPanicRecovery`,
one place) can read it back and derive `ctx, cancel := context.WithCancel(ctx)` plus
`context.AfterFunc(reqCtx, cancel)`. `ApprovalBroker.Request` already honours ctx; confirm it
then returns `Abandoned` and removes the queued entry, and that `Execute` receives the same ctx.
Also set `PropagateRequestCancellation: true` for the new protocol. Add one test: a request whose
HTTP context is cancelled while parked in `Request` returns, and the snapshot drops it
(concurrency, clears the bar).

### F3 (low) Boot-time DB MCP start failure is invisible in the settings pane

`SI/bridge/embedded.go:67-81`, `SI/bridge/dbmcp.go:95-115,264-278`. `DbMcpStatus.Error` is set
only in `SetEnabled`'s return value. `startIfEnabled` logs a bind failure and keeps no record.
`statusFn` never sets `Error`.

Scenario: port 8766 is taken at app start (another Kira instance under a different
`KIRA_HOME`, or any other process). `ServerEnabled` is true. The pane
(`SF/workbench/settings/DatabaseMcpPane.vue:108-116`) renders `status.error` (empty) or the
running branch (false): it shows the toggle on and nothing else. No reason, no retry hint. The
same happens after any later `Status()` refresh following a failed `SetEnabled`.

Fix: `embeddedService` keeps `lastErr error` under `mu`: set by `startLocked` on failure, cleared
on success and by `stopLocked`. `statusFn` (or `statusLocked`) folds it into `Error`.
`SetEnabled` then stops special-casing it. Keeping `ServerEnabled=true` after a failed start is
correct: it records the user's intent and boot retries (plan §9 suspect 8: by design, no finding).

### F4 (low) `EnsureHeaderHelperScript` writes the helper non-atomically and keeps a pre-existing file's mode

`SI/mcpinstall/install.go:143-156`. `os.WriteFile` truncates in place, follows a symlink and does
not chmod an existing file. `MkdirAll` does not tighten an existing `KIRA_HOME`.

Scenario: Claude Code runs the helper (on every connection attempt) while Studio starts and
rewrites it. The shell reads a truncated script, emits no header, and that connection fails
with 401. Second scenario: the file exists with a looser mode (restored from a backup, or a
`KIRA_HOME` shared via a group-writable directory); it stays that way. A group-writable helper
lets another local user replace the script Claude Code executes, which then reads the token.

Fix: write via the same temp-file-plus-rename helper `mcpauth` uses (`atomicWrite0600`
generalised to take a mode, or a sibling in `mcpinstall`), with mode 0700. Rename replaces a
symlink rather than following it and gives the new file the temp file's mode.

### F5 (low) Stale comment: `Command` no longer carries a token

`SD/dbmcp.ts:4-6` says `Command carries the plaintext token exactly once`. Since P108 F2,
`Command` holds only the helper script path (`mcpinstall/install.go:179-183`). The comment
overstates the renderer's exposure and misleads a reviewer of the pane.

Fix: say `command` is the copy-paste registration text naming the headersHelper script; it holds
no secret.

Same file, same kind of drift (block 3): `dbMcpApprovalSchema` (`SD/dbmcp.ts:46-62`) declares
`truncated: z.boolean()` and its comment says the statement "is capped at 4000 (rune-safe)
characters on the wire". Go's `DbMcpApprovalRequest` (`SI/bridge/dbmcp.go:385-396`) has no
`truncated` field and sends the statement uncapped (M7 finding, comment at `:410-413`). The schema
is type-only (`SF/bridge/index.ts:270-276` uses `trust<>`, no parse), so nothing fails at runtime;
a future reader of `pending.truncated` gets `undefined` typed as `boolean`. Drop the field and the
4000-character sentence.

### F6 (high) `explain_query` leaks real row values through MySQL/MariaDB `index_condition` on a masked connection

`SI/dbmcp/explain.go:87-107` (`maskPlanNode`), `SI/queryplan/mysql.go:56-71`
(`mysqlTableMetrics`), `SI/queryplan/mariadb.go:45-51` (`collectMetrics` over
`mariadbTableTypedKeys`). Both parsers emit every untyped table key as a `Metric`, including
`index_condition`. P108 F5's mask strips `Node.Detail` (`attached_condition`) and metrics whose
label ends in `" condition"` (with a space, ClickHouse's spelling). `index_condition` ends in
`_condition` and survives.

Probe (live `mysql:8.4` and `mariadb:11.4` containers, throwaway, removed): `u(id PK, email)`,
`o(cust_id, status, KEY(cust_id, status))`, `u` row `(1, 'alice@secret.example')`.
`EXPLAIN FORMAT=JSON SELECT o.note FROM u JOIN o ON o.cust_id = u.id AND o.status > u.email WHERE
u.id = 1` returns, for table `o`:
- MySQL: `"index_condition": "((`d`.`o`.`cust_id` = 1) and (`d`.`o`.`status` > 'alice@secret.example'))"`
- MariaDB: `"index_condition": "o.cust_id = 1 and o.`status` > 'alice@secret.example'"`

`u` is a const table, so the server substitutes the real `u.email` into `o`'s pushed-down
condition. Scenario: `email` has a mask rule; the agent calls `explain_query` with the statement
above, varying `u.id`, and reads every real email from the metric list, one row per call. Same
bypass F5 closed for `attached_condition`.

Fix: on a masked connection keep only an allowlist of metric labels known to carry no row data
(`cost_info.*`, `rows*`, `filtered`, `key`, `key_length`, `used_key_parts`, `access_type`,
`possible_keys`, `used_columns`, ClickHouse ` keys`/` parts`/` granules`/` search`). A blocklist
by suffix already missed one spelling. Extend `explain_test.go` with an `index_condition` metric
(MySQL and MariaDB shapes) asserting it is dropped.

### F7 (low) A full approval queue answers "denied by the user"

`SI/dbmcp/approval.go:143-145`, `SI/dbmcp/tools.go:375-377,473-474`. `Request` returns
`ApprovalDenied` when 50 requests are already queued. Both callers render that as
`query against %q was denied by the user`. No user saw it.

Scenario: an agent loops `run_query` on a prompt-mode connection. Call 51 gets "denied by the
user". The agent reports a human refusal that never happened, or rephrases and retries.

Fix: add `ApprovalQueueFull` and map it to "too many queries are already waiting for approval;
retry after the user answers them".

### F8 (low, design-decision) `run_query` reaches Part 4 F8's unbounded console materialisation

`SI/dbmcp/tools.go:200-220` calls `Router.Execute` (the console path) and caps rows only in
`renderPage` (`maxRows` at most 2000). Reachable: `SELECT * FROM big_table` on any SQL kind,
`db.c.find()` on Mongo, `KEYS *`/`HGETALL` on Redis. The whole result is materialised in Go
first; the tool description says so ("the query itself still runs in full"). `planFor`'s EXPLAIN
pages are one row (one JSON cell capped at `page.MaxCellBytes`) or a few dozen (SQLite), so the
explain path is not a practical reach. An MCP client loop multiplies the cost, gated only by the
connection's read mode.

Same decision as P168 Part 4 F8 (console row/byte cap, shared with SQL consoles; not yet its own
`SPEC.md` phase). Not a second phase: when F8's cap lands, `run_query` should pass
`maxRows` (plus one, for the truncation flag) as the console cap. No fix proposed here.

### F9 (high) A masked column selected by its own name excuses an unaliased second projection of it

`SI/dbmcp/render.go:310-370` (`maskedColumnRenamedOrHidden`, `maskColumnRenamedViaAlias`). Once
the masked column is present under its own name, the only remaining check is the regex
`\bname\b[^,]*\bas\b\s*\b(?:alias)\b`. It needs a literal `AS` and a bare alias. Every other
second projection passes, and `columnRules` masks only the column named `email`.

Probe (scratch test calling `renderPage`, deleted), rule `email: email, keepHint`, value
`person@example.com`:
- `SELECT email, email leak FROM customers` (implicit alias) returned
  `[["p•••••@example.com","person@example.com"]]`.
- `SELECT email, email AS "x" FROM customers` (quoted alias: no `\b` before `"`) returned the
  same.
- `SELECT email, lower(email) FROM customers` with result columns `email`, `lower` (Postgres
  naming) or `email`, `lower(email)` (MySQL naming): no refusal, second column unmasked.
- `SELECT email, email || '' FROM customers` (`?column?`): no refusal.

These are ordinary queries, not adversarial ones (normalising or trimming an email beside the raw
column), so they fall inside the documented threat model of accidental exposure
(`docs/ARCHITECTURE.md` Known open items, M6 correlation-tag entry). P108/M7 finding #1 closed only
the `AS` spelling.

Fix: when a masked name is present and mentioned, refuse unless every occurrence of it inside a
projection list (any `SELECT ... FROM` span, subqueries included) is a bare projection item: the
masked name, optionally qualified (`t.email`, `"email"`), followed by `,`, `FROM` or the end of
the list. Any other occurrence in a projection (inside a function call, an operator expression, or
followed by an alias with or without `AS`) refuses with the rename message. WHERE/ORDER BY/JOIN
occurrences stay allowed (today's behaviour). Add the four probe statements above to
`TestRenderPageRefusesRenamedOrTransformedMaskedColumn`, plus `SELECT email FROM c WHERE email =
'x'` and `SELECT c.email, o.id FROM c JOIN o ON o.email = c.email` as must-render cases.

### F10 (low) `maskrules.Service.MaskSetFor` can cache a rule set from before a concurrent write

`SI/maskrules/service.go:107-159,199-209`. `MaskSetFor` checks the cache, unlocks, queries
`ListForConnection`, folds, then `store`s. `Upsert`/`Remove`/`RegenerateKey` write then
`invalidate`. If a write and its `invalidate` land between the query and the `store`, the stale
set is stored after the invalidation and stays cached until the next write to that connection or
an app restart.

Scenario: an agent's `run_query` on connection C resolves `MaskSetFor` while the user clicks
*Mark column as PII* on `email`. Interleaving: query (no rules), Upsert + invalidate, store (no
rules). Every later `run_query` on C returns `email` unmasked although the Privacy tab shows the
rule.

Probe: a scratch test (deleted) racing 4 reader goroutines against one `Upsert`, 300 rounds, saw
0 stale results. `SetMaxOpenConns(1)` serialises the queries, so the write (three statements)
must fit inside the reader's fold-and-store step, which needs the reader goroutine preempted
there. Confirmed by reading only; rare, but silent and persistent when hit.

Fix: a per-connection generation counter under `mu`. `invalidate` bumps it; `MaskSetFor` reads it
before the query and `store`s only if it is unchanged. A `-race` test with a hook between query
and store (concurrency with cache invalidation; clears the unit-test bar).

### F11 (low) Go/TS mask parity drifts on three inputs; no fixture covers them

`SI/mask/mask.go` against `SD/mask.ts`. Scratch probes (Go `unicode`/`uniseg` v0.4.7, Bun's
`Intl.Segmenter` and RegExp):
- **U+FEFF in a name.** `NAME_WORD_SPLIT_RE` (`mask.ts:105`, `\s` plus a raw U+0085 byte pair)
  matches U+FEFF; Go `strings.Fields` (`unicode.IsSpace`) does not. `"Ann﻿Lee"` is one word in
  Go, two in TS. `decadeRange`'s `trim()` versus `strings.TrimSpace` differs on U+FEFF the same
  way. Plan §9 suspect 10 confirmed.
- **Indic conjuncts.** `uniseg` v0.4.7 counts `क्ष` as 2 graphemes; ICU (Unicode 15.1 rule GB9c)
  counts 1. A Hindi name masks with a different bullet count. v0.4.7 is the latest `uniseg`
  release, so an upgrade does not fix it.
- **Non-ASCII digits in a date tail.** `destroyDigits` uses `unicode.IsDigit` (every `Nd`); TS
  uses ASCII `/\d/`. `2024-01-01T١٢:00` keeps `١٢` in the TS preview.

The MCP render path (Go) is the security boundary; the grid preview is advisory
(`docs/ARCHITECTURE.md` Masking section). Impact: the preview shows a string different from what
the agent sees, which the parity suite exists to prevent. The raw U+0085 byte in a regex literal
is invisible in an editor.

Fix: in `mask.ts`, spell the whitespace class out to match `unicode.IsSpace`
(`/[\t\n\v\f\r \u0085   -     　]+/`), replace
`trim()` in `decadeRange` with a trim over the same class, and use `/\p{Nd}/u` in
`destroyDigits`. Record the GB9c skew under `docs/ARCHITECTURE.md` Known open items (no library
fix exists). Add fixtures for U+FEFF and an Arabic-Indic date tail. `needs-other-part-file:
apps/kira-studio/tests/fixtures/mask/ (Part 12, Stream C)` for the fixtures. No fixture generator
is committed (`parity_test.go:13-17` claims Go-generated fixtures); new fixtures are hand-written
from the Go output, which is acceptable at this size.

### F12 (medium) Cookie Remove silently fails for the common cookie; exact delete needs a jar decision (routed Part 10 F18)

`SI/httpclient/cookies.go:82-105` (Part 7, one hop), `SI/bridge/http.go:201-223`.
`DeleteJarCookie` sends `SetCookies(u, {Name, MaxAge: -1})` with no `Domain` and no `Path`.
`net/http/cookiejar` then keys the expiry as a host-only cookie on `u.Host`, path
`defaultPath(u.Path)` (the URL's directory), and deletes only an entry with exactly that
`domain;path;name` id.

Probe (scratch test in `httpclient`, deleted):
- Cookie `sid` set by `https://api.example.com/login` with `Path=/`; delete via
  `https://api.example.com/api/v1/users`: before `[sid]`, after `[sid]`. Not deleted (expiry
  keyed on path `/api/v1`).
- Same cookie, delete via `https://api.example.com/`: deleted.
- Cookie with `Domain=example.com; Path=/`, delete via `https://api.example.com/`: not deleted
  (expiry keyed host-only on `api.example.com`).

Scenario: the user opens the Cookies tab on a request to `/api/v1/users`, clicks Remove on the
session cookie a login set with `Path=/`. `DeleteCookie` returns the refreshed list with the
cookie still in it. Every later send still carries it.

Feasibility of Part 10 F18's exact-cookie delete: not feasible over `net/http/cookiejar`.
`JarCookies` gets name and value only from `jar.Cookies(u)` (`Domain`/`Path` are always `""` in
the listing, `cookies.go:82-92`), so the renderer's `c.domain`/`c.path` for a jar row are empty and
cannot identify one of two same-name cookies. The jar exposes no entry list and no delete. An
exact delete needs a jar that exposes entries (a replacement or fork of `cookiejar`, licence to be
checked per `CLAUDE.md`). **DESIGN-DECISION** for that part: keep name-scoped delete, or replace
the jar. No renderer change until it is decided; the `apiControl.ts`/`HttpCookieDeleteArgs`
widening routed by plan §7 should not land, since there is no domain/path to pass.

Fix for the bug itself (no design decision needed): make `DeleteJarCookie` expire every entry
named `name` that `Cookies(u)` would return. For each candidate domain (host-only, plus
`Domain=` each parent of `u.Host` down to `publicsuffix.EffectiveTLDPlusOne`) and each candidate
path (`/` plus every prefix of `u.Path`), call `SetCookies` with that `Domain`/`Path` and
`MaxAge: -1`. Then re-read `Cookies(u)`. Document it as "remove every cookie named X sent to this
URL". A test with path-scoped and domain-scoped cookies (enumeration with interacting rules;
clears the bar).

### F13 (low) Saved-request reads cannot report not-found (routed Part 10 F6, Go half)

`SI/bridge/collections.go:61-74`, `SI/storage/repos/collections.go:102-121`. Confirmed:
`getRequestBody` returns `fmt.Errorf("repos/collections: no item %s")` on `sql.ErrNoRows`, and
`GetRequest`/`GetGrpcRequest` wrap every error in `ipcerr.InternalResult` (`E_INTERNAL`). The
renderer cannot tell a deleted item from a transient DB failure, so
`apiSavedRequestQueryOptions` caches `null` forever for both (Part 10 F6 scenario).

Fix (edit set per plan §7): `repos.ErrItemNotFound` sentinel, wrapped by `getRequestBody` on
`sql.ErrNoRows`. Add `ipcerr.NotFound(message)` (`E_NOT_FOUND`) in `internal/ipcerr`.
`GetRequest`/`GetGrpcRequest` map `errors.Is(err, repos.ErrItemNotFound)` to it. A non-request item
or a protocol mismatch is the caller asking for the wrong thing: add `repos.ErrNotARequest` and map
it to `E_BAD_REQUEST`. Corrupt stored JSON stays `E_INTERNAL`. `E_NOT_FOUND` already means "unknown
object" in the data views (`SF/views/shared/viewOp.ts:12-19` treats it as ordinary), so the code
does not collide with the reconnect gate. Record the code name in `P168-routed-from-streamA.md`.
Renderer half: `needs-other-part-file: apps/kira-studio/frontend/src/api/state/apiQueries.ts
(Part 10, Stream C)` (return `null` only for `E_NOT_FOUND`, rethrow the rest).

### F14 (low) `KeepAwakeService.recomputeAgent` can leave a stale agent assertion

`SI/bridge/keepawake.go` (`recomputeAgent`, `KeepAwakeAgentSessionsChanged`, `SetAgentAware`).
`recomputeAgent` reads settings, then `agentCount` under `mu`, releases `mu`, then calls
`Ctl.Set`. Two callers (a terminal agent-session change from `main.go:391` and a `SetAgentAware`
click, or two session changes) interleave: caller A reads count 1, caller B sets count 0 and
calls `Set(false)`, caller A then calls `Set(true)`. The Mac stays awake with no agent running
until the next session change.

Fix: hold one mutex across the settings read, the count read and `Ctl.Set` (a `recomputeMu`, or
widen `mu` to cover the whole body; `Ctl.Set` is not re-entrant into this service).

### F15 (low) `TerminalService.Shutdown` is Wails-bound

`SI/bridge/terminal.go` embeds `*terminal.BoundService`; Wails binds every exported method of the
registered type, promoted ones included (the type's own doc comment, `internal/terminal/bound.go:
10-15`). `BoundService.Shutdown` (`bound.go:33-36`) is main.go's teardown hook, not a binding.
Any window can call it and close every terminal session in every window. Same shape that
`startIfEnabled`/`StartDbMcpIfEnabled` already avoids for `DbMcpService`.

Fix: replace the method with a package function `terminal.ShutdownBound(b *BoundService)` (or an
unexported method plus a package-level wrapper), and call that from `main.go`. `internal/terminal`
is Part 8 (same stream, editable). Kira Space embeds the same type:
`needs-other-part-file: apps/kira-space/main.go (Stream B)` only if its teardown call must change
name too.

### F16 (low) Mask-rule and custom-script bridges label DB failures `E_BAD_REQUEST`

`SI/bridge/maskrules.go:66-69,90-92`, `SI/bridge/customscripts.go` (`Create`, `Update`, `Remove`).
Every error from `maskrules.Service.Upsert`/`Remove` and `CustomScriptsRepo` becomes
`ipcerr.BadRequest(err.Error())`, including SQLite failures. `MaskRulesService.List`, `Counts`,
`CorrelationKey` and `RegenerateKey` return raw errors (the renderer's `unwrap` falls back to
`E_INTERNAL`, so those work). Scenario: the DB is locked or the disk is full; the Privacy tab shows
the SQLite text as if the user had entered an invalid rule.

Fix: return typed validation errors from `maskrules.Service.Upsert` (invalid kind, empty column)
and the custom-scripts repo validator, map only those to `BadRequest`, everything else to
`ipcerr.InternalErr`. Wrap the four raw returns in `ipcerr.InternalErr`/`InternalResult` for
consistency.

## Coverage

- Block 1 (auth and install): done. Reviewed `SI/mcpauth/token.go`, `SI/mcpinstall/install.go`,
  `SI/mcpinstall/exec.go`, `SI/bridge/dbmcp.go`, `SI/bridge/embedded.go`, `SI/dbmcp/server.go`,
  `SI/dbmcp/http.go`, `SD/dbmcp.ts` (stale comment only; wire parity in block 3), plus
  `internal/tokenauth` (callee). Plan §9 verdicts:
  - #1 confirmed (F1).
  - #5 dropped: go-sdk v1.8.0 applies `DefaultMaxRequestBodyBytes` (4 MiB) through
    `http.MaxBytesReader` when `MaxRequestBodyBytes` is 0 (`mcp/streamable.go:222-224,336-338`),
    and answers 413. DNS rebinding: the SDK rejects a non-loopback `Host` on a loopback listener
    by default (`streamable.go:317-325`); `CrossOriginProtection` covers browser `Origin`.
  - #6 confirmed, folded into F4. Token alphabet is base64url (`tokenauth.Mint`), so the helper's
    `printf` format never sees `%` or `"`.
  - #8 by design (see F3), folded.
  - #12 confirmed (F2).
  - Token pair writes: `remintDbMcpToken` and `Regenerate` write record then helper. A crash
    between leaves a mismatch; next start's `helperTokenMatchesRecord` remints both. Self-heals,
    no finding. `Regenerate` failing after `Save` leaves the live server on the old record and
    the helper on the old plaintext: consistent until restart, then remint. No finding.
  - `Check` hashes before expiry; `TokenVerifier` reads under `tokenMu`; `SetToken` races are
    safe. `atomicWrite0600` removes its temp file on every failure path (`defer os.Remove`).
- Block 2 (tools and gates): done. Reviewed `SI/dbmcp/{access,permissions,tools,explain,
  approval}.go`, `SI/queryplan/statements.go`; read `adapters/classify.go` (Part 3) and
  `adapters/sqs/adapter.go` (Part 4) for reachability.
  - Every tool calls `resolveEnabled` before any backend touch. Only `run_query` and
    `explain_query` call `connectForQuery`; schema tools on a disconnected connection go to
    `tree.Service`, which does not connect. `listConnections` alone is ungated by read mode, by
    design (M7 #8).
  - Gate order matches M3 §5.2/§4.3. `explainQuery`: resolve, kind, explainable, read deny,
    connect, assert composed reads, verdict, one approval with re-resolve (P108 F6 holds), mask
    set, execute. No dialect composes `ANALYZE`. `Explainable` and TS `isExplainable` match
    (only difference: Go RE2 `\s` and `TrimLeft` are ASCII, JS is Unicode; Go is stricter, never
    looser). Postgres `WITH d AS (DELETE ...) SELECT` is explainable without execution, and
    `ClassifySQL` scans the whole `WITH` body, so `run_query` still classifies it as write.
  - `maybeExplain` runs the EXPLAIN before a read-prompt approval: M3 design (heavy check needs
    the plan), and EXPLAIN is a read. No finding.
  - Plan §9 #9 dropped: `planFor` errors on a masked connection reach only the local log;
    `explainQuery` returns `maskedToolError` for execute errors and a generic parse error when
    masked. `assertComposedStatementsAreReads` errors carry class names, no values.
  - Approval comment `approval.go:102-104` ("a disconnected client stops the query") is false
    in practice; covered by F2.
  - Part 4 F8: reachable, F8 above. Part 4 F15: not reachable through dbmcp. `sqs` `Execute`
    returns `NoQueryConsole` (`sqs/adapter.go:239-241`); `Children` calls `ListQueues` only;
    `Describe`/`SchemaColumns` return `E_UNSUPPORTED`. No path reaches `ReceiveMessage`.
- Block 3 (masking): done. Reviewed `SI/mask/mask.go`, `SI/maskrules/service.go`,
  `SI/bridge/maskrules.go`, `SI/dbmcp/render.go`, `SD/mask.ts`, `SD/dbmcp.ts` against
  `bridge/dbmcp.go`'s wire structs.
  - `Stricter`/`KIND_STRICTNESS` identical; Go ranks unknown kinds as redact, TS rejects them via
    zod. HMAC input, Crockford alphabet, 6-char tag, number buckets, `pow10String`, empty-string
    identity and `MaskNullable` NULL pass-through match line for line.
  - Every rule write goes through `maskrules.Service` and broadcasts `ChannelMaskRulesChanged`.
    The one other writer, `connections.Duplicate`'s `CopyForConnection`, writes to a fresh id and
    enables MCP only after the copy, so no stale cache entry can exist for it.
  - `render.go` reads stream `Body` through `cellAt` (Part 5 F4 null body): handled, no finding.
  - Masked-error withholding, document/stream refusal, columnless keyvalue refusal, risky type
    classes and risky syntax all hold. A filter-predicate oracle (`SELECT email FROM c WHERE email
    LIKE 'a%'`) is adversarial probing, outside the documented threat model; not reported.
  - Plan §9 #2 confirmed by reading (F10), #10 confirmed (F11).
- Block 4 (bridge services): done. Reviewed every remaining `SI/bridge/*.go` (`collections`,
  `http`, `grpc`, `variables`, `files`, `connections`, `tree`, `ops`, `events`, `stream`,
  `queries`, `schema`, `datagrip`, `customscripts`, `settings`, `layout`, `tabs`, `windows`,
  `terminal`, `keepawake`, `update`, `lifecycle`, `app`, `apidata`, `filters`,
  `responsehistory`, `grpchistory`), `SI/appcore/deps.go`, `SI/appshell/{menu,dialogs,stream}.go`;
  read `httpclient/cookies.go`, `internal/terminal/bound.go`, `internal/windowsvc`,
  `apivars/reveal.go`, `adapterhost` `Router.Cancel`/`Host.CancelOp` as callees.
  - Routed Part 10 F6: confirmed, F13. Routed Part 10 F18: exact delete infeasible over
    `cookiejar` (DESIGN-DECISION), and the current delete is broken for path/domain cookies,
    F12.
  - `OpsService.Cancel` with `context.Background()`: `Router.Cancel` goes straight to
    `Host.CancelOp`, which bounds the adapter call with `disconnectTimeout` (Part 5 F1 holds).
  - Plan §9 #11 dropped: `op_log` is capped at `hardCapRows` by `OpsRepo.Prune`, so an
    unbounded `limit` reads at most that many rows.
  - Plan §9 #7 dropped under the trust model: `Import`/`Export` paths come from the first-party
    renderer; `Export` resolves symlinks, mirrors the target mode and writes atomically
    (`writeFileAtomically`); `Import` only parses. Same for `DataGripService.Scan`/`Import`.
  - Secret reveal (`VariablesService.Reveal`/`RevealHistory`, `ConnectionsService.Reveal`) goes
    through `localauth.Gated` in the callee. HTTP/gRPC secret masking covers every copyable hop
    (`maskSecrets`, `maskSendErrTimeline`, `maskGrpcError`, `maskGrpcResult`); streamed gRPC
    message bodies stay unmasked (documented open item, P108 F16).
  - `appcore.Deps` copy order and post-detach emits: checked in block 5 with `main.go`.
