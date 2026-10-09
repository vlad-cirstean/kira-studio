# P234 plan: docs refresh for v2.2

Base: `v2.0` at `ef44a0756`. Branch `v22-fix-P234`, worktree `/home/user/kira-v22-B`.
User ask: "update the main docs to reflect the latest changes". SPEC row: `docs/ARCHITECTURE.md`
(Parallelism, process wiring with `appwire`, stale git-pairing-real line, Testing),
`docs/DEV_ENVIRONMENT.md`, v2.2 README, root `README.md`, to match P210-P233.

Single sequential Sonnet implementer. Docs only: no code, test or script file changes.

## 1. Audit result

Method: every v2.2 result section read; each durable fact checked against code (CodeGraph, `ls`,
`grep`), not result prose. Line numbers are base-commit positions; re-find by the quoted text.

Already current, no edit (verified): P210 and P211 (Stack rows, Memory section, DEV_ENV Memory
section), P212/P223 mobile transport and `lannet`, P213 Styling row, P214 Add memory free text, P219
collections (schema, Terminal module, API collections), P220 `kira.git.panelTab`, P221 Settings >
Memory, P222 per-repo colour and environments, P224 STT removal note and `RemoveRetired`, P225/P228
lane floor, `columnFit.ts`, `EDGE_RUN_LANE`, P226 `colorMarkClass` (Styling row), P229 git look,
P230 ADE Git facts (`GitStatus().Path`, `no remote`, worktree `FETCH_HEAD`), P231 Space flow and
e2e-real tiers, P233 hook shim gate (`KIRA_AGENT_HOOK_TOKEN`, `claudeflow`).

Stale or missing, per file:

| File | Items |
|---|---|
| `docs/ARCHITECTURE.md` | 26 |
| `docs/DEV_ENVIRONMENT.md` | 6 |
| `README.md` (root) | 7 |
| `apps/kira-space/README.md` | 7 |
| `docs/v2.2/README.md` | 1 |
| `CLAUDE.md` | 2 |
| `docs/v2.2/SPEC.md` | 5 (P234 row and result, 3 condense groups) |

`docs/PACKAGING.md`: P223/P224 text already current; no edit.

## 2. Concurrency with P232

P232 Stream B, then the P232 fixer, edit `docs/ARCHITECTURE.md` Testing, `docs/DEV_ENVIRONMENT.md`
flow-suite text and SPEC P232 sections after this phase.

- This phase documents P232 Commit 0 only: Studio `internal/appwire`, `internal/flowtest`,
  `apps/kira-studio/internal/flowharness` (servers, Docker helpers, shell fakes,
  `cmd/flowservers`), empty flow packages, Studio e2e-real `flowServers` fixture, `serverEnv`,
  `api-boot-real.spec.ts`, `test:flows:studio[:complete]`.
- P232 test contents, findings and fixes are written by the P232 fixer, at the end. No placeholder
  text: the new Studio paragraphs name the five flow packages by purpose (their `doc.go`), with no
  test counts, so the fixer appends rather than rewrites.
- Never touch the SPEC P232 row, any P232 result section, `docs/v2.2/plans/P232-*`.
- Keep every edit section-local. Do not reflow or rewrap untouched lines. New Studio flow text goes
  in new paragraphs/sections at the anchors in A17-A19 and D2, so a later P232 append lands beside
  them, not inside them.

## 3. Edit list

Style: `CLAUDE.md` terse rules for every file except root `README.md` (normal prose).
`apps/kira-space/README.md` is an outward README too: normal prose, like the root one.

### 3.1 `docs/ARCHITECTURE.md`

Process wiring (composition roots):

- **A1. Process model, new paragraph "Composition roots (P231, P232)"**, right before "**The Go side
  is `apps/kira-studio/`.**" (~2503). Facts: each app's `internal/appwire` has `Options` (OS seams
  `main.go` owns: DB, repos, emitter, dialogs, keep-awake driver; Studio adds cipher, authorizer,
  MCP installer; Space adds browser, git `Locator`, mobile assets and LAN seams, `GhLocator`,
  `TrackerGrace`), `Build(Options)` wires every service and returns `*Wired`; `Wired.Bound()` is the
  registration list; `BeforeFlush`/`Teardown` are the ordered shutdown; Space adds `BindShell`
  (window hooks) and `StartMobile`. `main.go` keeps the Wails app, windows, menu, `startupfail`.
  Production and both `flowharness` packages call the same `Build`.
  Verify: `grep -n "^func Build\|^type Options\|func (w \*Wired) Bound\|BindShell\|StartMobile" apps/kira-{studio,space}/internal/appwire/appwire.go`.
