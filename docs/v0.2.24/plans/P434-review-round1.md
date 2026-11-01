# P434 code review, round 1

Base: `f8865886e` (v0.2.23 squash merge on `main`). No review commit exists after it:
`git log f8865886e..HEAD` has no review findings or fix commits. Head: `f13b3c8bb`.
Scope: full diff base..HEAD, P423-P433, 410 files. Fixer and lint-refactor commits count as
unreviewed code.

Dimensions: (1) architecture, structure, maintainability, security; (2) functional correctness;
(3) performance and resource use.

## Findings

### R1-F1 (medium) Kibana response body read unbounded

- File: `apps/kira-studio/internal/adapters/kibana/client.go:189`
- Defect: `io.ReadAll(resp.Body)` has no limit. Every Kibana call (search, discover, suggest,
  data view) goes through it.
- Failure: a 10000-hit discover over large documents, or a misbehaving proxy, returns hundreds of
  MiB. Whole body sits in memory, then decodes into hits, then into rows. Peak memory is about 3x
  body size before any console cap applies. A large enough reply OOMs the adapter host.
- Fix: wrap the body in `io.LimitReader(resp.Body, max+1)`. Pick `max` from the adapter host frame
  budget. On overflow, return a clear "response too large, lower sample size" error. Do not
  truncate silently.

### R1-F2 (medium) Filter value suggestions shared across connections and data views

- File: `apps/kira-studio/frontend/src/views/console/kibana/FilterEditor.vue:58`
- Defect: `queryKey: ['kibana', 'filterValues', field.value]` names only the field. Connection,
  data view, time range and other filters are not in the key.
- Failure: tab A on cluster X opens a filter on `host.name`. Tab B on cluster Y does the same
  within 30s. Tab B shows cluster X's values as fresh, with no refetch. After 30s it still shows
  them first, then swaps them. Values from one connection appear in another connection's UI.
- Fix: key on connection id, data view id and scope, the same way `kqlCompletion.ts:166-175` does.
  Expose those from `useDiscover` and pass them to `FilterEditor`, or let `suggestValues` own the
  query key.

### R1-F3 (low) Data view query kept forever with no removal

- File: `apps/kira-studio/frontend/src/views/console/kibana/useDiscover.ts:56-63`
- Defect: `gcTime: KEEP_WHILE_OPEN` on `['kibana', 'dataView', connectionId, id]`. No
  `removeQueries` anywhere targets that key. That breaks the `queryClient.ts` rule that every
  `KEEP_WHILE_OPEN` use names its removal.
- Failure: a connection edit (for example a new Kibana space, URL or credentials) keeps the old
  field list for 5 minutes (`staleTime`). It stays cached for the app's lifetime after the
  connection is deleted. Each data view opened adds one entry that never leaves.
- Fix: remove `['kibana', 'dataView', connectionId]` when the connection disconnects, is edited
  or is deleted. If no such hook fits, drop `gcTime` back to the default.

### R1-F4 (low) Hotkey change drops the working chord when the new one fails

- File: `internal/shell/hotkey.go:62-86`
- Defect: `Apply` unregisters `b.current` before `Register(accel)`. When `Register` fails (chord
  taken by the OS or another app), no chord stays registered.
- Failure: the user has a working capture hotkey and tries a chord another app owns. The new chord
  fails and the old one is gone too. Capture is unreachable until the user picks a free chord.
  Settings shows only the failure for the new chord.
- Fix: when `enabled` and `accel == b.current`, return the current state. Otherwise register
  `accel` first, then unregister the old chord. On failure keep `b.current` registered, and report
  failed for `accel` with the old chord still active.

### R1-F5 (low) Shared KQL value fetch cancelled by its first caller's signal

- File: `apps/kira-studio/frontend/src/views/console/kibana/kqlCompletion.ts:155-193`
- Defect: `fetchQuery` dedupes concurrent calls with the same key into one `queryFn` run. That run
  wires the first caller's `signal` to `opsCancel(opId)`. A later caller that joined the same
  in-flight fetch shares that cancel. Also `addEventListener` runs without checking
  `signal.aborted` first, so an already-aborted signal never cancels the op.
- Failure: completion is requested twice for the same cursor context (retrigger, second editor on
  same scope). The first request aborts and cancels the backend op. The second caller gets the
  cancel error and shows no value hints.
- Fix: use the `signal` TanStack passes to `queryFn` for `opsCancel`; it aborts only when every
  consumer is gone. Keep each caller's own signal for discarding its own result. Check
  `signal.aborted` before adding the listener.

### R1-F6 (low) Hex-looking branch or tag name treated as an immutable commit

