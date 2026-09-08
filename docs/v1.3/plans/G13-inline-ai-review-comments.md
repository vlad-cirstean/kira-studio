# G13 — Inline AI review comments: a flat annotation table, an anchored projection, and one plain-text export

> **What this phase is.** The thirteenth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, the
> third *post-ship* one, and the second in the chapter with **no upstream equivalent at all**
> (`kira-version-vscode` has no P-number for it — same as G11, which it builds directly on). SPEC's
> "Review state (G11/G13)" section is the authoritative design source, and its own words for this
> phase are deliberately minimal: *"a flat table of `(session, file, line range, text, created_at)`,
> rendered as an ordered plain-text list for the user to paste into an AI conversation by hand. No
> AI API call, no response ingestion, no threading in v1.3 — but the backend shape is a real
> structured list precisely so a later phase can wire it to an actual call without a rework."* This
> plan is the *how*.
>
> **In one line: `internal/gitreview` gains a second migration (`0002_g13_comments.sql`) holding a
> flat `review_comment` table that cascades from G11's own `review_session` row, plus a pure
> ordering/formatting pair (`export.go`) that renders the AI paste; `gitsession` gains
> `comments.go`, which anchors every comment to the exact revision the reviewer was reading and
> projects it forward with G11's already-tested `ProjectRanges`; `gitrpc` serves five
> `review.comment.*` methods and goes to `ContractVersion` 20; the **add** gesture lives in VS
> Code's own Comments API — the gutter "+" in the diff G12 moved there — and the **list**,
> **copy-for-AI** and **clear-all** live in a third pane of the review sidebar beside Commits and
> Files.**
>
> **Four things are called out rather than smuggled in.** (1) The comment-adding UI lives in **VS
> Code, not the webview** (D9) — the central design question this phase's prompt names, answered
> concretely, with the G14 boundary drawn in D20. (2) `editor.openRangeDiff` is **reshaped**
> (D8): both sides of a review diff become sha-addressed and the right-hand document carries the
> review branch, which is what makes an anchored comment exact — it also fixes two real defects
> G12 shipped (F6, F7). That is a change to a method a *previous* phase owns, and §11.1 flags it.
> (3) A comment is anchored in **its own revision's** coordinates and projected on read, never
> rewritten — G11 D10's invariant, applied to a second kind of row (D6/D7). (4) `gitreview` grows
> a fourth pure file, and the AI-prompt formatter is deliberately in **Go**, not TypeScript (D12),
> because that is where a later live-AI phase will call it from.
>
> **Three calls want a human eye before implementation starts — §11.**

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`db555c4b`,
"chore(vscode): Kira Studio's own icon, and a real README"), i.e. on top of everything G1–G12
landed. Every claim below was checked against source read or a command run **in this container**,
never against prose — including G11's and G12's own plans, which are records of intent and are
verified against the code they produced.

| Claim | Evidence |
|---|---|
| `ContractVersion` is **19** (not 18) in three hand-maintained places, after G12's `editor.openRangeDiff` bump | `internal/gitrpc/contract.go:24`, `packages/git-ipc/src/validate.ts:16`, `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93` |
| `internal/gitreview` is now **twelve** files: G6's pure `resolve.go`, plus G11's `db.go`, `migrate.go`, `migrations/`, `store.go`, `snapshot.go`, `ranges.go`, `project.go`, `reaper.go` and three test files | `ls internal/gitreview`; `go test ./…/gitreview/...` green here |
| `review.db`'s schema is exactly three tables — `review_session(id, repo_id, branch, created_at, last_used_at)` with `UNIQUE (repo_id, branch)`, `review_file`, `review_range` — with `ON DELETE CASCADE` from the session down and `_foreign_keys=1` in the DSN | `gitreview/migrations/0001_g11_review.sql`; `gitreview/db.go:28` |
| `migrations/embed.go`'s `names` slice is hand-ordered and its own comment already reserves step 2 for the comment table — under the **pre-renumbering** name (`"g12_comments"`) | `gitreview/migrations/embed.go:21-30` |
| The migration runner refuses a `schema_version` newer than the binary knows, and applies one transaction per step | `gitreview/migrate.go:40-72` |
| `Store` opens lazily (`ensureOpen`), sets `SetMaxOpenConns(1)`, chmods **after** `Ping`, runs one sweep, then starts the hourly reaper; `conn()` is the only way any method reaches the `*sql.DB` | `gitreview/db.go:40-100` |
| The reaper is one bulk `DELETE FROM review_session WHERE last_used_at < ?` plus `PRAGMA incremental_vacuum`; `Purge(ctx, repoID, branch)` is the same statement scoped to one session, exported as G18's seam | `gitreview/reaper.go:22-72` |
| `Touch` bumps `last_used_at` for an **existing** session only and never creates one; only `Put` creates a session row (`upsertSession`) | `gitreview/store.go:245-261`, `:343-355` |
| `LineRange{Start, End}` is 1-based inclusive and is *both* the storage type and the wire type; `Normalize`/`Union`/`Subtract`/`Expand`/`CountLines` are pure | `gitreview/ranges.go` |
| `ProjectRanges(ranges, hunks, newLineCount)` maps old-side line numbers forward, drops ranges whose lines were all deleted (returns `nil`), and clamps to `newLineCount` | `gitreview/project.go:16-29`, `:112-128`; `project_test.go`'s "range containing only deleted lines drops out entirely" and "a range entirely past newLineCount is dropped" |
| `RepoEntry` already owns everything an anchored comment needs: `branchTip` (cached refs snapshot), `blobOID(rev, path)` (`cat-file --batch-check`, `""` for a missing path), `readSnapshotSource` (kind/content/line count), `parseAndResolve`, `runOne`/`runAllowingExit` | `gitsession/incremental.go:106-250` |
| `porcelain.IsAncestorArgs` and `FileDiffArgs(from *string, to, path, originalPath)` already exist and already take arbitrary revisions | used at `gitsession/incremental.go:280`, `:286` |
| `gitrpc` review handlers are thin dispatch — decode, `validRefArg`, `entryFor`, one `RepoEntry` call, marshal with a `MaxResultBytes` guard — and `mapDetailError` is the one place `gitsession`'s sentinels become `E_BAD_REQUEST` | `gitrpc/incremental.go`; `gitrpc/detail.go:17-34` |
| G12 moved every review diff into VS Code: `ReviewFilesPane.vue` renders a `FileTree`, a two-button mode toggle and a status line — **no `DiffView`, no line cursor, no selection** | `ReviewFilesPane.vue` in full |
| `ReviewFilesState.#openInEditor` composes `editor.openRangeDiff` from `{repoId, base, branch, path, originalPath?, status}`; `base` is the *review base*, and `sinceReview` swaps it for `reviewedAtSha` | `state/reviewFiles.ts:142-161` |
| `ReviewFilesState` **discards** `review.files`' `branchTip` and `mergeBase` — it keeps only `result.files` | `state/reviewFiles.ts:96-102` |
| `proxyHandlers.ts`'s `editor.openRangeDiff` builds both sides with `virtualKey(repoId, <rev>, <path>)`, where the right-hand rev is the **branch name** | `proxyHandlers.ts:187-199` |
| The virtual document URI is `kira-version:/<base64url(repoId\0rev\0path)>/<basename>`, and `parseVirtualKey`/`decodeKey` round-trip it | `virtualKey.ts`; `ports/editorIntegration.ts:39-50`, `:62-80` |
| `VsCodeEditorIntegration` fires **no** `onDidChange` and says why: *"Content is cached by VS Code per URI and never invalidated: a `<rev>:<path>` blob is immutable"* | `ports/editorIntegration.ts:11-13` |
| `ReviewView.vue` owns one panel-level toolbar with a two-button Commits/Files segmented group, one filter box and a Tree/Flat toggle; `ReviewPane = 'commits' \| 'files'` | `ReviewView.vue:463-521`; `state/review.ts:66` |
| `FileTree.vue` already takes two optional G11/G12 props (`reviewStates`, `showToolbar`) and emits `toggleReviewed` | `FileTree.vue:40`, `:44`, `:55`, `:418-430` |
| The palette machinery: `OTHER_COMMANDS` (six entries), `otherCommandHandlers: Record<OtherCommandId, () => void>`, `extension.ts:239-241`'s data-driven registration, `reviewView.ts`'s `runUiAction` | `commands.ts:125-134`; `extension.ts:217-241`; `reviewView.ts`'s `runUiAction` |
| `commands.test.ts` cross-checks `ALL_COMMANDS` against `package.json#contributes.commands` **in both directions**, and asserts the shared `CATEGORY` | `commands.test.ts:1-19` |
| `MutatingEntry`'s `pending` labels are `'G13' \| 'G14'` and mean *stash* and *reset/cherry-pick* — the pre-insertion numbering, which SPEC now calls **G15/G16** | `commands.ts:38-44` and SPEC's phasing table rows G15/G16 |
| The webview's own confirmation idiom is an inline two-step button, not a modal — `BranchPicker.vue`'s `confirmForceDelete` | `BranchPicker.vue:175`, `:282` |
| `gitsock`'s integration harness (`newIntegrationServer`, `newIntegrationServerWithRunner`, `pairAndReady`, `openRepoOK`, `requestOK`, `unmarshalResult`) and `gitsession`'s own fixture helpers (`incFixtureEnv`, `runInc`, `commitInc`, `newIncrementalTestEntry`) are reusable as-is | `gitsock/integration_test.go`, `gitsock/graphstream_test.go:156`, `gitsock/detail_test.go:188`, `gitsession/incremental_test.go:16-70` |
| `go build ./apps/kira-studio/internal/...` is green here; `go test ./…/gitreview/...` is green here; git is **2.43.0** | run here |

**Probes, run in this container.** These decide code paths; the implementer should extend them, not
re-derive them.

| # | Question | Observed |
|---|---|---|
| **P1** | Does SQLite reuse a deleted row's id without `AUTOINCREMENT`? (`modernc.org/sqlite`, the driver this app uses) | **Yes.** `INTEGER PRIMARY KEY`: insert a/b, delete b (id 2), insert c ⇒ **c gets id 2**. `INTEGER PRIMARY KEY AUTOINCREMENT`: the same sequence ⇒ **c gets id 3**. Reuse is real, and a client holding a stale id would delete a *different* comment (F10/D3) |
| **P2** | `ProjectRanges` over a range whose lines were all deleted | `nil` — `project_test.go`'s own committed case, re-run here. This is the `removed` anchor state, with no new arithmetic (D7) |
| **P3** | `merge-base --is-ancestor` exit codes, and whether an amended tip survives as an object | **Not re-derived** — G11 probes P1/P2 recorded exactly this (0 = ancestor, 1 = present-but-unreachable, 128 = pruned or missing ref; `--amend` leaves the old tip present, so the common rewrite answers **1**). G13's tier selection reuses those semantics unchanged (D7) |
| **P4** | Baseline health | `go build ./apps/kira-studio/internal/...` exit 0; `go test ./apps/kira-studio/internal/gitreview/...` ok |

### 0.2 Scope

1. `internal/gitreview` — a second migration and a second row family: `comments.go` (the store
   surface) and `export.go` (pure ordering + the AI paste format), plus
   `migrations/0002_g13_comments.sql` and the `names` entry (§3.1, D2–D5, D12, D13).
2. `internal/gitsession` — `comments.go`: the anchor resolution (three tiers reusing G11's own
   helpers), the projection onto a *requested* revision, and the five orchestrations `gitrpc`
   calls (§3.2, D6, D7, D14, D16).
3. `internal/gitrpc` — `comments.go` (five thin handlers), `wire.go`'s param structs, five
   `handlers.go` cases, three new `mapDetailError` arms, **`ContractVersion` 19 → 20** (§3.3, D1,
   D11, D15, D17).
4. `packages/git-ipc` — five request keys, three new types, `REQUEST_KEY_MAP`, two `UiActionKind`
   members, the reshaped `editor.openRangeDiff` params, the version constant (§4.1, D1, D8, D11).
5. `apps/kira-studio-vscode` — `reviewComments.ts` (the `CommentController`, new), `virtualKey.ts`'s
   optional fourth field plus its test, `proxyHandlers.ts` (five forwards, three of them
   re-rendering, and the reshaped `editor.openRangeDiff`), four commands and their manifest
   entries, `extension.ts`'s wiring (§4.2, D8, D9, D19).
6. `packages/git-ui` — the Comments pane: `state/reviewComments.ts` and `ReviewCommentsPane.vue`
   (both new), a third toolbar button and two `ui.action` arms in `ReviewView.vue`, one union
   member in `state/review.ts`, and `state/reviewFiles.ts`'s reshaped `editor.openRangeDiff` call
   (§4.3, D8, D10).
7. Prove it (§7).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G13 work:

- **Range/hunk-level "mark reviewed" in VS Code's diff editor.** **G14**, in full — gutter
  decorations, per-hunk CodeLens, the selection-to-`LineRange` mapping for *marking*, and the
  decoration lifecycle. G13 builds the one thing G14 needs and would otherwise rebuild (the
  stateless "this document is `(repo, branch, path)` at sha X" key, D8) and stops there (D20).
- **Any AI call.** SPEC is explicit: *"No AI API call, no response ingestion."* Nothing in this
  phase opens a network connection, holds a key, or knows a model name. The one seam a later phase
  needs is `gitreview.FormatComments`, which is a pure function (D12).
- **Threading, replies, resolution state, authorship, edit.** SPEC: *"no threading in v1.3"*, and
  its column list is `(session, file, line range, text, created_at)` — no `updated_at`, no author,
  no `resolved_at`. Comments are add/remove/clear only (D5). VS Code's thread objects are used as a
  *rendering*, with `canReply = false` (D9).
