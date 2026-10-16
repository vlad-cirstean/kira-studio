# P261 result

Git graph fixed. Plan: `P261-git-graph-broken.md`. Breaking commit `765a0fc85` (P258).

## What changed

- F1: badge line back above the subject. Decorated rows = compact row + `--kira-graph-h-xs`; plain rows stay 28px. Variable row height, compact/expanded tokens and subject-anchored node restored from `765a0fc85`; P258 look kept (Studio tones, no HEAD band, `kira-*` classes, `data-testid`).
- F2: ref badges shrink (`shrink min-w-0`), label `min-w-0 truncate`; icon, check, `+N` chip, PR badge never shrink. Strip lost `max-w-1/2`. Current-branch ring now `ring-inset` (outer ring clipped by the strip).
- F3: `#rebuildLayout` publishes `plan` with its layout; stale submit publishes nothing. Follow-up: `openStream` awaits the last relayout before `loading` goes idle, else the auto-refresh viewport restore ran against a short plan (`repo-graph-refresh` failed).
- F4 (new, found by the widths spec): author and date resize handles dragged opposite to the pointer (left edge handle, normal direction). Now `direction="reverse"`. Present since the handles existed.
- `RepoEnvRow.vue` `font-semibold` to `font-medium`. `check-theme-classes.sh` semibold/bold/`text-graph-lg` guard covers `apps/kira-space/frontend/src/repo` as well as git-ui.

## Tests

- New UI specs: `repo-graph-badges` (3), `repo-graph-stream-lanes`, `repo-graph-widths` (2). All fail on the P258 tree (verified by rebuilding with `73b1a50e1` git-ui sources: 7 failures incl. updated `repo-graph-columns`).
- `graphView.test.ts`: overlapping relayouts, stale one publishes nothing, `layoutCurrent` stays true. Failed before the fix (plan 5, expected 0).
- Fixture helpers `realisticRows`, `chunkedRows`; `gitStreamReleaseNext` releases held chunks one by one.
- `repo-graph-columns` and its font-size test follow the badge line.

## Verified

- `bun test packages/git-ui/src`: 236 pass.
- UI `repo-graph` + `repo-commit-meta`: 44 pass.
- Visual `git-module`: 7 pass. Re-recorded `git-graph`, `git-graph-detail` (one row with 5 long refs) and `git-stash-dialog` (graph shows through the dialog's rounded corners).
- Real stack (`-tags server` binary, WebKit, 1280x760 and 1100x800): generated repo with 6 long branches, tags, remotes, plus a shared clone of this repo. Every rendered row had its lane circle at every 250 ms sample, including after reload and server relaunch. Badges whole, inside the cell, strip above subject, no overlap, no horizontal overflow, after detail open, handle drags, 1100px. Shots: `P261-shots/after-real-*.png`.

## Not done

- Real repos in the recheck held at most 3 refs per row, so `+N` was not seen live; the mocked 6-ref spec covers it.
- The 5.3k-commit stream stayed on its first page in the recheck (`Load the last N`); streaming lanes are covered by the mocked 6-chunk spec only.
- After reload the Space graph host shows the first imported repo, not the last opened (out of scope, noted in the plan).
