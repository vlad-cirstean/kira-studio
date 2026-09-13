# G18 — Per-repo settings: out of `contributes.configuration`, into a dialog on the graph

> **Revision note (post-human-eye answers).** This plan was committed once (`522e95ce`) with four
> open calls at §10. The user has since answered all four; two matched this plan's own
> recommendation (10.1) or are addressed by a downstream decision (10.3), and two diverged from the
> recommendation and change this phase's scope and design (10.2, 10.4). This revision incorporates
> all four answers directly into the plan's body rather than leaving them as a still-open §10 — every
> section below (§0, §1, §2, §3, §4, §6, §7, §8, §9) reflects the decisions actually taken. §10 itself
> is kept, marked resolved, recording what was asked and what was decided — the same role G16's own
> plan would give it if amended post-answer, not a second round of open questions.
>
> **The short version of what changed**: seven settings move into the per-repo dialog now, not five
> — `pull.strategy` and `log.level` join the original five. `log.level` is not actually per-repo in
> any meaningful sense (§1 F1 already said so), so it is stored through the *same* new mechanism
> under a reserved, non-repo sentinel key rather than a real `repo_id` (D14) — genuinely resolved,
> not glossed over. `git.path` gets its dead server-side wiring fixed in this phase after all (D15),
> but *not* by adding it to the new per-repo dialog: it was already correctly classified as
> server-owned (§10.5's own recommendation stands), and fixing its wiring means finishing that
> classification — a leaf on the *existing* server-owned `settings` table
> (`internal/storage/repos/settings.go`, `protectedBranches`'s own sibling), surfaced in Kira
> Studio's own existing Git settings section, not the new git-ui dialog. It also, as a direct
> consequence, drops out of `packages/git-core/src/settings/schema.ts` and
> `contributes.configuration` entirely — the same status `protectedBranches`/`fetchAutoInterval`
> already have (neither is declared there either). The per-repo dialog therefore ends up showing
> exactly the seven settings that actually live in its own storage — nothing read-only, nothing left
> over (D-13-revised, §10.3 resolved).

---

## Original framing (unchanged)

The eighteenth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the first one whose entire
job is *relocating* settings that already exist rather than building a new capability from nothing.
G17 found `kiraVersion.stash.showInGraph` fully scaffolded server-side
(`porcelain.WalkSpec.IncludeStash`, `walk.go`'s cache-key inclusion of it, `graph/stashRows.ts`'s row
filter) and completely inert, and deliberately declined to wire it into the graph — that would need
new wire surface and its own design. Asked about it, the user's answer reached past that one setting:
*"these settings should be accessible from the git graph itself, not in vscode settings... move them
all into a proper dialog. Obviously configurable per repo."* This phase is that move.

**The storage question was open when this plan started and is not open now.** The user's own
steering: these settings go into Kira Studio's **existing main database** — the one
`storage.Open`/`repos.New` already open in `main.go`, already holding `git_clients` (G1's own trust
store) and the server-owned `protectedBranches`/`fetchAutoIntervalMinutes` pair
(`internal/storage/repos/settings.go`) — not a new standalone file, and explicitly not `review.db`'s
pattern. §2 D3 records why that direction was independently correct before the steering arrived.

**The "server's own default" sentence already sitting in `graph.loadMore`/`graph.stream`/
`review.resolveBase`/`remote.pullPreflight`'s own doc comments turns out to be almost the whole
design.** All four already declare their settings-sourced params optional, with documented fallback:
"a raw socket client that omits them gets the server's own defaults." Upgrading what "the server's
own default" *means* — from a fixed constant to "the per-repo (or, for `log.level`, instance-wide)
stored value, falling back to the schema default" — needs **zero change to any of those four request
shapes**. See D6.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `8442d866` (G1–G17 planned and, except G17
itself, implemented); this revision incorporates the user's answers to the original plan's §10,
recorded at commit `522e95ce`. Working tree clean at the time of the original investigation; no
other agent running concurrently. Every claim in the original plan was checked against source read
in this container (schema.ts, the settings path through `extension.ts`/`proxyHandlers.ts`,
`contract.ts`, `internal/gitreview`, `internal/storage/repos/{settings,gitclients}.go` and their
migrations, `internal/gitclient/repo.go`'s `RepoID`, `internal/gitsession/*`, `internal/notify`,
`packages/git-ui/src/{App.vue,components/AppToolbar.vue,components/dialogs/StashDialog.vue,
state/settings.ts}`); this revision additionally checked `apps/kira-studio/frontend/src/workbench/
SettingsDialog.vue`'s existing "Git" section (confirms `protectedBranches`/`fetchAutoIntervalMinutes`
are already edited there — the natural, precedented home for `git.path` once it is genuinely
server-owned, D15), `packages/shared/domain/settings.ts`'s `gitSettingsSchema` (the TS source
`storage/model/settings.go`'s own doc comment says it "mirrors... verbatim" — `git.path`'s fix must
touch this file too), `internal/gitrpc/{handlers.go,graph.go,remote.go,wire.go}`'s exact
`Discovery.Status(ctx, "")` call sites and `remote.pullPreflight`'s `StrategySetting` plumbing.

### 0.2 Scope

