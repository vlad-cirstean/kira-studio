# P108 Part 17 — remaining findings (review round against `bc365eb`)

Reviewer pass over `P108-part17-space-git-rpc.md` §1 file set, current tree `bc365eb`. F1-F9 are
already fixed and committed (F2 `f951ced`, F3 `cac7093`, F4-F6 `37767d3`, F7 `0719492`, F8
`7bc7998`, F9 `bc365eb`). Numbering continues from F10. Fixer: one commit per finding.

Status: IN PROGRESS — Go side done; TS framing/codec half (`socketChannel.ts`, `streamChannel.ts`,
`blobFrame.ts`, `codec.ts`, `graphChunkCodec.ts`, `rpc.ts` server half) still under review.

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