- **Comments in the graph panel's commit detail pane.** A comment is a fact about a `(repo, branch)`
  review session; the panel has no such session — G11 D16's own rule, unchanged.
- **A per-file comment-count badge in the Files pane.** Deferred deliberately (D10): `FileTree.vue`
  already carries one optional review prop, and the Comments pane answers "where are my comments"
  without a second one.
- **Splitting `review.fileDiff`'s unused body** — G12 §11 handed the question here, and D21 answers
  it: *no*, and says why.
- **A per-session comment cap, or comment content in the export.** D15 and D12 respectively.
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` in full: **no stubbed error handling, no `TODO: fix later`, no skipped validation.**
  Every degraded state this phase can reach is a *named* value the UI and the export render
  (`CommentAnchor`'s `removed`/`stale` are the sharpest examples), never a silently wrong line
  number.
- **No shell, ever.** This phase adds **no new argv builder at all** — the only git this phase runs
  is `IsAncestorArgs` and `FileDiffArgs`, both already built and already used by G11, through the
  existing `runOne`/`runAllowingExit` helpers.
- **No new dependency, in either language.** `database/sql`, `sort`, `strings`, `time` are stdlib;
  `modernc.org/sqlite` is already a direct require. `vscode.comments` is part of the `vscode` API
  surface the extension already types against (`@types/vscode`, already a devDependency) — not a
  package. `go.mod`, `go.sum` and `bun.lock` are expected to be byte-identical after this phase.
- **Layering.** Everything new stays inside `internal/gitreview` and `internal/gitsession`; neither
  reaches `internal/bridge`, so `TestDomainPackagesDoNotImportBridge` passes with **nothing added to
  `packagesExemptFromBridgeCheck`** — a checklist item (§7.4), not an assumption.
- **Tests only where `AGENTS.md`'s bar is met** (D18). This phase clears it in exactly **one**
  place, and says plainly why everything else gets nothing.
- **Fixture repositories scope their git config to themselves** — `incFixtureEnv()`
  (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `-c commit.gpgsign=false`).
  **Never `git config --global` or `--system`.** Every `review.db` a test opens lives under
  `t.TempDir()`.
- Comments very concise, only where the code cannot say it itself.
- Conventional Commits, granular, each one compiling with its own tests passing (§6).

---

## 1. Findings

### F1 — `review.db` was built for exactly this, and the slot is reserved under the wrong name

G11 built a forward-only migration runner over a hand-ordered `names` slice rather than a bare
`CREATE TABLE IF NOT EXISTS`, and its own comment says why:

```go
// names lists the embedded files in the exact order they must apply, rather than trusting
// directory listing order — G12 adds {2, "g12_comments", "0002_g12_comments.sql"} here, not a
// second table.
```

That comment predates the chapter's mid-stream phase insertions: SPEC's phasing table now assigns
the comment list to **G13**, and G12 was a connectivity/UI-hardening batch that added no migration
at all (`ls gitreview/migrations` still shows one file). So this phase takes step 2 under its own
name — `{2, "g13_comments", "0002_g13_comments.sql"}` — and corrects the stale comment in the same
edit. Nothing else about the runner changes; it already refuses a schema newer than the binary
knows, which is exactly the posture a second step needs (§10).

### F2 — G11's session row is already the right owner, and a comment table inherits its whole lifecycle for free

`review_session` is `UNIQUE (repo_id, branch)` — SPEC's *"keyed by `(repo, branch)`"* made concrete
— and both `review_file` and `review_range` reach it through `ON DELETE CASCADE` with
`_foreign_keys=1` set in the DSN, deliberately: G11 D4 records that the cascade is *load-bearing*,
because `Purge` and the reaper's sweep are each **one** `DELETE FROM review_session`.

A `review_comment` table that also cascades from `review_session` therefore gets, with no new code
at all:

- the **14-day idle TTL** (`reaper.go`'s `IdleTTL`, one bulk delete),
- **G18's eager PR-closed purge**, once it exists to call `Store.Purge` (G11 D20's seam),
- and the *exact* session scope SPEC's clear-all needs — one `(repo_id, branch)` pair, no ambiguity
  about what "a session" is.

This is the single biggest reason G13 is a small phase: its lifecycle question was answered two
phases ago.

### F3 — G11's range machinery is directly reusable, and there must not be a second range concept

`LineRange{Start, End int}` is 1-based inclusive, is the storage type *and* the wire type
(`ranges.go:5-11`, `contract.ts`'s `LineRange`), and `ProjectRanges(ranges, hunks, newLineCount)`
already does the one hard thing a comment anchor needs: map old-side line numbers forward through a
patch, exactly (context lines carry both `OldLine` and `NewLine`; a `del` line has no image), then
normalize and clamp.

Two of its committed behaviours are load-bearing for this phase and are *not* incidental:

- a range whose lines were all deleted projects to `nil` (probe P2) — which is precisely "the lines
  you commented on no longer exist", and needs no new arithmetic to detect;
- a range past `newLineCount` is clamped or dropped — so a comment cannot report a line number the
  current file does not have.

A comment anchored to old-snapshot coordinates therefore needs exactly the same forward projection
a "mark reviewed" range does, and gets it by calling the same tested function. **This phase adds no
range arithmetic whatsoever** (D7/D18).

### F4 — After G12 the webview has no diff, no line cursor and no selection: a webview line-comment gesture would mean rebuilding what G12 deleted

G11 D16 built its range gesture on `DiffView.vue`'s `focusedRow` cursor and shift-click, inside the
review sidebar. G12 D12 removed the diff from that sidebar entirely: `ReviewFilesPane.vue` is now a
`FileTree`, a two-button Since-review/Full-range toggle, a delta status line and an error line —
`DiffView` is not imported, `ReviewDiffAdornment` is gone, and `ReviewView.vue`'s Escape handler
lost its first stage because there is no overlay left to close.

So the webview today can express **"this file"** and nothing finer. Any line- or range-anchored
comment gesture in the webview would have to re-mount `DiffView`, re-add the cursor and the
shift-click selection, and re-render a patch beside VS Code's own diff of the same two revisions —
i.e. undo G12's central decision to have exactly one diff renderer, the editor's. That is not a
close call.

### F5 — The extension can already recover `(repoId, rev, path)` from any open review document, statelessly

`toUri` mints `kira-version:/<base64url(virtualKey(repoId, rev, path))>/<basename>`; `decodeKey` +
`parseVirtualKey` invert it; `virtualKey.test.ts` already guards the round trip. The
`TextDocumentContentProvider` resolves content from exactly those three fields.

So a VS Code-side feature that needs to know "which repository, which revision, which path is this
document?" needs **no registry, no `Map`, no `workspaceState`** — the answer is in the URI, survives
a window reload, and is already tested. That is what makes the add gesture cheap (D9).

### F6 — But the right-hand review document is addressed by a **branch name**, and its content is cached forever

`proxyHandlers.ts:196` builds the right-hand side as `virtualKey(repoId, branch, path)` — `branch`
is a *short branch name*, not a sha. And `ports/editorIntegration.ts` deliberately registers no
`onDidChange`, with the reason stated in its own doc comment: *"Content is cached by VS Code per URI
and never invalidated: a `<rev>:<path>` blob is immutable, so this provider fires no `onDidChange`
and needs no emitter."*

A `<sha>:<path>` blob is immutable. A `<branch>:<path>` blob is not. So while the diff tab stays
open, the reviewer can be reading the branch's content **as of when they first opened it**, while
the server — which resolves the branch tip fresh on every request (`branchTip` off the refs
snapshot) — would anchor anything against a newer tip.

For G12 that was a staleness bug in a *display*. For G13 it would be a **silent mis-anchor**: select
lines 10–12 of what you can see, and have the comment recorded against lines 10–12 of a file whose
content moved underneath you. This phase cannot ship on top of it (D8).

### F7 — And `range` mode compares two dots on a surface whose file list is three dots

`ReviewFilesState.#openInEditor` passes `base` as the left revision in `range` mode, and
`proxyHandlers` diffs `base ↔ branch`. But the file list beside it comes from `review.files`, which
G11 D6/F3 deliberately computes as the **three-dot** set (`diff-tree <mergeBase> <branch>`) — G11
probe P7 recorded exactly why: a two-dot diff reports the branch as having deleted a file the *base*
deleted after the divergence.

So a reviewer can click a file in a three-dot list and be shown a two-dot diff, which for any
repository whose base has moved since divergence shows changes the branch did not make. G11 F3's own
phrase applies unchanged: *wrong in a way a reader would not notice*. `review.files` already returns
`mergeBase`, and `ReviewFilesState` already throws it away (baseline table) — the fix is to keep it.

### F8 — VS Code has a first-class API for precisely this feature, and the obvious alternative is single-line

`vscode.comments.createCommentController` + `CommentController.commentingRangeProvider` is the API
every PR-review extension renders inline review comments with. What it provides, that this phase
would otherwise hand-roll:

- a **"+" affordance in the gutter** of exactly the lines a provider declares commentable — the
  standard, discoverable gesture for "comment on these lines", including a multi-line drag
  selection;
- a **multi-line comment editor** inline in the diff, with a submit button contributed through the
  `comments/commentThread/context` menu;
- **rendering of existing comments** at their own lines, with a delete affordance contributed
  through `comments/comment/title`;
- `CommentThread.canReply = false`, which is how a *flat* annotation model is expressed in an API
  whose default shape is a thread.

The obvious alternative — a palette command plus `vscode.window.showInputBox` — is
**single-line only**, and renders nothing at the lines it annotates. A review note that cannot
contain a newline is a poor fit for a feature whose entire output is prose to hand an AI.

### F9 — G14's scope is adjacent to this phase's, not overlapping, and G12 already wrote down where it starts

G12 §11.1 fixes G14's requirement precisely: restore **range-level "mark reviewed"** inside VS
Code's native diff editor, modelled on the built-in Git extension's hunk-staging gutter — *"gutter
decorations plus per-hunk CodeLens actions attached to the right-hand document of the diff"*, calling
the **already-shipped** `review.mark` `ranges` parameter, with *"no Go change, no `packages/git-ui`
change, no `review.db` migration, no `CONTRACT_VERSION` bump"*.

That is a different VS Code API surface from this phase's (`TextEditorDecorationType` and
`CodeLensProvider` versus `CommentController`), on the same document, for a different verb
(*reviewed* versus *commented*). VS Code composes those natively — a decoration provider and a
comment controller on one document is the ordinary case, not a conflict. What the two genuinely
share is the question *"is this document the branch side of a review diff, and of which
`(repo, branch, path)`?"* — which D8 answers once, statelessly, for both (D20).

### F10 — A comment needs a stable identifier, and SQLite reuses ids without `AUTOINCREMENT`

`remove` needs to name one row. Probe P1, run here against `modernc.org/sqlite`: with a plain
`INTEGER PRIMARY KEY`, deleting the highest row and inserting another gives the new row **the
deleted row's id**. Two windows share one review session (G11 D12), so "window A deleted comment 2,
window B still has 2 in its list and clicks delete" is a reachable sequence — and without
`AUTOINCREMENT` it deletes whatever now holds id 2.

`review_session` already uses `AUTOINCREMENT`; `review_comment` needs it for a sharper reason than
convention.

### F11 — `review.mark`'s validation is exactly what an anchored `add` needs, and already exists

`MarkFile` (`gitsession/incremental.go:538-605`) resolves `readSnapshotSource(ctx, tip, path)` →
`(ContentKind, content, lineCount)`, refuses a ranged mark whose file is not text with a named
sentinel (`ErrRangedMarkOnNonText` → `E_BAD_REQUEST`), and takes the file's current blob oid with
`blobOID(tip, path)`.

An anchored comment needs the identical four facts at its own revision: is the path text there, how
many lines does it have (so the range can be validated rather than trusted), what is its blob oid
(so the cheap "nothing changed" tier works later), and a refusal vocabulary for the non-text case.
So `AddComment` is a second caller of two existing helpers, not new machinery.

### F12 — The palette route is fixed, data-driven, and cross-checked in both directions

`OTHER_COMMANDS` is a flat list; `extension.ts:239-241` registers every entry from it through
`otherCommandHandlers: Record<OtherCommandId, () => void>` (so a new entry with no handler is a
*compile* error); `reviewView.ts`'s `runUiAction` reveals the review view and emits `ui.action` into
its live webview; `commands.test.ts` asserts `ALL_COMMANDS` ⇔ `package.json#contributes.commands`
**in both directions** plus a shared `CATEGORY`.

Two consequences for this phase: a command contributed only to a context menu still has to appear in
`OTHER_COMMANDS` and in the manifest (hidden from the palette via
`contributes.menus.commandPalette` with `"when": "false"`), or the test fails; and every new entry
needs a handler or the `Record` stops compiling. Both are the machinery doing its job.

### F13 — `MUTATING_COMMANDS`'s `pending` labels now name the wrong phases

`MutatingEntry = PaletteCommand | { readonly pending: 'G13' | 'G14' }`, with nine entries — five
stash kinds marked `'G13'`, and `reset`/`cherryPick`/`tagPush`/`tagDeleteRemote` marked `'G14'`. Its
own comment says *"F9's corrected numbering: G13 owns the five stash kinds, G14 owns
reset/cherryPick"*, which was true before the chapter inserted phases mid-stream.

