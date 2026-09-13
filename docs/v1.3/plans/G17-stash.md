# G17 — Stash: a fully-specified feature with zero backend behind it

> **What this phase is.** The seventeenth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and
> an unusually asymmetric one: **the wire contract, the client state, and every dialog/menu/panel
> this feature needs already exist and are already wired end to end** — `packages/git-ipc/src/
> contract.ts` carries `StashEntry`, `StashPopPreflight`, `StashBranchPreflight`, the five stash
> `OpRequest` kinds, three stash-specific `OpErrorKind`s, and all four stash-shaped request methods
> (`stash.list`, `stash.show`, `preflight.stashPop`, `preflight.stashBranch`), all already counted
> in `CONTRACT_VERSION = 21`. `packages/git-ui` has a complete toolbar button, a stash section
> inside `BranchPicker.vue` (`StashList.vue`), a detail pane (`StashDetailPane.vue`), a create/pop/
> branch dialog (`StashDialog.vue`), a row context menu (`buildStashMenu`), graph-badge selection
> routing, and a fully implemented `StashState`/`OpsState` client (`runStashPush`/`runStashApply`/
> `runStashPop`/`runStashDrop`/`runStashBranch`/`previewStashBranch`/the shared `#stashAndCarry`
> route) — none of it stubbed, all of it calling real RPC methods. **Every one of those calls hits
> `E_UNKNOWN_METHOD` today.** `grep`ing `apps/kira-studio/internal/gitrpc/` and `internal/gitops/`
> for `stash` (case-insensitive) finds zero handlers, zero argv builders, zero error-classification
> rows — `git-core`'s own `classifyStashPop`/`classifyStashBranch` (a complete, tested classifier
> with twelve documented probes) has **no caller anywhere in this repo**, kept alive only by its own
> test file and an `index.ts` re-export, the same "written once upstream, never yet ported to Go"
> state `checkout`/`revert`/`push`/`pull`'s classifiers were in before G5/G7 ported them and deleted
> the TypeScript originals (`git log` on `packages/git-core/src/preflight/` shows exactly that
> pattern twice already: `d9c91978`, `90b85c05`). This phase is that same pattern applied to stash —
> **not a design phase, a port**: the shape of every result, every blocker, every error kind, and
> the exact edge cases (untracked-collision-vs-dirty-membership, in-progress-first blocker
> ordering, `stash branch`'s no-prediction-by-construction) are already pinned down in
> `packages/git-core/src/preflight/stashPop.ts` and its 22-case test file. The job is writing the Go
> that answers what the client has been asking for since G1.
>
> **One real design gap, not a port**: `git stash pop`/`apply` report a conflicting merge with a
> **non-zero exit and empty stderr** (per the contract's own `StashConflict` doc comment) — the
> generic `runWriteArgv`/`ClassifyOpError` path every other `opTable` entry uses would classify that
> as `Unknown`, not `StashConflict`. No `opTable` entry before this phase has ever needed a
> post-write status read-back to reclassify its own result; `RunOp` already computes one (for
> `inProgress`) and discards it. D6 below is this phase's own, actually-designed addition, not a
> port from anywhere.
>
> **One real scope call, argued and decided, not assumed**: `kiraVersion.stash.showInGraph`
> ships today, defaulted **on**, and does nothing — `porcelain.WalkSpec.IncludeStash`/`StashShas`
> exist and are read by `RevSetArgs`, `gitsession/walk.go` already treats them as part of a walk's
> cache-invalidation key, and `git-core/src/graph/stashRows.ts` is a complete, tested row filter —
> all of it pre-positioned for exactly this feature, all of it unused. Wiring it needs a genuine new
> piece of wire surface (`graph.stream`/`graph.loadMore`/`graph.refresh` carry no stash-related
> param today) and therefore a `CONTRACT_VERSION` bump — the one piece of this phase SPEC's own
> one-line G17 row does not name, unlike G20's row, which spells out its own graph integration
> explicitly. D1 below decides this **out of scope for G17**, on that asymmetry, with the reasoning
> and the override path both written down — §10.1 hands the call to a human.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `ab92a284` (G1–G16 complete, including G16's
webview-layout fix). Working tree clean; no other agent running concurrently. Every claim in this
plan was checked against source read in this container — `grep`s for `stash`/`Stash` across
`apps/kira-studio/internal/`, `packages/git-ipc/`, `packages/git-core/`, `packages/git-ui/`, and
`apps/kira-studio-vscode/`, plus `git log --diff-filter=A -- packages/git-core/src/preflight/
stashPop.ts` and the two prior classifier-deletion commits, not assumed from SPEC's prose alone.

### 0.2 Scope

Full upstream P9 **except graph integration** (D1): `stash list`/`stash show`/`stash push`/
`stash apply`/`stash pop`/`stash drop`/`stash branch`, `merge-tree`-based pop-conflict prediction,
wired into `preflight.checkout`'s `stashAndCarry` route (already scaffolded, currently hardcoded
off) and into `remote.pull`'s equivalent route (already scaffolded the same way, per `gitpreflight/
pull.go`'s own `RouteStashAndCarry`). Concretely:

1. **`internal/gitops/stash.go`** — argv builders for all five mutating stash verbs, ported from
   the probes `@kira/git-ipc`'s own doc comments already recorded (`sha` vs. `stash@{index}`
   addressing per verb, per probe 8).
2. **`internal/gitclient/porcelain`** — parsing for `stash list -z --numstat -M -C --format=…` and
   `stash show --numstat/--name-status -z -u -M -C`, plus the merge-tree pop-prediction argv (reuse
   of the existing `MergeTreeArgs`/`ParseMergeTreeOutput`, no new parser needed there).
3. **`internal/gitpreflight`** — `ClassifyStashPop`/`ClassifyStashBranch`, direct Go ports of
   `git-core/src/preflight/stashPop.ts`'s two exported functions, same field-for-field shape, same
   blocker ordering, same 22 test cases re-expressed as Go table tests.
4. **`internal/gitsession`** — `opTable` gains five entries (`stashPush`/`stashApply`/`stashPop`/
   `stashDrop`/`stashBranch`), `PreflightCheckout`'s `StashAvailable` flips from the hardcoded
   `false` it has carried since G5 to a real value, two new orchestration methods
   (`PreflightStashPop`/`PreflightStashBranch`) mirroring `PreflightCheckout`/`PreflightRevert`'s
   own shape, and the `Reclassify` mechanism D6 adds.
5. **`internal/gitrpc`** — four new `Request` cases (`stash.list`, `stash.show`,
   `preflight.stashPop`, `preflight.stashBranch`); `op.run`'s dispatch needs no change (it is
   already generic — `ErrUnservedOpKind` simply stops firing for these five kinds).
6. **`packages/git-core`** — delete `preflight/stashPop.ts` + its test + the two `index.ts`
   re-export lines, closing the same hand-off G5/G7's own plans already state is this phase's job
   (`docs/v1.3/plans/G5-refs-checkout-preflight-and-the-undo-slot.md:350`).
7. **`apps/kira-studio-vscode/src/commands.ts`** — the five `{ pending: 'G15' }` entries become
   real `PaletteCommand`s (stale label from before SPEC's phase-renumbering commit; `commands.test.ts`
   fails hard the moment `opTable` serves these kinds unless this lands in the same commit).
8. **`apps/kira-studio-vscode/package.json`** — five new `contributes.commands` entries plus (for
   `stashPush` only, per D9) a real command; the other four reuse the existing branch-picker
   palette route.
9. **`packages/git-ipc`** — **no change.** Every wire shape this phase needs already exists at
   `CONTRACT_VERSION = 21` (§1 F1). This is unusual enough for this chapter to state as a checklist
   item (§7.1), not an assumption.

### 0.3 Not in this phase

- **`kiraVersion.stash.showInGraph` / stash entries as graph nodes.** D1. The setting stays exactly
  as inert as it is today — not worse, not better. `git-core/src/graph/stashRows.ts` is untouched
  and stays uncalled.
- **`CONTRACT_VERSION` stays 21.** No wire shape this phase adds or changes is new; §7.4 makes this
  a checked item, matching G16's own precedent for a phase that turns out not to need one.
- **`reset`/`cherryPick`/`tagPush`/`tagDeleteRemote`** — G18's and (per `commands.ts`'s own stale
  `pending: 'G16'` labels) an unnamed later phase's own kinds respectively. Their `commands.ts`
  entries are not touched here even though they sit right next to the ones this phase does touch —
  see D10's own note on why the drive-by fix stops at the five stash lines.
- **Branch-scoped stash** (auto-stash on checkout, cross-branch apply, a global/unscoped bucket) —
  explicitly G24's own phase, already named in SPEC as depending on G17. `StashEntry.branch` is
  already on the wire (parsed from the `WIP on <b>:`/`On <b>:` reflog prefix, per `git-core/src/
  model/stash.ts`'s own doc comment) and this phase reads it into `StashList.vue`'s existing
  per-row rendering — but no cross-branch filtering, no auto-stash trigger, and no second stash
  bucket are built here. §10.4 states this boundary explicitly since G24 depending on G17 makes it
  easy to accidentally reach for "while I'm here."
- **No `docs/v1.3/SPEC.md` edit.** Same convention G12/G14/G15/G16 all followed — this plan carries
  any correction to SPEC's own G17 row (there is none needed here) or to stale doc comments
  elsewhere in the tree (§2 D10 lists what gets touched).
- **No new dependency, no new test tier.** Everything this phase needs — `merge-tree`, `stash`
  itself, the existing porcelain framing helpers, the existing Go test conventions — is already in
  the tree.

### 0.4 Ground rules

- **Port the classifier, don't redesign it.** `ClassifyStashPop`/`ClassifyStashBranch` are a
  field-for-field, blocker-order-for-blocker-order port of `stashPop.ts`'s two functions. Any
  deviation is a decision, stated as one (there are none needed — the TS is already correct and
  already tested against the exact upstream probes).
- **Every mutating verb goes through `RunOp`'s existing machinery**, not a bespoke handler. The one
  exception (`Reclassify`, D6) is additive to that machinery, not a parallel path.
- **The five `pending` labels in `commands.ts` do not survive this phase.** `commands.test.ts`
  makes this non-optional, not a nicety (§1 F7).
- **Fix a stale doc comment where this phase's own diff already touches its neighborhood**, but do
  not go hunting for every stale phase-number reference in the tree — D10 draws that line
  explicitly, file by file.

---

## 1. Findings

### F1 — The entire wire contract for this feature already exists, at `CONTRACT_VERSION = 21`

`packages/git-ipc/src/contract.ts`:

- `StashEntry` (`:336-350`), `StashPopBlocker`/`StashPopPreflight` (`:352-371`),
  `StashBranchPreflight` (`:373-383`) — structural copies of `git-core`'s own `model/stash.ts` and
  `preflight/types.ts`, already field-complete (`baseSubject`, `indexSha`, `untrackedSha`,
  `includedUntracked` — every field the classifier and the list row need).
- `OpRequest`'s five stash kinds (`:592-619`): `stashPush`/`stashApply`/`stashPop`/`stashDrop`/
  `stashBranch`, each with the exact addressing rule its own doc comment states (`apply` takes a
  raw sha; `pop` and `branch` take `stash@{index}` — probe 8).
- `OpErrorKind`'s three stash-specific members (`:671-683`): `StashConflict`, `StashIndexConflict`,
  `StashUntrackedCollision` — each with a doc comment naming exactly how it is detected, not left
  to be rediscovered (`StashConflict`'s in particular: "NOT detected from a stderr pattern... exit
  code plus a post-op status read-back", which is F5/D6 below).
- Four request methods already declared (`:1271-1291`): `stash.list`, `stash.show`,
  `preflight.stashPop`, `preflight.stashBranch`.

`apps/kira-studio/internal/gitrpc/contract.go`'s own `ContractVersion` history (four dated bump
comments, `G7`→16, `G10`→17, `G11`→18, `G12`→19, `G13`→20, `G14`→21) never mentions stash — because
none of it needed to. The whole surface landed when `packages/git-ipc` was ported **whole** at G1
(SPEC's own table: "Kept whole... A new `socketChannel.ts`... is the only new file"), carrying
upstream's full P1–P11 vocabulary in one shot, long before the phases that serve each piece of it
existed. **No `packages/git-ipc` edit is needed anywhere in this phase.**

### F2 — Zero Go implementation exists anywhere in the serving path

Confirmed by direct inspection, not inference:

- `grep -ril stash apps/kira-studio/internal/gitrpc/ internal/gitops/` — **no match in either
  directory.** `internal/gitops/` has `branch.go`/`checkout.go`/`conflict.go`/`errors.go`/`fetch.go`/
  `progress.go`/`pull.go`/`push.go`/`remote.go`/`revert.go`/`tag.go` — no `stash.go`, despite SPEC's
  own package table listing `stash` among `gitops`'s owned verbs.
- `internal/gitrpc/handlers.go`'s `Router.ForConn` switch (the complete method table for every
  `Request` this server answers) has no `stash.*` or `preflight.stash*` case — such a call falls
  through to the `default: return nil, ipcerr.New("E_UNKNOWN_METHOD", ...)` arm.
- `internal/gitsession/ops.go`'s `opTable` (ten entries) has none of the five stash kinds. `RunOp`
  already answers them correctly *as a fallback* — `ErrUnservedOpKind{Kind: "stashPush"}`, mapped by
  `gitrpc/ops.go` to `E_UNKNOWN_METHOD` naming the kind — never a stub, never a silent success, per
  D5's own design (F3 below). This is G16's own tracked finding, re-confirmed here: G16 §0.3
  explicitly named "`stash.list`'s unhandled RPC rejection... already tracked as G14 F14 and owned
  by G17".

### F3 — `opTable`'s extensibility seam already names this phase, twice, under a stale label

`internal/gitsession/ops.go:63-66`:

```go
// ErrUnservedOpKind is RunOp's answer for an OpRequest.Kind not present in opTable (D5) — nine of
// OpRequest's nineteen kinds, each owned by a later phase (G7's tagPush/tagDeleteRemote, G12's
// five stash kinds, G13's reset/cherryPick).
```

`internal/gitsession/preflight.go:61-62` (`PreflightCheckout`'s own `ClassifyCheckoutInput`
construction):

```go
// StashAvailable: false through G5-G8 (D12) — G12's preflightCheckout passes true
// unconditionally, which alone is what turns the "stashAndCarry" route on.
```

`internal/gitpreflight/checkout.go:61-63` (the field's own doc comment) says the identical thing.
Both comments predate SPEC's own 2026-09-07 phase-renumbering commit (`7698873a`, "insert G16,
webview layout collapse fix, renumber G16-G28 to G17-G29") — at the numbering these comments were
written under, stash sat at what is now G17's slot but was then labelled differently; the labels
were never revisited when the renumbering landed. **Both comments name this phase's own job
correctly, under a label that no longer resolves to it.** D10 fixes both, exactly at the two lines
quoted, and nowhere else the renumbering could plausibly have staled a comment (§2 D10 is explicit
about the boundary).

`internal/gitclient/porcelain/types.go:67-72` and `log.go:34-35` show the identical pattern on the
graph side (`WalkSpec.StashShas`/`IncludeStash` — "G8 supplies real stash shas") — **not** touched
by this phase's D10, because D1 keeps graph integration out of scope; fixing that comment's label
without doing the work it describes would be actively misleading, so it is left as-is and D1's own
finding (F6) is the record instead.

### F4 — The classifier this phase ports is already written, already tested, and has no live caller

`packages/git-core/src/preflight/stashPop.ts` exports `classifyStashPop` and `classifyStashBranch`
(112 lines total). `packages/git-core/src/preflight/stashPop.test.ts` covers, in order: clean
prediction/no blockers, conflicting prediction, unknown prediction ("never clean" — reported via the
prediction itself, not folded into a boolean), untracked-collision alone, the probe-3 case (a
stash-untracked path that is *also* reported `dirty` must still only be reached through
`existingPaths`, never through `dirty` membership — the test deliberately withholds `existingPaths`
to prove this), local-changes-would-be-overwritten alone (tracked-only — an untracked dirty path
overlapping `stashPaths` is *not* this blocker), both blockers together in the documented order
(`untrackedCollision` before `localChangesWouldBeOverwritten`), `inProgressOperation` always first,
a blocker alongside an otherwise-clean prediction (verdict `blocked`, prediction still reported
as-is), and pass-through of `stashSha`/`stashIndex`/`targetSha`. `classifyStashBranch`'s five cases:
valid name, invalid name (`bad@{0}`), an already-existing name (a *different* `invalidName` reason
from a malformed one), a blocked nested checkout, and the explicit absence of any `prediction` field
at all ("gets no merge-tree prediction of its own... apply is clean by construction", probe 11).

`grep -rn "classifyStashPop\|classifyStashBranch" .` (repo-wide) finds exactly: the two definitions,
the 22 test-file call sites, one `index.ts` re-export line, and one mention in G5's own plan doc
stating plainly these are "not G5's" to drop — "their server counterparts are G7/G12/G13's" (stale
labels, same renumbering staleness as F3, pointing at what is now this phase). **No production
caller anywhere** — `StashDialog.vue` imports only `validateRefName` from `@kira/git-core`;
`ops.ts` imports only `canRunOp`/`classifyReset` (the *next* phase's own still-live classifier,
confirming the "drop only what you port" pattern is alive and intentional, not an oversight).

### F5 — `StashConflict` cannot be produced by the classification path every other `opTable` entry uses

`OpErrorKind`'s own doc comment (`contract.ts:671-674`) states the mechanism, not just the name:

> P9: a pop/apply merged with conflicts. Deliberately NOT detected from a stderr pattern — a
> conflicting pop writes to stdout and leaves stderr empty (probe 5) — the service classifies it
> from `exitCode !== 0` plus a post-op status read-back finding unmerged paths. The stash is ALWAYS
> kept (§7.6); the message says so.

Every current `opTable` entry's write path is `runWriteArgv` → `gitops.ClassifyOpError(stderr,
exitCode)` on a non-zero exit — a pure function of stderr text. Against a conflicting `stash pop`,
stderr is empty and exit code is non-zero; `ClassifyOpError`'s own `default` arm returns `"Unknown"`,
which is wrong (per the contract's own stated mechanism) and unhelpful (the UI's
`composeStashAnnouncement`/`#reconcileStashPop` already know how to render `StashConflict`
specifically — "the stash is always kept" — but never `Unknown`). `RunOp` already calls
`e.statusAndInProgress(ctx)` immediately after the write loop (for `inProgress`) and **discards its
first return value**, `porcelain.StatusResult` — the exact value a stash-conflict reclassification
needs, already being fetched, for free. No prior `opTable` entry has ever needed this, so the
mechanism does not exist yet; D6 adds it as a small, general seam rather than a stash-only special
case wedged into `RunOp`.

