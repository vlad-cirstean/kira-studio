# G6 — Branch review: the base resolver, and the ranged walk as a per-connection `Walk`

> **What this phase is.** The sixth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> one that finally populates the half of SPEC §6 every phase since G2 has deferred: `Conn`'s
> **`Walk`** box stops meaning "the one walk this connection has open on this repository" and
> starts meaning what §6 actually wrote down — *"log session, commit store, dictionary marks,
> scroll/paging state, **the active review-range walk if any**"*. It is also the phase that
> registers this chapter's **second and last** webview view, answers the **seventh and last**
> host-capability method (`review.open`), and closes the last of the "migrated, still unregistered"
> items G1's extension migration left behind. It covers upstream's P7 in full.
>
> **In one line: three new read argv builders land in `gitclient/porcelain`, one new pure package
> `gitreview` holds the base-resolution policy, `gitsession.RepoEntry` learns to answer
> `review.resolveBase`'s four outcomes, `gitsession.Conn` learns to hold *two* walks per repository
> instead of one, `gitrpc` stops refusing `range` on the three `graph.*` methods that accept one and
> serves `review.resolveBase`, and the extension registers the review view, answers `review.open`
> locally and wires the palette command. `packages/git-ui` does not change; `packages/git-core` does
> not change; the FlatBuffers schema does not change.**
>
> **The SPEC is authoritative and is not re-litigated here.** The `Registry`/`RepoEntry`/`Conn`/
> `Walk` shared-vs-private rule, the JSON-control-plane/FlatBuffers-data-plane split, the package
> layout, `packages/git-ui` staying unchanged, and the phasing table are settled in
> `docs/v1.3/SPEC.md` §2, §4.2, §5 and §6. This plan is the *how*: the exact algorithm, the exact
> argv, the exact keying, the exact wire shapes, the exact commit sequence and the exact proof.
>
> **Five places where a literal reading of upstream (or of what G3 left behind) collides with what
> actually works here are called out and resolved with evidence** — a walks map keyed by repo id
> alone that would evict the graph the moment a review opens (F3/D3), a lifetime rule that holds
> upstream only because upstream can tear a walk down in-process (F8/D5/D6), a `Stream` that reads
> a page nobody asked for (F5/D12), an argv-injection seam `git`'s own refusal does not close
> (F6/D8), and a setting the whole chapter already declares that no wire param can carry (F2/D1).
>
> **Three of those want a human eye before implementation starts — §11.**

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`054bb360`, the whole
of G1–G5). Every claim below was checked against source read or commands run in this container,
never against prose — including G1–G5's own plans, which are records of intent and are verified
against the code they produced.

| Claim | Evidence |
|---|---|
| G5 landed in full: three parsers, `gitpreflight`, `gitops`, the seven P6 methods, the undo slot, the live head | `git log --oneline`: `276918f6`…`054bb360`; `gitclient/porcelain/{refs,status,mergetree}.go`, `internal/gitpreflight/`, `internal/gitops/`, `gitrpc/{refs,ops}.go` |
| `go build ./apps/kira-studio/internal/...` is green here; git is 2.43.0 | run here |
| The contract **already declares every review type, both review requests, the review event, and `range` on all three `graph.*` keys** | `packages/git-ipc/src/contract.ts:738-790` (`CommitRange`/`BaseResolutionReason`/`ReviewRangeState`/`BaseCandidate`/`BaseResolution`), `:884-905` (`graph.status`/`graph.loadMore` `range`), `:914-926` (`review.resolveBase`, `review.open`), `:1144` (`review.target`), `:1150-1160` (`graph.stream` `range` + `resumeThroughRow`'s own "ignored when `range` is present") |
| `validate.ts` already admits both requests and the event | `validate.ts:81-82`, `:100` |
| `CONTRACT_VERSION` is **14** in three hand-maintained places | `packages/git-ipc/src/validate.ts:7`, `apps/kira-studio/internal/gitrpc/contract.go:11`, `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93` |
| The whole review **webview** is migrated and untouched since G1 | `packages/git-ui/src/state/review.ts` (386 lines), `components/review/{ReviewView,BaseSelector,ReviewCommitRow}.vue`, `state/packedStream.ts`, `main.ts`'s `view: 'graph' \| 'review'` two-root mount |
| The extension's review **plumbing** is migrated too — and unregistered | `apps/kira-studio-vscode/src/reviewView.ts` (89 lines, never constructed), `html.ts:76-87` (`ReviewTarget`, `view`, `target` in the bootstrap island), `webview/main.ts:99-106` (the `NullViewStateStore` branch), `resources/review-icon.svg` |
| The manifest **already declares** the second container and the review view; it does **not** declare the palette command | `apps/kira-studio-vscode/package.json#contributes.viewsContainers.activitybar` (`kiraVersionReview`), `#contributes.views.kiraVersionReview` (`kiraVersion.review`); `#contributes.commands` has `showConnectionStatus`, `openRepository`, `focusGraph` and no `reviewBranch` |
| `extension.ts` registers exactly one provider and forwards `repo.changed`/`settings.changed` to it alone | `extension.ts:110-152` |
| `proxyHandlers.ts` forwards `review.open` and `review.resolveBase` verbatim; its own comment says `review.open` is G6's | `proxyHandlers.ts:223-224`, `:15-17` |
| `app.init`'s capability block is **exactly four flags**, all `true` since G4 | `contract.ts:857-864`; `proxyHandlers.ts:82-87` |
| The three panel-side entry points are wired and call `review.open` | `rowMenuModel.ts:141`/`:149` (`buildRefMenu`'s `reviewBranch` entry), `BranchPicker.vue:141`, `App.vue:516`, `state/ops.ts:279` (`bridge.request('review.open', …)`), `CommitGrid.vue:285` (the `[data-ref-kind]` hit-test), `refBadges.ts:41` |
| `WalkSpec` already carries a `Range`, and `RevSetArgs` already builds the two-dot token | `porcelain/types.go:50-73`, `porcelain/log.go:30-44` |
| `Walk.matchesSpec` already compares `Range` | `gitsession/walk.go:62-81` |
| `logsession.Options.PrecomputedTotal` exists, is honoured by `Remaining`, and has no caller | `logsession/session.go:53-57`, `:281-287`; `grep PrecomputedTotal` → the declaration and that one read |
| `Conn.walks` is `map[string]*Walk` — **one walk per (connection, repository)** — and a spec mismatch disposes the incumbent | `gitsession/conn.go:42`, `:172-192` |
| `gitrpc` refuses `range` on all three methods that accept one, and one integration test proves it | `gitrpc/graph.go:22-24`, `:58-60`, `:82-84`, `:135-137`; `gitsock/graphstream_test.go:428` `TestIntegration_GraphRangeIsRefused` |
| `SETTINGS` already has `kiraVersion.review.baseCandidates` with a `stringArray` type and the `["main","master"]` default, and the manifest already declares it | `packages/git-core/src/settings/schema.ts:20-23`, `:68-76`; `apps/kira-studio-vscode/package.json#contributes.configuration` |
| `repo.list`'s `activeRepoId` has been hardcoded `null` since G3, and `RepoState.refreshList` ignores it | `proxyHandlers.ts:90-95`; `packages/git-ui/src/state/repo.ts:33-35` |
| Nothing in the webview ever calls `repo.close`; the review view never calls `repo.open` | `grep -rn "repoState.close\|\.close()" App.vue` → nothing; `ReviewView.vue:61-79` (`app.init` → `review.target`/`props.target`/`repo.list`, no `repo.open`) |
| `reviewView.ts` has `notifySettingsChanged` but **no** `notifyRepoChanged` | `reviewView.ts:84-88`; compare `panelView.ts:63-67` |
| `gitsession/walk_test.go`'s fixture builder uses `os.Environ()`, not G5 D19's isolated env | `walk_test.go:22-33` |

**Probes, run in this container against real git 2.43.** Upstream's P7 listed eight verification
tasks (V1–V8); the four that decide a code path are reproduced here, plus two this chapter's own
constraints made necessary. The implementer should extend these, not re-derive them.

| # | Question (upstream's V, where there is one) | What was observed here |
|---|---|---|
| **P1** (V1) | `git symbolic-ref --short refs/remotes/origin/HEAD` with **no `origin` remote at all** | `fatal: ref refs/remotes/origin/HEAD is not a symbolic ref`, **exit 128** |
| | the same after `git remote set-head origin -d` (origin exists, HEAD unset) | **byte-identical**: same message, exit 128. The two cases are not distinguishable and do not need to be — both are "not detected" |
| | the same with `origin/HEAD` pointing at a branch that does not exist | **exit 0**, prints `origin/nonexistent`. So a successful answer still has to be checked against the ref snapshot — this is why the resolver takes `originHead` as a *candidate*, never as a verdict |
| | on a fresh `git clone` | **exit 0**, prints `origin/main` |
| **P2** (V4) | `git merge-base <a> <b>` on two unrelated root histories | **exit 1**, empty stdout, empty stderr |
| | `git merge-base main nosuchref` | **exit 128**, `fatal: Not a valid object name nosuchref` |
| | ⇒ "unrelated" and "bad ref" are distinguishable **by exit code alone**, no stderr matching | as above |
| **P3** | `git rev-list --count <base>..<branch>` | exit 0. `main..feature` = `1`; `feature..main` (fully merged) = `0`; `main..nosuchref` = **exit 128** `fatal: ambiguous argument` |
| **P4** | `rev-list --count` across **unrelated** histories (`main..orphanb`) | **exit 0, count 1** — a non-zero count. So `merge-base` must be consulted *first*: an unrelated branch would otherwise report `ready` and list its entire history as though every commit were new |
| **P5** (V2) | `git log --decorate=full --topo-order --format=…%D… <base>..<branch>` | `%D` still populates (`HEAD -> refs/heads/feature`); no `--all` needed, the range is the whole rev set |
| **P6** | `for-each-ref --format=…%(upstream)…` for a branch created as `git checkout -b feature origin/develop` | `refs/heads/feature\|refs/remotes/origin/develop\|[ahead 1]` — `%(upstream)` is the **full** refname, which is what makes the resolver's two different prefix-strippings (below) necessary rather than pedantic |

**Upstream baseline** (`/home/user/vlad-cirstean/kira-version-vscode`, `claude/start-p2-gwlgly`,
`0ea4cfe`), read as the source this phase ports:

| Claim | Evidence |
|---|---|
| P7's own design — the singleton-session problem, the four range outcomes, the three-step resolution order, the reuse boundary with P5 | `docs/plans/P7.md` in full |
| The pure resolver, its two prefix-strippings and its candidate-list ordering | `packages/core/src/model/review.ts` in full |
| The wire types and the two requests are **structurally identical** to what `packages/git-ipc` already carries | `packages/ipc/src/contract.ts:738-790`, `:904-916`, `:1098`, `:1110-1112` vs. this repo's own `contract.ts` at the same offsets |
| The three queries: `mergeBase` (exit 1 ⇒ `null`), `countRange`, `detectDefaultBranch` (any `GitError` ⇒ `undefined`) | `packages/git/src/queries.ts:256-263`, `:347-366` |
| The review walk is **one slot, not a map**, and holds exactly six fields | `repoService.ts:828`, `:869-874`, `#ensureReviewWalk` `:3379-3404` |
| `#streamReviewGraph` ignores `resumeThroughRow`, never consults `#ensureFresh`/`staleReason`, and reads a page **only when the store is empty** | `repoService.ts:1100-1135` |
| The scoped `streamGraph` reads a page only `if (cachedThrough === 0 && !exhausted)` | `repoService.ts:1080-1084` |
| `endReview` is an **in-process** method, called from the view's `onDidDispose` and from `#evict` — it is **not** on upstream's wire | `repoService.ts:3523-3528`, `:3550-3554`; `packages/ipc/src/contract.ts` has no `review.end` |
| `resolveReviewBase` reads the **cached** refs, gates the `symbolic-ref` spawn on rule 1 falling through, and remembers a `ready` count for the walk | `repoService.ts:3479-3521`, `#naturalResolution` `:3434-3450` |

### 0.2 Scope

1. `internal/gitclient/porcelain` — `review.go` (three read argv builders and the count parser),
   plus a two-line refactor in `log.go` so the two-dot range token is built in exactly one place
   (D7).
2. `internal/gitreview` — **new package**: the pure base-resolution policy and the wire result
   types (D7).
3. `internal/gitsession` — `review.go` (the four-outcome resolution and its three queries), the
   per-repo range-count slot on `RepoEntry`, the `Conn` walk pair, `Walk`'s precomputed total, and
   the one-line `Stream` fix (D2, D3, D5, D9, D12).
4. `internal/gitrpc` — `review.go` (one handler), `graph.go` (thread `range` instead of refusing
   it), the boundary ref-argument guard. **`CONTRACT_VERSION` 14 → 15** (D1).
5. `packages/git-ipc` — one optional param on `review.resolveBase`, and the version constant (D1).
6. `apps/kira-studio-vscode` — register the review view, answer `review.open` locally, inject
   `baseCandidates`, report a real `activeRepoId`, forward `repo.changed`/`settings.changed` to the
   review view, add one palette command to the manifest (D13, D14, D15).
7. Prove it (§7).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G6 work:

- **`stash.list`.** Still the last of G3 F16's four rejections. **G12**'s.
- **Any change to `packages/git-ui`.** `ReviewView.vue`, `BaseSelector.vue`, `ReviewCommitRow.vue`,
  `state/review.ts`, `state/packedStream.ts`, `main.ts`'s two-root mount, `rowMenuModel.ts`'s
  `reviewBranch` entry, `refBadges.ts`'s `data-ref-kind` and `CommitGrid.vue`'s hit-test are all
  migrated, correct, and untouchable by SPEC §5. If an implementer finds themselves editing that
  package, something has drifted.
- **Any change to `packages/git-core`.** `SETTINGS` already carries `review.baseCandidates` and its
  `stringArray` type. G5's own trim of `preflight/*`/`undo/*` continues in G7/G12/G13, not here.
- **A refresh affordance in the review view, and any change to what a mid-review `refsChanged`
  renders.** `state/review.ts`'s `#checkForChange`/`staleReview` banner is migrated and is the
  client's whole answer (upstream's own OQ5 resolution). G6 changes what the *server* does under it
  (D5), not what the view draws.
- **`review.end` / `endReview`.** Not on upstream's wire, not added here (D6, §11.1).
- **`range` on `graph.refresh`.** Upstream's own judgment call 10: the review view has no refresh
  affordance, so the parameter would have no caller. Not in the contract, not added.
- **Incremental review state, blob snapshots, `review.db`, partial-review ranges, AI comments.**
  **G10/G11.** SPEC's own "Review state" section says those key off *G6's* `(repo, branch)` concept
  — this phase establishes it and stores nothing.
- **PR badges on the review header or the base picker.** **G15**.
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out of this phase is left out *entirely*.
- **Comments very concise, only where the code cannot say it itself.**
- **Tests only where `AGENTS.md`'s bar is met** (D16). G6 clears it in three places and nowhere else.
- **No shell, ever.** Every new spawn is argv-only through `gitclient`'s existing runner, exactly
  like every spawn G2–G5 added.
- **Fixture repositories scope their git config to themselves** — G5 D19's `fixtureEnv()`
  (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `-c commit.gpgsign=false`).
  **Never `git config --global` or `--system`** (D17).
- Commits are Conventional Commits, granular, landing as work completes; each one compiles and its
  own tests pass (§6).

---

## 1. Findings

### F1 — Almost the entire phase is already written; what is missing is the server and six wires

This is the most-migrated phase in the chapter, and stating exactly how much is already there is
what keeps its scope honest. Every one of these exists, today, unmodified since G1:

| Piece | Where | State |
|---|---|---|
| The five review wire types | `git-ipc/contract.ts:738-790` | complete, identical to upstream's |
| `review.resolveBase`, `review.open`, `review.target`, `range` on three `graph.*` keys | `contract.ts:884-926`, `:1144`, `:1150-1160`; `validate.ts:81-82`, `:100` | complete |
| `ReviewSessionState` — the whole client state machine, including the mid-review re-resolve banner | `git-ui/state/review.ts` | complete |
| `ReviewView.vue` (seven states), `BaseSelector.vue`, `ReviewCommitRow.vue` | `git-ui/components/review/` | complete |
| `packedStream.ts` — the chunk applier both views share | `git-ui/state/packedStream.ts` | complete |
| The two-root mount and the `NullViewStateStore` | `git-ui/main.ts:44-58`; `vscode/webview/main.ts:99-106` | complete |
| The bootstrap island's `view`/`target`, and the review document's CSP (no `worker-src`) | `vscode/html.ts:76-123` | complete |
| `KiraReviewViewProvider` — reveal, cold-seed, `review.target` push | `vscode/reviewView.ts` | complete but **never constructed** |
| The activity-bar container, the `kiraVersion.review` view, `resources/review-icon.svg` | `vscode/package.json`, `vscode/resources/` | declared but **no provider registered** |
| Both panel entry points (branch-picker row menu, ref-badge right-click) and `opsState.openReview` | `rowMenuModel.ts:141`/`:149`, `BranchPicker.vue:141`, `App.vue:516`, `CommitGrid.vue:285`, `ops.ts:279` | complete |
| `kiraVersion.review.baseCandidates` and its `stringArray` schema type | `git-core/settings/schema.ts:20-23`, `:68-76` | complete |

What does **not** exist: any Go that resolves a base, any Go that walks a range, a registered
provider, a local answer for `review.open`, a palette command in the manifest, and a way for the
`baseCandidates` setting to reach the server (F2). That is G6's whole surface.

The practical consequence, and the thing to check every deliverable against: *the JSON this phase
emits must match `contract.ts` field for field, including which fields are `undefined` (absent) and
which are `null` (present)*. G4 D5 set the Go encoding rule for that distinction; `BaseResolution.
base` is the one field in this phase that is genuinely `string | null` (present-and-null), and
`ReviewRangeState.commitCount` is the one that is genuinely absent-unless-`ready`.

### F2 — Three gaps around the review contract, one of which no wire param can carry

1. **`kiraVersion.review.baseCandidates` has nowhere to go.** The setting is declared in
   `SETTINGS`, generated into the manifest, coerced by `coerceSettings`, and carried in
   `SettingsSnapshot` (`contract.ts:42`) — and `review.resolveBase`'s params are
   `{repoId, branch, base?}`. The webview's own caller (`state/review.ts:250-254`) passes exactly
   those three and cannot change (SPEC §5). So either the server invents its own candidate list and
   the user's setting does nothing, or the request grows a param. This is precisely the situation
   G3 D6 hit with `graph.scope`/`graph.pageSize` and resolved by bumping the contract.
2. **There is no `review.end` anywhere.** Upstream's `endReview` is an in-process
   `RepoService` method called from `reviewView.ts`'s `onDidDispose` and from its own hidden-repo
   eviction; `packages/ipc/src/contract.ts` has no such key, and neither does ours. So this
   chapter has no way for a disposed sidebar to tell the backend its walk is finished (F8/D6).
3. **`repo.list`'s `activeRepoId` is hardcoded `null`** (`proxyHandlers.ts:90-95`, with G3's own
   comment saying no "last active repo" surface exists yet). `RepoState.refreshList` ignores the
   field entirely (`state/repo.ts:33-35`); **`ReviewView.vue:73-78` is its first and only
   consumer** — it is what makes the palette entry point (reveal with no target) land on a
   repository instead of the "no active repo" state.