- Files: `apps/kira-space/frontend/src/views/repo/RepoFileView.vue:27,103`,
  `apps/kira-space/frontend/src/views/repo/useDiffEditor.ts:62,130`
- Defect: `COMMIT_ID = /^[0-9a-f]{7,64}$/i` decides "this rev never changes, reuse the cached
  model". A branch or tag spelled in hex (`deadbeef`, `cafe123`, `1234567`) matches.
- Failure: user opens a file at branch `cafe123`, the branch moves, the user reopens it. The view
  shows the old content from the cached model with no read.
- Fix: decide immutability from what the backend resolved, not from the spelling. Return the
  resolved commit oid with the read and reuse the model only when the tab's rev is that full oid.
  Or record in tab state that the rev came from a commit pick.

### R1-F7 (low) Kibana `Read` has no result byte cap

- File: `apps/kira-studio/internal/adapters/kibana/search.go:420`
- Defect: `pushHits(hits, ..., page.ResultCap{})` passes an empty cap. Page size goes up to 10000,
  so one page of wide documents has no byte bound before it crosses the bridge. Console runs use
  `adapters.DefaultConsoleCap` (10000 rows, 56 MiB); this path has neither bound.
- Failure: a page of 10000 large documents builds one oversized result frame. With R1-F1 this
  stacks: unbounded body, then unbounded row set.
- Fix: pass `adapters.DefaultConsoleCap` (or a page-read cap with a byte bound) and surface
  truncation the way the console path does.

### R1-F8 (low) Staged attachment TTL not enforced on post or stale-window reopen

- Files: `apps/kira-space/internal/bridge/hostviewcompose.go:144-151,195-212`,
  `apps/kira-space/internal/bridge/hostview.go:273`
- Defect: `sweep` runs only inside `Put`. `Take` never checks age, so a staged file past
  `stagedAttachmentTTL` (30 min) still posts. `openTarget`'s stale-window path calls
  `s.Targets.Forget(key)` but not `Attachments.Forget(key)`, so a window that died without a
  close event keeps up to 25 MiB staged until process exit.
- Failure: user stages a file, leaves for an hour, posts. The file the TTL should have dropped is
  uploaded. Separately, a crashed host view window leaks its staged bytes.
- Fix: call `st.sweep(now)` in `Take` (pass `now` in) and treat an expired id as missing. Call
  `s.Attachments.Forget(key)` beside `s.Targets.Forget(key)` in `openTarget`.

## Checked and clean

- Azure DevOps: token from `az account get-access-token` validated non-empty with no whitespace;
  upload sends only to `https://dev.azure.com/<escaped org>`, refuses redirects, bounds the reply
  at 64 KiB, checks the returned link, cleans up with `WithoutCancel`. Comment and remote parsing
  clean.
- Jira comments: body through a 0600 temp file removed by `defer`; attachments off for Jira.
- Host view compose: staging limits (5 files, 10 MiB each, 25 MiB total), extension allowlist,
  content sniffing, single-post guard via `beginPost`/`endPost`. Window close forgets targets and
  attachments (`main.go:172`).
- Host view Markdown (`hostview/markdown.ts`, `MarkdownBody.vue`): inline HTML dropped, block HTML
  escaped, links limited to http(s)/mailto/#, images rendered as links, clicks open only
  http(s) externally. No XSS path found.
- Quick capture: classify reads cache only; popup guards `confirm.isPending`, blocks drop
  navigation, disposes its listener. `captureTrigger` calls shell functions under `s.mu`; no
  deadlock found, since none of them call back into the capture service.
- Kibana: KQL compiler escapes query-string text and regex; interval buckets capped at 100;
  discover and histogram share one request. Histogram queries removed per run and on tab close.
- Monaco (P433): `addAction` disposables tracked and disposed on unmount; async completion
  `AbortController` disposed in `finally`.
- Content gate (P433 `1d7fdd569`): size plus SHA-256 of read bytes; HEAD side gated on blob oid
  via `--batch-check`, newline paths go one-shot.
- Proof charts: tooltip strings escaped with `format.encodeHTML`; strict payload validation with
  byte and count limits.
- Stage settings (harness, adeflow parse, UI): validated and bounded.
- Rule checks: every new `.vue` file is `<script setup lang="ts">`. The one new scoped `<style>`
  (`QueryBar.vue`) overrides Monaco internals through `:deep`, same as `MonacoHost.vue` and
  `ResponseDiffDialog.vue`; Tailwind classes cannot reach that DOM. New unit tests (KQL context,
  ADF and Markdown-to-ADF conversion, PR mapping, detail normalize with sort, cap and
  URL scheme rules) guard parsers or multi-rule logic; none found below the bar.