1. A real, audited move-or-stay call for every one of `schema.ts`'s nine keys (§1 F1, §2 D1) —
   **revised**: seven move, not five (10.2's answer); `workbench.tree.indent` stays, not a candidate;
   `git.path` stays server-owned but is fixed and relocated out of `schema.ts` entirely (10.4's
   answer, D15).
2. New per-repo storage in `kira.db` (§2 D3), keyed by `RepoID` for six of the seven moved keys, and
   by a reserved non-repo sentinel key for the seventh (`log.level`, D14 — 10.2's own "resolve the
   mechanics" instruction).
3. New RPC surface (`repoSettings.get`/`repoSettings.set`/`repoSettings.changed`), a
   `CONTRACT_VERSION` bump (§2 D5), and upgrading `graph.loadMore`/`graph.stream`/
   `review.resolveBase`/`remote.pullPreflight`'s existing "server's own default" to mean "this
   repo's (or, for `log.level`, this instance's) stored value" (§2 D6) — no wire-shape change to any
   of the four.
4. A dialog in `packages/git-ui`, opened from the toolbar entry point `AppToolbar.vue` has been
   reserving since P4 (§1 F8), matching this app's existing modal conventions (`StashDialog.vue`),
   showing exactly the seven settings that moved — nothing read-only, nothing else (10.3's answer,
   D13-revised).
5. **New in this revision (10.4's answer, D15)**: fixing `kiriVersion.git.path`'s dead server-side
   wiring — `Discovery.Status(ctx, "")` is hardcoded everywhere it is called; this phase makes it
   read a real, configured, server-owned value instead. This is *not* the per-repo dialog's job —
   it is completing the classification §0.2 item 1 above already assigns `git.path`
   ("stays" — SPEC-named, server-owned), the same way `protectedBranches`/`fetchAutoIntervalMinutes`
   already work, in the same existing `settings` table and the same existing Kira Studio settings
   surface those two use.
6. Removing the seven moved keys from `apps/kira-studio-vscode/package.json`'s
   `contributes.configuration`, *and* removing `git.path` from there too (once genuinely
   server-owned, it has no more business being a VS Code setting than `protectedBranches` does) —
   plus a one-time, best-effort migration for a value a user already set for any of the eight (§2
   D11).

### 0.3 Not in this phase

- **Actually filtering the graph by `stash.showInGraph`.** Unchanged from the original plan — the
  user picked this plan's own recommendation at 10.1 ("keep the split"). This phase moves *where the
  setting is stored and edited*, not what the graph shows. §10.1 (resolved).
- **`protectedBranches`/`fetch.autoInterval`.** Already correctly server-owned in `kira.db` (G7 D16)
  — untouched. (`git.path` is no longer in this "untouched" bucket as of this revision — it moves
  from "SPEC-named but not actually wired" to "wired, this phase," §0.2 item 5.)
- **No new Vue component-rendering test tier.** G16's own declared non-goal, unchanged.
- **No change to Kira Studio's own Wails `SettingsDialog.vue` beyond adding one new `git.path` field
  to its existing "Git" section** (D15) — no redesign of that dialog, no new section, no change to
  its other five sections (Appearance/Data/Cache/Connected editors/Advanced).
- **No `docs/v1.3/SPEC.md` edit.** Same convention every prior phase in this chapter followed.

### 0.4 Ground rules (unchanged)

- **Classify every key, not just the three SPEC names.** §1 F1 is the audit; §2 D1 is the table,
  revised.
- **Reuse before inventing.** `RepoID`, `kira.db`'s per-leaf-JSON-row pattern, `internal/
  notify.Emitter[T]`, and the four requests' own already-optional settings-sourced params are all
  existing seams this phase reuses. `git.path`'s fix reuses `protectedBranches`'s own exact pattern
  (closure-injected, read fresh, never cached) rather than inventing a new one (D15).
- **The dialog matches this app's existing modal, not a new visual language.** Unchanged.
- **A setting that is not genuinely per-repo says so, in the UI, rather than pretending.** New this
  revision, directly answering the tension 10.2 asked this plan to resolve rather than paper over:
  `log.level`'s field in the dialog carries a visible note that it applies to this installation, not
  this repository (D13-revised, D14).

---

## 1. Findings (unchanged from the original investigation; §1 F1's table is superseded by §2 D1's revised version, kept below for the audit trail)

### F1 — Every key in `schema.ts`, audited against SPEC's own criterion — original table, see D1 for the revised verdicts

SPEC's "Settings ownership" section states the test precisely: server-owned when "two windows
disagreeing about them is a correctness/safety issue, not a preference." The original audit's
per-key reasoning is unchanged and is restated in D1 below with the user's answers folded in; it is
not re-derived here a second time.

### F2 — F13 (unchanged)

The settings-flow, `git.path`-dead-server-side, `protectedBranches`/`fetchAutoIntervalMinutes`
already-correct, `RepoID`-already-exists, `kira.db`-already-houses-this-shape,
`CONTRACT_VERSION`-always-bumps, `AppToolbar.vue`-has-no-gear-yet, `StashDialog.vue`-modal-
convention, zero-git-ui-tests, and `internal/notify.Emitter[T]`-already-exists findings from the
original plan are unchanged in substance and are not repeated verbatim here — see the original
commit `522e95ce`'s §1 F1–F13 for the full text each decision below still cites by number
(F3/F5/F6/F7/F8/F9/F10/F11/F12/F13 are all referenced, unchanged, throughout §2).

### F14 — `remote.pullPreflight`'s `strategySetting` already follows the identical pattern F12 found for `scope`/`pageSize`/`baseCandidates`

`packages/git-ipc/src/contract.ts:1318-1327`: `strategySetting?: PullStrategy | 'auto'`, its own doc
comment — *"G7 D2: injected by the extension from `kiraVersion.pull.strategy`, exactly as
`review.resolveBase` injects `baseCandidates`. Absent for every raw socket client — the server treats
that the same as `'auto'`."* Server-side, `gitrpc/remote.go:29` — `entry.PullPreflight(ctx, p.Branch,
p.StrategySetting)` — the empty-string default resolves deeper inside `PullPreflight` itself. This is
the fourth instance of F12's pattern, not a new one, and is why moving `pull.strategy` (10.2's
answer) costs the same "zero param-shape change, one new lookup" price as the original four keys —
D6 is extended, not redesigned, to cover it.

### F15 — Kira Studio's own `SettingsDialog.vue` already has a "Git" section, already editing exactly the sibling settings `git.path` needs to join

`apps/kira-studio/frontend/src/workbench/SettingsDialog.vue:102` — `sections = ['Appearance',
'Data', 'Cache', 'Connected editors', 'Git', 'Advanced']`; its "Git" template branch (`:680-735`)
already edits `draft.git.protectedBranches` (a multi-line textarea, `resetProtectedBranches`) and
`draft.git.fetchAutoIntervalMinutes` (a validated number input, `resetLeaf('git',
'fetchAutoIntervalMinutes')`). `git.path` is a third leaf of the exact same `GitSettings` struct
(`internal/storage/model/settings.go:31-35`) — adding a plain text input beside the two that already
exist there is a small, precedented addition, not a new UI surface (D15).

---

## 2. Decisions

### D1 — The move-or-stay table — **revised** (10.2, 10.4)

| Key | Verdict | Storage |
|---|---|---|
| `kiraVersion.graph.pageSize` | **moves** | new per-repo table, real `repo_id` |
| `kiraVersion.graph.scope` | **moves** | new per-repo table, real `repo_id` |
| `kiraVersion.review.baseCandidates` | **moves** | new per-repo table, real `repo_id` |
| `kiraVersion.stash.showInGraph` | **moves** | new per-repo table, real `repo_id` |
| `kiraVersion.stash.includeUntracked` | **moves** | new per-repo table, real `repo_id` |
| `kiraVersion.pull.strategy` | **moves** (10.2) | new per-repo table, real `repo_id` — a repo's own pull convention is a legitimate per-repo fact, unlike `log.level` below |
| `kiraVersion.log.level` | **moves** (10.2), but not genuinely per-repo | new per-repo table, **reserved sentinel key**, not `repo_id` — D14 |
| `kiraVersion.git.path` | **stays server-owned** (unchanged verdict) **and is now fixed** (10.4) | existing singleton `settings` table, `GitSettings`'s third leaf — D15. Removed from `schema.ts`/`contributes.configuration` entirely, matching `protectedBranches`/`fetchAutoIntervalMinutes`'s own status |
| `workbench.tree.indent` | **stays**, not a candidate | unchanged — read-only VS Code mirror |

Seven keys move into the new per-repo dialog and storage. `git.path` is fixed but explicitly does
**not** join them — §10.4/§10.5 (resolved) explain why relocating it to the per-repo mechanism would
be wrong even though fixing its wiring is right: it answers "where is the `git` binary," a fact about
this machine/installation, not about any one repository, and its two trio-siblings already prove the
correct home for that kind of fact is Kira Studio's own settings, not a per-repo dialog.
`workbench.tree.indent` was never a candidate and remains outside both surfaces.

### D2 — Per-repo key: `RepoID` (unchanged)

No new identity mechanism. Applies to six of the seven moved keys; `log.level` uses the reserved
sentinel instead (D14).

### D3 — Storage: a new table in `kira.db`, shaped like `settings`'s existing per-leaf-row pattern plus `repo_id` (unchanged mechanism; now explicitly the home for the sentinel row too)

Unchanged from the original plan: `internal/storage/migrations/0017_g18_git_repo_settings.sql`
creates `git_repo_settings (repo_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY
KEY (repo_id, key))`. `internal/storage/model/gitreposettings.go`'s `GitRepoSettings` grows from five
fields to seven (`PullStrategy string`, `LogLevel string` added). `internal/storage/repos/
gitreposettings.go`'s `GitRepoSettingsRepo.Get`/`Set` are unchanged in shape — D14 is what makes
`log.level` resolve to a different `repo_id` value than the one the caller passed, entirely inside
this repo's own implementation, invisible to every caller above it except the dialog's own label
(D13-revised).

**`git.path` does not live here.** It lives in the *existing* `settings` table
(`storage/repos/settings.go`), a `GitSettings`'s third leaf, per D15 — a deliberate, explicit
non-use of this phase's own new table for the one settings-fix this revision adds, because
`git.path` was never a per-repo fact to begin with.

### D4 — RPC surface: two requests, one event, `SettingsSnapshot` narrows further, `RepoSettingsSnapshot` grows to seven — **revised**

```ts
/** The one remaining window/host-scoped key after this phase (G18): git.path and the five
 *  originally-named per-repo keys are gone (git.path is server-owned elsewhere now, D15; the rest
 *  moved to RepoSettingsSnapshot). pull.strategy and log.level moved too (10.2's answer, D14). */
export interface SettingsSnapshot {
  readonly 'workbench.tree.indent': number;
}

/** G18: the seven per-repo display settings, server-stored, edited from the new in-app dialog.
 *  Six are genuinely scoped by repoId; kiraVersion.log.level is not (D14) — its value is shared
 *  across every repo this installation opens, stored under a reserved key rather than repoId, a
 *  fact the dialog surfaces to the user rather than hiding (D13-revised). Every caller still passes
 *  a real repoId for every key, log.level included; only this phase's own storage layer treats that
 *  one key's repoId as informational rather than a partition key. */
export interface RepoSettingsSnapshot {
  readonly 'kiraVersion.graph.pageSize': number;
  readonly 'kiraVersion.graph.scope': 'all' | 'head';
  readonly 'kiraVersion.stash.showInGraph': boolean;
  readonly 'kiraVersion.stash.includeUntracked': boolean;
  readonly 'kiraVersion.review.baseCandidates': readonly string[];
  readonly 'kiraVersion.pull.strategy': 'auto' | 'ff-only' | 'merge' | 'rebase';
  readonly 'kiraVersion.log.level': 'off' | 'error' | 'warn' | 'info' | 'debug';
}
```

`SettingsSnapshot` is down to one member. It is kept as a named type rather than folded directly into
`app.init`'s result — collapsing it further is an unrelated, cosmetic refactor this phase does not
need to make, and `app.init`'s own result shape stays otherwise unchanged.

Requests/event unchanged in shape from the original plan (`repoSettings.get`, `repoSettings.set`,
`repoSettings.changed`), now carrying the seven-member `RepoSettingsSnapshot`.

### D5 — `CONTRACT_VERSION`: 21 → 22 (unchanged reasoning, F7)

The bump comment's own wording widens slightly to name seven requests' worth of settings rather than
five, and to note the narrower one-member `SettingsSnapshot`.

### D6 — No param-shape change to `graph.loadMore`/`graph.stream`/`review.resolveBase`/`remote.pullPreflight` — **extended to a fourth request** (F14)

The original plan's reasoning (F12) extends verbatim to `remote.pullPreflight`'s `strategySetting`
(F14): already optional, already documented as "a raw client omits it, the server supplies a
default," already has `repoID` in scope at its own resolution point
(`gitrpc/remote.go:29`/`PullPreflight`'s own internal default). `proxyHandlers.ts`'s
`remote.pullPreflight` composition (wherever it injects `strategySetting` from the window's settings
today) is deleted the same way the other three are, becoming a plain `forward(...)` call.
`gitrpc/remote.go`'s handler gains the same one-line upgrade `graph.go`/`review.go` already get:
resolve the repo's stored `pull.strategy` before falling back to `"auto"`, when `p.StrategySetting`
arrives empty.

**`log.level` has no request-injection precedent to extend** — it was never sent per-request (F1's
own original finding: it governs the extension's local log output, read once via `logger.child`'s
closure, not attached to any RPC). It does not need a D6-style upgrade at all; it needs only the
storage/dialog treatment D14 describes. This is itself part of why 10.2's own tension is real: four
of the seven moved keys fit D6's "travels with the request" shape naturally; `log.level` fits neither
that shape nor genuine per-repo storage, which is exactly why D14 gives it special handling instead
of pretending it fits the other six's mold.

### D7 — D9 (unchanged from the original plan)

Live propagation via `internal/notify.Emitter[T]` (D7), `main.go` wiring for the six genuinely
per-repo keys via `RepoSettingsGet`/`RepoSettingsSet` closures (D8, widened to seven fields),
`internal/gitclient/settings.go` deletion (D9) — all unchanged in mechanism. D8's closures now also
need no special handling for `log.level` beyond what `GitRepoSettingsRepo` already resolves
internally (D14) — `main.go`'s own wiring code does not need to know about the sentinel at all,
which is precisely the point of keeping D14's special case inside the repo layer alone.

### D10 — `schema.ts` gains a third `source` value, `'repo'` — **revised**: no new source value for the sentinel, one new optional flag instead

Unchanged: the seven moved keys get `source: 'repo'`; `toVsCodeConfiguration()`'s skip condition
widens to `def.source !== undefined`; `repoSettingKeys()` helper unchanged.

**New this revision**: `SettingDef` gains one more optional field —

```ts
/** G18 D14: meaningful only when source === 'repo'. true for exactly one key
 *  (kiriVersion.log.level) — its stored value is shared across every repository this
 *  installation opens, not scoped by repoId, even though it lives in the same per-repo storage
 *  and dialog as the other six 'repo'-sourced keys. The dialog surfaces this to the user (a visible
 *  note, not a hidden implementation detail) rather than presenting it as if it varied per repo. */
readonly instanceWide?: boolean;
```

`kiriVersion.log.level`'s own `SettingDef` gains `instanceWide: true`. No other key does. This is a
schema-driven flag, not a hardcoded list in `git-ui` — consistent with D25's "one schema, one place"
philosophy, the same reason this dialog exists as a second consumer of `schema.ts` at all.

**`git.path` is removed from `SETTINGS` entirely** (D15) — it is no longer a `kiraVersion.*`
extension-contributed setting of any kind once its true source of truth is `kira.db`'s existing
`settings` table, matching `protectedBranches`/`fetchAutoIntervalMinutes`'s own status (never
declared in `schema.ts` at all). `toVsCodeConfiguration()` needs no special-casing for this removal
— deleting the object literal entry is the whole change.

### D11 — Migration: unchanged mechanism, now covers eight keys including `git.path`

The one-time, extension-side, `context.globalState`-tracked, `config.inspect()`-based migration
(unchanged mechanism from the original plan) now runs over all eight keys that leave
`contributes.configuration` this phase (the seven moved keys plus `git.path`). `git.path`'s own
migrated value, if a user had customized it, is written via a `SettingsRepo.Set(model.SettingsPatch{
Git: &model.GitPatch{GitPath: &value}})`-shaped call — Kira Studio's own existing settings-write
path, **not** `repoSettings.set` (which has no notion of `git.path` at all after D15) — reachable
from the extension the same way every other socket call already is (a new small RPC, or, if Kira
Studio's settings are not otherwise reachable over the git socket today, an explicit note that this
one migration leg needs its own tiny request; §10.4's own resolution flags this as the one piece of
D15 that needs a real implementation-time check, not assumed).

### D12 — `apps/kira-studio-vscode/package.json`: eight keys removed (unchanged mechanism, wider set)

Regenerated via `scripts/gen-settings.ts` after D10's changes — seven keys move to `source: 'repo'`
(dropped from `contributes.configuration` by the existing skip-condition widening) and `git.path` is
deleted from `SETTINGS` outright (D10) — both produce the same net effect on the generated
`contributes.configuration`, by two different mechanisms, worth keeping distinct in the commit that
makes the change (a reviewer diffing `package.json` alone cannot tell "moved" from "removed
entirely," but the `schema.ts` diff makes it unambiguous).

### D13 — The dialog — **revised**: seven fields, no read-only section, `log.level` visibly marked instance-wide (10.3, resolved)

**Trigger**: unchanged — the `⚙` icon in `AppToolbar.vue`'s already-reserved slot (F8).

**Component**: `RepoSettingsDialog.vue`, unchanged conventions (F9). Four sections now, not three:

- **Graph** — `pageSize`, `scope` (unchanged from the original plan).
- **Stash** — `showInGraph` (still inert per §0.3/§10.1, still honestly labelled as such),
  `includeUntracked` (unchanged).
- **Branch review** — `baseCandidates` (unchanged).
- **Pull** (**new**) — `strategy` (`<select>` over the schema's own `enum`: auto/ff-only/merge/
  rebase).
- **Diagnostics** (**new**) — `log.level` (`<select>` over the schema's own `enum`), rendered with a
  visible inline note driven by `SETTINGS['kiraVersion.log.level'].instanceWide` (D10): *"This
  applies to Kira Version's own diagnostic log for every repository, not just this one."* This is
  the resolved form of 10.2's own instruction — not silently treating it as per-repo, not refusing to
  move it either.

**No read-only section for anything else** (10.3, resolved): with `pull.strategy`/`log.level` now
real, editable entries and `git.path` removed from `schema.ts` entirely (D10/D15),
`workbench.tree.indent` is the only remaining `kiraVersion`-adjacent setting outside this dialog, and
it was never a candidate to show here at all (it is not this extension's own setting to present as
editable, or even as a read-only mirror inside a *repository* settings surface — it is a VS Code
editor preference, unrelated to any one repo). The dialog shows exactly the seven keys that live in
its own storage. Nothing else.

**Data flow**: unchanged shape (`RepoSettingsState`, `packages/git-ui/src/state/repoSettings.ts`),
now carrying seven fields instead of five; the `instanceWide` flag is read straight off `SETTINGS`
by the component, not duplicated into the state class.

**Testing**: unchanged (F10, D13's original) — `RepoSettingsState` gets unit tests, the `.vue`
template does not, no new Playwright behavior tier.

### D14 — `log.level`'s storage mechanics: a reserved sentinel row in the *same* new table, not a real `repo_id`, not a second table — **new this revision, resolving 10.2's own flagged tension**

The user's instruction was "move it into the dialog," not "resolve whether it's really per-repo" —
that half is this plan's own job, per the coordinator's own framing, and the answer is:

- `RepoID` (D2, `internal/gitclient/repo.go:196-206`) is always a non-empty absolute path (or, for a
  bare repo, a non-empty git-dir path) — **it can never be the empty string.** That makes `""` a safe,
  permanently-collision-free sentinel for "this row is not scoped to any repository," reusable inside
  `git_repo_settings`'s own existing `(repo_id, key)` primary key with **no schema change** beyond
  what D3 already adds.
- `internal/storage/repos/gitreposettings.go`'s `Get`/`Set` gain one small, explicit branch:
  for the key `"kiraVersion.log.level"` specifically, the `repoID` argument the caller passed is
  **ignored** and `""` is used in its place for the actual query. Every other key's behavior is
  unchanged. This is the one place in the whole phase where a caller's `repoId` is knowingly not
  honored — commented plainly, naming D14, so a future reader does not "fix" it into behaving like
  the other six.
- **Every caller above this layer — the RPC handlers, `RepoSettingsState`, the dialog's own request
  plumbing — is unaffected and untouched by this special case.** `repoSettings.get`/`.set` still take
  a real `repoId` for every key including `log.level`; the substitution happens once, at the bottom
  of the storage layer, which is what makes D8's `main.go` wiring able to stay ignorant of it (D7/D9
  above).
- **The one place this case is *not* hidden is the dialog's own UI** (D13-revised): a user who opens
  "Repository settings" for two different repos and sees the *same* log-level value in both, changes
  it in one, and finds the other changed too, needs to understand why — hence the visible note,
  driven by `schema.ts`'s new `instanceWide` flag (D10), not a silent surprise.
- **Alternative considered and rejected**: a second, genuinely global table (or a single extra row in
  the *existing* `settings` table, alongside `git.path`, D15). Rejected because `log.level` is still,
  by the user's own instruction, meant to live in the **new dialog** — moving it to the existing
  `settings`/Kira-Studio-settings surface (as `git.path` gets, D15) would directly contradict "move
  it into the dialog," which is specifically the git-ui surface, not Kira Studio's own Wails
  settings. The sentinel-row approach is the one design that honors "lives in the new per-repo table
  and dialog" literally while still being honest that its value is not actually partitioned by repo.

### D15 — `git.path`: fixed, in the *existing* server-owned settings surface — **new this revision, resolving 10.4**

**Scope of the fix.** Every place that resolves git's location on disk currently passes a hardcoded
empty string to `Discovery.Status`:

- `internal/gitrpc/handlers.go:134` (`handleAppInit`) and `:147` (`handleRepoOpen`).
- `internal/gitrpc/graph.go:109,192` (the two `graph.status`/similar call sites the original
  investigation already found).

**The fix, file by file** (§3 restates this as the file-by-file plan; this decision records the
shape):

1. `packages/shared/domain/settings.ts` — `gitSettingsSchema` gains `gitPath: z.string().default('')`
   (a fourth-ish leaf alongside `protectedBranches`/`fetchAutoIntervalMinutes`); both existing
   default-literal blocks (`:96-97`, `:130-131`) gain the matching `gitPath: ''` entry.
2. `internal/storage/model/settings.go` — `GitSettings` gains `GitPath string`; `GitPatch` gains
   `GitPath *string`; `DefaultSettings()`'s `Git: GitSettings{...}` literal gains `GitPath: ""`. No
   new validation needed (an empty string is the valid "auto-discover" state, matching
   `gitclient.Client.Status`'s own existing contract — any non-empty string is passed through
   unvalidated, exactly as `gitclient.Discovery`'s own probe already tolerates a bad path by falling
   through its classified-error states, not by pre-validating the string).
3. `internal/storage/repos/settings.go` — `GetAll()` gains `leaf(stored, "git.path",
   &result.Git.GitPath)`; `Set()` gains the matching `if g.GitPath != nil { upsertSettingsLeaf(tx,
   "git.path", *g.GitPath) }` branch — both mechanical additions beside the two existing `git.*`
   leaves, same file, same pattern.
4. `internal/gitsession/registry.go` — `Registry.Settings`'s signature widens from `func() (
   protectedBranches []string, autoFetchMinutes int)` to `func() (protectedBranches []string,
   autoFetchMinutes int, gitPath string)` — the same single closure, one more return value, not a
   second accessor. `NewRegistry`'s own stub default widens to match (`nil, 0, ""`).
5. `main.go:118-125` — the existing `gitRegistry.Settings` closure body gains `return
   s.Git.ProtectedBranches, s.Git.FetchAutoIntervalMinutes, s.Git.GitPath`.
6. `internal/gitrpc/handlers.go:134,147` and `internal/gitrpc/graph.go:109,192` — each
   `r.deps.Discovery.Status(ctx, "")` becomes `r.deps.Discovery.Status(ctx, gitPathFrom(r.deps.
   Registry))`, a tiny new unexported helper (`_, _, gitPath := reg.Settings(); return gitPath`) so
   the three-value destructure is not repeated at every call site.
7. `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` — one new field in the existing
   "Git" section (`:680-735`), a plain text input bound to `draft.git.gitPath`, with the same
   `settings-reset-git-*`/`resetLeaf('git', 'gitPath')` convention `fetchAutoIntervalMinutes` already
   uses — a description matching `schema.ts`'s own now-deleted copy ("Path to the git executable.
   Empty uses the host's own discovery").

**Why this is a fix, not a redesign**: `GitSettings`/`SettingsRepo`/`gitRegistry.Settings`'s own
closure-injection shape were all built by G7 D16 specifically for "a setting a remote op reads fresh,
never cached." `git.path` needs exactly that same property (a stale configured path could silently
keep using an old git binary), and reuses the identical mechanism rather than inventing a fetch/cache
strategy of its own.

**What this removes, as a direct consequence**: `git.path` leaves `packages/git-core/src/settings/
schema.ts` (D10), `SettingsSnapshot` (D4), and `apps/kira-studio-vscode/package.json`'s
`contributes.configuration` (D12) — it was never really an extension-owned setting once its correct
home was established; leaving a dead, unread `kiriVersion.git.path` declaration in `schema.ts`
*after* wiring the real one in `kira.db` would recreate exactly the "a setting that silently does
nothing" anti-pattern this whole chapter (G17's own citation of commit `90b85c05`) already argues
against — the fix is not complete without also removing the orphaned declaration, not just adding
the real one.

---

## 3. The Go side, file by file — **revised**: adds D15's `git.path` fix, widens D3's model to seven fields, D14's sentinel branch

### 3.1 `internal/storage/migrations/0017_g18_git_repo_settings.sql` — new (unchanged from original, D3)

### 3.2 `internal/storage/model/gitreposettings.go` — new, **revised**: seven fields (D3, D14)

`GitRepoSettings` gains `PullStrategy string` and `LogLevel string` (five → seven fields);
`DefaultGitRepoSettings()` gains `PullStrategy: "auto", LogLevel: "info"` (matching `schema.ts`'s own
defaults). `Validate()` gains the two matching bounds checks (`pullStrategy` ∈ the four-member enum,
`logLevel` ∈ the five-member enum).

### 3.3 `internal/storage/repos/gitreposettings.go` — new, **revised**: D14's sentinel branch

`Get`/`Set` gain the one explicit `if key == logLevelSettingKey { repoID = "" }`-shaped substitution,
commented per D14. A named constant `const logLevelSettingKey = "kiraVersion.log.level"` (or the
equivalent already-shared key constant, if one exists by implementation time) avoids a magic string
appearing twice.

### 3.4 `internal/storage/repos/repos.go` — edited (unchanged from original, D3)

### 3.5 `internal/storage/repos/gitreposettings_test.go` — new, **revised**: adds D14's sentinel-collapse test

All original test cases (§3.5 of the prior revision), plus: `Set(repoA, {logLevel: "debug"})`
followed by `Get(repoB)` shows `logLevel: "debug"` too (proving the sentinel collapse actually
happens across two different real repo ids) — the single most important new regression guard this
revision adds, since a bug here would silently make `log.level` behave as if per-repo when it should
not, or vice versa.

### 3.6 `internal/gitclient/settings.go` — deleted (unchanged, D9)

### 3.7 `internal/gitsession/registry.go` — edited, **revised**: `Settings`'s three-value signature (D15)

`Settings func() (protectedBranches []string, autoFetchMinutes int, gitPath string)`, plus the
unchanged `RepoSettingsGet`/`RepoSettingsSet` fields from the original plan (D8), now over the
seven-field `GitRepoSettings`.

### 3.8 `internal/gitsession/entry.go` — edited (unchanged, D7)

### 3.9 `internal/gitsession/conn.go` — edited (unchanged, D7)

### 3.10 `internal/gitrpc/wire.go` — edited, **revised**: `RepoSettingsSnapshot` grows to seven fields (D4)

### 3.11 `internal/gitrpc/settings.go` — new (unchanged, D4/D6)

### 3.12 `internal/gitrpc/handlers.go` — edited, **revised**: adds D15's `git.path` fix at the two existing `Discovery.Status(ctx, "")` call sites

The two new `repoSettings.*` `case` arms (unchanged, D4), plus `:134,147`'s `Discovery.Status`
calls updated per D15 item 6.

### 3.13 `internal/gitrpc/graph.go` — edited, **revised**: D6's fallback upgrade (unchanged) plus D15's fix at `:109,192`

### 3.14 `internal/gitrpc/remote.go` — edited, **new this revision** (D6/F14)

`handlePullPreflight` (or wherever `p.StrategySetting` first reaches `entry.PullPreflight`, `:29`)
gains the same one-line upgrade: when `p.StrategySetting == ""`, resolve the repo's stored
`pull.strategy` before falling through to `PullPreflight`'s own existing `"auto"` default.

### 3.15 `internal/gitrpc/contract.go` — edited (unchanged, D5, wording widened per D5's note)

### 3.16 `main.go` — edited, **revised**: D8's closures plus D15's widened `Settings` closure body

### 3.17 `internal/gitsession/*_test.go` — new tests (unchanged, D7)

### 3.18 `internal/gitrpc/settings_test.go` — new tests, **revised**: adds a `log.level` cross-repo case

The original four test cases, plus: two different `Conn`s open on two different repos both receive
`repoSettings.changed` when `log.level` is set via either one's `repoSettings.set` — proving D7's
live-propagation mechanism also correctly fans a sentinel-backed change out to *every* open
connection, not just the ones on the repo the request happened to name.

### 3.19 `internal/gitrpc/handlers_test.go` (or wherever `app.init`'s existing tests live) — edited, **new this revision** (D15)

A new/updated test: `app.init`'s `Git` field reflects a configured `git.path` (via a fake `Registry.
Settings` closure returning a non-empty path) rather than always resolving against `""`.

---

## 4. The TypeScript / Vue side, file by file — **revised**

### 4.1 `packages/git-core/src/settings/schema.ts` — edited, **revised**: seven `source: 'repo'` keys, `instanceWide` flag, `git.path` deleted

`SettingDef` gains `instanceWide?: boolean` (D10); `kiriVersion.pull.strategy`/`log.level` get
`source: 'repo'` (the latter also `instanceWide: true`); `kiriVersion.git.path`'s entire object
literal is **removed** from `SETTINGS` (D10/D15). `toVsCodeConfiguration()`'s skip condition
unchanged from the original plan. `repoSettingKeys()` now returns seven keys.

### 4.2 `packages/git-ipc/src/contract.ts` — edited, **revised**: `SettingsSnapshot` down to one member, `RepoSettingsSnapshot` up to seven

### 4.3 `packages/git-ipc/src/validate.ts` — edited (unchanged, D5)

### 4.4 `packages/git-ui/src/state/repoSettings.ts` — new, **revised**: seven fields, no special-casing needed here (D14's sentinel is invisible above the storage layer)

### 4.5 `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue` — new, **revised**: five sections (Graph, Stash, Branch review, Pull, Diagnostics), the `instanceWide` note on `log.level` (D13-revised)

### 4.6 `packages/git-ui/src/components/AppToolbar.vue` — edited (unchanged, F8)

### 4.7 `packages/git-ui/src/App.vue` — edited (unchanged shape; `pageSize`/`stashIncludeUntrackedDefault` re-sourced from `repoSettingsState`, unchanged from the original plan)

### 4.8 `apps/kira-studio-vscode/src/proxyHandlers.ts` — edited, **revised**: four `forward(...)` simplifications, not three (adds `remote.pullPreflight`, F14/D6)

### 4.9 `apps/kira-studio-vscode/src/extension.ts` — edited, **revised**: migration now covers eight keys including `git.path` (D11), and `git.path`'s migrated value is written via Kira Studio's own settings-write path, not `repoSettings.set` (D11's own flagged implementation-time check)

### 4.10 `apps/kira-studio-vscode/package.json` — edited, **revised**: eight keys removed, not seven (D12)

### 4.11 `packages/git-ui/src/state/settings.ts` — not edited (unchanged; now generic over a one-member `SettingsSnapshot`)

### 4.12 `packages/git-ui/src/state/repoSettings.test.ts` — new, **revised**: adds a case asserting the dialog-facing state exposes `instanceWide` correctly for `log.level` and for no other key

### 4.13 `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` — edited, **new this revision** (D15/F15)

One new text input in the existing "Git" section, `draft.git.gitPath`, matching the existing
`fetchAutoIntervalMinutes` field's reset-button/validation convention (no validation needed beyond
"is a string," per D15 item 2).

### 4.14 Not edited

Everything the original plan's §4.13 already named, still unedited: `packages/git-core/src/settings/
schema.test.ts`-equivalents beyond what §4.1 already covers, `internal/gitreview/**`,
`apps/kira-studio/frontend/**` beyond the one field in §4.13.

---

## 5. Dependencies and tooling (unchanged)

---

## 6. Implementation order — **revised**: adds a git.path step, folds pull.strategy/log.level into the existing steps

1. **Storage** (D3, D14, §3.1-3.5): migration, `storage/model` (seven fields), `storage/repos` (the
   sentinel branch), their tests — including the cross-repo `log.level` collapse test (§3.5).
2. **`git.path`'s existing-table fix** (D15, §3.16 items 1-3 in file terms —
   `packages/shared/domain/settings.ts`, `storage/model/settings.go`, `storage/repos/settings.go`)
   — done alongside step 1 since both touch settings-storage machinery in the same sitting, but
   commit separately (this is a fix to the *existing* server-owned surface, not part of the new
   per-repo table, and the commit history should say so plainly).
3. **`gitclient/settings.go` deletion** (D9, §3.6) — unchanged.
4. **Registry/entry/conn wiring** (D7, D8, D15 item 4-5, §3.7-3.9) — `Registry.Settings`'s widened
   three-value signature and `main.go`'s matching update land together, since one cannot compile
   without the other.
5. **RPC surface** (D4, §3.10-3.12), the `graph.go`/`review.go`/`remote.go` fallback upgrades (D6,
   §3.13-3.14), the two `Discovery.Status` call sites' fix (D15, §3.12-3.13), `ContractVersion` bump
   (D5), `main.go` wiring (§3.16), their tests (§3.17-3.19).
6. **`schema.ts`** (D10, §4.1) — seven `source: 'repo'` tags, the `instanceWide` flag, `git.path`'s
   deletion.
7. **`contract.ts` + `validate.ts`** (D4, D5, §4.2-4.3).
8. **`proxyHandlers.ts`/`extension.ts`** (D6, D10, D11, §4.8-4.9) — four `forward()` simplifications
   now, and the widened eight-key migration routine.
9. **`repoSettings.ts` state + its tests** (D13, §4.4, §4.12).
10. **`RepoSettingsDialog.vue` + `AppToolbar.vue` + `App.vue`** (D13, §4.5-4.7) — five sections now.
11. **Kira Studio's own `SettingsDialog.vue`** (D15, §4.13) — the one new `git.path` field.
12. **`package.json` regeneration** (D12, §4.10) — confirm exactly eight properties disappeared.
13. Full check pass, unchanged in shape from the original plan's step 11, now also covering the
    `frontend`/Wails side (`vue-tsc` over `apps/kira-studio/frontend`, already part of this repo's
    existing `typecheck:web` script per this session's own pre-commit hook output on the original
    commit).

---

## 7. Exit criteria — **revised**

### 7.1 Tier 1

1-7. Unchanged in kind from the original plan (Go tests, TS tests, lint/typecheck/build,
`CONTRACT_VERSION` 22, `contributes.configuration` diffs, the RPC smoke test, `gitclient/settings.go`
gone) — **item 5 widens**: eight keys are gone from `contributes.configuration` now, not five (the
seven moved keys plus `git.path`). Since those eight were every `kiraVersion.*` leaf `schema.ts`
declared, **zero `kiraVersion.*` setting properties remain in `contributes.configuration`'s generated
output after this phase** — confirmed by `grep -c '"kiraVersion\.' apps/kira-studio-vscode/
package.json`'s setting-property count (not its command/menu ids, which are unrelated and unaffected)
dropping to 0. `workbench.tree.indent` was never contributed by this extension in the first place
(`source: 'host'`), so its absence from `contributes.configuration` is unchanged, not a new effect of
this phase.
6. **Widens**: the RPC smoke test also confirms `remote.pullPreflight` sent without `strategySetting`
   honors the repo's stored value, and confirms `repoSettings.set` for `log.level` on repo A is
   visible via `repoSettings.get` on repo B.
8. **New**: `app.init`'s `git` field reflects a configured `git.path` in a test that injects one via
   a fake `Registry.Settings`, rather than only ever seeing `Discovery.Status(ctx, "")`'s
   auto-discovery path (§3.19).

### 7.2-7.3 Unchanged in kind; Tier 3 item 13 widens to also cover a real, pre-upgrade `git.path`
customization migrating correctly into Kira Studio's own settings (not into `repoSettings`).

### 7.4 The checklist — **revised**

- [ ] Seven keys moved to the per-repo dialog; `git.path` fixed but relocated to the existing
      server-owned surface, not the per-repo one (D1).
- [ ] `log.level`'s stored value is identical across every repo (the sentinel actually collapses,
      §3.5's new test) — and the dialog visibly says so (D13-revised).
- [ ] `git.path` no longer appears anywhere in `packages/git-core/src/settings/schema.ts` or
      `contributes.configuration`, and now appears in Kira Studio's own "Git" settings section
      (F15/D15).
- [ ] `Discovery.Status` is never called with a hardcoded `""` anywhere in `internal/gitrpc` after
      this phase — every call site resolves through `Registry.Settings`'s widened closure.
- [ ] `CONTRACT_VERSION`/`ContractVersion` both 22.
- [ ] `graph.loadMore`/`graph.stream`/`review.resolveBase`/`remote.pullPreflight`'s own param shapes
      are byte-identical to before this phase.
- [ ] `proxyHandlers.ts` has four simplified `forward()` calls where bespoke compositions used to be,
      not three.
- [ ] `stash.showInGraph`'s actual graph-filtering behavior is exactly as inert after this phase as
      before it (§0.3, unchanged).

---

## 8. Explicit non-goals for G18 — **revised**

- **Actually wiring `stash.showInGraph` into the graph.** Unchanged — §10.1 (resolved: keep the
  split).
- **A new Vue component-rendering test tier.** Unchanged.
- **Any redesign of Kira Studio's own `SettingsDialog.vue`** beyond the one new `git.path` field in
  its existing "Git" section — its other five sections are untouched.
- **Editing a user's `settings.json` programmatically.** Unchanged — the orphaned legacy value(s)
  are left in place, not removed, for all eight keys now, not five.
- **~~`pull.strategy`/`log.level` moving~~ — REMOVED from this list.** Both move now (10.2).
- **~~Fixing `git.path`'s dead server-side wiring~~ — REMOVED from this list.** It is fixed now
  (10.4), just not inside the per-repo dialog (D15).

---

## 9. Handed forward — **revised**

- **If a later phase wires `stash.showInGraph`'s actual graph filtering**, unchanged from the
  original plan — it now reads from `RepoSettingsGet(repoID)`, same as before.
- **D14's sentinel pattern is a reusable answer, not a one-off hack**, if a future phase ever finds
  another "wants to live in the per-repo dialog, isn't actually per-repo" setting — the same
  `repo_id = ""` convention applies without a schema change, only a new `if key == ...` branch in
  `GitRepoSettingsRepo` plus an `instanceWide: true` tag in `schema.ts`.
- **`RepoSettingsDialog.vue`'s reset-to-default mechanism** — unchanged note from the original plan.
- **`git.path`'s validation** is deliberately absent beyond "is a string" (D15 item 2) — if a later
  phase wants to validate the path actually resolves to a usable git binary *before* saving (rather
  than surfacing a discovery failure only on the next `app.init`/`repo.open`), that is a genuine UX
  improvement this phase does not attempt, matching how `protectedBranches`/`fetchAutoIntervalMinutes`
  are validated for shape/range only, never for "does this branch pattern actually match anything."

---

## 10. Calls that want a human eye — **all four resolved**

### 10.1 `stash.showInGraph` split — **resolved: keep the split**

Asked whether relocating the setting's storage should also mean finally implementing its graph
effect. **User's answer: this plan's own recommendation** — keep the split. No change. §0.3.

### 10.2 `pull.strategy`/`log.level` — **resolved: both move; `log.level` via a reserved sentinel, not a real `repo_id`**

Asked whether these two stay VS-Code-owned or join the per-repo dialog. **User's answer: move both.**
This plan's own follow-up obligation — resolving the semantic mismatch the user's answer did not
itself settle (`log.level` isn't really a per-repo fact) — is D14: same new table, same dialog, a
reserved non-repo sentinel key (`repo_id = ""`, permanently collision-free since a real `RepoID` is
never empty) rather than a real partition, and a visible note in the dialog UI so the non-per-repo
behavior is legible to the user rather than a silent surprise. `pull.strategy`, unlike `log.level`,
is treated as genuinely per-repo (a real `repo_id`) — a repo's own rebase-vs-merge convention is a
legitimate fact about that repo, not an instance-wide preference, so it needed no equivalent special
case.

### 10.3 Read-only footer for what doesn't move — **resolved: no footer; `workbench.tree.indent` excluded entirely; the dialog shows exactly the seven settings that moved**

**User's answer**: show what makes sense in the dialog, remove what doesn't (`workbench.tree.indent`
named explicitly as an example of what to remove) — and for `git.path`, decide based on its
disposition after 10.4. With `pull.strategy`/`log.level` now real entries (10.2) and `git.path` fixed
but explicitly kept out of this dialog (10.4/D15 — it is a machine-level fact, not a per-repo one,
and its two trio-siblings already establish where facts like that belong), the set of "settings that
don't fit this dialog" collapses to exactly `workbench.tree.indent`, which was never a candidate to
begin with (it isn't even this extension's own setting). **Decision, confirmed with reasoning rather
than merely asserted**: no read-only section of any kind. The dialog's own contents are precisely its
own storage's contents — seven keys, all editable, nothing left over to explain away.

### 10.4 `git.path`'s dead wiring — **resolved: fixed in G18, in the existing server-owned surface, not the new per-repo one**

**User's answer**: fix it in G18. This plan's own follow-up obligation — where the fix lives, since
"fix it" did not by itself say "and put it in the new dialog" — is D15: `git.path` was already
correctly classified as server-owned in D1 (unchanged verdict, both before and after this revision);
the only thing that changes is that classification stops being aspirational and starts being real.
The fix threads a real value from `kira.db`'s *existing* `settings` table through
`Registry.Settings`'s widened closure into every `Discovery.Status` call site, and surfaces the field
in Kira Studio's own existing "Git" settings section — the same table, the same closure-injection
pattern, and the same UI surface `protectedBranches`/`fetchAutoIntervalMinutes` already use, not the
new per-repo table or the new git-ui dialog this phase otherwise builds. As a direct, not merely
convenient, consequence: `git.path` is deleted from `packages/git-core/src/settings/schema.ts` and
`apps/kira-studio-vscode/package.json` entirely (D10/D12) — once it is genuinely server-owned, an
orphaned client-side declaration of it would itself become the exact "setting that silently does
nothing" anti-pattern this fix exists to close out.
