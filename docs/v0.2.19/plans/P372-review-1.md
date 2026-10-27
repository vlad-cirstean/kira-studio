# P372 code review, round 1

Base: `d1975b05b` (main after v0.2.18). Scope: `git diff d1975b05b..HEAD` at `cb76e7792`, phases P365-P371.
One Opus reviewer, three dimensions. Report only; fixer works from this file.

Discovery: CodeGraph MCP failed to connect this session (`codegraph` not on PATH). Grep and Read used instead.

Counts: 0 high, 3 medium, 7 low.

## 1. Architecture, structure, maintainability, security

Shell and argument injection in `gh api` calls: no finding. `writeArgv` (`githost/github/review.go:617`) sends every field as its own `-f key=value` argv element, never `-F`, so an `@`-prefixed or `{owner}` body is never read from a file or substituted. The key is fixed, the path is `url.PathEscape`d (`remote.go:25`), and `number` is an int. `TestReviewArgv` guards it.

Sync removal leftovers: no finding. Grep for `viewedsync|fileReviewSync|viewed_sync|onReviewMarked|SetFilesViewed|PullFiles|review.sync|SetObserver|WithoutSync` hits only the contract version comments, migration names and docs history lines. i18n `space.ade.review.sync.*` is gone.

### F1 (medium). Bounded apt install can leave dpkg interrupted, so the retry round always fails

`scripts/ci-apt-install.sh:18` runs `sudo timeout --kill-after=10 150 apt-get install -y "$@"`. GNU `timeout` signals the whole process group, which includes the `dpkg` child. `.github/workflows/pr.yml` does the same through `scripts/retry.sh 2 180|240 bunx playwright install --with-deps`, which runs `apt-get install` internally.

