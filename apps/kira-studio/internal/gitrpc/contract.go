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
// G11 D1: 17 -> 18, for three new requests (review.files, review.fileDiff, review.mark) and one
// new UiActionKind member (toggleFileReviewed) — no event, no stream, no change to any existing
// request's params or result.
// G12 D1: 18 -> 19, for one new request, editor.openRangeDiff — the review sidebar's two-revision
// diff, answered entirely inside the extension. This constant moves for the same reason ui.action
// did (G10 D9): it is the sole compatibility authority, even though the Go server neither emits
// nor parses this method.
// G13 D1: 19 -> 20, for five new requests (review.comment.add/list/remove/clear/export),
// editor.openRangeDiff's params reshaped (D8: both sides sha-addressed, the right-hand document
// carries the review branch — extension-answered, but this constant is still the sole
// compatibility authority, same precedent as G10/G12) and two new UiActionKind members
// (copyReviewComments, refreshReviewComments).
// G14 D6/D10: 20 -> 21, one bump for two reasons landing in the same phase — SettingsSnapshot's
// host-owned 'workbench.tree.indent' member (D6) and ui.action's optional 'target' plus the new
// 'revealCommit' UiActionKind member (D10). This constant moves for the same reason ui.action
// first did (G10 D9): it is the sole compatibility authority, even though the Go server neither
// emits nor parses either addition — both are extension<->webview only.
// G18 D5: 21 -> 22, for three new requests (repoSettings.get/set, settings.setGitPath) and one
// new event (repoSettings.changed) — seven kiraVersion.* settings move out of
// contributes.configuration into their own per-repo store (D1/D3/D4); SettingsSnapshot narrows to
// its one remaining member (workbench.tree.indent) and a new RepoSettingsSnapshot carries the
// seven moved keys.
// G19 D11b (2026-09-08): 22 -> 23, for two new requests (review.session.save/.load) — the review
// sidebar's durable "back to branch selection" resume point (F11/D11a/D11b), stored in the
// extension's own context.workspaceState and never reaching this server. This constant moves for
// the same reason ui.action first did (G10 D9): it is the sole compatibility authority, even
// though the Go server neither emits nor parses either addition.
// G21 D8/D12/D13 (2026-09-08): 23 -> 24, one bump for three additive changes landing across that
// phase's own commits — one new request, editor.openAllChanges (D8, the "Open all changes"
// multi-file diff), and two optional params, editor.openDiff's pinned/fallbackSha (D13/D12) and
// editor.openRangeDiff's own pinned (D13). This constant moves for the same reason ui.action
// first did (G10 D9): it is the sole compatibility authority, even though the Go server neither
// emits nor parses any of the three — every 'editor.*' request is answered entirely inside the
// extension, the same precedent editor.openRangeDiff itself set at G12 D1.
// G22 D10 (2026-09-09): 24 -> 25, for two new UiActionKind members (resetSelected,
// cherryPickSelected) — the palette's own route into ResetDialog.vue/CherryPickDialog.vue, neither
// of which had one. This is the only wire change this phase makes: every result/param/error shape
// preflight.reset/preflight.cherryPick/op.run's reset/cherryPick kinds serve already existed at
// CONTRACT_VERSION 24. This constant moves for the same reason ui.action first did (G10 D9): it is
// the sole compatibility authority, even though the Go server neither emits nor parses ui.action.
// G23 D6/D13 (2026-09-09): 25 -> 26, for one new SearchRunResult member, unsupportedPattern — a
// `regex`-mode pattern using lookahead/lookbehind/a backreference, syntax the Go tail scan's RE2
// engine cannot run at all (SPEC's own "a hit's presence must not depend on which page happens to
// be loaded", docs/v1.3/SPEC.md:446-450). Unlike most of this constant's history, this bump also
// lands the first real Go implementation of the method it accompanies (search.run) rather than
// only the wire shape for an extension-answered method.
// G24 D14 (2026-09-09): 26 -> 27, for two new Go-served requests (commit.resolvePr,
// branch.resolvePr), four new wire types (GhStatus, PrRecord, PrLookupResult, and the state string
// union it carries) and one new RepoSettingsSnapshot member (kiraVersion.github.enabled). Every
// addition is additive; SearchMatchField/CommitSearchHit/internal/gitsearch are untouched (F9 —
// the wire's own search-field union is commits-only, the PR fields live entirely in git-core's
// client-side SearchField instead).
const ContractVersion = 27

// Protocol is the handshake envelope's own version (SPEC §3.3's "protocol":1), distinct from
// ContractVersion — it never changes unless the hello/ready exchange itself is redesigned.
const Protocol = 1