### F3 — `Conn.walks` is keyed by repository id alone, and both webviews share one connection

This is the phase's central architectural fact, and it is *worse* here than the singleton problem
upstream's P7 spends its longest section on.

`gitsession/conn.go:42` is `walks map[string]*Walk` — RepoID → one walk. `Conn.Walk`
(`:172-192`) returns the existing walk when `matchesSpec` holds and otherwise **disposes it and
builds a new one**. `matchesSpec` (`walk.go:62-81`) already compares `Range`, so a ranged request
against a repository the graph is walking would take exactly the destructive branch: the graph's
`logsession.Session` killed, its `gitstore.Store` dropped, its `marks` reseeded to `{0:0}`, its
`nextSeq` zeroed.

Upstream's version of this hazard is one webview against one `RepoSession`. Ours is worse in two
ways:

- **Both webviews share one `Conn`.** `extension.ts:76-110` constructs exactly one
  `ConnectionManager` and one `createProxyHandlers` result, and hands the *same* `handlers` object
  to every provider; each provider builds its own `RpcServer` over its own webview channel, but
  every request lands on the same socket, hence the same accepted connection, hence the same
  `gitsession.Conn`. So the review sidebar's `graph.stream` and the panel's `graph.stream` are
  literally two calls on one `Conn`.
- **The panel is *live* while the review runs.** That is the whole point of the sidebar. A
  destructive rebuild is not a cache miss the user pays for later; it is the graph they are looking
  at going blank and re-walking.

### F4 — Everything below `Conn` is already range-ready, and needs no line

The seam G3 built is real and it fits:

| Piece | Already handles a range |
|---|---|
| `porcelain.WalkSpec.Range` | declared (`types.go:50-66`), with its own "G3 never sets it" comment |
| `porcelain.RevSetArgs` | `case spec.Range != nil: args = append(args, spec.Range.Base+".."+spec.Range.Branch)` (`log.go:32-34`) — two-dot, first case, before `scope` is even consulted |
| `porcelain.LogSessionArgs`/`LogSessionSkipArgs` | build on `WalkArgs`, so both the walk and its `--skip` resume are range-correct for free |
| `logsession.countTotal` | `rev-list --count` over `WalkArgs(spec)` — for a range that is literally `rev-list --count <base>..<branch>`, the exact query upstream's `countRange` runs |
| `logsession.Options.PrecomputedTotal` | declared, honoured by `Remaining` (`session.go:281-287`), no caller — "G6 supplies this for a ranged walk" |
| `Walk.matchesSpec` | compares `Range` field by field (`walk.go:66-71`) |
| `Walk.Stream` | the cache-replay/git-read split, the `marks` dictionary base, `chunkRows` |
| `gitstore` + `gitwire` + `EncodeChunkFrame` | a ranged walk produces `porcelain.CommitRecord`s indistinguishable from a scoped walk's |
| Probe P5 | a ranged `git log` still populates `%D`, so decorations classify normally |

So the ranged walk needs **no new packing, no new parser, no new schema and no new stream code**.
What it needs is somewhere to *live* that is not the graph's slot (F3), and a total (F4's last row).

### F5 — `Walk.Stream` reads a page on every re-open, not only the first

`walk.go:244-275`:

```go
for cursor < cachedThrough { … emit "cache" … }      // replay
if w.log.Exhausted() { return nil }
if _, exhausted, err := w.readPageLocked(ctx); …     // ALWAYS, when not exhausted
```

After the replay loop, `cursor == cachedThrough` unconditionally, so the guard the method's own
comment describes ("this Walk cannot tell 'first' from 'later' except by there being nothing left
cached, which is exactly the condition reached here") never actually distinguishes anything: every
`graph.stream` on a non-exhausted walk reads a page from git.

Upstream's scoped path is explicit and different: `if (cachedThrough === 0 && !session.logSession
.exhausted) { await this.#readPageIntoStore(session); }` (`repoService.ts:1080-1084`), with its own
comment citing §5.1.1's *"the host never loads a page the user did not ask for"*. Its ranged path
guards the same way (`walk.store.rowCount === 0 && !exhausted`, `:1114`).

The user-visible consequence today, for the graph: `GraphViewState`'s Load-more is a
`graph.loadMore` followed by a stream re-open, so one click loads **two** pages. For the ranged
walk it would be worse in kind rather than degree — a review's Load-more round trip would page the
walk twice, and after a stale reset (D5) the re-open would silently read a page the user did not
ask for on a walk they are mid-way through reading.

### F6 — `git merge-base` takes its revisions as separate argv tokens, and `-` is not refused

G5 F17 established this chapter's ref-name posture: validation is a pure client-side prefilter
(`validateRefName`, rejecting `@{`, a leading `-`, and the empty string), plus **git's own refusal
when the argv runs**. That second line of defence is what makes the first sufficient — and it does
not exist for `merge-base`.

- `rev-list --count <base>..<branch>` and `log … <base>..<branch>` put the whole range in **one**
  token. A `base` beginning with `-` produces `--foo..branch`, which git rejects as an unknown
  option. Ugly, safe.
- `git merge-base <a> <b>` puts them in **two** tokens. `base = "--is-ancestor"` produces
  `git merge-base --is-ancestor <branch>` — a *different command* with different semantics, which
  git parses happily and then fails on arity. `base = "--independent"` produces
  `git merge-base --independent <branch>`, which **exits 0 and prints a sha**, which this phase's
  resolver would read as "these refs share history".

This is not a security hole: there is no shell anywhere in this chapter, and none of `merge-base`,
`rev-list` or `log` has a file-writing or command-executing option. It is a correctness and
legibility hole, and the `base` in question is **client-supplied** — `review.resolveBase`'s
override arm takes whatever the header picker sends, and a raw socket client is not obliged to run
`validateRefName` at all.

### F7 — Base resolution has four outcomes and three of them are invisible to a walk

Upstream's own framing, confirmed by probe P4 and worth restating because it decides where the work
lives: *"the walk produced no chunks" distinguishes none of ask / empty / unrelated / failed.*

- `ask` — no base at all. There is nothing to walk.
- `unrelated` — `merge-base` exits 1 (probe P2). A walk would still succeed and would list the
  branch's **entire history** as though every commit were new (probe P4: an unrelated
  `main..orphanb` counts 1, not 0).
