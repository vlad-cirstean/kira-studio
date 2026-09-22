# Kira Studio — v1.9

v1.8 closed with `P94` (four-pass code-quality tooling — complexity/dead-code/performance linters,
pre-push hook, CI wiring) and `P95` (`errcheck`/`staticcheck`, not yet started) still on its own
table. `P94`'s own plan (`docs/v1.8/plans/P94-code-quality-tooling.md` §2) named a fourth pass —
the full-suite flake sweep, enabling nothing new — that never landed; v1.8's own result section
says so directly: "No known open item beyond what pass 1 already opened as P95 and what §12 names
as pass 4's." This chapter continues `P` numbering (`P96`+) rather than taking a fresh letter, same
reason v1.6/v1.8 give: independent, unrelated phases, not one cohesive subsystem.

| Phase | Deliverable | Why here |
|---|---|---|
| **P96 Finish P94's pass 4: full-suite flake sweep** | `P94-code-quality-tooling.md` §2 planned four passes; passes 1-3 landed (`docs/v1.8/SPEC.md`'s own P94 row and result section). Pass 4 was scoped to enable no new rule and instead fix what a full-suite run surfaces: the one confirmed pre-existing flake named there (`http-request-body.spec.ts`'s form-data case, reproducing identically in isolation) plus whatever else `test:unit`/`test:webview`/`test:ui`/the Go suite turn up running clean together, not just the files earlier passes touched. This phase's own planning pass picks up exactly where pass 3 left off | Carries over v1.8's own last open item rather than leaving it stranded in a closed chapter; nothing else in this chapter depends on it, so it closes first before new scope starts |
| **P97 Drop repo-map/tree-sitter code intelligence; Biome lints Vue files** | Two bundled tooling-scope changes. (1) Remove the repo-map MCP server and its tree-sitter-backed code-intelligence engine entirely — `internal/repomap`, `cmd/kira-repo-map`, `internal/codeparse`, `internal/codeindex`, `internal/codegraph` (this app's own Go code-graph package — not the external `codegraph` CLI/MCP tool this repo's Claude Code sessions now use instead, per `CLAUDE.md`'s own CodeGraph section), the `internal/bridge/repomap.go` bridge surface, `internal/mcpinstall`/`internal/mcpauth` if repo-map was their only consumer, the Settings dialog's Code intelligence tab, `views/repo/navigation.ts`'s Monaco definition/hover providers, and `state/repomap.ts`. In-app code navigation (go-to-definition, hover, F12) is explicitly dropped, not replaced, by instruction. (2) Extend `biome.json` so Biome actually lints `.vue` files, not just `.ts`/`.js` — this phase's own planning pass confirms the pinned Biome version's Vue support and picks the config/rule set needed | Bundled: both are tooling/build-surface changes, unrelated to each other's code but the same "what the lint/build config covers" theme — this chapter's own precedent for small paired items (v1.8's P71/P73/P76) |
| **P98 Add shadcn-vue, Tailwind CSS, VueUse, Pinia, TanStack Query as standing deps; codify Vue conventions in `CLAUDE.md`** | Prep only — no existing `.vue` file gets migrated in this phase. Add these as standing dependencies and wire in whatever minimal bootstrap each needs to be usable at all (Tailwind's CSS entry point and build/config wiring, `clsx` + `tailwind-merge` alongside it; shadcn-vue's own init/config; a Pinia instance registered at app bootstrap; a TanStack Query client/provider wired in) — bootstrap plumbing only, not a rewrite of any existing component, store, or styling. VueUse is added as a dependency with no bootstrap step needed. `CLAUDE.md` gets a new standing rule: every future phase's own planning pass adapts its design/approach to lean on these rather than hand-rolling equivalents — explicit instruction, e.g. a new UI surface's styling goes through Tailwind rather than custom CSS even where the spec requesting it didn't say so, and functionality reaches for these libraries rather than a shortcut equivalent. Two more standing Vue rules land alongside, also codified in `CLAUDE.md`: every component strictly `<script setup lang="ts">` (Composition API only, no Options API), and Pinia stores follow single-responsibility — one store, one concern, never a grab-bag app-wide store. This phase's own planning pass confirms each library's minimum viable bootstrap wiring and states why nothing more is touched here | Foundational for P99 and every Vue-touching phase after this one — lands the dependency + convention baseline before any migration starts, so P99 migrates onto libraries already wired and configured rather than doing setup and migration in the same pass |
| **P99 Part 1: shadcn-vue component set; every store on Pinia; every ad hoc fetch on TanStack Query** | Plan: `docs/v1.9/plans/P99-vue-migration.md` (one document covers all four parts; §0-§4, §5, §9-§14 are Part 1's). No `.vue` file's styling, primitives or composables change here. Fetch and land the shadcn-vue component set (§4 — `shadcn-vue add` cannot run in this sandbox for the reason P98 root-caused; a verified direct-registry `curl` procedure replaces it). Convert all 45 module-level `reactive()`/`ref()` modules across seven directories to single-responsibility Pinia setup stores, splitting the two-concern ones (`state/schemas.ts`, likely `state/connections.ts` and `api/state/collections.ts`) and leaving a module with no shared state alone. Migrate `state/schemas.ts`'s `ensureDdl`, `state/maskRules.ts` and `views/grid/PreviewCommandPanel.vue` onto TanStack Query. Sweep every call site — the phase's single named cross-part touch, deliberately mechanical. Delete P98's seven knip bootstrap ignores. Also fixes `packages/git-ui/src/components/SearchResults.vue`'s dual `<script>` block (§2.3), the one deliberate crossing of the scope boundary | Scope, per that plan's §2: the 143 `.vue` files under `apps/kira-studio/frontend/src` plus the 45 reactive state modules beside them — **not** `packages/git-ui` (46 files) or `packages/kira-ui` (11), which have no Tailwind build, are git-ui's own primitive layer rather than this app's (measured: 0 `.vue` usages from the studio app), and which P100 extracts wholesale. **One touch per file** holds across the parts: every `.vue` file is opened for judgment in exactly one part. **One sequential subagent per part, parts in order** — no parallel fan-out, per-file or per-directory, by the original row's explicit instruction. Part 1 runs first so Parts 2-4 open every file with its state layer already final |
| **P99 Part 2: shell, chrome and the primitive layer (48 files)** | Plan §6. `App.vue`, `theme/` (22), `workbench/` (17), `project/` (7), `shortcuts/` (1) — 2,570 lines of scoped CSS. Per file, in one pass: shadcn-vue swapped in for the hand-rolled primitive, `<style>` block converted to Tailwind utilities, hand-rolled VueUse equivalents replaced, `<script setup lang="ts">` confirmed. Each `theme/primitives/*` wrapper **keeps its public prop/emit/slot API** while its internals move onto shadcn-vue (the repo's own `KuiContextMenu` G34 D8 precedent), so Parts 3-4's 95 files need zero edits from this part. Carries the phase's two hardest calls, each with a stated fallback and the `CLAUDE.md` obligation to name the requirement if a library is declined: `workbench/ContextMenu.vue` (a store-driven, point-anchored singleton vs. reka-ui's trigger-anchored menus) and the app-wide `v-tooltip` directive plus `workbench/state/tooltip.ts` | The layer everything else consumes — done before the views so they inherit converted primitives |
| **P99 Part 3: the API client surface (39 files)** | Plan §7. `api/` (19), `views/httprequest` (15), `views/grpcrequest` (5) — 1,607 lines of scoped CSS. Same per-file procedure as Part 2 minus the primitive rewrites, which Part 2 already landed | Grouped by product area, not by directory alphabetics: six field/header/param tables share one vocabulary, so a decision made in one carries to the rest inside the same pass |
| **P99 Part 4: data, repo, terminal and editor views, plus the phase-closing audit (56 files)** | Plan §8, §12.3. `views/{grid,console,shared,browse,definition,documents,keyvalue,stream,repo}` (45), `repo/` (8), `terminal/` (2), `editor/` (1) — 2,948 lines of scoped CSS. `views/grid/SlickGridHost.vue` (2,701 lines) and `views/console/ConsoleSlickGrid.vue` (934) carry **zero** `<style>` lines: their work is VueUse only. `views/repo/RepoTerminalView.vue`'s dual `<script>` block is fixed here and its P97 `biome-ignore` retired. Ends with the audit the original row demanded — eleven grep/count checks over the whole tree proving no leftover hand-rolled equivalent remains for anything these libraries cover, each hit either converted or declined with the requirement named, plus an informational a11y recount handed to P101 (measured, never fixed here). `docs/ARCHITECTURE.md`'s Stack row is updated from "P99 migrates" to "P99 migrated" | Last part, so the audit covers all four |
| **P100 Part 1: the Go extraction** | Plan: `docs/v1.9/plans/P100-kira-space-extraction.md` (one document covers all four parts; §0-§3, §4, §8-§11 are Part 1's). Go's `internal/` rule is the constraint the whole phase turns on: `apps/kira-space` cannot import one line of `apps/kira-studio/internal/` (§1.3), so eight packages hoist to a repo-root `internal/` first (`ipcerr`, `notify`, `rpcstream` — which deletes `layering_test.go`'s own standing exemption for it — `startupfail`, `logging`, `pathsafe`, a new `sqlitex`, a new `kirapaths`). Then the Wails app skeleton (`main.go`, `Taskfile.yml`, `build/config.yml`, dev port 9246, `com.kirathecat.kira-space`) and the 15 git packages move — the 13 the original row named **plus `internal/ghclient`** (importers: `gitrpc`, `gitsession`, nobody else) and **plus `internal/codeworkspace`** (the repo workspace's file/diff/search backend, importers: `bridge`, `main.go`), 272 Go files / 62,066 lines. Four bridge files, not three — `codeworkspace.go` joins `gitclients.go`/`gitstream.go`/`github.go`. Kira Space takes its own `~/.kira-space` home (`KIRA_SPACE_HOME`), its own `kira.db`, `review.db` and `git.sock` — a shared socket is impossible, `gitsock.Server.Start`'s flock makes the loser silently not listen. Plus a one-time, read-only import of the user's existing pairings/repo list, and a Kira Studio migration dropping the three git tables | The git slice's upward dependency surface is eight edges into three shared packages (§1.2), so the Go half is separable almost cleanly — but only once the `internal/` rule is solved, which is why it goes first and alone |
| **P100 Part 2: the frontend extraction** | Plan §5, §8-§11. 53 files / 8,238 lines move, not the ~20 the original row listed: all of `repo/` (21) **and all of `views/repo/` (23, which the row never mentioned)**, seven `state/` stores (now Pinia stores since P99 Part 1, not the reactive modules the row's prose names), and the two `workbench/` dialogs. **Three files under `views/repo/` are not git and stay**: `monacoEntry.ts` (the app-wide Monaco bootstrap `editor/monaco.ts` dynamically imports) and `monarch/{mongo,redis,decorators}.ts` (MongoDB/Redis grammars) — relocated to `editor/`, a P60a layering leftover. Those 53 files import 17 Studio stores and 10 `theme/primitives` components, so the real job is standing up a workbench for them: `apps/kira-space/frontend` on Tailwind/shadcn-vue/VueUse/Pinia/TanStack Query per `CLAUDE.md`, with a ported shell subset. Hoisting a shared `packages/workbench` and adopting `packages/kira-ui` as the primitive layer were both weighed and declined with the requirement named (§5.2). Kira Studio then drops `AppMode`'s `'git'`, and `WorkspaceKey` collapses to `AppMode` outright — `packages/shared/domain/workspace.ts` is deleted, not stubbed | The row's file list is the git leaf set; the leaves depend on most of the workbench, which is what makes this its own part rather than a file move inside Part 1 |
| **P100 Part 3: the extension rename, retarget and packaging** | Plan §6, §8-§11. `apps/kira-studio-vscode` → `apps/kira-space-vscode`, package `kira-space-vscode`, `displayName` "Kira Space", and every identifier renamed to the `kiraSpace.`/`kira-space` prefix: 62 command ids, 2 view containers, 2 views, 14 colours, 2 context keys, a comment controller, a menu group, 4 keybindings' `when` clauses and the `kira-version` virtual-document URI scheme — 373 `kiraVersion` sites plus 19 `kira-version`, 35 "Kira Version" and 77 "Kira Studio" across the extension and the four git packages, swept per-file (a repo-wide replace would rewrite the DB client's own name in `docs/`, `scripts/demo-dbs/` and `NOTICES.md`). The 11 `kiraVersion.*` settings keys are **not just VS Code identifiers** — they are `RepoSettingsSnapshot`'s key space in `packages/git-ipc/src/contract.ts` and the literal `key` column in `git_repo_settings`, so the rename is a contract change (`CONTRACT_VERSION` 39 → 40, both sides, plus its pinning test) **and** a data migration. Packaging needs no new mechanism: the `.vsix` already ships inside the app bundle and installs from the *Connected editors* pane, so the existing five-link chain is retargeted at `apps/kira-space/bin/kira-space.vsix` → `Kira Space.app/Contents/Resources/`. `.github/workflows/` changes go through `docs/pending-changes/` | Sequenced after Part 2 so the rename lands on a tree where Kira Space is already a real app |
| **P100 Part 4: the icon, the docs, and the phase-closing audit** | Plan §7, §10. The mark: Kira Space's own copy of the SVG changes its `#bg` stops from tan (`#D2A97C`/`#A3794C`) to the repo's own blues (`#3B9BE8`/`#0A5FA8`), deletes **all four** client glyphs at lines 31-55 — the database stack and sql cell grid by instruction, and **the document braces and message queue too**: a JSON-document mark and a Kafka/SQS mark say nothing on a git icon, and the four were drawn as one set — and replaces them with the commit-graph mark lifted verbatim from the extension's own `resources/icon.svg`, so app and extension become literally the same drawing. Kira Studio's icon is untouched. No rasterizer exists in this container (`rsvg-convert`/`inkscape`/`convert`/`magick`/`cairosvg`/`resvg`/`sips` all absent), so the two PNGs are rendered through Playwright's Chromium, with an explicit stop rather than a placeholder if it cannot install. Then `docs/ARCHITECTURE.md`'s seven git sections, `PACKAGING.md`, `DEV_ENVIRONMENT.md`, both READMEs — including three stale facts this phase's investigation found there (`startupfail` listed as a git package, "46 commands" for 62, `ContractVersion` 30 for 39). Ends with the eleven-check audit | Last part, so the audit covers all four |
| **P101 Fix the 255 `.vue` accessibility findings and delete the `a11y: off` override** | P97 turned `lint/a11y/*` off for `**/*.vue` (`biome.json`'s override) rather than hand-fixing 255 findings across 85 files that P99's shadcn-vue migration was about to rewrite anyway. Once P99 lands, re-run `biome check` with the override's `a11y: off` entry removed, fix every finding that migration left behind (`noLabelWithoutControl`, `useSemanticElements`, `useButtonType`, `noNoninteractiveElementToInteractiveRole`, `noStaticElementInteractions`, `useKeyWithClickEvents`, `useFocusableInteractive`, `noAutofocus`, and whatever else P99's own component swaps introduce or remove along the way), and delete the override entry — its removal is this phase's own acceptance test, not a separate check | Sequenced after P99 on purpose: P97's own count showed the findings concentrated in exactly the dialogs/menus/pickers P99 replaces with shadcn-vue primitives carrying correct roles/labels already, so fixing pre-P99 markup would mean re-fixing the same lines P99 rewrites |
| **P102 Reclassify root `package.json`'s `dependencies`/`devDependencies` split by actual import reachability; add the xterm links addon** | Root `package.json` currently sorts several genuinely runtime-imported packages under `devDependencies` — at minimum `vue`, `vite`, `@vitejs/plugin-vue`, `tailwindcss`, `@tailwindcss/vite`, `vue-tsc`, `sql-formatter` (`views/console/format.ts`), `simple-icons` (`theme/EngineIcon.vue`), `@wailsio/runtime` (`bridge/port.ts`) — found by cross-checking every `devDependencies` entry against the frontend's real import graph (Vite bundles by reachability, not by which `package.json` list a package sits in, so a stale placement is a doc-accuracy bug, not a build bug). Move every package genuinely `import`ed by shipped app code (`apps/kira-studio/frontend/src/**`, excluding tests) into `dependencies`; leave build-only/lint/test/type tooling (`typescript`, `@biomejs/biome`, `knip`, `@playwright/test`, `@types/*`, `testcontainers`, and similar) in `devDependencies`. Also add `@xterm/addon-web-links` alongside the existing `@xterm/addon-fit`, wired into `terminal/TerminalPanel.vue`'s existing `Terminal`/`FitAddon` setup. One agent writes a short plan and implements it in the same pass — small, mechanical, no design decision at stake | Doc-accuracy/hygiene fix surfaced during P99's own dependency work, plus a small missing terminal feature (clickable links in terminal output) bundled in since it touches the same dependency-list area |
| **P103 Delete every hand-rolled UI primitive for shadcn-vue's own components, and normalize spacing/sizing onto Tailwind's default scale in the same pass** | One file touched once, both changes landed together — not two phases opening the same `.vue` file twice. Per file: (1) delete the hand-rolled `theme/primitives/*.vue` wrapper (or whatever other hand-rolled primitive it calls) and repoint the call site directly at `components/ui/*`'s shadcn-vue component — the 18 components P99 fetched into `components/ui/` but never actually called from any app-level file (`button`, `dialog`, `checkbox`, `dropdown-menu`, `popover`, `tooltip`, `command`, `context-menu`, and more); no wrapper layer, nothing fetched-but-unused left behind. (2) In that same edit, replace the file's arbitrary-bracket `[...var(--kira-*)...]` spacing/sizing utilities (P99 preserved 425 of these across 115 files verbatim, by that phase's own pixel-identical gate) with Tailwind's own default scale, extending `theme/base.css`'s `@theme` block — which today maps only `--color-*`/`--radius-kira-*`, never spacing — to a coherent set as needed. Explicitly re-opens the three cases P99 declined with a named reason: `Checkbox` (`CheckboxRoot` renders `<button role="checkbox">`, not a real `<input>`, breaking Playwright `.check()` calls and native form semantics), `workbench/ContextMenu.vue` (reka-ui's trigger-anchored model vs. this app's point-anchored singleton), and `AppTooltip.vue` (directive-plus-singleton architecture) — each must be genuinely resolved this time (updating the ~331 class-based Playwright selectors and any native-semantics reliance the swap breaks), kept hand-rolled only if a requirement truly cannot be met even after that rework, stated explicitly in the result section, not silently stranded. Visual output is expected to change on both axes at once — new `test:visual` baselines get recorded per changed surface, with the reason stated per baseline, not treated as a diff to chase back to zero | User request: P99 fetched shadcn-vue's components without ever calling them (the real call surface stayed the hand-rolled wrapper layer) and converted CSS syntax without normalizing the spacing values it referenced — both are this chapter's own follow-up work, merged into one pass per the user's explicit instruction not to touch the same file twice for two separate phases |

## P96 result

Landed per plan (`docs/v1.9/plans/P96-flake-sweep.md`), 6 fix/test/refactor/chore commits plus this
section's own commit, in order: `6631b81`, `fc1d32f`, `ec50a54`, `ace58f0`, `5ef0549`, `8ee4dd9`,
`d58cf37`.

**`http-request-body.spec.ts`'s 500-byte bound (`6631b81`).** Deterministic, not a flake — failed
every run, `Received: 657`. Root cause: `openTab`'s unconditional `saveNow()` fires the instant
`new-request-start` opens the tab, before any form-data state exists; that first `tabsSave`
(`windowKey: 'main'`, one default `http-request` tab record) serializes to exactly 657 bytes,
reconstructed byte-for-byte. `httpSend`'s own args for the same test are 511 bytes, also over the
stale bound, also carrying no file bytes. Neither reflects a defect — `httpRequestTabStateShape`
outgrew the 500 constant since it was written. Fixed by raising the fixture to 4 MiB and bounding
every logged call against `PICKED_FILE.file.size` instead of a magic number, so schema growth can't
erode it again.

**`internal/grpcclient`'s deferred reflection failure (`fc1d32f`, `ec50a54`) is not a port race.**
Measured baseline rate under `stress-ng --cpu 4 --cpu-load 100`: 4/500 in-process
(`-count=500`), up to ~11% in a fresh-OS-process-per-iteration loop that falsified the
ephemeral-port-reuse theory (a higher rate under fresh processes rules out leftover in-process
state as the cause). Direct instrumentation pinned it exactly: v1's negotiation always answers a
well-formed `Unimplemented` in under 1ms; the race is in the v1alpha fallback immediately after it,
where grpc-go's HTTP/2 transport occasionally ends the stream with a bare `io.EOF` (`codes.Unknown`)
instead of a well-formed status, under scheduling pressure on a still-settling connection — the
second RPC of the negotiation, not strictly the first as originally hypothesized. Took the retry
branch of §4.4, not the client-side `WaitForReady`-only branch (measured first and only roughly
halved the rate, 13/8109 vs 26/8226) and not a test-bug branch (the assertion is correct — a real
schema error must still surface as `CodeSchema`, confirmed by mutation check). `retryOnTransportGlitch`
wraps both v1's and v1alpha's round trip, retrying a bare transport glitch up to 4 times with a 50ms
delay (an immediate no-delay retry measured first did not lower the rate at all — the delay is
load-bearing). `startStubReflectionServer` separately lacked any readiness wait at all
(`fc1d32f`, a real gap regardless of the root-cause finding). Final 100-iteration verification, run
twice (mid-session and in this phase's official re-verification): 0 failures both times, clean.

**Parent P94 §11's flake list was stale, not re-derived.** `cell-editor.spec.ts` and
`grpc-request.spec.ts` were already fixed by P81 before this phase started — re-verified passing in
the full run, no work needed. The Monaco storm P90/P93 recorded (up to 47 failures) is absent from
both of this phase's official `test:ui` runs. `api-ui-consistency.spec.ts`'s hover/z-index case and
`data-view.spec.ts`'s pagination case, both named by pass 3, passed cleanly in both runs. Nothing in
that list needed a fix beyond confirming it already landed.

**`RequestSettingsPane.vue`'s `useImportType` (`5ef0549`) is a template-blind false positive, not a
code defect.** All four imported constants (`HTTP_VERSIONS`, the three `*_RANGE` constants) are used
as values, but only inside `<template>`, which Biome does not analyse; inside `<script setup>` they
either appear only in a type position or not at all, so the rule concluded "type-only import" — its
own fix would erase the import at runtime and break the `v-for`/`:min`/`:max` bindings that read it.
`biome.json`'s `**/*.vue` override already turned `noUnusedImports`/`noUnusedVariables` off for
exactly this reason; `useImportType` joined the same override rather than a per-line
`biome-ignore`, removing the 12 now-dead per-line ignores this created across 7 files.
`UncommittedChangesStrip.vue:49`, the other long-standing Biome finding, was a genuine
`useShorthandFunctionType` hit — fixed in code (`ace58f0`), not suppressed.

**§7 — two genuine flakes found by a clean full run, beyond anything a prior pass named.**
`markdown-reading.spec.ts`'s pre-toggle scroll snapshot (`8ee4dd9`) sampled `.lines-content`'s
`style.top` with `expect.poll(...).not.toBe('0px')` — checks non-zero, not settled; under
contention it could catch a mid-catch-up value (`-486px`, almost exactly half of the true `-954px`)
while Monaco's own internal command dispatch was still applying a fast PageDown sequence. Fixed with
an in-page stability loop (six consecutive quiet frames), the same idiom `support/grid.ts`'s
`mutationsForScroll` already uses (P81 §7.2). `http-request-body.spec.ts`'s XML token-colour check
(`d58cf37`) called `hasTokenColor()` as a one-shot `evaluate()` immediately after a language-mode
switch plus text insert, racing Monaco's own asynchronous tokenize pass —
`api-ui-consistency.spec.ts` already documented this exact hazard for the same helper without this
call site being updated to match. Fixed by wrapping the call in `expect.poll`. Both proved by a
scratch mutation-check element (added, run, removed — nothing committed) showing the old one-shot
read catching a transient value that the new wait-based read correctly skips.

**Verification (§9).** `bun run build`, `bun run build:vscode` clean. `bun run lint:all`: Biome 0
errors/0 warnings/0 info, golangci-lint 0 issues, knip clean (only the pre-existing, declared
duplicate-export/config findings, unchanged). `go build ./...`, `go vet ./...` clean. `go test
./...`: 67 packages ok, 0 FAIL. `go test ./internal/grpcclient/... -count=100`: ok, 17.664s, 0
failures. `bun run test:unit`: 1543 passed, 0 failed (13694 `expect()` calls, 157 files) — matches
plan baseline. `bun run test:webview`: 55 passed, 0 failed — matches plan baseline. Two full `bun
run test:ui` runs (316 tests, 4 workers each): run 1, 311 passed, 1 failed, 4 did not run; run 2,
310 passed, 2 failed, 4 did not run. Every failure isolated (`--workers=1`), dated
(`git diff --stat 6e420c7` touches nothing in its dependency chain), and classified as resource
contention, not a fix target: `tree.spec.ts` (run 1, 120s timeout / crashed worker — the plan's own
literal textbook contention signature), `repo-workspace.spec.ts:283` and `slick-grid.spec.ts:1529`
(run 2, both `toHaveCount` timeouts that already use Playwright's own auto-retrying idiom, so no
removable timing proxy exists). The 4 "did not run" both times are `ui-timing`'s own tests, skipped
by Playwright's own dependency-cascade default (`ui-timing` depends on `ui`, and `ui` had a
failure) — confirmed via an isolated `--no-deps` run that all 4 pass cleanly (56.9s total) when not
blocked by that cascade, so this is a reporting artifact, not a coverage gap.

**Deviations from the plan.** (1) §4.2's own hypothesis named "the first RPC" as the suspected
race window; the repro instead pinned it to the v1alpha fallback's round trip specifically, the
second RPC of the negotiation, not the first — v1 itself never failed in any measured run. (2) §7
surfaced two genuine flakes (`markdown-reading.spec.ts`, `http-request-body.spec.ts`'s XML test)
beyond anything §0's table or a prior pass named; both fixed under the same three-obligations
method as §3/§4. (3) Methodology note, not a plan deviation: one mid-session `grpcclient
-count=100` measurement and one `budgets.spec.ts` measurement were each contaminated by this
session's own concurrent tool activity (other test/lint runs sharing the container) and produced a
symptom that never reproduced under a genuinely quiet re-run — both re-verified clean before being
trusted as evidence, and neither is a real finding.

## P97 result

Landed per plan (`docs/v1.9/plans/P97-drop-repo-map-biome-vue.md`), 10 commits plus this section's
own, in order: `1f2f4be`, `ba172f5`, `4aaf8a8`, `3198341`, `02c6468`, `6b5d291`, `ec5e512`,
`c9a933d`, `d64808b`, `1cd49e3`.

**Part A — repo-map removed.** `internal/repomap`, `internal/codegraph` (this app's own package),
`internal/codeparse`, `cmd/kira-repo-map`, the frontend nav surface (`views/repo/navigation.ts`,
`state/repomap.ts`, the Settings dialog's Code intelligence tab), and the bridge/storage surface
(`RepoMapService`, `code_repos.mcp_enabled`, the `codeIntel.mcpServerEnabled` settings leaf,
migration `0025`) are gone. `internal/mcpinstall`/`internal/mcpauth` **stay** — both are
`internal/dbmcp`'s own dependencies (bearer-token install flow, auth middleware), never
repo-map's; repo-map only shared the same SDK dependency graph. `internal/codeindex` is mostly
gone, but `EnumerateAll` **moved**, not died — relocated into `internal/codeworkspace/enumerate.go`
(commit `4aaf8a8`, split from the deletion so the diff reads as a move), since `ListFiles`/`Search`
still call it for repo-wide file listing, unrelated to the deleted parse/index/graph machinery.
`internal/codeworkspace/textpos.go` (`LineIndex`/`utf16Units`) was kept, not deleted per the plan's
literal instruction — it is `search.go`'s own live column-computation dependency with a genuine
correctness test, not a repo-map leftover.

**Part B — Biome now lints `.vue` templates and styles.** `html.experimentalFullSupportEnabled`
on, `html.formatter.enabled` off (a separate decision, 126 files' worth of whitespace churn on an
experimental formatter). `useImportType` needed no override once templates were analysed — its 0
findings confirmed P96's `RequestSettingsPane.vue` false positive doesn't reproduce, so it was
dropped from the `**/*.vue` override rather than carried forward. The flag surfaced 314 findings;
58 were mechanical/genuine and fixed here (1 parse error, 8 dead imports/variables, 5 template
literals, 4 CSS specificity reorderings); 255 `lint/a11y/*` findings across 85 files are deferred
to the new **P101** row above, added after P99 since the findings concentrate in exactly the
dialogs/menus/pickers P99 replaces.

**Two more rule classes turned off, beyond the plan's own a11y call — both systemic, not one-off.**
The plan classified `useVueHyphenatedAttributes` (19 findings) and `noNonNullAssertion` (21
findings) as mechanical fixes. Applying them broke `vue-tsc`: every `useVueHyphenatedAttributes`
finding was a Kui* primitive's own camelCase `aria*` prop (`KuiSegmented.ariaLabel`,
`KuiSearchInput.ariaLabel`, etc.) — Vue does not re-camelize `aria-*`/`data-*` attributes back to a
component's declared prop name, so the rule's own suggested fix silently stopped matching the prop,
which `vue-tsc` then caught as a missing-required-prop error. Every `noNonNullAssertion` finding was
a `v-if="expr(x)"`-guarded element whose attributes call `expr(x)` again for a required prop/param;
Vue templates don't narrow across separate calls the way linear TS does, so the rule's own `?.`
suggestion produced `| undefined` against a required type, which `vue-tsc` also rejected. Both
verified empirically (measured, not assumed) before deciding to turn the rule off rather than
hand-fix each site. `biome.json`'s `**/*.vue` override now carries three rule shutoffs
(`a11y`, `useVueHyphenatedAttributes`, `noNonNullAssertion`), each with the reason recorded in
commit `d64808b`'s own message (`biome.json` cannot hold comments — the parser used to lint it
doesn't allow them).

**A second Biome/Vue false positive the plan's own table got wrong.** `RepoTerminalView.vue`'s
`loadTerminalRenderer` was classified "genuine — dead function"; it is not — it's declared in the
file's plain `<script>` block and called from the separate `<script setup>` block below it, and
this Biome version's Vue support doesn't link scope across a single SFC's two script blocks.
Verified against the actual call site before touching it: renaming it (the mechanical fix) would
have left the call site referencing an undefined name, a runtime `ReferenceError`. Reverted to its
original name with a targeted `biome-ignore`, alongside `TreeHost.vue`'s already-known one.

**A third parser interaction, found while fixing `useTemplate`.** Two of the five string-
concatenation findings (`StashList.vue`, `StashDialog.vue`) build a `stash@{N}` label; their
template-literal equivalent puts two closing braces back to back right before the mustache's own
closing `}}`, which this Biome version's Vue parser reads as its own delimiter mid-expression — a
parse error, confirmed, not a style call. Left as concatenation with a `biome-ignore` each.

**`biome-ignore` count exceeds the plan's own expectation.** §15 expected exactly one, on
`TreeHost.vue`. Four now exist from this phase: `TreeHost.vue` (as planned),
`RepoTerminalView.vue`, `StashList.vue`, `StashDialog.vue` — each documented above, plus two
pre-existing (`SlickGridHost.vue`, `ConsoleSlickGrid.vue`, unrelated `noExplicitAny`, unchanged).

**Verification.** Part A: `go build ./...`, `go vet ./...`, `go test ./...` clean; `bun run
typecheck`, `bun run build`, `bun run build:vscode` clean; `bun run lint:all` clean; `bun run
test:unit` 1535 passed; `bun run test:webview` 55 passed; `bun run test:ui` 311 passed, 0 failed.
Part B: `biome check .` 0 errors/0 warnings/0 infos over 1173 files; `bun run typecheck`, `bun run
build`, `bun run lint:all` clean; `bun run test:unit` 1535 passed; `bun run test:ui` 305 passed, 2
failed, 4 did not run (311 total) — both failures (`sql-schema.spec.ts`, `tree.spec.ts`) reproduce
clean in isolation, the P96-established resource-contention signature, not a regression; `go build
./...`/`go vet ./...` re-confirmed clean after the CSS/Vue-only changes.

**Deviations from the plan, beyond the two rule-shutoff and false-positive findings above.** (1)
Commit 5 (bindings regen) never landed — `frontend/bindings/**` is entirely gitignored
(`apps/kira-studio/.gitignore`), so there was never a delta to commit; the plan's own line-count
citations for that commit assumed tracked files. (2) `docs/ARCHITECTURE.md`'s edit deleted two
whole sections ("Code parsing and the code graph", "The repo-map MCP server") rather than the
plan's narrower named sub-ranges — both sections were purely about deleted code end to end, so the
narrower cut would have left orphaned prose; read against the real file rather than the plan's
line numbers, which had drifted. (3) The "repository-wide search has no include/exclude filter"
Known-open-item was kept, not deleted as the plan's §7.6 literally said — it remains genuinely true
after P97 (search still lacks a glob filter), and `CLAUDE.md`'s own standing rule for that section
overrides a one-off instruction to delete it: "kept only while genuinely open, delete the moment
it's resolved." Only its stale `codeindex.EnumerateAll` cross-reference was corrected. (4) The
plan's own §15 expected `bun run test:ui` at 314 (316 baseline minus the 2 deleted navigation
tests); the correct figure is 311 — the deleted `settings-code-intelligence.spec.ts` file carried 3
more tests the plan's arithmetic didn't count. (5) A one-off follow-up commit (`c9a933d`) fixed
four dangling comment cross-references (`internal/codeindex`, `EnsureIndex`, two "Code
intelligence" tab mentions) that the plan's own verification sweeps (§9) surfaced but that
individual commits had missed — folded into Part A's own verification pass rather than left as a
lint-clean-but-stale comment.

## P98 result

Landed per plan (`docs/v1.9/plans/P98-vue-deps-conventions.md`), 6 commits plus this section's own,
in order: `8bab5f6`, `1fa9f5d`, `f526ab2`, `00941e2`, `5a1061c`, `c4b3fef`.

**Commit `8bab5f6` — deps only.** `pinia` 4.0.3, `@tanstack/vue-query` 5.103.2, `@vueuse/core`
15.0.0 into root `package.json`, matching the `monaco-editor`/`slickgrid` precedent. `bun install`
printed one peer-dependency warning, recorded verbatim rather than silenced: `warn: incorrect peer
dependency "@vue/devtools-api@6.6.4"` (pinia's optional devtools peer; nothing in this app's
bootstrap uses it). `knip.json` gained the `@vueuse/core` ignore entry.

**Commit `1fa9f5d` — Pinia + TanStack Query bootstrap.** `state/pinia.ts` exports the one
`createPinia()` instance; `state/queryClient.ts` exports one `QueryClient` (`retry: false`,
`refetchOnWindowFocus: false` — every query resolves over the Wails bridge to the local Go process,
never the network). `main.ts`'s single chained `createApp(App).directive(...).mount('#app')`
became four statements registering both plugins before `directive`/`mount`. No store, no query call
site moved.

**Commit `f526ab2` — the `@/` alias.** `vite.config.ts`'s `resolve.alias` and `tsconfig.json`'s
`compilerOptions.paths` both gained `@` → `./src`, beside the three existing aliases. Existing
source keeps relative imports; `@/` is for shadcn-vue's own generated import specifier.

**Commit `00941e2` — shadcn-vue bootstrap, hand-authored rather than CLI-generated (see deviation
below).** `components.json`, `src/lib/utils.ts`, `src/theme/shadcn-bridge.css` — reka-ui base, nova
style, neutral base color, lucide icons, CSS variables. Every shadcn-vue variable in the bridge
file maps to an existing `--kira-*` token; the `--accent`/`--input` judgment calls are commented in
the file per plan §4.3. No `.dark` block — `tokens.css` is a single `:root`, `index.html` hardcodes
`class="dark"`. `base.css` gained one import line, placed after `./vscode-bridge.css`. `knip.json`
gained the remaining six `ignoreDependencies` entries (`reka-ui`, `class-variance-authority`,
`tw-animate-css`, `@lucide/vue`, `clsx`, `tailwind-merge`) plus the `src/lib/utils.ts` workspace
ignore — `bun run lint:dead` confirmed clean of new findings. No component generated (P99's scope).

**Commit `5a1061c` — `CLAUDE.md`.** Three bullets after the library-first rule, exactly as planned:
lean on the P98-wired libraries rather than hand-rolling; every Vue component
`<script setup lang="ts">`; one Pinia store, one concern.

**Commit `c4b3fef` — `docs/ARCHITECTURE.md`.** One row added to the **Stack** table: the frontend
library baseline (Vue/Vite/Tailwind v4/shadcn-vue-on-Reka/Pinia/TanStack Query/VueUse) and that P98
wired them (bootstrap only) while P99 migrates the app's existing 39 `reactive()` modules and 200
`.vue` files onto them. No **Known open items** entry — nothing here is a limitation.

**Verification (§12).** `bun install` clean (peer warning above, not silenced). `bun run
typecheck` clean across all five projects — proves the `@/` alias and `vue-tsc`'s view of it agree.
`bun run build` clean, no new Vite warning beyond the pre-existing chunk-size one; the built CSS
confirms the bridge applies (`--background:var(--kira-bg)` in `dist/assets/index-*.css`). `bun run
build:vscode` clean and unchanged in content — `packages/git-ui` untouched. `bun run lint` — Biome
0 errors/0 warnings/0 infos over 1178 files, `check-tokens.sh` confirms every `--kira-*`/`--kv-*`/
`--kui-*` reference resolves. `bun run lint:dead` — knip clean but for the pre-existing declared
`duplicates` warnings (unchanged), confirming §8's `ignoreDependencies`/`ignore` entries are
correct. `bun run test:unit` 1535 passed, 0 failed (P97 baseline: 1535). `bun run test:webview` 55
passed, 0 failed (baseline: 55). `bun run test:ui` 311 passed, 0 failed (baseline: 311 total).

**Deviation — `bunx shadcn-vue@2.8.2 init` could not run in this sandbox; §4's files were
hand-authored from the CLI's own real registry output and shipped source instead of its
write-to-disk step.** Root-caused, not worked around: `init`'s registry fetch (`ofetch` calling a
real `undici` `ProxyAgent` as `dispatcher`/`agent` against the runtime's own global `fetch`) throws
a bare `TypeError: fetch failed` with no further cause, reproducibly, under both Bun (this
container's runtime) and real Node 22.22.2 with `NODE_USE_ENV_PROXY=1` (the proxy README's own
fix for a tool that ignores `HTTPS_PROXY` — this tool does not ignore it, it builds its own
`ProxyAgent` from `https_proxy`, and that mechanism itself is what fails). Confirmed this is not a
policy block or a misconfigured proxy on this repo's side: the same registry endpoints
(`https://shadcn-vue.com/init?...`, `https://shadcn-vue.com/r/styles/reka-nova/utils.json`) are
directly reachable via `curl` through the proxy and via a bare `fetch()`/`bun -e` call with no
dispatcher at all — the failure is specific to passing a foreign `undici` package's `ProxyAgent`
instance into `ofetch`'s call to the runtime's own global `fetch`. Did not unset `HTTPS_PROXY` to
route around it (`docs/DEV_ENVIRONMENT.md`'s proxy guidance is explicit that this is never the
fix), and the sandbox's own containment policy blocked writing a workaround patch into the CLI's
vendored cache outside the repo. Instead traced the actual shipped 2.8.2 CLI source (`init`'s
`-d`/`--defaults` auto-selecting the `nova` preset; `getProjectConfig`'s Tailwind-v4 file
auto-detect; `promptForMinimalConfig`'s default resolution; the final `registryBaseConfig`
deepmerge with override precedence) and fetched the same registry endpoints directly to get the
CLI's real intended output, rather than the plan's illustrative shape:

1. The resolved icon dependency is `@lucide/vue` 1.47.0 (ISC), not `lucide-vue-next` — the real
   registry response for `--icon-library lucide` under this style names it. `package.json`,
   `knip.json` and the plan's §2.1 table (superseded by this section) all reflect the real name.
2. `components.json` carries real fields the plan's illustrative JSON didn't show: `style`
   (`"reka-nova"`, from `-d`'s nova-preset auto-select composed with `--base reka`), `font`
   (`"geist-sans"`), `rtl`, `pointer`, `menuColor`, `menuAccent`, `typescript`, `registries: {}` —
   traced from `rawConfigSchema` plus the registry `registry:base` item's own `config` object,
   merged onto the locally-resolved config with override precedence.
3. `src/lib/utils.ts`'s real registry content is two separate `clsx` imports (`import type
   { ClassValue } from "clsx"` + `import { clsx } from "clsx"`); combined into the repo's own
   single-import style (matching `main.ts`'s own `import { type X, y } from 'pkg'` precedent) with
   an explicit `: string` return type per plan §3.

§12's two targeted checks both still ran, adapted for the same reason: the bridge-applies check
used the real `bun run build` output directly (above). The alias/`cn()` check used `--dry-run`
first — confirmed genuinely unsupported in 2.8.2 via the CLI's own message ("The --dry-run, --diff
and --view options are not yet supported in shadcn-vue"), the exact fallback trigger plan §12
names — then, since `add` needs the same broken registry fetch, proved `@/lib/utils` a different
way: a throwaway file importing `cn` from `@/lib/utils` typechecked clean under `vue-tsc`, then was
deleted (untracked, never committed, confirmed via `git status`).

## P99 Part 1 result

Landed per plan (`docs/v1.9/plans/P99-vue-migration.md` §0-§4, §5, §9-§14), 37 commits from
`28a95a6` (shadcn-vue component set) through `2c7166d` (this section's closing fix), plus this
section's own commit.

**shadcn-vue component set (§4).** 17 primitives fetched via the direct-registry `curl` procedure
P98 root-caused and this phase's own planning pass confirmed: `alert`, `button`, `checkbox`,
`command`, `context-menu`, `dialog`, `dropdown-menu`, `input`, `input-group`, `label`, `popover`,
`scroll-area`, `separator`, `textarea`, `toggle`, `toggle-group`, `tooltip`, under
`frontend/src/components/ui/`. No app code imports them yet (Part 2 is the first consumer, §3.2) —
`knip.json`'s 7 bootstrap `ignoreDependencies` entries stay, as documented at P98 landing.

**Every module-level `reactive()`/`ref()` state module on Pinia (§5.1-§5.3).** Final count: **71
`defineStore()` calls across 65 files** — the plan's own "45 modules → 41 stores" estimate was
approximate going in (this section supersedes it, per that plan's own framing). Five modules split
into two stores each, all for a real two-concern reason stated in the store's own code: `state/
connections.ts` (connection records vs. the connect dialog's own UI state), `state/tabs.ts`,
`api/state/curl.ts`, `api/state/variables.ts`, `project/state/tree.ts`. One pair of modules merged
the other way: `views/grpcrequest/state.ts` declared two `createRuntimeStore` calls (the gRPC call
runtime and the schema-browser runtime) sharing one `registerTabRuntimeCleanup` teardown — collapsed
into one `useGrpcRequestViewStore`, since the plan's per-module 1:1 assumption doesn't hold once two
runtimes are torn down as a single coupled unit. `state/schemas.ts` split along §5.5's own line
(DDL fetch/save moved to TanStack Query; the dialog's own draft state stayed a Pinia store) rather
than the two-Pinia-store split the plan's §1.3 guessed at.

A closing empirical re-scan (`^const \w+ = (reactive|ref)\(` across every `.ts` under
`frontend/src`, plus a direct check for leftover `createRuntimeStore`/`createHistoryStore` call
sites) found zero unconverted module-level state. The only remaining `reactive()`/`ref()` call
sites are the two generic factory *definitions* (`views/shared/viewOp.ts`'s `createRuntimeStore`,
`api/state/history.ts`'s `createHistoryStore`) and four composable factories (`createPageSearch`,
`createPageStore`, `useEditBuffer`, `useDiffEditor`) — each produces fresh state per call, not a
module singleton, so none is in scope. `state/tabRuntime.ts`, `state/viewCommands.ts`,
`state/repoOpenHold.ts`, `state/maskRules.ts`'s `correlationKeys` and similar plain `Map`/`Set`
registries were left alone — never `reactive()`, out of scope by the plan's own definition.

**The 13 broadcast subscriptions (§5.4) — plan text corrected.** The plan's own prose says "13 of
them subscribe to a backend broadcast" but names only 10 modules; grepping `control\.on\w*Changed\(`
across the converted tree confirms exactly those 10 (`state/connections.ts`, `customScripts.ts`,
`dbmcp.ts`, `gitClients.ts`, `keepAwake.ts`, `layout.ts`, `schemas.ts`, `settings.ts`, `tabs.ts`,
`project/state/tree.ts`) and no others — the plan's "13" was never accurate, not a count this phase
regressed. All 10 still register their subscription the way they did before conversion (inside the
store body, first-use), still write the same `reactive` field or (for `schemas.ts`'s
`onSchemaChanged`, the one §5.4 exception) call `queryClient.invalidateQueries` instead — confirmed
unchanged by re-reading each site.

**TanStack Query (§5.5).** All three named migrations landed: `state/schemas.ts`'s `ensureDdl`/
`saveDdl` (`cbf7445`), `state/maskRules.ts` (`c872a6f`), `views/grid/PreviewCommandPanel.vue`
(`f5d8cdb`, confirmed via `useQuery` in place of the old `ref([])`/`loading`/`error` triple). One
stated deviation from the plan's literal prescription: `maskRules.ts`'s `upsertMaskRule`/
`removeMaskRule` re-call `loadMaskRules` synchronously rather than firing a `useMutation` with
`invalidateQueries` in `onSuccess` — `invalidateQueries` only refetches an *active* `useQuery`
observer, and not every caller (`menu.ts`'s `existingMaskRule` scan, `ConnectionDialog.vue`'s
Privacy tab) has one; the synchronous cache write matches `schemas.ts`'s own `saveDdl` precedent.

**Mechanical call-site sweep.** Every consumer of a converted module — `.vue` components, plain
`.ts` modules, and the 9 `console/state.ts` unit test files — updated to `useXStore().foo()`. No
primitive, styling or composable change rode along (confirmed per file: each diff touches only
import lines, hoisted `useXStore()` instances, and call-site qualification). The sweep's own two
recurring hazards, tracked across every batch: a blanket regex re-qualifying a function name
mentioned in a comment (caught via `grep '// .*storeName\.'` after every sweep, reverted by hand)
and a plain (non-paren-anchored) string replace on a bracket-access pattern doing the same to a
backtick-quoted comment (`console-run-after-tab-close.spec.ts`, caught the same way). Zero
`storeName.storeName` double-prefixes found in any final grep.

**Found and fixed one hazard the conversion itself introduced.** Three plain `.ts` files —
`views/browse/menu.ts`, `views/documents/menu.ts`, `api/reveal.ts` — hoisted
`useConfirmDialogStore()` to true module scope with no explicit `pinia` argument. Each sits behind
its own static import chain main.ts loads before `app.use(pinia)` runs — `menu.ts`'s two via
`App.vue → WorkbenchShell.vue → MainView.vue → workbench/tabViews.ts → BrowseView.vue/
DocumentView.vue → menu.ts`, `api/reveal.ts`'s via `workbench/tabViews.ts → state/tabKinds.ts →
api/state/variables.ts → api/reveal.ts` — confirmed by tracing each import, so the call would throw
at boot (`getActivePinia()` with no active Pinia). Each had exactly one call site, inside an async
function invoked only at runtime — fixed by calling `useConfirmDialogStore()` inline at that one
site instead of hoisting it, matching the per-call idiom the same files already use for their other
stores (commit `2c7166d`). `repo/git/transport.ts`'s one other module-top-level store call
(`useGitCredentialStore(pinia)`) already passed the explicit singleton correctly — confirmed via a
repo-wide grep, no other instance of this hazard exists.

**§4.4 — knip's 7 bootstrap `ignoreDependencies` entries.** Not deleted, per the plan's own note at
each entry: they clear once Part 2 imports the first shadcn-vue primitive, not before. Confirmed
still present and still needed (`bun run lint:dead` would newly flag all 7 as unused if removed
now).

**Verification (§12.1-§12.2).** `bun run typecheck` clean across all five projects. `bun run lint`
— Biome 0 errors/warnings/infos over 1276 files, `check-tokens.sh` clean. `bun run build` and
`bun run build:vscode` both clean (only the pre-existing chunk-size warning). `bun run test:unit`
1535 passed, 0 failed (baseline: 1535). `bun run test:webview` 55 passed, 0 failed (baseline: 55).
`bun run lint:dead` — knip unchanged from baseline (6 duplicate exports + 4 config hints, all
pre-existing and unrelated). `bun run test:ui` — 311 total; three separate runs across this phase
each hit exactly one failure, never the same test twice (`budgets.spec.ts`'s scroll-delta
percentile, twice, and `slick-grid.spec.ts`'s pacing-histogram invariant, once), both in the
`ui-timing`/pacing-budget class the tests' own comments already document as flaky under cross-file
worker contention. Confirmed pre-existing and unrelated to this phase: `git diff --stat` against
this phase's start commit (`de739aa`) touches neither `views/shared/slick/` nor
`tests/ui/slick-grid.spec.ts`/`tests/ui/budgets.spec.ts`, and re-running each failing test in
isolation passes clean. `bun run test:visual` — 5 failed (`connection-dialog`, `console`,
`data-view`, `schema-dialog`, `workbench`), matching the documented pre-existing baseline exactly;
unrelated to this phase (no `.vue` styling changed).

No new `docs/ARCHITECTURE.md` **Known open items** entry: the `test:ui` timing flakiness is already
self-documented in the failing tests' own comments, not a new discovery, and `test:visual`'s 5
failures are the pre-existing baseline this phase inherited, not caused.

## P99 Part 2 result

Landed per plan (`docs/v1.9/plans/P99-vue-migration.md` §6, §9-§14), 15 commits from `19a90ed`
through `81b2351`, plus this section's own commit. All 48 files in §6/§10.1's inventory (`App.vue`,
`theme/` 22, `workbench/` 17, `project/` 7, `shortcuts/` 1) converted, one pass each, never reopened.

**`theme/` (22 files, `19a90ed`/`829f040`/`78c8a23`).** `19a90ed` fixed a pre-existing token
collision (`--color-accent` shadowing shadcn's own menu-hover variable) surfaced while wiring the
shadcn bridge in, ahead of the primitive sweep proper. `829f040` converted every `theme/primitives/*`
except `AutocompleteField.vue`, each wrapper's public prop/emit/slot API unchanged per §6.2.
`DialogFrame.vue` moved its internals onto reka-ui's `DialogRoot`/`DialogPortal`/`DialogOverlay`/
`DialogContent`. `78c8a23` gave `AutocompleteField.vue` its own commit as directed — declined
reka-ui/shadcn's `combobox` (Listbox+Popover shape assumes single-select; this field's own
free-text-plus-suggestions model doesn't fit), documented inline.

**`workbench/` (17 files, `6ce3c61` through `dca9c2f`).** `SettingsDialog.vue` (2,156 lines) landed
first, as its own commit, converted whole in one pass — its 375-line `<style scoped>` block became
`@apply` utilities under `@reference "@/theme/base.css";` rather than inlining 50+ template class
usages individually. **Hard case, `ContextMenu.vue` (§6.3, `b6b338a`).** Tried `DropdownMenuRoot`
with a zero-size anchor, then `ContextMenuRoot`; declined both, documented inline above
`useContextMenuStore()`: reka-ui's item slot has no prop for this menu's swatch/checked/danger/
shortcut/hint content, its trigger/content model assumes one owning trigger per menu against this
singleton's point-anchored, many-call-site open, and forking the already-tuned roving-focus/hover-
delay/Escape/blur-close keyboard model onto reka-ui's internal open state risked a §9.4 behavior
regression. Kept the hand-rolled menu; replaced `document`/`window` listeners with
`useEventListener` and the submenu open-delay timer with `useTimeoutFn`. **Hard case,
`AppTooltip.vue`/`workbench/state/tooltip.ts` (§6.4, `952c959`).** Kept the directive-plus-singleton
architecture per the plan's own recommendation, documented inline above `useTooltipStore`; replaced
the rearm-delay timer with `useTimeoutFn` and `initTooltips()`'s seven listener pairs with
`useEventListener`, keeping its own manual-teardown return contract (`leaks.spec.ts` and `App.vue`
both rely on the explicit `() => void`, not implicit unmount cleanup). Remaining files: `setInterval`
tickers in `GitPairingDialog.vue`/`DbMcpApprovalDialog.vue` replaced with `useIntervalFn`;
`OperationsPanel.vue`'s local `@keyframes ops-spin` dropped for Tailwind's own `animate-spin`
(confirmed identical 1s-linear-infinite rotate body; grepped tests first, none select it there).
**Deviation:** the plan's primitives.css `.p-btn`/`.p-dlgbtn`/`.p-iconbtn` cleanup, assumed gated on
`TitleBar.vue` converting, stays out of scope for this part entirely — grepped the whole `src` tree
and found those classes still used in `terminal/`, `views/`, `api/`, `repo/`, none of them Part 2's.

**`project/` (7 files, `4c0ff07`/`c74f1a7`).** **Near-miss, caught before commit:** `TreeRow.vue`'s
template `class="spin"` was renamed to `class="animate-spin"` (mirroring the `OperationsPanel`
precedent), then reverted on grep — `tests/ui/tree.spec.ts` and `tests/ui/support/tree.ts` select
`.twisty .spin` directly. Fix: keep the selector name `.spin`, make its body `@apply animate-spin;`.
Its local `@keyframes pulse` renamed to `@keyframes tree-row-pulse` — Vue scoped CSS doesn't scope
`@keyframes` names, and Tailwind v4 (now bundled) defines its own global `pulse` for `animate-pulse`
at a different timing; verified no collision in compiled output. `ErrorPopover.vue`'s two
`document.addEventListener` calls at setup time (not inside `onMounted`) replaced with
`useEventListener`, preserving the immediate-attach/auto-detach timing. `SchemaDialog.vue`'s
400ms parse-summary debounce replaced with `useDebounceFn`, keeping its explicit
`onBeforeUnmount(() => setDebouncedDraft.cancel())` (VueUse's `debounceFilter` has no built-in
`tryOnScopeDispose`).

**`shortcuts/CommandPalette.vue`, `App.vue` (`51af0a0`).** No VueUse-eligible patterns in either.
`App.vue`'s `onMounted`/`onUnmounted` pairs are `control.on*()` IPC subscriptions, not DOM
listeners/timers — left untouched, no VueUse equivalent applies. Its single-use `.app-frame` class
inlined as `class="h-full flex flex-col"`; `<style scoped>` block removed.

**`knip.json` (`81b2351`).** `@vueuse/core`, `reka-ui`, `class-variance-authority` dropped from
`ignoreDependencies` — knip's own "Configuration hints" confirmed real usage outside
`src/components/ui/**` once this part landed. `tw-animate-css`/`@lucide/vue`/`clsx`/`tailwind-merge`
stay: no hard case ended up pulling in a ready-made `src/components/ui/**` component (`DialogFrame.vue`
imports reka-ui's primitives directly, not through the registry wrapper), so their only importers
are still `src/lib/utils.ts` and `src/components/ui/**` itself, both still in the workspace's own
`ignore` list — a deviation from the plan's "Part 2 is the first consumer" framing, which assumed a
registry component would be imported directly; none was.

**Verification (§12.1-§12.2).** `bun run typecheck` clean across all five projects. `bun run lint`
— Biome 0 errors/warnings/infos over 1276 files, `check-tokens.sh` clean. `bun run build` and
`bun run build:vscode` both clean (only the pre-existing chunk-size warning). `bun run test:unit`
1535 passed, 0 failed (baseline: 1535). `bun run test:webview` 55 passed, 0 failed (baseline: 55).
`bun run lint:dead` — knip clean, only the same 6 pre-existing duplicate exports plus the same 4
pre-existing config hints (no `ignoreDependencies` hint left). `bun run test:ui` — 311 total; three
separate runs each hit 1-3 failures, never the same set twice (`repo-workspace.spec.ts`'s streamed-
search test, `api-ui-consistency.spec.ts`'s hover z-index test, `sql-schema.spec.ts`'s no-completion
test), the same cross-file-worker-contention timing-flake class Part 1's own result section
documents. Confirmed pre-existing and unrelated: `git diff --stat` from `19a90ed` touches none of
`tests/ui/`, `views/`, `repo/`, `api/`, or `editor/` (this part's own diff is confined to `App.vue`,
`theme/`, `workbench/`, `project/`, `shortcuts/`, `knip.json`), and every failing test passes clean
in isolation. `bun run test:visual` — 5 failed (`connection-dialog`, `console`, `data-view`,
`schema-dialog`, `workbench`), same 5 specs as Part 1's baseline, each a ~0.01-ratio pixel diff
consistent with `docs/ARCHITECTURE.md`'s own documented cause (glyph rendering outside the `ui` CI
job's exact `ubuntu-latest` environment, baselines never re-captured from elsewhere) rather than a
conversion regression — `workbench.spec.ts` and `schema-dialog.spec.ts` do exercise this part's own
styling, so their diffs got the closer look: same failure mode, same pixel-count order of magnitude
as the other three untouched specs, no new visual break.

No new `docs/ARCHITECTURE.md` **Known open items** entry: both failure classes are the same
pre-existing, already-documented baselines Part 1 inherited and this part re-confirms, not a new
discovery.

## P99 Part 3 result

Landed per plan (`docs/v1.9/plans/P99-vue-migration.md` §7, §9-§14), 7 commits from `54197ef`
through `c1e19e0`, plus this section's own commit. All 39 files in §7/§10.2's inventory (`api/` 19,
`views/httprequest` 15, `views/grpcrequest` 5) converted, one pass each, never reopened. Part 2
already converted every primitive these files consume with an unchanged public API, so no primitive
usage needed touching here — every diff is scoped to each file's own `<style scoped>` block plus,
where present, a hand-rolled debounce/timer.

**`54197ef`, `ab9cf05`, `d0d8f25` — the three request-view/table commits budgeted first per the
plan's own note that they were likely largest.** `FieldRowsTable.vue`/`FormDataTable.vue`/
`MetadataTable.vue` (`54197ef`) converted their `@apply`-eligible cell/row rules;
`FieldRowsTable.vue`'s `<script setup lang="ts" generic="...">` kept unchanged, per the plan's own
named note. `QueryParamsTable.vue`/`RequestHeadersTable.vue`/`UrlEncodedTable.vue` needed no edit at
all (no `<style>`, no VueUse-eligible pattern). `HttpRequestView.vue` (`ab9cf05`) and
`GrpcRequestView.vue` (`d0d8f25`) converted next, each its own commit; `GrpcRequestView.vue` also
replaced its manual `setTimeout`/`clearTimeout` schema-load debounce with `useDebounceFn` plus
explicit `.cancel()` calls (before reschedule and on unmount). `.request-pane`/`.request-splitter`/
`.url-field`/`.grpc-target-field`/`.grpc-method-field` kept their class names as test markers
(`api-ui-consistency.spec.ts`, `http-request.spec.ts`, `grpc-request.spec.ts` poll/select them
directly) — their CSS still converted to `@apply`, only the selector survives unchanged.

**`api/` dialogs and start screen (`a40d9fd`, 8 files).** `ApiStart.vue`/`CopyAsCurlDialog.vue`/
`SaveRequestDialog.vue` inlined their one-or-two-rule `<style>` blocks directly into template
classes and dropped the block entirely, rather than `@apply` — too small to earn a `<style>` block
of their own. `BulkVariablesEditor.vue`/`DynamicValuesDialog.vue`/`ImportReportStrip.vue` converted
to `@apply`. `ApiDialogs.vue` needed no edit (no `<style>`, no VueUse-eligible pattern).
**Debounce-shape deviation (named in the plan's own §7 note), resolved per-file, matching Part 2's
own precedent of deciding case by case rather than forcing one shape onto both):**
`EditRawRequestDialog.vue` mirrors `SchemaDialog.vue`'s exact `useDebounceFn` + explicit setter +
`onBeforeUnmount(() => setDebouncedText.cancel())` shape, because its dialog-open handler must write
both the live and debounced value immediately, bypassing the delay — `refDebounced` has no hook for
that immediate write. `ImportCurlDialog.vue` has no such external-immediate-write requirement, so it
takes `refDebounced` directly, exactly as the plan's own text suggested for that one file.

**`api/` collections/variables panels (`1cd95fb`, 10 files).** `CollectionRow.vue`,
`CollectionsPanel.vue`, `CollectionsTree.vue`, `EnvironmentSelect.vue`, `EnvironmentsView.vue`,
`MethodSelect.vue`, `VariableHistoryMenu.vue`, `VariableRow.vue`, `VariableSetView.vue`,
`VariablesOverviewPanel.vue` — every `<style scoped>` block converted to `@apply`; `.twisty` and
`.node-icon` in `CollectionRow.vue` kept their class names (test markers in `mutations.spec.ts`/
`fake-data.spec.ts`/`tree.spec.ts`). `VariableRow.vue`'s and `VariableSetView.vue`'s
`grid-template-columns` literal stayed plain CSS beside the `@apply` line (Tailwind has no named
utility for an explicit fixed/fractional column template) — the same "plain CSS declaration
alongside `@apply`" shape Part 2's `CollectionsPanel.vue`-adjacent files already established for
`all: unset`. `CollectionsTree.vue`'s `copyUrl` and `VariablesOverviewPanel.vue`'s `onCopy` keep
their existing `copyText()` calls unconverted — confirmed via grep across Part 2's own shipped files
(`TabStrip.vue`, `OperationsPanel.vue`, `ErrorPopover.vue`) that Part 2 never converted a
component-local clipboard write to `useClipboard()`, so this follows that precedent rather than
making an independent call.

**Informational observation, not a fix:** `CollectionRow.vue`'s `.rename-input` border uses the
arbitrary-value `border-[var(--kira-accent)]` rather than the Tailwind utility `border-accent`,
because `shadcn-bridge.css` maps `--color-accent` to `--kira-hover` (grey), not `--kira-accent`
(brand blue). Confirmed empirically (`bun run build`, grepping the compiled `dist/assets/*.css`):
`.bg-accent` compiles to `background-color: var(--accent)` (grey), and `.text-accent-fg` does not
compile to any rule at all. This is not a live rendering bug in Part 2's own `AppButton.vue`/
`IconButton.vue`, which use `bg-accent`/`text-accent-fg` for their primary variant — `primitives.css`'s
unscoped, unlayered `.p-btn.primary`/`.p-dlgbtn.primary` rules still supply the real
`background: var(--kira-accent)` styling, and Tailwind v4's cascade layers mean unlayered author CSS
always wins there regardless of source order or specificity. Out of this phase's scope (an
already-shipped, already-verified Part 2 file); noted here only so a future phase touching those two
files doesn't rediscover it as a surprise.

**`views/httprequest` body/response panes (`5d3eca5`, 9 files).** `BinaryBodyPicker.vue` inlined its
two-rule `<style>` directly into template classes. `CookiesPane.vue`, `RawExchangePane.vue`,
`RequestBodyPane.vue`, `RequestSettingsPane.vue`, `ResponseDiffDialog.vue`,
`ResponseHistoryList.vue`, `ResponsePane.vue`, `TimelinePane.vue` converted to `@apply`.
`.response-body` and `.response-status-row` kept their class names — `api-ui-consistency.spec.ts`
and three `http-*.spec.ts` files select on them directly via `page.locator('.response-body')` etc.
`RawExchangePane.vue`'s `onCopyRequest`/`onCopyResponse` keep their `copyText()` calls unconverted,
same precedent as above.

**`views/grpcrequest` panes (`c1e19e0`, 3 files).** `CallHistoryList.vue`, `ResponsePane.vue`,
`SchemaBrowser.vue` converted to `@apply`. `ResponsePane.vue`'s `.response-status-row` kept its class
name for consistency with the http-side component of the same name, even though no grpc-specific
test currently selects on it directly.

**Verification (§12.1-§12.2).** `bun run typecheck` clean across all five projects. `bun run lint` —
Biome 0 errors/warnings/infos over 1276 files, `check-tokens.sh` clean. `bun run build` and
`bun run build:vscode` both clean (only the pre-existing chunk-size warning). `bun run test:unit`
1535 passed, 0 failed (baseline: 1535). `bun run test:webview` 55 passed, 0 failed (baseline: 55).
`bun run lint:dead` — knip unchanged from baseline (6 duplicate exports + 4 config hints, all
pre-existing and unrelated; none touch a file this phase changed). `bun run test:ui` — 311 total,
311 passed, 0 failed — no flakiness surfaced this run (Part 1/Part 2's own result sections document
the `ui-timing`/pacing-budget class as flaky under cross-file worker contention; this run simply
didn't hit it). `bun run test:visual` — 5 failed, exactly the same 5 specs as Part 1/Part 2's own
documented baseline (`connection-dialog`, `console`, `data-view`, `schema-dialog`, `workbench`), 0
of the visual suite's 5 tests passing either before or after this phase — no new diff, no spec this
phase's own styling touches showing a different failure shape than its own pre-existing one.

No new `docs/ARCHITECTURE.md` **Known open items** entry: the `test:visual` failures are the same
pre-existing baseline Part 1/Part 2 already documented, not a new discovery; the accent/primary
token distinction noted above is Part 2's own already-shipped, already-verified behavior, not a
limitation this phase found or introduced.

## P99 Part 4 result

Landed per plan (`docs/v1.9/plans/P99-vue-migration.md` §8, §9-§14), 10 commits from `3f017d8`
through `5883add`, plus this section's own commit. This is P99's last part — see the closing note at
the end of this section for the phase as a whole.

**`3f017d8` — `views/definition` (6), `views/documents` (2), `views/keyvalue` (1), `views/stream`
(4), `views/browse` (1), 14 files.** Every `<style scoped>` block converted to `@apply`, no primitive
swap needed (Part 2 already converted the primitives these files consume). `BrowseView.vue`'s
`keyTypesDebounceTimer` setTimeout/clearTimeout pair → `useDebounceFn`, `onBeforeUnmount(() =>
ensureKeyTypesDebounced.cancel())` per `SchemaDialog.vue`'s own precedent (Part 2). `StreamView.vue`'s
inventoried "DEB" flag was a comment-only false positive (mentions `tabs.ts`'s own debounced save, no
debounce in this file itself) — noted, not converted. `ConstraintsSection.vue`'s `.ref-link:hover`
uses `text-[var(--kira-accent)]`, not the `text-accent` utility — the same accent/`--kira-hover`
cascade-layer workaround `CollectionRow.vue`'s rename-input already documents (Part 3).

**`1056b0d` — `views/shared`, 13 files.** `SearchToolbar.vue`'s `queryDebounceTimer` →
`useDebounceFn` (`SchemaDialog.vue` precedent). `DateTimePicker.vue` keeps the shadcn calendar
component declined, per the plan's own named call for that file — CSS/VueUse only, the calendar
question itself out of scope. `FilterHistoryMenu.vue`/`DateTimePicker.vue`/`DocumentRow.vue` use the
same accent-token workaround as above.

**`c05271e` — `views/grid`, 7 files.** `SlickGridHost.vue` (2,723 lines, per the plan's own named
note) carries **zero** `<style>` lines — VueUse-only. `scrollSaveTimer` → `useDebounceFn`
(`persistScroll`), explicit `.cancel()` in `onUnmounted` replacing the old `clearTimeout`. Three
patterns declined with an in-code, named reason each: (1) the `viewportEl` scroll listeners and the
`ResizeObserver` — registration order against SlickGrid's own internal scroll listener is documented
as load-bearing for the velocity sampler, and `onUnmounted`'s explicit "Order matters (§6 D3)"
hand-ordered teardown can't safely take a composable's `onScopeDispose`-driven cleanup; (2) the
header-cell `zone`/`sortIndicator` click listeners — SlickGrid itself creates and destroys these
nodes per header-cell render, well after `setup()`'s effect-scope capture, not a stable Vue-tracked
ref; (3) `onPaste`'s `navigator.clipboard.readText()` — `useClipboard`'s `read()` is a reactive-UI
composable, not documented to preserve the exact promise-rejects-on-permission-denial contract the
existing `try/catch` depends on, and no vendored VueUse source was reachable in this sandbox to
verify against, nor any existing `useClipboard`-read precedent in the app. `FkPreviewPopover.vue`'s
document-keydown-Escape listener → `useEventListener`, mirroring `PopoverPanel.vue`'s identical
pattern (Part 2).

**`2867a77` — `views/console`, 5 files.** `ConsoleSlickGrid.vue` (938 lines) mirrors
`SlickGridHost.vue`'s own three declines verbatim (same reasoning, cited directly) and likewise
carries zero `<style>` lines. `ConsoleSavedMenu.vue`'s `.save-current` uses the accent-token
workaround.

**`627289a` — six `views/repo/*.vue` files, a new `views/repo/terminalRendererLoader.ts`, and a
`flex-none` normalization, all in one commit. Disclosed deviation, not hidden or amended:** the
commit message only reads "style(frontend): normalize flex:0 0 auto to flex-none" — it names only
the `FkPreviewPopover.vue` `flex-none` fixup (three-utility `shrink-0 grow-0 basis-auto` spellings,
written before `OperationsPanel.vue`'s own `flex-none` precedent was found while converting
`RepoDiffView.vue`, normalized via `sed`). It does not name the `views/repo/*.vue` work also in the
same commit: `RepoDiffView.vue`, `RepoFileView.vue`, `RepoGraphView.vue`, `RepoMultiDiffView.vue`,
`RepoTerminalView.vue`, `ReviewThread.vue` converted to `@apply`, and `RepoTerminalView.vue`'s dual
`<script>` block fixed — its plain `<script lang="ts">` module block (lazy-loaded terminal-renderer
state plus a P97 `biome-ignore lint/correctness/noUnusedVariables`, needed because Biome's Vue
support can't link scope across a plain `<script>` and `<script setup>` block in one SFC) moved to
the new sibling module `terminalRendererLoader.ts`, mirroring `repo/git/gitUiModule.ts`'s
`loadGitUi()` shape and `editor/monaco.ts`'s `loadMonaco()` shape — eliminating both the dual-block
SFC and the P97 `biome-ignore` it carried. `RepoTerminalView.vue`'s `ResizeObserver` (constructed
inside `mount()` after `await loadTerminalRenderer()`) stays hand-rolled, declined: Vue's synchronous
"current instance" tracking, which a composable's automatic `onUnmounted` registration relies on, is
lost across that `await` gap — converting would need restructuring every callback to guard against
`renderer` still being null, a real behavior change §9.4 forbids riding along with a conversion.
**The commit's actual content is correct and fully verified** (typecheck/lint/tests all green both
at commit time and in this phase's own closing re-verification) — only the message under-describes
it. Not amended: `CLAUDE.md`'s git policy amends only on an explicit user request, and none was
given: this section is that disclosure instead.

**`2e9762f` — `repo/`, 8 files.** `GitPanel.vue`'s two raw `navigator.clipboard.writeText()` calls
("Copy path" on a repo row and a worktree row) now go through the app's shared `copyText()` wrapper,
the same convention `TabStrip.vue`/`OperationsPanel.vue`/etc. already use — these were not yet
wrapped at all, distinct from the established "leave an existing `copyText()` call unconverted to
`useClipboard`" precedent, which doesn't apply to a call that was never wrapped in the first place.
`GitPanel.vue`'s `.prompt-scrim` keeps its literal `z-30` rather than `var(--kira-z-dialog)`: unlike
`ConsoleSavedMenu.vue`'s own prompt-scrim (P28 D17(c), raised from inside a popover with its own
full-viewport backdrop to clear), this prompt raises directly from the panel, so there is no cascade
requirement forcing the dialog rung — preserved as-is per §9.4's "no behaviour change riding along."
`RepoFileTree.vue`'s `searchDebounceTimer` → `useDebounceFn`. `GitStart.vue`, `QuickOpen.vue`,
`RepoReviewView.vue`, `RepoSearchRow.vue`, `RepoSearchView.vue`, `RepoTreeRow.vue` — CSS only, no
VueUse-eligible pattern in any of the six.

**`002bee0` — `terminal/`, 2 files.** `TerminalPanel.vue`, `TerminalStart.vue` — CSS only, no
addEventListener/observer/debounce/clipboard pattern in either.

**`6c84476` — `editor/MonacoHost.vue`, wrapper CSS only, per the plan's own named note.** Only the
host-wrapper rules (`.monaco-host`, `.monaco-host-pending`, `.monaco-host--single-line.monaco-host-
pending`) convert to `@apply`. Everything past that stays plain CSS, undisturbed: rules reaching
Monaco's own DOM (`:deep(.monaco-editor)`, `:global(.monaco-hover)`, `:global(.suggest-widget)`) or
classes injected into Monaco's tokenizer output (`:deep(.kira-ed-*)`) — named in a comment added at
the boundary between the two, so a future edit doesn't have to re-derive the line.

**`4d54033`/`5883add` — the §12.3 phase-closing audit's own fixes, 10 files outside Part 4's own
56-file inventory.** The audit runs whole-tree by its own design (§12.3: "Run each of these over
`apps/kira-studio/frontend/src`"), so it surfaced hand-rolled patterns in files no part had ever been
assigned — pre-existing, not something an earlier part skipped. Fixed: `api/state/collections.ts` and
`project/state/tree.ts`'s watch+setTimeout search-debounce pairs → `refDebounced`; `state/mode.ts`,
`state/layout.ts`, `views/repo/blameLine.ts` → `useDebounceFn` (single-timer shapes, `.cancel()`
replacing the old `clearTimeout`); `state/tabs.ts`'s `saveDebounced`/`saveNow`/`flushPendingTabState`
→ `useDebounceFn`, `.cancel()` replacing the two `clearTimeout` call sites while `saveNow`/
`flushPendingTabState`'s own immediate-flush behavior is unchanged (they call the underlying save
function directly, same as before). `repo/git/hostHandlers.ts`'s `clipboard.write` RPC handler → the
same `copyText()` wrapper `GitPanel.vue` above now uses. **One real bug caught and fixed inside this
same pass, before commit, not after:** converting `project/state/tree.ts`'s debounce moved the
trim/lowercase step out of the debounced write and into `activeSearchQuery`'s own computed — but
`searchResult`'s own computed still read the raw `debouncedQuery.value` directly, bypassing that
step; fixed to read `activeSearchQuery.value` instead before the commit landed, so `TreeRow.vue`'s
highlight and the row-matching query stay byte-identical to pre-conversion behavior, not a
regression riding along with the conversion. Declined, named in-code: `views/httprequest/cookies.ts`'s
per-`tabId` debounce map (`useDebounceFn` debounces one function identity; a per-key cache of
debounced instances would be a new abstraction invented mid-pass for this one call site, which §9.4
forbids outside a genuine multi-site finding) and `views/shared/slick/scrollTrace.ts`'s dev-tool
clipboard write (its optional-chained `navigator.clipboard?` guard plus outer synchronous `try/catch`
handle a context where the Clipboard API may be entirely absent — a dev-tool console hook, not a
normal app surface — which `copyText()`/`useClipboard()` don't account for). `SlickGridHost.vue`'s
insert-region `el.addEventListener('input'/'keydown', …)` listeners were missing their own
declined-with-reasoning comment (the pattern was already declined in spirit — same hand-ordered
`onUnmounted` teardown sequence as the `viewportEl` listeners two hunks above — just never written
down); added, no behavior change.

**§12.3 audit — every check, full accounting.**

| Check | Result |
|---|---|
| No hand-rolled event wiring | Every `addEventListener` hit is inside a VueUse call, a non-component `.ts` module VueUse can't reach (`kiraSlickGrid.ts`, `reviewDecorations.ts`, `views/grid/slick/editor.ts`, `repo/git/transport.ts` — no active Vue effect scope), or a named decline (`SlickGridHost.vue`/`ConsoleSlickGrid.vue`'s order-dependent teardown listeners including the insert-region pair fixed above, the header-cell zone listeners, `RepoTerminalView.vue`'s async-boundary construction) |
| No raw observers | Same — every `ResizeObserver` hit is `VirtualList.vue`'s existing `useResizeObserver` or one of the same named declines above |
| No hand-rolled debounce/throttle | 6 hits fixed (`4d54033`), 1 declined with a named reason (`cookies.ts`) — see above |
| No raw clipboard | 1 hit fixed (`5883add`), 1 declined with a named reason (`scrollTrace.ts`); the rest are `clipboard.ts` itself, `SlickGridHost.vue`'s already-declined read, and established component-local `copyText()` calls Parts 2/3 already left unconverted to `useClipboard` |
| No `reactive()`/module `ref()` outside a store | Zero hits |
| No manual loading/error/isLoading fetch triple | Zero hits |
| Every component exactly one `<script>` block | Confirmed across all 269 `.vue` files in `apps/kira-studio/frontend/src` + `packages/git-ui/src` — exactly 1 real block each. `RepoGraphView.vue`'s `grep -c "<script"` hit of 2 is a comment mentioning `<script setup>`, not a second block — verified false positive |
| Scoped-CSS residue vs. 7,125-line baseline | 5,260 lines (strict `^<style`/`^</style>` count), a 26% reduction. Sampled the 10 largest remaining blocks; categories: `:deep()` reaching third-party DOM (28 files, e.g. `MonacoHost.vue`), `:global()` (1 file, `MonacoHost.vue`), `@keyframes` (2 files: `FkPreviewPopover.vue`, `TreeRow.vue`), `grid-template` (7 files, e.g. `ConnectionDialog.vue`), `calc()` mixing a literal `14px` with `--kira-s-*` tokens (`GitPanel.vue`, this part), a deliberately-preserved literal `z-index: 30` (`GitPanel.vue`, distinguished above from `ConsoleSavedMenu.vue`'s `var(--kira-z-dialog)` case). **Informational, not fixed:** several already-shipped Part 2/3 files whose own result sections say "converted whole in one pass" (`SettingsDialog.vue`, `ConnectionDialog.vue`, `OperationsPanel.vue`, `TitleBar.vue`, `TabStrip.vue`, `FiltersDialog.vue`) still carry plain-CSS declarations using a `var(--kira-*)` token directly (e.g. `color: var(--kira-fg-muted);`) where a named Tailwind utility exists (`text-muted`) — not a skipped block, an idiom-consistency gap. Left alone: fixing it means re-touching and re-verifying already-shipped Part 2/3 files entirely outside Part 4's own 56-file assignment, which is work "genuinely outside this phase's own scope" per `CLAUDE.md`'s own carve-out for that exception — named here rather than silently dropped or blanket-fixed without re-running those files' own verification |
| knip has none of P98's seven bootstrap ignores left | 3 of 7 removed in Part 2 (`@vueuse/core`/`reka-ui`/`class-variance-authority`); the other 4 (`tw-animate-css`/`@lucide/vue`/`clsx`/`tailwind-merge`) stay ignored per Part 2's own documented, still-accurate reason (no app file outside `src/components/ui/**`/`lib/utils.ts` imports any of the four directly) — re-confirmed by grep, still zero hits after Part 4's own work. `bun run lint:dead` clean, same 6 pre-existing duplicate exports + 4 config hints as every prior part's baseline |
| No orphaned primitive | Zero — `git diff --diff-filter=D` against the pre-chapter commit is empty for `theme/primitives/`; no wrapper was deleted anywhere in v1.9 |
| a11y side effect (informational, for P101) | `biome.json`'s `**/*.vue` `a11y: off` override removed, `bun run biome check` over `apps/kira-studio/frontend/src packages/git-ui/src packages/kira-ui/src`: **255 errors across 86 files** (P97's baseline: 255 across 85 files — same total error count, one additional file now shows a finding). Not fixed, per instruction. Override restored immediately after (`git diff biome.json` confirmed empty); `bun run lint` reconfirmed clean |

**Verification (§12.1-§12.2).** `bun run typecheck` clean across all five projects. `bun run lint` —
Biome 0 errors/warnings/infos over 1277 files, `check-tokens.sh` clean. `bun run build` and `bun run
build:vscode` both clean (only the pre-existing chunk-size warning; `build:vscode` also confirms
§2.2's scope check — `apps/kira-studio-vscode/` untouched by this phase). `bun run test:unit` 1535
passed, 0 failed (baseline: 1535). `bun run test:webview` 55 passed, 0 failed (baseline: 55). `bun
run lint:dead` — knip unchanged from baseline (6 duplicate exports + 4 config hints, all
pre-existing). `bun run test:ui` — 306 passed, 1 failed, 4 did not run. Failure:
`cell-editor.spec.ts`, `Error: locator.click: Target page, context or browser has been closed` —
isolated with `--workers=1`, passes 3/3; a pre-existing, unmodified comment already inside
`SlickGridHost.vue` names this exact failure signature as a known pre-existing timeout, and `git diff
--stat` against the Part 3 boundary (`63e1aa0`) touches neither `cell-editor.spec.ts` nor
`tests/ui/support/`. The 4 "did not run" are `ui-timing`'s own tests, skipped by Playwright's
dependency-cascade default when `ui` has a failure (`ui-timing` has `dependencies: ['ui']`) — run
`--no-deps` to check directly, and 1 of the 4 also failed: `budgets.spec.ts`'s scroll-response p50
assertion (13ms measured against a 12ms budget), reproduced twice. **Investigated rather than waved
through**, since this differs from Part 1's own claim that all 4 pass clean under `--no-deps`: the
assertion's own in-file comment already documents it as contention-sensitive and tuned against a
specific dev machine ("a real and reproducible 9-10ms under full-suite contention, not a one-off
flake... the flakiness here is cross-file worker contention"), and Part 1's own result section
independently hit this exact same `budgets.spec.ts` scroll-delta percentile flake twice across its
three runs — the same pre-existing class, not new. Proved conclusively by reverting
`SlickGridHost.vue` to its exact pre-Part-4 (`63e1aa0`) content and re-running the identical test: it
failed identically (`Received: 13`), with zero Part 4 code in the file — confirming this is
environmental/sandbox timing, not a regression from anything this phase changed. Reverted the file
back to its committed Part 4 content afterward (`git diff` confirmed empty against the commit;
typecheck/lint reconfirmed clean). `bun run test:visual` — 5 failed, exactly the same 5 specs as the
documented baseline (`connection-dialog`, `console`, `data-view`, `schema-dialog`, `workbench`) — no
new diff.

No new `docs/ARCHITECTURE.md` **Known open items** entry: every `test:ui`/`test:visual` deviation
above was investigated and confirmed pre-existing/environmental, not a limitation this phase found or
introduced. `docs/ARCHITECTURE.md`'s Stack row is updated by this same commit, "P99 migrates" →
"P99 migrated" (§11's own instruction for Part 4).

**P99 closing summary.** All four parts are done: Part 1 (libraries and state onto Pinia/TanStack
Query), Part 2 (shell/chrome/primitives, 48 files), Part 3 (the API client surface, 39 files), Part 4
(data/repo/terminal/editor views plus this phase-closing audit, 56 files + 10 more the audit itself
surfaced) — every `.vue` file in `apps/kira-studio/frontend/src` (plus `packages/git-ui`'s one
crossing, §2.3) is on Tailwind/shadcn-vue/VueUse/Pinia/TanStack Query, one pass each, none reopened.
The phase-closing audit ran exactly once, at the end of this last part as planned (§8), over the
whole tree rather than just this part's own files, and every one of its eleven checks is accounted
for above — either converted or declined with the requirement named in code. The one open item it
produced is informational, not a defect: the a11y recount (255 errors across 86 files, up from P97's
255/85 by one file, same total count) is P101's own starting point, named here and nowhere else —
this phase fixes none of it, per its own explicit instruction not to.

## P100 Part 1 result

Landed per plan (`docs/v1.9/plans/P100-kira-space-extraction.md` §0-§3, §4, §8-§11), 25 commits
from `dec0635` (hoisting the first repo-root package) through `4ab4656` (Kira Studio's own
cleanup), plus this section's own commit.

**Repo-root hoist (§4.2), 8 packages, 3 commits, not one-per-package.** `ipcerr`/`notify`/
`pathsafe`/`rpcstream` landed together (`dec0635`) since none needed anything beyond a plain
`git mv` + import-path rewrite; `startupfail`/`logging` together (`2691855`), each parameterized
(`startupfail.Info`/`Reporter` DI, `logging.Init` taking a logs-dir argument) since neither could
stay a process-wide singleton once two apps link it; `kirapaths`/`sqlitex` together (`6a544f3`), new
packages generalized out of `apps/kira-studio/internal/config`/`storage`'s own path-join and
migration-runner logic rather than duplicated. Each commit left `go build ./...` green.

**Go's `internal/` visibility rule broke the plan's literal "one `git mv` per commit, green at
every step" strategy — root-caused, not worked around silently.** A package under
`apps/kira-studio/internal/...` is importable only by code rooted under `apps/kira-studio/`; §4.6's
listed move order (`gitwire` → ... → `gitsock`) has `gitsock` importing `gitwire` at both ends, so
moving `gitwire` out first would break Studio's still-resident `gitsock` before `gitsock` itself
ever moves. Fixed with a copy-forward/delete-backward strategy instead: each of the 15 git packages
plus `ghclient`/`codeworkspace` was copied to its new home, leaving Studio's own copy fully intact
and self-consistent, until every package, the 4 bridge files and kira-space's own `main.go` existed
and built in the new location — only then did one final commit (`4ab4656`) delete every old Studio
copy at once, at the exact point nothing in Studio referenced them any more. `go build ./...` (whole
repo) stayed green at every single commit throughout, which was the plan's real intent even though
its literal instruction (delete-as-you-go) could not satisfy it. Each of the 16 package-move commits
documents this; the first (`cfea4e3`, `gitwire`) carries the full rationale, every later one points
back to it.

**§4.6's suggested move order was not a valid topological order — corrected, not followed
blindly.** `gitstore` (the plan's position 3) actually imports `gitclient/porcelain` (position 4),
confirmed by `grep`. Computed the real order via Kahn's algorithm instead: `gitwire, gitpath,
ghclient, gitprepare, gitaskpass, gitvsix, gitclient (+ porcelain/catfile/logsession), gitstore,
gitpreflight, gitsearch, gitreview, gitops, codeworkspace, gitrpc, gitsock` — one topological
sort, `ghclient`/`gitvsix` interleaved where their own dependency edges actually place them rather
than appended at the end as the plan's prose does.

**Wails skeleton, home/DB/socket split (§4.1, §4.2, §4.4), landed as documented at the time
(`b4a6368`, `5af6f15`).** `apps/kira-space` builds (no `frontend/`, Part 2's job — `frontend/dist/
index.html` is a force-added placeholder so `//go:embed` compiles), `KIRA_SPACE_HOME`, its own
`kira.db`, `review.db`, `git.sock`. Root `package.json`'s `dev:space`/`build:space`/`package:space`/
`typecheck:space-web` scripts stay deferred to Part 2 — they'd reference a `frontend/`/`tsconfig`
that doesn't exist yet.

**Storage split (§4.5), one stated deviation.** `apps/kira-space`'s `0001_init.sql` carries no
`layout`/`tabs` tables — nothing in Part 1 reads or writes them (no frontend, no window-layout
persistence yet), and Part 2 is where they'd first matter. `model.Settings` trimmed to
`Appearance`/`Advanced.GitLogLevel`/`Git`; `repos.Repos` trimmed to 5 fields (`Settings`, `Windows`,
`GitClients`, `CodeRepos`, `GitRepoSettings`).

**The 4 bridge files (`dbb523c`) needed a trimmed `appcore.Deps` (3 fields: `Repos`, `Events`,
`GitRegistry`) and two new local interfaces, not verbatim copies.** `bridge/stream.go`'s
`StreamSession` and `bridge/browser.go`'s `Browser` each carry only the one method `gitstream.go`/
`github.go` actually call — Studio's own versions live in files (`stream.go`'s full form,
`update.go`) that also pull in `adapterhost`/`appupdate`, neither of which Part 1 has any reason to
import. A new `apps/kira-space/internal/bridge/events.go` carries just the 3 channel constants the
4 files need (`ChannelCodeSearch`, `ChannelGitPairing`, `ChannelGitClientsChanged`) — declared,
unsubscribed, since Part 1 has no `Events.Attach` wiring of its own yet.

**`main.go`, shell (`9d8c62d`), deliberately simpler than Studio's, each cut named in its own
commit message.** `shell/quit.go` has no per-window flush handshake (Kira Space has no tabs/layout
to flush yet); `shell/menu.go`/`menutemplate.go` are minimal (3 sections, no `ItemEmit` kind);
`shell/app.go` has no `Dialogs`, no `AttachSystemWake`. `wireGit` is lifted wholesale from Studio's
own (same runner/discovery/registry/askpass-broker/router/socket sequence). Kira Studio's askpass
shim is deleted from Studio's `main.go` in the cleanup commit — Kira Space's own `main.go` is now
the only askpass entry point.

**One real content change inside a "move", flagged as such per §4.6's own framing (not just an
import-path rewrite):** `apps/kira-space/internal/gitreview/db.go`'s `DefaultPath()` used
`config.KiraHome()`, undefined in kira-space's own `config` package — fixed to
`config.KiraSpaceHome()`.

**`layering_test.go` copied to both apps (`4cd211b`), retargeted, not merely duplicated.**
Kira Space's own carries `modulePrefix = ".../apps/kira-space/"` and a trimmed exemption set
(`{internal, internal/bridge, internal/shell}` vs. Studio's larger one). Both pass —
`TestDomainPackagesDoNotImportBridge` checks 44 non-exempt packages across the two apps combined (18
in kira-space, 26 in Studio after cleanup), zero violations.

**Kira Studio's cleanup (`4ab4656`) — one deliberate exception to the task's own instruction, plus
two follow-on fixes it required.** `advanced.gitLogLevel` (and the rest of `GitSettings` on
`model.Settings`) was **not** removed, despite being named alongside `wireGit`/`RegisterGitStream`
in the task's own instruction: it's mirrored in `packages/shared/domain/settings.ts` and
`SettingsDialog.vue` (confirmed by grep), so a Go-only removal would break the settings round-trip
(the frontend still sending/expecting a field Go no longer has) — worse than leaving it alone, and
fixing it correctly needs a frontend change, out of this phase's Go-only scope. Only the
`GitRegistry`-fed `ReconcileAutoFetch()` side effect (pure Go-internal, no wire coupling) came out
of `bridge/settings.go`. This one exception cascaded two fixes the plan didn't anticipate: (1)
`ValidLogLevel` — `advanced.gitLogLevel`'s own validator — lived in the deleted
`storage/model/gitreposettings.go`; moved into `settings.go` itself, its only remaining caller,
since keeping the leaf without it would not build. (2) `bridge/link_test.go`'s `fakeBrowser` lived
in the deleted `github_test.go`; it's `LinkService`'s own test double, unrelated to git, so it moved
into `link_test.go` directly rather than being recreated as a new shared fixture for one caller.

Everything else the task named came out cleanly: `wireGit`/`gitWired`, every git-threaded parameter
through `wireEmbeddedServices`/`wireLifecycle`/`postAppDeps`, the 3 git `Services` entries, the
whole pairing-notification block (`wirePairingNotifications` plus its bottom-of-file helpers —
`gitsock.OnPairingChanged` was its only trigger, and with it gone the `notifications` package has no
caller left in Studio either, so it and its `notifier` variable came out too, not just the pairing
code path), `bridge/events.go`'s `Git` `Sources` field and the two pairing channels (comment points
at their new home), `shell/app.go`'s `RegisterGitStream`. `model/window.go`'s `validWindowModes`
drops `"git"` — a stored `git` row degrades to `studio` through `NormalizeMode`, the same posture
the file already documents for an unrecognised mode, no migration needed for the window-mode leaf.
`internal/ipcfixture/harness.go` needed no edit — it never referenced the git bridge services in the
first place (confirmed by grep before and after; `go build`/`go vet` on it stayed clean throughout).

**`0026_p100_drop_git_tables.sql`**: drops `git_repo_settings`, `git_clients`, `code_repos`.
`tabs.workspace_id` stays, per the plan's own §4.5 reasoning — every remaining tab already parses as
`workspace_id IS NULL`, so dropping the column would rewrite the whole table for no behavioural
gain, and `model.NormalizeMode`'s degrade-on-unrecognised posture already covers the same case.

**One-time import of pairings/repo list (§4.5) — scoped out, not attempted, per the plan's own
named fallback.** The plan explicitly allows recording "ship nothing" here if the import "turns out
to need more than one commit's worth of work," and it does: a settings-row guard needs a working
Settings read/write path wired into kira-space's own boot sequence (Part 1 has no `SettingsService`
bridge yet, deliberately — nothing in Part 1 reads settings past `Advanced.GitLogLevel` at
`logging.SetLevel` time), the import itself is a genuine first-boot ordering problem (must run after
kira-space's own DB is open and before any repo/pairing read, entirely separate from `wireGit`'s
existing sequence), and it touches a second database (`review.db`) with its own failure-must-not-
damage-either-file requirement. Given Part 1's already-large scope (the copy-forward migration
alone), this is real, multi-commit-shaped work, not a corner that was cut for convenience — flagged
here for the orchestrating session to schedule (a new phase, or folded into Part 2 once
kira-space has a real settings path) rather than silently dropped or half-built.

**Verification (§9).** `go build ./...` clean (both apps). `go vet ./...` clean. `gofmt -l` on
every file this phase touched: clean (Studio's pre-existing drift in ~23 unrelated files, confirmed
via `git status` to be untouched by this phase, matches the pattern already documented at `2691855`
and earlier commits in this phase). `bun run lint:go` (`golangci-lint`): 0 issues. `bun run test:go`:
every package green, including both `layering_test.go` copies (`TestDomainPackagesDoNotImportBridge`
run explicitly with `-v`, 44 subtests total across both apps, all pass). `bun run typecheck`: clean
across all five projects — untouched by this phase, re-run to confirm nothing broke. Both real
binaries were run directly (no display in this sandbox, so this is as far as either can be
verified): Kira Studio boots through config/logging/storage(migrated through `0026`)/repos/
settings/adapters/connections/oplog/metrics/window-list, stopping only at this container's GTK
"Failed to open display"; Kira Space (verified in the prior session segment, re-confirmed
unaffected by this segment's Studio-only changes) produces `~/.kira-space/git.sock` at mode `0600`
before hitting the same GTK failure. One sandbox artifact, not an app bug: a long scratchpad
`KIRA_SPACE_HOME` path first failed `gitsock.Start()` with `bind: invalid argument` (Linux's
~108-byte `sun_path` limit) — resolved by re-testing with a short `/tmp` path, which succeeded
cleanly.

No new `docs/ARCHITECTURE.md` **Known open items** entry — that file is explicitly Part 4's to
edit, not this phase's; the one open item this phase produced (the deferred first-boot import,
above) is recorded here instead, for the orchestrating session to route.

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