SPEC's phasing table now reads **G15 = Stash**, **G16 = Reset + cherry-pick** — and **G13 is this
phase**, which serves no `OpRequest` kind at all. So the labels currently assert that this phase
owns stash. The table's own comment already says the assignment is provisional (*"Move an entry if a
later phase's own plan takes it differently — this comment, not a fixed assignment, is the source of
truth"*), so correcting it is in-band, not a scope grab (D19).

### F14 — `ContractVersion` is 19, mirrored by hand in three places, and one of them has been missed before

`internal/gitrpc/contract.go:24`, `packages/git-ipc/src/validate.ts:16`,
`apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93`. G4 missed the third and needed a
follow-up commit; G10 landed its own third-mirror fix separately; G11 and G12 each moved all three
in one commit. G13 does the same (D1).

### F15 — `ReviewFilesState` already receives, and throws away, the two shas this phase needs

`review.files` returns `{branchTip, mergeBase, files}` (`contract.ts`'s own result type,
`gitsession.RangeFilesResult`). `ReviewFilesState.#loadFiles` keeps `result.files` and nothing else.
Both discarded fields are exactly what D8 needs to make the two sides of a review diff
sha-addressed: `branchTip` is the right-hand revision, `mergeBase` is the correct left-hand one for
`range` mode (F7). No new request, no new server work — two assignments.

---

## 2. Decisions

### D1 — `ContractVersion` 19 → 20: five new requests, one reshaped request, two new `UiActionKind` members

| Added / changed | Channel |
|---|---|
| `review.comment.add` | request (new) |
| `review.comment.list` | request (new) |
| `review.comment.remove` | request (new) |
| `review.comment.clear` | request (new) |
| `review.comment.export` | request (new) |
| `editor.openRangeDiff` | request (**params reshaped**, D8) |
| `'copyReviewComments'`, `'refreshReviewComments'` | members of `UiActionKind` |

No event, no stream, no FlatBuffers change. The three mirrors move in one commit (F14):
`packages/git-ipc/src/validate.ts:16`, `internal/gitrpc/contract.go:24`,
`apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93`.

**Why five methods and not fewer.** `add` is the only writer that runs git before writing (it
validates the range against the file it is anchoring to); `list` is the only one that runs the
projection; `remove` and `clear` are single statements with different scopes; `export` is a
*rendering* whose cost is proportional to the whole session's comment volume and which almost every
`list` caller does not want. Folding `export` into `list` would make every sidebar refresh format a
string nobody reads; folding `remove` into `clear` would give one method two blast radii.

**Why `review.comment.<verb>` and not `review.commentAdd`.** The chapter's convention is
`<noun>.<verb>` (`commit.detail`, `editor.goToFile`, `review.resolveBase`, `remote.cancel`). Here the
noun is genuinely `review.comment` — a sub-noun of the review session — so the three-segment form
*is* the convention, spelled honestly, rather than a camelCase mash of noun and verb. Method names
are opaque strings to `REQUEST_KEY_MAP` and the router's `switch`; nothing in the transport parses
segments. Flagged in §11.3 because it is the chapter's first three-segment method.

### D2 — The comment table lives in `review.db`, as migration `0002_g13_comments.sql`, cascading from `review_session`

Resolving F1/F2, and following SPEC's package table literally (*"`gitreview` … the flat AI-comment
list"*).

```
internal/gitreview/
  comments.go       NEW  Store: AddComment / Comments / RemoveComment / ClearComments
  export.go         NEW  pure: AnchoredComment, SortAnchored, FormatComments
  migrations/
    0002_g13_comments.sql   NEW
    embed.go        EDITED  one names entry; the stale "G12 adds" comment corrected
  db.go, migrate.go, store.go, snapshot.go, ranges.go, project.go, reaper.go, resolve.go
                    UNCHANGED
```

The package gains no import it does not already have (`database/sql`, `sort`, `strings`, `time`,
`fmt`, `context`), reaches nothing under `internal/bridge`, and needs no exemption in the layering
test.

**Rejected: a table in `kira.db`.** SPEC's own reason for a second file stands, and comments share
the review session's lifecycle exactly (F2) — putting them anywhere else would mean re-implementing
the TTL and the PR-close purge for a second row family.

**Rejected: a new package.** SPEC names one package for both phases, and `export.go` is pure policy
whose only callers are `gitsession` and (later) whatever wires a real AI call. Splitting would put a
leaf's policy on one side of a boundary and its callers on the other — G11 D2's own rejected
alternative, unchanged.

### D3 — The schema, exactly

`migrations/0002_g13_comments.sql`:

```sql
CREATE TABLE review_comment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES review_session(id) ON DELETE CASCADE,
  path            TEXT    NOT NULL,   -- repository-relative, exactly the bytes git reported
  start_line      INTEGER NOT NULL,   -- 1-based, inclusive, in anchor_sha's own coordinates
  end_line        INTEGER NOT NULL,   -- inclusive; == start_line for a single-line comment
  body            TEXT    NOT NULL,   -- LF-normalised, trimmed, never empty (D15)
  anchor_sha      TEXT    NOT NULL,   -- the commit whose content the reviewer was reading
  anchor_blob_oid TEXT    NOT NULL,   -- git's own oid for anchor_sha:path — tier 0's comparand
  created_at      INTEGER NOT NULL    -- unix millis
);

-- list/export read one session's comments and sort them; remove reads one id. This index serves
-- the first and the FK cascade's own delete; the primary key serves the second.
CREATE INDEX review_comment_session_path ON review_comment (session_id, path, start_line);
```

Five notes, each a decision rather than a transcription:

- **`AUTOINCREMENT` is load-bearing, not stylistic** (F10/probe P1): without it a deleted id is
  reused, and two windows share one session, so a stale client id would delete a different comment.
- **The FK is to `review_session`, not to `review_file`.** A comment on a file that was never marked
  reviewed is ordinary and must work; `review_file(session_id, path)` may simply not exist. The
  cascade this phase needs is the session's, which is the one that carries the TTL and `Purge`
  (F2).
- **No `updated_at`, no author, no `resolved_at`, no `parent_id`.** SPEC's column list, taken
  literally — and each absence is a *decision* (D5), not an omission to be filled in later without
  thought.
- **`anchor_blob_oid` is stored even though it is derivable**, because deriving it later requires
  the commit to still exist, which is the exact case the anchor machinery has to survive (D7 tier 0
  is the only tier that works after a rewrite *and* is cheap).
- **Times are unix millis**, matching `review_file.reviewed_at` and the wire's `createdAt`.

### D4 — A session row is created by the first `review.mark` **or** the first `review.comment.add`; reads still never create one

G11 D11's invariant was *"a session row is created only by the first `review.mark`"*, with the
reason: *"listing a branch's files is not reviewing it, and a row per branch anyone ever glanced at
would be a leak the TTL then has to clean up."*

The reason survives; the enumeration widens by exactly one. Writing a comment is durable user intent
in precisely the same sense a mark is, so `AddComment` upserts the session row through the same
`upsertSession` helper `Put` already uses. `Comments`/`RemoveComment`/`ClearComments` never create
one; `list` and `export` `Touch` an existing session and nothing more.

The invariant is therefore restated once, here, in its final form: **a `review_session` row is
created by a write that records something the user did, and by nothing else.**

### D5 — Comments are immutable: add, remove, clear — no edit

SPEC's column list has a `created_at` and no `updated_at`, which is a design statement, not an
oversight: an edited review note whose line anchor was computed against a different revision is a
second question nobody has asked yet. Editing is expressible today as remove-then-add, which
re-anchors correctly by construction; a real `edit` would have to decide whether the anchor moves
with the text or stays, and that decision has no obviously right answer without a use case.

Consequence for the UI: neither surface offers an edit affordance, and the wire has no `update`
method. Recorded in §10 as the natural first thing to add if the copy-paste workflow becomes a live
one.

### D6 — A comment is anchored to the revision the reviewer was reading, and that anchor is never rewritten

**The invariant, stated once:** *every `review_comment` row's `(start_line, end_line)` is a line
range in the coordinates of that row's own `anchor_sha`.* Nothing else is ever stored.

This is G11 D10's invariant applied to a second row family, with one deliberate difference. G11
re-snapshots on every `review.mark`, because a mark is a read-modify-write of a single evolving
state ("which lines have I read"). A comment is a *fact about a moment* — this text, about these
lines, as they stood then. Re-anchoring it later would rewrite history that the export is supposed
to report faithfully. So:

- **on write**: `anchor_sha` = the revision the client says it was reading (`at`, D11/D15),
  `anchor_blob_oid` = that revision's blob oid for the path, range validated against *that*
  revision's line count;
- **on read**: the stored range is projected forward onto whichever revision the caller asks about
  (D7), and the result is reported with a named anchor state;
- **never**: a write that changes an existing row's range or sha.

G11 D10's own rejected alternative applies verbatim and for the same reason: *"storing ranges in tip
coordinates and re-writing them on every read … turns every read into a write, which is wrong on a
path a scrolling UI hits repeatedly, and it makes two windows reading the same session fight over
the same rows for no benefit."*

### D7 — The anchor resolution is three tiers and four named states, and reuses `ProjectRanges` unchanged

The phase's one real algorithm. Given a stored comment `c` and a target revision `at` (the branch
tip by default, or the revision of the document the caller is looking at):

```
0. currentOID := blobOID(at, c.Path)            — "" for a path absent at `at`
   if currentOID == c.AnchorBlobOID:
        -> anchor "exact"; range = c's stored range, unchanged
   (byte-identical content: no diff, one pipe round trip on the cat-file session already running)

1. merge-base --is-ancestor <c.AnchorSHA> <at>
   exit 0  -> hunks := ParseFileDiffBody(FileDiffArgs(&c.AnchorSHA, at, c.Path, nil)).Hunks
              projected := ProjectRanges([]{c.Range}, hunks, lineCountAt)
              len(projected) > 0 -> anchor "projected"; range = projected[0] (∪ if it split)
              len(projected) == 0 -> anchor "removed"; range = c's stored range
   exit 1
   exit 128 -> tier 2                            (G11 F4/probe P2: 1 is the common rewrite case)
   other    -> the classified error

2. -> anchor "stale"; range = c's stored range
   (history was rewritten or the anchor commit is pruned: there is no path from the commit the
    reviewer was reading to the one being asked about, and this phase says so rather than guessing)
```

`lineCountAt` comes from `readSnapshotSource(ctx, at, path)` — the same helper `MarkFile` uses
(F11) — and is resolved once per `(path, at)` pair, not per comment.

**The four states, and why each exists as a distinct wire value:**

| `CommentAnchor` | Means | Line numbers are in |
|---|---|---|
| `exact` | the file is byte-identical to when the comment was written | `at`'s coordinates (== the anchor's) |
| `projected` | the lines moved, and were mapped forward through a real diff | `at`'s coordinates |
| `removed` | the commented lines no longer exist at `at` | `anchorSha`'s coordinates |
| `stale` | history was rewritten; no mapping exists | `anchorSha`'s coordinates |

`removed` and `stale` are genuinely different sentences to a reader ("those lines are gone" versus
"these numbers are from an older revision"), and the export prints them differently (D12). Folding
them would make the export lie about one of the two.

**Why there is no fourth tier reading a stored blob.** G11's slow path exists because "what changed
since you reviewed" must be answerable after a rewrite, and it pays a compressed snapshot per
reviewed file for that. A comment does not need a diff at all — it needs a line mapping — and after
a rewrite there is no honest mapping to compute from content that may have been rewritten
arbitrarily. Reporting `stale` with the original numbers and the original sha is the correct answer,
costs nothing, and never fabricates a line number. **G13 stores no blobs.**

**No new arithmetic.** Every projection call is `gitreview.ProjectRanges`, unchanged, whose empty
result *is* the `removed` signal (probe P2). D18 turns on this: the arithmetic is already tested, so
what gets a test here is the *tier selection and state mapping*, not the mapping itself.

### D8 — Both sides of a review diff become sha-addressed, and the right-hand document carries the review branch

Resolving F5/F6/F7/F15, and the decision that makes an anchored comment exact rather than
approximate. This changes a method **G12** introduced, which is why §11.1 flags it.

**(a) The virtual key gains an optional fourth field.**

```ts
// virtualKey.ts
export function virtualKey(repoId: string, rev: string, path: string, reviewBranch?: string): string;
export interface ParsedVirtualKey {
  readonly repoId: string;
  readonly rev: string;
  readonly path: string;
  /** Present only for the branch-tip side of a review diff (G13 D8): this document is `rev`'s
   *  content for `path`, and `rev` is the tip of `reviewBranch` in the review session that
   *  opened it. Its presence is what makes the document commentable. */
  readonly reviewBranch?: string;
}
```

Encoding stays `\0`-separated and base64url'd; a three-part key parses exactly as it does today, so
**every existing caller (`editor.openDiff`, `editor.goToFile`) is untouched**, and the
`TextDocumentContentProvider` still resolves content from the first three fields alone. `virtualKey.test.ts`
gains round-trip cases for four parts, an empty fourth part (rejected), and a five-part key
(rejected).

**(b) `editor.openRangeDiff`'s params carry revisions, not names.**

```ts
'editor.openRangeDiff': {
  params: {
    repoId: string;
    /** The review session's branch. Carried so the right-hand document can be marked as its tip
     *  (D8a) — which is what lets G13 anchor a comment, and G14 anchor a hunk mark. */
    branch: string;
    /** The branch tip's own commit sha: the right-hand document's revision. */
    branchTip: string;
    /** The left-hand document's revision — the merge base in `range` mode (F7), the file's own
     *  `reviewedAtSha` in `sinceReview` mode. Always a commit sha, never a ref name. */
    leftRev: string;
    /** What to call the left side in the tab title (`main`, `your last review`). Display only. */
    leftLabel: string;
    path: string;
    originalPath?: string;
    status: 'added' | 'deleted' | 'modified' | 'renamed';
  };
  result: Record<string, never>;
};
```