- `empty` — `rev-list --count` is 0. A walk succeeds and produces nothing, which is
  indistinguishable from a walk that has not started.
- `ready` — the only case with rows.

So all four are decided in `review.resolveBase`, before a stream is opened, exactly as upstream
does — and `ReviewView.vue` already renders all four plus `resolving` and `error`.

### F8 — The review walk outlives the view that opened it, and nothing on the wire can say otherwise

VS Code destroys a hidden webview view (`panelView.ts`'s own note: `retainContextWhenHidden` is
deliberately off, so `resolveWebviewView` runs again on every reveal). Upstream turns that into a
lifetime: `reviewView.ts`'s `onDidDispose` calls `service.endReview(repoId)` in-process, and P7's
own text leans on it three times ("the walk is dropped whole on `endReview`/hide", "reopening
therefore re-resolves and re-walks, by construction rather than by policy").

Here there is no such call (F2.2). The server-side walk lives on the `Conn`, and the `Conn` lives
as long as the socket connection — i.e. as long as the extension. Which means:

- A collapsed sidebar leaves a ranged `Walk` in place, with its store and (until `logsession`'s
  5-minute `IdleReclaim` fires) its paused `git log`.
- A **reveal** of the same branch finds a matching spec and *replays the cached store*, rather than
  re-walking. That is fine when nothing moved and wrong when something did — and the client's own
  mid-review banner (`state/review.ts:321-339`'s `#checkForChange`, then `acknowledgeStaleReview`)
  re-opens the stream with the *same* range, so upstream's "the walk is gone, so a re-open
  re-walks" guarantee is exactly what would make that banner do anything. Without it, clicking
  "the comparison has changed" would replay the same stale rows.

Upstream's decision to exclude the review walk from `#ensureFresh`/`staleReason` is sound **given**
its lifetime; it is unsound given ours.

### F9 — The review view inherits the panel's repository hold, and nothing ever closes it

`ReviewView.vue:61-79` never calls `repo.open`. It takes a `repoId` from the bootstrap island, from
a `review.target` event, or from `repo.list`'s `activeRepoId`, and goes straight to
`review.resolveBase`/`graph.stream` with it. Every per-repo server method requires the repo to be
**held on this connection** (`Conn.Entry`/`Conn.Walk` → `ErrRepoNotHeld`).

That works — because both webviews share one `Conn` (F3) and the panel's `repo.open` is what took
the hold. It is also the reason `repo.list.activeRepoId` matters (F2.3): with no panel-supplied
target and no active repo id, the palette entry point can only render "no repository".

And nothing ever releases it: `RepoState.close()` exists (`state/repo.ts:49-55`) and has no caller.
So in practice the ranged walk's real lifetime bounds are replacement, connection teardown, and
`logsession`'s idle reclaim (D6).

### F10 — One test asserts the behaviour this phase removes, and three files mirror the contract version by hand

- `gitsock/graphstream_test.go:428` `TestIntegration_GraphRangeIsRefused` drives all three
  `graph.*` methods with a `range` over the real socket and asserts each is refused. G6 **deletes**
  it and replaces it with the coverage in §3.9.
- `CONTRACT_VERSION` lives, by hand, in `packages/git-ipc/src/validate.ts:7`,
  `apps/kira-studio/internal/gitrpc/contract.go:11` **and**
  `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93`. G4 missed the third and needed a
  follow-up commit (`dd07252f`); G6 does not repeat that.

### F11 — `reviewView.ts` cannot deliver `repo.changed`, so the client's own staleness check is dead

`panelView.ts:63-67` has `notifyRepoChanged`, and `extension.ts:115` wires
`manager.on('repo.changed', …)` into it. `reviewView.ts` has `notifySettingsChanged` and nothing
else. But `ReviewSessionState`'s constructor subscribes to `repo.changed`
(`state/review.ts:98`) and that subscription is the sole trigger for the background re-resolve and
the "the comparison has changed" banner. Registering the provider without adding the forward would
ship a banner that can never appear.

### F12 — `gitsession/walk_test.go`'s fixture builder is not config-isolated

`initWalkRepo` (`walk_test.go:22-33`) sets author/committer identity but passes `os.Environ()`, so
it reads the developer's `~/.gitconfig`. G5 D19's rule (`GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_CONFIG_SYSTEM=/dev/null`) was written for *new* fixtures and this one predates it. G6 extends
this file, so it is the phase that should close it — one line, no behaviour change.

---

## 2. Decisions

### D1 — `CONTRACT_VERSION` 14 → 15: `review.resolveBase` gains one optional `baseCandidates`, filled by the extension

Resolving F2.1, on G3 D6's exact precedent (`graph.stream`/`graph.loadMore` gaining optional
`scope`/`pageSize` and bumping 12 → 13).

```ts
'review.resolveBase': {
  params: {
    repoId: string;
    branch: string;
    base?: string;
    /** G6: `kiraVersion.review.baseCandidates`, injected by the extension from the window's own
     *  coerced settings snapshot — SPEC's "can travel with the request and differ per window
     *  harmlessly". Absent for a raw socket client, which gets the server's own
     *  `["main", "master"]` default. */
    baseCandidates?: readonly string[];
  };
  result: BaseResolution;
};
```

- **Optional, not required** — `packages/git-ui` calls this with three fields
  (`state/review.ts:250-254`) and may not change (SPEC §5). A required field would be a type error
  in a package this phase cannot touch.
- **The extension fills it**, in `createProxyHandlers`, from the same coerced snapshot
  `extension.ts:64-66` already maintains — the one layer that knows this window's configuration.
- **The server defaults it** to `["main", "master"]` (`gitreview.DefaultBaseCandidates`, mirroring
  `SETTINGS`' own default), so every Go integration test and every raw socket client drives the
  resolver with no settings plumbing.
- **Three places bump, by hand**, and the third is the one G4 forgot (F10):
  `packages/git-ipc/src/validate.ts:7`, `apps/kira-studio/internal/gitrpc/contract.go:11`,
  `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93`.

**This is the only contract change in the phase.** No method, event or stream is added, removed or
re-shaped: `review.resolveBase`, `review.open`, `review.target` and `range` on the three `graph.*`
keys have all been in `contract.ts` and `validate.ts`'s `REQUEST_KEY_MAP` since G1's migration
(F1). What changes is only *whether the server answers* — and that, as G5 D1 established, is not a
compatibility axis.

**The alternative, rejected**: make the candidate list a *server*-owned setting, avoiding the bump.
SPEC's "Settings ownership" section names exactly three server-owned settings —
`protectedBranches`, `fetch.autoInterval`, `git.path` — and gives the reason (two windows
disagreeing about them is a correctness or safety issue). Two windows disagreeing about which
branch to *offer as a comparison base* is a preference, not a hazard; and the setting is already
declared in the extension's own manifest, where a per-window setting belongs. Shipping the setting
unread would be `AGENTS.md`'s "half-implemented" in its purest form.

### D2 — The ranged walk is the **same `Walk` type with a `Range` spec** — not a second type, not a second code path

Resolving F4, and answering the phase's headline question directly.

A ranged walk and a scoped walk differ in exactly one thing: the rev set their `git log` is given.
Everything downstream — the pause-is-the-page mechanism, the `--skip` resume and its ref-snapshot
guard, the record splitter, the parser, the column store, the interner's dictionary delta, the
`PackedCommitChunk` builder, the `"KIG1"` frame, `Stream`'s cache/git split, `marks`, `nextSeq` —
is identical, and `porcelain.RevSetArgs` already expresses the difference in three lines
(`log.go:32-34`).

So:

```go
spec := porcelain.WalkSpec{Range: &porcelain.RangeSpec{Base: base, Branch: branch}}
```

is the whole of it. `Scope` is left **empty** deliberately: `RevSetArgs` switches on `Range` first
and never reads `Scope` for a ranged walk, and `matchesSpec` compares `Scope` — so filling it from
the extension's injected `graph.scope` would make a scope-setting change churn a review walk that
ignores scope entirely. `IncludeStash` stays `false`: a stash is not one of a branch's own commits
(upstream's own V2).

**Rejected: a `ReviewWalk` type of its own** (upstream's `interface ReviewWalk extends WalkLike`).
Upstream needed it because its walk state was *fields on `RepoSession`* and it had to name the
six that a walk actually owns before a second one could exist. G3 already did that extraction here
— `gitsession.Walk` **is** `WalkLike`, and has been since `4ccdf7c0`. Introducing a second type
would be re-deriving a split this repo already has, and would fork `Stream`, `ReadPage`, `Status`,
`ensureFreshLocked` and `resetLocked` into two near-identical copies for one differing argv.

**Rejected: a `review.stream` key of its own.** Upstream's judgment call 1, for the same reasons,
and it is moot here anyway: the contract already puts `range` on `graph.stream`.

### D3 — `Conn.walks` becomes `map[RepoID]*walkPair{graph, review}` — SPEC §6's box, read literally

Resolving F3. SPEC §6's diagram says:

```
walks: map[RepoID]*Walk      — PRIVATE per (connection, repo)
  log session, commit store, dictionary marks, scroll/paging state,
  the active review-range walk if any
```

— one entry per (connection, repository), holding the paging state **and** the active review-range
walk if any. That is a pair, and it is what G6 builds:

```go
// conn.go
// walkPair is SPEC §6's per-(connection, repository) walk box: the graph's own scoped walk, and
// "the active review-range walk if any". Two slots, never a map keyed by range — §6.8 is explicit
// that the view holds exactly one review session, and reviewing another branch replaces its
// contents rather than opening a second view.
type walkPair struct {
    graph  *Walk
    review *Walk
}

// Conn
walks map[string]*walkPair

func (c *Conn) Walk(repoID, gitPath string, spec porcelain.WalkSpec, pageSize int, precomputedTotal *int) (*Walk, error)
func (c *Conn) WalkFor(repoID string) (*Walk, bool)        // the graph walk
func (c *Conn) ReviewWalkFor(repoID string) (*Walk, bool)  // the review walk
func (c *Conn) markWalksStale(repoID string)               // both, D5
```

- **One entry point, the spec selects the slot.** `Walk` picks `&pair.graph` when `spec.Range ==
  nil` and `&pair.review` otherwise, then applies the existing rule to that slot alone: reuse when
  `matchesSpec`, else dispose and rebuild. Reviewing a second branch therefore replaces the first
  review walk and leaves the graph untouched — upstream's "one slot, not a map", with the eviction
  policy it already has.
- **`WalkFor` keeps meaning the graph walk**, because both its existing callers
  (`gitrpc.handleGraphStatus` with no range, `handleGraphRefresh`) are about the graph, and
  `graph.refresh` deliberately has no range (D10).
- **`CloseRepo` and `Close` dispose both**, in the same before-release order G3 D13 established, so
  the registry's refcount can still never reach zero while a `git log` process is alive against
  that repository.
- **The subscriber marks both** (D5), through `markWalksStale` rather than by reaching into the
  pair from `Conn.Open`'s callback — one method, one lock discipline, no way for a future phase to
  add a third walk and mark only two.

The pair is allocated lazily by whichever of the two walks is created first, and dropped whole by
`CloseRepo`/`Close`.

### D4 — Ranged chunks cross the wire as **FlatBuffers**, reusing `"KIG1"` byte for byte

Stated explicitly because "is this like G4's diff/blob JSON call?" is the natural question and the
answer is no.

G4 D1 drew the JSON/FlatBuffers line for *diff hunks and blob bytes* — payloads that SPEC §4.2
names but whose Go shapes had no existing encoder, whose TypeScript receivers read them as ordinary
objects, and for which a second schema would have been new design. None of that applies here:

- A ranged walk produces `porcelain.CommitRecord`s that are **structurally identical** to a scoped
  walk's (F4). They go into the same `gitstore.Store`, through the same `PackSlice`, through the
  same `gitstore.EncodeChunkFrame`, into the same `gitwire.Frame` with the same `"KIG1"` file
  identifier.
- The receiver is **the same code**: `packedStream.ts` is the chunk applier `GraphViewState` and
  `ReviewSessionState` both use (`git-ui/state/packedStream.ts`), decoding through the same
  `decodeStreamPayload('graph.stream', …)`.
- The contract says so in as many words: *"Chunk shape is byte-for-byte the same"*
  (`contract.ts:1156-1157`).

So `packages/git-ipc/schema/gitWire.fbs`, `src/generated/`, `graphChunkCodec.ts`, `codec.ts` and
`internal/gitwire` are **untouched**, `bun run generate:wire` is not run, and the cross-language
frame fixture G3 D16 committed keeps passing unchanged. Emitting a ranged chunk as JSON would mean
a second representation of the one payload SPEC §4.2 names first, decoded by a webview that may not
change to receive it — i.e. it is not merely worse, it is not possible.

### D5 — Both walks are invalidated by the same `refsChanged` signal — a deliberate departure from upstream

Resolving F8, and the one behavioural call in this phase where upstream's own reasoning does not
transfer.

Upstream excludes the review walk from `#ensureFresh`/`staleReason` (`repoService.ts:1100-1108`)
and resolves the mid-review-`refsChanged` question client-side instead (its OQ5 option (b): a
quiet background re-resolve, and a banner the user clicks). That works there because the review
walk is **dropped whole on hide** (`endReview`), so it can never be both alive and stale for long.

Here it can (F8): with no `review.end`, a review walk survives the sidebar closing, and a re-open
of the same range replays its store. Under upstream's exclusion, `acknowledgeStaleReview` — the
banner's own handler, which re-opens the stream with the same `{base, branch}` — would replay the
identical stale rows. The banner would be decoration.

So `Conn.Open`'s subscriber marks **both** walks stale on `refsChanged`:

```go
if ev.Kind == string(gitclient.SignalRefsChanged) {
    c.markWalksStale(ev.RepoID)   // graph AND review — D5
}
```

`Walk.ensureFreshLocked` then resets whichever walk the next operation touches, exactly as it does
for the graph today: drop the store, reseed `marks`, reopen the log session. The client's banner
keeps its job (telling the user *what* changed, and letting them choose when), and clicking it now
actually re-walks.

**What this costs, stated rather than glossed**: a `refsChanged` that does not affect the range at
all (a tag created in a terminal, an unrelated branch fetched) still resets a review walk, so the
next operation re-walks it. For a review range — tens or hundreds of commits, one `git log` — that
is a few milliseconds. The alternative, narrowing invalidation to "did `base` or `branch` move",
is upstream's own W3 narrowing applied one layer up; it needs a second, range-specific staleness
mechanism beside the one `RepoEntry` already fans out, and it buys nothing on a walk this cheap.
D11's own note carries the same reasoning for `logsession`'s `--skip` guard.

**The one visible edge**: a `Load more` clicked while a review walk is stale resets first, then
reads one page, so the user briefly sees the list return to its first page instead of growing. It
is self-correcting on the next click, it is the same shape the graph already has after a reset, and
it is strictly better than the alternative (growing a list whose earlier rows describe a history
that has moved). Recorded in §10.

### D6 — No `review.end`: the ranged walk's lifetime is bounded by four things that already exist

Resolving F2.2/F8/F9, and the decision most worth a human eye (§11.1).

The walk is disposed by:

1. **Replacement** — a `graph.stream`/`graph.loadMore` with a *different* range on the same
   (connection, repository) disposes the incumbent (D3).
2. **`repo.close`** — `Conn.CloseRepo` disposes both walks before releasing the hold.
3. **Connection teardown** — `Conn.Close` on disconnect, which `gitsock` already calls.
4. **`logsession`'s idle reclaim** — the paused `git log` process is killed after 5 minutes idle
   (`logsession.defaultIdleReclaim`, G3 D10), leaving only the store, and the `--skip` resume path
   is what makes that safe.

So the worst case is **one** idle ranged `Walk` per (connection, repository) — a
`gitstore.Store` holding at most one page of commits, and no process — surviving a collapsed
sidebar until the user reviews something else, closes the repository, or the window exits. That is
bounded, small, and honest.

**The alternative, rejected but flagged**: add `review.end` to the contract (the bump is already
being paid for D1) and call it from `reviewView.ts`'s `onDidDispose`. It would give deterministic
teardown and restore upstream's "reopening re-resolves and re-walks by construction". Against it:
it is **new wire surface with no upstream provenance** (upstream's `endReview` never crossed a
wire), every prior phase in this chapter added none, the teardown it enables is best-effort anyway
(a crashed extension host calls no disposal hook), and D5 already restores the correctness property
that "dropped on hide" was buying. G8's multi-client hardening is the phase that re-examines
resource lifetimes across the whole surface with a real two-window matrix in front of it.

### D7 — The base resolver: a pure `internal/gitreview`, three read queries, and upstream's exact three-step order

Resolving F7, and splitting the work the way G5 D3/D4 split `gitpreflight`/`gitops`: **pure policy
in a leaf package, I/O in `gitsession`, argv in `porcelain`.**

**(a) `internal/gitreview` — new, pure, no I/O.**

```go
package gitreview

type Reason string
const (ReasonUpstream Reason = "upstream"; ReasonDefaultBranch = "defaultBranch"
       ReasonOverride = "override"; ReasonNone = "none")

type Candidate struct {
    Ref    string `json:"ref"`
    Kind   string `json:"kind"`     // porcelain.RefRow.Kind: "branch" | "remoteBranch"
    Reason Reason `json:"reason"`   // never "override"/"none"
}

// RangeState is contract.ts's ReviewRangeState union: CommitCount is present only for "ready"
// (G4 D5's absent-vs-null rule), which is exactly what `omitempty` on a *int reproduces.
type RangeState struct {
    Kind        string `json:"kind"` // "ready" | "empty" | "unrelated" | "ask"
    CommitCount *int   `json:"commitCount,omitempty"`
}

type BaseResolution struct {
    Branch     string      `json:"branch"`
    Base       *string     `json:"base"`        // present-and-null when reason == "none"
    Reason     Reason      `json:"reason"`
    Range      RangeState  `json:"range"`
    Candidates []Candidate `json:"candidates"`  // never nil — an empty list marshals as []
}

type Input struct {
    Branch                 porcelain.RefRow
    Branches, RemoteBranches []porcelain.RefRow
    OriginHead             string   // "" when not detected
    Candidates             []string // kiraVersion.review.baseCandidates
}

type Core struct { Base *string; Reason Reason; Candidates []Candidate }

func ResolveBase(in Input) Core

var DefaultBaseCandidates = []string{"main", "master"}
```

The algorithm is upstream's `core/src/model/review.ts`, ported rule for rule:

1. **Upstream**, when it names a *genuinely different* branch **and still resolves in this
   snapshot**. Two different prefix-strippings are needed and both are load-bearing (probe P6:
   `%(upstream)` is the full refname):
   - `bareUpstreamName("refs/remotes/origin/develop") == "develop"` — the **comparison** name.
     `feature-x` tracking `origin/feature-x` compares `feature-x == feature-x` and falls through,
     which is the ordinary case: comparing against it would show only the unpushed commits.
   - `upstreamRefShortName("refs/remotes/origin/develop") == "origin/develop"` — the **base**, and
     `RefRow.ShortName`'s own convention, so it can be looked up in the snapshot and handed
     verbatim to `merge-base`/`rev-list`.
   - `refs/heads/main` (a local upstream, `branch.<n>.remote = .`) strips to `main` under both, so
     the rule handles it with no special case.
   - A `track: "gone"` branch still carries an `upstream` string; the existence check against the
     snapshot is what makes it fall through rather than resolving to a ref that is not there.
2. **`originHead`** if it names a ref that exists in the snapshot, else the first `Candidates`
   member that does. Reason `defaultBranch`. The existence check is not optional — probe P1 shows
   a dangling `origin/HEAD` answering exit 0 with a name nothing matches.
3. Neither ⇒ `Base: nil`, `Reason: ReasonNone`.

The candidate shortlist is built in the same pass and **ordered**: the upstream (even when rule 1
rejected it for being same-named — a user may deliberately want `origin/feature-x` as a base),
then `originHead`, then each existing `Candidates` member in configured order, then the current
HEAD branch when it is none of those; de-duplicated by ref name, first reason wins.

`gitreview` imports `gitclient/porcelain` (for `RefRow`) and stdlib, and nothing else — the same
one-directional leaf dependency `gitpreflight` has, and the same reason: nothing in it spawns a
process or touches the filesystem, which is what makes D16's matrix testable without a repository.

`gitreview` is the package SPEC's own layout table names for G10/G11 (`review.db`, blob storage,
the reaper). G6 creates it with only what G6 reads — one file, one classifier, the wire types — and
G10 adds its SQLite half beside it, exactly as G5 created `gitpreflight` with three classifiers and
left six to their own phases (G5 D3).

**(b) `gitclient/porcelain/review.go` — three read argv builders.** `porcelain` already owns every
*read* argv in this chapter (`HeadsRefsArgs`, `StatusArgs`, `MergeTreeArgs`, `LogSessionArgs`);
`gitops` owns the *write* argv. These three are reads:

```go
func MergeBaseArgs(a, b string) []string   // merge-base <a> <b>
func CountRangeArgs(base, branch string) []string  // rev-list --count <base>..<branch>
func OriginHeadArgs() []string             // symbolic-ref --short refs/remotes/origin/HEAD
func ParseCount(stdout []byte) (int, error)
```

and `RangeToken(r RangeSpec) string` moves into `log.go`, called by both `RevSetArgs` and
`CountRangeArgs` — **two-dot, built in exactly one place**, so no call site can drift to three-dot
(upstream's own W2 rule).

**(c) `gitsession/review.go` — the four-outcome orchestration**, upstream's `resolveReviewBase`:

```
1. snapshot := e.Refs(ctx)                 — the CACHED refs (see below)
2. branchRef := snapshot.Branches / RemoteBranches by ShortName
   not found -> {base:null, reason:"none", range:{kind:"ask"}, candidates:[]}
3. natural := gitreview.ResolveBase(… OriginHead:"" …)
   natural.Reason != "upstream"  ->  originHead := e.originHead(ctx)   (ONE spawn, only here)
                                     natural = gitreview.ResolveBase(… OriginHead:originHead …)
4. base := override if supplied else natural.Base ; reason := "override" / natural.Reason
   base == nil -> {range:{kind:"ask"}}     (no further spawns)
5. merge-base <base> <branch>              exit 1 -> {range:{kind:"unrelated"}}
6. rev-list --count <base>..<branch>       0 -> {range:{kind:"empty"}}
                                           n -> {range:{kind:"ready", commitCount:n}}, remember n (D9)
```

Four points, each a decision rather than a transcription:

- **The refs snapshot is the cached one** (`e.Refs`, not `e.refsSnapshot`). G5 D10's rule is *"the
  cache answers `refs.list`; a decision that **precedes a write** reads git"* — a base resolution
  precedes no write. It is a read, on the ≤300 ms path, and it is the one place upstream itself is
  explicit about using the cache ("cached; no spawn in the common case").
- **The `symbolic-ref` spawn is gated on rule 1 falling through**, via two calls to the pure
  resolver (the first with `OriginHead: ""`). Upstream's own `#naturalResolution` shape, and the
  reason §6.8 can promise "one spawn, only when needed".
- **`merge-base` and `rev-list --count` run sequentially, merge-base first**, not concurrently as
  upstream's `Promise.all` does. Two reasons: it **short-circuits** (an unrelated pair never runs
  the count at all), and G5 D13 already set this repo's posture on fanning reads out across a
  4-wide pool shared with another window's graph stream. The latency given up is one local spawn.
- **The `candidates` list always reflects the *natural* resolution**, even on the override path —
  upstream's own behaviour, and what keeps the header picker's shortlist stable while the user
  cycles through bases.

### D8 — Ref arguments are validated once, at the router, and a leading `-` is refused

Resolving F6. `gitrpc` is where `repoId != ""` is already checked, and it is the one entrance:

```go
// gitrpc/review.go
func validRefArg(field, value string) error   // non-empty; no leading "-"
```

applied to `review.resolveBase`'s `branch` and `base`, and to `graph.*`'s `range.base`/
`range.branch`. A violation is `ipcerr.BadRequest`, naming the field.

Stated as a decision rather than left implicit because it is the **first server-side ref-name
validation in this chapter**, and G5 F17 explicitly concluded none was needed. That conclusion
rested on git's own refusal as the second line of defence, and F6 shows `merge-base` — the one
command in this chapter that takes two revisions as two separate argv tokens — does not refuse:
`base = "--independent"` yields a command that exits 0 and prints a sha. The guard is one
comparison, at the one place a client-supplied ref name reaches an argv, and it does not duplicate
`validateRefName`'s client-side job (`@{` shorthand and the rest stay client-side, and stay git's
problem when the argv runs).

### D9 — `PrecomputedTotal` is threaded through a single-slot per-repo range count, cleared on `refsChanged` and after the walk's first open

Using G3's own seam (F4) rather than leaving it to rot, and keeping the plumbing to what it is
worth.

- **`RepoEntry` gains a one-entry range-count slot** — `{base, branch, count}` plus a mutex, beside
  the caches G4/G5 added. A count of `<base>..<branch>` is a fact about **the repository**, so
  SPEC §6's split rule puts it in the shared box, where two windows reviewing the same branch both
  benefit from it.
- **`review.resolveBase` writes it** on a `ready` outcome; **`gitrpc`'s ranged `graph.*` handlers
  read it** (a non-blocking peek that never spawns) and pass the result into `Conn.Walk` as
  `precomputedTotal`. A miss — a raw client that streamed without resolving, or a second window
  reviewing a different branch that overwrote the slot — passes `nil`, and `logsession` runs its
  own `rev-list --count` over the same rev set (F4). **The seam is an optimisation with a correct
  fallback, never a correctness dependency.**
- **One slot, not a map**, matching upstream's `lastReviewResolution` and avoiding an unbounded
  per-range cache nobody asked for. Two windows reviewing different branches thrash it; the cost is
  one extra spawn each.
- **Dropped in `RepoEntry.note()` on `refsChanged`, before the fan-out** — the same ordering and
  the same reason as G4 D7's detail cache and G5 D10's refs cache: a count computed before a fetch
  is wrong, and nobody may observe it after the signal that invalidated it.
- **Cleared after the walk's first open.** `Walk` holds the value and `resetLocked` consumes it —
  reading it into `logsession.Options` and then setting it to `nil` — so a walk that is *reset*
  (D5, i.e. because refs moved) recounts rather than reusing a number from before the move. The
  constructor calls `resetLocked`, so the first open gets it and no later one does.

### D10 — All three range-bearing `graph.*` methods honour `range`; `graph.refresh` still has none

| Method | With `range` |
|---|---|
| `graph.stream` | streams the review walk; `resumeThroughRow` ignored (D11) |
| `graph.loadMore` | pages the review walk, never the graph's |
| `graph.status` | the review walk's `{loaded, remaining, exhausted}`, or `{0,0,false}` when this connection has no review walk for the repo — the same answer G3 D14 gives for an unopened graph walk |
| `graph.refresh` | **no `range` parameter exists**, in the contract or here |

`graph.status` deserves a word, because `packages/git-ui` never sends a range to it
(`state/review.ts` calls only `graph.stream` and `graph.loadMore`) and `AGENTS.md` forbids
uncalled code. The rule it forbids is *building machinery no caller exercises*; here the machinery
— the review walk — is built and fully exercised by this phase, and `graph.status`'s range arm is
six lines over it. Serving two of three range-bearing params and refusing the third would be an
arbitrary hole a reader has to be told about, and upstream serves all three. It is served.

`graph.refresh` is upstream's own judgment call 10 and stays that way: the review view has no
refresh affordance (§6.8), so a `range` there would be a parameter with no caller in the honest
sense — nothing in the contract or the webview can produce one.

### D11 — `resumeThroughRow` is ignored for a ranged stream, at the handler; the `--skip` guard is not narrowed

The contract already says so (`contract.ts:1152-1154`: *"Ignored when `range` is present — a ranged
walk has no cache to resume from (§5.4's exclusion, made structural)"*), and the structural place
to honour it is `gitrpc.handleGraphStream`, which passes `nil` rather than `p.ResumeThroughRow`
when `p.Range != nil`. One line, no change to `Walk.Stream`.

Note what that does **not** mean: a re-open of the same range still replays whatever the walk's
store already holds, as `source: "cache"`. That is not §5.4 rehydration (nothing was persisted, and
the webview's `NullViewStateStore` guarantees it) — it is the ordinary `loadMore`-then-reopen round
trip `ReviewSessionState.loadMore` performs, and breaking it would break Load more. Upstream labels
those replayed chunks `"git"` where we label them `"cache"`; the client reads `chunk.source` into
`lastChunkSource` and nothing in the review view branches on it (`packedStream.ts:93`), so the
honest label is kept.

**The `--skip` staleness guard is deliberately not narrowed.** Upstream's W3 narrows a ranged
session's ref snapshot to its two endpoints, so an unrelated tag cannot invalidate a resume (its
V3). Here the broad snapshot stays: it is *correct* either way (it never serves wrong records, only
occasionally re-walks when it need not), the resume path is only reachable at all after
`logsession`'s 5-minute idle reclaim on a walk that is **not exhausted** — i.e. a range larger than
`graph.pageSize` (5,000 commits) left idle mid-page — and narrowing it means a second,
range-specific snapshot mechanism inside `logsession` for a case that needs a 5,000-commit "branch"
to reach. Recorded in §10 as the thing to build if that case ever turns out to be real.

### D12 — `Walk.Stream` reads a page only when nothing is cached — a one-line fix to G3's own stated intent

Resolving F5.

```go
-	if w.log.Exhausted() {
+	// Upstream's own guard (repoService.ts:1080-1084) and §5.1.1's rule: a page is read here only
+	// on the very first stream for this walk — nothing cached at all. Every later page is an
+	// explicit loadMore.
+	if cachedThrough > 0 || w.log.Exhausted() {
 		return nil
 	}
```

This is a behaviour change to the **graph**, in a phase whose scope is branch review, so it is
flagged (§11.3) rather than slipped in. It is included because:

- It is what `Stream`'s own comment already claims, what upstream does on both its paths, and what
  §5.1.1 states as a rule ("the host never loads a page the user did not ask for"). Today one
  `Load more` click loads two pages.
- G6 is the phase that makes `Stream` serve two walks, and the ranged walk is where the defect
  stops being merely eager: combined with D5's stale resets, a re-open mid-review would read a page
  the user did not ask for on a walk they are reading.
- Leaving it would mean shipping a ranged walk that inherits a behaviour this plan would then have
  to describe as intentional.

Its own commit, its own test (`TestWalk_ReopenDoesNotReadAnUnrequestedPage`), and a §7.3 checklist
line.

### D13 — `review.open` is answered locally; the capability block does not grow

Confirming what G4 D11 forecast, and closing the seventh and last host-capability method.

`review.open` is a **host** action — reveal a VS Code view — so `proxyHandlers` stops forwarding it
and answers it:

```ts
'review.open': async ({ repoId, branch }) => { revealReview(repoId, branch); return {}; },
```

The server therefore still has no `review.open` case, and still answers `E_UNKNOWN_METHOD` if
anything sends it there — exactly like `repo.list`, `repo.pick`, `clipboard.write` and the three
`editor.*` methods before it. Nothing in `gitrpc` changes for it.

**No new capability-flag machinery, confirmed against the contract.** `app.init`'s `capabilities`
block is exactly four fields — `openInEditor`, `goToFile`, `clipboard`, `resolveConflict`
(`contract.ts:857-864`) — all reported `true` since G4. `review.open` has no flag, in this
contract or upstream's, because nothing in the webview feature-detects it: `opsState.openReview`
(`ops.ts:272-280`) is called unconditionally from a menu entry `buildRefMenu` always offers, and
its own comment says the caller "does not wait on, or need to know" what happens. So G6 adds no
field, flips no flag, and touches no part of `app.init`.

### D14 — `repo.list` reports a real `activeRepoId`, and it is the review view's own entry point

Resolving F2.3. `createProxyHandlers` already keeps a `repoId -> root` map for
`editor.resolveConflict` (G4 D13). G6 adds one variable beside it: the id of the most recently
successfully opened repository, set in the `repo.open` handler and cleared by `repo.close` when it
names that id.

- **The panel is unaffected**: `RepoState.refreshList` reads only `result.candidates`
  (`state/repo.ts:33-35`).
- **The review view is the consumer**: `ReviewView.vue:73-78` uses it to decide between "no active
  repository" and the branch picker. Without it, `kiraVersion.reviewBranch` — the palette entry
  point this phase registers — can only ever render a dead end, because the palette reveals the
  view with no target (`reviewView.ts:73-74`).
- **It is a fact about this window's extension host**, not about the backend, so it stays entirely
  extension-side and needs no wire change.

### D15 — The extension registers the review view, both event forwards, and one palette command

The wiring SPEC §5 describes and G3 D17 deferred, now that there is something behind it. In
`extension.ts`:

1. Construct `KiraReviewViewProvider` and
   `vscode.window.registerWebviewViewProvider('kiraVersion.review', reviewProvider)`.
2. `manager.on('repo.changed', …)` fans out to **both** providers — requiring `notifyRepoChanged`
   on `reviewView.ts` (F11), a three-line copy of `panelView.ts`'s.
3. `onDidChangeConfiguration`'s `notifySettingsChanged` goes to **both**.
4. `vscode.commands.registerCommand('kiraVersion.reviewBranch', () =>
   reviewProvider.reviewBranch(undefined, undefined))` — reveal with no target, and let the view
   ask, which is upstream's own OQ2 resolution and what makes the flow renderable in the webview
   rather than in a host quick-pick.
5. `createProxyHandlers` gains a `revealReview` dep. The provider needs `handlers` at construction
   and `handlers` needs the provider, so the dep is a closure over a `let` binding assigned on the
   next line, with a one-line comment saying why — the smallest honest break in the cycle, and
   upstream's own optional-`revealReview` shape without the optionality (this host always has one).

`package.json#contributes.commands` gains `kiraVersion.reviewBranch` ("Review Branch Changes",
category "Kira Version"). The container, the view and the icon are already declared (F1) and are
not touched.

**G9's command-palette audit is not pre-empted.** SPEC's G9 row covers "a command for every
*mutating* operation"; `reviewBranch` is a read, it is one of §6.8's three required entry points,
and upstream registers it in P7 for the same reason.

### D16 — What gets a test, and what does not

`AGENTS.md`'s bar, applied honestly. **Tested:**

- **`gitreview.ResolveBase`** — the phase's one genuine decision table, and the piece upstream
  unit-tests exhaustively. One named case per rule: the same-name fall-through
  (`feature-x`→`origin/feature-x`), the different-name honour (`feature-x`→`origin/develop`), a
  *local* upstream (`refs/heads/main`), a `gone` upstream whose ref is no longer in the snapshot,
  `originHead` present / absent / present-but-dangling (probe P1), each `Candidates` member present
  and absent, a repository with no branches at all, and the candidate list's **ordering and
  de-duplication** (upstream first even when rule 1 rejected it, then `originHead`, then candidates
  in configured order, then HEAD). ("a decision structure too large to hold in your head")
- **`gitsession`'s walk pair** — `TestConn_ReviewWalkDoesNotDisturbTheGraphWalk`: build both walks
  on one `Conn` against one repository, page and stream each, and assert the graph's store row
  count, `nextSeq` and log session are untouched across the review walk's whole life including its
  replacement by a second range. **This is D3's entire correctness claim** and it gets its own
  named test. Plus `TestWalk_ReopenDoesNotReadAnUnrequestedPage` (D12).
- **`gitsock` integration** — §3.9's tests over a real socket against real repositories. **This is
  the phase's real end-to-end proof.**

**Not tested, deliberately**: `porcelain/review.go`'s three argv builders and `ParseCount`
(`AGENTS.md`'s "thin pass-through" and "constructors/builders"; one returns a literal slice, one is
`strconv.Atoi` over a trimmed line — all four are exercised for real by the integration tier),
`gitrpc`'s handler and `validRefArg` (thin dispatch and a two-condition guard — the refusal is
asserted once in integration), `gitsession/review.go`'s orchestration (its branches *are* the four
integration scenarios, against real git, which is where they are worth asserting), and every
TypeScript change (`typecheck:git` plus the macOS script).

**No golden corpus entries.** G3 D15/G5 D19's fixture mechanism exists for *formats*: multi-field,
multi-framing output where a parser can silently misread a byte. This phase's three new commands
emit one sha, one integer and one short ref name. Recording them would be recording `strconv.Atoi`.

### D17 — Fixture isolation, including the one pre-existing gap this phase's own file has

Every fixture repository G6 builds — in `gitsession` and in `gitsock` — uses G5 D19's isolated
environment (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, per-commit
`-c commit.gpgsign=false`). **No test, fixture or script in this phase runs `git config --global`
or `--system`.**

G6 also closes F12: `gitsession/walk_test.go`'s `initWalkRepo` gains the same two environment
variables — a one-line change to a helper this phase extends anyway, with no behaviour change, so
that a developer whose global config sets `init.defaultBranch`, a commit template or a hook path
gets the same fixture everyone else does.

### D18 — `gitrpc` stays thin dispatch, in one new file and one edited one

`review.go` holds `review.resolveBase` (decode, `validRefArg`, `c.Entry(repoID)` per G4 D18,
one `RepoEntry` call, marshal). `graph.go` loses `rangeRefusal` entirely and gains the range arms
described in D10, including the `precomputedTotal` peek (D9) and `resumeThroughRow`'s suppression
(D11). `handlers.go` gains one case. `contract.go` goes to 15 (D1). No handler in this phase can
produce a result large enough to need G4 D2(b)'s exact-size treatment.

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/internal/`.

### 3.1 `gitclient/porcelain/review.go` — new (D7b)

| Export | Contents |
|---|---|
| `MergeBaseArgs(a, b string) []string` | `merge-base <a> <b>` — the two revisions as two argv tokens, which is exactly why D8's guard exists |
| `CountRangeArgs(base, branch string) []string` | `rev-list --count <RangeToken>` |
| `OriginHeadArgs() []string` | `symbolic-ref --short refs/remotes/origin/HEAD` |
| `ParseCount(stdout []byte) (int, error)` | `strconv.Atoi` over the trimmed single line; an unparseable body is an error naming the output, never a silent 0 |

None of the three carries `--no-optional-locks`: `gitclient.buildArgv` places that at git level for
every `ReadOnly` spec, and after the subcommand git exits 129 (G4 probe P6).

### 3.2 `gitclient/porcelain/log.go` — edited (D7b)

`RangeToken(r RangeSpec) string` is added (`r.Base + ".." + r.Branch`) and `RevSetArgs`'s range arm
calls it. Two lines, and the point of them is that the two-dot token now has exactly one
construction site shared with `CountRangeArgs` — upstream's own W2 rule ("two-dot, never three, is
built here, once, so no call site can accidentally write `...`").

### 3.3 `internal/gitreview/` — new package (D7a)

| File | Contents |
|---|---|
| `resolve.go` | `Reason` + its four constants, `Candidate`, `RangeState`, `BaseResolution`, `Input`, `Core`, `ResolveBase`, `DefaultBaseCandidates`, and the two unexported prefix-strippers `bareUpstreamName`/`upstreamRefShortName` |
| `resolve_test.go` | D16's matrix |

Imports `gitclient/porcelain` and stdlib. No `gitclient`, no `gitsession`, no `gitops`, no
`bridge`. Nothing here spawns a process or touches the filesystem.

`Candidates` is built as `[]Candidate{}` rather than a nil slice, so `candidates` marshals as `[]`
— `BaseSelector.vue` reads `.length`, and a JSON `null` there is a different value than the
contract declares.

### 3.4 `gitsession/review.go` — new (D7c, D9)

| Symbol | Contents |
|---|---|
| `(*RepoEntry).ResolveReviewBase(ctx, branch string, base *string, candidates []string) (gitreview.BaseResolution, error)` | D7c's six steps, verbatim |
| `(*RepoEntry).originHead(ctx) (string, error)` | `runAllowingExit(ctx, porcelain.OriginHeadArgs(), 0, 128)`; **`ctx.Err()` is checked before folding a non-zero exit into `""`**, so a cancelled read can never be mistaken for "no default branch detected" — the same discipline `gitclient.Classify` documents for itself. Probe P1: "no origin", "origin/HEAD unset" and "dangling" are all exit 128 or a name nothing matches, and all three are "not detected", never an error the UI renders |
| `(*RepoEntry).sharesHistory(ctx, base, branch string) (bool, error)` | `runAllowingExit(ctx, porcelain.MergeBaseArgs(base, branch), 0, 1)`; exit 0 ⇒ true, exit 1 ⇒ false (probe P2), anything else ⇒ the classified error, which is how a base that does not resolve becomes a rendered error rather than a silent "unrelated" (upstream's V6) |
| `(*RepoEntry).countRange(ctx, base, branch string) (int, error)` | `runOne` + `porcelain.ParseCount`; a bad ref is exit 128 and classifies normally (probe P3) |
| `(*RepoEntry).rememberRangeCount(base, branch string, n int)` / `takeRangeCount(base, branch string) *int` | D9's single slot: `remember` on a `ready` outcome, `take` a non-blocking peek that returns `nil` on a miss |

`ResolveReviewBase` takes `candidates []string` and substitutes `gitreview.DefaultBaseCandidates`
when it is empty, so the server's default is stated in one place and every raw client gets it.

### 3.5 `gitsession/entry.go` — edited (D9)

`RepoEntry` gains the range-count slot (a small struct plus its own mutex, beside `detail`/`diff`/
`refs`, following `cache.go`'s pattern). `note()` drops it on `refsChanged` **before** the fan-out,
in the same block that already drops the detail and refs caches and marks the head stale.
`teardown()` clears it alongside them. The doc comment's "still to come" list loses nothing —
stash shapes and the active remote op are still G7/G12's.

### 3.6 `gitsession/walk.go` — edited (D2, D9, D12)

- `Walk` gains `precomputedTotal *int`; `newWalk` takes it.
- `resetLocked` passes it into `logsession.Options` and then **nils it**, so only the walk's first
  open uses a count from before whatever reset it (D9).
- `Stream`'s page-read guard becomes `if cachedThrough > 0 || w.log.Exhausted() { return nil }`
  (D12), with the comment naming §5.1.1 and upstream's own line.

Nothing else in this file changes. `matchesSpec`, `ensureFreshLocked`, `MarkStale`, `Status`,
`ReadPage`, `readPageLocked`, `dispose` and the whole of `Stream`'s cache/git emit loop serve a
ranged walk unaltered (F4/D2).

### 3.7 `gitsession/conn.go` — edited (D3, D5)

| Change | Detail |
|---|---|
| `walkPair` | new type, two `*Walk` slots, with the doc comment D3 quotes |
| `walks map[string]*walkPair` | replaces `map[string]*Walk` |
| `Walk(repoID, gitPath, spec, pageSize, precomputedTotal)` | selects the slot from `spec.Range == nil`, then applies the existing reuse/dispose rule to that slot; `precomputedTotal` reaches `newWalk` |
| `WalkFor` | unchanged meaning (the graph walk); `ReviewWalkFor` added |
| `markWalksStale(repoID)` | marks both slots; called by `Open`'s subscriber in place of the current `WalkFor(…).MarkStale()` (D5) |
| `CloseRepo`, `Close` | dispose both slots before releasing the hold / the subscription, same ordering as today |

### 3.8 `gitrpc/` — edited (D1, D8, D10, D11, D18)

| File | Change |
|---|---|
| `contract.go` | `ContractVersion` 14 → **15** (D1) |
| `wire.go` | `ReviewResolveBaseParams{RepoID, Branch string; Base *string; BaseCandidates []string}`; `CommitRangeParams`'s doc comment stops saying it exists only to be refused |
| `review.go` (new) | `handleReviewResolveBase` — decode, `validRefArg` on `branch` and (when present) `base`, `c.Entry`, `entry.ResolveReviewBase`, marshal. Plus `validRefArg` itself (D8) |
| `graph.go` | `rangeRefusal` deleted. `handleGraphStream`/`handleGraphLoadMore` build a ranged `WalkSpec` (D2), validate its two fields (D8), peek the range count (D9), and pass `nil` for `resumeThroughRow` on the ranged path (D11). `handleGraphStatus` answers from `ReviewWalkFor` when a range is present, `{0,0,false}` when there is no such walk |
| `handlers.go` | one new case, `review.resolveBase`. `Stream`'s table unchanged (`graph.stream` is still the only stream) |

`review.open` gets **no** case: it is answered by the extension (D13), and the server's
`E_UNKNOWN_METHOD` for it is the correct answer for anything that sends it here.

### 3.9 `gitsock/` — tests only

`graphstream_test.go:428`'s `TestIntegration_GraphRangeIsRefused` is **deleted** (F10).
`gitsock/review_test.go` (new) uses the existing harness (`newIntegrationServer`, `pairAndReady`,
`openRepoOK`, `requestOK`, `unmarshalResult`, `openStream`/`drainStreamToEnd`) over a fixture
repository built with G5 D19's isolated env, containing: `main`; `feature` tracking
`origin/feature` (same name — the fall-through case); `topic` tracking `origin/develop` (the
honoured case); a fully-merged `merged`; an orphan root history `unrelated`; and a `master` for the
candidate-list case.

- **`TestIntegration_ResolveBaseFourOutcomes`** — `ready` (with `commitCount`), `empty`
  (fully-merged, and the branch-is-the-base case), `unrelated` (the orphan — asserting **no** walk
  is opened and the count is never consulted, probe P4), and `ask` (a branch with no upstream, no
  `origin/HEAD`, no `main`/`master` in `baseCandidates`).
- **`TestIntegration_ResolveBaseReasonsAndCandidates`** — `upstream` for `topic`, the fall-through
  to `defaultBranch` for `feature`, `override` for an explicit `base`, and that `candidates` still
  reflects the natural resolution on the override path.
- **`TestIntegration_ResolveBaseHonoursRequestBaseCandidates`** — a request carrying
  `baseCandidates: ["release"]` picks `release`; the same request with the field absent picks
  `main`. This is D1's whole justification, proven over the socket.
- **`TestIntegration_RangedWalkMatchesGitLog`** — the ranged stream's decoded shas **equal**
  `git log --topo-order --format=%H <base>..<branch>`'s own output, order included. Upstream's own
  agreement check: our answer is asserted against git, not against a fixture we wrote.
- **`TestIntegration_RangedWalkDoesNotDisturbTheGraph`** — on one connection: open a graph stream,
  note its `graph.status`; run a full review (resolve, stream, `loadMore`, stream a second range);
  assert the graph's `graph.status` and a graph stream re-open are byte-identically unaffected.
  **D3's claim, over the real socket.**
- **`TestIntegration_RangedLoadMoreAndStatus`** — a range larger than a small `pageSize`:
  `graph.loadMore` with a range pages the review walk only, `graph.status` with a range reports its
  counters, and the same two calls without a range report the graph's.
- **`TestIntegration_ReviewWalkResetsAfterRefsChange`** — force-move the reviewed branch under a
  live review walk, wait for `repo.changed`, re-open the ranged stream, and assert the rows reflect
  the new tip rather than the cached store. **D5's claim.**
- **`TestIntegration_TwoConnectionsReviewIndependently`** — two clients, one repository, two
  different ranges; each sees only its own rows, and neither's graph walk moves.
- **`TestIntegration_RangedRefusalsAreBadRequests`** — an empty `range.base`, and a `base`
  beginning with `-`, are `E_BAD_REQUEST` naming the field (D8) — not a spawn, not a silent
  success.

### 3.10 `main.go`

**Unchanged.** Every new type is reached through the `Registry`, the `Router` and the socket server
G1/G2 already construct.

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-ipc` — one param, one constant (D1)

- `contract.ts`: `review.resolveBase.params` gains `baseCandidates?: readonly string[]`, with the
  doc comment D1 quotes.
- `validate.ts:7`: `CONTRACT_VERSION = 15`.

Nothing else: no key, no event, no stream, no result type, no codec, no schema.

### 4.2 `apps/kira-studio-vscode/src/proxyHandlers.ts` — three edits (D1, D13, D14)

- `CreateProxyHandlersDeps` gains `revealReview: (repoId: string, branch: string) => void`.
- `'review.open'` stops forwarding and calls `revealReview`, returning `{}` (D13). The file's own
  header comment loses its "still `E_UNKNOWN_METHOD` — G6's" note and gains one sentence saying
  this is the seventh and last host-capability method.
- `'review.resolveBase'` stops being a bare forward and injects
  `baseCandidates: settings()['kiraVersion.review.baseCandidates']`, exactly as `graph.loadMore`
  and `graph.stream` inject `scope`/`pageSize` (D1).
- `'repo.list'` reports the most recently opened repository as `activeRepoId` (D14); `repo.open`
  records it beside the existing `repoRoots.set`, `repo.close` clears it when it names that id.

### 4.3 `apps/kira-studio-vscode/src/reviewView.ts` — one method (F11/D15)

`notifyRepoChanged(payload: EventPayload<'repo.changed'>)`, a three-line copy of
`panelView.ts:63-67`, with a comment naming the consumer (`ReviewSessionState`'s background
re-resolve and the "the comparison has changed" banner). The file's G1 migration note is updated:
the review-session lifecycle it says "G3 restores" is now explicitly *not* restored, because there
is no `review.end` on the wire (D6) — the server invalidates the walk instead.

### 4.4 `apps/kira-studio-vscode/src/extension.ts` — the registration (D15)

D15's five items, plus the `REVIEW_BRANCH_COMMAND`/`REVIEW_VIEW_ID` constants beside the existing
`FOCUS_GRAPH_COMMAND`/`GRAPH_VIEW_ID`, and one updated header comment (G1's "No webview view is
registered yet" note is now two phases stale).

### 4.5 `apps/kira-studio-vscode/package.json` — one command (D15)

`contributes.commands` gains `kiraVersion.reviewBranch` / "Review Branch Changes" / category "Kira
Version". The `viewsContainers`, `views`, `configuration` and `colors` blocks are untouched — all
already carry what this phase needs (F1).

### 4.6 `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts` — one integer (F10/D1)

`CONTRACT_VERSION = 15`. Named here rather than left to be discovered, because G4 missed exactly
this mirror and needed a follow-up commit.

### 4.7 What does **not** change

**`packages/git-ui` and `packages/git-core` are byte-for-byte untouched by this phase.** Not one
file, not one line. If an implementer finds themselves editing either, something has drifted out of
scope — the most likely drift being an attempt to make the review view call `repo.open` (it does
not need to, F9), to add a refresh button (§0.3), or to change what `chunk.source` says on a
replayed ranged chunk (D11).

---

## 5. Dependencies and tooling

**No new dependency, in either language.** No FlatBuffers schema change, so `bun run generate:wire`
is not run and `internal/gitwire`/`packages/git-ipc/src/generated` do not move (D4). `go.mod` and
`bun.lock` are expected to be **unchanged**; a diff in either is a signal something was reached for
that this plan did not sanction.

---

## 6. Implementation order

Eight commits. `go build ./apps/kira-studio/internal/...`, `bun run lint` and `bun run typecheck`
run after **each** — they are fast. The expensive tier (§7.1(f)–(i)) runs once at C8, per
`AGENTS.md`'s "implement the whole plan first, then test once".

- **C1** `feat(gitclient): merge-base, ranged-count and origin/HEAD argv`
  — §3.1 + §3.2. Nothing imports them yet.
- **C2** `feat(gitreview): the branch-review base resolver`
  — §3.3 in full, with D16's matrix. Pure; depends on C1 only for `porcelain.RefRow`.
- **C3** `fix(gitsession): graph.stream no longer reads a page the user did not ask for`
  — §3.6's one-line guard and its test (D12). Independent of everything else in the phase, landed
  first so C5's tests observe the fixed behaviour.
- **C4** `feat(gitsession): review base resolution and the per-repo range count`
  — §3.4 + §3.5 (D7c, D9). Depends on C1, C2.
- **C5** `feat(gitsession): the ranged walk as this connection's second Walk`
  — §3.6's remaining fields + §3.7 in full (D2, D3, D5, D9), with
  `TestConn_ReviewWalkDoesNotDisturbTheGraphWalk` and D17's `initWalkRepo` hardening. Depends on C3,
  C4.
- **C6** `feat(git): serve review.resolveBase and the ranged graph.* walk, and bump the contract to 15`
  — §3.8 + §4.1 + §4.6 (D1, D8, D10, D11, D18). All three `CONTRACT_VERSION` mirrors move in this
  one commit. Depends on C4, C5.
- **C7** `feat(vscode): register the review view, answer review.open locally, and wire the palette command`
  — §4.2–§4.5 (D13, D14, D15). Depends on C6 for the contract.
- **C8** `test(git): the base resolver and the ranged walk end to end`
  — §3.9 in full, including deleting `TestIntegration_GraphRangeIsRefused`, then the full §7.1 run.

Dependency order: C1 before C2 and C4; C3 before C5; C4 before C5 and C6; C5 before C6; C6 before
C7; everything before C8.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 What is proven automatically, in this container

**Scoped per SPEC's "Full verification scope, 2026-09-07" note**, not the whole `internal/` tree.
This phase's own git packages plus the layering test, and nothing else — the pre-existing
`studio`/`api` adapter packages take real minutes under `-race` and cannot be touched by any change
in this plan.

**(a) The scoped race run, once, at C8** — the note's own list **plus `internal/gitreview`**, which
did not exist when it was written:

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
  ./apps/kira-studio/internal/bridge/... \
  ./apps/kira-studio/internal/
```

(`./gitclient/...` covers `porcelain`, `catfile` and `logsession`; `./bridge/...` covers
`rpcstream`; the bare `./internal/` is the layering test.) **The full unscoped
`./apps/kira-studio/internal/...` is not this phase's default cost** — SPEC's note says to run it
occasionally as a backstop, and G6 is not the phase that owes it (nothing here touches a
non-git package; the layering test is what proves that, below).

**(b) `go test ./apps/kira-studio/internal/gitreview/...`** — D16's resolution matrix: every rule,
every fall-through, the dangling-`origin/HEAD` case (probe P1), and the candidate list's ordering
and de-duplication. Pure, no repository, no git.

**(c) `go test ./apps/kira-studio/internal/gitsession/...`** — the walk pair's isolation
(`TestConn_ReviewWalkDoesNotDisturbTheGraphWalk`, D3's whole claim) and the re-open page guard
(`TestWalk_ReopenDoesNotReadAnUnrequestedPage`, D12).

**(d) `go test ./apps/kira-studio/internal/gitsock/`** — §3.9's nine integration tests over a real
socket against real repositories: the four range outcomes, the reasons and the candidate list, the
request-borne `baseCandidates`, the ranged walk **agreeing with `git log` itself**, graph/review
isolation, ranged `loadMore`/`status`, the post-`refsChanged` reset, two connections reviewing
independently, and the two `E_BAD_REQUEST` refusals. **This is the phase's real end-to-end proof on
the Go side.**

**(e) `go test ./apps/kira-studio/internal/`** — the layering test, with **nothing added to
`packagesExemptFromBridgeCheck`**: `gitreview` imports only `gitclient/porcelain` and stdlib, so it
sits cleanly under the line.

**(f) `KIRA_GIT_FIXTURES=write go test ./…/porcelain/...` leaves the tree clean** — G4 D15's
machine-independence check. This phase adds no fixture (D16), so a diff here means something
regenerated that should not have.

**(g) `bun test packages/git-ipc/src` (inside `bun run test:unit`)** — the contract, codec and rpc
tests against `CONTRACT_VERSION = 15`. `codec.test.ts` and `rpc.test.ts` both reference the
constant symbolically and should need no edit; if either needed one, that is a signal the bump
touched more than one integer.

**(h) `bun run lint` / `bun run typecheck` / `bun run build:vscode` — green.** `typecheck:git` is
what proves the `revealReview` dep, the `activeRepoId` change and `notifyRepoChanged` compile
against a `packages/git-ui` nobody touched; `build:vscode` has been an exit criterion since G3 D20
and is what proves the review root still bundles.

**(i) `bun run test:e2e-real` — green**, adding no new spec. Its `git-pairing-real.spec.ts` carries
the third `CONTRACT_VERSION` mirror (§4.6); its continued passing is what proves the handshake's
hard lockstep still agrees across all three copies.

### 7.2 What genuinely cannot be proven here, and the macOS script for it

Three things are structurally out of reach in this container, unchanged from G3–G5:

1. **A real VS Code extension host.** The sidebar view, its activity-bar container, the base
   picker, the expanding rows, the diff overlay and both panel entry points are Vue inside a
   webview that only exists inside VS Code. §7.1(d) proves every byte underneath them and nothing
   about them.
2. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` on non-darwin (G2 F18), so
   nothing here reaches the real `repo.open` path a human uses.
3. **Perf.** Upstream's own P7 budget (first commits painted ≤300 ms on a 200-commit range) is
   measured on real hardware; G3 D22's harness measures this container and G8 re-baselines.

**The macOS script, run once on real hardware before G6 is called done:**

1. The §7.1(a) scoped race run on macOS — the same suite on the platform that ships.
2. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`;
   `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` on a real repository; pair.
3. **The activity-bar icon appears and the view resolves.** Open it with no target: it shows the
   "no branch" state with a populated branch picker (which is `refs.list` from G5 and
   `repo.list.activeRepoId` from D14 — if it says "no repository" while the panel has one open,
   D14 is wrong).
4. **Entry point 1**: the branch picker's row menu → "Review branch changes" reveals the sidebar on
   that branch. **Entry point 2**: right-click a *branch badge* in the message column → the same
   entry, with the menu titled by the branch name; right-click one pixel to the side still opens
   the commit menu. **Entry point 3**: `Kira Version: Review Branch Changes` from the palette
   reveals the view with no target.
5. **Reviewing while the view is already open replaces its contents** (the `review.target` arm),
   and reviewing from a *cold* sidebar seeds through the bootstrap island — both arms, because
   `resolveWebviewView` runs for one and not the other.
6. **All four resolution outcomes, each naming both refs**: a branch tracking `origin/<other>`
   resolving with reason "upstream"; a branch tracking its own name falling through to the detected
   default with reason "default branch"; a fully-merged branch showing "nothing to review"; two
   unrelated histories saying so. Then a repository with no `origin/HEAD` and no `main`/`master`
   showing the ask state.
7. **The header base picker overrides in place** — the same view root, no unmount, the list
   repaints, and the reason label disappears for an override. Set
   `kiraVersion.review.baseCandidates` to something exotic (`["trunk"]`), reload, and confirm the
   resolution changes — **the one thing only a real window can prove about D1**.
8. **The list is the range, and only the range**: its rows equal `git log --topo-order
   <base>..<branch>` in a terminal; a merge inside the range renders its parent selector with the
   subject-less fallback for the parent outside the range (upstream's own V5, a degradation and not
   a bug).
9. **The reuse boundary**: a row expands into G4's file tree; a file opens G4's unified diff as a
   full-height overlay; `Esc` closes the diff then collapses the row; **"Go to file" on a branch
   that is not checked out lands in the virtual blob at the mapped line** — G4's `file.goToTarget`
   plus `file.read`, reached from a second view for the first time.
10. **The panel is undisturbed, in both directions**: with the graph scrolled deep, open a review,
    page it, review a second branch, close the sidebar — the graph's loaded rows, scroll and
    selection are exactly where they were, and `Load more` on the panel still appends. Then the
    reverse: `Load more` on the panel while a review is open leaves the review's rows alone.
11. **`Load more` in the review appends one page** and does not double-page (D12) — visible as the
    row count growing by `graph.pageSize`, not twice it.
12. **The mid-review change banner**: with a review open, move the reviewed branch from a terminal
    (`git commit` on it, or a force-move). The "the comparison has changed" banner appears
    (`repo.changed` reaching the review view at all is D15's forward, F11), and **clicking it
    actually re-walks** — the new commit appears (D5; without it the banner would replay the same
    rows, which is precisely the failure to look for).
13. **Two windows**: review the same branch in two VS Code windows against one Kira Studio, and
    confirm each has its own list and its own paging depth, and that paging one does not move the
    other (SPEC §6's per-connection rule, for the second walk).
14. Confirm what is *expected to still be broken*, so it is not mistaken for a regression: the
    stash list is still empty and the webview console still carries an unhandled rejection for
    `stash.list` (G12); "Push tag" and "Delete on remote" still fail with an error naming the
    operation (G5 D5, G7). **`review.open` no longer rejects, and the review view is registered** —
    the last two items on G3 D17's and G5's own "still broken" lists are gone.

### 7.3 The checklist

- [ ] `CONTRACT_VERSION` is **15** in all three places: `git-ipc/src/validate.ts:7`,
      `gitrpc/contract.go:11`, `tests/e2e-real/git-pairing-real.spec.ts:93` (D1/F10).
- [ ] `packages/git-ipc`'s only diff is that constant and `review.resolveBase`'s one optional
      param — no key, no event, no stream, no result type (D1).
- [ ] `packages/git-ui` and `packages/git-core` are byte-for-byte unchanged.
- [ ] `go.mod`, `bun.lock`, `gitWire.fbs`, `src/generated/` and `internal/gitwire` are unchanged;
      `bun run generate:wire` was not run (D4).
- [ ] A ranged chunk decodes through the **same** `"KIG1"` frame and the same `packedStream.ts` as
      a graph chunk; the cross-language fixture G3 D16 committed still passes (D4).
- [ ] `Conn.walks` holds a pair; a ranged request never disposes, resets or renumbers the graph
      walk, proven by a named test **and** by an integration test over the socket (D3/D16).
- [ ] Reviewing a second branch **replaces** the first review walk; there is never more than one
      per (connection, repository) (D3).
- [ ] `refsChanged` marks **both** walks stale (D5), and the range-count slot is dropped in
      `note()` **before** the fan-out (D9).
- [ ] `resumeThroughRow` is never read on the ranged path (D11).
- [ ] `Walk.Stream` reads a page only when `cachedThrough == 0` (D12).
- [ ] `PrecomputedTotal` is supplied when the slot hits and `nil` when it misses, and a miss still
      produces a correct `remaining` (D9).
- [ ] A ranged `WalkSpec` carries an empty `Scope` and `IncludeStash: false` (D2).
- [ ] `merge-base` exit 1 is `unrelated`; anything other than 0 or 1 is a classified error, not a
      verdict (D7c, probe P2).
- [ ] `merge-base` is consulted **before** the count, and an unrelated pair never runs the count
      (D7c, probe P4).
- [ ] `symbolic-ref`'s exit 128 is "not detected", and `ctx.Err()` is checked before it is folded
      (D7c, probe P1).
- [ ] A `base` or `branch` beginning with `-`, or empty, is `E_BAD_REQUEST` naming the field —
      never a spawn (D8/F6).
- [ ] `review.open` is answered by the extension, is **not** a `gitrpc` case, and `app.init`'s
      capability block still has exactly four fields, all `true` (D13).
- [ ] `repo.list` reports a real `activeRepoId`; the panel's own behaviour is unchanged (D14).
- [ ] `reviewView.ts` has `notifyRepoChanged` and `extension.ts` fans `repo.changed` and
      `settings.changed` to both providers (D15/F11).
- [ ] `kiraVersion.reviewBranch` is in `contributes.commands`; the container, view and icon
      declarations are untouched (D15).
- [ ] `TestIntegration_GraphRangeIsRefused` is deleted and `rangeRefusal` no longer exists (F10).
- [ ] No test, fixture or script runs `git config --global` or `--system`; `initWalkRepo` is
      isolated (D17).
- [ ] `packagesExemptFromBridgeCheck` is unchanged; `gitreview` imports only
      `gitclient/porcelain` and stdlib (D7a).
- [ ] §7.1(a)–(i) all green; §7.2's fourteen macOS steps all pass.

---

## 8. Sequencing — one implementer

**Recommendation: one sequential Sonnet subagent for the whole phase.** G1–G5 all made the same
call and all five carried it through.

1. **The phase is one dependency chain.** argv → the pure resolver → the session's four outcomes →
   the walk pair → the router → the extension → the proof. That is `AGENTS.md`'s textbook case of
   *not* "genuinely independent (unrelated adapters, non-overlapping fixes)".
2. **C5 is where the phase's one real risk lives.** The walk pair touches a structure four
   integration tests already drive, and its correctness claim is a *negative* one ("the graph is
   unaffected") that only an agent holding C3 and C4's context in its head will assert convincingly.
3. **The one piece that looks separable is not worth separating.** C2 (`gitreview`) is a pure
   package with a table-driven test and no dependency on anything else in the phase, and C3 is one
   line — but they are, between them, a couple of hundred lines against a coordination cost that is
   not smaller than that. If the orchestrator does choose to parallelise anyway, **C2 alone** is the
   only defensible cut: it touches a directory no other commit creates, and
   `go test ./…/gitreview/...` is its whole proof.

---

## 9. Explicit non-goals for G6

| Not in G6 | Owner |
|---|---|
| `stash.list`, `stash.show`, the stash pre-flights and their `op.run` kinds | G12 |
| `remote.*`, the askpass broker, the credential relay, `op.run`'s `tagPush`/`tagDeleteRemote` | G7 |
| `preflight.reset`, `preflight.cherryPick` and their operations | G13 |
| `search.run` and the RE2-vs-`RegExp` reconciliation | G14 |
| A command-palette command for any *mutating* operation, and the SCM title-bar/status-bar entry points | G9 (SPEC's own G9 row; `kiraVersion.reviewBranch` is a read and one of §6.8's three required entry points, so it lands here) |
| `review.db`, blob snapshots, the fast/slow diff path, partial-review ranges, the TTL reaper | G10 |
| Inline AI review comments | G11 |
| PR badges anywhere in the review surface, and `branch.resolvePr` | G15 |
| `git worktree` create/list/switch/remove | G16 |
| `review.end` / any wire-level review teardown (D6, §11.1) | unassigned — G8 is where resource lifetimes get their real pass |
| Narrowing `logsession`'s `--skip` ref-snapshot guard to a range's two endpoints (upstream's W3) | unassigned, D11's own note |
| A refresh affordance in the review view, or changing what its stale-comparison banner renders | never in v1.3 — upstream's own OQ5/OQ6, already resolved in the migrated `state/review.ts` |
| Lanes, a graph column or ref badges in the review list | never — §6.8: "a range of one branch has nothing interesting to draw" |
| Any operation on a review row beyond copy sha / copy message | never in v1.3 — §6.8's "Read-only" |
| Virtualizing the review list | never — §6.8/D42: a bounded range behind `Load more`, not the 100k the graph is built for |
| Any change to `packages/git-ui` or `packages/git-core` | never, per SPEC §5 |

---

## 10. Handed forward

- **`stash.list` is still the last of G3 F16's four rejections.** **G12**. After G6 the webview
  console carries exactly the same one unhandled rejection it did after G5 — this phase closes no
  rejection and opens none.
- **The review walk has no explicit teardown** (D6). Its bounds are replacement, `repo.close`,
  disconnect and `logsession`'s 5-minute idle reclaim. **G8** is the phase with a real two-window,
  two-repository matrix in front of it and is where "is one idle ranged walk per (connection,
  repository) actually fine" gets measured rather than argued.
- **A `Load more` clicked on a stale review walk resets first and re-reads page one** (D5's own
  edge). Self-correcting on the next click, same shape the graph already has. If it turns out to be
  visible in practice, the fix is client-side ordering (acknowledge the banner before paging), not
  a second staleness mechanism.
- **`logsession`'s `--skip` guard is still the broad ref snapshot for a ranged walk** (D11). It is
  correct and occasionally over-eager, and it is only reachable for a range larger than
  `graph.pageSize` left idle past reclaim. Upstream's W3 narrowing is the design if that case is
  ever real.
- **The range-count slot is one entry per repository** (D9). Two windows reviewing different
  branches of one repository thrash it, costing one `rev-list --count` each. **G8** again, if the
  multi-client matrix says it matters.
- **`repo.list.activeRepoId` now means "the most recently opened repository on this extension
  host"** (D14). Any later phase that gives the panel a real persisted "last active repo" should
  make that the source rather than adding a second one.
- **`gitreview` exists and holds one classifier.** **G10** adds `review.db`, the compressed blob
  store, the fast/slow-path selection and the reaper beside it, and SPEC's own "Review state"
  section says its sessions key off *this* phase's `(repo, branch)` range concept — so a G10 that
  invents a second notion of "which branch is being reviewed" is a G10 that has gone wrong.
- **`review.open` was the seventh and last host-capability method** (D13). `proxyHandlers`'s
  request table now answers seven methods locally and forwards the rest; the next phase to add a
  host-answered method is adding an eighth to a list SPEC §5 says has seven.
- **Both webview views are registered.** G3 D17's hand-off is closed; `apps/kira-studio-vscode`
  registers no further views in this chapter.

---

## 11. Three calls worth a human eye before implementation starts

All three are judgment calls the orchestrator or the user may reasonably decide differently, and
all three are cheap to change *now* and awkward to change after C5. None is a blocker: the plan
takes a position on each and can be implemented as written.

### 11.1 Should `review.end` be added to the contract after all? (D6, F8/F9)

**As planned**: no. Upstream's `endReview` never crossed a wire — it was an in-process call its
webview provider could make — and this chapter has added no wire surface of its own in six phases.
The walk is bounded by four existing mechanisms, the worst case is one idle `Walk` (a bounded
store, no process after five minutes) per (connection, repository), and D5 restores the correctness
property that upstream's "dropped on hide" was actually buying.

**The alternative**: add `review.end { repoId }` and call it from `reviewView.ts`'s `onDidDispose`.
It costs no extra version bump (D1 is already paying for one), it gives deterministic teardown, and
it makes "the review session is simply gone when the view is" literally true rather than
approximately true. Against it: it is new wire with no upstream provenance, its teardown is
best-effort regardless (no disposal hook runs for a crashed extension host), and it would be the
first method in this chapter that exists to manage a resource rather than to answer a question.

This is the one place G6's coverage of upstream's P7 is deliberately narrower, so it is flagged
rather than settled quietly.

### 11.2 Should a mid-review `refsChanged` reset the review walk? (D5, F8)

**As planned**: yes — the same signal marks both walks stale, and the next operation on either
resets it. That is what makes the migrated client's "the comparison has changed" banner do
something when clicked, and it is one rule rather than one rule with an exception.

**The alternative**: upstream's exclusion — the review walk is never invalidated by the watcher,
and the client's background re-resolve is the whole story. It is upstream's own resolved open
question, it avoids re-walking on a ref change that cannot affect the range, and it keeps a reader's
list perfectly still. Against it: **here** it makes the banner inert, because
`acknowledgeStaleReview` re-opens the same range against a walk whose store the server would then
replay. Adopting the alternative therefore also means accepting that the banner informs and cannot
act — or building the narrower endpoint-scoped invalidation (§10) that D11 declined.

Note these two are coupled: 11.1's alternative (`review.end`) would restore upstream's lifetime and
make 11.2's alternative defensible again. Deciding them together is cheaper than deciding them
apart.

### 11.3 Should G6 fix `Walk.Stream`'s extra page read? (D12, F5)

**As planned**: yes, as its own commit (C3). It is one line, it is what the method's own comment
already claims, it is what upstream does on both of its paths, and it is what §5.1.1 states as a
rule. Today one `Load more` click on the graph loads two pages.

**The alternative**: leave it, on the grounds that it is G3's defect in G3's code and G6's scope is
branch review. That is a defensible reading of scope discipline. Against it: the ranged walk shares
the method, so G6 would be shipping a second consumer of a known-wrong guard and would have to
describe the double-page behaviour as intended in the review view's own Load-more path.

The reason it is flagged rather than simply done: it changes the **graph's** observable behaviour —
a `Load more` will load half as many commits as it does today — which is outside what SPEC's G6 row
promises, and a reviewer seeing that diff should see it because it was decided, not because it was
convenient.
