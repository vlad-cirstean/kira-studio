# P108 Part 17 — remaining findings (review round against `bc365eb`)

Reviewer pass over `P108-part17-space-git-rpc.md` §1 file set, current tree `bc365eb`. F1-F9 are
already fixed and committed (F2 `f951ced`, F3 `cac7093`, F4-F6 `37767d3`, F7 `0719492`, F8
`7bc7998`, F9 `bc365eb`). Numbering continues from F10. Fixer: one commit per finding.

Status: review complete. Five findings, F10-F14: F10 Medium, F11 Low-Medium, F12-F14 Low. All
five are handshake/pairing lifecycle bugs; the RPC method surface itself turned up nothing.

## F10 — transient trust-store error discards a valid token (Medium)

`apps/kira-space/internal/gitsock/handshake.go:197-205`, consumed at `:100-113`.

Bug: `verifyClientToken` logs a `store.ByID` error, then falls through to `!found` and returns
false. `runHandshake` answers that with `tokenRejected` (row 5). The extension's
`apps/kira-space-vscode/src/connection.ts:400-406` treats `tokenRejected` as authoritative. It
deletes `TOKEN_SECRET_KEY` from secret storage and redials tokenless. The user sees a fresh pairing
prompt for an editor that is still trusted.

Reachable: any SQLite error on the read (busy/locked under a concurrent write, I/O error, closed DB
during shutdown) during a normal reconnect. One transient failure permanently loses the token.

Fix: make `verifyClientToken` tri-state (ok / rejected / lookup failed). On lookup failure, close
without any frame, the row-1 posture. The extension then takes its ordinary backoff-reconnect path
and keeps its stored token. Keep the dummy `verifyToken` call on the lookup-failed path too, so
timing stays uniform (D6).

## F11 — Broker shutdown and queue overflow answer a terminal "denied" (Low-Medium)

`apps/kira-space/internal/gitsock/pairing.go:151-153` (closed), `:159-161` (queue cap),
`:337-351` (`Shutdown` resolves every queued entry `PairingDenied`); mapped at
`handshake.go:147-149` to `pairingDenied{reason:"denied"}`.

Bug: these three paths are not a user decision, yet they send the same frame as a user Deny. In
`connection.ts:408-414` `pairingDenied` sets the terminal `denied` state. `#onDisconnected`
(`connection.ts:452`) never reconnects from `denied`; only a manual `retry()` clears it.

Reachable: user quits or restarts Kira Space while a pairing request is pending, or 200 requests
are already queued. The editor then never reconnects to the restarted Kira Space until the user
finds and presses retry. No cooldown was set, so the "denied" label is also wrong for the user.

Fix: add a distinct `PairingAborted` outcome for `closed`, queue overflow and `Shutdown`. In
`runHandshake`, answer it by closing without a frame (row-1 posture), so the client backs off and
redials. The `InCooldown` short-circuit at `:155-157` stays `PairingDenied`; it is a real Deny's
cooldown.

## F12 — disconnected pairing requester stays queued and can still be approved (Low)

`apps/kira-space/internal/gitsock/handshake.go:124-146`, `pairing.go:176-192`.

Bug: after `pairingRequired` is sent, the handshake goroutine blocks on `<-entry.result` for up to
`pairingTimeout` (120s) without watching the socket. If the editor disconnects (window closed,
extension reload), the entry stays in the queue and the pairing dialog keeps presenting it. If the
user approves, `Broker.answer` mints a token. `finishPairing` then runs `UpsertOnPair` before its
`paired` send fails. The result is a trusted `git_clients` row whose token nobody holds. It shows
in Connected editors as a live pairing. The goroutine and fd are held until resolution.

Reachable: close the VS Code window while the Kira Space pairing dialog is open, then click Approve.

Fix: detect disconnect during the wait and cancel the entry. Add `Broker.Cancel(requestID)` that
removes the entry and resolves it with a no-frame outcome (the F11 `PairingAborted`). Have a
goroutine block on a 1-byte `Peek` of the conn's reader; a read error calls `Cancel`. Once an
outcome arrives, set a past read deadline to unblock the `Peek`, wait for it, then clear the
deadline before handing the reader to `Serve`. Peeking does not consume, so no bytes are lost.

## F13 — handshake has no read deadline (Low)

`apps/kira-space/internal/gitsock/handshake.go:72`, `frame.go:51-58`.

Bug: the first `c.Receive()` blocks with no deadline. `readFrame` allocates the declared body
(up to the 8 MiB cap) before reading it. A same-user local process can connect, send nothing, or
declare 8 MiB and trickle bytes. Each such conn holds a goroutine, an fd and up to 8 MiB until
`Server.Close`. `hello.Client.ID` is also unclamped (only the label is clamped), so it can reach
the `git_clients` row and the pairing dialog at up to 8 MiB.

Reachable: the socket is 0600, so same-user only. A crashed or buggy client that connects but never
sends hello also leaks this way.

Fix: `SetReadDeadline(now+10s)` before the hello `Receive`, and clear it (zero time) before
`Serve`. Reject a `hello.Client.ID` over a fixed bound (for example 256 bytes) as row 1.

## F14 — tokenRejected races the server's close and double-dials (Low)

