# P227 code review findings

Base: `7f626e91a` (last review close-out). Scope: `git diff 7f626e91a..HEAD` at `9c5c216dc` — P218 (reverted) to
P226. Reviewer: one Opus round, all three dimensions. Fixer: one Sonnet pass, commit per group. Delete
this file once every finding is fixed.

Count: 3 Medium, 9 Low. No High.

Areas checked with nothing real found: P223 peer, Host (DNS-rebinding) and Origin/CSRF guards; cookie
attributes (no `Secure` is the accepted plain-HTTP trade-off, warned in the pane); legacy CA removal;
migrations 0023/0024/0025 (Space) and 0033 (Studio); `MoveItem` subtree move and reindex; quick-command
repo/service; P224 removal (no leftover `stt`/dictation/whisper/malgo code, bindings, channels, build
steps or docs; `modelstore.RemoveRetired` also covers `.part` files); P225 lane/run-lane rendering;
`colorMarkClass` adoption; `<script setup lang="ts">` on every touched component; no new scoped
`<style>` blocks; no new dependency (only removals: `vite-plugin-pwa`, `workbox-window`,
`@vite-pwa/assets-generator`, malgo). Performance: supervisor poll (10s, /proc reads plus two small DB
reads), quick-command grouping (O(collections × commands), tiny) and graph auto-width rebuilds (only on
lane-count growth) are all fine.

## Medium

### M1. Device expiry not enforced on open streams (security, P223)

- `apps/kira-space/internal/mobileweb/events.go:186` (`handleEvents`), `apps/kira-space/internal/mobileweb/writes.go:273`
  (`handleTerminal` authorized callback), `apps/kira-space/internal/mobileterm/serve.go:62`.
- Expiry is checked only in `authenticate`, at request start. The SSE loop runs until the client leaves.
  The terminal `authorized` callback runs once, after `Attach`, and checks revoke and permissions, not
  `ExpiresAt`.
- Failure: P223's threat model says a token sniffed over plain HTTP is bounded by the 30-day expiry. An
  attacker who copies the cookie on day 29 opens `/api/agent/sessions/{id}/terminal` and `/api/events`
  and keeps both open indefinitely. Same for the real phone: a terminal attached before expiry keeps
  agent input after it.
- Fix:
  1. `handleEvents`: pass the device row (route already has it), add
     `expiry := time.NewTimer(time.UnixMilli(d.ExpiresAt).Sub(s.cfg.Now()))`, `defer expiry.Stop()`, and a
     `case <-expiry.C: return` in the select.
  2. `handleTerminal`: add `&& row.ExpiresAt > s.cfg.Now().UnixMilli()` to the `authorized` closure.
  3. `Server.maintain`: on each one-minute sweep, list devices (or keep an in-memory id-to-expiry map filled
     by `withDevice`) and, for each one past `ExpiresAt`, call `s.cfg.Hub.DisconnectDevice(id)` and
     `s.cfg.Terminals.ReleaseDevice(id)`. That ends a terminal already attached, which step 2 alone does
     not. Step 1 becomes optional once step 3 exists; keep it anyway, it is exact to the millisecond.
  4. Extend `mobileweb` integration coverage with one case: an attached stream with `ExpiresAt` set in the
     past via the test clock closes after the sweep (concurrency/teardown, meets the test bar).

### M2. Worktree colour differs between the Git panel rail and its tabs (functional, P222/P226)

- `apps/kira-space/frontend/src/repo/GitPanel.vue:499` paints a worktree row with the anchor's
  `repo.color`.
- `apps/kira-space/frontend/src/state/tabKinds.ts:84` (`repoRailColor`) paints a repo tab with
  `colorOf(tab.workspaceId)`. A linked worktree's workspace id is its own `code_repos` row
  (`codeworkspace/import.go:68`), which `CodeReposRepo.Create` gives an auto colour from its own sort
  position (`palette.AutoRepoColor`), not the anchor's.
- Failure: import repo A (blue), click its linked worktree W. W's row in the Git panel shows a blue rail.
  W's graph, file and diff tabs show W's own auto colour, e.g. amber. The colour submenu exists only on
  anchor rows, so W's colour cannot be changed to match. P226's ask was "the same colour renders the same
  way everywhere".
