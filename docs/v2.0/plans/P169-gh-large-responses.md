# P169: `gh` REST responses over 4 MiB reported as unreadable

Source: P168 Part 14 finding F16. Stream B. Go only: `apps/kira-space/internal/ghclient` plus docs.
No frontend file, no file owned by Parts 19/21/22/23.

## Current behavior (read from source)

`execRunner.Run` (`runner.go:110-165`) buffers all of stdout in an unbounded `bytes.Buffer`, then
slices it to `maxStdoutBytes` (`4 << 20`). Nothing records that the cut happened. Two consequences:

- Memory is not bounded at all. The cap only discards bytes after they were already held.
- A cut body is invalid JSON, and each caller misreports it differently:
  - `Client.get` (`api.go:57-75`): `classify` sees exit 0, says OK; `json.Unmarshal` fails;
    returns `forbidden` / "GitHub returned an unreadable response". Hits `PullsForCommit`,
    `PullsForBranch`, `OpenPulls` (`pr.go`).
  - `Client.graphql` (`graphql.go:57-85`): envelope unmarshal fails, so the `else` branch calls
    `classify`, which says OK on exit 0. `env.Data` stays empty, so `graphql` returns **OK with no
    data**. `PullFiles` then finds `PullRequest == nil` and reports "not found, or you cannot see
    it", a wrong status. Same path for any non-JSON exit-0 stdout, truncated or not.
    `SetFilesViewed` passes `out == nil`, so a cut body there reads as success.
  - `Discovery.probe` (`--version`, `auth status`): outputs are tiny; not affected in practice.

Stderr has the same post-hoc slice (`maxStderrBytes`, 1 MiB).

### Which endpoints can actually get large

Only four `gh` calls carry a body:

| Call | Request | Size driver |
|---|---|---|
| `PullsForCommit` | REST `commits/{sha}/pulls?per_page=10` | 10 full pull objects |
| `PullsForBranch` | REST `pulls?head=…&per_page=5` | 5 full pull objects |
| `OpenPulls` | REST `pulls?state=open&per_page=100&page=1..3` | **100 full pull objects per call** |
| `PullFiles` | GraphQL, `files(first:100)` with `path viewerViewedState` only | 100 paths, already projected |

The SPEC row's "very large file or review lists" framing does not match the code. No REST call
here fetches files or reviews. `PullFiles` already projects to two fields per node: 100 paths at
GitHub's 4096-byte path limit stay under 1 MiB per page. The real exposure is `OpenPulls`: a list
item carries `body`, two full `repository` objects (`head.repo`, `base.repo`), `user`, `labels`,
`assignees`, `requested_reviewers`, `requested_teams`, `milestone` and `_links`.

### Size estimate (not measured)

No authenticated `gh` in the sandbox; an unauthenticated `curl` to `api.github.com` was also
refused by the sandbox's permission policy. Everything below is arithmetic, not measurement.

- Pull list item without body: ~15-30 KiB (two repository objects at ~5-6 KiB each dominate).
- `body`: at most 65536 characters. JSON-escaped worst case is 6 bytes per character (control
  characters as `\u00XX`), so at most 384 KiB. Realistic bodies are 0-10 KiB.
- Per-item worst case: ~384 KiB body + ~30 KiB fixed + labels (≤100 × ~0.3 KiB) + reviewers/
  assignees ≈ 450 KiB.
