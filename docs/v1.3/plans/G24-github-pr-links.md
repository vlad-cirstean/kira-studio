# G24 — GitHub PR links: `ghclient`, the per-commit indicator, and the `gh`-CLI transport

> **What this phase is.** The twenty-fourth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the **first one in the G17/G22/G23 run that is not a port**. SPEC's own phase table says so (`docs/v1.3/SPEC.md:40`): *"P12 GitHub PR links | **Not done upstream**"*. There is no upstream Go, no upstream TypeScript, and — verified by listing `/home/user/vlad-cirstean/kira-version-vscode/docs/plans/` — **no upstream `P12.md` either** (the directory holds P0, P1, P2, P3, P4, P4b, P4c, P5, P6, P6a, P7, P8, P9, P10, P11, P15, P16 and `README.md`; P12, P13 and P14 were never written). What exists upstream is a *design*: `docs/SPEC.md` §6.7 (`:1176-1240`), the P12 row of its phase table (`:2194`), and decisions **D31** (`:2252`) and **D32** (`:2253`). That design is ported faithfully. Its transport is not: `vscode.authentication.getSession('github', ['repo'])` is unavailable to a Go backend, and this repo's SPEC already replaced it, bindingly, in **§3.5** (`docs/v1.3/SPEC.md:146-182`) with *"delegate entirely to the `gh` CLI already on the user's machine, own no credentials of any kind."*
>
> **What is already decided and is not reopened here.** SPEC's G24 row (`:337`) and §3.5 fix: per-commit rather than per-branch-tip resolution; lazy per-selected-commit rather than eager per-visible-row; `gh api` as the only transport; the four-member `GhStatus` union; first-use-only probing; upstream's branch-tip badges kept *alongside* the new graph indicator; `kiraVersion.github.enabled`; PR number/title in search's Refs scope; and wiring `branch.resolvePr` into G11's reaper. §3.5's closing line names what is left: *"G24's own Opus planning pass owns the concrete `ghclient` API and the exact `gh api` calls/fields used; this section fixes the mechanism and its failure states, not the full implementation."* §2 below is that.
>
> **The one real design departure from upstream, and it is SPEC's, not this plan's.** Upstream asked one question — *"does this branch have an open pull request"* — and answered it with `GET /pulls?head={owner}:{branch}`. SPEC's G24 row adds a second, harder one — *"is this specific commit part of one"* — answerable only by `GET /repos/{o}/{r}/commits/{sha}/pulls`. **This phase implements both**, because the two lookups serve two different surfaces that SPEC says must coexist: the commit-endpoint answer drives the new graph indicator and the detail pane, and the branch-endpoint answer drives upstream's D32 badges, search's Refs scope, and — critically — the reaper, which needs `state=all` to learn that a PR *closed*, something no open-PR query can ever report.
>
> **`CONTRACT_VERSION` 26 → 27** (D14), for two new Go-served requests, four new wire types, and one new `RepoSettingsSnapshot` member. Notably **not** for a `SearchMatchField` change — see F9, which found that the wire's search-field union is commits-only and the PR fields belong entirely to `git-core`'s client-side `SearchField`.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `1870536d` (G1–G23 complete; `CONTRACT_VERSION = 26`, `packages/git-ipc/src/validate.ts:56`). Every claim below was checked against source read in this container — this repo and the upstream checkout at `/home/user/vlad-cirstean/kira-version-vscode` (`claude/start-p2-gwlgly`) — never inferred from SPEC prose.

The binding specs are, in precedence order:

1. `docs/v1.3/SPEC.md` **§3.5** (`:146-182`) — the auth mechanism and its failure states. Implemented as written.
2. `docs/v1.3/SPEC.md` **G24 row** (`:337`) — per-commit resolution, laziness, coexistence with branch-tip badges, the three extra scope items.
3. `docs/v1.3/SPEC.md` **`ghclient` package row** (`:70`) and the **"Review state"** bullet (`:414-421`).
4. Upstream `docs/SPEC.md` **§6.7 / D31 / D32** — the REST lookup shape, the per-branch cache and its watcher invalidation, `branch.resolvePr`'s contract, the badge UI, and the "inert, never noisy" rule. Ported as designed.

### 0.2 Scope

