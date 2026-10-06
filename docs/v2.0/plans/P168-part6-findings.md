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