- 100-item page: realistic 2-4 MiB (already near the 4 MiB cap, which matches F16's suspicion);
  worst case ≈ 45 MiB.

## Options

**A. Per-endpoint `--jq` projection (amends D4).** `gh api … --jq 'map({number,title,…})'`
shrinks a page to ~30 KiB. Rejected:

- D4 (`docs/v1.3/plans/G24-github-pr-links.md:261`) rejected `--jq` as a second expression language
  kept in step with `rawPull`'s Go field list. That cost is unchanged: every `rawPull` field
  change now edits a jq string too, and the argv goldens grow a jq expression.
- `classify` reads GitHub's error body from stdout (`apiErrorMessage`, `errors.go:87`). Whether
  `gh` applies `--jq` to a non-2xx body is a `gh` internal not pinned by any contract; a filter
  applied there turns `{"message": …}` into a jq error and silently loses the SSO/scope message.
- It fixes only the REST calls. The runner still misreports any other oversized or cut body, and
  the `graphql` "OK with no data" path stays wrong. So the runner fix below is needed anyway.

**B. Smaller REST pages.** Already paginated (`page=1..3`, early stop). Dropping `per_page` to
e.g. 20 keeps 300 PRs only by going to 15 calls, breaking D7's rate-limit arithmetic, which
assumes `maxSnapshotPages = 3`. It also bounds nothing: per-item size is unbounded by page count.
Rejected. (`--paginate` stays rejected per D4.) Moving `OpenPulls` to GraphQL would project fields
natively, but it changes rate-limit accounting (GraphQL points) and the snapshot's whole data
path. Out of scope; not needed once the cap fits the worst case.

**C. Larger, derived cap, enforced while reading, plus a distinct too-large status.
Recommended.**

- Cap: **64 MiB**, derived: covers the ≈45 MiB worst-case `OpenPulls` page with margin. Same
  figure as the Studio import cap and Wails' `streamMaxFrameBytes`. Memory grows only with real
  output, so a normal 30 KiB answer costs the same as today.
- A bounded writer stops retaining bytes past the cap and records overflow. Memory is truly bounded
  now, which today's post-hoc slice is not.
- Overflow becomes its own reason in `classify`, so every `gh` call (REST and GraphQL) reports it
  the same way, and valid JSON is never called "unreadable".
- D4 stays as written. No new dependency, no rate-limit change, no wire-type change.

Residual risk: a body near 64 MiB on a slow link may exceed `apiTimeout` (10 s) and report "did not
respond within 10s". That is honest: realistic pages are 2-4 MiB. Do not raise the timeout without
a measurement (follow-up below).

## Changes

### `apps/kira-space/internal/ghclient/runner.go`

1. Replace the `maxStdoutBytes`/`maxStderrBytes` const block with a `var` block (tests lower the
   stdout cap; precedent: `gracefulStopDelay` in the same file):
   `maxStdoutBytes = 64 << 20`, `maxStderrBytes = 1 << 20`. Rewrite the comment: the cap is derived
   from the `OpenPulls` worst case (≈450 KiB × 100 items), not "never near this large".
2. Add an unexported `boundedWriter` (~15 lines): `buf bytes.Buffer`, `max int`, `overflow bool`.
   `Write` appends up to `max - buf.Len()` bytes, sets `overflow` when bytes were dropped, and
   **always returns `len(p), nil`**. Returning an error would stop `os/exec`'s copy goroutine, close
   the pipe and kill `gh` with SIGPIPE, which would then report as a failed exit instead of too
   large. `gitclient` has a similar type, but it is unexported in another package and also carries
   stderr-marker logic; do not export it across packages for 15 lines.
3. `Result` gains `StdoutTruncated bool`. Every fake `Runner` in tests keeps compiling (zero value).
4. `execRunner.Run`: set `cmd.Stdout`/`cmd.Stderr` to two `boundedWriter`s. Delete the post-hoc
   slicing. Set `StdoutTruncated` from the stdout writer on both the exit-0 and the `ExitError`
   returns.
5. Fix the `Runner` doc comment ("a JSON body under a few MiB") to name the 64 MiB bound.

### `apps/kira-space/internal/ghclient/errors.go`

1. Add const `reasonUnreadable = "GitHub returned an unreadable response"` and func
   `tooLargeReason()` returning
   `fmt.Sprintf("GitHub's response was over %d MiB, too large to read", maxStdoutBytes>>20)`.
   A func, not a const, so a test that lowers the cap still gets a true message.
2. `classify`: after the `runErr != nil` branch and **before** `res.ExitCode == 0`, add
   `if res.StdoutTruncated { return Status{Kind: KindForbidden, Host: host, Reason: tooLargeReason()} }`.
   Kind stays `forbidden`, the existing catch-all for a GitHub-side answer the app cannot use (5xx
   uses it too). `isRateLimited` does not match it, so D7's breaker is not armed.

### `apps/kira-space/internal/ghclient/api.go`

`get`: no logic change (`classify` already runs first and now catches overflow). Replace the
literal with `reasonUnreadable`. That reason now means only non-JSON from an untruncated body.

### `apps/kira-space/internal/ghclient/graphql.go`

1. `graphql`: restructure the decode so exit-0 stdout that is not a JSON envelope is never OK:
   - run `classify(repo.Host, res, nil, nil)` first when the envelope does not decode. Non-OK
     (including too large) returns as today.
   - if `classify` says OK (exit 0) but the envelope did not decode, return `forbidden` /
     `reasonUnreadable`. This removes the "OK with no data → PullFiles says not found" path.
   - keep the existing `errors[]`-without-data handling unchanged.
2. Replace the two `"GitHub returned an unreadable response"` literals (lines 81, 160) with
   `reasonUnreadable`.

### `apps/kira-space/internal/ghclient/pr.go`

Code unchanged. `OpenPulls`' page-2/3 fail-open already keeps a partial snapshot when a later page
is too large; page 1 too large returns the status. Update the `OpenPulls` doc comment only if it
mentions output size (it does not today). No other caller changes: `gitsession` reads `Status`
through `Kind`/`OK()`/`isRateLimited`, never by matching `Reason` text (checked: no code outside
`ghclient` matches "unreadable response").

### Docs

- `docs/ARCHITECTURE.md`, the "GitHub authentication is delegated entirely to `gh`" paragraph:
  add two sentences. `gh` stdout is capped at 64 MiB while reading, derived from a 100-item
  open-PR page's worst case. Overflow reports `forbidden` with a too-large reason, never
  "unreadable response". D4 (no `--jq`, no `--paginate`) is unchanged; no ARCHITECTURE amendment
  for D4 is needed, since D4 lives in the G24 plan, not in ARCHITECTURE.
- `docs/ARCHITECTURE.md` Known open items: add **"`gh` response sizes are estimated, not measured
  (P169)."** It gives the 2-4 MiB realistic / ≈45 MiB worst-case estimate and the user-run
  measurement below. Delete it once a real measurement confirms the cap and the 10 s timeout.
- `docs/v2.0/SPEC.md` P169 row: no rewording needed; the result section records the decision.

### Frontend-visible change

None. `Status.Kind` keeps its four values; only `Reason` text differs. The commit-detail pane
already shows `Reason` verbatim. No TypeScript type, no Vue file, nothing owned by Parts
19/21/22/23 changes.

## Tests

Per CLAUDE.md: only logic that is genuinely hard. The SPEC row requires the large-PR fixture.

1. **Acceptance, `pr_test.go` (or new `large_test.go`): `TestOpenPulls_LargePage`.** Generate the
   fixture in the test; do not commit a 4+ MiB file. Build 100 `rawPull`-shaped objects, each with
   a ~48 KiB `body`, via `encoding/json`, into `t.TempDir()`. Assert the size is over `4 << 20`.
   Write a fake `gh` script (`writeScript` from `runner_test.go`) that `cat`s it. Build the
   `Client` with the **real** `NewExecRunner()` and
   `NewDiscovery(fakeLocator{found: true, path: script}, okRunner(), &fakeClock{})`, so the real
   pipe/buffer path runs. Two subtests:
   - default cap: `OpenPulls` returns OK and 300 PRs (100 per page × 3 pages, script ignores
     argv), and `PullsForCommit` decodes the same body.
   - cap lowered (`maxStdoutBytes = 1 << 20`, restored in `t.Cleanup`): `OpenPulls` returns
     `forbidden` with `tooLargeReason()`, and the reason is not `reasonUnreadable`.
   This also proves the writer never blocks or SIGPIPEs the child: the script must exit 0.
2. **`graphql_test.go`: `TestPullFiles_TooLargeAndUnreadable`.** Table through `scriptedRunner`
   (fake): `{StdoutTruncated: true, ExitCode: 0}` → too-large reason; `{Stdout: "not json",
   ExitCode: 0}` → `reasonUnreadable`, not "not found". Guards the restructured decode branch,
   which has several interacting outcomes.
3. Update `TestClientGet_UndecodableBodyIsForbidden` (`api_test.go`) to assert
   `reasonUnreadable`. No new test for `boundedWriter` alone: test 1 covers it end to end.

Run `go test ./apps/kira-space/internal/ghclient/... ./apps/kira-space/internal/gitsession/...` and
the repo's pre-commit hook.

## Measurement follow-up (user-run, not blocking)

Cannot run here: no authenticated `gh`, and direct GitHub API calls are blocked from this sandbox.
The user runs, on a machine with `gh auth login` done, against one or two large public repos
(e.g. `kubernetes/kubernetes`, `microsoft/vscode`):

```sh
for p in 1 2 3; do
  gh api --method GET -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "repos/kubernetes/kubernetes/pulls?state=open&sort=updated&direction=desc&per_page=100&page=$p" \
    | wc -c
done
time gh api --method GET "repos/kubernetes/kubernetes/pulls?state=open&per_page=100&page=1" >/dev/null
```

Record bytes per page and wall time in this plan's result section. Then delete the Known open item
if pages are well under 64 MiB and wall time is well under 10 s. If a real page exceeds a few
tens of MiB or nears 10 s, open a named follow-up phase in `SPEC.md` (GraphQL-projected
snapshot), since that is a design change, not a tweak.

## Commits

1. `fix(space): bound gh output while reading, report too-large distinctly (P169)`:
   `runner.go`, `errors.go`, `api.go`, `graphql.go`, tests.
2. `docs: record gh output cap and size estimate (P169)`: `ARCHITECTURE.md`, result section here.

## Result

(Filled in by the implementer.)