The handler becomes: left = `virtualKey(repoId, leftRev, oldPath)` (or the empty ref for `added`),
right = `virtualKey(repoId, branchTip, path, branch)` (or the empty ref for `deleted`), title
`` `${basename(path)} (${leftLabel} ↔ ${branch})` `` — the same one-line shape as today, with
different inputs.

**Three defects this closes at once, which is why it is one change and not three:**

1. **Stale content (F6).** Every document URI is now `<sha>:<path>`, which *is* immutable, so VS
   Code's cache is correct rather than merely convenient — the reviewer always reads the content
   the URI names.
2. **The two-dot/three-dot mismatch (F7).** `range` mode's left side becomes `mergeBase`, which
   `review.files` already returns, so the diff finally agrees with the file list beside it.
3. **Anchor exactness (this phase).** The document the reviewer selects lines in *names its own
   revision*, so `review.comment.add` can carry it and the server can validate against exactly that
   revision instead of against whatever the tip happens to be at that instant.

**`ReviewFilesState` keeps `branchTip` and `mergeBase`** from `review.files` (F15) and composes the
call from them. No new request. Nothing about `review.files`, `review.fileDiff` or `review.mark`
changes.

**Rejected: firing `onDidChange` for branch-addressed documents instead.** It fixes (1) only, adds
an emitter and a subscription to `repo.changed` in the port, and leaves the reviewer's selection
racing a content swap under their cursor — a *worse* failure than a stale document, because the line
numbers move while they are looking at them. Sha-addressing removes the race rather than narrowing
it.

**Rejected: a `Map<uriString, {repoId, branch, path}>` populated at open.** It is the obvious
alternative to (a), it is what this plan first reached for, and it is worse in three ways: it is
lost on window reload while VS Code restores the tab (so the "+" silently disappears), it needs an
eviction policy, and G14 would need the same map — two features keeping two copies of a fact that is
already in the URI (F5).

### D9 — The add gesture lives in VS Code, through the Comments API; the webview never adds a comment

**This is the central design decision, and it is not left open.**

Resolving F4/F8/F9. The reasoning, in order:

1. **The code is in VS Code now.** G12 moved every review diff into the native editor. "Select the
   lines you want to talk about" is a gesture that can only happen where the lines are rendered, and
   after G12 that is exactly one place (F4).
2. **A webview-side line gesture would mean rebuilding `DiffView` in the sidebar** — a second diff
   renderer beside the editor's, showing the same two revisions, which is precisely the duplication
   G12 D12 removed.
3. **A coarse, whole-file-only comment is not what SPEC asked for.** Its table is
   `(session, file, **line range**, text, created_at)`. Whole-file anchoring would satisfy the
   *table* and not the feature.
4. **VS Code's Comments API is the platform's own answer** (F8), and `AGENTS.md`'s "reach for an
   existing, well-maintained implementation before hand-rolling" applies to a host API at least as
   strongly as to a library.

**What is built** — one new file, `apps/kira-studio-vscode/src/reviewComments.ts`:

| Piece | Shape |
|---|---|
| the controller | `vscode.comments.createCommentController('kiraVersion.reviewComments', 'Kira review comments')`, created at activation, disposed with the extension |
| what is commentable | `commentingRangeProvider.provideCommentingRanges(document)` returns the document's whole line span **iff** `reviewAnchorFor(document.uri)` resolves — i.e. the URI is `kira-version:`, its key parses, and it has a fourth field (D8a). Everything else returns `[]`, so the "+" never appears on the left-hand side, on a working-tree file, or on any other document |
| `reviewAnchorFor(uri)` | `decodeKey` + `parseVirtualKey` → `{repoId, branch: reviewBranch, path, at: rev}`. Pure, stateless, no `vscode` state, exported for G14 (D20) |
| submitting | `kiraVersion.submitReviewComment`, contributed to `comments/commentThread/context`. Takes the thread's `range` and the reply text, calls `review.comment.add`, then re-renders that document's threads |
| deleting | `kiraVersion.deleteReviewComment`, contributed to `comments/comment/title`. Calls `review.comment.remove` with the id carried on our own comment object, then re-renders |
| rendering | one `CommentThread` per comment, `canReply = false`, `collapsibleState = Collapsed`, exactly one comment inside it in `Preview` mode. A non-`exact` anchor puts its state in the thread's `label` ("lines as of 3f2a1bc4 — this file has changed since") |
| when it renders | (a) after `editor.openRangeDiff` opens a document, (b) after this controller's own add/delete, (c) after a `review.comment.*` mutation the *webview* made (D10, through `proxyHandlers`), (d) when a review document becomes visible without having been rendered (`onDidChangeVisibleTextEditors`) — which is what covers a tab VS Code restored after a reload |
| how it renders | `review.comment.list` with `at` = the document's own revision, so every returned range is already in that document's coordinates (D11) |
| thread bookkeeping | one `vscode.Disposable[]` per document URI; re-rendering disposes the previous set first, so a URI can never accumulate two generations of threads. All sets disposed with the controller |

**Rejected: a palette command plus `showInputBox`.** Single-line input (F8), no rendering of
existing comments at their lines, and a hand-rolled "which lines did you mean" step. It would be
about the same amount of code as the controller and strictly less of the feature. (A palette command
still exists — D19 — but it *opens a thread editor at the selection*, it is not the primary gesture
and it is not a text prompt.)

**Rejected: whole-file comments added from the sidebar's file list.** It is the smaller diff and it
needs no VS Code work at all. Against it: point 3 above, and it would put the same verb in two
surfaces with two different precisions, so a user's mental model of "what does a comment anchor to"
would depend on which button they happened to press. If a whole-file note turns out to be wanted,
the honest shape is a distinct feature (a file-level note), not a degraded comment (§10).

### D10 — The webview owns the centralized list, the copy-for-AI action and clear-all — and adds nothing

SPEC's own emphasis for this phase is *"a centralized list ordered by file then line"* and *"a
clear-all action"*. Those are session-wide, they are read-mostly, and they have no useful home
inside a single file's diff — they belong exactly where the review session already lives.

`ReviewView.vue`'s existing toolbar gains a **third** segmented button (Commits / Files /
**Comments**), and `ReviewPane` gains `'comments'`. The new pane:

| Piece | Contents |
|---|---|
| header | the count (`3 comments`), a **copy** icon button (`review.comment.export` → the existing clipboard port; hidden when `capabilities.clipboard` is false, `FileTree.vue`'s own precedent) and a **clear all** icon button |
| clear-all confirmation | the inline two-step button `BranchPicker.vue`'s `confirmForceDelete` already establishes — the button becomes "Confirm clear (3)" plus a cancel — never a modal, never an unconfirmed destructive click |
| the list | grouped under one row per path, in the server's own order (D13); each comment renders `L42` / `L42-48`, a warning codicon with a title attribute when the anchor is `removed` or `stale`, the body (`white-space: pre-wrap`, so a multi-line note renders as written), and a delete icon button |
| clicking a comment | selects that file in the Files pane's own state, which opens it in VS Code — reusing `ReviewFilesState.selectFile` rather than a second `editor.openRangeDiff` call site. Revealing the specific *line* inside a diff editor is not attempted (§10) |
| empty state | "No comments yet — open a file from the Files tab and use the + in the diff's gutter." — the one place the two surfaces are explained to each other |
| refresh | on target change, on becoming the active pane, after every mutation, and on `repo.changed` (anchors move when commits land) |

**Not built: a per-file comment-count badge in the Files pane.** `FileTree.vue` already carries one
optional review prop from G11 and a `showToolbar` opt-out from G12; a second review-shaped optional
prop is the point at which its trailing-control slot needs a real layout decision rather than one
more `v-if`. The Comments pane answers "where are my comments" today. Recorded in §10.

### D11 — The five wire methods, in full

All five are `E_BAD_REQUEST` on a missing/empty `repoId` or `branch`, and all five run `validRefArg`
on `branch` — the same guard, at the same entrance, as every other `review.*` method
(`gitrpc/review.go`).

```ts
/** G13: how a stored comment's line range relates to the revision it was asked about (D7). */
export type CommentAnchor =
  /** The file is byte-identical to when the comment was written; the lines are current. */
  | 'exact'
  /** The lines moved and were mapped forward through a real diff; the lines are current. */
  | 'projected'
  /** The commented lines no longer exist; `range` is as of `anchorSha`. */
  | 'removed'
  /** History was rewritten and no mapping exists; `range` is as of `anchorSha`. */
  | 'stale';

export interface ReviewComment {
  readonly id: number;
  readonly path: string;
  /** In the requested revision's coordinates for `exact`/`projected`, in `anchorSha`'s own for
   *  `removed`/`stale` — which is what `anchor` is for. */
  readonly range: LineRange;
  readonly body: string;
  readonly anchor: CommentAnchor;
  readonly anchorSha: string;
  readonly createdAt: number; // unix millis
}
```

| Method | Params | Result |
|---|---|---|
| `review.comment.add` | `{repoId, branch, path, at, range: LineRange, body}` | `{comment: ReviewComment}` |
| `review.comment.list` | `{repoId, branch, at?}` | `{at: string, comments: readonly ReviewComment[]}` |
| `review.comment.remove` | `{repoId, branch, id}` | `{removed: boolean}` |
| `review.comment.clear` | `{repoId, branch}` | `{removed: number}` |
| `review.comment.export` | `{repoId, branch, at?}` | `{at: string, text: string}` |

Notes that are decisions, not descriptions:

- **`at` is a full object id, required on `add`, optional on `list`/`export`.** On `add` it is the
  revision whose line numbers the caller is using, and there is no safe default for it — a default
  of "the tip" is exactly the silent mis-anchor F6 describes. On `list`/`export` it is the
  projection target and defaults to the branch tip, which is what the sidebar wants; the extension
  passes the open document's own revision so the ranges it renders match the lines on screen (D9).
  The resolved value is echoed back in the result, so a client never has to guess which coordinates
  it is holding.
- **`remove` is idempotent and scoped.** The `DELETE` carries `session_id`, so an id from another
  `(repo, branch)` session matches nothing; a row that is already gone (the other window deleted it)
  answers `{removed: false}` rather than an error, because two windows sharing one session is the
  designed state (G11 D12), not a client mistake.
- **`clear` returns the count** so the pane can announce "Cleared 3 comments" through the existing
  live region rather than silently emptying.
- **`add` returns the whole comment**, including its id, so the extension can render the new thread
  from the response instead of re-listing — the same reason `review.mark` returns its status.
- **`export`'s `text` is empty (`""`) for a session with no comments**, and the copy button is
  disabled in that state. A header line with "(no comments)" would be a paste that says nothing.

### D12 — The plain-text export, produced in Go, exactly

Resolving SPEC's *"rendered as an ordered plain-text list for the user to paste into an AI
conversation by hand"*.

**Where.** `gitreview/export.go`, as a pure function:

```go
type AnchoredComment struct {
    Comment                 // the stored row
    Anchor  CommentAnchor   // D7's four states
    Range   LineRange       // projected, or the stored range for removed/stale
}

func SortAnchored(cs []AnchoredComment)                        // D13's total order, in place
func FormatComments(branch string, cs []AnchoredComment) string // this section
```

**Why Go and not the webview.** SPEC's own justification for the whole shape is *"the backend shape
is a real structured list precisely so a later phase can wire it to an actual call without a
rework."* The thing a later phase would hand to a model is **this text**. Formatting it in
TypeScript would mean that phase either re-implements the format server-side (two formats to keep in
step) or calls out to the webview to build its prompt. One formatter, in the process that would make
the call, is the shape that does not need a rework — and it is the same reasoning G11 D20 used to
put `Store.Purge` server-side ahead of the phase that calls it.

**The format.** For a session on `feature/login` with three comments, one of them stale:

```
Review comments — feature/login (3 comments)

src/auth/session.ts:42-48
  This early return skips the auth check when the header is absent.
  Is that intentional for the health endpoint, or a bug?

src/auth/session.ts:120
  Why is this cast needed?

src/lib/util.ts:7-9  [lines as of 3f2a1bc4; feature/login's history was rewritten since]
  Duplicated with parse() above.
```

**The rules, exactly:**

1. **Header**: `Review comments — <branch> (<n> comment)` for `n == 1`, `(<n> comments)` otherwise,
   then one blank line.
2. **Each entry**: an anchor line, then the body, then one blank line — except after the last entry,
   which is followed only by the final newline.
3. **The anchor line** is `<path>:<start>` when `start == end`, `<path>:<start>-<end>` otherwise.
   `<path>` is exactly the stored bytes, forward-slashed, never quoted or shortened. This is the
   universal `file:line` form every editor and every AI chat already understands, and it is repeated
   per entry rather than hoisted into a per-file heading precisely so that each entry survives being
   quoted, reflowed, or read on its own.
4. **The anchor-state suffix**, appended to the anchor line after two spaces:
   - `exact`, `projected` — nothing at all. The line numbers are current and need no caveat.
   - `removed` — `[these lines no longer exist on <branch>; shown as of <sha8>]`
   - `stale` — `[lines as of <sha8>; <branch>'s history was rewritten since]`

   `<sha8>` is `anchorSha`'s first eight characters — cosmetic only; the full sha is on
   `review.comment.list` for anything that needs it.
5. **The body**: the stored text split on `\n`, each line prefixed with two spaces, with trailing
   whitespace stripped per line (so an empty body line is an empty output line, not two spaces). The
   two-space indent is what keeps a body line that happens to look like `foo.ts:12` from being read
   as another entry's anchor.
6. **The text ends with exactly one `\n`** and has no trailing blank line.
7. **No repository path appears anywhere.** `RepoID` is an absolute filesystem path (G11 F16) and
   this text is pasted into a third-party chat by design; the branch name is the only context the
   reader needs and the only one that cannot leak a home directory.
8. **No file content is included** — SPEC's table has no content column, an AI given `path:line` can
   read the file itself, and embedding code would multiply the export by orders of magnitude and add
   a blob read that can fail. Recorded in §10 as the obvious thing to reconsider when a real AI call
   exists.
9. **Ordering is D13's**, applied before formatting; `FormatComments` does not sort, it renders.

### D13 — Ordering: by file, then line — spelled out as a total order

SPEC says *"ordered by file then line"*. That is two keys, and two keys are not a total order over a
list two comments can share a position in. The full comparator, in `SortAnchored`:

1. `Path`, ascending, compared as raw Go strings (byte order). This is the bytes git reported;
   Unicode normalisation of paths is **G21's** audit, and `review_comment.path` should be on its
   list (§10).
2. `Range.Start`, ascending — the *projected* start for `exact`/`projected`, the stored start for
   `removed`/`stale`, which is the best position available for a comment whose lines cannot be
   located.
3. `Range.End`, ascending — so a comment on `10-12` precedes one on `10-40`, i.e. the narrower note
   comes first.
4. `CreatedAt`, ascending — two comments on the same lines read in the order they were written.
5. `ID`, ascending — the tiebreak that makes the order **total**, because two comments can share a
   millisecond.

`review.comment.list` returns this order too: one ordering, computed once, in Go, so the sidebar's
list and the pasted text can never disagree about what "ordered by file then line" meant.

### D14 — Clear-all's scope: one `(repo_id, branch)` session's comments, and nothing else

Confirmed against G11's session model (F2): `review_session` is `UNIQUE (repo_id, branch)`, so "a
session" is unambiguous and needs no new concept.

`review.comment.clear` is exactly:

```sql
DELETE FROM review_comment WHERE session_id = (
  SELECT id FROM review_session WHERE repo_id = ? AND branch = ?
);
```

Four things it deliberately does **not** do:

- **It does not touch `review_file` or `review_range`.** Clearing your notes is not un-reviewing the
  files you read. These are two independent kinds of state on one session, and the pane says so
  ("Clear all comments", never "reset this review").
- **It does not delete the `review_session` row.** The session survives with its reviewed state
  intact, and its `last_used_at` is bumped (clearing is use).
- **It does not cross repositories or branches.** A session key of a different branch on the same
  repository is a different session, untouched.
- **It does not run `PRAGMA incremental_vacuum`.** The sweep and `Purge` run it because they drop
  compressed file snapshots measured in hundreds of kilobytes (G11 D11); a few kilobytes of text
  does not earn a vacuum, and running one on every clear would make a small action do a
  disproportionate amount of I/O.

`review.comment.remove` is the same statement with `AND id = ?`.

### D15 — Validation at the entrance, with no defaults that could guess wrong

`AGENTS.md`'s "no skipped validation", applied to every field this phase adds:

| Field | Rule | Where |
|---|---|---|
| `repoId`, `branch` | non-empty; `branch` also `validRefArg` | `gitrpc` |
| `at` | `^[0-9a-f]{40}$` or `^[0-9a-f]{64}$` (sha-1 or sha-256 object ids), lowercase | `gitrpc` |
| `body` | non-empty after trimming ASCII whitespace; `\r\n`/`\r` normalised to `\n`; at most `MaxCommentBytes = 8 << 10` after normalisation | `gitrpc` |
| `range` | `1 <= start <= end`; `end <=` the file's line count **at `at`** | `gitrpc` for the shape, `gitsession` for the line-count bound |
| `path` | non-empty; must resolve to **text** at `at` — `binary`/`tooLarge`/`absent` are refused with `ErrCommentNotText`, reusing `readSnapshotSource`'s own classification (F11) | `gitsession` |
| `id` | positive; scoped by session in the statement itself, so a foreign id matches nothing (D11) | `gitrpc` shape, `gitreview` scope |

**Why `at` has no default on `add`.** Because the only plausible default — "the current tip" — is
exactly the assumption F6 shows to be unsafe. A caller that does not know which revision it is
looking at cannot anchor a comment correctly, and should be told so rather than served a plausible
wrong answer.

**Why the range is validated against the file rather than trusted.** A range past EOF would be
stored, then projected (and clamped away), and the comment would silently drift to a different
place. Validating at write time is the only point at which the caller can be told.

**Why 8 KiB.** A review note is prose; 8 KiB is roughly 1,200 words, far past anything a human types
into a gutter, and it bounds both the list result and the export deterministically. There is
deliberately **no cap on the number of comments per session**: the TTL and clear-all are the
lifecycle (F2), and a per-session cap would be a limit with no principled value that fails at
exactly the moment someone is doing a thorough review.

### D16 — `gitsession/comments.go`: one new file, no new fields, no new locks

| Symbol | Contents |
|---|---|
| `ErrCommentNotText`, `ErrCommentRangeOutOfFile`, `ErrCommentNotFound` | sentinels `gitrpc` maps to `E_BAD_REQUEST`, alongside G11's own three |
| `CommentEntry`, `CommentListResult` | this file's wire-shaped structs, JSON-tagged the way `RangeFilesResult`/`ReviewFileDiffResult` already are, so `gitrpc` marshals them with no translation layer |
| `(*RepoEntry).AddComment(ctx, branch, path, at string, r, body) (CommentEntry, error)` | `readSnapshotSource(ctx, at, path)` → refuse non-text, bound the range by its line count; `blobOID(at, path)`; `review.AddComment` |
| `(*RepoEntry).ListComments(ctx, branch, at string) (CommentListResult, error)` | resolve `at` (empty ⇒ `branchTip`); `review.Comments`; anchor every row (D7); `gitreview.SortAnchored`; build the wire entries |
| `(*RepoEntry).ExportComments(ctx, branch, at string) (string, string, error)` | `ListComments`' own anchored slice → `gitreview.FormatComments`. Returns the resolved `at` alongside the text |
| `(*RepoEntry).RemoveComment(ctx, branch string, id int64) (bool, error)`, `ClearComments(ctx, branch string) (int, error)` | thin pass-throughs plus `Touch` |
| `anchorAll(ctx, at string, cs []gitreview.Comment) ([]gitreview.AnchoredComment, error)` | D7's tier machine, with **two memos scoped to the one call**: `map[string]int` for `lineCountAt(path)` and `map[pathAndSha][]porcelain.DiffHunk` for tier 1's patch. A file usually carries several comments and often a single anchor sha, so this turns N comments into ~1 diff per `(path, sha)` pair |

**No `RepoEntry` or `Registry` field is added.** `e.review` (the `*gitreview.Store`) already exists,
threaded by `newRepoEntry` since G11 D14.

**No keyed mutex.** G11 D12 takes `Store.Lock` for `review.mark` because a mark is a
read-modify-write whose "modify" runs git *outside* the transaction, so two concurrent marks would
both project from the same old record. None of this phase's writes has that shape: `add` is one
INSERT (its git work is validation of the *incoming* value, not of an existing row), `remove` and
`clear` are single DELETEs, and `SetMaxOpenConns(1)` already serialises statements. Adding a lock
here would be cargo, and the plan says so rather than copying the idiom.

**`note()` and `invalidateAfterWrite()` are still not touched** — G11 D14's negative claim extends to
this phase's rows for the same reason: comments are durable user intent, not a cache of a git read,
and a `refsChanged` must never drop them. §7.4 carries the checklist line and §3.4 the test.

### D17 — `gitrpc` stays thin dispatch, in one new file and five cases

`gitrpc/comments.go` holds five handlers: decode, validate (D15's shape rules), `entryFor`, one
`RepoEntry` call, marshal. `handlers.go` gains five cases; `wire.go` gains five param structs and
three result structs; `mapDetailError` gains three arms. **No handler in this phase computes
anything.**

Size guards, following G11 D15 exactly: `review.comment.list` and `review.comment.export` marshal
once and refuse over `MaxResultBytes` with an `E_TOO_LARGE`-shaped `ipcerr` naming the comment
count. With `MaxCommentBytes` at 8 KiB this needs hundreds of comments in one session to reach, so
it is effectively unreachable — but "unreachable" is not "unhandled", and unlike `review.fileDiff`
there is no `tooLarge` arm on this result to degrade into.

### D18 — What gets a test, and what does not

`AGENTS.md`'s bar, applied honestly. This phase is mostly CRUD, and the plan says so.

**Tested — one Go suite:**

- **`gitsession/comments_test.go` — the anchor resolution (D7)**, over real fixture repositories
  built with the existing `incFixtureEnv`/`runInc`/`commitInc`/`newIncrementalTestEntry` helpers:
  a comment on an untouched file after unrelated commits ⇒ `exact` with unchanged lines; five lines
  inserted above it ⇒ `projected`, shifted by five; the commented lines deleted ⇒ `removed` with the
  stored range; `git commit --amend` after the comment ⇒ `stale` (G11 probe P2's present-but-
  unreachable case, exit 1); `reflog expire --expire=now --all && gc --prune=now` ⇒ still `stale`
  (exit 128); and a comment listed at an explicit older `at` ⇒ `exact` against *that* revision, not
  the tip. **This is the phase's whole correctness claim**, it is a decision structure with three
  tiers, four outcomes and three exit codes, and every wrong answer it can give is a *silently* wrong
  line number.

**Not tested, deliberately, and why:**

- **`ProjectRanges` reuse.** The projection arithmetic is called **unchanged** and is already covered
  by G11's `project_test.go`, including the two behaviours this phase leans on (an all-deleted range
  projecting to nothing; clamping past EOF, probe P2). A second table over the same function would
  restate a suite that already exists — `AGENTS.md`'s "when torn between two similar tests, delete",
  reached before writing one. The prompt for this plan asks this question explicitly: **the answer is
  no new projection test; the tier selection above is what earns coverage.**
- **`gitreview`'s comment store** — `AddComment`/`Comments`/`RemoveComment`/`ClearComments` are a CRUD
  round trip over four columns and one index, which `AGENTS.md` names as getting nothing ("CRUD
  round-trips (even integration-shaped)"). The one non-obvious property — the FK cascade and the
  session scoping of `remove`/`clear` — is asserted once over the socket in §3.4, where it is proved
  end to end rather than in isolation.
- **`FormatComments`/`SortAnchored`.** A pure render with a handful of rules, whose output the user
  reads on every single use. §3.4 asserts the **exact** text of a three-comment, two-file, one-stale
  session once, which proves ordering, the two suffix forms, the multi-line indent and the trailing
  newline together — a unit table would assert the same rules with less context and one more file to
  keep in step.
- **The migration** — a second step through a runner `internal/storage`'s own tests already cover,
  whose one interesting branch (refusing a newer schema) is a single comparison, already written.
- **`gitrpc`'s five handlers** — thin dispatch; each refusal is asserted once in §3.4.
- **Every TypeScript change** — `bun run typecheck` plus `commands.test.ts`'s both-direction
  cross-check, plus §7.3's macOS script. `packages/git-ui` still has no component-mounting harness
  (G12 §11's own open item), and this phase does not build one for two components.
- **`virtualKey.ts`'s fourth field** is the exception that proves the rule: it is a *format*, its
  round trip already has a test file, and D8 adds cases to `virtualKey.test.ts` rather than a new
  suite. Three cases (four parts round-trip, an empty fourth part rejected, a five-part key
  rejected).

### D19 — Four commands, two of them menu-only, and one stale label corrected

Discharging SPEC's G10 obligation (*"each responsible for registering its own palette command when
it lands"*) and resolving F12/F13.

| Command | Where it appears | What it does |
|---|---|---|
| `kiraVersion.addReviewComment` | palette | The active editor must be a review branch-side document (`reviewAnchorFor`); creates an expanded, empty comment thread at the current selection so the user types into VS Code's own editor. Otherwise `showInformationMessage("Open a file from the Kira review sidebar first, then select the lines to comment on.")` — never silence |
| `kiraVersion.copyReviewComments` | palette | `reviewProvider.runUiAction('copyReviewComments')` — G11 D17's exact route into the review webview, which owns the session and the clipboard port |
| `kiraVersion.submitReviewComment` | `comments/commentThread/context` only (hidden from the palette with `"when": "false"`) | D9's submit |
| `kiraVersion.deleteReviewComment` | `comments/comment/title` only (same) | D9's delete |

All four go in `OTHER_COMMANDS` and in `package.json#contributes.commands` with the shared
`CATEGORY`, because `commands.test.ts` cross-checks both directions (F12); all four get a handler in
`otherCommandHandlers`, because the `Record<OtherCommandId, () => void>` is total.

`MUTATING_COMMANDS` does **not** change: this phase serves no `OpRequest`/`RemoteOpParams` kind. Its
`pending` labels do: `'G13' | 'G14'` becomes `'G15' | 'G16'` and the nine literals move with it,
because SPEC's phasing table now reads G15 = Stash and G16 = Reset + cherry-pick, and leaving them
would have this phase's own number asserting that this phase owns stash (F13). The union is a type
alias and the test asserts nothing about the label text, so this is a rename, not a behaviour
change.

**`UiActionKind` gains two members**: `'copyReviewComments'` (the palette route above) and
`'refreshReviewComments'`, which the extension emits after an *editor-side* add or delete so the
sidebar's list updates without the user switching panes. The reverse direction needs no event: the
webview's own mutations travel through `proxyHandlers.ts`, so the extension can re-render its threads
from the forward itself (§4.2).

### D20 — G14's boundary, drawn so neither phase builds the other's machinery

Resolving F9, and answering this plan's prompt directly.

**What G13 builds that G14 reuses, rather than rebuilding:**

- **`reviewAnchorFor(uri)`** (D9) — the stateless "is this document the branch side of a review diff,
  and of which `(repoId, branch, path)` at which revision?" resolver, and the fourth virtual-key field
  it reads (D8a). G14's decoration and CodeLens providers need exactly this predicate to know which
  documents to decorate; a G14 that writes its own document registry has gone wrong.
- **Sha-addressed review documents** (D8) — G14's gutter marks and its selection-to-`LineRange`
  mapping have the same correctness dependency this phase does: the lines on screen must be the lines
  the server is told about. G14 inherits it already fixed.
- **The `review.comment.add` RPC**, if G14 wants a "comment on this hunk" entry point in the gutter
  it is already building. That is an additional *caller*, not a new method, and it needs no contract
  change.

**What G13 deliberately does not build, and G14 owns in full:**

- Any `TextEditorDecorationType`, any `CodeLensProvider`, any hunk model, any "mark this hunk
  reviewed" command, and the whole decoration lifecycle (when decorations refresh, what happens when
  the diff is re-opened after new commits land). G12 §11.1 assigns these to G14's own planning pass
  and this plan does not pre-empt it.
- Any use of `review.mark`'s `ranges` parameter. G13 never calls `review.mark` at all.
- Any change to `review.fileDiff` (D21) — G14 is its next client-side consumer and is the phase that
  will know whether it wants the body.

**The two features coexist on one document by construction**, because they use different VS Code
APIs for different verbs: a `CommentController` renders comment threads, a decoration/CodeLens
provider renders reviewed-range marks. That is the ordinary arrangement in any editor running a PR
extension alongside a git gutter, not a conflict to design around.

**One consequence to state plainly**: after G13 ships and before G14 does, a reviewer can *comment*
on a range but can only mark a *whole file* reviewed — G12's accepted interim gap, unchanged by this
phase. That asymmetry is visible and is the strongest argument for sequencing G14 immediately after
this phase, which is where SPEC already has it.

### D21 — `review.fileDiff` keeps sending its body: G12's handed-over question, answered

G12 §11 handed this phase the question: *"`review.fileDiff` sends a rendered `body` the review
sidebar no longer displays. The fields it still needs (`deltaSource`, `reviewedRanges`,
`lineCount`, `reviewedAtSha`) are cheap; the body is not. G13 owns whether to split them."*

**Answer: no split, and the reason is G14, not inertia.**

- In `sinceReview` mode the body **is** the delta the projection already computed — dropping it
  saves nothing at all, only the marshalling.
- In `range` mode it costs one extra `git diff`, which lands in `RepoEntry.diff`'s existing
  LRU-by-bytes cache keyed `(mergeBase, tip, path)` and is warmed on an explicit file click, once
  per file per mode. The waste is real and bounded.
- **G14 is the next phase to touch this method's client side, and per-hunk CodeLens actions need a
  hunk list.** `body.hunks` is exactly that. Removing it now, one phase before the feature that most
  plausibly wants it, is a coin flip dressed as a cleanup.
- A `CONTRACT_VERSION` bump is not the cost (this phase bumps anyway); changing which patch is
  computed and which cache is warmed is, and it belongs with the phase that can measure whether it
  mattered.

Recorded in §10 so G14 finds the question already framed rather than rediscovering it.

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/internal/`.

### 3.1 `gitreview/` — the second row family and the pure renderer (D2, D3, D12, D13)

| File | Contents |
|---|---|
| `migrations/0002_g13_comments.sql` | **new** — §D3's DDL verbatim |
| `migrations/embed.go` | **edited** — `{2, "g13_comments", "0002_g13_comments.sql"}` appended to `names`; the stale `// G12 adds {2, "g12_comments", …}` comment corrected to say that G13 took this slot and a further step is the next phase's (F1) |
| `comments.go` | **new** — `Comment` (the stored row), and the four store methods below |
| `export.go` | **new**, and **pure** — `CommentAnchor` and its four constants, `AnchoredComment`, `SortAnchored` (D13), `FormatComments` (D12). Imports `sort`, `strings`, `strconv`/`fmt` and nothing else; spawns nothing, touches no disk |

```go
// Comment is one review_comment row. Ranges are in AnchorSHA's own coordinates (D6's invariant)
// and are never rewritten — projection happens on read, in gitsession.
type Comment struct {
    ID            int64
    Path          string
    Range         LineRange
    Body          string
    AnchorSHA     string
    AnchorBlobOID string
    CreatedAt     time.Time
}

// AddComment inserts one comment, creating (repoID, branch)'s review_session row if this is the
// first thing ever recorded for it (D4) and bumping last_used_at either way. Returns the row with
// its assigned id.
func (s *Store) AddComment(ctx context.Context, repoID, branch string, c Comment) (Comment, error)

// Comments returns every comment for (repoID, branch) in stored-coordinate order (path, start,
// end, created_at, id) — a stable starting point only: the authoritative order is applied by
// SortAnchored after projection, since projection can reorder two comments inside one file.
func (s *Store) Comments(ctx context.Context, repoID, branch string) ([]Comment, error)

// RemoveComment deletes one comment, scoped to (repoID, branch)'s own session so an id belonging
// to another session matches nothing. false (not an error) when the row is already gone (D11).
func (s *Store) RemoveComment(ctx context.Context, repoID, branch string, id int64) (bool, error)

// ClearComments removes every comment for one session and nothing else — never a review_file, a
// review_range, or the session row itself (D14). Returns how many were removed.
func (s *Store) ClearComments(ctx context.Context, repoID, branch string) (int, error)
```

All four go through `s.conn()`, so the lazy open, the migration and the reaper start exactly as they
do for G11's own methods; a Kira Studio instance that serves no review request still never creates
`review.db`.

### 3.2 `gitsession/comments.go` — new (D7, D15, D16)

Detailed in D16's table. The one function worth spelling out is the tier machine, because it is what
D18 tests:

```go
func (e *RepoEntry) anchorOne(
    ctx context.Context, at string, c gitreview.Comment,
    lineCounts map[string]int, patches map[string][]porcelain.DiffHunk,
) (gitreview.AnchoredComment, error)
```

- tier 0 — `e.blobOID(at, c.Path)` vs `c.AnchorBlobOID` ⇒ `exact`, no diff;
- tier 1 — `runAllowingExit(ctx, porcelain.IsAncestorArgs(c.AnchorSHA, at), 0, 1, 128)`; on exit 0,
  the memoised `FileDiffArgs(&c.AnchorSHA, at, c.Path, nil)` patch → `parseAndResolve` → hunks →
  `gitreview.ProjectRanges([]LineRange{c.Range}, hunks, lineCountAt(c.Path))`; non-empty ⇒
  `projected` (its union, since a projection can split a range across an insertion), empty ⇒
  `removed`;
- tier 2 — exit 1 or 128 ⇒ `stale`; any other error is classified and returned.

`lineCounts` and `patches` are request-scoped maps, keyed by `path` and `path + "\x00" + anchorSHA`
respectively — created in `ListComments`, passed down, discarded with the call. No cache on
`RepoEntry`, no invalidation to get wrong.

### 3.3 `gitrpc/` — edited (D1, D11, D17)

| File | Change |
|---|---|
| `contract.go` | `ContractVersion` 19 → **20**, with the same one-paragraph "what moved and why" note every previous bump carries — here: five new `review.comment.*` requests, `editor.openRangeDiff`'s reshaped params (extension-answered, but the constant is the sole compatibility authority), two new `UiActionKind` members |
| `wire.go` | `ReviewCommentAddParams`, `ReviewCommentListParams`, `ReviewCommentRemoveParams`, `ReviewCommentClearParams`, `ReviewCommentExportParams`; `ReviewCommentAddResult`, `ReviewCommentRemoveResult`, `ReviewCommentClearResult`, `ReviewCommentExportResult` (`list`'s result is `gitsession.CommentListResult` directly) |
| `comments.go` (new) | the five handlers, D15's shape validation, D17's two size guards |
| `handlers.go` | five new cases |
| `detail.go` | `mapDetailError` gains `ErrCommentNotText`, `ErrCommentRangeOutOfFile`, `ErrCommentNotFound` |

### 3.4 `gitsock/comments_test.go` — new, integration (D18)

Uses the existing harness (`newIntegrationServer`, `pairAndReady`, `openRepoOK`, `requestOK`,
`unmarshalResult`) over a fixture repository built with `incFixtureEnv()` and a `Registry.Review`
pointed at `t.TempDir()`:

- **`TestIntegration_AddThenListRoundTrips`** — add two comments on one file and one on another;
  `review.comment.list` returns three, every field intact, `anchor: "exact"`.
- **`TestIntegration_CommentsAreOrderedByFileThenLine`** — added deliberately out of order (second
  file first, higher line first): the returned order is D13's, and two comments on identical ranges
  come back in `created_at` order. **D13's whole claim.**
- **`TestIntegration_CommentAnchorsProjectForward`** — insert five lines above a comment and commit:
  `anchor: "projected"`, `range` shifted by five. The same fixture, with the commented lines deleted
  instead: `anchor: "removed"` with the original range.
- **`TestIntegration_CommentSurvivesAnAmendAsStale`** — `git commit --amend` after the comment:
  `anchor: "stale"`, the range and `anchorSha` as written. **The case a blob-less anchor has to
  degrade honestly for.**
- **`TestIntegration_ListAtAnExplicitRevision`** — with the tip two commits ahead, `list` with `at`
  set to the older sha returns `exact` and that revision's coordinates, and echoes `at` back.
  **D11's coordinate contract, which the editor depends on.**
- **`TestIntegration_ExportIsExactlyThisText`** — a two-file, three-comment session with one stale
  entry; the returned `text` is compared **byte for byte** against the literal in the test. **D12's
  whole format, in one assertion.**
- **`TestIntegration_ExportIsEmptyWithNoComments`** — `text == ""`.
- **`TestIntegration_RemoveIsScopedAndIdempotent`** — an id from a *different* branch's session
  answers `{removed: false}` and deletes nothing; removing the same id twice answers `true` then
  `false`.
- **`TestIntegration_ClearRemovesOnlyComments`** — mark a file reviewed, add two comments,
  `review.comment.clear`: comments gone, `review.files` still reports `kind: "full"` for the marked
  file, and the session row still exists (a subsequent `add` reuses it). **D14's exact scope.**
- **`TestIntegration_CommentRefusals`** — an empty body; a whitespace-only body; a body over 8 KiB;
  `at` that is not 40/64 lowercase hex; a range with `end < start`; a range past EOF; a comment on a
  binary path; a `branch` beginning with `-`; a `branch` not in the ref snapshot — each
  `E_BAD_REQUEST` naming the field, and none of them reaching a spawn it should not.
- **`TestIntegration_TwoConnectionsShareComments`** — a comment added on connection A is visible in
  connection B's next `list`, and B's `remove` of it is visible to A. **G11 D12's shared-state model,
  extended.**
- **`TestIntegration_RefsChangedDoesNotDropComments`** — force-move an unrelated branch, wait for
  `repo.changed`, re-list: every comment is still there. **D16's negative claim, and the one a future
  contributor is most likely to break.**

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-ipc` — five keys, three types, one reshaped request (D1, D8, D11)

- `contract.ts`: `CommentAnchor`, `ReviewComment`; the five `Contract["requests"]` entries; the
  reshaped `editor.openRangeDiff` params (D8b); `'copyReviewComments'` and
  `'refreshReviewComments'` on `UiActionKind`.
- `validate.ts`: five `REQUEST_KEY_MAP` entries (the mapped-type totality check makes a forgotten
  one a compile error) and `CONTRACT_VERSION = 20`.
- Nothing else: no event, no stream, no codec, no schema, no generated code.

### 4.2 `apps/kira-studio-vscode` — the comment controller and the reshaped diff (D8, D9, D19)

| File | Change |
|---|---|
| `src/virtualKey.ts` | the optional fourth field, on both `virtualKey` and `ParsedVirtualKey` (D8a). Three-part keys parse exactly as today |
| `src/virtualKey.test.ts` | three cases: a four-part round trip, an empty fourth part rejected, a five-part key rejected |
| `src/reviewComments.ts` | **new**, and the only new file: `reviewAnchorFor`, the `CommentController`, the commenting-range provider, the four command handlers, the per-URI thread bookkeeping, and `renderThreads(uri)` (D9's table) |
| `src/proxyHandlers.ts` | `editor.openRangeDiff` rebuilt from `{branch, branchTip, leftRev, leftLabel}` (D8b), then `renderThreads` for the document it just opened; `review.comment.list`/`export` forward verbatim; `review.comment.add`/`remove`/`clear` forward **and then re-render** the affected document's threads, which is what keeps the editor in step with a sidebar-side mutation with no new event (D19) |
| `src/commands.ts` | four `OTHER_COMMANDS` entries (D19); `MutatingEntry`'s `pending` union relabelled `'G15' \| 'G16'` and its nine literals moved (F13); its explanatory comment updated to SPEC's current numbering |
| `src/extension.ts` | four `otherCommandHandlers` entries; construct the comment controller at activation and push it onto `subscriptions` |
| `package.json` | four `contributes.commands` entries with the shared category; `contributes.menus`: `comments/commentThread/context` (submit), `comments/comment/title` (delete), and `commandPalette` hiding the two menu-only ids with `"when": "false"` |

**One API detail deliberately not asserted here**: the exact argument shape a
`comments/comment/title` menu command receives is read off the pinned `@types/vscode` at
implementation time, not guessed in this plan. The design does not depend on which of the documented
shapes it is — the comment object we construct carries its own id either way — but the code does, and
guessing it here would be the kind of "nearly working" detail G12 F9 already cost a phase.

### 4.3 `packages/git-ui` — the Comments pane (D8, D10)

| File | Change |
|---|---|
| `state/reviewComments.ts` | **new.** `ReviewCommentsState`: `comments`, `loading`, `loadError`, `pending`, `confirmingClear`; `setTarget()`, `reload()`, `remove(id)`, `clear()`, `copyForAi()`. Supersede-and-verify on every request with an `AbortController` per in-flight call — `ReviewFilesState`'s own discipline, which is `DetailState`'s |
| `components/review/ReviewCommentsPane.vue` | **new**, and the only new component: D10's list, header actions and inline clear confirmation |
| `components/review/ReviewView.vue` | a third button in the existing toolbar's segmented group; a `v-else-if` arm rendering the pane; the comments target watcher (`repoId` + `branch` only — no base, since the session key has none); two new `ui.action` arms |
| `state/review.ts` | `ReviewPane` gains `'comments'`; `setTarget`/`setBase` already reset the pane to `'commits'` and need no change |
| `state/reviewFiles.ts` | keep `branchTip` and `mergeBase` from `review.files` (F15); `#openInEditor` composes D8b's params — `leftRev` is `reviewedAtSha` in `sinceReview` mode (falling back to `mergeBase` when it is `null`) and `mergeBase` in `range` mode, with `leftLabel` `'your last review'` or the base's own name |
| `icons/index.ts` | three `ACTION_ICONS` members: `comments: 'codicon-comment-discussion'`, `remove: 'codicon-trash'`, `clearAll: 'codicon-clear-all'` |

`packages/git-core` is **not touched**: nothing here is lane layout, a wire model, a port, or a
client-side search half.

### 4.4 `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts`

`CONTRACT_VERSION = 20` (F14) — named here rather than left to be discovered, because two earlier
phases needed a follow-up commit for exactly this mirror.

---

## 5. Dependencies and tooling

**No new dependency, in either language.** `database/sql`, `sort`, `strings`, `time`, `context`,
`fmt` are stdlib; `modernc.org/sqlite` is already a direct require and stays cgo-free on every
platform. `vscode.comments` is part of the `vscode` API surface `@types/vscode` already declares —
an API, not a package. No FlatBuffers schema change, so `bun run generate:wire` is not run.

**`go.mod`, `go.sum` and `bun.lock` are expected to be byte-identical after this phase.** A diff in
any of them is a signal something was reached for that this plan did not sanction.

`AGENTS.md`'s licence bar therefore has nothing new to check at the package or the feature level.

---

## 6. Implementation order

Seven commits. `go build ./apps/kira-studio/internal/...`, `bun run lint` and `bun run typecheck` run
after **each** — they are fast. The expensive tier (§7.1) runs once at C7, per `AGENTS.md`'s
"implement the whole plan first, then test once".

- **C1** `feat(gitreview): review_comment, its store, and the AI-paste formatter`
  — the migration, the `names` entry (and its corrected comment), `comments.go`, `export.go`
  (D2–D5, D12–D14). No caller yet. **The pure formatter and the total order land before anything can
  depend on getting them slightly wrong.**
- **C2** `feat(gitsession): anchor review comments onto a requested revision`
  — `comments.go` and `comments_test.go` (D6, D7, D15, D16, D18). Depends on C1. **The phase's
  centre; one agent's continuous piece of work.**
- **C3** `feat(git)!: review.comment.* and sha-addressed review diffs — contract 19 → 20`
  — everything the tree needs to typecheck at version 20 in one commit: `gitrpc` (contract, wire,
  handlers, `mapDetailError`), `packages/git-ipc`, `virtualKey.ts` + its test, `proxyHandlers.ts`'s
  reshaped `editor.openRangeDiff`, `state/reviewFiles.ts`'s call site, and the e2e-real mirror (D1,
  D8, D11, D17). Larger than a typical commit on purpose — a contract bump that leaves either side
  unable to compile is not a legible history, it is a broken one.
- **C4** `feat(vscode): inline review comments in VS Code's diff editor`
  — `reviewComments.ts`, the submit/delete commands and their menus, `extension.ts`'s wiring, and
  `proxyHandlers.ts`'s re-render hooks (D9).
- **C5** `feat(git-ui): a Comments pane with copy-for-AI and clear-all`
  — §4.3 in full (D10).
- **C6** `feat(vscode): palette commands for adding and copying review comments`
  — `commands.ts` (four entries plus F13's relabel), `package.json`, `extension.ts`'s handlers, and
  `ReviewView.vue`'s two `ui.action` arms (D19).
- **C7** `test(git): review comments end to end`
  — §3.4 in full, then the full §7.1 run.

Dependency order: C1 before C2; C2 before C3; C3 before C4 and C5; C4 before C6 (the palette command
opens a thread the controller owns); everything before C7. C4 and C5 are the only genuinely
independent pair, and §8 says why they should still be sequential.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 Tier 1 — provable here, automatically, and expected green

**Scoped per SPEC's "Full verification scope, 2026-09-07" note**, not the whole `internal/` tree.

**(a) The scoped race run, once, at C7** — the note's own list plus `gitreview` and `gitvsix`:

```
go test -race \
  ./apps/kira-studio/internal/gitclient/... \
  ./apps/kira-studio/internal/gitpreflight/... \
  ./apps/kira-studio/internal/gitops/... \
  ./apps/kira-studio/internal/gitreview/... \
  ./apps/kira-studio/internal/gitsession/... \
  ./apps/kira-studio/internal/gitrpc/... \
  ./apps/kira-studio/internal/gitsock/... \
  ./apps/kira-studio/internal/gitstore/... \
  ./apps/kira-studio/internal/gitwire/... \
  ./apps/kira-studio/internal/gitvsix/... \
  ./apps/kira-studio/internal/bridge/... \
  ./apps/kira-studio/internal/
```

**(b) `go test ./apps/kira-studio/internal/gitsession/...`** — D18's anchor-resolution suite against
real fixture repositories, including the pruned-object case. **This is D7's whole correctness
claim.**

**(c) `go test ./apps/kira-studio/internal/gitsock/`** — §3.4's twelve integration tests over a real
socket, including the byte-for-byte export assertion. **The phase's real end-to-end proof on the Go
side.**

**(d) `go test ./apps/kira-studio/internal/`** — the layering test, with **nothing added to
`packagesExemptFromBridgeCheck`**: this phase adds no import to `gitreview` or `gitsession` that
either package does not already have.

**(e) `go test ./apps/kira-studio/internal/gitreview/...`** — G11's own suites, expected green and
**unchanged**: this phase edits none of `ranges.go`, `project.go`, `store.go`, `snapshot.go` or
`reaper.go`, so a diff in `ranges_test.go`/`project_test.go`/`store_test.go` is a signal something
was changed that this plan did not sanction.

**(f) `KIRA_GIT_FIXTURES=write go test ./…/porcelain/...` leaves the tree clean** — this phase adds
no fixture and no parser, so a diff means something regenerated that should not have.

**(g) `bun test packages/git-ipc/src`** — the contract, codec and rpc tests against
`CONTRACT_VERSION = 20`. Both suites reference the constant symbolically and should need no edit.

**(h) `bun run lint` / `bun run typecheck` / `bun run test:unit` / `bun run build:vscode` — green.**
`typecheck:git` is what proves the reshaped `editor.openRangeDiff` has no unconverted call site left
and that `virtualKey`'s fourth parameter is genuinely optional; `commands.test.ts` (under
`test:unit`) is what proves the four new commands are in `package.json` and nothing is orphaned in
either direction; `virtualKey.test.ts` proves the key round trip; `build:vscode` proves the review
root still bundles.

**(i) `bun run test:e2e-real` — green**, adding no new spec; its `git-pairing-real.spec.ts` carries
the third `CONTRACT_VERSION` mirror.

**(j) `go.mod`/`go.sum`/`bun.lock` have an empty diff** (§5).

### 7.2 Tier 2 — what cannot be proven in this container, named honestly

Every Go and TypeScript file in this phase compiles, vets and (where it has one) tests here. What
cannot be reached is a *runtime*:

1. **VS Code's Comments API.** `createCommentController`, `commentingRangeProvider`, the gutter "+",
   `CommentThread.canReply`, and the exact argument shapes of the two menu commands exist only
   inside a real extension host. `bun run typecheck` proves the calls type-check against the pinned
   `@types/vscode` and nothing more. **This is the largest unverifiable surface in the phase**, it is
   concentrated in one new file (`reviewComments.ts`), and §7.3 steps 3–8 are written specifically to
   exercise it.
2. **The diff editor itself.** That the "+" appears on the right-hand document and *not* the
   left-hand one is the whole enforcement mechanism for D6's coordinate rule (D9), and it can only be
   seen on real hardware.
3. **VS Code's virtual-document caching.** F6's claim — that a branch-addressed document keeps its
   first-resolved content — is read off `editorIntegration.ts`'s own stated design and VS Code's
   documented provider contract; D8 makes it moot by sha-addressing rather than by relying on a
   particular cache lifetime. §7.3 step 9 is the observation that would have caught it either way.
4. **The webview.** The Comments pane, its inline clear confirmation, and the copy button are Vue
   inside a webview that only exists inside VS Code (the same gap G3–G12 each recorded, and
   `packages/git-ui` still has no component-mounting harness — G12 §11's open item).
5. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` on non-darwin, so nothing
   here reaches the real `repo.open` path a human uses.

There is no perf budget in this phase to re-baseline.

### 7.3 Tier 3 — the macOS script, run once on real hardware before G13 is called done

1. The §7.1(a) scoped race run on macOS — the same suite, on the platform that ships.
2. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`;
   `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` on a real repository; pair; open
   the review sidebar on a branch with a few commits.
3. **The gutter "+" appears on the right-hand side only.** Open a file from the Files tab. Hover the
   line numbers of the **branch** side: the "+" appears. Hover the **base** side: it does not.
   Hover a plain workspace file: it does not. **D9's coordinate rule, enforced by the affordance
   rather than by an error message.**
4. **Adding a comment.** Drag-select lines 10–14 on the branch side, click "+", type a two-paragraph
   note, submit. The thread renders inline at those lines, collapsed, with no reply box.
5. **It appears in the sidebar immediately.** Switch to the Comments tab without touching anything
   else: the comment is there, with `L10-14` and the file's path. **D19's `refreshReviewComments`
   route.**
6. **Deleting from the editor and from the sidebar both work, and both propagate.** Delete from the
   thread's title menu → the sidebar's list loses it on its next render. Add another, delete it from
   the sidebar → the editor's thread disappears without reopening the file. **§4.2's re-render
   hooks.**
7. **Copy for AI.** Click copy, paste into a scratch buffer: the text matches D12's format exactly —
   header, one blank line, `path:start-end` anchors, two-space-indented bodies including the
   paragraph break, no repository path anywhere, a single trailing newline.
8. **Clear all is two clicks and is scoped.** Mark a file reviewed first. Click "Clear all" → the
   button becomes a confirmation → confirm. Every comment is gone; the Files tab still shows that
   file as reviewed. **D14.**
9. **Comments follow the code.** Insert five lines above a comment and commit. Re-open the file: the
   thread is on the new line numbers, and the sidebar agrees. Then delete the commented lines and
   commit: the sidebar shows the "lines no longer exist" marker and the export carries the `removed`
   suffix. **D7's `projected` and `removed`.**
10. **A rewrite degrades honestly.** `git commit --amend` (or an interactive rebase) so the anchor
    sha is unreachable. The comment is **still there**, marked stale, the export says
    `[lines as of <sha8>; <branch>'s history was rewritten since]`, and no line number silently
    changed. **The case a blob-less anchor exists to handle.**
11. **The diff itself is right.** With the base branch having moved after divergence (delete a file
    on `main` after branching), open a file in Full-range mode: the diff shown is the three-dot one,
    and the file deleted on `main` is **not** in the Files list or the diff. **F7's fix, D8.**
12. **A stale tab cannot mis-anchor.** Open a file's diff, leave the tab open, land a commit that
    edits that file, then re-open it from the sidebar: a **new** tab/document is opened for the new
    sha, and a comment added in it lands on the lines actually shown. **F6's fix, and the reason D8
    exists.**
13. **The palette.** `Kira Version: Add Review Comment` with a selection in a review document opens
    an empty thread there; with no such editor it says so rather than doing nothing.
    `Kira Version: Copy Review Comments` copies the same text as the pane's button.
14. **Two windows.** Open the same branch's review in two VS Code windows against one Kira Studio: a
    comment added in A appears in B's list on its next render, and B's delete of it is honoured in A.
15. **Nothing else regressed**: the Commits tab is exactly as G12 left it, the graph panel's commit
    detail pane is untouched, whole-file "mark reviewed" still works from the Files tab and from the
    palette, and `ls -la ~/.kira-studio/` still shows one `review.db` at 0600 — now with a
    `schema_version` of 2.

### 7.4 The checklist

- [ ] `CONTRACT_VERSION` is **20** in all three places: `git-ipc/src/validate.ts:16`,
      `gitrpc/contract.go:24`, `tests/e2e-real/git-pairing-real.spec.ts:93` (D1/F14).
- [ ] `packages/git-ipc`'s diff is the constant, two new types, five request entries, five
      `REQUEST_KEY_MAP` lines, two `UiActionKind` members and `editor.openRangeDiff`'s params — no
      event, no stream, no codec, no schema.
- [ ] `packages/git-core` is byte-for-byte unchanged; `gitWire.fbs`, `src/generated/` and
      `internal/gitwire` are unchanged and `bun run generate:wire` was not run.
- [ ] `go.mod`, `go.sum` and `bun.lock` are unchanged (§5).
- [ ] `packagesExemptFromBridgeCheck` is unchanged (§7.1(d)).
- [ ] The migration is `0002_g13_comments.sql`, registered as `{2, "g13_comments", …}` in
      `migrations/embed.go`'s hand-ordered `names`, and the stale "G12 adds" comment is corrected
      (F1).
- [ ] `review_comment.id` is `INTEGER PRIMARY KEY **AUTOINCREMENT**` (F10/probe P1).
- [ ] `review_comment`'s FK is to `review_session`, **not** `review_file` — a comment on a file that
      was never marked reviewed works (D3).
- [ ] G11's own files are untouched: `ranges.go`, `project.go`, `store.go`, `snapshot.go`,
      `reaper.go`, `db.go`, `migrate.go`, `resolve.go` all have an empty diff.
- [ ] No range arithmetic was written: every projection is `gitreview.ProjectRanges`, called
      unchanged (D7/D18).
- [ ] Stored ranges are always in `anchor_sha`'s coordinates and are **never** rewritten (D6).
- [ ] `CommentAnchor` is one of `exact`/`projected`/`removed`/`stale`, and `projected` is reported
      **only** when a `git diff` actually ran (D7).
- [ ] A session row is created by the first `review.mark` **or** the first `review.comment.add`, and
      by no read (D4).
- [ ] `review.comment.clear` deletes comments only — no `review_file`, no `review_range`, no session
      row — and runs no `incremental_vacuum` (D14).
- [ ] `review.comment.remove` is scoped by session in the statement and answers `{removed: false}`
      rather than erroring for a row that is already gone (D11).
- [ ] `at` is validated as 40- or 64-character lowercase hex, is **required** on `add`, and is echoed
      back on `list`/`export` (D11/D15).
- [ ] `body` is trimmed, LF-normalised, non-empty and ≤ 8 KiB; a range is validated against the
      file's line count **at `at`**; a non-text path is refused by name (D15).
- [ ] The export is produced in Go by `gitreview.FormatComments`, contains no repository path and no
      file content, ends in exactly one newline, and is `""` for an empty session (D12).
- [ ] Ordering is D13's five-key total order, applied once in Go and used by both `list` and
      `export`.
- [ ] `gitsession` adds **no** `RepoEntry`/`Registry` field and **no** keyed mutex, and `note()` /
      `invalidateAfterWrite()` are unchanged — `TestIntegration_RefsChangedDoesNotDropComments`
      proves the last one (D16).
- [ ] Both sides of `editor.openRangeDiff` are sha-addressed; `range` mode's left side is the
      **merge base** (D8/F7).
- [ ] `virtualKey`'s fourth field is **optional** and three-part keys parse exactly as before —
      `editor.openDiff` and `editor.goToFile` have no behavioural diff (D8a).
- [ ] `commentingRangeProvider` returns ranges **only** for documents whose key carries the fourth
      field, so the "+" can never appear on the base side or on a workspace file (D9).
- [ ] Comment threads are created with `canReply = false` and exactly one comment each — no
      threading, per SPEC (D5/D9).
- [ ] Re-rendering a document's threads disposes the previous set first; no URI accumulates two
      generations (D9).
- [ ] The webview adds no comment and offers no edit affordance (D5/D9/D10).
- [ ] Clear-all is confirmed inline, `BranchPicker.vue`'s own two-step pattern, never a modal and
      never a single click (D10).
- [ ] The four new commands are in `OTHER_COMMANDS`, in `package.json#contributes.commands` with the
      shared category, and in `otherCommandHandlers`; the two menu-only ones are hidden from the
      palette with `"when": "false"`; `MUTATING_COMMANDS` is otherwise unchanged (D19/F12).
- [ ] `MutatingEntry`'s `pending` labels read `'G15' | 'G16'` (F13).
- [ ] `review.fileDiff`, `review.files` and `review.mark` are unchanged on both sides (D21).
- [ ] No test, fixture or script runs `git config --global` or `--system`; every `review.db` a test
      opens is under `t.TempDir()` (§0.4).
- [ ] §7.1(a)–(j) all green; §7.3's fifteen macOS steps all pass.

---

## 8. Sequencing — one implementer, sequential

**Recommendation: one sequential Sonnet subagent for the whole phase.** G1–G12 all made the same
call and all twelve carried it through.

1. **The phase is one dependency chain.** The store and the formatter → the anchor machine → the
   contract → the two clients → the proof. That is `AGENTS.md`'s textbook case of *not* "genuinely
   independent (unrelated adapters, non-overlapping fixes)".
2. **C3 is a single atomic thought.** A contract bump that reshapes an existing method touches Go,
   `git-ipc`, the extension and the webview in one breath; splitting it across agents means one of
   them lands a tree that does not typecheck.
3. **C4 and C5 look separable and are not, quite.** They are the two ends of one behaviour: an
   editor-side add has to show up in the sidebar, and a sidebar-side delete has to remove the
   editor's thread. Two agents would each implement half of that handshake against an imagined other
   half. If the orchestrator insists on a split, C5 (the webview pane) is the defensible cut — it
   depends on C3 alone — and the handshake bullets in §4.2 must go into *both* prompts.

Three things to carry into the implementing prompt, because a fresh subagent starts cold and all
three are counter-intuitive:

- **Do not write any range arithmetic.** Every projection is `gitreview.ProjectRanges`, called
  unchanged. An empty result from it is the `removed` state, not a bug to work around, and it is
  already tested (probe P2).
- **Do not default `at` on `review.comment.add`.** "The current tip" is precisely the wrong answer —
  it is the mis-anchor F6 describes, and the whole of D8 exists to make the caller able to say which
  revision it was reading.
- **Do not add review-comment state to `RepoEntry.note()`.** Every other piece of state on
  `RepoEntry` is a cache of a git read and is dropped on `refsChanged`. Comments, like reviewed
  marks, are durable user intent and must survive it. §3.4's own test exists to catch this.

---

## 9. Explicit non-goals for G13

| Not in G13 | Owner |
|---|---|
| Range/hunk-level "mark reviewed" gutter actions, decorations, CodeLens, and their lifecycle | **G14**, in full (D20); G13 hands it `reviewAnchorFor` and sha-addressed documents and stops there |
| Any change to `review.mark`, `review.files` or `review.fileDiff` — including splitting the unused body | **G14** (D21) |
| Any AI API call, prompt template beyond the export text, response ingestion, or model configuration | a later chapter; the seam is `gitreview.FormatComments` (D12) |
| Threading, replies, resolve/unresolve, comment authorship, comment editing | not in v1.3, per SPEC (D5) |
| A per-file comment-count badge in the Files pane | deferred (D10); `FileTree.vue` is unchanged this phase |
| Revealing a specific line inside an already-open diff editor when a comment row is clicked | deferred (D10, §10) |
| Whole-file or file-level notes with no line range | not built, and not a degraded comment if ever wanted (D9) |
| Comments anchored to a working-tree file rather than a review document | never — G11's own "the working tree is never read" discipline, inherited |
| The eager purge on PR closed/merged | **G18**, calling `Store.Purge`, which now cascades comments too for free (F2) |
| NFC/NFD path normalisation — including `review_comment.path` | **G21**, whose audit list should gain this column (§10) |
| A component-mounting test harness for `packages/git-ui` | still unowned (G12 §11); not built for two components |
| Editing `docs/v1.3/SPEC.md` | house rule; this plan is the record |

---

## 10. Handed forward

- **`reviewAnchorFor(uri)` and the fourth virtual-key field are G14's** (D20). A G14 that builds its
  own document registry, or that re-derives which side of a diff is the branch side, has gone wrong —
  the one thing it needs to add is a decoration provider that consumes this predicate.
- **`gitreview.FormatComments` is the seam a live-AI phase calls.** It is pure, it takes the branch
  and the anchored list, and it returns the exact text a human pastes today. A phase that adds a real
  call should call it, not re-render the same list into a second format that then drifts.
- **The export deliberately carries no file content** (D12 rule 8). That is right for a paste into a
  chat that can read the repository, and probably wrong for an API call that cannot. Whichever phase
  first makes a real call should revisit it there, where the token budget is a real constraint rather
  than a guess.
- **`0003_*.sql` is the next phase's, and the runner refuses a downgrade.** Once a user has run a
  build with step 3, rolling back to a G13 build makes `review.db` refuse to open. That is
  `internal/storage`'s established posture applied to a second file, unchanged by this phase, and
  worth knowing before someone bisects.
- **Comments have no `updated_at` and no edit path** (D5). If the copy-paste workflow becomes a live
  one, an edit is the first thing to want, and the open question it inherits is whether an edited
  note keeps its original anchor or re-anchors to the revision it was edited against. This plan takes
  no position on that beyond refusing to guess now.
- **Two surfaces render the same comments and neither is pushed to.** The editor re-renders on its
  own mutations, on an `openRangeDiff`, and on becoming visible; the sidebar re-lists on its own
  mutations, on pane activation and on `repo.changed`; `refreshReviewComments` covers editor →
  sidebar. There is still no `review.changed` event, exactly as G11 D12 left it for reviewed marks —
  a one-line contract change if a third surface or a second window ever makes it matter.
- **`review_comment.path` is a third path-keyed column and belongs on G21's list.** SPEC's G21 row
  names `gitclient/porcelain`, the watcher, `gitsession`'s caches and the wire contract; G11 §10
  already added `review_file.path`. This one is written from `diff-tree`'s bytes (through the Files
  pane) and looked up from a client-supplied string, which is the same comparison class.
- **`MaxCommentBytes` (8 KiB) is a chosen number, not a measured one** (D15), as is the decision to
  cap nothing else. Nobody has yet looked at a real `review.db` after a month of use — G11 §10 said
  the same about its 1 MiB snapshot cap, and this is the second entry on that list.
- **Clicking a comment opens its file but not its line** (D10). Revealing a line inside an already-open
  diff editor needs the same editor plumbing G14 is about to build for its gutter, so it is cheapest
  there.
- **`gitreview` now has four pure files**, not three: `resolve.go`, `ranges.go`, `project.go` and
  `export.go` — the files that spawn nothing and touch no disk. G11 §10's own sentence, updated.

---

## 11. Three calls worth a human eye before implementation starts

All three are judgment calls the orchestrator or the user may reasonably decide differently, and all
three are cheap to change *now* and awkward to change after C3/C4. None is a blocker: the plan takes
a position on each and can be implemented as written.

### 11.1 Reshaping `editor.openRangeDiff`, a method G12 owns (D8, F6, F7)

**As planned**: yes. Both sides of every review diff become sha-addressed, `range` mode's left side
becomes the merge base, and the right-hand document carries the review branch in a fourth
virtual-key field. It fixes a stale-content defect (F6), a two-dot/three-dot defect (F7), and it is
what makes an anchored comment exact rather than approximately right.

**The alternative**: leave `editor.openRangeDiff` alone, add `at` to `review.comment.add` anyway, and
have the extension pass whatever revision it can infer. Against it: the only thing it can infer from
a branch-addressed URI is the branch *name*, so the server would resolve the tip itself — which is
exactly the mis-anchor F6 describes, silently, on a surface whose entire job is to record precisely
which lines someone meant.

Flagged because it is a **breaking change to a request another phase introduced two weeks ago**, and
because two of the three defects it fixes are G12's rather than G13's. A reviewer seeing that diff
should see it because it was decided, not because it was convenient. (The commit message carries the
`!`, and the contract's own note names all three reasons.)

### 11.2 VS Code's Comments API versus a command and an input box (D9, F8)

**As planned**: the Comments API. It is the platform's own primitive for this exact feature, it gives
the gutter "+", a multi-line editor and inline rendering for roughly the code a hand-rolled command
would cost, and `AGENTS.md`'s "reach for an existing implementation before hand-rolling" points
straight at it.

**The alternative**: `kiraVersion.addReviewComment` + `showInputBox`, with existing comments visible
only in the sidebar. It is smaller, it is fully typecheckable here, and none of §7.2's unverifiable
surface would exist. Against it: `showInputBox` is single-line, which is a poor container for a
review note, and nothing would render at the lines the note is about — so the reviewer reading the
diff would have no idea a comment exists there.

Flagged because it is the largest thing in this phase that **cannot be proven in this container**
(§7.2 item 1). If the orchestrator would rather not carry that risk into an unattended
implementation, the alternative is a genuinely smaller phase — and everything else in this plan (the
schema, the anchor machine, the five methods, the export, the pane) is unchanged by the choice.

### 11.3 Three-segment method names (`review.comment.add`) (D1)

**As planned**: `review.comment.add` / `list` / `remove` / `clear` / `export` — the chapter's
`<noun>.<verb>` convention with a two-part noun, since the noun genuinely is "a review session's
comments". Method names are opaque strings to `REQUEST_KEY_MAP` and to the router's `switch`;
nothing parses segments.

**The alternative**: two segments throughout — `review.comments` (list), `review.commentAdd`,
`review.commentRemove`, `review.commentClear`, `review.commentsExport` — matching every existing
method's shape exactly.

Flagged because it is the chapter's first three-segment method name and the choice is permanent once
it is on the wire; the two forms are otherwise identical in cost.

---
