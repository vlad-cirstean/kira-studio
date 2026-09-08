// Package gitrpc is the server half of the git wire contract (SPEC §2: "Port of rpcHandlers.ts,
// minus the seven host-capability methods the extension now answers locally"). G1 serves exactly
// three of them (D12) — app.init, repo.open, repo.close — with a uniform E_UNKNOWN_METHOD default
// for everything else, rather than 30 placeholder entries later phases would each have to revisit.
package gitrpc

// ContractVersion is the sole compatibility authority (SPEC §3.4, D20) — a structural copy of
// packages/git-ipc/src/validate.ts:7's CONTRACT_VERSION, kept honest by both sides reading the
// same upstream source rather than by codegen (a single integer does not justify one). A mismatch
// in gitsock's handshake is a hard, loud stop, not a silent drop.
// G7 D2: 15 -> 16, for exactly three additions — credential.request (a new event), credential.
// provide (a new request), and remote.pullPreflight's own optional strategySetting param.
// G10 D9: 16 -> 17, for one new event, ui.action — the palette's route into an already-mounted
// webview. This constant moves only because it is the single compatibility authority (SPEC §3.4):
// ui.action is a JSON control frame on the extension<->webview channel and never crosses the
// socket, so the Go server neither emits nor parses it.
const ContractVersion = 17

// Protocol is the handshake envelope's own version (SPEC §3.3's "protocol":1), distinct from
// ContractVersion — it never changes unless the hello/ready exchange itself is redesigned.
const Protocol = 1
