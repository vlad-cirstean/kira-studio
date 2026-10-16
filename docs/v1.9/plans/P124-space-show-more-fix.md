# P124 — Kira Space commit-details "Show more" no-op

One bug, one root cause. Plan and fix land in the same pass.

## Reproduction

Harness: `apps/kira-space/tests/ui/` (Playwright, WebKit, `installGitStreamMock`), driving the real
built frontend. No GUI in this container, so the real Go server's own `commit.detail` output was
captured over a real socket (`gitsock` integration fixture, `buildDetailFixtureRepo`) and replayed
verbatim through the UI mock.

Steps:

1. Open a repo workspace; select an ordinary commit — not a branch tip, not tagged.
2. Click "Show more" (mouse), or focus it and press Enter.
3. Observed: label stays "Show more", `.kv-meta-expanded` never mounts. Console:
   `TypeError: null is not an object (evaluating 't.detail?.decoration.length')`.

Variations tried, none of which reproduce with a hand-written `decoration: []` fixture (what every
existing spec uses): empty vs. 40-line vs. short body; 1 vs. 50 changed files; viewports
1440x960, 1280x720, 1024x600, 900x480; mouse, Enter, Space. All 24 expand correctly. So the
toggle, `expanded` ref, layout caps and click path are all sound.

The discriminating variable is the payload: real server JSON carries `"decoration": null` on any
commit with no ref pointing at it. Commits carrying a ref (HEAD, branch tip, tag) get a real
array and expand fine. That is why the bug looks intermittent, and why P74's harness (and this
app's own UI specs) never caught it.

Same payload replay, second symptom: a root commit's `"parents": null` throws
`r.parents.map` in `FileTree.vue:358`, so its file tree never renders. `"trailers": null` is
harmless (`trailerRows` already guards with `?? []`).

## Root cause

Wire contract `@kira/git-ipc` `CommitDetail` (`packages/git-core/src/model/commit.ts:30-83`)
declares `parents`, `trailers`, `decoration` as non-null arrays. Go server violates it:

- `porcelain.parseDecoration` returns `nil, nil` for an empty `%D`
  (`apps/kira-space/internal/gitclient/porcelain/log.go:234-237`).
- `parseParents` returns `nil` for a root commit (`log.go:219-225`).
- `ParseTrailerBlock` starts from `var out []CommitTrailer` (`show.go:65-66`).
- `RepoEntry.CommitDetail` copies all three straight into the wire struct
  (`apps/kira-space/internal/gitsession/queries.go:260-267`, pre-fix), and `encoding/json` marshals
  a nil slice as `null`.

Client side, `CommitMeta.vue`'s `hasDetails` computed reads `props.detail?.decoration.length`
(`packages/git-ui/src/components/CommitMeta.vue:210`) — `?.` guards `detail`, not `decoration`.
It is only evaluated inside `v-if="expanded"` (`:368`, then `v-if="hasDetails"` at `:389`), so the
collapsed view renders fine. Clicking flips `expanded`; the re-render throws; Vue aborts the patch.
Nothing observable changes except the console error.

Go-side tests decode into Go slices, where `null` and `[]` are indistinguishable — why no existing
test caught it.

## Fix

Server, at the one place the wire struct is built: `queries.go:263-266` wraps `Parents`,
`Trailers`, `Decoration` in `nonNil`. Fixing at the source covers both hosts (desktop app and VS
Code extension share this server) and both symptoms. Client stays as-is — its types already
promise non-null arrays; a defensive `?? []` there would paper over a contract violation.

`nonNil[T any]` (`incremental.go:96-103`) replaces the two per-type copies already in the package
(`nonNilRanges`, `nonNilUpdates`), same behavior, three call sites plus the new three.

## Regression test

Added: raw-JSON assertion in existing `TestIntegration_CommitDetailAndFileTree`
(`apps/kira-space/internal/gitsock/detail_test.go:248-256`). Root commit from the existing fixture
(no ref, no trailer) must carry `parents`/`trailers`/`decoration` as `[]`. Cheap (existing test and
fixture, one extra request) and the only layer able to catch it — a struct decode can't see the
difference, and a UI mock only ever sees what its fixture author typed. Confirmed failing without
the fix (`root commit parents = null, want []`), passing with it.

No UI spec: the fix is server-side, and a mocked payload can't exercise it.

## Verification

Replayed the real server's post-fix payloads (ordinary commit, root commit) through the same UI
steps: mouse and Enter both flip to "Show less", `.kv-meta-expanded` mounts, file tree renders, no
console errors. Pre-fix payloads: the TypeError above on every run.
