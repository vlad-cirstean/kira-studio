# P168 Part 8 findings: shared Go base and repo tooling

Plan: `P168-part8-go-base.md`. Base `af3bd8c`; HEAD reviewed `b421550` (plan commit on `820d476`).
Reviewer reports only. Fixer rules: plan §8.

## Findings

### Block 1: listeners and RPC

#### F1 (low, routed Part 14 F4): `localsock.Serve` `wg.Add` races `Close`'s `wg.Wait`

- `internal/localsock/localsock.go:85-97,102-109`.
- `Serve` calls `wg.Add(1)` after `Accept` returns. `Close` closes the listener, then `Wait`s. A conn
  accepted just before `Close` reaches `Add` after `Wait` saw zero.
- Confirmed by scratch probe (deleted): 200 Listen/Serve/Close cycles with a dial loop under
  `-race`. Result: `WARNING: DATA RACE`, and 2 handlers still running after `Close` returned (and
  after `RemoveAll(Dir)`). Real caller: `PI/gitaskpass/broker.go` at app shutdown.
- `agenthooks` checked on its own terms: it serves via `http.Server.Serve`, not `localsock.Serve`.
  `Server.Close` calls `http.Server.Shutdown` (closes the listener, waits for active handlers up to
  5 s), then `RemoveAll`. Not affected. Only the 5 s timeout path falls back to `http.Server.Close`
  without waiting; a handler blocked there is mid-body-read and fails without calling `onEvent`.
  Nothing filed for `agenthooks`.
- Fix: per routed note. One mutex guards a `closed` flag and `Add`. `Serve` checks `closed` under
  the lock; a conn accepted after `closed` is closed without a handler. `Close` sets `closed` under
  the lock before `Wait`. Add a `-race` test (dial loop while `Close`; assert no handler runs after
  `Close` returns). Signatures unchanged; `gitaskpass` needs no edit.

#### F2 (low, routed Part 17 F2): dead `wireError.Kind`

- `internal/rpcstream/frame.go:11-19`.
- `wireErrorFrom` never sets `Kind`. TS `WireError`/`RpcError` (`packages/git-ipc/src/rpc.ts:49-65`)
  no longer carry `kind` (Part 17 fixer). No Go reader (`git grep`).
- Codes checked against `WireErrorCode` (`contract.ts:1040-1052`): every code `rpcstream`
  (`E_INTERNAL`, `E_BAD_REQUEST`, `E_FRAME_TOO_LARGE`) and `gitrpc`/`gitsock` emit is listed.
  Nothing to route.
- Fix: delete `Kind` and rewrite the struct comment ("mirrors rpc.ts WireError: code and message").

#### F3 (low): `localsock.Listen` accepts `TokenBytes <= 0`, giving an empty token that `agenthooks` accepts

- `internal/localsock/localsock.go:70`, `internal/localsock/localsock.go:112-118`;
  `internal/agenthooks/http.go:54`.
- `RandHex(0)` returns `""` with no error (probe: `token0=""`). `agenthooks.handleHook` compares
  `bearerToken(r)` (`""` for a missing header) with `ln.Token` via `ConstantTimeCompare`, which
  returns 1 for two empty slices. So a listener built with `TokenBytes: 0` authenticates every
  request with no `Authorization` header. Both callers pass 32 today: latent, but the guard sits on
  the package whose whole job is this security boundary.
- Fix: `Listen` returns an error when `opts.TokenBytes < 16`. No caller change.

Block 1 other checks, nothing filed:
- Candidate 1 (`creditGate` dead waiter) dropped. Each stream owns its gate (`session.go:316`), and
  `acquire` is only cancelled by that stream's own ctx. Once cancelled, every later `acquire` with
  no credit returns `ctx.Err()`. No live waiter can queue behind a dead one.
- Candidate 10 (`wireErrorFrom` raw message) dropped. Both peers are the same user's authenticated
  local clients (paired `gitsock` client, own renderer). `gitrpc` maps git failures through
  `mapGitError` first; a path in an `E_INTERNAL` message crosses no trust boundary.
- `localsock`: socket created inside a 0700 mkdtemp dir before `Chmod`, so the umask window is not
  reachable. macOS `sun_path`: `$TMPDIR` (~49 bytes) + prefix + 10 digits + `/s` stays under 104.
  Second `Close` returns the net "use of closed" error; harmless.
- `agenthooks`: `buildShim`/`shellSingleQuote` refuse `"`/`'`/newline; token and terminal id reach
  curl only through env expansion inside double quotes. `X-Kira-Terminal` trusted as given: only a
  token holder (a `claude` child the user launched) can post; attributing to another terminal is
  within that trust. `Manager` start/stop under one mutex; double `Start` no-op.
- `tokenauth`: fixed-length salt makes `salt||tok` unambiguous; `Verify` compares on decode failure.
- `rpcstream` session: `Emit`/`send` after `close` return via `done`; duplicate id refused; unknown
  cancel no-op; identity-keyed cleanup (P108 Part 2 F8) holds.

## Coverage

- Block 1 (listeners and RPC): done. Read in full: `localsock/localsock.go`, `agenthooks/{agenthooks,
  http,manager,config,shim}.go`, `tokenauth/tokenauth.go`, `rpcstream/{frame,credit,session}.go`.
  Tests deferred to block 8.