`apps/kira-space-vscode/src/connection.ts:400-406`, with `#onDisconnected` `:433-455` and
`#scheduleReconnect` `:457-463`. One-hop caller (plan §2); it is the client half of the handshake.

Bug: `runHandshake` returns right after sending `tokenRejected`, and `handleConn`'s deferred
`nc.Close()` (`server.go:202`) closes the socket. The extension handler awaits
`secrets.delete(...)` first. The socket `close` event lands during that await. `#onDisconnected`
still sees the current `dialToken`, so it sets `connecting` and arms a 500 ms backoff timer. The
`await` then resolves, `dialToken === this.#dialToken` still holds, and `void this.#dial()` runs
immediately. The timer later fires a second `#dial()`, which destroys the first dial's socket. That
socket is already waiting in the pairing queue, so the server keeps a dead entry (F12) beside the
new one. The dialog shows "1 of 2". `#backoffMs` is also doubled for no real failure.

Reachable: every revocation. `Revoke` closes the live conn, the extension reconnects with its stale
token, the server answers `tokenRejected`, and the secret-store IPC round trip is far slower than
the local socket close.

Fix: in the `tokenRejected` branch, set `this.#disconnectHandledFor = dialToken` synchronously,
before the `await`, so the close event is inert. Also clear `#reconnectTimer` at the top of
`#dial()`, so any dial supersedes a pending timer.

## Areas with nothing found

- **§4.1 method-table and version parity.** Mechanical diff of Go `requestHandlers` against
  `validate.ts` `REQUEST_KEY_MAP`/`EVENT_KEY_MAP`/`STREAM_KEY_MAP`. There are no Go-only methods.
  The 15 TS-only request keys are all host-answered (`proxyHandlers.ts`, PF `hostHandlers.ts`)
  and never forwarded. All 6 Go-emitted events are TS `EventKey`s. `graph.stream` matches.
  `ContractVersion` 40 and `Protocol` 1 match on both sides.
- **§4.2 params parity.** Go `requireNonEmpty` checks only `repoId`/`requestId`. Neither is
  TS-optional. Enum fields (`mode` on checkout/reset/worktreeAdd/review.fileDiff, stash `scope`,
  `repoSettings` enums through storage validation) are checked against the TS literal sets.
  `limit`/`pageSize`/`pages` at ≤0 fall back to defaults. Comment ranges are bounded by
  `1 <= start <= end`, ids by `> 0`, and bodies by 8 KiB. No mismatch found.
- **§4.3 error-shape parity.** No TS consumer branches on a server `E_*` code. git-ui/vscode switch
  only on `TransportError.code === 'cancelled'`. `mapGitError` yields `E_GIT_<KIND>`. Other errors
  cross as `E_INTERNAL` with `err.Error()`. That string can carry local paths, but only to the
  same-user, paired client that already names those paths. Not a leak.
- **§4.4 argv injection.** Swept every handler, not just Part 16 F1's four. Ref/sha fields go
  through `validRefArg`/`validObjectID`. Array elements (`preflight.revert` `shas`, review base
  candidates, pathspec lists) are checked per element. Optional pointers are checked when present.
  Pathspecs reach git after `--` in gitsession, and repo-relative paths go through the
  escapes-root check. No bare-argv path found.
- **§4.5 socket server lifecycle.** `Start` flock, unlink, listen and chmod 0600 ordering;
  `acceptLoop`/`trackConn` against `Close`; double `Close`; `Revoke` before and after `addConn`
  (F5 recheck present). All correct at `bc365eb`.
- **§4.7 framing.** `frame.go`: 0-length, cap and cap+1 handled; single `Write` under the mutex.
  `socketChannel.ts`: drain loop, the 64-frame pending cap, and destroy-on-delivery-throw are
  correct. Close handlers fire twice (`error` then `close`), but `connection.ts`
  `#disconnectHandledFor` makes that inert. `streamChannel.ts`: the P67b connect queue preserves
  order, a `closed` phase drops posts, and decode and delivery share one try/catch. The blob frame
  (`blobFrame.ts`) bounds-checks the header length and requires exactly one marker. `codec.ts` and
  `graphChunkCodec.ts` decode from a trusted peer, with exact-size column copies and a checked
  identifier and payload type. The Go `commitsBlob` literal matches the TS `$fb` tag.
- **§4.8 streaming.** `createRpcServer` credit gate, cancel (abort, then drop gate and work),
  shared `aborted` promise, and `end` on error/abort are correct. Client supersede via
  `openStreamIdByMethod` settles the older stream (F2/F3, fixed).
- **§4.9 mailboxes.** `repoSettings.changed` per-conn queue cap 8 drop-oldest, teardown on
  disconnect, and emit into a closed session are correct.
- **§4.10 gitvsix.** The VSIX path is absolute, derived from the executable, never client-supplied,
  so it cannot be flag-like. 60 s timeout. `toolexec` bounds the stderr detail.

## P111 overlap (named only)

`remote.pullPreflight` `strategySetting` and `remote.run` `strategy` (`gitrpc/remote.go:35-39`,
passed to `gitsession.RemoteOpParams.Strategy`) are not validated against the TS literal set at the
gitrpc layer. P111 owns the pull-strategy wire change and this fix. It is not numbered here.