Failure: on a slow but working runner, the `libwebkitgtk`/`libgtk-4-dev` download finishes near 140 s, and unpack or configure is still running at 150 s. `timeout` kills `dpkg` mid-unpack. Round 2 (and Playwright's later apt step) then fails at once with `E: dpkg was interrupted, you must manually run 'sudo dpkg --configure -a' to correct the problem.` The bound turns a slow success into a hard failure, and the retry cannot recover it.

Fix: bound only the network phase. Run `timeout … apt-get install --download-only -y "$@"` under retry, then run `apt-get install -y "$@"` without `timeout`; the step's `timeout-minutes` bounds it. Or, at minimum, run `sudo dpkg --configure -a` before each retry round in both scripts.

### F2 (low). Step timeouts are shorter than the retry budgets inside them

`.github/workflows/pr.yml` gives every `./.github/actions/setup` step `timeout-minutes: 10`. Inside it, `action.yml` runs `retry.sh 3 300 go mod download`: 3 × 300 s plus 30 s of sleeps is 930 s. `ci-apt-install.sh` can take two rounds of (3 × 45 s update + 30 s sleeps + 150 s install) + 10 s, about 680 s. Both run in the same 10-minute step, before bun install.

Failure: a slow first `go mod download` attempt (300 s) plus a slow apt round consumes the step bound, so attempts 2 and 3 never run. The step fails on its timeout instead of retrying. The rerun workflow covers it, but at the cost of a full rerun the retries were meant to avoid.

Fix: size the per-attempt bounds so the worst case fits under the step bound, for example `go mod download` at 3 × 120 s, or raise the setup step to 15 minutes. State the budget in a comment beside `timeout-minutes`.

### F3 (low). Live docs still point at an applied pending patch; the open item went inline

`docs/PACKAGING.md:382-384` says the P365 rerun rule is "pending `docs/pending-changes/.github__workflows__pr-rerun-flaky.yml.patch`". Commit `21c6d6776` applied it, and `docs/pending-changes/` no longer exists. A reader following the pointer finds nothing.

`docs/ARCHITECTURE.md:1948` ends with "Live GitHub calls are unobserved; the sandbox proxy blocks the GitHub API". That is a real, currently-true limitation. CLAUDE.md puts it in "Known open items", where the removed P150 viewed-sync item lived.

Fix: drop the "pending …" parenthesis from `PACKAGING.md`. Move the unobserved-POST sentence to a `Known open items` entry with a delete condition: "Delete once one approve, one request changes and one conversation comment land on a real PR".

## 2. Functional correctness and business logic

Contract and version consistency: no finding. Go `ContractVersion` (`gitrpc/contract.go:193`) and TS `CONTRACT_VERSION` (`git-ipc/src/validate.ts:201`) are both 54. The three new keys are in `REQUEST_KEY_MAP` and `requestHandlers`. `graphChunkFrame` golden was regenerated. The Go `*ChangeRequestReview` embedded pointer flattens on `ok` and is omitted otherwise, which matches the TS union.

Migration 0050: no finding. `DROP TABLE IF EXISTS ade_viewed_sync` is idempotent. No table references `ade_viewed_sync` (its only FK points outward to `ade_task_branches`). Dropping it drops its own indexes. Version 50 follows 49 in `embed.go:68`.

Estimate UI spec fix (`ade-v2-task-flow.spec.ts:70-71`): sound, no finding. `AdeEstimateField` resets `num` only when `parsed` (from `props.est`) changes. The optimistic `1d` rolls back to the mock's `2d` on refetch, and the new `toHaveValue('2')` waits for exactly that reset. After it, `est` is stable, so a later refetch cannot clobber the next fill.

### F4 (medium). Escalation-timer test fails under load for a timing reason, not a product bug

`apps/kira-space/internal/gitclient/runner_test.go:250-298` (`TestStart_CancellationStopsEscalationTimerAfterCleanExit`) shrinks `gracefulStopDelay` to 100 ms. It then counts every SIGKILL that `killGroup` sees, including one sent before the process exits.

Real cause: after `cancel()`, the SIGKILL escalation timer starts. `reap()` (`runner.go:504-511`) waits for `stderrDone`, then `cmd.Wait()`, and only then calls `stopEscalate()`. Under concurrent UI load, sending SIGTERM to the shell and its `sleep` child, draining stderr and reaping can take longer than 100 ms. The timer then fires correctly, before the exit, and the test reports a stopped-timer bug that does not exist. The test cannot tell "escalated because the process was still alive" from "timer left armed after exit". The second case is the only one it means to catch.

Fix: count only SIGKILLs sent after `Wait` returned. Set an `atomic.Bool` right after `p.Wait()`, and have the `killGroup` fake count SIGKILL only while it is set. Then keep the `3 * gracefulStopDelay` sleep. Optionally raise the delay to 500 ms, so the cancelled path itself rarely escalates.

### F5 (medium). Concurrent board-reads test uses a 100 ms sleep as its barrier

`apps/kira-space/internal/mobileweb/routes_test.go:132-155` (`TestRoutes_ConcurrentBoardReadsShareOneFetch`) starts 5 goroutines, sleeps 100 ms, then closes `reader.gate` and asserts `reader.calls == 1`.

Real cause: `readJSON` (`routes.go:187`) coalesces only callers that reach `s.flight.Do` while the first call is still in flight. Under load, a goroutine may not reach `Do` within 100 ms, for example while still in `guard` cookie or DB checks. If it arrives after `close(gate)` and the first fetch has returned, singleflight runs a second fetch. `calls` is then 2. The product behaves correctly (no in-flight call to join), so the test is wrong.

Fix: replace the sleep with a real barrier. The cleanest option is `testing/synctest` (Go 1.27 in `go.mod`): run the body in `synctest.Test` and call `synctest.Wait()` before `close(reader.gate)`. `do` is in-process (`httptest.NewRecorder`), and singleflight's duplicates block on a `sync.WaitGroup`, which is durably blocking inside a bubble. If synctest does not fit `newTestServer`, add a test hook in `readJSON` counting entrants to `flight.Do`, and close the gate once it reads 5.

### F6 (low). A pinned review is never done, so a merged one stays overdue forever

`apps/kira-space/frontend/src/ade/v2/board/timeline.ts:168` sets `done: !review && isDoneTask(t, graph)`. `isDoneTask` (`timeline.ts:122`) already returns false for a review, since it has no `mine` branch. Either way, a pinned review is never `done`. `buildBand` (`timeline.ts:342`) now counts a non-`auto` entry with `end < 0 && !done` as overdue.

Failure: a review is pinned to Monday, and its branch merges into main on Monday. Nothing archives review tasks on merge (no prune path in `internal/ade`). From Tuesday on, the Monday band shows an overdue note for it. The rollover moves the merged review to today, again every day. Before P368, reviews never counted as overdue.

Fix: give a review its own done rule. Mark it done when every one of its `review` branches has `mergedIntoMain`, for example `isDoneTask` with the kind filter set to `review` for review tasks. Add one row to `ade-v2-timeline.spec.ts`.

### F7 (low). Submit dialog can post against stale facts it shows as fresh

`apps/kira-space/frontend/src/ade/v2/review/AdeReviewSubmitDialog.vue:36-39` falls back to `props.review` until the on-open `refetch()` resolves. `submit()` (`:67`) runs at once and does not re-check `reviewGate` against `live`. The server (`gitrpc/changerequests.go:784`, `gitsession/crreview.go:1062`) does not check state either.

Failure: the cached state is up to 60 s old (`staleTime: 60_000`). If the PR was merged or force-pushed meanwhile, a fast Cmd+Enter submits with the old `headSha`. GitHub then returns a 422 ("commit_id is not part of the pull request" or a merged-PR refusal), shown raw. The comment "The refetch on open gives the head the review applies to" does not hold for that window.

Fix: keep the submit button pending while the first `state.isFetching` is true. Apply `reviewGate(live, mode)` in `canSubmit`, and show the gate reason in place of the textarea hint when it is closed.

### F8 (low). A failed reviewState request hides the review actions with no message

`apps/kira-space/frontend/src/ade/v2/review/AdeReviewActions.vue:56` renders only for `kind === 'ok' | 'unavailable'`. When the query throws, `state.data` stays undefined and the title bar's right group disappears silently. Causes include `ensureRepoOpen` failing, `mapDetailError` from `branchTip` (`crreview.go:1046-1049`), and transport loss.

Failure: the user opens the review window and sees no Review button, with no hint why. The same happens after a transient failure, until a later window focus refetches.

Fix: on `state.isError`, render the disabled Review button with `errorText(state.error.value)` in its tooltip, matching the `unavailable` branch.

### F9 (low). Review and comment POSTs reuse the 10 s read timeout, inviting duplicate posts

`apps/kira-space/internal/githost/github/review.go:650,656` call `c.call`, which applies `apiTimeout` (10 s, `runner.go:22`). `classify` reports a timeout as "gh api did not respond within 10s" (`errors.go:61`).

Failure: GitHub accepts the POST, but the response is slow (common for review creation on large PRs). `gh` is killed at 10 s, and the dialog shows a timeout error, which reads as "not sent". The user clicks Approve or Comment again, and GitHub records a second review or comment. POSTs are not idempotent.

Fix: give writes a longer timeout (for example 30 s, as `graphqlTimeout`). On a write timeout, return a reason saying the request may have been recorded, with "Open PR" to check, rather than the read-path wording.

### F10 (low). Resizable dialog keeps an aborted drag and announces half sizes

`packages/theme/src/components/ui/dialog/DialogContent.vue:157-178` wires `@live` and `@commit` but not `@cancel`. `usePaneResize` emits `cancel` on `pointercancel`, window blur and unmount, to "drop any live preview" (`usePaneResize.ts:36`). The handles also get `size`, `min` and `max` in half sizes (`halfWidth`, `MIN_WIDTH / 2`), so `aria-valuenow`, `aria-valuemin` and `aria-valuemax` (`usePaneResize.ts:123-126`) announce 240 for a 480 px dialog.

Failure: while dragging, Cmd+Tab away; the dialog keeps the half-dragged size, against the handle's contract. A screen reader user hears "240" when the dialog is 480 px wide, and keyboard steps change the width by twice the stated step.

Fix: save the size at drag start and restore it on `@cancel`. For ARIA, either give `ResizeHandle` a `scale` prop (`2` for a centred box) applied in the drag math, or pass the full-size values with the half-delta handled in `paneResizeMath`.

## 3. Performance and resource efficiency

### F11 (low). Every dialog now pays for resize tracking, resizable or not

`packages/theme/src/components/ui/dialog/DialogContent.vue:113-115` calls `useElementSize(currentElement)` (one `ResizeObserver`) and `useWindowSize()` (one window `resize` listener) for every `DialogContent` instance. Only `AdeReviewSubmitDialog` passes `resizable`. The cost per dialog is small. It is still work on every dialog in both apps, plus re-renders of `halfWidth`/`halfHeight` during open animations, for a feature one dialog uses.

Fix: move the measurement and handles into a small child component (`DialogResizeHandles.vue`) rendered under `v-if="resizable"`, passing it the content element. The observers then exist only where resizing does.

No other performance finding. `useChangeRequestReview` costs one `GET pulls/{n}` per stale focus (60 s `staleTime`). `usePlanModel` is a `createSharedComposable`, so per-row `AdeBranchTip` instances share one model. The `laneCollection.set` in each repaint replaces one decoration.

## CLAUDE.md rule check

No finding. Every new or changed `.vue` file is `<script setup lang="ts">`, with no `<style>` block and no `defineComponent`. The review UI uses TanStack Query (`useQuery`, `useMutation`), VueUse (`useTimeoutFn`, `useElementSize`, `useWindowSize`, `useFocus`) and shadcn-vue primitives (Dialog, DropdownMenu, Tooltip, Badge, Alert, Textarea). Comments are short and explain why. Two new Go tests: the argv test guards the `-F` file-read hazard, and the 422 row extends an existing table. The new TS unit cases extend existing timeline and drop-plan specs, which cover interacting placement rules. No needless unit test was added.
