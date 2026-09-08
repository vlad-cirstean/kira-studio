# G18 — Per-repo settings: out of `contributes.configuration`, into a dialog on the graph

> **What this phase is.** The eighteenth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and
> the first one whose entire job is *relocating* settings that already exist rather than building a
> new capability from nothing. G17 found `kiraVersion.stash.showInGraph` fully scaffolded
> server-side (`porcelain.WalkSpec.IncludeStash`, `walk.go`'s cache-key inclusion of it,
> `graph/stashRows.ts`'s row filter) and completely inert, and deliberately declined to wire it into
> the graph — that would need new wire surface and its own design. Asked about it, the user's answer
> reached past that one setting: *"these settings should be accessible from the git graph itself,
> not in vscode settings... move them all into a proper dialog. Obviously configurable per repo."*
> This phase is that move: which of `packages/git-core/src/settings/schema.ts`'s nine keys actually
> qualify (five do, on inspection — not the three SPEC's prose names as examples, and not the two
> more this phase's own audit finds do *not* belong), a genuinely new per-repo storage layer, the RPC
> surface it needs, migration for values users already set, and the dialog itself.
>
> **The storage question was open when this plan started and is not open now.** The user's own
> steering, given mid-investigation: these settings go into Kira Studio's **existing main database**
> — the one `storage.Open`/`repos.New` already open in `main.go`, already holding `git_clients`
> (G1's own trust store, `internal/storage/migrations/0016_g1_git_clients.sql`) and the server-owned
> `protectedBranches`/`fetchAutoIntervalMinutes` pair (`internal/storage/repos/settings.go`) — not a
> new standalone file, and explicitly not `review.db`'s pattern. §2 D3 records why that direction was
> independently correct before the steering arrived: `review.db`'s whole design (compressed BLOB
> content, aggressive TTL/PR-close purges) answers a lifecycle these settings do not have, and
> `kira.db` already carries exactly this kind of small, durable, git-module row — `git_clients` is
> the live precedent, not a new pattern being invented for this phase.
>
> **The "server's own default" sentence already sitting in `graph.loadMore`/`graph.stream`/
> `review.resolveBase`'s own doc comments turns out to be almost the whole design.** All three
> already declare `scope`/`pageSize`/`baseCandidates` as *optional* params with documented fallback:
> "a raw socket client that omits them gets the server's own defaults." That sentence was written for
> a hardcoded constant (`"all"`, `logsession.DefaultPageSize`, `["main", "master"]`). Upgrading what
> "the server's own default" *means* — from a fixed constant to "the per-repo stored value, falling
> back to the schema default" — needs **zero change to any of those three request shapes**. The
> extension simply stops sending the three fields (exactly what "a raw socket client" already does
> today, an already-tested code path), and three lines change in `gitrpc/graph.go`/`review.go`. See
> D6.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `8442d866` (G1–G17 planned and, except G17
itself, implemented; this commit is the SPEC renumbering that inserted this phase's own row and
shifted G18–G29 to G19–G30). Working tree clean; no other agent running concurrently. Every claim
below was checked against source read in this container — `packages/git-core/src/settings/
schema.ts` in full, the settings path through `apps/kira-studio-vscode/src/extension.ts` and
`proxyHandlers.ts`, `packages/git-ipc/src/contract.ts`'s `SettingsSnapshot` and the three requests
that already inject settings values, `internal/gitreview` end to end, `internal/storage/repos/
{settings,gitclients}.go` and their migrations, `internal/gitclient/repo.go`'s `RepoID` derivation,
`internal/gitsession/{entry,conn,registry,subscriber}.go`, `internal/notify`, and
`packages/git-ui/src/{App.vue,components/AppToolbar.vue,components/dialogs/StashDialog.vue,
state/settings.ts}` — not assumed from SPEC's prose alone.

### 0.2 Scope

1. A real, audited move-or-stay call for every one of `schema.ts`'s nine keys (§1 F1, §2 D1) — not
   just the three SPEC's own G18 row names as candidates.
2. New per-repo storage in `kira.db` (§2 D3), keyed by `RepoID` (§2 D2 — already this app's own
   stable per-repo identity, reused from `review.db`'s own `repo_id` column, not invented).
3. New RPC surface (`repoSettings.get`/`repoSettings.set`/`repoSettings.changed`), a
   `CONTRACT_VERSION` bump (§2 D5), and — the one piece that turns out to need *no* wire-shape
   change at all — upgrading `graph.loadMore`/`graph.stream`/`review.resolveBase`'s existing
   "server's own default" to mean "this repo's stored value" (§2 D6).
4. A dialog in `packages/git-ui`, opened from a new toolbar entry point `AppToolbar.vue` has been
   explicitly reserving since P4 (§1 F8), matching this app's existing modal conventions
   (`StashDialog.vue`).
5. Removing the five moved keys from `apps/kira-studio-vscode/package.json`'s
   `contributes.configuration`, and a one-time, best-effort migration for a value a user already set
   there (§2 D11) — not a silent data loss, and not a blocking requirement either.

### 0.3 Not in this phase

- **Actually filtering the graph by `stash.showInGraph`.** This phase moves *where the setting is
  stored and edited*. It does not build `WalkSpec.IncludeStash`/`StashShas` population from a
  `stash.list` read, and does not call `graph/stashRows.ts`'s filter from anywhere. That is G17 D1's
  own explicitly-deferred, separately-scoped feature (a real row-filter placement question, server
  vs. client, that G17's own plan left open) — toggling the setting in the new dialog changes what is
  *stored*, not what the graph *shows*, exactly as inert after this phase as before it. §10.1 flags
  this explicitly: it is the single likeliest place a reviewer reads the user's own words ("move
  them all into a proper dialog") as also meaning "and make them work."
- **`protectedBranches`/`fetch.autoInterval`/`git.path`** — SPEC's own server-owned trio, untouched.
  Two of the three (`protectedBranches`, `fetchAutoIntervalMinutes`) are already correctly
  server-owned in `kira.db` today (G7 D16) — nothing to do. `git.path` is a genuine third case, not
  identical to the other two, and is discussed at F3/§10.5 — it stays put per SPEC either way.
- **`log.level`, `pull.strategy`.** Audited and kept where they are — §1 F1/D1 explain why, and
  §10.2 hands the call to a human, since SPEC's own prose does not name them either way.
- **`workbench.tree.indent`.** Not a candidate at all — a read-only mirror of a VS Code setting this
  extension does not own; `source: 'host'` already excludes it from `contributes.configuration` and
  nothing about this phase changes that.
- **No new Vue component-rendering test tier.** G16 built exactly one Playwright tier for
  `packages/git-ui` (pixel geometry against a dead transport) and explicitly declared growing it into
  a behavior tier "a phase of its own." This phase does not build that phase. §2 D13.
- **No change to Kira Studio's own Wails `SettingsDialog.vue`** (`apps/kira-studio/frontend`) — a
  different settings surface, for a different module's settings, untouched.
- **No `docs/v1.3/SPEC.md` edit.** Same convention G12/G14/G15/G16/G17 all followed.

### 0.4 Ground rules

- **Classify every key, not just the three SPEC names.** §1 F1 is the audit; §2 D1 is the table.
- **Reuse before inventing.** `RepoID` (§1 F5), `kira.db`'s per-leaf-JSON-row pattern (§1 F6),
  `internal/notify.Emitter[T]` (§1 F11), and the three requests' own already-optional
  `scope`/`pageSize`/`baseCandidates` params (§1 F12) are all existing seams this phase reuses rather
  than re-derives — each decision below names which one it is standing on.
- **The dialog matches this app's existing modal, not a new visual language.** `StashDialog.vue`'s
  `.kv-modal-backdrop`/`.kv-modal`/`useModalFocus` are reused verbatim.

---

## 1. Findings

### F1 — Every key in `schema.ts`, audited against SPEC's own criterion, not against the three named examples

SPEC's "Settings ownership" section states the test precisely: server-owned when "two windows
disagreeing about them is a correctness/safety issue, not a preference." Applied to all nine keys in
`packages/git-core/src/settings/schema.ts` (`:43-120`), not just the three SPEC's G18 row lists as
candidates:

| Key | Type | Two-window disagreement | Verdict |
|---|---|---|---|
| `kiraVersion.git.path` | string | SPEC names it server-owned explicitly | **stays** (as-is; F3 below is a separate, pre-existing gap) |
| `kiraVersion.graph.pageSize` | number | Harmless — a page-size fetch is purely local rendering | **moves** |
| `kiraVersion.graph.scope` | enum | Harmless — each window's own graph view | **moves** |
| `kiraVersion.log.level` | enum | N/A — not repo-scoped at all; a diagnostic-verbosity preference for *this extension instance's* output channel, unrelated to which repo is open | **stays**, §10.2 |
| `kiraVersion.review.baseCandidates` | stringArray | Harmless per SPEC's test, and arguably a *better* fit for per-repo than the three SPEC names — different repos genuinely use different base-branch conventions (`main` vs. `develop` vs. `trunk`) | **moves** |
| `kiraVersion.pull.strategy` | enum | Each pull is independently valid regardless of which strategy produced it — no cross-window state corruption, but it is a personal integration-style preference (some people always rebase), not a graph/stash *display* setting, and two people on the same repo routinely want different personal defaults here | **stays**, §10.2 |
| `kiraVersion.stash.includeUntracked` | boolean | Harmless — a dialog checkbox default | **moves** |
| `kiraVersion.stash.showInGraph` | boolean | Harmless — the reason this phase exists | **moves** |
| `workbench.tree.indent` | number, `source: 'host'` | Not ours to move — read-only mirror of VS Code's own setting | **stays**, not a candidate |

Five keys move: `graph.pageSize`, `graph.scope`, `stash.showInGraph`, `stash.includeUntracked`,
`review.baseCandidates`. This is SPEC's three named examples plus `stash.includeUntracked` (same
"stash.\*" P9 origin as `showInGraph`, same display-default shape) and `review.baseCandidates`
(SPEC's own "and similar" catch-all, and the strongest per-repo case of the whole set on inspection).
`log.level` and `pull.strategy` are genuine judgment calls, not slam dunks either way — §10.2.

### F2 — The settings flow end to end, today

- `schema.ts`'s `SETTINGS` (§ above) is read by `apps/kira-studio-vscode/src/extension.ts`'s
  `readRawSettings()` (`:74-81`), which iterates every `SETTING_KEYS` member against
  `vscode.workspace.getConfiguration()` — one flat object, **per VS Code window**, not per repo.
  `coerceSettings()` (git-core) validates/falls-back; the result is `currentSettings`, closed over by
  `proxyHandlers.ts`'s handlers.
- `app.init`'s `settings` field is composed **client-side**, in `proxyHandlers.ts:131-139` —
  `settings: settings()` — never touched by the Go server, which has no notion of it at all today
  (confirmed: `gitclient/settings.go`'s `SettingsSnapshot`/`DefaultSettings()` have **zero callers**
  anywhere in `apps/kira-studio`, F13 below).
- **Three requests already inject a subset of that snapshot per-call**, exactly matching SPEC's "can
  travel with the request" sentence, and each one's own doc comment already anticipates a raw client
  omitting the field: `graph.loadMore`/`graph.stream` (`contract.ts:1001-1013,1444-1456`, D6 there —
  `scope`/`pageSize`) and `review.resolveBase` (`:1027-1038` — `baseCandidates`), all injected by
  `proxyHandlers.ts` (`:173-184,315-320,400-410`) from the same `currentSettings()` closure.
- `packages/git-ui/src/state/settings.ts`'s `SettingsState` holds the `app.init` snapshot and applies
  `settings.changed` events (`bridge.on('settings.changed', ...)`) — but that event, today, is
  entirely a **window-scoped** VS Code `onDidChangeConfiguration` echo
  (`extension.ts:428-453`), not anything server-originated or repo-scoped.
- `App.vue` reads three leaves off `SettingsState` directly: `pageSize` (`:143-145`, feeds
  `LoadMoreButton.vue`'s label and `graph.loadMore`'s own request, per G16 F3), `treeIndent`
  (`:151-153`, host-only, untouched by this phase), and `stashIncludeUntrackedDefault` (`:158-162`,
  `StashDialog.vue`'s create-mode default).

### F3 — `kiraVersion.git.path` is already dead server-side, a separate, pre-existing gap this phase does not fix

Every server-side call site that resolves git's location passes a hardcoded empty string:
`gitrpc/graph.go:109,192`, `gitrpc/handlers.go:134,147` all call `r.deps.Discovery.Status(ctx, "")`.
`gitclient.Client.Status(ctx, configuredGitPath)` exists and is documented to take "the git.path
setting," but nothing in this tree ever supplies anything but `""`. So `kiriVersion.git.path`,
declared client-side in `schema.ts` and carried in `app.init`'s `SettingsSnapshot`, has never actually
reached the driver that would use it — a different, older kind of orphaned setting than
`stash.showInGraph`'s (that one is inert because nothing reads it at all; this one is inert because
what *would* read it is wired to ignore it). SPEC keeps `git.path` server-owned, unchanged, and this
phase's own scope is the five keys F1 identifies as moving — fixing this is real work (threading a
configured path from `kira.db`'s settings row, which already has no `git.path` leaf at all, into
`Discovery.Status`) that this phase does not do. §10.5 flags it as worth a human's attention
separately, since it is the one member of the "stays" trio that, unlike the other two, is not
actually functioning as server-owned today either — it simply isn't functioning as anything.

### F4 — `protectedBranches`/`fetchAutoIntervalMinutes` are already correctly positioned; no action needed

`internal/storage/model/settings.go:28-35`'s `GitSettings` (`ProtectedBranches`,
`FetchAutoIntervalMinutes`) is read by `main.go:118-125`'s `gitRegistry.Settings` closure, itself
read fresh on every push pre-flight and auto-fetch tick per G7 D16's own doc comment ("never cached,
since a stale protected-branch list is a safety bug"). This is SPEC's server-owned trio working
exactly as designed, already in `kira.db`, already validated (`GitPatch.Validate`,
`storage/repos/settings.go:130-141`). Confirms F1's classification of these two needs no change and
this phase does not touch `storage/model/settings.go`'s existing `GitSettings`/`GitPatch` at all.

### F5 — `RepoID` already exists, is already this app's per-repo identity, and `review.db` already keys on it

`internal/gitclient/repo.go:196-206` (D7): `RepoID` is the worktree root for a non-bare repo, the git
dir for a bare one — resolved once per `repo.open`/`Registry.Acquire` and carried on every RPC as
`repoId` (confirmed: `RepoID string \`json:"repoId"\`` appears on effectively every `*Params` struct
in `gitrpc/wire.go`). `internal/gitreview/migrations/0001_g11_review.sql`'s own `review_session`
table already keys `UNIQUE (repo_id, branch)` on exactly this string. **No new identity concept is
needed anywhere in this phase** — the same `RepoID` that already flows through every request and
already keys `review.db`'s rows is this phase's own key too. The one caveat, inherited from `RepoID`
itself rather than introduced here: it is a filesystem path, so moving a repository changes its
identity and starts it with fresh (default) settings — the same behavior `review.db`'s own sessions
already have, not a new limitation this phase introduces.

### F6 — `kira.db` already houses exactly this shape of git-module data, twice over — and `review.db`'s own design argues against reusing it here

Two precedents, both already in `kira.db`, both git-module state:

1. **`git_clients`** (`internal/storage/migrations/0016_g1_git_clients.sql`, G1's own trust store) —
   proof that a git-module table living in the app's main database, accessed from `internal/git*`
   packages, is already this codebase's own established pattern, not a new one this phase would be
   inventing. `internal/gitsock/clients.go`'s `TrustStore` interface, satisfied structurally by
   `*repos.GitClientsRepo` and wired in by `main.go` (not a bridge/adapter-layer boundary — `gitsock`
   already imports `internal/storage/repos` directly), is the exact injection shape this phase reuses
   for the new per-repo settings accessor (D3, D8).
2. **`internal/storage/repos/settings.go`'s `SettingsRepo`** — a `settings(key TEXT, value TEXT)`
   table, one JSON-valued row per leaf (`"${section}.${key}"`), read via `leaf`/`leafValid` helpers
   that overlay stored values onto `defaultSettings()`'s own baseline, falling back to the default on
   any unparseable or invalid stored value (`:164-195`). This is **directly reusable**, unchanged in
   shape, for a per-repo variant — the only structural addition a per-repo table needs is a `repo_id`
   column joining the existing `(key, value)` shape into a composite key, and the leaf/leafValid
   fallback-to-default behavior transfers verbatim (D3, D8).

`review.db` (`internal/gitreview/db.go:15-20`) is real prior art for "a second SQLite file, per SPEC
its lifecycle — bulk compressed BLOB content, aggressive TTL/PR-close purges wanting to reclaim space
— is nothing like the rest of the app's data." A settings row is the opposite of that description on
every axis: tiny, never purged, no reason to want a separate file's own vacuum/compaction posture.
**Decided** (user steering, not merely this plan's own preference, though this plan reached the same
conclusion independently before that steering arrived): `kira.db`, not a new file, not `review.db`.

### F7 — CONTRACT_VERSION bumps for every wire-shape addition, without exception, per this project's own six-bump history

`gitrpc/contract.go:11-33`'s own dated comment history bumps for: three additions (G7), one new event
(G10), three new requests plus one `UiActionKind` member (G11), one new request (G12, even though "the
Go server neither emits nor parses this method" — the constant is "the sole compatibility authority"
regardless of which side of the wire actually changed), five new requests plus a reshaped param plus
two `UiActionKind` members (G13), and **one member added to an existing type**
(`SettingsSnapshot.'workbench.tree.indent'`, G14) bundled with one optional field plus one enum
member. There is no precedent anywhere in this history for "a field changed, no bump" — G17's own
"stays at 21" plan (§7.4 there) held only because it added *zero* wire surface of any kind, a fact
its own plan proves with a `git diff --stat` check. This phase adds two requests, one event, and
narrows an existing type (`SettingsSnapshot` loses five members) — a bump is required by this
project's own established rule, not a judgment call. §2 D5.

### F8 — `AppToolbar.vue` has no settings entry point, and has been explicitly reserving one since P4

The component's own top-of-file doc comment (`:2-10`) states the full intended layout —
`[repo ▾] [branch ▾] │ ⟳ │ Fetch Pull Push │ Stash ▾ │ Search […] ⚙` — and then says plainly: "this
toolbar has no settings gear of its own to sit beside (out of scope entirely, no phase implements
one)." The `⚙` was always part of the intended design, in the exact position (immediately after
`SearchBox.vue`, before the remote-progress/undo cluster) the template's actual right-hand section
already occupies (`:290-313`) — this phase is the one that builds it, in the slot already reserved
for it, not a new design decision about where it goes.

### F9 — The modal convention to match: `StashDialog.vue`

`.kv-modal-backdrop` / `.kv-modal` (`role="dialog" aria-modal="true"`), `useModalFocus(active, rootEl)`
for focus trapping, `.kv-modal-title`/`.kv-modal-actions`/`.kv-tag-field` for structure, a primary
button plus a Cancel — all declared unscoped by `CheckoutDialog.vue`/`TagDialog.vue`/
`RevertDialog.vue` and reused, not redeclared, by every dialog that follows (`StashDialog.vue`'s own
closing comment: "`App.vue` always mounts all of them alongside this file, so redeclaring any of it
here would only be duplicate CSS"). The new dialog follows the same rule.

### F10 — `packages/git-ui` has zero tests of any kind, confirmed still true

`find packages/git-ui -name '*.test.ts'` and `-name '*.spec.ts'` both return nothing. This matches
G16's own finding verbatim and is unchanged by G17 (which touched only `App.vue`'s one `runUiAction`
case). What *does* exist, and is genuinely testable without a DOM: every piece of client logic this
app has ever needed tested lives in a plain `state/*.ts` class (`StashState`, `OpsState`, `RefsState`,
`SettingsState` itself), never in a `.vue` file's own `<script setup>` block. This phase's own new
client logic (dirty-tracking, per-field validation, patch construction) goes into a plain-`.ts` state
class for exactly this reason (D13).

### F11 — `internal/notify.Emitter[T]` already exists and is exactly this phase's own live-propagation seam

`internal/notify/notify.go`, a small generic pub-sub ("replacing the Set\<handler\>/on(cb)⇒unsubscribe
idiom... each hand-roll," already used by `gitsock/pairing.go`, `connections/service.go`,
`oplog/wire.go`, `metrics/ticker.go`, `preconnect/supervisor.go`): `Subscribe(fn func(T))
(unsubscribe func())`, `Emit(v T)` snapshotting subscribers under a lock and calling them with the
lock released (safe against a re-entrant subscribe/unsubscribe/emit). This is a direct fit for "every
open connection on this repo sees a settings change live" — genuinely simpler than
`gitsession/subscriber.go`'s own coalescing mechanism, which is purpose-built for high-frequency
filesystem watcher signals (flag-OR plus a capacity-1 wake channel) that a rare, user-triggered dialog
Save has no need of. D7 uses it directly rather than extending `subscriber.go`'s watcher-specific
type.

### F12 — `graph.loadMore`/`graph.stream`/`review.resolveBase` already document the exact fallback this phase needs to redirect, with zero shape change required

Quoted in full because the wording is load-bearing: `graph.loadMore`'s own comment
(`contract.ts:1002-1006`) — *"`scope`/`pageSize` (G3 D6): optional, injected by the extension from
the window's own `kiraVersion.graph.*` settings — SPEC's 'can travel with the request and differ per
window harmlessly'. **A raw socket client that omits them gets the server's own defaults**
('all', 5000)."* `review.resolveBase`'s comment (`:1032-1035`) says the identical thing for
`baseCandidates`. Server-side, `gitrpc/graph.go:19-33`'s `walkSpecFrom`/`pageSizeFrom` are exactly
that fallback — `scope == "" → "all"`, `pageSize == nil → logsession.DefaultPageSize` — already fed a
`repoID` one call up the stack (`resolveWalkRequest(c, p.RepoID, p.Range, p.Scope, p.PageSize)`,
`graph.go:115,188`). **The fallback already exists, is already reached by an already-tested code
path (a raw socket client), and already has `repoID` in scope where it runs.** Upgrading "the
server's own default" from a hardcoded constant to "this repo's stored value, or the schema default"
needs no change to any of these three requests' param shapes — the extension simply stops sending the
three fields, and `walkSpecFrom`/`review.go`'s equivalent gain one lookup each. D6.

### F13 — `internal/gitclient/settings.go` is dead code today, left over from a different design

`SettingsSnapshot`/`DefaultSettings()` there (`git.path`/`graph.pageSize`/`graph.scope`/`log.level`,
its own comment: "OQ-2 defers real settings-surface integration... until then, app.init always
answers with these fixed defaults") has **zero callers anywhere in `apps/kira-studio`** — confirmed
by direct grep. `app.init`'s real settings composition happens client-side in `proxyHandlers.ts`
(F2), never through this file. It predates that design and was never removed. This phase deletes it
(D9) rather than repurposing it — the new per-repo model belongs in `internal/storage/model`
alongside `GitSettings`, matching where the *other* server-owned settings validation already lives,
not in `gitclient`, which holds no settings-validation code that is not this one dead file.

---

## 2. Decisions

### D1 — The move-or-stay table (F1), restated as the decision

**Moves** (new per-repo storage + dialog): `graph.pageSize`, `graph.scope`, `stash.showInGraph`,
`stash.includeUntracked`, `review.baseCandidates`.

**Stays exactly where it is**: `git.path` (SPEC-named, F3's gap is separate), `log.level`,
`pull.strategy` (both §10.2), `workbench.tree.indent` (not a candidate, `source: 'host'`).

This is the one call this plan flags most insistently for override (§10.2/§10.3 both bear on it): a
reviewer who reads the user's "move them all into a proper dialog" as covering `pull.strategy` too
(it does share `kiraVersion.*`'s general shape) should say so — the fix is a one-line move from
`SettingsSnapshot` to `RepoSettingsSnapshot` in contract.ts plus the matching schema.ts `source` tag,
not a redesign of anything else in this plan.

### D2 — Per-repo key: `RepoID`, exactly as `review.db` already uses it

No new identity mechanism (F5). The new table's primary key includes `repo_id TEXT`, populated from
`gitclient.RepoSummary.RepoID` on every read/write, the same string already on every RPC's `repoId`
field. A repo moved on disk starts with default settings under its new path — accepted, not solved,
matching `review.db`'s own already-accepted version of the identical limitation.

### D3 — Storage: a new table in `kira.db`, shaped like `settings`'s existing per-leaf-row pattern plus `repo_id`

**Decided** (F6, and per the user's own steering): `kira.db`, not a new file. New migration
`internal/storage/migrations/0017_g18_git_repo_settings.sql`:

```sql
-- G18: per-repo display settings (graph page size/scope, stash dialog defaults, review base
-- candidates) — moved out of VS Code's contributes.configuration into an in-app dialog. One row per
-- (repo, leaf), mirroring the existing `settings` table's own per-leaf-JSON shape (settings.go) —
-- the same "a hand-edited or stale-shape row falls back to its default, never propagates" discipline
-- applies here via the same leaf/leafValid helpers, now scoped by repo_id.
CREATE TABLE git_repo_settings (
  repo_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (repo_id, key)
);
```

`internal/storage/model/gitreposettings.go` (new, alongside `settings.go`'s existing
`GitSettings`/`GitPatch`, not inside `gitclient` — F13):

```go
// GitRepoSettings mirrors packages/git-core/src/settings/schema.ts's five `source: 'repo'` keys
// (G18) — the per-repo counterpart to GitSettings' two server-owned leaves above.
type GitRepoSettings struct {
	GraphPageSize          int      `json:"graphPageSize"`
	GraphScope             string   `json:"graphScope"`
	StashShowInGraph       bool     `json:"stashShowInGraph"`
	StashIncludeUntracked  bool     `json:"stashIncludeUntracked"`
	ReviewBaseCandidates   []string `json:"reviewBaseCandidates"`
}

func DefaultGitRepoSettings() GitRepoSettings {
	return GitRepoSettings{
		GraphPageSize: 5000, GraphScope: "all",
		StashShowInGraph: true, StashIncludeUntracked: false,
		ReviewBaseCandidates: []string{"main", "master"},
	}
}
```

Values match `schema.ts`'s own defaults exactly (`pageSize: 5000`, `scope: "all"`,
`showInGraph: true`, `includeUntracked: false`, `baseCandidates: ["main", "master"]`) — the same
"Go mirrors TS, kept honest by both sides reading the same upstream source" convention `gitclient/
settings.go`'s own (now-deleted, F13) doc comment already named. `GitRepoSettingsPatch` (all
pointers, `.omitempty`) and a `Validate()` mirroring `GitPatch.Validate()`'s bounds (`pageSize`
100–50000, `scope` ∈ {`all`,`head`}, `reviewBaseCandidates` non-empty strings) — same shape as the
existing `SettingsPatch.Validate()`, one new `case` per leaf.

`internal/storage/repos/gitreposettings.go` (new): `GitRepoSettingsRepo` with `Get(repoID string)
(model.GitRepoSettings, error)` (never errors on a missing row — returns
`DefaultGitRepoSettings()`, exactly `SettingsRepo.GetAll()`'s own "unknown key stays at its default"
behavior, scoped) and `Set(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings,
error)` (validates, upserts only the patched leaves in one transaction, returns `Get(repoID)`
afterward) — a direct, mechanical port of `SettingsRepo.GetAll`/`Set`'s own `leaf`/`leafValid`/
`upsertSettingsLeaf` helpers, with `WHERE repo_id = ?` added to the read and `repo_id` added to every
write. **Reset to default** is `DELETE FROM git_repo_settings WHERE repo_id = ? AND key = ?` for one
leaf (the dialog's per-field reset) or `WHERE repo_id = ?` for all of them (a whole-dialog reset) —
falls back to `DefaultGitRepoSettings()` automatically via the same "row absent ⇒ default" read path,
no separate "is this reset" flag needed anywhere.

`internal/storage/repos/repos.go`: `GitRepoSettings *GitRepoSettingsRepo` added to the aggregate,
constructed the same way `GitClients: &GitClientsRepo{DB: db}` already is (`:73`).

### D4 — RPC surface: two requests, one event, `SettingsSnapshot` narrows, `RepoSettingsSnapshot` is new

`packages/git-ipc/src/contract.ts`:

```ts
/** The remaining, window/host-scoped keys (D1) — narrowed from nine to four members this phase
 *  (G18): the five per-repo display keys move to RepoSettingsSnapshot below. */
export interface SettingsSnapshot {
  readonly 'kiraVersion.git.path': string;
  readonly 'kiraVersion.log.level': 'off' | 'error' | 'warn' | 'info' | 'debug';
  readonly 'kiraVersion.pull.strategy': 'auto' | 'ff-only' | 'merge' | 'rebase';
  readonly 'workbench.tree.indent': number;
}

/** G18: the five per-repo display settings, server-stored, edited from the new in-app dialog
 *  (packages/git-ui). Fetched by repoSettings.get, mutated by repoSettings.set, and pushed live to
 *  every open connection on this repo via repoSettings.changed. */
export interface RepoSettingsSnapshot {
  readonly 'kiraVersion.graph.pageSize': number;
  readonly 'kiraVersion.graph.scope': 'all' | 'head';
  readonly 'kiraVersion.stash.showInGraph': boolean;
  readonly 'kiraVersion.stash.includeUntracked': boolean;
  readonly 'kiraVersion.review.baseCandidates': readonly string[];
}
```

New requests: `repoSettings.get: { params: { repoId: string }; result: RepoSettingsSnapshot }` and
`repoSettings.set: { params: { repoId: string; patch: Partial<RepoSettingsSnapshot> }; result:
RepoSettingsSnapshot }` (returns the full post-write snapshot, matching `SettingsRepo.Set`'s own
"validate, write only the patched leaves, return `GetAll()` afterward" shape, D3). New event:
`repoSettings.changed: { repoId: string; settings: RepoSettingsSnapshot }` (host → webview,
server-originated — genuinely new; unlike the existing `settings.changed`, this one is *not* an
extension-composed echo of `onDidChangeConfiguration`, D7).

`app.init`'s own result type is untouched except for `SettingsSnapshot`'s narrower shape (D6 explains
why `proxyHandlers.ts`'s `settings: settings()` composition needs no code change despite the type
narrowing — TypeScript's structural typing does the work).

### D5 — `CONTRACT_VERSION`: 21 → 22

Required, not optional (F7). `packages/git-ipc/src/validate.ts:24` and
`apps/kira-studio/internal/gitrpc/contract.go:34`, with a new dated bump comment following the
existing six-entry history's own convention: *"G18 D5: 21 -> 22, for `repoSettings.get`/
`repoSettings.set` (two new requests) and `repoSettings.changed` (one new event); `SettingsSnapshot`
loses five members (moved to the new `RepoSettingsSnapshot`)."*

### D6 — `graph.loadMore`/`graph.stream`/`review.resolveBase` need **no param-shape change at all**

F12 is the whole argument: these three requests already document "optional, a raw client that omits
it gets the server's own default." This phase changes what that default *is* — repo-stored, not
constant — not the shape carrying it.

- **`proxyHandlers.ts`** (`:173-184, 315-320, 400-410`): the three bespoke compositions that inject
  `scope`/`pageSize`/`baseCandidates` from `settings()` are **deleted**. All three become plain
  `forward('graph.loadMore')`/`forward('graph.stream')`/`forward('review.resolveBase')` calls, same
  as `graph.status`/`graph.refresh` already are — this phase *removes* code from `proxyHandlers.ts`,
  it does not add any. The extension no longer needs to know these five settings exist at all once
  the migration (D11) has run.
- **`gitrpc/graph.go`**: `walkSpecFrom`/`pageSizeFrom` (`:19-33`) gain a `repoID string` parameter
  (already one call frame away at both existing call sites, `resolveWalkRequest`,
  `graph.go:115,188`) and, when `scope`/`pageSize` arrive empty, resolve
  `RepoSettingsGet(repoID)` before falling back to the schema constant — same two-line shape as
  `walkSpecFrom` already has, one new lookup inserted ahead of the existing hardcoded fallback.
- **`gitrpc/review.go`**'s `review.resolveBase` handler gains the identical one-line upgrade for
  `baseCandidates`.
- **`stash.list`'s own create-dialog default** (`stash.includeUntracked`) has no equivalent
  request-level injection today — `App.vue` reads it straight off `SettingsState` client-side (F2).
  Its replacement is the new `RepoSettingsState` (D12) read the same way; no Go RPC handler needs to
  know this value at all, since it only ever seeds a dialog's initial checkbox state, never a spawn
  argument (`runStashPush`'s own `includeUntracked` param is always explicitly supplied by the
  dialog's current checkbox state at submit time, not re-derived server-side).

**What this buys**: zero change to two request shapes G3/G6 already built, tested, and shipped
against; `proxyHandlers.ts` gets smaller, not larger; and the server is now the single source of
truth for these values instead of a value the extension caches and re-injects on every call — the
staleness risk of a client-cached copy disagreeing with what `repoSettings.set` just wrote is
eliminated by construction, not by careful cache invalidation. §10.4 flags the conservative
alternative (keep injecting, source the injected value from a client-side `repoSettings.get` cache)
for a reviewer who would rather touch fewer existing files at the cost of exactly that staleness risk.

### D7 — Live propagation: `internal/notify.Emitter[T]`, not `gitsession/subscriber.go`'s coalescing mechanism

F11 is the reasoning. `RepoEntry` (`gitsession/entry.go`) gains one field:

```go
// settingsChanged fans out G18's repoSettings.set (a rare, user-triggered event) to every
// connection currently holding this repo open — internal/notify's small generic pub-sub, not
// subscriber.go's coalescing watcher-signal mechanism (D14/F13 there), which exists for
// high-frequency fsnotify bursts this event has no shape in common with.
settingsChanged notify.Emitter[gitrpc.RepoSettingsSnapshot]
```

(The wire type import direction — `gitsession` depending on `gitrpc`'s wire shape — is checked
against this package's existing dependency direction before landing; if `gitsession` must not import
`gitrpc`, the emitted value is `storage/model.GitRepoSettings` instead, and `gitrpc`'s handler
projects it to wire shape on the way out, the same translation `handleStashList`-style handlers
already do for every other server-side type. Implementer's call, not a design fork — §3 names it.)

A new `RepoEntry.SubscribeSettings(deliver func(...)) (unsubscribe func())` method wraps
`settingsChanged.Subscribe`. `conn.go:180`'s existing `entry.Subscribe(c.ID, func(ev Event) {...})`
call, inside `Conn.Open`, gains a sibling call to `entry.SubscribeSettings(func(snap ...) {
if c.Emit != nil { c.Emit("repoSettings.changed", RepoSettingsChangedEvent{RepoID: repoID, Settings:
snap}) } })`, and the two unsubscribe funcs are combined into the one closure `Open` already stores
and calls on teardown. `repoSettings.set`'s own handler, after `GitRepoSettingsRepo.Set` succeeds,
calls `entry.settingsChanged.Emit(result)`.

**This is real, not "reload to see it."** Two VS Code windows open on the same repo both see a save
made in either one, live — matching the user's own "configurable per repo" framing (a per-repo
setting that silently disagreed between two windows on the *same* repo until one was closed and
reopened would be a strange kind of "per-repo").

### D8 — `main.go` wiring: the same closure-injection shape `gitRegistry.Settings` already uses, widened by one parameter

```go
gitRegistry.RepoSettingsGet = func(repoID string) (model.GitRepoSettings, error) {
	return repositories.GitRepoSettings.Get(repoID)
}
gitRegistry.RepoSettingsSet = func(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings, error) {
	return repositories.GitRepoSettings.Set(repoID, patch)
}
```

`gitsession/registry.go` gains the two fields (`RepoSettingsGet`/`RepoSettingsSet` function types),
defaulted the same way `Settings` is (`:72`, a no-op stub returning `DefaultGitRepoSettings(), nil`)
so tests that construct a bare `Registry` are unaffected. No interface is introduced (unlike
`gitsock.TrustStore`) because the accessor is a single `(repoID) (settings, error)` shape, not the
five-method surface `TrustStore` needs — matching `Settings func() (...)`'s own already-simpler
precedent over `TrustStore`'s richer one.

### D9 — `internal/gitclient/settings.go` is deleted, not repurposed

F13. The new model lives in `internal/storage/model` (D3), matching where `GitSettings`/`GitPatch`
already live for the *other* server-owned settings — `gitclient` keeps holding driver/discovery
code, not settings-validation code, which was never really its concern even before this file
existed as dead weight.

### D10 — `schema.ts` gains a third `source` value, `'repo'`

```ts
/** G14 D6/G18: where a setting's value comes from. 'extension' (default): this extension owns and
 *  contributes it. 'host': the editor owns it, read-only (workbench.tree.indent). 'repo' (G18):
 *  this extension owns it, but it is no longer a VS Code setting at all — server-stored per
 *  repository, edited from the in-app dialog (packages/git-ui), never contributed to
 *  contributes.configuration. */
readonly source?: 'extension' | 'host' | 'repo';
```

The five moved keys (F1) get `source: 'repo'`. `toVsCodeConfiguration()` (`:242-264`)'s skip
condition widens from `if (def.source === 'host') continue;` to `if (def.source !== undefined)
continue;` — 'extension' is the only source that should ever be contributed, and it is already the
default/undefined case, so this is a narrowing of the check to its actual intent rather than a new
branch. A new exported helper, `repoSettingKeys(): readonly SettingKey[]` (`source === 'repo'`),
feeds both the dialog (D12) and `RepoSettingsState`'s own default-fallback construction — the "one
schema, one place" promise D25's own doc comment already made for exactly this situation ("a future
host's own settings surface would generate from the same schema rather than inventing a second one")
is what the new dialog *is*.

**`coerceSettings`/`defaultSettings`/`Settings` (the TS type) are unchanged** — they still cover all
nine keys, the one schema D25 promises. Only `toVsCodeConfiguration()` and the new
`repoSettingKeys()` filter which subset applies where. This means `SettingsSnapshot`'s narrower
9→4-member shape (D4) does not require any picking/omitting logic anywhere it is constructed:
`proxyHandlers.ts`'s `settings: settings()` composition keeps returning the full, unpicked
`Settings` object — TypeScript's structural typing accepts a wider object literal-free value where a
narrower interface is expected (no excess-property check fires on a variable, only on an object
literal), so this line needs **zero code change**, only the `SettingsSnapshot` type declaration it is
checked against narrows.

`extension.ts`'s `readRawSettings()` (`:74-81`) changes its iteration set from all `SETTING_KEYS` to
`hostSettingKeys()` (a new small helper, `SETTING_KEYS.filter(k => SETTINGS[k].source !== 'repo')`)
— it must **stop** reading the five repo-scoped keys from `vscode.workspace.getConfiguration()` on
every poll (`onDidChangeConfiguration`'s own handler, `:428-453`), since after migration (D11) that
value lives server-side and a live VS Code config value (however stale) must never resurrect and
override it.

The stale `wireConformance.test.ts` reference in `schema.ts`'s own top comment (`:14-17`) — that
file does not exist anywhere in this repo (confirmed, `find`/`grep` both empty) — is corrected in the
same commit that touches this file's neighborhood, matching G17 D10's own "drive-by fix where the
diff already is" convention: the sentence is reworded to name what actually keeps `SettingsSnapshot`
honest today (nothing automated does, currently — the comment is corrected to say so plainly rather
than pointing at a file that was never ported, not expanded into building that missing test here).

### D11 — Migration for values a user already set: one-time, extension-side, best-effort, never edits `settings.json`

The five keys leave `contributes.configuration` entirely (D12) — `vscode.workspace.getConfiguration()`
still returns whatever a user has in `settings.json` for an uncontributed key (VS Code does not purge
it), so the value is not *lost*, only no longer read by the normal per-window polling path (D10
already stopped that). The migration:

- Runs once per `(repoId)`, on that repo's first `repo.open` after the user's extension upgrades to
  this version — tracked in `context.globalState` (`migratedRepoSettingsIds: string[]`, VS Code's own
  small persistent per-installation store, not a new server concept), so it is idempotent and never
  re-runs once it has.
- For each of the five keys, `vscode.workspace.getConfiguration().inspect(key)` (not `.get()`) — this
  distinguishes a value the user actually set (`globalValue`/`workspaceValue`/`workspaceFolderValue`
  present) from VS Code silently reporting the schema's own inherited default, which must **not** be
  treated as a deliberate customization worth migrating.
- Any key with a genuine user override becomes one `repoSettings.set` patch, called **only if**
  `repoSettings.get` for that repo currently shows the schema default for that leaf (never overwrite
  a value someone already set through the new dialog with a stale VS Code one) — cheap and correct
  without needing a new "was this ever customized" wire concept, since the check is "does the stored
  row already differ from `DefaultGitRepoSettings()`" purely client-side, no new server support
  needed.
- The orphaned `settings.json` entry is **left in place**, not programmatically removed. Reaching
  into every configuration scope (user/workspace/folder/language) to safely `update(key, undefined,
  target)` a key that may be set in more than one of them is exactly the kind of "get one wrong and
  it silently fails for someone" mechanical risk G10 D19's own doc comment already warns about for a
  much smaller change (host-capability methods) — not worth it for a value that, once migrated, is
  simply inert going forward (it no longer appears in VS Code's Settings UI at all, since it is no
  longer contributed, so it is not actively confusing on an ongoing basis, only a leftover line in a
  file the user already owns).

### D12 — `apps/kira-studio-vscode/package.json`: the five keys are removed, not kept-and-ignored

`scripts/gen-settings.ts` (D25's own codegen) already drives `contributes.configuration` from
`toVsCodeConfiguration()` — D10's own `source`-filter change means re-running that script is the
entire mechanism; no hand-edit of `package.json`'s settings block is needed or correct (a hand-edit
would drift from the schema the moment either changes independently again).

### D13 — The dialog: where it opens from, what it contains, and what does — and does not — get tested

**Trigger**: a new `⚙` icon button in `AppToolbar.vue`, in the slot its own doc comment has reserved
since P4 (F8) — after `SearchBox.vue`, before the remote-progress/undo cluster — using the existing
`.kv-icon-button` class already established by the remote-cancel button (`:301-310`) and a
`codicon-gear` icon, `title="Repository settings"`, `data-testid="repo-settings-button"`.

**Component**: `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue`, new, matching
`StashDialog.vue`'s conventions exactly (F9): `.kv-modal-backdrop`/`.kv-modal`, `useModalFocus`,
`role="dialog"`. Three sections, each with its own "Reset to default" action per field (not just one
whole-dialog reset, since a user changing their mind about `pageSize` alone should not also discard a
customized `baseCandidates`):

- **Graph** — `pageSize` (`<input type="number">`, `min`/`max` from `SETTINGS['kiraVersion.graph.
  pageSize']` directly, live-validated against the same bounds on every keystroke), `scope`
  (`<select>` populated from the schema's own `enum`).
- **Stash** — `showInGraph` (checkbox — inert per §0.3/§10.1, labelled plainly as such: "Show stash
  entries in the graph (not yet implemented — see kira-studio #G18)" is the honest label, not a
  claim the toggle does something it does not), `includeUntracked` (checkbox).
- **Branch review** — `baseCandidates` (an ordered list editor: add/remove/reorder text rows, each
  validated as non-empty; the create-order is significant, per `pull.strategy`'s own doc-comment
  precedent for why order matters in a stringArray setting).

**Data flow**: a new `packages/git-ui/src/state/repoSettings.ts`, `RepoSettingsState` — plain class,
same shape as `SettingsState` (F10: this is where the logic lives, testable without a DOM), holding
the current server snapshot (`shallowRef<RepoSettingsSnapshot>`), a `dirty` patch built as the dialog
form changes, `save()` (calls `repoSettings.set`, applies the result), `resetField(key)` (calls
`repoSettings.set` with that one leaf explicitly reset — mechanically: `Set`'s Go-side "only writes
patched leaves" doesn't have a "delete this leaf" wire shape today, so **reset** is implemented as
"set the leaf back to `SETTINGS[key].default` explicitly," not a `DELETE`-shaped wire call — simpler
than adding a second wire verb for what is, from the client's perspective, indistinguishable from any
other save). Recreated/reset on repo switch exactly like `refsState`/`opsState`/`stashState`
(`App.vue:245-255`'s existing `watch(() => repoState.value?.activeRepo.value?.repoId, ...)` block
gains one more `.setRepoId(repoId)` call), and subscribes to `repoSettings.changed` scoped to the
active repo, applying a remote change to the snapshot **only when the dialog is not itself mid-edit**
(a local unsaved edit must not be silently clobbered by another window's concurrent save — the same
"don't stomp an in-progress edit" concern `StashDialog.vue`'s own branch-name preview race guard
already handles with its `previewToken` pattern, reused here as "an incoming `repoSettings.changed`
while `dirty` is non-empty is queued, not applied, until the dialog closes or is explicitly
refreshed").

**`App.vue`'s existing `pageSize`/`stashIncludeUntrackedDefault` computeds (`:143-145,158-162`)**
move from reading `settingsState.value?.settings.value[...]` to reading the new
`repoSettingsState.value?.settings.value[...]` — a one-line source change each, fallback still the
schema's own default.

**Testing (D13/F10)**: `RepoSettingsState` gets unit tests (bun test, no DOM) — dirty-tracking,
save/reset round trips against a mock bridge, the "don't stomp a mid-edit" queueing behavior. The
`.vue` template itself gets no new automated test, matching G16 D11's own "one-condition render
guards get none" carve-out, scaled up to "a form whose fields are thin bindings to an already-tested
state class" — no new Playwright behavior tier is built (G16's own declared non-goal, restated at
§0.3).

---

## 3. The Go side, file by file

### 3.1 `internal/storage/migrations/0017_g18_git_repo_settings.sql` — **new** (D3)

The `git_repo_settings` table, exactly as shown in D3.

### 3.2 `internal/storage/model/gitreposettings.go` — **new** (D3, D9)

`GitRepoSettings`, `DefaultGitRepoSettings()`, `GitRepoSettingsPatch` (all-pointer, `.omitempty`),
`(p GitRepoSettingsPatch) Validate() error` — bounds matching `schema.ts`'s own `minimum`/`maximum`/
`enum` for each moved key, same error-naming convention as `SettingsPatch.Validate()`.

### 3.3 `internal/storage/repos/gitreposettings.go` — **new** (D3)

`GitRepoSettingsRepo{DB *sql.DB}`, `Get(repoID string) (model.GitRepoSettings, error)`,
`Set(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings, error)` — direct port
of `SettingsRepo.GetAll`/`Set`'s `leaf`/`leafValid`/`upsertSettingsLeaf` helper shapes, `repo_id`
added to every query. `reviewBaseCandidates` (a `[]string`) round-trips through the same
`json.Marshal`/`Unmarshal` leaf encoding `protectedBranches` already uses in the sibling table.

### 3.4 `internal/storage/repos/repos.go` — edited

`GitRepoSettings *GitRepoSettingsRepo` field added to the aggregate; constructed alongside
`GitClients` in `repos.New` (`:73`).

### 3.5 `internal/storage/repos/gitreposettings_test.go` — **new** (D11 checklist)

Get-returns-defaults-for-unknown-repo, Set-then-Get round trip per leaf, an invalid patch (out of
range `pageSize`, unknown `scope` value) rejected with `Validate`'s own error naming the leaf,
reset-one-leaf (set it back to the schema default explicitly, per D13's own reset mechanism) leaves
the other leaves untouched, two different `repoID`s never see each other's rows.

### 3.6 `internal/gitclient/settings.go` — **deleted** (D9, F13)

Zero callers confirmed (§1 F13); the replacement lives in `internal/storage/model` (3.2).

### 3.7 `internal/gitsession/registry.go` — edited (D8)

`RepoSettingsGet func(repoID string) (model.GitRepoSettings, error)` and `RepoSettingsSet
func(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings, error)` fields, next
to the existing `Settings` field (`:46-52`); defaulted in `NewRegistry` (`:72`) to a stub returning
`model.DefaultGitRepoSettings(), nil` — same "tests set it directly, the real one is
`storage/repos`-backed" seam comment `Settings` already carries.

### 3.8 `internal/gitsession/entry.go` — edited (D7)

`RepoEntry` gains `settingsChanged notify.Emitter[gitrpc.RepoSettingsSnapshot]` (or the
`storage/model.GitRepoSettings`-typed variant if the dependency direction forbids `gitsession`
importing `gitrpc` — checked against this package's existing imports before landing, per D7's own
note) and `SubscribeSettings(deliver func(...)) (unsubscribe func())` wrapping
`settingsChanged.Subscribe`. No change to `Event`, `Subscribe`, or `subscriber.go` — a fully separate,
additive seam (F11).

### 3.9 `internal/gitsession/conn.go` — edited (D7)

`Conn.Open` (`:168-210`)'s existing `entry.Subscribe(c.ID, ...)` call gains a sibling
`entry.SubscribeSettings(...)` call, both unsubscribe funcs combined into the one stored closure
(same pattern the existing code already uses for combining teardown paths).

### 3.10 `internal/gitrpc/wire.go` — edited (D4)

`RepoSettingsSnapshot` (the wire projection of `model.GitRepoSettings`, field names matching
`contract.ts`'s dotted keys via `json` tags — e.g. `\`json:"kiraVersion.graph.pageSize"\``, same
convention the deleted `gitclient/settings.go` used), `RepoSettingsGetParams{RepoID string}`,
`RepoSettingsSetParams{RepoID string; Patch RepoSettingsPatchWire}`, `RepoSettingsChangedEvent{RepoID
string; Settings RepoSettingsSnapshot}`.

### 3.11 `internal/gitrpc/settings.go` — **new** (D4, D6)

`handleRepoSettingsGet`, `handleRepoSettingsSet` — thin dispatch matching `handleStashList`'s own
shape (F- from G17: "decode params, validate required fields, `entryFor`, call one method,
`mapGitError` on failure"). `handleRepoSettingsSet` additionally calls `entry.settingsChanged.Emit`
after a successful write (D7).

### 3.12 `internal/gitrpc/handlers.go` — edited

Two new `case` arms in `Router.ForConn`'s `Request` switch: `"repoSettings.get"`,
`"repoSettings.set"`.

### 3.13 `internal/gitrpc/graph.go` — edited (D6)

`walkSpecFrom`/`pageSizeFrom` (`:19-33`) gain a `repoID string` parameter and consult
`RepoSettingsGet(repoID)` before falling back to the current hardcoded constants; both call sites
(`resolveWalkRequest`, `:157,159`) pass `repoID` through (already in scope one frame up).

### 3.14 `internal/gitrpc/review.go` — edited (D6)

`review.resolveBase`'s handler gets the identical one-line upgrade for `baseCandidates`.

### 3.15 `internal/gitrpc/contract.go` — edited (D5)

`ContractVersion` 21 → 22, new dated comment (D5's own wording).

### 3.16 `main.go` — edited (D8)

`gitRegistry.RepoSettingsGet`/`RepoSettingsSet` closures, next to the existing `gitRegistry.Settings`
assignment (`:118-125`).

### 3.17 `internal/gitsession/*_test.go` — new tests

`TestRepoEntry_SubscribeSettings_DeliversToEveryConnection` (mirrors `subscriber_test.go`'s own
shape, against the new `notify.Emitter`-backed seam instead), `TestConnOpen_CombinesBothUnsubscribes`
(a `Close()` after `Open()` leaves neither `subs` map holding a stale entry).

### 3.18 `internal/gitrpc/settings_test.go` — new tests

Missing `repoId` rejected (matching every other handler's own validation convention, F-cited from
G17), a valid `Set` round-trips through `Get`, an invalid patch's `Validate` error surfaces as the
RPC error rather than a silent partial write, a second `Conn` subscribed to the same repo receives
`repoSettings.changed` after the first `Conn`'s `Set` (an integration-shaped test, matching this
package's existing `graph.go`/`ops.go` test conventions for a multi-step RPC flow).

---

## 4. The TypeScript / Vue side, file by file

### 4.1 `packages/git-core/src/settings/schema.ts` — edited (D10)

`SettingDef.source` widens to include `'repo'`; the five moved keys tagged; `toVsCodeConfiguration()`
skip condition widens to `def.source !== undefined`; new `repoSettingKeys()` export; the stale
`wireConformance.test.ts` doc-comment reference corrected (D10's own closing note).
`coerceSettings`/`defaultSettings`/`SETTINGS`/`Settings` themselves are unchanged in shape.

### 4.2 `packages/git-ipc/src/contract.ts` — edited (D4)

`SettingsSnapshot` narrows to four members; new `RepoSettingsSnapshot` (five members);
`'repoSettings.get'`/`'repoSettings.set'` requests; `'repoSettings.changed'` event.

### 4.3 `packages/git-ipc/src/validate.ts` — edited (D5)

`CONTRACT_VERSION` 21 → 22.

### 4.4 `packages/git-ui/src/state/repoSettings.ts` — **new** (D13)

`RepoSettingsState` — bridge-driven class, `settings: ShallowRef<RepoSettingsSnapshot>`, `dirty:
ShallowRef<Partial<RepoSettingsSnapshot>>`, `setRepoId(repoId)` (re-fetches via `repoSettings.get`,
resets `dirty`, re-subscribes `repoSettings.changed` scoped to the new repoId), `save()`,
`resetField(key)`, the mid-edit queueing behavior from D13's own description.

### 4.5 `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue` — **new** (D13)

The three sections, per-field validation and reset, matching `StashDialog.vue`'s structural and
visual conventions exactly (no new `<style>` block — reuses `.kv-modal-*`/`.kv-tag-field*`, F9).

### 4.6 `packages/git-ui/src/components/AppToolbar.vue` — edited (D13, F8)

One new `⚙` button in the already-reserved slot; one new emit (`open-repo-settings`) forwarded from
`App.vue`, matching `stash-changes`'s own emit-and-forward shape.

### 4.7 `packages/git-ui/src/App.vue` — edited

- New `repoSettingsState` (mirrors `settingsState`'s own declaration), reset alongside
  `refsState`/`opsState`/`stashState`/`searchState` in the existing `repoId` watch (`:245-255`).
- `pageSize`/`stashIncludeUntrackedDefault` computeds (`:143-145,158-162`) re-sourced from
  `repoSettingsState` instead of `settingsState`.
- One new dialog-open boolean plus the toolbar's `open-repo-settings` handler, mounting
  `RepoSettingsDialog.vue` alongside the existing `StashDialog`/`CheckoutDialog`/etc. mounts.

### 4.8 `apps/kira-studio-vscode/src/proxyHandlers.ts` — edited (D6)

The three bespoke `graph.loadMore`/`graph.stream`/`review.resolveBase` compositions become plain
`forward(...)` calls — this file gets **smaller**.

### 4.9 `apps/kira-studio-vscode/src/extension.ts` — edited (D10, D11)

`readRawSettings()`'s iteration narrows to `hostSettingKeys()`. New one-time migration routine
(D11), run from `activate()` at the point a repo is first opened per window (wherever `repo.open`'s
own success is already observed — the existing `app.init`/probe-call site, `:410-425`, is the
natural hook, since that is already where this file learns a repo is live).

### 4.10 `apps/kira-studio-vscode/package.json` — edited (D12)

Regenerated via `scripts/gen-settings.ts` after 4.1's `source` change — the five keys' entries
disappear from `contributes.configuration`.

### 4.11 `packages/git-ui/src/state/settings.ts` — **not edited**

`SettingsState` keeps its existing shape, now over the narrower four-key `SettingsSnapshot` — no
code change needed, only the type it is generic over shrinks (same structural-typing point as D10's
closing paragraph).

### 4.12 `packages/git-ui/src/state/repoSettings.test.ts` — **new** (D13, F10)

`RepoSettingsState`'s own unit tests, no DOM: initial fetch on `setRepoId`, `save()`'s dirty-clearing,
`resetField`'s single-leaf reset, the mid-edit queueing behavior (a `repoSettings.changed` arriving
while `dirty` is non-empty is held, not applied, until `dirty` clears).

### 4.13 Not edited

`packages/git-ui/src/components/dialogs/StashDialog.vue` (reused, not modified — F9),
`internal/gitreview/**` (F6's own conclusion — wrong lifecycle, not touched), `internal/storage/
model/settings.go`/`storage/repos/settings.go` (F4 — the *other* server-owned settings are already
correct, untouched), `apps/kira-studio/frontend/**` (Kira Studio's own Wails settings UI, a
different module's settings entirely).

---

## 5. Dependencies and tooling

Nothing new. `internal/notify` is already a dependency of several existing packages; `kira.db`'s
migration machinery, `scripts/gen-settings.ts`, and every test convention this phase reuses are all
already in the tree.

---

## 6. Implementation order

One sequential subagent — the Go side is order-dependent (storage → registry wiring → RPC → the
`graph.go`/`review.go` fallback upgrade), the TS side depends on the Go side's wire shapes being
final before `contract.ts` is written, and the Vue side depends on `contract.ts`.

1. **Storage** (D3, §3.1-3.5): migration, `storage/model`, `storage/repos`, their tests. `go test
   ./apps/kira-studio/internal/storage/...`.
2. **`gitclient/settings.go` deletion** (D9, §3.6) — confirm zero callers one more time
   (`grep -r gitclient.SettingsSnapshot`) immediately before deleting, not merely trusting this
   plan's own earlier grep.
3. **Registry/entry/conn wiring** (D7, D8, §3.7-3.9), their tests (§3.17). `go test
   ./apps/kira-studio/internal/gitsession/...`.
4. **RPC surface** (D4, §3.10-3.12), the `graph.go`/`review.go` fallback upgrade (D6, §3.13-3.14),
   `ContractVersion` bump (D5, §3.15), `main.go` wiring (§3.16), their tests (§3.18). `go test
   ./apps/kira-studio/internal/...` (SPEC's own scoped git-package set).
5. **`schema.ts`** (D10, §4.1) — the `source: 'repo'` tagging, `toVsCodeConfiguration()` widening,
   `repoSettingKeys()`. `bun run typecheck` inside `packages/git-core`.
6. **`contract.ts` + `validate.ts`** (D4, D5, §4.2-4.3) — `CONTRACT_VERSION` 22 on both sides now
   agree (`grep`, both languages).
7. **`proxyHandlers.ts`/`extension.ts`** (D6, D10, D11, §4.8-4.9) — the three `forward()`
   simplifications, `readRawSettings()`'s narrowed iteration, the migration routine.
8. **`repoSettings.ts` state + its tests** (D13, §4.4, §4.12).
9. **`RepoSettingsDialog.vue` + `AppToolbar.vue` + `App.vue`** (D13, §4.5-4.7).
10. **`package.json` regeneration** (D12, §4.10) — `bun run gen-settings` (or the equivalent script
    name; confirm against `package.json`'s own scripts before running), diff-reviewed by hand to
    confirm exactly five properties disappeared and nothing else moved.
11. Full check pass: `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run build:vscode`,
    `go test ./apps/kira-studio/internal/...` (SPEC-scoped set), `git diff --stat -- packages/
    git-ipc` (should show exactly the `SettingsSnapshot`/`RepoSettingsSnapshot`/two-requests/
    one-event diff, nothing incidental).

Commits land incrementally, Conventional Commits, roughly one per numbered step.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/...` (SPEC-scoped set) passes, including every new test in
   §3.5, §3.17, §3.18.
2. `bun run test:unit` passes, including `repoSettings.test.ts` (§4.12).
3. `bun run lint`, `bun run typecheck`, `bun run build:vscode` all pass.
4. `CONTRACT_VERSION`/`ContractVersion` are both `22` (`grep`, both sides).
5. `apps/kira-studio-vscode/package.json`'s `contributes.configuration` no longer lists the five
   moved keys (`grep -c` each, expect 0), and still lists the four that stayed (expect 1 each).
6. A manual RPC smoke test (raw socket client, matching G1's own end-to-end proof pattern):
   `repoSettings.get` for an unconfigured repo returns the schema defaults; `repoSettings.set` with a
   `pageSize` patch round-trips through a subsequent `repoSettings.get`; a second connection open on
   the same repo receives `repoSettings.changed` after the first connection's `set`; `graph.loadMore`
   sent **without** a `pageSize` param honors the stored value, not the old hardcoded 5000.
7. `internal/gitclient/settings.go` no longer exists (`ls`, expect a "no such file" result).

### 7.2 Tier 2 — provable here as a reasoned check, not a full proof

8. **The migration (D11) is correct by inspection against `config.inspect()`'s documented
   semantics**, not exercised against a real pre-upgrade `settings.json` in this container (no real
   VS Code host here to hold one) — the `globalValue`/`workspaceValue` distinction is VS Code API
   behavior, not this app's own code, so this is trusted the same way this chapter already trusts
   other VS Code API contracts it cannot execute in a headless container.
9. **`stash.showInGraph` is no worse than before** — still inert, same default, same (still-absent)
   effect on the graph — checked by confirming `graph/stashRows.ts` and `WalkSpec.IncludeStash`'s
   only caller sites are unchanged by this phase's diff.

### 7.3 Tier 3 — needs a human on a Mac, with VS Code and Kira Studio both running

10. The dialog opens from the new toolbar gear, shows the repo's actual current values, and Save
    round-trips visibly (a changed `pageSize` changes `LoadMoreButton.vue`'s own label text on the
    next load).
11. Two VS Code windows open on the *same* repo: a save in one dialog is reflected live in the
    other's own dialog state (or at minimum in `LoadMoreButton.vue`'s label) without either window
    reloading.
12. Two VS Code windows on *different* repos: each keeps its own independent settings, confirming
    the per-repo key (D2) is actually doing per-repo work, not accidentally global.
13. A real pre-upgrade `settings.json` with a customized `kiraVersion.graph.pageSize` migrates once,
    correctly, on that repo's first open post-upgrade, and does not re-migrate (and does not clobber
    a subsequent in-dialog change) on a second window opening the same repo afterward.

### 7.4 The checklist

- [ ] Five keys moved, four stayed, `workbench.tree.indent` untouched (D1).
- [ ] `git_repo_settings` keyed by `(repo_id, key)`, in `kira.db`, not `review.db`, not a new file.
- [ ] `RepoID` reused as the per-repo key — no new identity concept anywhere in this phase's diff.
- [ ] `CONTRACT_VERSION`/`ContractVersion` both 22.
- [ ] `graph.loadMore`/`graph.stream`/`review.resolveBase`'s own param shapes are byte-identical to
      before this phase (`git diff` on their `contract.ts` entries shows no change) — only their
      Go-side default resolution changed.
- [ ] `proxyHandlers.ts` is smaller after this phase, not larger.
- [ ] `internal/gitclient/settings.go` deleted.
- [ ] `repoSettings.changed` actually reaches a second open connection on the same repo (§7.1 item 6).
- [ ] The five-key removal from `package.json` came from re-running `gen-settings`, not a hand-edit.
- [ ] `stash.showInGraph`'s actual graph-filtering behavior is exactly as inert after this phase as
      before it (§0.3).

---

## 8. Explicit non-goals for G18

- **Actually wiring `stash.showInGraph` into the graph.** G17 D1's own deferred, separately-scoped
  feature. §0.3, §10.1.
- **`pull.strategy`/`log.level` moving.** Audited and kept — §10.2.
- **Fixing `git.path`'s dead server-side wiring** (F3) — a real, separate, pre-existing gap. §10.5.
- **A new Vue component-rendering test tier.** G16's own declared non-goal, restated here.
- **Editing a user's `settings.json` programmatically.** D11 — the orphaned legacy value is left in
  place, not removed.
- **Any change to Kira Studio's own Wails `SettingsDialog.vue`** or its module's settings.

---

## 9. Handed forward

- **If a later phase does wire `stash.showInGraph`'s actual graph filtering** (G17's own §9 already
  named this as future work), it now reads the setting from `RepoSettingsGet(repoID)` server-side —
  the same accessor this phase builds — rather than from `app.init`'s `SettingsSnapshot`, which no
  longer carries it at all after this phase.
- **`git.path`'s dead server-side wiring** (F3) is a self-contained follow-up: thread a configured
  path from `kira.db` into `Discovery.Status`, the same shape `gitRegistry.Settings` already
  threads `protectedBranches`/`fetchAutoIntervalMinutes` — no design work, just wiring, and outside
  this phase's own stated scope (§10.5).
- **`RepoSettingsDialog.vue`'s reset-to-default mechanism** (D13 — "set the leaf back to the schema
  default explicitly," not a wire-level delete) is a deliberate simplification; if a later phase adds
  a genuine "has this leaf ever been customized" wire concept for some other reason, this dialog's
  reset action is a natural, cheap thing to upgrade at the same time, not before.

---

## 10. Calls that want a human eye

### 10.1 `stash.showInGraph` still does nothing after this phase, and the user's own words could be read either way

The user asked to "move them all into a proper dialog... configurable per repo" — about *where these
settings live*, prompted by G17's own question about whether to *also* wire the setting's actual
effect. This plan treats those as two different questions and answers only the first: the toggle
moves, its (non-)effect on the graph does not change. A reviewer who reads "configurable per repo"
as implicitly also meaning "and it should do something" should say so — the fix is G17 D1's own
already-described override path (a new field on `graph.stream`'s param shape, `IncludeStash`
population from a `stash.list` read, and a decision on where `stashRows.ts`'s row-filter logic lives,
server or client), which is real, separately-scoped work this plan does not estimate.
**Recommendation: keep the split** — a settings-relocation phase and a graph-behavior phase are
different-shaped work, and G17's own plan already left the graph-behavior question open for good,
stated reasons (an undecided architecture question, not an oversight) that this phase does not
resolve just by being adjacent to it.

### 10.2 `pull.strategy` and `log.level`: judgment calls, not settled by SPEC's own prose either way

D1 keeps both where they are. `pull.strategy` because it reads as a personal integration-style
preference (two people on one repo often deliberately differ) rather than a repo-level display
setting; `log.level` because it isn't repo-scoped at all in any meaningful sense — it governs this
extension instance's own diagnostic output regardless of which repo triggered it. Neither is named in
SPEC's own G18 row, and SPEC's "and similar" is genuinely ambiguous over both. **Recommendation:
leave both as VS Code settings** — but a reviewer who weighs "it says `kiraVersion.*`, it should all
live in one place" more heavily than the per-key reasoning above should say so; moving either is a
same-shaped, small addition (one `source` tag, one field relocated between the two snapshot types),
not a design change to anything else in this plan.

### 10.3 Should the dialog show `git.path`/`log.level`/`pull.strategy` read-only, for discoverability, even though they don't move?

A user opening "repository settings" from the graph and finding only five of the nine
`kiraVersion.*` keys, with the other four still only reachable through VS Code's own Settings UI,
might reasonably wonder where the rest went. This plan does not add a read-only "these are edited
elsewhere" section to the dialog — it would need its own design (a link out to VS Code's settings
UI? a plain sentence?) and risks making the dialog look unfinished rather than deliberately scoped.
**Recommendation: leave it out** — the dialog's own title ("Repository settings") already implies a
narrower scope than "every kiraVersion setting," and a reviewer who wants discoverability can add a
one-line footer sentence cheaply, without touching anything else here.

### 10.4 D6's request-shape-preserving design vs. the more conservative "keep client-side injection" alternative

D6 removes `proxyHandlers.ts`'s three injection sites entirely, relying on the Go server to resolve
`scope`/`pageSize`/`baseCandidates` itself from the new per-repo store. The conservative alternative
— keep the extension injecting these three fields into every `graph.loadMore`/`graph.stream`/
`review.resolveBase` call, sourcing the injected value from a client-side `repoSettings.get` result
cached per repoId instead of from VS Code config — touches fewer existing files (no change to
`gitrpc/graph.go`'s `walkSpecFrom`/`review.go`) at the cost of a real staleness window (the client's
cached copy can lag one `repoSettings.set` behind the server's own value, however briefly) that D6's
design eliminates by construction. **Recommendation: D6 as written** — the existing doc comments on
all three requests already frame "the server's own default" as the intended fallback path, and this
design is strictly less code, not more, once the dust settles. A reviewer who is uneasy about
changing `gitrpc/graph.go`'s well-tested fallback logic, however small the diff, should say so; the
conservative alternative is a contained swap inside `proxyHandlers.ts`/`RepoSettingsState` alone.

### 10.5 `git.path`'s dead server-side wiring: worth fixing now, while this phase is already touching the settings machinery, or genuinely separate?

F3: unlike `protectedBranches`/`fetchAutoIntervalMinutes`, which are already correctly server-owned
and working, `git.path` is declared server-owned by SPEC but is not actually wired to anything —
every `Discovery.Status` call in this tree passes `""`. This phase's own scope (§0.2/§0.3) is the
five keys that move, and fixing `git.path`'s wiring is neither a move nor a stay in the sense this
plan is organized around — it is a pre-existing, unrelated gap this investigation happened to
surface. **Recommendation: leave it for a separate, small follow-up** — it needs no new storage (a
`git.path` leaf added to the *existing* `GitSettings`/`settings` table, D3's sibling, not this
phase's new one) and no new dialog (Kira Studio's own Wails settings surface, or the same in-app
dialog this phase builds, either would do), but scoping it into G18 would blur "settings that move
out of VS Code" with "a settings that was never wired to VS Code's stated intent at all," two
genuinely different fixes that happen to share a file. A reviewer who wants it folded in should say
so; the fix itself is small once decided.