`StashIndexConflict` (`error: conflicts in index. Try without --index.`) and
`StashUntrackedCollision` (the plain "untracked working tree file... would be overwritten" stderr
pattern, but reported as a *stash-specific* kind rather than `checkout`'s own generic
`UntrackedWouldBeOverwritten`, which the existing table already maps that exact phrase to at
`gitops/errors.go:61-63`) both **do** show up in stderr — but the generic `ClassifyOpError` table is
shared across every op kind and would return the wrong sibling kind for a stash pop/apply's own
stderr. D6 covers both.

### F6 — Graph integration was scaffolded upstream but never wired, and wiring it needs new wire surface

- `porcelain.WalkSpec` (`types.go:67-72`) already carries `StashShas []string`/`IncludeStash bool`,
  with a doc comment naming this exact use.
- `porcelain.RevSetArgs` (`log.go:34-51`) already reads both fields — `IncludeStash` appends
  `StashShas` as extra positional revs after `--all`/`HEAD`/a range token.
- `gitsession/walk.go:70-88` already treats `IncludeStash`/`StashShas` as part of a walk's own
  cache-invalidation key (`matchesSpec`), so a change to either forces a fresh walk rather than
  silently serving stale cache.
- `git-core/src/graph/stashRows.ts` — `buildStashRowFilter`/`applyStashRowFilter`, a complete,
  documented, three-behavior filter (drop helper commits reachable only as a stash's own ancestor;
  truncate a stash commit's parent list to `[baseSha]`; synthesize a `{kind:"stash", index}`
  decoration for every stack member beyond `stash@{0}`, since `--decorate=full` can only ever name
  the tip). **Zero callers** — same `grep`-confirmed dead-code state as F4's classifier.