- Fix: one resolver for a repo's display colour that follows the worktree anchor. Add
  `repoColorOf(id)` to `apps/kira-space/frontend/src/repo/state/repoLinks.ts` (it already depends on
  `useCodeReposStore`, so no import cycle):
  `codeReposStore.colorOf(worktreeParentId(id) || id)`. Use it in `tabKinds.ts` `repoRailColor`, in
  `GitPanel.vue` for both rails, and in every ADE `codeRepos.colorOf(...)` caller (`AdeRepoTag.vue`,
  `AdeRepoChip.vue`, `AdeBranchRow.vue`, `AdeTaskTab.vue`, `AdeAddPopover.vue`, `AdeCandidateRow.vue`)
  where the id can be a worktree's. Extend `tests/ui/color-rails.spec.ts` with a worktree tab rail
  matching the anchor's row rail.

### M3. Visual baselines red: 12 Studio, 4 Space (test infrastructure)

Ran both suites in this container at `9c5c216dc`.

- `bun run test:visual:studio`: 12 fail, 1 pass (`quick-commands-dialog`, re-recorded in P219). Expected
  PNGs render text in the DejaVu fallback font and the module switcher lacks Docker. Actual renders Inter
  and shows Docker. Diffs are 0.01 to 0.03 of pixels, text and module-bar only; no layout regression seen
  in the diff images. Stale, not a product bug. Re-record:
  - `apps/kira-studio/tests/visual/connection-dialog.spec.ts-snapshots/connection-dialog-visual-linux.png`
  - `apps/kira-studio/tests/visual/console.spec.ts-snapshots/console-visual-linux.png`
  - `apps/kira-studio/tests/visual/data-view.spec.ts-snapshots/data-grid-visual-linux.png`
  - `apps/kira-studio/tests/visual/http-request-view.spec.ts-snapshots/http-request-view-at-rest-visual-linux.png`
  - `apps/kira-studio/tests/visual/schema-dialog.spec.ts-snapshots/schema-dialog-visual-linux.png`
  - `apps/kira-studio/tests/visual/settings.spec.ts-snapshots/settings-{appearance,data,cache,api,database-mcp,advanced}-visual-linux.png`
  - `apps/kira-studio/tests/visual/workbench.spec.ts-snapshots/workbench-shell-visual-linux.png`
- `bun run test:visual:space`: all 4 fail. The Settings nav gained `Memory` (P221) and text renders in
  Inter, same as above. Re-record:
  `apps/kira-space/tests/visual/settings.spec.ts-snapshots/settings-{appearance,git,connected-editors,advanced}-visual-linux.png`.
- Fix: run `bun run test:visual:update:studio` and `bun run test:visual:update:space` in this container
  (the P219 baseline from this container passes, so it matches the reference). Open each new PNG and
  confirm Inter text, the Docker module (Studio) and the Memory nav entry (Space) before committing.
  Then run both suites once more; both must be green. `apps/kira-studio/tests/visual/README.md` says
  baselines come only from the CI `ui` job image; if this container's WebKitGTK differs from CI, say so
  in the commit body and regenerate on CI too.
- Also add `'Memory'` to `sections` in `apps/kira-space/tests/visual/settings.spec.ts:6`: its header
  says one baseline per pane, and P221 added the Memory pane without one (`Mobile access` stays out: it
  shows the live network). Record its baseline in the same run.

## Low

### L1. `lannet.Find` reports a missing ARP entry as a different router

- `apps/kira-space/internal/lannet/lannet.go:109`.
- `!ok` (router not in the ARP table) and a MAC mismatch both return `ErrOtherRouter`. `Detect` already
  separates these (`ErrNoRouterMAC`).
- Failure: the router's ARP entry ages out (macOS deletes entries after about 20 minutes without traffic,
  e.g. a VPN routing everything via a different next hop). The server stops and the pane says "the router
  on 192.168.1.0/24 is not the trusted one", which is false and alarming.
- Fix: `if !ok { return Network{}, ErrNoRouterMAC }` before the MAC compare; in `bridge/mobilenet.go`
  `evaluate`, map `ErrNoRouterMAC` to `mobileStopUnavailable` with `ErrNoRouterMAC.Error()` as detail.

### L2. A failed start logs a warning every 10 seconds forever

- `apps/kira-space/internal/bridge/mobilenet.go:153`.
- When the trusted network matches but `Start` fails (port in use), every `reconcile` retries and logs
  `mobile access: start`.
- Failure: the port stays taken for a day; the log gains 8,640 identical warnings.
- Fix: keep the last start error text in `mobileSupervisor` (under `stateMu`); log only when it changes,
  and clear it on a successful start or on stop. Keep retrying each poll.