- **A2. Bound-service counts (~2503-2530).** Replace "`apps/kira-studio/main.go` builds the
  `application.New` options, registering **27**" and its `grep -c application.NewService
  apps/kira-studio/main.go` with `appwire.Build` + `Wired.Bound()`, 27, verify command
  `grep -o 'NewService(w\.' apps/kira-studio/internal/appwire/appwire.go | wc -l`. Space: **18** to
  **20**, same command on `apps/kira-space/internal/appwire/appwire.go`; name the two additions
  `MobileService` (P212) and `MemoryImportService` (P211). Fix "Kira Studio's `main.go` binds no
  git-related service" to `Bound()`.
- **A3. Process diagram (~2279)** box `apps/kira-studio/main.go`: add `internal/appwire`.
- **A4. Every other `main.go` mention (21 total; `grep -n "main\.go" docs/ARCHITECTURE.md`).**
  For each, `grep` the named construct in `apps/<app>/main.go`; if it moved, repoint to
  `internal/appwire/{appwire,wire}.go`. Known moved: ~2340 `agenthooks.Manager` start
  (`appwire/wire.go` `wireTracker`), ~3931 `wireAdeTask` (`appwire/wire.go`), ~618 single
  `localauth.Authorizer` (constructed in `main.go`, passed through `appwire.Options`), ~4674
  (already right). Check ~948, ~2321, ~2589, ~2820, ~3144, ~4445, ~4262, ~4352, ~5077.
- **A5. ADE "Process wiring" (~3931):** `appwire/wire.go` `wireAdeTask` builds the board;
  `TaskBoardDeps` has `GitStatus` (discovery), no `GitPath` (P230).
  Verify: `grep -n "GitStatus\|GitPath" apps/kira-space/internal/ade/board.go`.
- **A6. Process model `EmitTo` paragraph (~2605):** one sentence: the `-tags server` build's
  `EmitTo` broadcasts to every browser window (`internal/shell/emitto_server.go`, P231 A3); native
  build unchanged.

Storage and facts:

- **A7. Storage (~787):** Kira Space migration high-water **0023** to **0025**; add
  `0021_p212_mobile_devices.sql`, `0022_p212_mobile_permissions.sql`,
  `0024_p222_code_repo_color.sql`, `0025_p223_mobile_lan.sql`.
  Verify: `ls apps/kira-space/internal/storage/migrations/`.
- **A8. ADE Git facts (~3988):** "`go.mod` has no go-git" is false since P211. Reword: go-git v5 is in
  `go.mod` for the importer's `plumbing/format/gitignore` matcher only; ADE uses none of it.
  Verify: `grep -n go-git go.mod`; `grep -rln go-git apps/kira-space/internal/ade` empty.
- **A9. Graph restart paragraph (~3685), P231 A1:** a walk reset remembers its loaded row count
  (`gitsession.Walk.keepRows`); the next `graph.stream` re-reads whole pages until the store holds
  that many again, so Refresh after Show more keeps the loaded depth (the newest commit shifts the
  last old row out). Verify: `grep -n keepRows apps/kira-space/internal/gitsession/walk.go`.
- **A10. Git module Transport (~2807), P231 A2:** the native transport
  (`apps/kira-space/frontend/src/repo/git/transport.ts`) sends `repo.open` once per repo before the
  first request or stream naming it; a reloaded Review pane or diff tab works without the graph tab.
- **A11. Git module Go packages or ADE Git facts, P231 B-2:** open repos follow a changed
  `git.gitPath` (`gitclient.Repo.SetGitPath`; `gitsession` registry and `TaskBoard.openRepo`
  re-apply the live setting). Verify: `grep -n SetGitPath apps/kira-space/internal/gitclient/repo.go apps/kira-space/internal/gitsession/registry.go apps/kira-space/internal/ade/board.go`.
- **A12. ADE "Worktree setup" (~4075), P231 B-1:** attaching a remote-only branch creates a local
  branch from `<remote>/<name>` (origin preferred) that tracks it (`ade/setup.go` `ensureWorktree`).
- **A13. Mobile section, P231 B-3:** `SetPort` reconciles whenever the supervisor is active, so a
  server stopped by a busy port retries on the new port (`bridge/mobile.go`).
- **A14. Mobile section (~4199), P227 M1:** expiry also ends live use: `handleEvents` ends the SSE at
  `ExpiresAt`, the terminal `authorized` callback checks it, and the one-minute `maintain` loop
  walks an in-memory id-to-expiry map (`Server.expiries`), disconnecting streams and releasing
  terminals of expired devices. Verify: `grep -n "expiries\|DisconnectDevice" apps/kira-space/internal/mobileweb/server.go`.
- **A15. Mobile section, B-4 check only:** confirm `/api/ade/sessions` and SSE drop `cwd`
  (`withoutCwd`) are stated; add one clause if missing.
- **A16. ADE per-repo colour bullet (~3960), P227 M2:** worktrees take their anchor repo's colour
  (`repo/state/repoLinks.ts` `repoColorOf`, used by `tabKinds.ts` and ADE).

Testing:

- **A17. Testing intro (~4659-4671).** Studio suites: `unit/`, `ipc/`, `ui/`, `e2e-real/`, `visual/`,
  opt-in `perf/` and `proto/` (own config); `fixtures/`, `support/` are not suites; Go suite plus
  the Studio flow tier (A18). Space: `unit/`, `ui/`, `mobile/`, `e2e-real/`, `visual/`, `perf/`, plus
  the Go flow tier. Drop "Five suites". Verify: `ls apps/kira-studio/tests apps/kira-space/tests`.
- **A18. New paragraph "Studio flow tier (Go, P232)"** after the Space e2e-real paragraph (~4693).
  Facts: `apps/kira-studio/internal/flowharness.New` boots `appwire.Build` in-process with temp
  `HOME`/`KIRA_HOME`, `TZ=UTC`, `KIRA_INSECURE_SECRETS=1`; `Restart`, `Quit` (runs
  `ServiceShutdown` like Wails). Real: SQLite, HTTP/HTTPS servers with a per-binary test CA
  (`CAFile`), gRPC with reflection and `testdata/flow.proto`, a silent server, the Docker engine.
  Faked: dialogs (queued answers), keep-awake driver, MCP installer (records, never touches Claude
  config), OS auth. Docker helpers: `RequireDocker` skips without a daemon, fails under
  `KIRA_FLOW_DOCKER=require`; one image `mirror.gcr.io/library/alpine:3.20`; resources labelled and
  swept in `flowharness.Main`; `DOCKER_HOST` resolved before `HOME` is swapped. Packages:
  `flows/{apiflow,httpflow,grpcflow,dockerflow,termflow}` (one line of purpose each from `doc.go`).
  Shared with Space: `internal/flowtest` (`Events` recorder implementing `appevent.Emitter`,
  `Complete` gate on `KIRA_FLOW_COMPLETE`). Scripts `test:flows:studio`,
  `test:flows:studio:complete`.
  Verify: `ls apps/kira-studio/internal/flows apps/kira-studio/internal/flowharness internal/flowtest`;
  `grep -n "EnvDocker\|Image =" apps/kira-studio/internal/flowharness/docker.go`.
- **A19. Studio e2e-real paragraph (~4832):** "four specs (sqlite, postgres, mariadb, multiwindow),
  six tests" is stale. List five specs (add `api-boot-real.spec.ts`); drop the test count or
  recount with `playwright test --list --project=e2e-real`. Add: worker-scoped `flowServers`
  fixture spawns `apps/kira-studio/bin/flowservers` (built once under the shared build lock) so both
  tiers share one server implementation; `serverEnv` option; `kira.call` over the shared `bound()`
  helper in `packages/workbench/src/testing/e2eReal.ts`.
- **A20. `tests/ui/` count (~4811):** "283 tests across 53 spec files (P109 recount)" is stale.
  Recount: `cd apps/kira-studio && npx playwright test --list --project=ui --project=ui-timing | tail -1`
  and `ls tests/ui/*.spec.ts | wc -l`; write the new numbers as "(P234 recount)".
- **A21. Visual paragraph (~4851):** "six specs, 13 snapshots, settings 8 panes" is stale. Studio: 8
  specs, 13 snapshots; settings 6 panes (Appearance, Data, Cache, Api, Database MCP, Advanced);
  `terminal-module` 1. Add Space: `settings` 5 (Advanced, Appearance, Connected editors, Git,
  Memory), `git-module` 3 (P229). Verify:
  `find apps/kira-{studio,space}/tests/visual -name '*.png' | wc -l`.
- **A22. Parallelism (~4899-4913):** Space config is `ui`, `mobile-ios`, `mobile-android`,
  `e2e-real` (`workers: 2`), `visual`, not "two-project (`ui`, `visual`)"; delete "neither carries a
  `ui-timing`/`e2e-real` equivalent". Verify:
  `grep -n "name:" apps/kira-space/playwright.config.ts`.

Known open items:

- **A23. Delete** "Kira Space has no full-stack (`e2e-real`) tier, so git pairing has no real-socket
  test" (~5139). Resolved: Space `e2e-real` exists (P231), and `flows/editorflow` drives pairing,
  deny, revoke and re-pair over a real `git.sock`. Verify:
  `grep -n "^func Test" apps/kira-space/internal/flows/editorflow/pairing_test.go`.
- **A24. Reword** visual baselines item (~5187): P227 re-recorded 13 Studio and the Space Settings
  baselines in the dev container, P229 added 3 git-module ones; both suites pass there. Open part:
  the CI `ui` job image is unchecked; regenerate there if it disagrees. Drop the "fail" wording and
  the v2.1 content list.
- **A25. Add:** phone sees desktop worktree paths (P231 B-4): board `branches[].worktree` is a local
  path served to paired phones. Open user decision; delete once decided.
- **A26. Add:** load-sensitive UI specs: `repo-graph-paging` drag step fails about 1 run in 80 at 8
  workers (P231), `ade-v2-panel` handle-drag width under load (P230). Pass alone. Delete once
  deflaked.

### 3.2 `docs/DEV_ENVIRONMENT.md`

- **D1.** Server-tag recipe (~364): delete "The server-tag build drops terminal output"; replace with
  one line: server build `EmitTo` broadcasts (`internal/shell/emitto_server.go`, P231), listeners
  filter by id.
- **D2. New section "## Kira Studio flow suites (P232)"** right after "## Kira Space flow suites
  (P231)". Facts: `bun run test:flows:studio`; `test:flows:studio:complete` sets
  `KIRA_FLOW_COMPLETE=1 KIRA_FLOW_DOCKER=require`, 20 min timeout; Docker flows need `dockerd` up
  (Docker section) and pull `mirror.gcr.io/library/alpine:3.20`; leftover labelled containers are
  swept at the next run; `bun run test:e2e-real:studio` builds `apps/kira-studio/bin/flowservers`
  (gitignored). Run `go test` with `CGO_ENABLED=1`.
- **D3.** Docker section heading (~47): widen scope to "container fixtures and Docker flow tests";
  one bullet pointing at D2.
- **D4.** Visual pixel-diff section, last two sentences ("v2.1 added real content changes ... need one
  regeneration"): stale. Replace: baselines re-recorded in this container (P227, P229); regenerate
  on CI only if the `ui` job disagrees.
- **D5.** P215 tooling fact, in the golangci-lint/knip section: `typecheck:*` run `--incremental`
  with one `tsBuildInfoFile` per project under `node_modules/.cache/tsbuildinfo` (gitignored);
  delete that directory to force a cold check. Verify: `grep -c tsBuildInfoFile package.json`.
- **D6.** Grid prototype (~690): `docs/v2.0/plans/P163-cheetah-grid-prototype.md` does not exist;
  repoint to `P165-cheetah-grid-prototype.md` after checking its title.

### 3.3 `README.md` (root, normal prose)

- **R1.** Intro: modes are Studio, Api, Terminal and Docker, not "Studio and Api with one button".
  Verify: `packages/shared/domain/mode.ts` `AppMode`.
- **R2.** Kira Space blurb: git client and code workspace plus agents (ADE), memory, terminal and a
  phone view on the home network.
- **R3.** Studio "Also": terminal module with quick commands grouped in collections, not "terminal
  tabs with launchable scripts"; Settings panes are Appearance, Data, Cache, Api, Database MCP,
  Advanced (no Scripts, no Claude Code). Verify: `ls apps/kira-studio/frontend/src/workbench/settings/`.
- **R4.** New "### Docker" feature subsection (P200): containers, images, volumes, networks, logs,
  exec terminals, contexts, remote `tcp://` flagged insecure. Check against `internal/docker/bound.go`.
- **R5.** Api Collections: move a request or folder to another collection (P219).
- **R6.** Development: one sentence naming `test:flows:studio` and `test:e2e-real:studio`.
- **R7.** Documentation: "`docs/v1.9/` — the current development chapter" to `docs/v2.2/`.

### 3.4 `apps/kira-space/README.md` (normal prose)

- **S1.** Intro and Git features: drop "this app has exactly one module, no `Studio`/`Api` mode
  switcher". Modules: Git, Agents, Terminal, Memory. Verify:
  `apps/kira-space/internal/storage/model/window.go` `WindowModes`.
- **S2.** New feature sections, short: Agents (task planner, workflows, runs, interactive Claude Code
  sessions; hooks per session via `--settings`, user settings files untouched, P233), Memory (MCP
  server for Claude Code, keyword plus semantic search with an optional 35 MB local model downloaded
  from Settings > Memory, bulk import of files or folders, manual add), Terminal (quick commands in
  collections), Phone view (Settings > Mobile access; plain HTTP on a trusted home network only, QR
  pairing approved on the desktop, device tokens expire after 30 days, traffic unencrypted).
- **S3.** Tests: "Two TypeScript suites (`unit/`, `ui/`)" is stale. Add `mobile/`, `e2e-real/`,
  `visual/`, and the Go flow tier (`test:flows:space`, complete variant).
- **S4.** Script table: add `build:space-mobile`, `test:ui:space-mobile`, `test:e2e-real:space`,
  `test:flows:space`, `test:flows:space:complete`, `test:visual:space`; `build:space` also builds
  the phone bundle.
- **S5.** Architecture tree: add `apps/kira-space/internal` `ade`, `mobileweb`, `appwire`,
  `flowharness`; repo-root `internal/memory`, `internal/agenthooks`; test dirs from S3.
- **S6.** App data: add `~/.kira-memory/` (`KIRA_MEMORY_HOME`: `memory.db`, `models/`).
- **S7.** Requirements: optional authenticated `claude` CLI for Agents and Memory.

### 3.5 `docs/v2.2/README.md`

- **V1.** Rewrite the intro (terse) to cover the chapter: memory embeddings, bulk import, manual add
  (P210, P211, P214); phone view, read then writes, then plain HTTP on the trusted LAN (P212, P223);
  speech to text added then removed (P216, P218 cancelled, P224); Tailwind audit (P213); test speed
  (P215); collections (P219); git graph fixes (P220, P225, P228); colour marks (P226); git look
  (P229); ADE refresh (P230); real-flow tests (P231, P232); Claude Code hooks scope (P233); docs
  (P234); reviews (P217, P227, P235). Keep the two bullets.

### 3.6 `CLAUDE.md`

- **C1.** Line ~49: "`docs/v1.9/` today" to "`docs/v2.2/` today".
- **C2.** Line ~151: counter list ends at v1.9. Append "v2.0 at `P126`, v2.1 at `P185`, v2.2 at
  `P210`" to the existing sentence. No other change.

### 3.7 `docs/v2.2/SPEC.md`

- **P1.** P234 row status to Done.
- **P2.** "## P234 result", 5 lines max: what each file got, checker result, deferred decisions taken.
- **P3.** P212 Part 1 result: append "(PWA and local CA removed in P223)" to the "Landed" bullet.
- **P4.** P225 result: keep root causes A and B and spec names; cut the pre-fix failure dump to one
  line; replace the Mac handover with "Superseded by P228's handover; step 5 fixed in P231 A1."
- **P5.** P228 result: cut the R2 clipped-entry list to one line. Keep the handover.

Do not touch any other result section.

## 4. Consistency check (final, before commit 5)

1. **Path and script checker.** One-off Bun script in the session scratchpad, not committed (D2 below).
   Input: the six edited docs. For each backticked or linked token starting `apps/`, `packages/`,
   `internal/`, `scripts/`, `docs/`, `tests/`, `frontend/`, `.github/`: skip tokens with `<`, `$`,
   `…`, `...`, `http`; strip `:line` and `#anchor`; resolve against repo root and each of
   `apps/kira-studio/`, `apps/kira-space/`, `apps/kira-space-vscode/` (docs use app-relative
   `internal/...`); also try with `.go`/`.ts` appended and with trailing `.Symbol` segments removed;
   globs via `Bun.Glob`. Every `bun run <name>` must be a `package.json` script (`name:*` is a
   family; skip). Prototype at base: 46 misses, 17 on lines naming a deleted thing, 29 others.
   Each residual miss is either fixed, or on a line that states the thing was deleted, removed,
   moved or renamed, or a build output (`apps/*/bin/*`, `build/onnxruntime/*`) or the
   `docs/pending-*` workaround dirs. Real misses found at base, fix in the owning section:
   `internal/apistore` (~1582), `packages/api-ui` (~1649), `apps/kira-studio-vscode` (~2767, ~3161,
   only if not already marked as the old name), `apps/kira-studio/internal/bridge/rpcstream`
   (~2892), D6.
2. **Stale-phrase grep, expect 0 hits:**
   ```sh
   grep -n -E 'git-pairing-real|drops terminal output|has no full-stack|`go.mod` has no go-git|separate \*\*18\*\*|NewService apps/kira-s(tudio|pace)/main.go|two-project|four specs|\*\*six\*\* specs|v2.1 added real content|docs/v1.9/` today|Two TypeScript suites|exactly one module|launchable scripts|P163-cheetah' \
     docs/ARCHITECTURE.md docs/DEV_ENVIRONMENT.md README.md apps/kira-space/README.md CLAUDE.md
   grep -n 'high-water \*\*0023\*\*' docs/ARCHITECTURE.md   # Space line only; Studio M5 line stays
   ```
3. **Numbers:** A2 counts (27, 20), A7 (0025), A20 recount, A21 (13 Studio, 8 Space) re-run.
4. `git diff --stat ef44a0756..HEAD` lists only the seven files of section 3 plus this plan's deletion.

## 5. Commits (5, Conventional Commits, hooks green, no `--no-verify`)

1. `docs(arch): appwire composition roots, P231 fixes and stale facts` — A1-A16.
2. `docs(arch): testing tiers, P232 Commit 0 and open items` — A17-A26.
3. `docs(dev-env): studio flow suites, server build and tooling` — D1-D6.
4. `docs: READMEs and CLAUDE.md pointers for v2.2` — R1-R7, S1-S7, V1, C1-C2.
5. `docs(v2.2): P234 result` — P1-P5, consistency fixes from section 4, delete this plan
   (`docs/v2.2/README.md`: plans fold into results, then go).

Trailers on each: `Co-Authored-By: Claude Sonnet <noreply@anthropic.com>` and the session's
`Claude-Session` line.

## 6. Checks

Per commit: pre-commit hook (`bun run lint`, `bun run typecheck`). Before commit 5: section 4 in
full; `bun run lint:dead` (pre-push). No Go or UI suite: no code changes.

## 7. Deferred decisions (bold = default the implementer takes)

- DD1. Scope includes `apps/kira-space/README.md`: **yes** (root README hands Space to it; most
  stale file). Alternative: leave it.
- DD2. Path checker: **scratch only, not committed or wired into lint** (`ARCHITECTURE.md` names
  deleted files on purpose; a gate needs an allowlist). Alternative: commit `scripts/check-doc-paths.ts`.
- DD3. git-pairing-real open item: **delete** (real-socket pairing covered by `editorflow`).
  Alternative: narrow to "no browser-level pairing spec".
- DD4. New open items A25, A26: **add both**. Alternative: A25 only.
- DD5. `tests/ui/` count: **recount**. Alternative: drop the numbers.
- DD6. SPEC condensing: **P3-P5 only**. Alternative: also trim P213 and P215 measurements.
- DD7. Visual baselines item: **reword**. Alternative: delete.
