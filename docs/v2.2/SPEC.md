# v2.2 SPEC

Branch `v2.0`. Max 2 concurrent streams. Stream A: P210 then P211 (memory, same subsystem). Stream B: P212. Stream C: P213 (user override of the 2-stream cap).

| Phase | Title | Status |
|---|---|---|
| P210 | Memory embedding search: local embedding model (best quality under 500 MB RAM, less if possible), vectors in SQLite, hybrid with existing FTS recall-first search | Done |
| P211 | Memory bulk import: pick file or folder; chunk to a Sonnet-friendly size; per-chunk clean-context agent extracts atomic facts; one final agent holding all chunk facts of the file adds memories through the MCP; progress and failure shown | Done |
| P212 Part 1 | Mobile agents web: local web server in Kira Space serving a read-only mobile-laid-out Vue agents module; first-load device approval in Kira Space like the git extension pairing; installable PWA | Done |
| P212 Part 2 | Mobile agents web writes (amendment): backlog add and reorder, TUI input for stuck agents, start/next/prev workflow stage, phone attach of the Claude Code terminal (desktop shows disconnected plus a reconnect button) | Done |
| P213 | Tailwind audit (user-requested, runs now on stream C as an exception to row order): replace hand-written CSS with Tailwind utilities across both apps and shared packages, including partial matches; skips files owned by P210–P212 | Done |
| P214 | Memory manual add, free text: Add memory dialog gets a single free-text box (no per-row fact/reason; reason auto-filled as manual). Submits through the unchanged store path: the gate already splits into atomic facts, challenges and reconciles; stored only when every step passes. No dependency on P211 | Done |
| P215 | Test and hook speed regression: tests and the pre-push hook (go build, lint:go, lint:dead) got much slower in roughly the last 24h, not from contention. Measure where time goes per stage first (do not bisect commit history); find the cause; fix it | Done |
| P216 | Memory speech to text: local English-only Whisper small.en quantized q5_1 (whisper.cpp ggml) in a subprocess worker started only on demand and stopped when idle, like memory-embed; mic dictation in the Memory module with live text shown in the input, user sends it manually; model download on click with pinned SHA-256 | Removed in P224 |
| P217 | Code review (one Opus round) and fixes | Done |
| P218 | Speech engine without a C++ build: step 1 measures build-free engines (sherpa-onnx prebuilt libs first) against the whisper.cpp worker; step 2 swaps in the winner and deletes fetch-whisper.sh, the `whisper` tag, cgo glue, CI patch and S13 whisper bits. Keeps dictation behaviour, malgo capture, worker isolation, pinned-SHA model store, 400 MB RSS ceiling. No winner: stop and ask the user, never back to whisper.cpp | Cancelled (user dropped speech to text) |
| P219 | Terminal and API collections: terminal module scripts get collections added the same way as the API module; right-click menu in both modules to move an item into a chosen collection; working-dir field gets a native folder-select dialog | Done |
| P220 | Git module: graph lines still disappear on click and on scroll (find the root cause); default tab is Repos and the last tab the user moved to persists across restarts | Done |
| P221 | Memory module: move the semantic-search model download and the Connect Claude Code action into Settings | Done |
| P222 | Git add-repo dialog: restyle to match the app's dialog design; per-repo colour choice like other places; explain and fix what the add-env section does (should it take a script?) | Done |
| P223 | Mobile agents web as a plain-HTTP page on the trusted LAN only: drop the PWA, local CA, HTTPS and setup listener; bind one LAN interface address; refuse peers outside its private subnet; "Trust this network" (subnet plus router MAC) starts and stops the server by itself; plaintext warning; device tokens expire | Done |
| P224 | Remove speech to text completely: the `stt` package, whisper.cpp build, dictation bridge and stream, mic UI, P221's dictation settings section, malgo, S13, plists' microphone string, CI patch, docs; delete the downloaded speech model at startup; keep `modelstore`, `workerproc` and the embed worker | Done |
| P225 | Git graph regression (new since about yesterday, likely from P220's CommitGrid change): commits disappear from the graph and Show more is broken. Find the root cause, fix it, add a regression test that fails before the fix | Done |
| P226 | Consistent colour bars: wherever the left panel shows an item with a coloured left bar (scripts in Kira Studio, git repos, and other module lists), the same colour renders the same way everywhere. One shared bar component and tone mapping instead of per-module variants | Done |
| P227 | Code review (one Opus round, all three dimensions) of everything changed since the last review close-out `7f626e91a` (P218 to P226), then one Sonnet fixer. Findings file `plans/P227-findings.md` committed before the fixer, deleted once fixed. Also fix the stale Studio visual baselines (all 12 fail on base). | Done |
| P228 | Git graph still broken after P225; user suspects resizing columns breaks it. Reproduce with real column resizes (every column, drag then scroll, click, Load more), find root cause, fix, add regression spec that resizes columns first. | Done |
| P229 | Git section (graph, toolbar, detail, stash and other git panes) looks different from the rest of the app: bring it in line with the app's shadcn-vue/Tailwind look (spacing, type, colours, controls, rows). Includes the git UI inside Kira Space. | Done |
| P230 | Agent module Refresh broken: shows 'never fetched' then a git error. Find root cause, fix, add regression spec. | Done |
| P231 | Real-flow tests for every main flow of Kira Space, split at the IPC (bridge) level: Go-side tests drive the bound services against real `git` and real temporary git repos (no mocked git, default settings), TS-side tests drive the frontend against the real bridge contract. Covers all modules (git, agents/ADE, memory, terminal, API/quick commands, repos, settings, mobile web). Two parallel streams (A, B) with disjoint file ownership. Then fix every issue the tests find. | Done |
| P232 | Real-flow tests for Kira Studio, same type as P231 (Go bound-service tests at the IPC level against real git/real services with default settings, plus real-UI `e2e-real` specs): API module (requests, collections, variables/environments, quick commands, gRPC), Docker module, with real API calls over HTTP and gRPC (real local HTTP servers and a real gRPC server with reflection and `.proto` descriptors, no mocked transport) and real Docker commands against a real Docker daemon (containers, images, volumes, networks, logs, exec), skipping with a clear message when no daemon is reachable, and Studio's own terminal wiring (`bridge/terminal.go`, terminal module host, Studio quick commands). Reuses P231's harness patterns; then fix every issue found. | Planned (Commit 0 done: appwire, flowtest, flowharness, e2e-real servers) |
| P233 | Claude Code hooks only for sessions Kira Space starts: audit every place Kira Space or Kira Studio changes the user's real Claude Code configuration (`~/.claude/settings.json`, project `.claude/settings.json`, `.claude.json`, MCP registration, hooks), and move each to per-session injection (e.g. `--settings <file>` / `--mcp-config` passed only when Kira Space launches the agent or terminal session, hook shim scoped by an env var set only there). Kira Space must make no change to the user's actual settings files; migrate or remove entries earlier versions wrote, with an explicit user-visible cleanup step. Real-flow test that proves settings.json is byte-identical after the flows. | Done |
| P234 | Docs refresh: update `docs/ARCHITECTURE.md` (incl. Parallelism, process wiring with `appwire`, stale git-pairing-real line, testing section), `docs/DEV_ENVIRONMENT.md`, the v2.2 README and root `README.md` to match everything shipped in v2.2 (P210-P233). | Planned |
| P235 | Code review (one Opus round, all three dimensions) of everything changed since the P227 close-out `605f63e3f` (P228-P234), then one Sonnet fixer. Findings file `plans/P235-findings.md` committed before the fixer, deleted once fixed. | Planned |

## Requirements (user's words, condensed)

- P210: search over embeddings too; SQLite; local model; best under 500 MB RAM, maybe less.
- P211: import lots of docs; select file or folder, import starts; each file chunked; chunk size suits Sonnet; step 1 extract atomic facts per chunk (agent with clean context each); step 2 one agent sees all chunks' facts of the file and adds memories via MCP so context of whole file is kept.
- P212: local web server serves mobile version of agents module; first load on phone must be allowed in Kira Space (like git extension); Vue, mobile layout, read-only for now; PWA so it runs outside browser.
- P215: tests too slow; find and fix before code review.
- P216: STT, q5_1, subprocess; live text in input; user sends; after the test fix. Removed in P224.
- P218: cancelled; the user dropped speech to text (P224).
- P219: terminal collections added like API module; right-click choose collection in both; working dir gets native folder dialog.
- P220: git graph lines still vanish on click and scroll; default git tab Repos; persist last tab moved to.
- P221: memory module: semantic download and connect Claude Code move to Settings.
- P222: add-repo dialog looks unlike app; colour per repo; unclear what add env does, should it add a script?
- P223: self-signed cert install too shady; drop the PWA and HTTPS; no Tailscale; works only on my local network, checks which network it is and does not work otherwise.
- P224: "Remove speech to text completely".
- P225: git graph still broken, commits disappear, Show more broke; new regression since last day; fix it.
- P226: colours in the left panel must look the same everywhere: a coloured left bar in Studio is the same for scripts and for git.

## P210 result

Hybrid keyword and semantic memory search, local model, vectors in `memory.db`. Facts live in
`docs/ARCHITECTURE.md` ("Memory MCP server and module", Stack table, Known open items) and
`docs/DEV_ENVIRONMENT.md` (Memory MCP section).

Decisions taken (user's deferred defaults): D1 English-only arctic-embed-s int8; D2 download on click
(35 MB, pinned SHA-256) rather than bundling the model; D3 semantic candidates in reconcile on, cosine
floor 0.85.

Runtime and model choice, measured on Linux x86_64 (4 cores, ORT CPU, 2 intra-op threads):

| Option | Result |
|---|---|
| hugot pure-Go backend, bge-small | 458 MB loaded, 1.05 GB peak, 40x slower than ORT: declined |
| hugot ORT backend | works, drags GoMLX and go-xla into `go.mod`: declined |
| `yalue/onnxruntime_go` + `hftokenizer`, arctic-embed-s int8 | 95 MB loaded, 137 MB peak, 4 ms short, 35 ms long: chosen |
| llama.cpp, sqlite-vec | second native toolchain; native SQLite extension `modernc.org/sqlite` cannot load: declined |
| multilingual-e5-small int8 | 362 MB peak, weaker English retrieval: D1 alternative |
| EmbeddingGemma (Gemma terms), jina v3 (CC-BY-NC) | not open-source licences: declined |

Verification (this environment, network reachable):

- Pinned URLs and SHA-256 of `model.onnx` and `tokenizer.json` re-verified against the pinned HF
  revision; ORT tgz hashes for `osx-arm64` and `linux-x64` verified by `scripts/fetch-onnxruntime.sh`.
- `go test -tags embedsmoke ./internal/memory/embed/ -run Smoke`: real download via `embed.Install`,
  real worker, dim 384, unit norm, top-1 9/10 on the 10-query paraphrase probe (miss: "what hardware
  does the user work on").
- `memory-mcp` end to end (built binary, real model, `KIRA_ORT_LIB`): first `search_memories` ran while
  indexing and returned keyword-only; the second, a no-shared-word query ("which relational database
  serves live traffic"), returned the PostgreSQL fact first with `[semantic]` and state `ready`. Worker
  RSS 146 MB after backfill plus query; the worker was gone 300 s after the last search; the MCP process
  exited 0.
- `go test -race ./internal/memory/... ./apps/kira-space/internal/bridge/`, `bun run test:unit`,
  typecheck and lint pass; Space UI spec `memory-module.spec.ts` passes (4/4). `CGO_ENABLED=0` and
  `GOOS=darwin CGO_ENABLED=0` builds of `internal/memory/...` compile (stub path). Visual baselines not
  regenerated.

Deviations from the plan:

- `Command` in `embed.ClientOptions` takes only `modelDir` (the plan's `ctx` had no use).
- `Memory.seq` is an unexported field set by `memoryColumns` (now ends in `m.seq`) instead of a variant
  scanner; `searchFTS` returns `[]Memory`.
- `Installed` and the manifest live in `embed/manifest.go` (commit 2) because the client needs them
  before the installer (commit 4). `normalize` moved to `vector.go` so the fake-worker tests run with
  `CGO_ENABLED=0`.
- Added `progress` shadcn-vue set uses `bg-field` instead of the registry's `bg-muted` (retired alias
  guard in `check-theme-classes.sh`).
- The plan's `CGO_ENABLED=0 go build ./apps/kira-space/...` check cannot pass here (Wails needs cgo on
  Linux); the stub was checked on `./internal/memory/...`.

Unverified: macOS (dylib load from `Contents/Frameworks`, arm64 int8 kernels, worker footprint,
`codesign --verify --deep --strict`), the Download model click in the real app (covered by the same
`embed.Install` the smoke test runs, UI states by typecheck only), and tokenizer parity beyond the 9/10
ranking probe. Recorded in Known open items.

## P211 result

Memory bulk import: pick files or a folder, scan, confirm an estimate, extract facts per chunk, add
memories per file through the MCP. Facts live in `docs/ARCHITECTURE.md` ("Memory MCP server and
module", Stack table, Known open items) and `docs/DEV_ENVIRONMENT.md` (Memory MCP section).

Decisions: plan defaults for every deferred decision. Libraries: goldmark (chunk boundaries), go-git
gitignore matcher, `backoff/v4`; no tokenizer.

Measured (CLI 2.1.293, Sonnet, sandbox):

| Item | Result |
|---|---|
| Extract, 3 chunks of `ARCHITECTURE.md` (2206, 3528, 2410 tokens) | 22, 29, 20 facts; 17, 19, 16 s; 0.044-0.051 USD each |
| Smoke import, 2 files, 6 chunks | 48 s, 8 calls, 0.135 USD; 24 facts extracted, 20 added, 1 unresolved, 0 dropped, 0 failed |
| Estimate constants | 20 facts per chunk, 18 s per extract, finalize 15 s + 25 s per 20 facts |
| Fact reasons | `Stated in <path>, <heading>: "<evidence>"`; gate challenged none |

Gate and reconcile calls inside `memory-mcp` are not in those costs.

Verification: `go test -race` on `./internal/memory/...` and the bridge and shell packages;
golangci-lint 0 issues; `bun run typecheck`, `bun run lint`, knip; Playwright `memory-import` and
`memory-module`; real-CLI smoke; step-2 isolation canaries (a user-level `CLAUDE.md` instruction was
not followed; a call to a non-allowed tool was denied under `--permission-prompts none`).

Deviations from the plan:

- Gitignore uses `gitignore.ParsePattern` per directory, not `ReadPatterns` over an `osfs` filesystem:
  same matcher, no billy wiring, patterns scoped to their directory.
- `--allowedTools` is one comma-joined argument so the variadic flag cannot swallow the next flag.
- The `memory-mcp` re-exec for the smoke test sits in the importer package's one `TestMain`.
- File list selection shows the selected file's reason, unresolved and dropped facts in a fixed panel
  under the virtualized list, so rows keep one height.

Unverified: macOS (native multi-file picker, app-bundle `memory-mcp` import mode); a full app run
with a real `-tags server` binary was not done here, so quit-mid-run recovery is covered by engine
tests only.

## P212 Part 1 result

Done. Read-only phone web app served by Kira Space; design facts in `docs/ARCHITECTURE.md` "Mobile
agents web (P212, Kira Space)".

- Scope narrowed by the user to three tabs: Backlog, Need You, Plan. Server allowlist stays GET only
  plus `POST /api/pair`; auth (per-device cookie token, `csrfGuard`, route table) is built so a write
  endpoint is one row. No terminal/PTY attach.
- Landed: generic `internal/pairing` and `internal/embedded`, `appevent.Tap`, `mobileweb` server with
  local CA, migration 0021, desktop Mobile access pane and pairing dialog, transport-agnostic ADE
  reader, second Vite build, installable PWA, Playwright mobile projects.
- Verified: Go race tests on the touched packages, `bun run test:ui:space` (221 pass),
  `test:ui:space-mobile` (iOS WebKit and Pixel Chromium emulation), lint, golangci-lint, knip,
  typecheck. Not verified: a real phone (CA install, installed PWA, WebKit offline shell).
- `test:visual:space`: the four Settings dialog snapshots differ because the nav gained a "Mobile
  access" row. Baselines not regenerated here (sandbox fonts); regenerate on the reference machine.
- Follow-up amendment P212 Part 2: backlog add and reorder, TUI input for stuck agents,
  start/next/prev workflow stage, phone attach of the Claude Code terminal (desktop shows
  disconnected plus a reconnect button).

## P212 Part 2 result

Done. Design facts in `docs/ARCHITECTURE.md` "Mobile agents web (P212, Kira Space)"; try-it steps in
`docs/DEV_ENVIRONMENT.md`.

- Landed (12 commits): migration 0022 and permission settings; stale-stage guard; shared
  `stageMoves`/`withMovedItem`/`useLaunchOpener`; guarded write routes, idempotency, `MobileWriter`,
  launch rendezvous; `internal/terminal.Arbiter`; `internal/mobileterm` (ring, broker, WebSocket);
  desktop overlay and Reconnect; phone writes UI and terminal screen; Playwright specs; docs.
- Deferred decisions DD1 to DD11: the plan's bold defaults.
- Found while testing: a reloaded phone deep link always redirected to Need You (first auth check fired
  the `phase` watcher). Fixed in `mobile/App.vue`.
- Verified: `go test -race ./apps/kira-space/... ./internal/terminal/...`, golangci-lint 2.13.2 (0
  issues), knip, typecheck, lint, `test:ui:space` (225 pass), `test:ui:space-mobile` (iOS WebKit and
  Pixel Chromium). Not verified: a real phone, soft keyboard, PWA background socket, Claude Code redraw
  after resize (all in Known open items); Take over has no Playwright spec (no stuck-run fixture), Go
  tests cover its route and rendezvous.
- `test:visual:space`: Settings dialog snapshots change again (two switches per row and the global
  switch). Baselines not regenerated here (sandbox fonts); regenerate on the reference machine.

## P213 result

12 commits on `v2.1-stream-C` (`393978d04`..`f262f96dd`, plus docs). Hooks green on each.

Done:
- Connection and type colours: `connBgClass`/`connTextClass`, `columnTypeTextClass` literal maps replace direct `:style` colour paints (plan classes C, D: 19).
- Static `:style` keys moved to classes; bindings keep runtime geometry only. `:style` bindings 250 to 142 (same grep).
- ADE: tone `@theme` tokens in `ade/v2/tones.css`; `tones.ts` keeps class maps only. `tagStyle`/`solidStyle`/`actionStyle` deleted (no use in `kira-v21-G` or `origin/v2.0`).
- git-ui commit grid: cell, badge, ref-strip CSS to `kv:` utilities; `CommitGrid.vue` SlickGrid overrides via `@apply`. Style block 47 to 16 rule blocks.
- Studio `slickTheme.css`: 70 to 63 rule blocks, 825 to 715 lines; safe single-declaration subset via `@apply`. Host, mount, no-rows, nav button, header badge, select zone moved to class strings.
- Space review load-error zone: utilities; retry via `buttonVariants`. Rules deleted from `review-decorations.css`.
- `base.css` html/body and `MonacoHost.vue` find-match tints via `@apply`.

Kept CSS: 5 `<style>` blocks unchanged in count; `slickTheme.css` 63 rules (vendor DOM, composites, raw px sizes, `.cell-input` states, scrollbar pseudo rules).

Verification: `test:unit` 1810 pass; `test:webview` 64 pass; `test:ui:space` 217 pass; `test:ui:studio` 337 pass after one fix (`f262f96dd`: `.is-fk` marker read by `slick-grid.spec.ts`). Visual before/after in scratch worktree at `363cb6622`: Studio 13 and Space 4 specs, zero diff. No baseline touched. Excluded paths (section 3.1) untouched.

Accepted drift:
- Retry button in review load-error zone: `dialog-danger`/`xs` variant, so height, radius, hover tint differ from old rule (D5). Not covered by a visual spec.
- `bg-error/12` mixes in oklab, old rule in srgb. Imperceptible.
- `antialiased` also sets `-moz-osx-font-smoothing`. No effect in Chromium/WebKit.

Unverified: Retry-button and load-error zone appearance (no spec renders it); real-hardware scrolling not checked.

## P214 result

`AddMemoryDialog.vue`: rows UI replaced by one free-text box (1000-char cap, counter). Sends one item with fixed manual reason; gate splits, challenges, reconciles. Challenge block and outcomes list unchanged. No Go, store-path or model change. `memory-module` Playwright test updated for free text and two outcomes.

Checks: typecheck, lint (no errors), lint:dead, `test:ui:space -- memory-module` 4 pass.

## P215 result

4 commits (`22a8d685d`..`dfd8197f0`) plus docs. No single regression; several costs grew, one test helper booted twice.

Fixes:
- `openPlan` passed no clock to `relaunch`, then installed clock and reloaded: two full boots in 108 calls across 17 space specs. Now passes `clockTime`.
- `typecheck:*` now `--incremental`, one `tsBuildInfoFile` per project under `node_modules/.cache/tsbuildinfo` (ignored). Injected type error still reported.
- `check-theme-classes.sh`: first pass records default-scope names, one combined alternation per family. Zero hits skips ~110 per-name greps; any hit runs the unchanged per-name checks. Injected `text-muted` (`.vue`) and `muted` (git-ui class attr): output and exit code byte-identical to the old script.
- 43 MB root `kira-space` binary untracked; `/kira-space`, `/kira-studio` ignored.

Measured, warm, second run (seconds):

| Stage | Before | After |
|---|---|---|
| `check-theme-classes.sh` | 5.9 | 2.0 |
| `bun run lint` | 11.5 | 7.3 to 8.1 |
| `bun run typecheck`, no change | 41 | 17.8 |
| `bun run typecheck`, leaf edit | 41 | 18 |
| `bun run typecheck`, cold | 41 | 41.5 |
| `test:ui:space` (227 pass, incl. 6 s build) | 275 | 220 |
| `lint:dead` | 3.2 | 3.8 |

Left slow, for a real reason: studio UI (~590 s) and the rest of the suite are CPU-bound at 3.9x on 4 cores. Each test opens a fresh WebKit page and answers every RPC through `page.route` mocking (20 to 130 ms per fulfil). Replacing it with a local mock server is a test-infra redesign, not a regression fix. Mobile tests hit a real local server: 1.0 s median. Pre-push (warm) 11 s, not slow. Cold `go build` 97 s is wails cgo, only after cache wipe.

Not done: TS project references (`composite`, `vue-tsc -b`) would dedupe 583 files shared across programs; own phase if wanted.

## P216 result

Removed in P224 (user dropped speech to text).

## P217 result

One Opus round, base `4e57accbe`: 7 findings (1 high, 1 medium, 5 low), all fixed.

- mobileterm: phone input no longer holds the entry lock across the PTY write (separate write mutex,
  deadlock test). `Serve` re-checks device and permissions after `Attach`. Ring grows lazily to 1 MiB.
- mobileweb: `maintain` polls addresses each minute and rebinds (new leaf, listeners added and removed,
  status event via `OnStatusChanged`); `ARCHITECTURE.md` now matches. Agent session route and SSE drop
  `cwd`. `Publish` skips marshalling with no subscriber.
- importer: skipped directories count as one ignored entry, no walk. Dialog copy "files and folders ignored".
- Biome warnings and infos cleared (unused import, stale suppression; rules off for tests and shadcn names).

Verification: `go build ./...`, `go test -race` mobileterm, mobileweb, importer, bridge; golangci-lint
2.13.2 (0 issues); typecheck, lint, lint:dead; Playwright space-mobile 51 pass, 1 skipped;
memory-import and memory-module 6 pass.

Not verified: rebind on a real network change (tested with loopback 127.0.0.2).

## P221 result

Memory setup moved to Kira Space Settings > Memory (D1 to D4 defaults from the plan applied).

- `MemoryPane.vue` composes `ClaudeCodeMcpSection`, `SemanticModelSection`, `DictationModelSection`
  (`packages/workbench/src/memory/settings/`). Dictation download moved too.
- `useModelDownloadsStore` keeps the download `AbortController`; Cancel works after reopening Settings.
- Module: plug button, Connect dialog and `SemanticStatus` removed. `MemorySetupHint` and the mic popover
  link to Settings through `MemoryModuleContext.openSettings`.
- Nested case checked: Settings opened from the Add memory dialog stays interactive.
- Commits 1 and 2 merged: hook cannot pass with `ConnectClaudeDialog` deleted but still imported.
- Accepted: a failed-download message is per component instance; reopening Settings after a failure shows
  the download button without it.

Verification: typecheck, lint, lint:dead, Playwright memory, settings-memory, settings-claude-code, then the full
`test:ui:space`.

## P219 result

Quick-command collections are rows (`custom_script_collections`, Studio migration 0033, Space 0023),
created, renamed inline and deleted like API collections; deleting one deletes its commands. Both
modules have a "Move to collection" context submenu (shared `moveToCollectionMenu`); API `MoveItem`
moves a request or folder with its subtree to another collection's root. The quick-command dialog
gets a "Choose…" native folder picker. Facts live in `docs/ARCHITECTURE.md` (schema, Terminal
module, API collections).

Defaults taken: collections order by creation; delete cascades to commands (API parity); dialog
collection field is a select (new collections come from the panel); collapse state re-keyed by id
under a new local-storage key; no drag and drop.

Verification (Linux): `go build ./...`, `go test -race` on quickcommands, both bridges and both storage
trees (new migration test, new `MoveItem` repo test), golangci-lint 2.13.2 (0 issues), typecheck, lint,
lint:dead. Playwright: terminal-module, collections, terminal-quick-commands green. Full Studio UI
suite: 321 pass; 23 fail in `sql-schema.spec` (Monaco typing hangs, also on the pre-P219 base) and
`slick-grid.spec` (load timeouts; the checked ones pass alone). Full Space UI suite: 215 pass; the 22
failures are 1.1 min load timeouts in ADE and repo-graph specs, all but one pass on rerun, and that
one passes alone. Visual baseline `quick-commands-dialog` regenerated locally on Linux; regenerate on
the CI image if it differs.

## P220 result

Facts in `docs/ARCHITECTURE.md` (commit-grid notes, Git panel segment).

Graph root cause, confirmed: `CommitGrid` seeded the graph width from `laneCount` at mount, before the
layout worker answered. 0 lanes gave 17px. The row SVG clips lanes past the column edge, so every lane-0
edge and half of each node vanished. Every new repo tab is a first-ever mount, so each hit it. Restored
tabs kept the persisted width and looked fine. Fix: width floored at 40px (heals persisted narrow
values), seed deferred to the first layout with lanes, applied once. Click and scroll symptom on macOS
is inferred (paint before clip applies, then repaint); not reproduced here.

Tab fix: `useRepoPanelTabStore` backed by `useLocalStorage('kira.git.panelTab', 'repos')`; GitPanel
`repoId` watcher (forced Files on every mount) deleted; shows Repos while no repo is active.

Specs: `repo-graph-lines.spec.ts` (pixel check of lane 0, first mount with click and scroll, restored
tab with persisted 17px) and `git-panel-tab.spec.ts` (3 cases). Both failed before the fixes (width
17 against >= 43 / >= 40; tab Repos not selected / Review not kept) and pass after. Existing
`repo-workspace` (5 tests) and `repo-graph-lifecycle` (1) now click the Files tab after opening a repo.

Deviation: the reload case is asserted with Review selected before the reload, but on the old code it
fails at its first assertion (Files forced), not at the post-reload line.

Checks: typecheck, lint, lint:dead clean; `test:unit` 1810 pass; full Space UI suite 241 pass, 0 fail
(no load-only failures). Not run: `test:webview` and `test:visual:space` (shared seed path in the VS
Code webview; no graph baseline checked). Run both before merge.

Mac handover: open a never-opened repo, confirm lane lines show, click rows, scroll. Switch modules and
restart; confirm the Git panel tab is kept.

## P224 result

Speech to text removed: dictation UI and queries, the `stt` package, `DictationService` and stream, `memory-stt`
shim, malgo, whisper.cpp build, S13, microphone plist strings, CI patch and docs. Kept `modelstore`, `workerproc`,
the embed worker and the webview microphone deny. Space deletes `models/whisper-small.en-q5_1-5359861` at
startup (`modelstore.RemoveRetired`). `modelDownloads` store lost its `kind` parameter; S10 no longer skips
`build` dirs. Checks green: go build/vet/test -race, golangci-lint, typecheck, lint, knip, unit, `test:ui:space`
(231 pass).

## P222 result

Facts in `docs/ARCHITECTURE.md` (Storage, per-repo colour and deployment environments bullets).

Dialog: Settings-shaped (header icon, ghost close, left nav with colour dots, "Scan folders" nav entry,
footer with Remove and Close). Chip tabs and corner close button gone. Form grouped into Repository,
Worktrees, Branches, Deployment environments.

Colour: stored on `code_repos` (migration 0024; plan said 0023, taken by P219). `repoColor()` hashing
deleted. Picker in the dialog and a Colour submenu on Git panel repo rows.

Environments: they track deployed commits (command prints the SHA). Add always failed before (empty
script rejected as "new-env"); now a draft row is written once name and command are filled. No separate
terminal setup hook built: Prepare worktree is the per-repo setup script, now described as such.

Deviations: the dialog and environment commits are one commit (same files, not splittable without
patch staging). Migration 0024 not 0023. Fixtures and specs gained `color: 'none'`. No Go unit test
added (CRUD path).

Mac handover: open Repositories from the Git panel, compare with Settings, pick a colour and check the
nav dot, Git panel icon, repo tab rail and ADE repo tags; add an environment and refresh the board.

Checks: `go build`, `go test -race` (palette, quickcommands, storage, bridge, codeworkspace, ade),
golangci-lint, typecheck, lint, lint:dead clean; full Space UI suite 249 pass, 0 fail. Fails:
`test:visual:space` all four Settings baselines, unrelated to P222 (no Settings file touched; the
Settings nav gained Memory in P221, so the baselines predate it, and text antialiasing differs on this
machine). Not re-recorded. Re-record on the reference machine.

## P223 result

Facts in `docs/ARCHITECTURE.md` (Mobile agents web, Known open items), `docs/DEV_ENVIRONMENT.md`,
`docs/PACKAGING.md`.

Done: PWA, local CA, leaf issuance, HTTPS and setup listeners, setup page and the pane's certificate
step removed. One plain-HTTP listener on the trusted interface's IPv4. Three LAN checks: peer must be
private or link-local IPv4 inside the bound subnet; exactly one bound address (no wildcard, no
loopback), rebound on address change; "Trust this network" (subnet, router IP, router MAC) with a 10 s
supervisor that stops and starts the server and shows why. Plaintext warning in the pane, one line on
the phone, device tokens expire after 30 days. New package `internal/lannet` (Linux `/proc`, macOS
route RIB), migration 0025 (plan said 0023; 0023 and 0024 taken by P219 and P222), cookie
`kira-space-device`, legacy CA files deleted at boot.

Deviations: no `kick` channel; Trust and Forget run one reconcile pass synchronously, so the returned
status is current. `mobileweb.Config.IsLAN` is an exported test seam (the plan said the bridge test
needs none, but `Start` refuses loopback by default). While the supervisor is off the bridge `Status`
reads the current network on demand, so the pane can offer Trust before enabling. Fixed a bug found by
the new insecure-origin spec: a fresh pairing never read its permissions, so writes showed off until
a reload (`fix(mobile)` commit). Live curl check against a LAN address skipped: this sandbox has only
`192.0.2.0/24` (not private; `lannet.Detect` correctly answers "not a private local network") and no
`ip` tool to add an address. Covered instead by the live `mobileweb` integration tests on loopback and
the bridge supervisor test.

Mac handover: enable the pane on a Mac, Trust this network, check the macOS Local Network prompt, scan
the QR, switch Wi-Fi and see the stop reason, switch back. Remove the old "Kira Space local CA" profile
from phones.

Checks: `go build`, `go vet`, darwin `go vet` of `lannet`, `go test -race` (lannet, mobileweb,
mobileterm, bridge, storage), golangci-lint 0 issues, typecheck, lint, lint:dead clean;
`build:space-mobile` output is `index.html`, `favicon.ico`, `assets/` and holds none of `randomUUID`,
`serviceWorker`, `crypto.subtle`, `navigator.clipboard`, `isSecureContext`, `workbox`;
`test:ui:space-mobile` 51 pass (1 WebKit skip); `test:ui:space` 244 pass, 0 fail. Visual baselines not
run and not re-recorded (Settings snapshots differ since P221 and again now).

## P226 result

- `colorMarkClass(mark, color)` in `packages/theme/src/connColor.ts`: marks `rail`, `bar`, `dot`, `band`; paint is literal `bg-conn-*`, no `--kira-rail`.
- Canonical look: Studio tree rail (2px, full row height, panel edge). Quick commands, Git panel repos and worktrees, Repositories dialog now use it. Play and source-control icons stop carrying colour.
- Tabs, view header dots and bands, Start recents, op log cell, environment dots all go through the map. Op log cell: 8px square became the 5px dot.
- Fixed DataView header dot: `'none'` now shows the ring like every other view.
- `scripts/check-theme-classes.sh` guards `bg-(--kira-rail)`; retired-class replacement texts point at `colorMarkClass`.
- Specs: new `color-rails.spec.ts` in both apps pin one class string and geometry. `connections`, `tabs`, `api-ui-consistency` style assertions became `bg-conn-*` class checks.
- Pinned repo-graph tab stays unmarked. ADE chips and view-header icon tints unchanged.

## P225 result

Facts in `docs/ARCHITECTURE.md` (commit-grid notes). Two root causes; neither
came from the last 36 hours. P220 widened the first-mount column from 17px, which made both visible.

A. Outer-lane commits lost their dot. `CommitGrid` applied the P220 seed once, on the first layout with
lanes. That layout covers the first 500-row chunk only, so the column fit 2 to 4 lanes while the page
needed up to 8; the row SVG clips nodes past the column edge. Fix: the auto width follows `laneCount`
(grow-only, capped at the six-lane default, not persisted) until the user drags the column.
B. A merge's second-parent line vanished, worst after Load more. A branch-out edge into lane N that
later converged into lane C had its `toLane` overwritten with C. The record held no lane N, so the run
drew on the source lane, on top of its own node line. Fix: `EDGE_RUN_LANE`, set at append, never
patched; `edgeCommand` draws from `fromLane`/`runLane`/`toLane`. Output is unchanged for straight,
branch-out and straight-then-converge edges.

Specs missed it: `repo-graph-lines` has one 300-row chunk and two lanes; no Space UI spec clicked Load
more; `lanes.test.ts` covered straight-then-converge only.

Specs: `repo-graph-paging.spec.ts` (2000 commits, 500-row chunks, two 1000-row pages, Load more; checks
clipped nodes and stacked runs per visible row) and a `lanes.test.ts` case (one pass and paged).
Pre-fix failures, same tree minus the fixes:
- clipped: `row 1001: cx 43.5`, `row 1002: cx 56.5`, `row 1003: cx 69.5`, `row 1004: cx 82.5`,
  then lanes 1 to 3 again at rows 1052-1054 and every 50 rows after (column 43px; fan rows need 6).
- stacked: `row 6: runs 17.5 nodes 17.5`, `row 7: ...`, repeating every 10 rows (second-parent line
  drawn over the node lane).
- `lanes.test.ts`: `SyntaxError: Export named 'EDGE_RUN_LANE' not found`. Scratch check on the old
  layout: edge `5->8` of the same shape is `fromLane 0, toLane 0`.

Deviation from the plan: the first lane-aware width may shrink the column (from the 95px default to
the lane width, as P220 did); only later steps are grow-only. Plan D2 as written would have kept 95px
and dropped P220's narrow column.

Not changed: Refresh or auto-refresh after Load more re-walks one page (`Walk.Stream` ignores
`resumeThroughRow` after a reset), so loaded commits drop out of the list. Behaviour since G16,
accepted by P203. If this is the "commits disappear" the user saw, it needs its own row. Also not
changed: `UncommittedChangesStrip` sizes its graph cell from `columnWidths.graph` (default 95), so it
can misalign with an auto-sized column (since P92).

Mac handover, on a never-opened repo with 5000+ commits and many branches:
1. Scroll past the first few hundred commits; outer-lane commits keep their dots.
2. Find a "Merge branch 'main' into ..." commit; its second-parent line runs in its own lane to the
   main commit, not over the feature line.
3. Click Load more; lines above stay put, new commits show dots.
4. Drag the graph column narrower, Load more again; the column keeps the dragged width.
5. Load more, then Refresh or fetch; the list drops to one page (existing re-walk). Ask whether
   "commits disappear" meant this.

Checks: typecheck, lint, lint:dead clean; `test:unit` 1812 pass; `repo-graph-*` specs (11) pass; full
Space UI suite 246 pass, 0 fail; `test:webview` 64 pass (the webview renders the same `rowSvg.ts`).
Not run: `test:visual:space`. Workers=1 was needed locally for the new spec under load; the full suite
ran with the default config.

## P228 result

Facts in `docs/ARCHITECTURE.md` (commit-grid notes). Resizing did break it; two deterministic causes,
both engines (WebKit and Chromium).

A. Wide columns overflowed the viewport. `computeMessageWidth` floored the message column at 120px, so
graph + author + date + 120 could exceed the viewport; SlickGrid sized the canvas to the sum and a
sideways wheel scrolled the graph column off screen (resize handles stayed put). A row click opened the
detail pane (compact columns fit) and the graph returned. Fix: `columnFit.ts` computes effective widths
(author, then date shrink; graph never does; drags stop at a 120px message column via handle `:max`),
stored widths stay preferences, and the viewport's `overflow-x` is forced hidden as a last guard.
B. Any graph drag froze the column below what later lanes need. P225's growth only ran in auto mode,
and a drag, a restored view state, or a repo with 7+ lanes left the column too narrow after Load more.
Fix: a grow-only lane floor per mount applies in every mode; the six-lane auto cap is gone (12 lanes,
173px max); the graph handle `:min` follows the floor.
C. `UncommittedChangesStrip` took the persisted width. `CommitGrid` now emits `graphWidth`; `App.vue`
binds it (not persisted).

Not reproduced: row gaps, missing rows, lost nodes mid-drag, anything after detail-pane drags. Load more
completed after every resize sequence. P225's open item (Refresh after Load more re-walks one page) is
unchanged and still has no row.

Specs: R1 and R2 in `repo-graph-paging.spec.ts` (resize, wheel, click, window shrink, Load more).
Pre-fix failures, WebKit, same tree minus the fixes:
- R1: `scrollWidth 1355 > clientWidth 1148` after dragging graph, author and date +300 each.
- R2: 61 clipped entries: `row 1001: cx 43.5`, `row 1002: cx 56.5`, `row 1003: cx 69.5`,
  `row 1004: cx 82.5`, `row 1052: cx 43.5`, `row 1053: cx 56.5`, `row 1054: cx 69.5`, `row 1102: cx 43.5`.
`columnFit.test.ts` covers shrink order, minimums, compact, auto vs user graph width, drag maximums.

Deviations from the plan: `fitColumns` takes `graphAuto` as already combined with "lane floor known"
(caller passes `laneFloor > 0 && graphAuto`); `effectiveGraphWidth` is exported so the graph formatter
reads the same rule without a layout read per cell. The `!important` guard is Tailwind
`@apply kv:overflow-x-hidden!`, because biome flags a literal `!important` and its suppression does not
apply inside Vue `<style>`. R1 polls after the window resize and scrolls to row 3 before clicking (the
diagonal wheel had scrolled it away). D1 to D5 took the plan defaults.

Checks: typecheck, lint, lint:dead clean per commit; `test:unit` 1822 pass; `repo-graph-*` specs (13)
pass in WebKit; R1 and R2 pass in Chromium (temporary `test.use`, not committed); full Space UI suite
250 pass, 0 fail; `test:webview` 64 pass. R1 failed once under `--workers=2` load alongside other
work, then passed three times in a row (workers 1 and 2). Not run: `test:visual:space`.

Mac handover, on a repo with 5000+ commits and more than 6 concurrent branches:
1. Close the detail pane. Drag author and date as wide as they go: the drag stops with the message
   column about 120px wide; no horizontal scrollbar.
2. Swipe diagonally over the graph: rows scroll vertically only; graph and dots stay.
3. Shrink the window: author shrinks first, then date; the graph column keeps its width.
4. Drag the graph column as narrow as it goes: it stops at the width of the lanes in view. Load more:
   the column widens as deeper rows add lanes; no dot is cut.
5. Rows with lane 7 or more: dot visible without any drag.
6. The uncommitted-changes strip's dot lines up with the first row's lane.
7. Quit and reopen: widths persist; a column the window cannot fit shrinks, then returns when the
   window grows.

## P227 result

Review: 3 Medium, 9 Low, no High (base `7f626e91a`). All fixed; none declined. Findings file deleted.

- M1: device expiry was checked only at request start. `handleEvents` now ends at `ExpiresAt` (timer),
  the terminal `authorized` callback checks it, and the one-minute `maintain` sweep (`sweepExpired`)
  calls `DisconnectDevice` and `ReleaseDevice` for devices seen by `withDevice` and now expired. Done
  with an in-memory id-to-expiry map, not a `DeviceStore.List`: no interface change. Test
  `TestSweepExpired_EndsStreamsAndTerminals`.
- M2: `repoColorOf` in `repoLinks.ts` follows the worktree anchor; used by `tabKinds.ts` and the six
  ADE callers. `GitPanel.vue` needed no change: both its rails already paint the anchor row's colour.
  Spec `color-rails.spec.ts` worktree case fails before the fix (`amber` vs `cyan`).
- M3: 12 Studio and 4 Space baselines re-recorded in the dev container; diffs are Inter text, the
  Docker module (Studio) and Memory, Mobile access, Claude Code nav entries (Space). Added the Memory pane
  baseline; the Space settings spec now mocks `memoryMcpStatus` (unmocked, the pane rendered a fixture
  error). Both visual suites green. The container's WebKitGTK may differ from the CI `ui` job image;
  regenerate on CI if it disagrees.
- L1: `lannet.Find` returns `ErrNoRouterMAC` for a missing ARP entry. `evaluate` needed no new case: its
  default branch already maps it to `mobileStopUnavailable` with the error text.
- L2: the supervisor logs a start failure once per distinct message.
- L3: environment writes chain on one promise and build their list at run time.
- L4: colour change returns its promise.
- L5: `useNow` with a 60 s `useIntervalFn` scheduler (this VueUse has no `interval` option).
- L6: `handleChunkLayout` comment back on its function.
- L7: edge kind removed. `EDGE_STRIDE` 6, `PATCH_STRIDE` 3; tests assert lanes.
- L8: both sub-bar tests deleted (expired device is a row in `TestAuth_Verdicts`).
- L9: P225 row Done, `P225-plan.md` deleted, README reworded.

Checks: lint, lint:dead, typecheck clean; `test:unit` 1812 pass; Go `mobileweb`, `mobileterm`,
`lannet`, `bridge` pass (`-race` on the first two); `test:visual:studio` 13 pass, `test:visual:space` 5
pass; full Space UI suite 248 pass, 0 fail.

## P229 result

Facts in `docs/ARCHITECTURE.md` (Git module section, "Git module follows the app look"). All DD1-DD7
plan defaults taken. 5 feature commits plus the visual baseline commit.

Done: Space surfaces `#1f1f1f`; commit rows 28/22px with Appearance density (live switch checked, 28 to
22 without remount); badges 1px border plus 15% tint, normal weight; toolbars, search rows, review
toolbar on the `ViewToolbar` recipe; `Alert` banners; every raw codicon span is `CodiconIcon` 13px;
`rowVariants` `menu`/`tree`; menus one line with muted 13px icons and trailing detail; `Empty` panels
and placeholders; detail meta `px-3 py-2` with muted "Show more"; 15 dialogs on the header-close,
padded-body, Cancel-first recipe.

Deviations from the plan:
- `FileTree` indent is `8 + depth * --kv-tree-indent`. The host setting stays, so Space shows 8px per
  level (app tree: 14). No Space source for the setting exists.
- Separator height is `h-3.5`; `h-control-inline` is a `kv:`-only spacing name.
- No folder icon added to tree rows: directory rows never had one (chevron only).
- Cell padding change also covers `CELL_PADDING_PX` (date probe), as planned; strip SVG uses `100%`/`50%`
  instead of a measured height.
- `graph-columns.spec.ts` (webview) asserted a transparent tag badge; it now asserts the 0.15 tint.
- Contrast (fg `#cccccc` on 15% tint, dark): over `--kira-bg` lanes 7.3-9.2, kinds 7.6-8.9; over
  `bg-select` lanes 5.5-7.4, kinds 5.6-6.7. All above 4.5.

Checks: typecheck, lint, lint:dead clean per commit; `test:unit` 1822 pass; `test:webview` 64 pass;
`test:visual:space` 8 pass (5 Settings baselines unchanged, 3 new); `test:visual:studio` 13 pass, no
change; full Space UI suite 251 pass (workers=1). `repo-graph-paging` "columns resized wide"
drag spec flakes at `--workers=2` under load, passes at 1.

New baselines (`git-module.spec.ts-snapshots/`, linux): `git-graph`, `git-graph-detail`,
`git-stash-dialog`. Commit times are 3.5h before the run so relative dates stay stable.

Mac handover: record or compare the 3 new git-module baselines on the Mac CI image
(`test:visual:update:space`); not run on macOS here.

## P230 result

Root causes:

- C1: board opened repos with the raw `git.gitPath` setting (`""` by default), so `exec.Command("")`
  failed every open. Board read fell back (chip `never fetched`); Refresh returned
  `Unknown: git rev-parse --is-bare-repository failed (unknown): exec: no command`. Every ADE test
  harness set `GitPath` to `git`, so none caught it. Fix: open with `GitStatus().Path`; `TaskBoardDeps.GitPath` deleted.
- C2: no remote returned a `NoRemote` error row. Fix: skip only the fetch; rest of the refresh runs; chip reads `no remote`.
- C3: `lastFetchAt` stat'ed the common dir's `FETCH_HEAD`; git writes it per worktree. Fix: `Summary.GitDir`.
- F4: `repoFacts` sets `remote` and `lastFetchAt` before `collectRepo`, so a later failure cannot read as `never fetched`.

Pre-fix failures (test commit `e4d08c490` alone):

- G1: `board repo remote="" lastFetchAt=<nil>, want origin and a fetch time` (log: `exec: no command`)
- G2: `row error = {Kind:NoRemote Message:this repository has no remote configured}, want none`
- G3: `lastFetchAt is nil after a refresh of a linked worktree root`
- U1: `Expected: "no remote"`, `Received: "never fetched"`

Deviations:

- `TestTaskBoard_notCreatedAndTooOldGit` was not cached before `tooOld` as the plan assumed (first
  board call came after the status switch); it now warms the cache with `openRepo` first.
- G1 after F1 sets `GitStatus` to the absolute `exec.LookPath("git")` instead of the `GitPath` override.
- D1-D4 taken as default.

Checks: typecheck, lint, lint:go, lint:dead clean; `go test ./apps/kira-space/...` pass; `ade-v2-` UI
specs pass; full Space UI suite 248 pass, 1 fail under load (`ade-v2-panel` handle-drag width; passes 3 of 3 alone with `--workers=1`; unrelated).

Mac handover:

1. Settings > Git > Git executable path empty. Agents > Plan: chips show a time (`5m ago`), not `never fetched`, for any fetched repo.
2. `Refresh all`: `fetching…`, then `<n> refs changed` or `no changes`; no red text; no `exec: no command` in the console log.
3. Repo with no remote: chip reads `no remote`; `↻` tip reads `Rescan … (no remote to fetch)`; click: `no remote · no changes`, not red.
4. Repo with a bad remote URL: red classified message stays.
5. Set Git executable path to a real git (`/opt/homebrew/bin/git`), relaunch, `Refresh all`: same as step 2.

## P231 result

Tests: 76 Go flow tests (48 subtests) in `internal/flows/{gitflow,repoflow,editorflow,adeflow,memoryflow,termflow,appflow,mobileflow}`, 15 `e2e-real` specs. Every finding test is un-skipped and green. Green: `go test ./apps/kira-space/...` with `KIRA_FLOW_COMPLETE=1`, `e2e-real` tier (15), `test:ui:space` (251), `test:webview` (64), lint, typecheck, `lint:dead`, golangci-lint.

Findings fixed:

- A1: `graph.refresh` after Show more kept one page. A walk reset now remembers its loaded rows; the next `graph.stream` re-reads pages until the store holds them again. Design: whole pages, so the new commit shifts the last old row out; test asserts at least the old row count.
- A2: reloaded Review pane and diff tab compared on a connection holding no repo. The native git transport sends `repo.open` once per repo before the first request or stream naming it. Fixes Retry too.
- A3: `EmitTo` in the `-tags server` build found no window. It now broadcasts (`internal/shell/emitto_server.go`); native build unchanged. Terminal output and `open-session` share the path; only code search is asserted end to end.
- B-1: remote-only branch attach. `ensureWorktree` uses `newBranch` from `<remote>/<name>` (origin preferred), so the branch tracks its remote.
- B-2: open repos ignored a changed `git.gitPath`. `Repo.SetGitPath`; the registry and `TaskBoard.openRepo` re-apply the live setting. `tooOld` still reads through an open entry.
- B-3: `SetPort` reconciles whenever the supervisor is active, so a server stopped by a busy port retries on the new port.
- B-4: `/api/ade/sessions` passes through `withoutCwd`; the reads test compares against the bound result minus `cwd`.

Harness: `GhLocator` (`WithoutGh` finds no gh; `TestGitHubWithoutGh` asserts `ghMissing`), archive window closes go through the bound `CloseWindow` hook (`TestArchiveRisk` asserts the recorder), `TrackerGrace` and `MobilePoll` in `appwire.Options` plus `WithTrackerGrace`/`WithMobilePoll` (interactive session wait 60s down to 2s), fake `claude` without `init` line under json output, inline `--mcp-config`, scenario `prompts` rules (gate, reconcile, extract per document, fail budget, hold); `memoryflow` and `memoryGate.ts` shims gone. e2e-real fixture writes login-shell profiles; per-test workaround dropped. Fixed on the way: the e2e-real fake read `KIRA_FAKE_SCEN` as JSON though the fixture sets a path, so every e2e scenario was ignored.

Also fixed: `CommitGrid` threw `RowPlan.entryAt/storeRowAt out of range` on a click or scroll frame landing on an emptied plan (made `repo-graph-paging` flaky); `TestSemanticUnavailable` renamed `TestSemanticNotInstalled`.

Deviations:

- Not changed, by design: `pathLocator` PATH fallback, `appearance.dateFormat` reaching git only through `app.init`, git-ui reading `app.init` git status only once a repo opens. Tests keep their current assertions.
- Open question from B-4 left as is: board `branches[].worktree` is a local path the phone sees.
- `repo-graph-paging` still fails about one run in 80 under 8 workers (drag step timeout, test-level load flake, also on the base transport).
- Test git emits `fatal: expected 'acknowledgments'` warnings on push in e2e-real helpers; pushes succeed.

Mac handover: on a desktop build, open a terminal tab and an ADE session and confirm output renders in the right window only (native `EmitTo` is untouched); reload a Review pane with the graph tab closed and confirm it compares.

## P233 result

Scope cut by the user mid-phase: hooks only. No MCP injection, no endpoint file, no `claudecfg`
package, no cleanup UI or migration; Kira Space "Register with Claude Code" and Studio Database MCP
Install stay exactly as before. Earlier commits for the larger scope are net-reverted by
`67f8e9ba3`.

Audit (`rg` over apps, internal, packages, scripts, plus git history): no code writes hooks into
`~/.claude/settings.json`, project `.claude/settings.json` or `.claude.json`. Hooks already ride a
per-session temp file passed as `--settings`, plus `KIRA_*` env set only on Kira launches
(`internal/agenthooks`). Earlier versions never wrote Kira hook entries into real settings, so no
cleanup exists.

Change: the hook shim exits 0 at once unless `KIRA_AGENT_HOOK_TOKEN` and `KIRA_TERMINAL_ID` are
set, so a stray copy never reaches the server.

Tests:

- `TestShimInertWithoutSessionEnv` (`internal/agenthooks`): real shim against a counting unix-socket
  server. Pre-fix failure: `shim without session env reached the server 3 time(s), want 0`.
- `claudeflow.TestClaudeSettingsUntouched` (`apps/kira-space/internal/flows/claudeflow`): fake HOME
  with seeded Claude config; mode+sha256 identical after a terminal agent session, an ADE session
  start and an app restart; launch argv carries one `--settings` path outside the fake home. Passes
  pre-change too, since hooks were already per-session; it is the regression guard.
- Final tree: Go packages touched, all Space flows, lint, typecheck, knip, test:unit 1822, Space UI
  251, Studio UI 347 (3 load flakes passed under `--workers=1`), e2e-real Space 12 pass 2 skipped
  (`ade-board-real` flaked once on git push negotiation, passed alone), test:webview 64.

Deviation from plan: plan covered MCP injection, endpoint file, `claudecfg` and a cleanup step; all
dropped per user instruction.

Mac handover: run a Kira Space agent session, then `ps` shows `--settings` only (no `--mcp-config`);
a plain `claude` in a terminal shows no Kira hooks; `shasum ~/.claude/settings.json` unchanged
after using the app.