1. **`internal/ghclient`** (new package) — SPEC `:70`'s own row. `Locator`, `Runner`, `Discovery`, `Status` (`GhStatus`), `Client`, `ParseRemote`, the three `gh api` calls, and the error classifier.
2. **`internal/gitsession`** — a per-`RepoEntry` PR cache slot, three resolve methods, the `refsChanged` drop, and **the reaper hook** (`e.review.Purge`, G11 D20's named seam).
3. **`internal/gitreview`** — one new *read-only* method, `(*Store).Branches`. No new delete anywhere (G11 §10's rule).
4. **`internal/gitrpc`** — two new request cases (`commit.resolvePr`, `branch.resolvePr`), their param/result types, the `ContractVersion` bump, and the `github.enabled` settings leaf.
5. **`internal/gitops`** — one new argv builder, `RemoteGetURLArgs`.
6. **`packages/git-ipc`** — `GhStatus`, `PrRecord`, `PrLookupResult`, two requests, one `RepoSettingsSnapshot` member; **`CONTRACT_VERSION` 26 → 27**.
7. **`packages/git-core`** — `matchRef`'s `pr` seam implemented (`search/matcher.ts:229-234`), two new `SearchField` members, one new `SETTINGS` entry.
8. **`packages/git-ui`** — `state/pr.ts` (new), the graph indicator in `refBadges.ts`/`columns.ts`, the detail-pane row in `CommitMeta.vue`, the branch-picker badge in `BranchPicker.vue`, the search wiring, and the settings checkbox.

### 0.3 Not in this phase

- **Any OAuth, token storage, or hand-rolled HTTP client.** §3.5 forbids all three by name. This app never holds, reads, prompts for, or logs a GitHub credential.
- **PR review, comments, checks, merge, or creation.** Upstream §6.7's *"What it is not"*: it reads, it does not overlay, review, or write. Unchanged.
- **Feature-detecting the GitHub Pull Requests extension or GitLens.** Upstream D31 allowed it as *"enrichment only"*; this chapter's backend is not inside VS Code at all, so the enrichment path has no meaning here. Explicitly dropped, recorded in §9.
- **Bulk per-visible-row resolution.** SPEC's G24 row rules it out: *"a bulk per-row check risks the rate-limit budget for no benefit"*. The one bulk read this phase does make is a single repo-wide **open-PR snapshot** (D6) — 1–3 calls, cached, serving three surfaces at once, and never per row.
- **Replacing upstream's branch-tip badges.** SPEC: kept alongside. Both are built.
- **A shared `internal/procspawn` refactor.** `ghclient` gets its own ~120-line runner (F5/D2). §10.3 is the human-eye item.
- **Issue-reference linkification (`#123` in a commit body).** `linkify.ts:1-10` records this as *"an open item for P12"* — but it needs an issue-URL resolution, not a PR one, and it would linkify every `#123` including the ones that are not issues. §10.7 prices it; the recommendation is to decline.
- **Polling.** Upstream §6.7: *"Nothing polls."* Honoured. The one non-user-initiated call this phase makes (D8's bounded post-fetch re-resolve) is edge-triggered by `refsChanged`, capped, and gated.
- **No `docs/v1.3/SPEC.md` edit** — same convention every phase since G12 followed.

### 0.4 Ground rules

- **A non-GitHub remote costs exactly zero.** No `gh` probe, no spawn, no cache entry, no auth question. The remote check runs first, precisely so repositories the feature does not apply to never see any of it (upstream §6.7 step 1).
- **Nothing here can block or degrade git.** §3.5: *"None of these block git itself — they only blank the PR badge."* Every failure path returns data, never an RPC error.
- **Inert, never noisy, in the grid.** Upstream D32: no spinner, no error badge, no retry loop in a virtualized row. A failed lookup is a `slog` line. The **detail pane** — a non-virtualized surface the user reached by asking about one specific commit — is the single exception (D12), and it renders one line of actionable text, never an error.
- **Argv only, no shell, ever.** `exec.CommandContext` with an explicit argv, `Setpgid` + group kill, bounded per-call timeouts, hygiene env — the same discipline `gitclient/runner.go:226` already applies to every git spawn.
- **One classified-error vocabulary.** `ghclient/errors.go` is the only place an HTTP status or a `gh` exit code is interpreted.

---

## 1. Findings

### F1 — Upstream never wrote a P12 plan; only SPEC §6.7 and D31/D32 exist

`ls /home/user/vlad-cirstean/kira-version-vscode/docs/plans/` returns 18 entries and none is P12. The complete upstream design surface is `docs/SPEC.md:1176-1240` (§6.7), `:2194` (the P12 phase row and its "Done when"), `:2252` (D31), `:2253` (D32), plus four cross-references: `:446` (the `GitHubAuth` port), `:449` (`ExternalOpener`, *"open compare/PR URLs (§6.7's PR badge is what opens them)"*), `:592` (`branch.resolvePr` — *"adds one request and no events or streams"*), `:847` (*"needs exactly one git command"* — `git remote get-url origin`), and `:1690-1699` (search's PR arm).

### F2 — Nothing whatsoever exists in this repo yet

A precise grep for `resolvePr|GhStatus|PrBadge|github\.enabled|prNumber|pullRequest` across `packages/`, `apps/kira-studio-vscode/` and `apps/kira-studio/internal/` returns **zero** real hits. This breaks the G17/G22/G23 pattern, where the wire contract and the UI were already speced ahead of the Go implementation. Here the contract, the UI, the Go, the settings leaf and the tests are all new. The single exception is F3.

### F3 — `matchRef`'s `pr` seam is real, typed, tested-as-inert, and waiting

`packages/git-core/src/search/matcher.ts:229-234`:

```ts
export function matchRef(
  ref: MatchableRef,
  query: Extract<CompiledQuery, { kind: 'ok' }>,
  pr?: { readonly number: number; readonly title: string },
): readonly SearchField[] {
  void pr;
```

Its doc comment names this phase: *"`pr` is P12's seam: the hook for matching a ref's decoration against a pull request's number/title (§7.8's own paragraph on the boundary), unused for the whole of this phase and never passed by any P11 caller."* `matcher.test.ts:220-225` asserts the seam is inert. That test is **inverted, not deleted**, by this phase. The one caller is `packages/git-ui/src/state/search.ts:244`.

### F4 — `gitclient/discovery.go` is a clean structural template, and it is the right one

`discovery.go` is 4 pieces: `GitStatus` (a JSON-tagged discriminated struct with per-kind optional fields), `Locator` (a one-method interface that resolves a candidate path *without running it*), `Discovery` (`locator`+`runner`+`clock` with a mutex-guarded TTL cache keyed on the configured path), and `probe` (Locate → bounded-timeout `--version` → classify). `discoveryTTL = 30 * time.Second`, `versionProbeTimeout = 5 * time.Second`. `NewPlatformLocator` branches on `runtime.GOOS`, with `unsupportedLocator` for non-darwin. `ghclient` mirrors all four pieces, with three named departures (D3).

### F5 — `gitclient.Runner` cannot be reused for `gh`, and the reason is structural

`runner.go`'s `configOverrides` prepends `-c core.quotepath=false -c color.ui=false -c log.showSignature=false -c i18n.logOutputEncoding=UTF-8` to *every* argv, and `buildArgv` then always appends `--no-pager`. `gh` rejects `-c` and `--no-pager` outright. `ghclient` needs its own runner. What it copies is the *discipline*, not the code: `Setpgid: true`, `cmd.Cancel` doing a group `SIGTERM` then `SIGKILL` after a grace delay, `cmd.WaitDelay`, a bounded stderr cap, and `ESRCH` tolerance on group-kill.

### F6 — G11 built and named the reaper seam this phase must use, and forbade rebuilding it

`internal/gitreview/reaper.go`:

```go
// Purge is G16's own seam (D20): removes every row for (repoID, branch) immediately, regardless of
// idle time — the eager purge on PR closed/merged, once G16 exists to call it.
func (s *Store) Purge(ctx context.Context, repoID, branch string) error {
```

("G16" is this phase under the pre-reorder numbering.) `docs/v1.3/plans/G11-incremental-review-state-and-review-db.md` (D20) is explicit: *"G16 adds a caller and nothing else… A G16 that writes its own delete, or its own lifecycle, has gone wrong."*

### F7 — `RepoEntry` already holds the review store and the cache-drop point

`gitsession/entry.go` — `review *gitreview.Store`, threaded in by `newRepoEntry`. `SignalRefsChanged` drops the per-repo caches before the subscriber fan-out. Both the PR cache slot and the reaper hook belong here, next to `detail`/`diff`/`refs`/`rangeCount`, not in `gitrpc`.

### F8 — There is no remote-URL read yet, but the spawn helper and the argv convention are in place

`gitops/remote.go`'s `RemotesArgs()` returns `[]string{"remote"}`; `gitsession/autofetch.go`'s `pickAutoFetchRemote` runs it through `(*RepoEntry).runOne`. Upstream §6.7 needs exactly one more: `git remote get-url origin` (upstream `docs/SPEC.md:847`).

### F9 — The wire's `SearchMatchField` is commits-only; the PR fields never touch it

`packages/git-ipc/src/contract.ts:912-919` defines `SearchMatchField` as exactly seven commit fields — no `refName`, no `tagAnnotation`, because the tail scan is commits-only and Refs/Both are resolved entirely client-side against `RefsState`, no RPC. `git-core`'s own `SearchField` is the superset with `refName`/`tagAnnotation`. **`'prNumber'`/`'prTitle'` therefore go into `git-core`'s `SearchField` only** — no wire change, no `CommitSearchHit` change, and `internal/gitsearch.MatchFields` and G23's `searchConformance.json` corpus are both untouched.

### F10 — `kiraVersion.github.enabled` needs no SQL migration

`internal/storage/migrations/0017_g18_git_repo_settings.sql` creates `git_repo_settings(repo_id TEXT, key TEXT, value TEXT, PRIMARY KEY (repo_id, key))` — one row per (repository, leaf). An eighth leaf is a Go-side addition only.

### F11 — The badge can be an `<a href>`; no `ExternalOpener` port is needed

`webviewDocument.ts`'s CSP has no `navigate-to`/`form-action`, so an anchor navigation is not blocked, and VS Code's webview intercepts external navigation and opens the browser. `packages/git-ui/src/components/linkify.ts:1-10`: *"v1 P5 renders URLs as `<a href>` and lets the host's own webview link handling take them — no `ExternalOpener` port."* Upstream D32's conclusion (*"no new port"*) therefore holds here too, by a different route.

### F12 — The grid formatter already has the exact accessor-context convention this phase needs

`columns.ts`'s `MessageSearchContext` and `LaneColorContext` are both one-accessor interfaces read on every render pass. `CommitGrid.vue` watches a generation counter (`graphView.generation`, `search.searchGeneration`) and calls `invalidateAllRows()/render()`. A third context and a third generation watcher is a two-line pattern match.

### F13 — `gh` is not installed in this container

`which gh` → not found. Every Go test in this phase must therefore drive a **fake `ghclient.Runner`**, exactly as `gitclient/discovery_test.go` fakes `Locator`/`Runner`/`Clock`.

### F14 — `golang.org/x/sync` is an indirect dependency

`go.mod`: `golang.org/x/sync v0.22.0 // indirect`. `singleflight` would promote it to direct. §10.4 prices that against ~15 lines of hand-rolled in-flight dedupe.

### F15 — SPEC's `GhStatus` gloss has four kinds but the failure surface has six shapes

§3.5 fixes exactly `"ok" | "notFound" | "unauthenticated" | "forbidden"`. The real surface also includes: a `gh` that will not run or does not respond; HTTP 404; HTTP 429; and HTTP 5xx. D5 maps all six onto the four without adding a member, reading the four as **actionability classes**, carrying the detail in `Reason`.

### F16 — Upstream's own budget rule for search is a hard constraint, and the snapshot is what satisfies it

Upstream `docs/SPEC.md:1697-1699`: *"Matching runs over the PR records already cached in memory, so it adds no process and no network round trip to a keystroke."* `SearchState.refHits` is a synchronous Vue `computed` — it structurally *cannot* await anything. So the PR records search matches on must already be in the client's memory before the first keystroke. That is what D6's repo-wide open-PR snapshot is for.

---

## 2. Decisions

### D1 — `internal/ghclient`: the package surface, in full

```go
// ghclient/status.go
type Status struct {
    Kind    string   `json:"kind"` // "ok" | "notFound" | "unauthenticated" | "forbidden"
    Path    string   `json:"path,omitempty"`
    Version string   `json:"version,omitempty"`
    Host    string   `json:"host,omitempty"`
    Account string   `json:"account,omitempty"`
    Probed  []string `json:"probed,omitempty"`
    Reason  string   `json:"reason,omitempty"`
}
func (s Status) OK() bool { return s.Kind == "ok" }

// ghclient/discovery.go
type Locator interface { Locate() (path string, probed []string, found bool) }
func NewPlatformLocator() Locator
type Clock interface { Now() time.Time }
type Discovery struct { /* locator, runner, clock, mu, per-host cached Status + cachedAt */ }
func NewDiscovery(l Locator, r Runner, c Clock) *Discovery
func (d *Discovery) Status(ctx context.Context, host string) Status
func (d *Discovery) Hosts(ctx context.Context) []string

// ghclient/runner.go
type Spec struct { Args []string; Timeout time.Duration }
type Result struct { Stdout, Stderr []byte; ExitCode int }
type Runner interface { Run(ctx context.Context, ghPath string, spec Spec) (Result, error) }
func NewExecRunner() Runner

// ghclient/remote.go
type Repo struct { Host, Owner, Name string }
func (r Repo) Path() string
func ParseRemote(url string) (Repo, bool)

// ghclient/api.go
type Client struct { /* discovery, runner */ }
func NewClient(d *Discovery, r Runner) *Client
func (c *Client) get(ctx context.Context, repo Repo, path string, out any) Status

// ghclient/pr.go
type PR struct {
    Number    int    `json:"number"`
    Title     string `json:"title"`
    URL       string `json:"url"`
    State     string `json:"state"` // "open" | "draft" | "merged" | "closed"
    HeadRef   string `json:"headRef"`
    HeadSha   string `json:"headSha"`
    BaseRef   string `json:"baseRef"`
    UpdatedAt int64  `json:"updatedAt"`
}
func (c *Client) PullsForCommit(ctx context.Context, repo Repo, sha string) ([]PR, Status)
func (c *Client) PullsForBranch(ctx context.Context, repo Repo, branch string) ([]PR, Status)
func (c *Client) OpenPulls(ctx context.Context, repo Repo) ([]PR, Status)

// ghclient/errors.go
func classify(res Result, runErr error, ctxErr error) Status
```

`Client` never returns a Go `error`: every outcome is `([]PR, Status)`. That is the concrete expression of *"none of these block git itself"*.

### D2 — `ghclient`'s own runner, and its exact hygiene env

`cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}`; `cmd.Cancel` group SIGTERM then SIGKILL after a grace delay; `cmd.WaitDelay` set.

`ghHygieneEnv`, appended after `os.Environ()`:

| Var | Why |
|---|---|
| `GH_PROMPT_DISABLED=1` | `gh` must never block on an interactive prompt. |
| `GH_NO_UPDATE_NOTIFIER=1` | suppresses `gh`'s own background release check. |
| `GH_PAGER=` and `PAGER=cat` | the `--no-pager` equivalent. |
| `NO_COLOR=1`, `CLICOLOR=0` | no ANSI escapes in parsed output. |
| `GH_REPO=` | cleared always — an inherited `GH_REPO` silently retargets every call. |
| `GIT_TERMINAL_PROMPT=0` | `gh` shells to git on some paths. |
| `LC_ALL=C` | classification is by English substring. |

**Deliberately not set: `GH_TOKEN` / `GITHUB_TOKEN`.** Inherited exactly as the user's environment has them, never read, logged, or written. This is the concrete form of "own no credentials of any kind."

Timeouts: `versionProbeTimeout = 5s`, `authProbeTimeout = 10s`, `apiTimeout = 10s`. Stderr capped at 1 MiB; stdout capped at 4 MiB.

### D3 — `ghclient` mirrors `gitclient/discovery.go` with exactly three named departures

| Piece | `gitclient` | `ghclient` | Why |
|---|---|---|---|
| Probe order | setting → `PATH` → homebrew → local → CLT shim behind a gate | `PATH` → `/opt/homebrew/bin/gh` → `/usr/local/bin/gh` | §3.5 verbatim: no CLT-shim equivalent for `gh`. |
| Configured path | `git.path` setting | **none** | No `gh.path` setting (§10.6). |
| Version floor | `RequiredVersion`, `tooOld` kind | **none** | Every call used here has been stable since `gh` 1.0. |
| TTL | 30s, one entry | **`ok` → 5 min; non-`ok` → 30 s**, keyed by host | Asymmetric on purpose: short where user-visible (auth state), long where wasteful to re-check. |

`probe(ctx, host)` is: `Locate()` → `gh --version` → `gh auth status --hostname <host>` → classify.

### D4 — The exact `gh api` calls, and the fields read

Common prefix: `gh api --hostname <host> --method GET -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" <path>`.

**(a) Per-commit**: `repos/{owner}/{repo}/commits/{sha}/pulls?per_page=10`
**(b) Per-branch** (upstream D31 verbatim): `repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=all&sort=updated&direction=desc&per_page=5`
**(c) Repo-wide open snapshot**: `repos/{owner}/{repo}/pulls?state=open&sort=updated&direction=desc&per_page=100&page={1..3}`

Fields read: `number`, `title`, `html_url`, `state`, `draft`, `merged_at`, `head.ref`, `head.sha`, `base.ref`, `updated_at`.

**`state` is derived, not copied** — upstream §6.7: merged is not a distinct GitHub state:

```
merged_at != null            -> "merged"
state == "open" && draft     -> "draft"
state == "open"              -> "open"
otherwise                    -> "closed"
```

`"draft"` is this plan's own fourth value beyond upstream's three (§10.9).

**No `--jq`, and no `--paginate`** — both considered and rejected (a second expression language and a version-dependent output shape, respectively). Plain `gh api`, decoded into the struct; explicit `page=N` with an early stop when a page returns fewer than `per_page` elements, `maxSnapshotPages = 3`.

### D5 — Error mapping: four kinds as actionability classes (F15)

| Observation | `Kind` | `Reason` |
|---|---|---|
| exit 0, body decodes | `ok` | — |
| `Locate()` miss | `notFound` | "GitHub CLI is unavailable — install `gh`…" |
| spawn fails | `notFound` | "…could not be started" |
| `gh --version` unparseable | `notFound` | "…did not report a version" |
| any timeout | `notFound` | "…did not respond within Ns" |
| `gh auth status` non-zero | `unauthenticated` | "run `gh auth login`" |
| HTTP 401 | `unauthenticated` | "…rejected — run `gh auth login`" |
| HTTP 403, rate limit | `forbidden` | "…rate limit exhausted…" — **arms the breaker (D7)** |
| HTTP 403, SAML/SSO | `forbidden` | "…requires SSO authorization…" |
| HTTP 403, other | `forbidden` | "…lacks the scope…" |
| HTTP 429 | `forbidden` | as rate-limit, breaker armed |
| HTTP 404 | `forbidden` | "…not found, or cannot be seen" |
| HTTP 5xx / undecodable | `forbidden` | "GitHub did not answer…" |

`notFound` = "`gh` could not be used at all"; `unauthenticated` = "`gh` works, GitHub does not know who you are"; `forbidden` = "`gh` works, GitHub knows who you are, and refused or could not answer." The kind only changes the log line and D12's hint — it never changes the badge, which is absent for every non-`ok` outcome.

### D6 — Three caches, one snapshot, and what invalidates each

All three live on `RepoEntry` in a new `ghState` slot.

| Cache | Key | TTL | Bound | Dropped on |
|---|---|---|---|---|
| Open-PR **snapshot** | repo | 5 min | ≤ 300 PRs | `refsChanged` |
| Per-**branch** record | `branch` | 5 min | branch count | `refsChanged` |
| Per-**commit** record | `sha` | 10 min | LRU, 512 entries | `refsChanged` |

The **commit** cache is this phase's own and needs the LRU that upstream's branch cache did not: shas are unbounded.

The snapshot is load-bearing in three places: it is the only way `SearchState.refHits`'s synchronous computed can have PR records to match against; it pre-seeds the graph indicator with zero per-commit calls; and it answers the branch-picker badges for every branch in one call. Fetched **lazily on first need**, never at repo open.

### D7 — The rate-limit budget, stated as a number

Worst case per repository per 5-minute window: 3 (snapshot) + 1 (auth status per TTL) + 1 per distinct selected commit + 1 per branch resolved outside the snapshot. Four mechanisms:

1. **Selection debounce, 300 ms**, client-side. Arrow-keying through forty rows costs one call, not forty.
2. **In-flight dedupe** per cache key.
3. **The breaker.** A rate-limited `forbidden` sets `blockedUntil` (parsed reset, else `now + 15 min`). Every call inside that window returns the cached `forbidden` with no spawn. `refsChanged` does not clear it.
4. **No timer ever calls GitHub.** The complete list of things that reach the network: selecting a commit; opening the branch picker or typing in Refs scope (the snapshot); opening a branch review; D8's capped post-fetch re-resolve. Nothing else.

### D8 — `branch.resolvePr`, and the reaper wiring, concretely

Resolution order in `(*RepoEntry).ResolveBranchPr`:

1. Snapshot hit on `head.ref == branch` → that record. No call.
2. Miss → the per-branch `state=all` query (the only call that can report a *closed* PR).
3. Result cached, then:

```go
if rec != nil && (rec.State == "merged" || rec.State == "closed") {
    if err := e.review.Purge(ctx, e.Summary.RepoID, branch); err != nil {
        slog.Warn("ghclient: purge review session", "repo", e.Summary.RepoID, "branch", branch, "err", err)
    }
}
```

G11 D20's exported seam, called and nothing else. A purge failure is a warning, never an RPC error.

**Making it genuinely eager, without polling.** On `refsChanged` — after the cache drop, edge-triggered — `RepoEntry` schedules one bounded re-resolve pass: skip if `github.enabled` is off, no GitHub remote, or the breaker is armed; `(*gitreview.Store).Branches(ctx, repoID)` (one new read-only method, a read not a second lifecycle); resolve at most `maxEagerPurgeBranches = 8`, reusing the snapshot; purge each closed/merged. §10.1 is the human-eye item, since it is the only call not preceded by a direct user act.

### D9 — Per-commit resolution and the graph indicator, end to end

1. Selection changes → `PrState.select(sha)` starts a 300 ms timer, aborts any in-flight request (the same abort-plus-recheck discipline `DetailState.select` already uses).
2. On fire: `commit.resolvePr({ repoId, sha })`.
3. Server: `github.enabled` off → `{kind:'disabled'}`; no GitHub remote → `{kind:'disabled'}`; cache hit → serve; breaker armed → serve cached `forbidden`; otherwise `Client.PullsForCommit`.
4. Client stores into `PrState.bySha`, bumps `generation`.
5. `CommitGrid.vue` watches `pr.generation`, calls `invalidateAllRows()/render()` (a third instance of the existing pattern).
6. `columns.ts`'s `messageFormatter` takes a third accessor context, `PrContext`. `refBadges.ts`'s `buildPrBadge(pr)` produces:

```html
<a class="kv-badge kv-badge-pill kv-badge-pr kv-badge-pr--merged"
   href="https://github.com/o/r/pull/123" data-kui-tip="Fix the widget — Merged">#123</a>
```

placed after the ref badges, before the subject. State travels as a class, not words — upstream §6.7: badge width is scarce, the tooltip names the title and state. Four new tokens in `vscode-tokens.css`.

7. `<a href>` opens through the webview's own external-link handling.

Where more than one PR is associated with a commit, the badge shows one: `open > draft > merged > closed`, then most recently updated. The tooltip names the count; the detail pane lists all.

**Inert, never noisy** (upstream D32): not-yet-resolved / in-flight / `disabled` / `unavailable` all render nothing in the grid. Resolved-no-PR and resolved-PR render appropriately. The detail pane is the sole exception (D12).

### D10 — `PrState`, the one client-side owner

```ts
export class PrState {
  readonly bySha: ShallowRef<ReadonlyMap<string, readonly PrRecord[]>>;
  readonly byBranch: ShallowRef<ReadonlyMap<string, PrRecord>>;
  readonly generation: ShallowRef<number>;
  readonly status: ShallowRef<GhStatus | undefined>;
  setRepoId(id: string | undefined): void;
  select(sha: string | null): void;
  ensureSnapshot(): Promise<void>;
  resolveBranch(branch: string): Promise<void>;
}
```

Subscribes to `repo.changed`/`refsChanged` and clears everything, mirroring `RefsState`'s own three lines.

### D11 — Search: implementing `matchRef`'s seam (F3, F9)

```ts
export function matchRef(
  ref: MatchableRef,
  query: Extract<CompiledQuery, { kind: 'ok' }>,
  pr?: { readonly number: number; readonly title: string },
): readonly SearchField[] {
  const hits: SearchField[] = [];
  if (query.pattern.test(ref.shortName)) hits.push('refName');
  // …annotation arm, unchanged…
  if (pr !== undefined) {
    const n = String(pr.number);
    if (query.pattern.test(n) || query.pattern.test(`#${n}`)) hits.push('prNumber');
    if (query.pattern.test(pr.title)) hits.push('prTitle');
  }
  return hits.length === 0 ? NO_FIELDS : hits;
}
```

The two-form number test is upstream §7.8 verbatim: matches with or without the leading `#`. Two new `SearchField` members, `git-core` only (F9) — the wire, `internal/gitsearch` and G23's corpus are all untouched. `state/search.ts:244` becomes `matchRef(row, ok, this.#pr.byBranch.value.get(row.shortName))` — zero network per keystroke, the ≤120 ms budget untouched.

### D12 — The commit-detail pane is the only surface allowed to explain a failure

Upstream D32 forbids a pending/error state *in a virtualized grid row*. The detail pane is neither virtualized nor unsolicited — the user reached it by asking about that commit specifically.

`CommitMeta.vue`'s `'details'` section gains one "Pull request" row: resolved with a PR → link + state, one row per associated PR; resolved with none → "No pull request"; `unavailable` → one line of `Status.Reason` (the only place in the app that ever tells a user to run `gh auth login`); `disabled` → row absent entirely. §10.2 is the human-eye item.

### D13 — First use only, never at activation

`app.init` does not carry a `gh` field and does not touch `ghclient`. `repo.open` does not probe. `GhStatus` reaches the client only as part of a `commit.resolvePr`/`branch.resolvePr` result. The test: a `Router` over a counting fake `ghclient.Runner`; drive `app.init`, `repo.open`, `refs.list`, `graph.loadMore`, `status.get`, `commit.detail`; assert spawn count is 0. Then one `commit.resolvePr`, assert it is > 0.

### D14 — `CONTRACT_VERSION` 26 → **27**

Additive only. Two new requests (`commit.resolvePr`, `branch.resolvePr`, both Go-served); four new types (`GhStatus`, `PrRecord`, `PrLookupResult`, the state string union); one new `RepoSettingsSnapshot` member. Both new keys added to `REQUEST_KEY_MAP`.

```ts
export type PrLookupResult =
  | { readonly kind: 'ok'; readonly prs: readonly PrRecord[] }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly gh: GhStatus };
```

### D15 — GitHub-remote detection, and what counts as "a GitHub repository"

One git spawn, upstream verbatim: `git remote get-url origin`, via `gitops.RemoteGetURLArgs("origin")` through `runOne`. Cached for the entry's life, dropped on `refsChanged`.

`ghclient.ParseRemote` accepts `https://…`, `ssh://…`, `git@host:owner/repo.git`, `git://…` forms, including a custom GHES host, and rejects anything without exactly two path segments after the host.

**"Is this a GitHub repository at all"** = the host is `github.com`, **or** the host appears in `Discovery.Hosts()`. A GitLab/Bitbucket remote matches neither and the feature is inert: no probe, no spawn, no auth question. §10.5 prices the simpler `github.com`-only alternative.

### D16 — `kiraVersion.github.enabled` is a **per-repo** setting

Default `true`, `source: 'repo'`, joining G18's seven in the existing store — no SQL migration. Off means: no probe, no spawn, no cache fill, no badge, no search PR arm, no reaper re-resolve — `{kind:'disabled'}` on both requests.

---

## 3. The Go side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 3.1 | `internal/ghclient/doc.go` | new | Package doc, provenance, the "own no credentials" rule, D3's departures. |
| 3.2 | `internal/ghclient/status.go` | new | `Status`, `OK()`, the four `Kind` constants. |
| 3.3 | `internal/ghclient/discovery.go` | new | `Locator`, `NewPlatformLocator`, `Clock`, `Discovery`, asymmetric TTL, `probe`. |
| 3.4 | `internal/ghclient/runner.go` | new | `Spec`/`Result`/`Runner`/`NewExecRunner`, hygiene env, timeouts. |
| 3.5 | `internal/ghclient/remote.go` | new | `Repo`, `ParseRemote`. |
| 3.6 | `internal/ghclient/api.go` | new | `Client`, `NewClient`, `get`. |
| 3.7 | `internal/ghclient/pr.go` | new | `PR`, `deriveState`, `PullsForCommit`, `PullsForBranch`, `OpenPulls`. |
| 3.8 | `internal/ghclient/errors.go` | new | `classify` — D5's table. |
| 3.9 | `internal/ghclient/*_test.go` | new | Fake `Locator`/`Runner`/`Clock`; probe order; both TTLs; `ParseRemote`'s forms; every row of D5; `deriveState`'s four outcomes; argv-exact goldens. |
| 3.10 | `internal/ghclient/testdata/*.json` | new | Recorded bodies for commits/pulls/open/error cases. |
| 3.11 | `internal/gitops/remote.go` | edited | `RemoteGetURLArgs`. |
| 3.12 | `internal/gitsession/gh.go` | new | `ghState`, `githubRepo`, `ResolveCommitPr`, `ResolveBranchPr` (with the `Purge` hook), `ensureSnapshot`, `dropGh`. |
| 3.13 | `internal/gitsession/entry.go` | edited | `gh *ghState` field; construction; `dropGh()` on `refsChanged`; D8's re-resolve pass. |
| 3.14 | `internal/gitsession/registry.go` | edited | Thread the process-wide `*ghclient.Client` through, like `Settings`. |
| 3.15 | `internal/gitsession/gh_test.go` | new | Cache hit/miss/TTL; drop on refsChanged; breaker suppresses spawns; purge fires exactly once for closed/merged, never open. |
| 3.16 | `internal/gitreview/reaper.go` | edited | `(*Store).Branches(ctx, repoID)` — read-only. |
| 3.17 | `internal/gitreview/store_test.go` | edited | One case for `Branches`. |
| 3.18 | `internal/gitrpc/gh.go` | new | `handleCommitResolvePr`, `handleBranchResolvePr`. |
| 3.19 | `internal/gitrpc/handlers.go` | edited | Two switch cases; `Deps.Gh`. |
| 3.20 | `internal/gitrpc/wire.go` | edited | `PrRecord`, `PrLookupResult`, `GhStatus` shapes. |
| 3.21 | `internal/gitrpc/settings.go` | edited | The `githubEnabled` leaf. |
| 3.22 | `internal/gitrpc/contract.go` | edited | `ContractVersion` 26 → 27. |
| 3.23 | `internal/gitrpc/gh_test.go` | new | D13's zero-spawn assertion; disabled/no-remote/breaker paths. |
| 3.24 | `internal/storage/model/gitreposettings.go` | edited | `GithubEnabled bool`, default true. |
| 3.25 | `internal/storage/repos/gitreposettings.go` | edited | One `leafValid` line, one `upsert` line. No migration. |
| 3.26 | `internal/ipcfixture` | edited | Wire a fake `ghclient.Client` into the harness. |
| 3.27 | Not edited | — | `gitclient/*`, `gitsearch/*`, `gitwire/*`, `gitaskpass/*`. |

---

## 4. The TypeScript / Vue side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 4.1 | `packages/git-ipc/src/contract.ts` | edited | `GhStatus`, `PrRecord`, `PrState`, `PrLookupResult`; two requests; the settings member. |
| 4.2 | `packages/git-ipc/src/validate.ts` | edited | Two `REQUEST_KEY_MAP` entries; `CONTRACT_VERSION = 27`. |
| 4.3 | `packages/git-core/src/settings/schema.ts` | edited | `kiraVersion.github.enabled`, boolean, default true, `source: 'repo'`. |
| 4.4 | `packages/git-core/src/search/matcher.ts` | edited | `matchRef`'s `pr` arm; two `SearchField` members. |
| 4.5 | `packages/git-core/src/search/matcher.test.ts` | edited | Inverted `pr` tests. |
| 4.6 | `packages/git-ui/src/state/pr.ts` | new | `PrState`. |
| 4.7 | `packages/git-ui/src/state/pr.test.ts` | new | Debounce coalescing; stale-response drop; refsChanged clear; disabled never re-requests. |
| 4.8 | `packages/git-ui/src/components/refBadges.ts` | edited | `prBadgeSpec`/`buildPrBadge`. |
| 4.9 | `packages/git-ui/src/components/refBadges.test.ts` | edited | Four state classes; multi-PR precedence; tooltip text. |
| 4.10 | `packages/git-ui/src/components/columns.ts` | edited | `PrContext`; one call in `messageFormatter`. |
| 4.11 | `packages/git-ui/src/components/CommitGrid.vue` | edited | `pr.generation` watcher. |
| 4.12 | `packages/git-ui/src/components/CommitMeta.vue` | edited | "Pull request" row. |
| 4.13 | `packages/git-ui/src/components/BranchPicker.vue` | edited | `#123` on branch rows. |
| 4.14 | `packages/git-ui/src/state/search.ts` | edited | Pass `pr` into `matchRef`. |
| 4.15 | `packages/git-ui/src/components/searchResultsModel.ts` | edited | Two `fieldLabel` cases. |
| 4.16 | `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue` | edited | One checkbox. |
| 4.17 | `packages/git-ui/src/theme/vscode-tokens.css` | edited | Four `--kv-badge-pr-*` tokens, light and dark. |
| 4.18 | `packages/git-ui/src/App.vue` | edited | Construct `PrState`, wire selection/refs/search/grid/detail. |
| 4.19 | `apps/kira-studio-vscode/tests/unit/ipc/wireConformance.test.ts` | edited | `GhStatus`/`PrRecord` structural conformance. |
| 4.20 | Not edited | — | `linkify.ts`, `SearchBox.vue`, `graph/*`, `gitBlockedCopy.ts`. |

---

## 5. Dependencies and tooling

No new Go module, no new npm package. `gh` is a **runtime** dependency of the feature only — every test drives a fake `Runner`, so `go test ./...` passes on a machine with no `gh`.

---

## 6. Implementation order

1. `ghclient`: `status.go`, `runner.go`, `remote.go` + tests.
2. `ghclient/discovery.go` + tests.
3. `ghclient/errors.go` + `api.go` + `pr.go` + testdata + argv-golden tests. `ghclient` complete and independently green here.
4. `gitops.RemoteGetURLArgs`; `gitsession/gh.go`'s caches and `ResolveCommitPr`; `entry.go`'s drop.
5. `gitreview.Store.Branches`; `ResolveBranchPr` + the `Purge` hook + tests.
6. `gitrpc`: handlers, wire types, switch cases, `ContractVersion` 27, D13's zero-spawn assertion.
7. `packages/git-ipc`: types, request keys, `CONTRACT_VERSION = 27`.
8. The settings leaf end to end.
9. `matchRef`'s `pr` arm + the inverted test + `fieldLabel`.
10. `PrState` + its test.
11. `refBadges.ts`/`columns.ts`/`CommitGrid.vue` — the graph indicator.
12. `CommitMeta.vue`, `BranchPicker.vue`, `App.vue`, theme tokens.
13. D8's eager post-fetch pass, last.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go build ./...` and `go test ./...` green with **no `gh` installed**.
2. `ParseRemote` accepts all documented URL forms and rejects malformed ones.
3. Every row of D5's table asserted from a recorded body + stderr + exit code.
4. `deriveState` returns `merged`/`draft`/`open`/`closed` correctly.
5. Argv goldens: each of D4's three calls produces a byte-exact `[]string`, `--hostname` included.
6. Discovery caches within TTL and re-probes after it, both directions, on a fake clock.
7. **Zero `gh` spawns** across `app.init`, `repo.open`, `refs.list`, `graph.loadMore`, `status.get`, `commit.detail`.
8. `refsChanged` drops all three caches; the breaker suppresses spawns for its whole window.
9. `Purge` is called exactly once for a `closed` resolution and once for a `merged` one, never for `open`.
10. `matchRef` returns `['prNumber']` for `123` and for `#123`, `['prTitle']` on a title match, both on both, byte-identical to today when `pr` is `undefined`.
11. Bun tests, `tsc --noEmit` and `biome` green across `git-ipc`, `git-core`, `git-ui`.
12. `wireConformance.test.ts` green for the new types.
13. A settings round trip: default true, set false, `repoSettings.changed` fans out, both requests answer `{kind:'disabled'}` and spawn nothing.

### 7.2 Tier 2 — reasoned check

14. Rate-limit arithmetic re-derived against the final code: no path issues a call outside a direct user act or D8's capped, gated pass.
15. No token/`Authorization` header/`gh auth token` anywhere in the diff.
16. No new `DELETE` against `review.db`.

### 7.3 Tier 3 — needs a human on a Mac with `gh` installed

17. A real repo with an open PR: branch-picker badge and head-commit graph indicator both appear with no commit selected.
18. Selecting a mid-history commit belonging to a merged PR shows a merged-styled indicator; clicking opens the PR.
19. Detached HEAD at that same commit: identical result.
20. `gh auth logout` → badges vanish, git unaffected, detail pane names `gh auth login`.
21. A GitLab remote: `gh` never spawned.
22. Arrow-keying 40 rows in one second issues exactly one `commit.resolvePr`.

### 7.4 The checklist

- [ ] `internal/ghclient` complete, stdlib-only
- [ ] Three `gh api` calls exact, argv-golden-tested
- [ ] D5's table complete and asserted
- [ ] Per-commit indicator visible in graph + detail pane, `<a href>`, no new port
- [ ] Branch-tip badges kept
- [ ] `branch.resolvePr` → `Store.Purge`, no second delete
- [ ] `matchRef`'s seam active; two new `SearchField` members; no wire search change
- [ ] `kiraVersion.github.enabled`, per-repo, default on, no migration
- [ ] `CONTRACT_VERSION = 27` on both sides
- [ ] Zero spawns at activation, asserted
- [ ] Every failure renders as no badge

---

## 8. Explicit non-goals for G24

PR review/comments/checks/merge/creation; any OAuth or token handling; polling; bulk per-row resolution; GitLab/Bitbucket; replacing the branch-tip badges; a `gh.path` setting; a shared `procspawn` refactor; issue-reference linkification; feature-detecting other extensions.

---

## 9. Handed forward

- **G26 (stacked branches)** depends on this phase and will want a per-branch-in-stack view of `PrState.byBranch`. The snapshot is already exactly that shape.
- **`ghclient.Client` is the single GitHub surface.** Any future GitHub feature adds a method there.
- **Upstream D31's "enrichment only" clause is dropped**, not deferred — no VS Code-side extension to feature-detect from a Go backend.
- **Fork PRs**: the branch-endpoint query does not match a PR opened from a fork; the commit endpoint does. Known asymmetry inherited from upstream's own query.
- **GHES** works through `--hostname` + `Discovery.Hosts()` but is untested.
- **A shared spawn primitive** is the natural G30–G32 cleanup once there are two `os/exec` disciplines in the tree.

---

## 10. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it.*

**10.1 D8's post-fetch eager re-resolve.** **Recommendation: keep it**, capped at 8 branches, gated, edge-triggered by `refsChanged`, never a timer. SPEC asks for an eager purge in as many words; demand-only is what G11 already shipped.

**10.2 D12's detail-pane failure line, against upstream D32's "inert, never noisy".** D32's reasoning is explicitly about virtualized grid rows. **Recommendation: ship it** — without it an unauthenticated `gh` is permanently blank with no diagnosis short of a log file.

**10.3 `ghclient` gets its own runner rather than a shared `internal/procspawn`.** **Recommendation: duplicate**, with a doc comment pointing at G30–G32 as where a shared primitive belongs if a third spawner appears.

**10.4 In-flight dedupe: hand-rolled vs. promoting `golang.org/x/sync` to direct.** **Recommendation: hand-rolled** — `singleflight` is a poor fit for callers with different contexts/deadlines, and this chapter has added no new Go dependency so far.

**10.5 "Is this GitHub" = `github.com` or a host `gh auth status` reports, vs. `github.com`-only.** **Recommendation: the host-list form** — one substring check against a value already fetched, and the only version under which GHES works at all.

**10.6 No `kiraVersion.gh.path` setting.** **Recommendation: do not add it** — `gh` is optional and has neither git's mandatory-ness nor its CLT-shim trap; an inert feature is the designed failure mode.

**10.7 Issue-reference (`#123`) linkification in commit bodies.** **Recommendation: decline** — needs issue-URL resolution, not PR resolution, and would linkify non-issue `#123`s. Recorded in §9 rather than built.

**10.8 One badge per commit when several PRs are associated, vs. N badges.** **Recommendation: one badge**, `open > draft > merged > closed` then most-recently-updated, with the count in the tooltip and the full list in the detail pane.

**10.9 A fourth PR state, `"draft"`, beyond upstream's three.** **Recommendation: add it** — the field is in the same payload and "not ready" is a genuinely different answer than plain `open`.

**10.10 D6's repo-wide open-PR snapshot vs. upstream's strictly per-branch lookups.** **Recommendation: keep it** — fewer calls than per-branch for any repo with more than three branches, and the only thing that makes search's synchronous, zero-network requirement satisfiable at all.

**10.11 `CONTRACT_VERSION` 26 → 27.** **Recommendation: bump** — unavoidable given two new Go-served requests.
