# P337 code review round 2: findings

Base: `0890584a8` (v0.2.10 squash, same base as round 1). Head: `da84f174e`. Scope:
`git diff 0890584a8..da84f174e`, code only (no `docs/v0.2.12/`, no `*.md`). Covers P330-P335 plus
the round-1 fixer commits `122fa942c..b134eab66`, reviewed as new code.

Round 1 (`26b60ee6b`) items M1-M3 and L1-L6 are fixed. Each fix was checked against its finding:

- M1: `reconcile` and `reconcilePending` now refresh `updated_at` once a day.
- M2: `publish` now emits on an engine switch. A switch to an unreachable engine leaves no stale banner, because `RestoreBanner` sits under `DockerPanel`'s `v-if="ok"` and refetches on mount.
- L1: the dialog now renders `callError`.
- L2: `dropFallbackClient` now runs after 3 failed ticks.
- L3: a dependent now fails when its dependency failed to start.
- L4: the query uses `gcTime: 0`. The desktop `createQueryClient` defaults already set `staleTime: Infinity` and `refetchOnWindowFocus: false`.
- L5: each cgo entry point has its own `@autoreleasepool`. ARC is on (`-fobjc-arc`).
- L6: the concurrency group is keyed by PR.

The M3 fix holds for the case it names. The new M1 below is a related gap it leaves open.

Ranked by severity. No High finding.

## Medium

### M1. Turning a type on keeps a stale saved handler, so turning it off restores the wrong app

- `apps/kira-space/internal/filehandlers/filehandlers.go:184-192` (`turnOn`) writes the previous
  handler only when the extension has no saved row (`!saved`).
- `apps/kira-space/internal/filehandlers/filehandlers.go:227-237` (`turnOff`) takes the first saved
  row among the extension and its type siblings, the extension's own row first.

Failure, single extension:

1. Turn `py` on. The saved row is Editor.
2. In Finder, set `.py` to app X. The row is now stale, and the pane shows "other: X".
3. Turn `py` on again. The current handler X is not self, but the row exists, so it is not overwritten.
4. Turn `py` off. The service restores Editor, not X.

Failure, shared type (left open by the round-1 M3 fix):

1. A stale `yaml` row holds Editor.
2. Finder sets `public.yaml` to X.
3. Turn `yml` on. The service saves `yml` = X.
4. Turn `yaml` off. Its own stale row wins, so the service restores Editor.

Both cases report success, and nothing tells the user which app came back.

Fix: in `turnOn`, when the current handler is not self, it is by definition the app being replaced.
Save it unconditionally (`Put` overwrites). Also overwrite or delete the rows of every extension
sharing the UTI, through `sharing`. Keying the table by UTI removes the sibling case entirely, since
LaunchServices keys by UTI.

## Low

### L1. Turning a group off resolves the whole vocabulary once per extension

`apps/kira-space/internal/filehandlers/filehandlers.go:202-213` (`sharing`) calls
`Registry.Resolve` for every entry of `filetypes.All()`. `turnOff` calls it once per extension
(`:227`).

Failure: `FileTypesPane.vue` `toggleGroup` sends a whole group. Turning the code group off then makes
about 40 x 55 `kira_resolve` cgo calls. Each one builds a `UTType` from LaunchServices, on top of the
per-extension `Previous.Get` calls. That is a few thousand LaunchServices lookups for one switch
flip, and the Settings dialog waits on all of them.

Fix: resolve the vocabulary's UTIs once per `Set` call (`map[ext]uti`) and pass it to `turnOff`.
Alternatively, group the requested extensions by UTI first.

## Dimensions with nothing further

- Architecture/security: nothing new. The round-1 fixes add no new bound surface.
  `dropFallbackClient` only drops a client resolved from the default or probe source. A selected,
  env or context endpoint stays as the user chose it. `RestoreDialog` shows only the IPC error
  message. The staged `release-on-merge.yml` group key only reads event fields; no
  untrusted text reaches a shell.
- Correctness: nothing further beyond M1. Rechecked the following and found nothing real:
  - P335 `selectionText`: `SlickRange` normalises its corners, so `range` columns are never negative.
  - P332 `openedfiles`: coalescer generations; `Pending`/`Forget` hand-off; `Resolve` with symlinks and the longest repo root.
  - P333 `reviewResponse`.
  - P334 `waitDependencies` with the `failed` set.
  - `publish` dedupe with `lastEngine`.
  - The pre-push hook reading refs once and replaying them through a heredoc.
- Performance: nothing beyond L1. The daily `updated_at` touch adds one snapshot save per engine
  per day. `dropFallbackClient` runs at most once per 3 failed ticks.