### L3. Two environment drafts saved close together drop one

- `apps/kira-space/frontend/src/repo/RepoConfigForm.vue:122` (`saveDraft`), comment at `:88`.
- `saveDraft` sends `[...props.repo.environments, new]`. A second draft committed while the first write is
  in flight builds from the old list. The comment says Add and Remove wait for the write in flight; no
  code does.
- Failure: add two environments, fill the second and blur within one round trip of the first; the first
  is overwritten and lost.
- Fix: serialise environment writes. Keep a `let envWrite: Promise<void> = Promise.resolve()` chain in the
  component; `writeEnvs` appends to it and builds the list from `props.repo.environments` inside the
  chained step (read at run time, after the previous write updated the query cache). Remove the false
  sentence from the comment if any path still does not wait.

### L4. Git panel colour change swallows failures

- `apps/kira-space/frontend/src/repo/GitPanel.vue:195`.
- `run: () => void codeReposStore.setCodeRepoColor(...)` discards the rejection: no message, an unhandled
  promise rejection in the console.
- Fix: drop `void` and return the promise (`run: () => codeReposStore.setCodeRepoColor(repo.id, color)`),
  the way the same menu's Rename and Remove items return theirs, so the context-menu runner treats a
  rejection the same as theirs.

### L5. Paired-phone list does not react to expiry

- `apps/kira-space/frontend/src/workbench/settings/MobileAccessPane.vue:115` and `:30`.
- `activeDevices` and `expiresIn` read `Date.now()`, which is not reactive.
- Failure: with the pane open, a phone passes its expiry and stays listed as active with "in 0 hours".
- Fix: `const now = useNow({ interval: 60_000 })` from VueUse; use `now.value.getTime()` in both.

### L6. `CommitGrid.vue`: `handleChunkLayout`'s doc comment sits on `graphSeedWidth`

- `packages/git-ui/src/components/CommitGrid.vue:653` to `:683`.
- P225 inserted `graphSeedWidth` and `growGraphColumn` between the comment and `handleChunkLayout`. The
  comment now documents the wrong function.
- Fix: move `graphSeedWidth` and `growGraphColumn` above the comment block so it directly precedes
  `handleChunkLayout` again.

### L7. Edge `kind` is dead data in production after P225

- `packages/git-ui/src/graph/layoutStore.ts:99`, `packages/git-core/src/graph/types.ts` (`EDGE_KIND`,
  `EdgeKind`), `packages/git-core/src/graph/edges.ts:133,136`, `lanes.ts` (kind classification).
- `rowSvg.edgeCommand` now draws from `fromLane`/`runLane`/`toLane` only. No production code reads
  `EdgeSegment.kind`; only `lanes.test.ts`/`layoutStore.test.ts` do. Every edge still carries and
  patches the word.
- Fix: drop the kind field. `EDGE_STRIDE` back to 6 (run lane takes the freed slot), remove the patch
  kind slot (`PATCH_STRIDE` 4 to 3), `EdgeKind`/`EDGE_KIND_*` exports and their classification in
  `lanes.ts`. Rewrite the test assertions on kind as assertions on the three lanes (`runLane === toLane`
  for branch-out, `fromLane === runLane !== toLane` for converge). If the fixer finds a real reader this
  review missed, keep the field and say so in the commit body.

### L8. Two new tests below the CLAUDE.md unit-test bar

- `apps/kira-space/internal/lannet/lannet_linux_test.go:30` `TestParseDefaultRouteNone`: one bad input,
  one error. Delete it.
- `apps/kira-space/internal/mobileweb/auth_test.go:50` `TestAuth_ExpiredDeviceIsRefusedAndCleared`:
  single bad input to single error, beside an existing verdict table. Fold it into `TestAuth_Verdicts`
  (`:11`) as one row (expired device: 401, `E_EXPIRED`, cookie cleared) and delete the standalone test.

### L9. Stale chapter docs

- `docs/v2.2/SPEC.md:23`: P225 row says `Not started`; its result section is committed. Set `Done`.
- `docs/v2.2/plans/P225-plan.md`: still present. `docs/v2.2/README.md` says plans are deleted once folded;
  P219 to P224 and P226 were. Delete it.
- `docs/v2.2/README.md:4`: "a read-only mobile PWA". P223 removed the PWA and phones can write. Reword to
  "a mobile web view of the agents module, served over plain HTTP on the trusted LAN".