- `kiraVersion.stash.showInGraph` (`package.json:364-368`) ships today, **default `true`**,
  description already written ("stash entries appear as nodes in the commit graph... the walk drops
  refs/stash entirely").

None of `graph.stream`/`graph.loadMore`/`graph.refresh`'s params (`contract.ts:997-1019,1444-1456`)
carry any stash-related field — only `scope`/`pageSize`/`resumeThroughRow`/`range` — confirmed by a
direct `grep` for `includeStash`/`stashShas`/`IncludeStash`/`StashShas` across
`packages/git-ipc/src/contract.ts`: no match. So wiring the setting needs an actual new field on at
least one of those three request shapes — a real wire-shape change, unlike everything else this
phase touches. D1 is the decision this finding feeds.

### F7 — `commands.test.ts` turns "serve the five stash kinds" into "also ship five real commands," mechanically, not optionally

`apps/kira-studio-vscode/src/commands.test.ts` extracts `opTable`'s own keys straight out of
`ops.go`'s source text (`extractOpTableKinds`, brace-counted, anchored on `var opTable =
map[string]opSpec{`) and asserts, for every extracted kind: `MUTATING_COMMANDS[kind]` is a real
`PaletteCommand`, not `{ pending: ... }` (`commands.test.ts:124-133`). The moment `opTable` gains
`stashPush`/`stashApply`/`stashPop`/`stashDrop`/`stashBranch`, this test starts failing against the
tree as it stands today — `commands.ts:93-97` still marks all five `{ pending: 'G15' }`. This is not
a nicety this phase can defer; it is the same mechanism G10 built specifically so a phase could not
serve a kind without also registering its palette command (G10's own D20).

### F8 — `AppToolbar`'s own "Stash ▾" is `BranchPicker.vue`'s stash section, not a second dropdown

`AppToolbar.vue`'s own top doc comment describes `[repo ▾] [branch ▾] │ ⟳ │ Fetch Pull Push │
Stash ▾ │ Search […] ⚙`, but the toolbar's actual template has exactly one stash-related control: a
"Stash changes…" button (`data-testid="stash-changes-button"`) that emits `stash-changes`, handled
by `App.vue` opening `StashDialog.vue`'s create mode. `StashList.vue` — the row list, with Apply/
Pop/Drop/Branch actions per row — is rendered **inside** `BranchPicker.vue` (`:326-330`), which
receives `stash: StashState` as a prop and already forwards its `branchFromStash` emit outward. So
the existing `'openBranchPicker'` `UiActionKind` (already used for `branchDelete`/`tagDelete`/
`branchRename`/`checkout`, `App.vue:624-626`, `toolbarRef.value?.openBranchPicker()`) **already
opens the surface that contains the stash list** — no second picker component exists or needs to.
This is what makes D9's palette-command design for `stashApply`/`stashPop`/`stashDrop`/
`stashBranch` a zero-new-UI reuse rather than a new component.

### F9 — `commit.fileDiff` needs no change for a stash's own diff pane

`StashState.#requestFileDiff` (`packages/git-ui/src/state/stash.ts:165-210`) already calls
`commit.fileDiff` with `sha: entry.sha, parentIndex: 0` for a tracked file (a stash commit's own
tree diffed against its base — exactly what a commit's `fileDiff` at `parentIndex: 0` already means,
since a stash commit is a real commit with `baseSha` as parent 1), retrying once against
`entry.untrackedSha` for a path the first request 404s on (the untracked helper commit has no
`baseSha` of its own, so it lands on the same "root commit" path `commit.fileDiff` already serves
for any parentless sha). **Both code paths this depends on already exist from G4** — a stash entry
is, to `commit.fileDiff`'s own Go handler, indistinguishable from any other commit sha. Confirmed
by reading `stash.ts`'s own doc comment, which already states this is deliberate reuse, not a gap:
"no dedicated `stash.fileDiff` endpoint exists... a real, minor inefficiency... accepted in place of
a new wire endpoint." **No `gitrpc`/`gitsession` change needed for the diff pane at all.**

---

## 2. Decisions

### D1 — Graph integration (`kiraVersion.stash.showInGraph`) is out of scope for G17

The setting stays exactly as inert as F6 found it — not fixed, not removed, not degraded further.
Three considerations, weighed against each other rather than picked from:

- **SPEC's own G17 row is specific, and specifically silent on this.** "Stash + `merge-tree` pop
  prediction, wired into G5's blocked-checkout resolution" names one integration point. Compare
  G20's own row, which spells out its graph integration in detail ("a small indicator in the commit
  graph on any commit that belongs to a PR... resolved by commit membership"). When this chapter's
  SPEC wants a phase to touch the graph, it says so; here it doesn't.
- **It is the one piece of this phase that needs new wire surface.** Every other part of G17 (§0.2)
  needs zero changes to `packages/git-ipc` — F1 established the whole CRUD/preflight contract
  already exists at version 21. Graph integration alone would force a `CONTRACT_VERSION` bump to 22
  for a field SPEC's own row never asked for, changing this phase's blast radius from "four new
  handlers behind an already-shipped contract" to "a wire-format change plus four new handlers."
- **The scaffolding's own presence argues the other way, and is worth stating plainly rather than
  waved past.** `WalkSpec.StashShas`/`IncludeStash`, `walk.go`'s cache-key inclusion of both, and
  `stashRows.ts`'s complete filter were all clearly built *for* this integration, by whoever ported
  `git-core`/`gitclient/porcelain` wholesale — and a default-`true` setting that silently does
  nothing is exactly the shape CLAUDE.md's own git-core-cleanup precedent (commit `90b85c05`'s own
  message: "a user-editable setting that silently does nothing is worse than no setting") argues
  against leaving in place.

That third point is real, which is why this is a **§10.1 human-eye item**, not a silent omission —
but on balance, matching what SPEC's own row actually asks for, and given the honest size difference
between "reuse an existing contract" and "add to it," this plan does not build it. See §10.1 for the
override path if a reviewer weighs it the other way.

### D2 — `ClassifyStashPop`/`ClassifyStashBranch`: a direct Go port, field for field, blocker order for blocker order

New file `internal/gitpreflight/stash.go`. The port is mechanical enough to state as a table rather
than prose — every name on the left is `stashPop.ts`'s own, on the right is this phase's Go:

| TypeScript | Go |
|---|---|
| `classifyStashPop(input)` | `ClassifyStashPop(in ClassifyStashPopInput) StashPopPreflight` |
| `classifyStashBranch(input)` | `ClassifyStashBranch(in ClassifyStashBranchInput) StashBranchPreflight` |
| `input.stash: StashEntry` | `in.Stash StashEntry` (new Go type, §3.1) |
| `input.prediction: MergeOutcomePrediction` | `in.Prediction MergePrediction` (reuse `porcelain.MergePrediction`, already shaped `{Kind, Paths, ...}` — no new prediction type) |
| `input.stashPaths` / `stashUntrackedPaths` | `in.StashPaths` / `in.StashUntrackedPaths []string` |
| `input.dirty: DirtyPath[]` | `in.Dirty []gitpreflight.DirtyPath` (already exists, used by `ClassifyCheckout`/`ClassifyRevert`) |
| `input.existingPaths` | `in.ExistingUntrackedPaths []string` (renamed for clarity at the Go boundary — see D4 for what computes it) |
| `input.inProgress` | `in.InProgress *InProgressOperation` (already exists) |
| blocker order: `inProgressOperation`, `untrackedCollision`, `localChangesWouldBeOverwritten` | same three `if` statements, same order, same comment explaining why (moots every other remedy first) |
| `verdict`: blocked > willConflict > clean, "unknown never clean" | identical three-way `switch` |
| `classifyStashBranch`'s nested `CheckoutPreflight` | reuse `gitpreflight.CheckoutPreflight` (already exists, §7 of `checkout.go`) — no new type |

Twenty-two test cases from `stashPop.test.ts` become twenty-two Go subtests in `stash_test.go`
(§3.4), same input shapes, same assertions — the *probe 3* case ("a stash-untracked path that
merely happens to also be dirty is still only reachable via `existingPaths`, not `dirty`
membership") is named explicitly in its own Go subtest, not folded into a generic case, because it
is exactly the kind of "looks redundant, isn't" assertion a later refactor could silently break.

### D3 — `stash.list`/`stash.show`: one spawn each, matching the contract's own doc comments exactly

`stash.list`'s own comment (`contract.ts:1273`) already specifies the spawn: `stash list -z
--numstat -M -C --format=…`. New `porcelain.StashListArgs()`/`ParseStashList(raw []byte, baseSubjects
map[string]string) ([]StashEntry, error)` in a new `porcelain/stash.go`:

- **Format string.** `%gd%x1f%H%x1f%P%x1f%gs%x1f%at` (`%gd` = `stash@{N}`-shaped reflog selector,
  which is how the index is read back without relying on output order alone; `%P` gives all parents
  space-separated — `baseSha` is the first, `indexSha` the second, `untrackedSha` the third if
  present, mirroring `model/stash.ts`'s own "Parent 1/2/3" doc comments exactly). `-z`'s NUL framing
  and the numstat block that follows each entry both reuse `RecordSplitter`/`ParseNumstatRecords`
  (already exist, §7.6 of `difftree.go`) for `fileCount` (`len(numstat)` for that entry — tracked
  files only, per the contract's own doc comment: "Untracked files are never counted here").
- **`baseSubject`.** `model/stash.ts`'s own doc comment states the mechanism directly: `%gs` cannot
  name a *parent's* subject, so one extra batch spawn (`log --no-walk --format=%H%x1f%s -z
  <distinct baseShas...>`) resolves every entry's `baseSubject` in one call, keyed back by sha — a
  direct, small port of that same comment's own prescription, not a new design.
- **`branch`.** Parsed from `message`'s own `WIP on <b>: `/`On <b>: ` prefix (`model/stash.ts`'s own
  doc comment names the two prefixes and the detached-HEAD `null` case verbatim); a small, pure Go
  string-prefix function, not a spawn.
- **`includedUntracked`.** `len(parents) == 3`.

`stash.show`'s own comment (`contract.ts:1278`) specifies the pair already used for `commit.detail`
— `NumstatArgs`/`NameStatusArgs`/`CombineFileChanges` (§ F7 above, all three already exist), called
with `from: &entry.baseSha, to: entry.sha`, plus `-u` widened to also list the untracked helper
commit's own tree (`ls-tree -r --name-only -z <untrackedSha>`, each path folded into the same
`[]FileChange` as `FileAdded` — untracked content by definition has no "before") when
`entry.untrackedSha != nil`. **No new `FileChange` shape** — `stash.show`'s result is exactly
`{sha, changes: FileChange[]}`, already declared.

### D4 — `ExistingUntrackedPaths`: a real filesystem check, not a git spawn

Probe 3's own language — "an ignored file, or one status elides" — rules out relying on `git status`
membership (default `status --porcelain=v2` omits ignored paths by design). The Go orchestration
(`gitsession.PreflightStashPop`, §3.3) resolves this the simplest correct way: `os.Stat(filepath.Join
(repoWorkingDir(e.Summary), path))` for each of `stash.show`'s own already-resolved
`stashUntrackedPaths` (bounded to the small number of files a stash's own untracked half actually
touches — never a directory walk, never a full-tree scan). This needs no new package: `repoWorkingDir`
already exists (`gitsession/queries.go:38`) and is exactly the root every other path-relative check
in this phase already resolves against.

### D5 — `gitops/stash.go`: five argv builders, matching the contract's own addressing rules verbatim

New file, matching `gitops/branch.go`'s own style (one function per verb, one doc comment per
function naming the git flags and, where a probe fixed a non-obvious detail, that probe):

```go
// StashPushArgs builds `stash push [-u] [-k] [-m <message>] [-- <paths...>]` (probe 8: a raw sha
// is never used for push — there is nothing to address yet).
func StashPushArgs(message *string, includeUntracked, keepIndex bool, paths []string) []string

// StashApplyArgs builds `stash apply [--index] <sha>` — apply accepts a raw sha directly (probe 8),
// so no stash@{index} translation is needed here at all.
func StashApplyArgs(sha string, restoreIndex bool) []string

// StashPopArgs builds `stash pop [--index] stash@{<index>}` — pop REFUSES a raw sha (probe 8), so
// this addresses by stack position; the caller verifies `rev-parse stash@{index} == sha`
// immediately before this runs (D6's own reclassification step reuses that same read).
func StashPopArgs(index int, restoreIndex bool) []string

// StashDropArgs builds `stash drop stash@{<index>}` — same addressing rule as pop.
func StashDropArgs(index int) []string

// StashBranchArgs builds `stash branch <name> stash@{<index>}` — `stash branch` applies but
// SILENTLY NEVER DROPS when given a raw sha (probe 8), so, like pop and drop, this always
// addresses by stack position, never by sha.
func StashBranchArgs(name string, index int) []string
```

### D6 — `RunOp` gains one small, general seam: `opSpec.Reclassify`, called with the post-write status it already fetches

The minimal-diff answer to F5. `opSpec` (`ops.go:86-89`) gains one new, optional field:

```go
type opSpec struct {
	Undo       gitpreflight.UndoPolicy
	Prepare    func(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error)
	// Reclassify: nil for every kind that does not need it (ten of ten today). When set, called
	// AFTER the write loop and AFTER the post-write statusAndInProgress read RunOp already performs
	// — reusing that read, not adding a second one — with the raw OpError the stderr-only
	// classification produced (nil on a clean exit) and the fresh porcelain.StatusResult. Returns
	// the OpError RunOp should actually report; a kind with no Reclassify keeps the stderr-only
	// result unchanged.
	Reclassify func(opErr *OpError, status porcelain.StatusResult) *OpError
}
```

`RunOp`'s own body (`ops.go:358-378`) changes at exactly one point: the `statusAndInProgress` call
already assigns its first return to `_`; that becomes a named `statusResult`, and immediately after
it, `if spec.Reclassify != nil { opErr = spec.Reclassify(opErr, statusResult) }`, before the
existing `succeeded := opErr == nil` line. **No other `opTable` entry's behavior changes** — a nil
`Reclassify` is a no-op by construction, and the field's own doc comment states the "ten of ten
today" fact so the day an eleventh kind needs it, this is the seam it reaches for rather than a new
one.

`stashPop`/`stashApply`'s own `Reclassify`:

```go
func reclassifyStashPop(opErr *OpError, status porcelain.StatusResult) *OpError {
	if opErr == nil {
		return nil
	}
	if len(gitpreflight.UnmergedPaths(status)) > 0 {
		// Probe 5: the stash is ALWAYS kept on a conflicting pop/apply — never a second write, never
		// a drop. The contract's own OpErrorKind doc comment states the message says so; composeStash-
		// Announcement (git-ui, already built) renders exactly that sentence.
		return &OpError{Kind: "StashConflict", Message: "The stash was applied with conflicts and has been kept."}
	}
	return opErr // an already-classified error (StashIndexConflict, StashUntrackedCollision, or
	              // anything ClassifyOpError's generic table caught) passes through unchanged.
}
```

`stashApply`/`stashPop` share this `Reclassify`; `stashPush`/`stashDrop`/`stashBranch` set it to
`nil` — a genuinely non-zero exit from any of those three is already correctly classified by
`ClassifyOpError`'s existing table (D5's own argv never produces the empty-stderr case F5 describes
for anything but pop/apply).

`gitpreflight.UnmergedPaths(status porcelain.StatusResult) []string` is a small new helper —
`statusAndInProgress`'s own caller already derives an in-progress operation's `ConflictedPaths` from
this exact `StatusResult`; this phase factors that extraction out to a named function both call
sites share, rather than duplicating the unmerged-path scan inline a second time.

### D7 — `ClassifyOpError`'s table gains two stash-specific rows, ahead of the generic ones they would otherwise collide with

`gitops/errors.go`, two new `case` arms inserted **immediately before** the existing "untracked
working tree file" row (`:61-63`) — order matters here exactly as it does for every other row in
this table (a more specific pattern must precede the general one it would be swallowed by):

```go
case strings.Contains(lower, "conflicts in index"):
	// Probe 10: `apply --index`/`pop --index` onto an already-conflicted index. Distinct from
	// StashConflict: git names its own remedy exactly (retry with restoreIndex: false).
	return "StashIndexConflict", message
```

The existing `"untracked working tree file"` row stays exactly as it is (still returns
`UntrackedWouldBeOverwritten`) for every op kind **except** stash pop/apply — which need
`StashUntrackedCollision` instead for the identical stderr text (probe 3's own framing: this is the
untracked half of the stash colliding with something already on disk, a stash-specific remedy story
different from a checkout's). Since `ClassifyOpError` is shared across every `opTable` entry and has
no notion of "which kind is asking," this one row cannot be resolved inside the shared table without
either duplicating the whole function or threading a kind parameter through every existing caller.
The chosen fix: `runWriteArgv` (`ops.go:289-310`) gains no change; instead, `stashPop`'s/
`stashApply`'s own `Reclassify` (D6) additionally remaps `UntrackedWouldBeOverwritten` →
`StashUntrackedCollision` when the incoming `opErr.Kind` is that value — a three-line addition to
`reclassifyStashPop`, not a second classification table. This keeps `ClassifyOpError` itself
single-purpose (one stderr string, one kind, no caller context) and puts the one case that genuinely
needs caller context exactly where the other caller-context-dependent case (`StashConflict`) already
lives.

### D8 — `PreflightCheckout`'s `StashAvailable` flips to `true`, unconditionally, in this phase

`gitsession/preflight.go:34`, one line: `StashAvailable: true` (was the hardcoded `false` since G5).
This alone is what turns `checkout.go`'s already-written `stashAndCarry` route on (`ClassifyCheckout`
already reads `in.StashAvailable` at `checkout.go:119`; nothing else in that function changes). Once
this lands, the wire's own `CheckoutPreflight.routes` can carry `"stashAndCarry"` for the first time,
and `ops.ts`'s already-built `#stashAndCarry` (git-ui, F-confirmed complete) starts actually running
instead of never being reachable. The equivalent flip for pull's own `RouteStashAndCarry`
(`gitpreflight/pull.go:111-125`) needs **no corresponding change** — reading that file (§1 of this
plan's own investigation) shows `routes` already appends `RouteStashAndCarry` unconditionally
whenever any blocker exists (comment: "F19: the only PullBlocker there is"), with no availability
gate to flip at all; pull's own route has been live since G7 and simply had nothing to push a stash
onto until this phase's `stashPush`/`stashPop` exist.

### D9 — Palette commands: one new `UiActionKind` for `stashPush`, four reused `openBranchPicker`s for the rest

Per F7 (mandatory) and F8 (what makes this cheap):

- **`stashPush` → new `UiActionKind` member `'stashChanges'`.** `commands.ts`:
  `stashPush: { command: 'kiraVersion.stashChanges', title: 'Stash Changes…', action:
  'stashChanges' }`. `App.vue`'s `runUiAction` (`:619-673`) gains one case:
  `case 'stashChanges': stashCreateOpen.value = true; break;` — the exact same assignment the
  toolbar's own `@stash-changes` handler already makes (`App.vue:1068`), so this is a second entry
  point into the same dialog, never a second implementation (matching every existing
  `UiActionKind` case's own stated convention, `contract.ts:918-925`).
- **`stashApply`/`stashPop`/`stashDrop`/`stashBranch` → reuse `'openBranchPicker'`.** `commands.ts`:
  each becomes `{ command: 'kiraVersion.<verb>Stash', title: '<Verb> Stash…', action:
  'openBranchPicker' }` — identical in shape to `branchDelete`'s/`tagDelete`'s own existing entries,
  which already open the same `BranchPicker.vue` a stash-specific action from the palette would open
  anyway (F8), landing the user on the exact `StashList.vue` section that already has row-level
  Apply/Pop/Drop/Branch actions (`buildStashMenu`, already built). **No new `UiActionKind` member**
  for these four — reusing an existing one that already does the right thing is the same judgment
  call `branchDelete`/`tagDelete`/`branchRename` already made, not a new pattern being introduced
  here.

Four distinct manifest command ids are still needed even though all four share one action (a
palette entry needs its own title regardless of what it dispatches to) — `commands.test.ts`'s
uniqueness check (`:178-182`) requires it, and a single "Stash: Manage…" entry covering all four
`OpRequest` kinds at once would leave three of `opTable`'s five stash kinds without their own command
at all, failing F7's own per-kind requirement.

### D10 — Stale-comment cleanup: exactly two files, exactly the lines F3 names, nothing broader

This phase's own diff already touches `ops.go` and `preflight.go`; F3 found each carries one stale
`G12`/`G13`-labelled comment naming this phase's own job. Both get corrected to `G17` in the same
commit that changes the code beside them — a drive-by fix at a place the diff already is, not a
separate sweep. **Not touched**: `gitclient/porcelain/types.go:67-72` and `log.go:34-35` (F3's own
closing note — D1 keeps that work out of scope, so relabelling a comment describing unbuilt work
would read as a promise this phase does not keep); `commands.ts:39-46`'s own `G15`/`G16` comment,
which is corrected **only for the stash half** (the sentence naming "G15 owns the five stash kinds"
becomes accurate; the `G16`/reset-cherryPick/tagPush half of the same comment is left as its own
next phase's problem, since fixing half a stale sentence and leaving the other half is exactly the
kind of small, contained edit this phase's own diff already justifies, while rewriting the
reset/cherryPick half would be scope this phase has no standing to decide).

---

## 3. The Go side, file by file

### 3.1 `apps/kira-studio/internal/gitpreflight/stash.go` — **new** (D2)

`StashEntry` (Go mirror of the wire type — `Index int`, `Sha`, `BaseSha`, `BaseSubject`, `IndexSha`,
`UntrackedSha *string`, `Message`, `Branch *string`, `Timestamp int64`, `FileCount int`,
`IncludedUntracked bool`), `StashPopBlocker` (flattened struct, `Kind`/`Paths`/`Operation`, same
convention as `CheckoutBlocker`), `StashPopPreflight`, `StashBranchPreflight`,
`ClassifyStashPopInput`, `ClassifyStashBranchInput`, `ClassifyStashPop`, `ClassifyStashBranch`,
`UnmergedPaths(porcelain.StatusResult) []string` (D6's shared helper). All field-for-field ports per
D2's table; every doc comment names the probe it encodes, matching `checkout.go`'s/`revert.go`'s own
convention of citing the probe number rather than re-deriving the reasoning inline.

### 3.2 `apps/kira-studio/internal/gitclient/porcelain/stash.go` — **new** (D3)

`StashFormat` constant (`%gd%x1f%H%x1f%P%x1f%gs%x1f%at`), `StashListArgs()`, `StashBaseSubjectArgs
(shas []string)` (the batch `log --no-walk` spawn), `ParseStashList(listRaw, subjectsRaw []byte)
([]StashEntry, error)`, `StashShowArgs(baseSha, sha string) (numstat, nameStatus []string)` (thin
wrapper over the already-existing `NumstatArgs`/`NameStatusArgs`), `StashUntrackedLsTreeArgs(sha
string) []string`, and the small `parseBranchFromMessage(message string) *string` prefix parser.

### 3.3 `apps/kira-studio/internal/gitsession/preflight.go` — edited (D8, plus two new orchestration methods)

- Line 34: `StashAvailable: true` (D8).
- **New** `PreflightStashPop(ctx, sha string, index int, targetSha *string) (gitpreflight.
  StashPopPreflight, error)`: resolves the stash entry (via a `stash.list` re-read — matching
  `stash.list`'s own contract comment, "verifies immediately before writing" applies equally to a
  preflight read, since a stack reshuffle between list and preflight is exactly the race the
  sha-verification convention throughout this feature exists to catch), runs `stash.show`'s own
  numstat for `stashPaths`, an `ls-tree` for `stashUntrackedPaths`, `statusAndInProgress` for `dirty`/
  `inProgress`, D4's fs-stat loop for `existingUntrackedPaths`, and the merge-tree prediction (D3
  below) — **always with `--merge-base=<baseSha>`**, per probe 2's own explicit warning ("omitting
  `--merge-base=<stash^>` makes a genuinely conflicting pop report clean") — against `targetSha ??
  HEAD` (the `stashAndCarry` route's own use of a non-HEAD target, per the contract's own doc
  comment on `preflight.stashPop`'s `targetSha` param). Calls `gitpreflight.ClassifyStashPop`.
- **New** `PreflightStashBranch(ctx, sha, branch string) (gitpreflight.StashBranchPreflight, error)`:
  resolves the entry, calls the existing `PreflightCheckout`-shaped classification path at
  `resolved.baseSha` as the target (probe 11: "no pop prediction — clean by construction," so this
  reuses `ClassifyCheckout`, never `ClassifyStashPop`), plus the existing branch-name validation
  already shared with `branchCreate` (`gitops`'s own ref-name validator, already used by G5). Calls
  `gitpreflight.ClassifyStashBranch`.

### 3.4 `apps/kira-studio/internal/gitpreflight/stash_test.go` — **new** (D2, D11)

Twenty-two `ClassifyStashPop` subtests plus five `ClassifyStashBranch` subtests, one per case listed
in F4, same input shapes and assertions as `stashPop.test.ts`'s own, re-expressed as Go table tests
in this package's existing style (`checkout_test.go`/`revert_test.go`'s own table-test convention).
The probe-3 case gets its own named subtest, exactly as the TypeScript original isolates it.

### 3.5 `apps/kira-studio/internal/gitclient/porcelain/stash_test.go` — **new** (D3, D11)

Golden-fixture parser tests, matching this package's existing convention (`fixtures_test.go`'s own
pattern — a captured real `git stash list -z --numstat -M -C --format=…` byte sequence, not a
hand-typed approximation): a two-entry stack (one with `-u`, one without), an entry whose message has
no `WIP on`/`On` prefix at all (a `store`-restored stash, per `model/stash.ts`'s own doc comment on
why `%gs` and not `%s` is used — the exact case that motivates that choice), and a detached-HEAD
entry (`On (no branch): …` → `Branch: nil`).

### 3.6 `apps/kira-studio/internal/gitops/stash.go` — **new** (D5)

The five argv builders, plus `StashRevParseArgs(index int) []string` — the sha-verification spawn
(`rev-parse stash@{<index>}`) `pop`/`drop`/`branch`'s own `Prepare` functions each run immediately
before writing, comparing the result against the caller's own `sha` and refusing (an `earlyError`,
no write ever spawned — the same shape `prepareSequencerVerb` already uses for its own early
refusals) on a mismatch, per the contract's own "the service verifies... immediately before writing"
convention (`contract.ts:603-604`).

### 3.7 `apps/kira-studio/internal/gitops/errors_test.go` — edited (D7)

One new table row for `"conflicts in index"` → `StashIndexConflict`.

### 3.8 `apps/kira-studio/internal/gitsession/ops.go` — edited (D6, plus five new `opTable` entries)

- `opSpec` gains `Reclassify` (D6).
- `RunOp`'s body: the discarded `_` becomes `statusResult`, and the one new `if spec.Reclassify !=
  nil` block (D6), inserted between the existing `statusAndInProgress` call and `succeeded := opErr
  == nil`.
- `OpRequest` struct gains the fields the five stash kinds need and no others currently declared
  (`Message *string`, `IncludeUntracked bool`, `KeepIndex bool`, `Paths []string`, `Sha string`,
  `Index int`, `RestoreIndex bool`, `Branch string` — `Branch`/`Name` already exist for
  `branchCreate`/`tagCreate`, reused rather than duplicated where the JSON tag already matches).
- Five new `opTable` entries: `stashPush`/`stashApply`/`stashPop`/`stashDrop`/`stashBranch`, each
  with `Undo: gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "..."}` (upstream's
  own `UNDO_POLICY` names none of the five as undoable — a stash mutation's own natural undo is
  another stash op, not the undo slot's replay mechanism, matching OQ8's own doc comment already in
  `ops.ts`: "the very next operation clears it") and a `Prepare` function per D5/D6.
- `reclassifyStashPop` (D6/D7), `UnmergedPaths` reused from `gitpreflight` (not redefined here).

### 3.9 `apps/kira-studio/internal/gitsession/ops_test.go` — edited (D11)

`TestOpTable_EveryEntryStatesAnUndoPolicy` (already exists, per `ops.go`'s own doc comment on why
`Undo`/`Prepare` live in one struct literal) needs no change in shape — it already iterates every
`opTable` entry; the five new ones are covered by construction. One new test:
`TestRunOp_StashPopConflict_Reclassifies` — a real repo fixture (two branches diverging on the same
line of the same file, a stash pushed on one, `stash pop` run after switching), asserting the result
is `OpResult{OK: false, Error: &OpError{Kind: "StashConflict", ...}}`, never `Unknown`, and that the
stash entry still exists afterward (`stash list` unchanged) — the concurrency/interacting-rules
carve-out CLAUDE.md names applies directly here (D6 is genuinely new logic, not a thin wrapper).

### 3.10 `apps/kira-studio/internal/gitrpc/ops.go` — **not edited**

Confirmed by re-reading `handleOpRun` (§ this plan's own investigation, F2): it is already fully
generic over `OpRequest.Kind`. Once `opTable` serves the five stash kinds, `op.run` serves them too,
with zero changes to this file.

### 3.11 `apps/kira-studio/internal/gitrpc/handlers.go` — edited

Four new `case` arms in `Router.ForConn`'s `Request` switch, alongside the existing `preflight.*`
cases: `"stash.list"`, `"stash.show"`, `"preflight.stashPop"`, `"preflight.stashBranch"` — thin
dispatch, matching `handlePreflightCheckout`/`handlePreflightRevert`'s own shape exactly (decode
params, validate required fields, `entryFor`, call one `RepoEntry` method, `mapGitError` on failure).

### 3.12 `apps/kira-studio/internal/gitrpc/ops.go` (new file, `stash.go` alongside `handlers.go`, or a new `gitrpc/stash.go`) — **new handlers**

`handleStashList`, `handleStashShow`, `handlePreflightStashPop`, `handlePreflightStashBranch` — four
functions, same D20 shape ("thin dispatch... none of them detach ctx — that's `op.run`/`undo.run`'s
own concern") the existing `refs.go` comment already states for this exact category of handler.

### 3.13 `apps/kira-studio/internal/gitrpc/wire.go` — edited

`StashListParams`, `StashShowParams`, `PreflightStashPopParams`, `PreflightStashBranchParams` —
plain param structs matching the contract's own field names, same convention as every existing
`*Params` type in this file.

### 3.14 `apps/kira-studio/internal/gitsession/entry.go`, `internal/gitsession/queries.go` — **not edited**

`repoWorkingDir`, `runOne`, `runAllowingExit`, `e.Repo.Write` all already exist in the exact shape
this phase needs (confirmed by direct reading, not assumed) — no new spawn-plumbing primitive is
required anywhere in this phase.

### 3.15 Doc-comment fixes (D10)

- `gitsession/ops.go:63-66` — `"G12's five stash kinds, G13's reset/cherryPick"` →
  `"G17's five stash kinds, G18's reset/cherryPick"`.
- `gitsession/preflight.go:61-62` and `gitpreflight/checkout.go:61-63` — `"G12's preflightCheckout
  passes true unconditionally"` → past tense, stating this phase did it (`"G17's preflightCheckout
  passes true unconditionally"` reads oddly once it's already true; phrase as `"G5-G16: false. G17
  flips it — see D8"` or equivalent, implementer's own call on exact wording, not prescribed further
  here since it is prose, not a contract).

---

## 4. The TypeScript / Vue side, file by file

### 4.1 `packages/git-core/src/preflight/stashPop.ts` — **deleted** (D2's port supersedes it)

### 4.2 `packages/git-core/src/preflight/stashPop.test.ts` — **deleted**

### 4.3 `packages/git-core/src/index.ts` — edited

Line 128 (`export { classifyStashBranch, classifyStashPop } from './preflight/stashPop.ts';`)
removed. `StashPopBlocker`/`StashPopPreflight`/`StashBranchPreflight` type re-exports from
`./preflight/types.ts` (line ~149's block) — **checked, not assumed removable**: `git-ipc/src/
contract.ts`'s own structural copies are independent of `git-core`'s types (B3: `core` and `ipc`
both depend on nothing), so these three type exports may still be load-bearing for `git-core`'s own
internal consumers (`model/operation.ts`'s own comment, F4-quoted above, references
`classifyStashPop`'s *behavior* in a comment, not the type) — the implementer confirms via `grep`
before removing any type export, removing only what F4's own "no live caller" grep already proved
dead (the two function exports), not the adjacent type exports, unless the same grep proves those
dead too.

### 4.4 `packages/git-ipc/src/contract.ts` — **not edited** (F1)

### 4.5 `packages/git-ui/**` — **not edited**, except two small, additive `App.vue`/`commands.ts`-adjacent wires

- `packages/git-ui/src/App.vue`: one new `case 'stashChanges':` in `runUiAction` (D9).
- No other file in `packages/git-ui` changes. `StashState`, `StashList.vue`, `StashDetailPane.vue`,
  `StashDialog.vue`, `rowMenuModel.ts`'s `buildStashMenu`, `refBadges.ts`'s stash-badge handling,
  `OpsState`'s `runStashPush`/`runStashApply`/`runStashPop`/`runStashDrop`/`runStashBranch`/
  `previewStashBranch`/`#stashAndCarry` — all confirmed complete and correct against the same
  contract this phase implements server-side (§1's own investigation read every one of these files).
  **Zero known bugs in any of them** — this phase's own job is making the RPC calls they already
  make succeed, not fixing anything about how they're made.

### 4.6 `packages/git-ipc/src/contract.ts`'s `UiActionKind` — edited (D9)

One new member, `'stashChanges'`, with a doc comment matching every existing member's own convention
(naming the phase and what it opens).

### 4.7 `apps/kira-studio-vscode/src/commands.ts` — edited (D9, F7, D10)

- `MutatingEntry`'s own type (`: PaletteCommand | { readonly pending: 'G15' | 'G16' }`) — the `'G15'`
  member of that union becomes unreachable once every entry that used it is real; the type keeps
  `'G16'` (still used by `tagPush`/`tagDeleteRemote`/`reset`/`cherryPick`) and drops `'G15'`.
- Five `MUTATING_COMMANDS` entries (`stashPush`/`stashApply`/`stashPop`/`stashDrop`/`stashBranch`)
  become real `PaletteCommand`s per D9.
- The top-of-file `MutatingEntry` doc comment (`:38-46`) — the sentence "G15 owns the five stash
  kinds" is corrected (D10); the `G16` half is left as-is.

### 4.8 `apps/kira-studio-vscode/package.json` — edited (D9)

Five new `contributes.commands` entries: `kiraVersion.stashChanges` ("Stash Changes…"),
`kiraVersion.applyStash` ("Apply Stash…"), `kiraVersion.popStash` ("Pop Stash…"),
`kiraVersion.dropStash` ("Drop Stash…"), `kiraVersion.createBranchFromStash` ("Create Branch from
Stash…") — all under `CATEGORY` ("Kira Version"), matching every existing entry's own shape.
`commands.test.ts`'s own cross-check (§F7) is what proves title/category/uniqueness are all correct,
not a manual check.

### 4.9 Not edited

`packages/git-ipc/schema/gitwire.fbs` (no FlatBuffers shape changes — everything this phase's RPCs
return is plain JSON, matching `stash.list`'s/`stash.show`'s own contract shapes, which were never
FlatBuffers to begin with), `apps/kira-studio-vscode/src/extension.ts`/`panelView.ts`/`reviewView.ts`
(no new webview wiring — `runUiAction`'s existing dispatch already reaches every view that needs
this), `packages/git-core/src/settings/schema.ts` (D1 — `stash.showInGraph`/`stash.includeUntracked`
are untouched either way; the former stays inert, the latter is already fully functional as a
client-only dialog default).

---

## 5. Dependencies and tooling

Nothing new. `merge-tree`, `stash`, `ls-tree`, `log --no-walk` are all ordinary git subcommands
already exercised elsewhere in this codebase's test fixtures (a 2.38 git floor already covers every
flag this phase uses — `--merge-base` on `merge-tree` has been available since git 2.38, matching
the discovery floor SPEC's own driver section already enforces).

---

## 6. Implementation order

One sequential subagent — the Go side is order-dependent (parser → classifier → orchestration →
handler → opTable), and the TypeScript side is small enough not to warrant a second one.

1. **`porcelain/stash.go` + its test** (D3, §3.2/3.5) — the parsing foundation everything else reads.
2. **`gitpreflight/stash.go` + its test** (D2, §3.1/3.4) — the classifier, provably correct against
   the ported 22+5 cases before anything spawns real git.
3. **`gitops/stash.go`** (D5, §3.6) — argv builders, plus the `errors.go` row (D7, §3.7).
4. **`ops.go`'s `Reclassify` seam + the five `opTable` entries** (D6, §3.8), **`preflight.go`'s two
   new orchestration methods + the `StashAvailable` flip** (D8, §3.3), the `ops_test.go` conflict
   test (§3.9). `go test ./apps/kira-studio/internal/...` (scoped per SPEC's own "Full verification
   scope" note — the git packages plus the layering test, not the whole tree).
5. **`gitrpc`'s four handlers + wire types** (§3.11-3.13). Manual smoke: `stash.list`/`stash.show`
   against a repo with a real stash, `op.run` for each of the five kinds, `preflight.stashPop`/
   `preflight.stashBranch` against a deliberately conflicting case.
6. **`gitsession/ops.go`'s two doc-comment fixes** (D10, §3.15) — same commit as step 4, since that
   is where the diff already touches those lines.
7. **`git-core`'s deletion** (§4.1-4.3) — done only after step 4's Go classifier is proven correct,
   never before (deleting the reference before the port is verified against it would remove the
   thing being ported from).
8. **`commands.ts`/`package.json`/`App.vue`'s `stashChanges` case** (D9, §4.6-4.8) — `bun run
   test:unit` (which runs `commands.test.ts`) is what proves this step is both necessary and
   sufficient; it fails before this step (once step 4 lands) and passes after.
9. Full check pass: `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run build:vscode`,
   `go test ./apps/kira-studio/internal/...` (the SPEC-scoped git-package set), `git diff --stat
   packages/git-ipc` (must be empty, proving F1's "no contract change" finding held).

Commits land incrementally, Conventional Commits, roughly one per numbered step.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/...` (SPEC-scoped set) passes, including the 22+5
   `ClassifyStashPop`/`ClassifyStashBranch` subtests, the `porcelain/stash_test.go` golden-fixture
   tests, `errors_test.go`'s new row, and `TestRunOp_StashPopConflict_Reclassifies`.
2. `bun run test:unit` passes, including `commands.test.ts`'s own cross-check now covering all five
   stash kinds as real, non-`pending` commands.
3. `bun run lint`, `bun run typecheck`, `bun run build:vscode` all pass.
4. `git diff --stat -- packages/git-ipc` is empty (F1's "no contract change" claim, checked, not
   assumed) — and `CONTRACT_VERSION`/`ContractVersion` are both still 21/`21` (`grep`, both sides).
5. `grep -c stashPop.ts packages/git-core/src/index.ts` is 0 (D2's deletion actually landed).
6. A manual `op.run` smoke test for each of the five stash kinds against a real repo in this
   container (no UI needed — a raw socket client, matching G1's own end-to-end proof pattern),
   including one deliberately conflicting `stashPop` and confirming the result is
   `{ok: false, error: {kind: "StashConflict", ...}}` with the stash entry still present afterward.

### 7.2 Tier 2 — provable here as a reasoned check, not a full proof

7. **The client's own five-op flow is correct by inspection, not re-tested.** §4.5's own finding
   (`StashState`/`OpsState`/every stash component already read and found correct against this exact
   contract) is the evidence; this phase adds no new client logic to re-verify beyond the one
   `runUiAction` case, which `commands.test.ts` already indirectly proves is reachable (a command
   with no matching `runUiAction` case would leave a palette entry that does nothing — not caught by
   any existing test, so the implementer confirms this one case by reading `App.vue`'s own switch
   after editing it, the same way D9 prescribes the change).
8. **`stash.showInGraph` is no worse than before.** The setting's own default (`true`) and
   description are unchanged; nothing this phase does removes or degrades whatever the pre-phase
   state was (nothing, per F6) — checked by `git diff --stat` on `package.json`'s settings block and
   on every file `graph/stashRows.ts` touches (none, confirmed by `grep`).

### 7.3 Tier 3 — needs a human on a Mac, with VS Code and Kira Studio both running

9. The full round trip: dirty worktree → "Stash Changes…" (toolbar or palette) → entry appears in
   `BranchPicker.vue`'s stash section and, once G24 or a later phase enables it, would appear
   correctly-labelled by origin branch (the field is already on the wire, per §0.3) → row menu
   Apply/Pop/Drop/Branch each produce the expected dialog, the expected merge-tree-predicted
   conflict warning where applicable, and the expected post-op state.
10. A genuinely conflicting `stash pop`, done for real against a real divergent worktree: the
    dialog's prediction matches the real outcome (or is honestly reported `unknown` where
    `merge-tree` itself cannot say), the pop leaves the stash in place, and the announcement text
    matches `composeStashAnnouncement`'s own wording.
11. `preflight.checkout`'s new `stashAndCarry` route, exercised for real: dirty worktree, checkout a
    branch that would be blocked by tracked changes, choose "stash and carry," confirm the changes
    land on the new branch and the stash used for the carry is gone afterward (or, on a predicted
    conflict, is deliberately left for the user per `ops.ts`'s own documented behavior).
12. Command palette: all five stash commands appear under "Kira Version," `stashPush`'s opens the
    create dialog directly, the other four open the branch picker on its stash section.

### 7.4 The checklist

- [ ] `packages/git-ipc/src/contract.ts` has zero diff (F1's claim, proven, not assumed).
- [ ] `CONTRACT_VERSION` (TS) and `ContractVersion` (Go) are both still 21.
- [ ] All five `opTable` stash entries exist; `commands.test.ts` passes with zero `pending: 'G15'`
      entries remaining anywhere in `commands.ts`.
- [ ] `ClassifyStashPop`/`ClassifyStashBranch` pass all 22+5 ported cases, including the probe-3 case
      by name.
- [ ] A conflicting stash pop/apply reports `StashConflict`, never `Unknown`, and never drops the
      stash.
- [ ] `packages/git-core/src/preflight/stashPop.ts` and its test no longer exist; `index.ts` no
      longer references them.
- [ ] `PreflightCheckout`'s `StashAvailable` is `true`; the two stale `G12`/`G13` doc comments in
      `ops.go`/`preflight.go` now say `G17`/`G18`.
- [ ] `kiraVersion.stash.showInGraph` is untouched — same default, same (still-inert) behavior.
- [ ] No file under `packages/git-ui/` changed except `App.vue`'s one new `runUiAction` case.

---

## 8. Explicit non-goals for G17

- **Stash entries in the commit graph.** D1. `kiraVersion.stash.showInGraph` stays inert.
- **Branch-scoped stash** (auto-stash on checkout, cross-branch apply, a reusable global bucket) —
  G24's, explicitly, per SPEC's own dependency line.
- **`reset`/`cherryPick`/`tagPush`/`tagDeleteRemote`** — not this phase's kinds; their `commands.ts`
  labels are left exactly as stale as they already are.
- **Any redesign of `StashDialog.vue`/`StashList.vue`/`StashDetailPane.vue`.** They are correct as
  built; this phase makes their calls succeed, not different.
- **A second `stash.fileDiff` endpoint.** F9 — the existing `commit.fileDiff` reuse, already built
  client-side, already correct, stays as the one minor accepted inefficiency `stash.ts`'s own doc
  comment already names and accepts.

---

## 9. Handed forward

- **`kiraVersion.stash.showInGraph`'s eventual wiring**, if a later phase takes it on: the
  scaffolding is exactly where F6 found it (`WalkSpec.StashShas`/`IncludeStash`, `stashRows.ts`),
  and the missing piece is a new optional field on `graph.stream`/`graph.loadMore`/`graph.refresh`'s
  params plus a `CONTRACT_VERSION` bump to 22 — not a redesign, an addition. Whether the row-filter
  (drop helper commits, truncate parent list, synthesize decoration) belongs server-side (before
  FlatBuffers packing, in `gitstore`) or client-side (reusing `stashRows.ts` against decoded
  `CommitRecord`s, the way upstream's own P9 did it) is that later phase's own architecture
  question — this plan takes no position on it beyond noting both are live options.
- **`gitops/errors.go`'s `_ = exitCode` placeholder** (line 16, "reserved for a future row that
  needs it — no row in this table does yet") stays true after this phase; none of the three new
  stash rows need `exitCode` beyond the already-established 0/non-zero split `ClassifyOpError`'s own
  callers already gate on.
- **G18 (reset/cherry-pick)** will find `commands.ts`'s `'G16'`-labelled `pending` entries for
  `reset`/`cherryPick` exactly as this phase found `'G15'`'s for stash — the same stale-label pattern,
  same fix shape, that phase's own job.

---

## 10. Calls that want a human eye

### 10.1 Graph integration (`kiraVersion.stash.showInGraph`) — decided out of scope, but the strongest counter-argument in this plan lives here

D1 keeps this out. The case *for* building it now, stated as strongly as it deserves: the
scaffolding (`WalkSpec.StashShas`/`IncludeStash`, `walk.go`'s cache-key inclusion of both,
`stashRows.ts`'s complete and tested filter, the setting itself shipping default-`true` with a
description already written) was clearly placed by whoever ported `git-core`/`gitclient/porcelain`
wholesale, specifically anticipating this exact phase completing it — leaving it undone means a
default-on, user-visible setting keeps silently doing nothing, the precise anti-pattern this
codebase's own history (`90b85c05`'s commit message) argues against. The case *against*, which this
plan follows: SPEC's own G17 row doesn't name it (unlike G20's row, which is explicit about its own
graph work), it is the only piece of this phase that would force a `CONTRACT_VERSION` bump, and the
row-filter's server-vs-client placement is a real, undecided architecture question this plan has not
resolved (§9). **Recommendation: leave it out, as built here** — but if a reviewer weighs the
scaffolding argument more heavily, the override is cheap to describe: add `includeStash?: boolean`
to `graph.stream`'s (and `loadMore`'s/`refresh`'s) params, bump `CONTRACT_VERSION` to 22, populate
`WalkSpec.IncludeStash`/`StashShas` from a fresh `stash.list` read at walk-open time in
`gitrpc/graph.go`, and decide the filter's placement before writing any code.

### 10.2 `stashUntrackedPaths`/`existingPaths`: a filesystem stat, not a git spawn

D4 chose `os.Stat` per untracked path over `git status --porcelain=v2 --ignored`. Both are correct;
the fs-stat approach is fewer moving parts (no status-output parsing, no `--ignored` mode's own
subtleties around directory-vs-file ignore rules) but is the one place in this whole feature that
reads the filesystem directly rather than exclusively through git spawns, a small departure from
this codebase's otherwise-total "argv-only" discipline for repository state. **Recommendation: keep
D4** — the paths involved are always few (a single stash's own untracked half), never a directory
walk, and "does this exact path exist on disk" is a question git itself can only answer by roughly
the same mechanism internally. A reviewer who wants zero non-git filesystem reads anywhere in this
codebase should say so and the `--ignored` alternative is a contained swap inside `PreflightStashPop`
alone.

### 10.3 `StashUntrackedCollision`'s remapping living inside `Reclassify` rather than a second `ClassifyOpError`-shaped table

D7's choice — remap `UntrackedWouldBeOverwritten` → `StashUntrackedCollision` inside
`reclassifyStashPop` rather than giving stash pop/apply their own parallel classification function —
keeps `ClassifyOpError` itself single-purpose but means two different mechanisms now produce
stash-specific error kinds from the same function (`StashConflict` from a post-write status read,
`StashUntrackedCollision` from a remap of an already-classified generic kind). **Recommendation:
keep it** — the alternative (a `ClassifyStashOpError(stderr, exitCode)` entry point mirroring
`ClassifyRemoteError`'s own existing "porcelain reason first, generic table as fallback" shape)
would duplicate most of `ClassifyOpError`'s own rows for two rows' worth of actual difference. A
reviewer who finds two mechanisms in one function confusing enough to warrant the duplication should
say so.

### 10.4 The `StashEntry.branch` field: read into the UI now, or held back entirely until G24

D2/§0.3 lands `StashEntry.branch` on the wire (it already is, at contract version 21) and lets
`StashList.vue`'s own existing per-row rendering show it — that component was already built to
expect the field (F confirmed no gap there). The question worth a human's eye: is showing a stash's
origin branch in the list, with **no** cross-branch filtering or apply-to-different-branch action
behind it, a reasonable "the data was already there, might as well render it" call, or does it read
as a preview of G24's own feature landing early and inconsistently (a value shown with no action
attached to it)? **Recommendation: show it** — `StashList.vue` is not this plan's file to
redesign (§0.2), so whatever it already does with `entry.branch` is what ships; withholding the
field from the wire response specifically to prevent it from rendering would be actively fighting
already-correct, already-tested client code for a cosmetic reason. If a reviewer disagrees,
the fix is a one-line omission in `stash.list`'s Go handler, not a design change anywhere else.
