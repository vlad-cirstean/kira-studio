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
| **P99 Migrate every Vue file onto shadcn-vue/Tailwind/VueUse/Pinia/TanStack Query** | Thorough, repo-wide migration onto what P98 wired in — not opportunistic, not "whichever apply happen to get touched." Every `.vue` file's hand-written CSS converted to Tailwind utility classes wherever Tailwind covers it; every component converted to `<script setup lang="ts">` (Composition API only); every hand-rolled equivalent of a VueUse composable (debounce, resize/intersection observers, event-listener wiring, local-storage sync, and similar) replaced with the VueUse composable; every store consolidated into single-responsibility Pinia stores (splitting any grab-bag store found along the way); every ad hoc server-state/data-fetching pattern (manual loading/error/cache state around a fetch) migrated onto TanStack Query; shadcn-vue swapped in for component primitives wherever a hand-rolled equivalent exists (buttons, dialogs, dropdowns, menus, and similar). **One touch per file**: every `.vue` file this phase opens gets every applicable change from this list in that same pass — never reopened later for another one of these. This phase's own planning pass does a full component/store inventory first (per-file, which changes apply) instead of one pass per library, and its plan states a verification step confirming thoroughness at the end — an audit/grep pass confirming no leftover hand-rolled equivalent remains for anything these libraries cover, not just that the touched files look converted. One sequential subagent implements the whole phase — no parallel subagents, per-file or per-directory, despite the file count; a file's apparent independence from another isn't grounds for an exception here, by explicit instruction. Speed comes from touching each file once, not from fan-out | The actual migration, split from P98 so setup/convention-codification isn't gated on (or gating) the much larger file-by-file conversion work, and so P98's bootstrap wiring is verified working in isolation before hundreds of files build on top of it |
| **P100 Extract the git module into its own app, "Kira Space"; rename the git VS Code extension; new icon** | Pull every git-specific subsystem currently embedded in `apps/kira-studio` out into a new, standalone app. Go side: `internal/gitwire`, `gitops`, `gitpath`, `gitaskpass`, `gitsock`, `gitsession`, `gitrpc`, `gitstore`, `gitclient`, `gitvsix`, `gitprepare`, `gitsearch`, `gitreview`, `gitpreflight`, plus the git-specific slice of `internal/bridge` (`gitclients.go`, `gitstream.go`, `github.go` and their tests). Frontend side: `frontend/src/repo/*` (`GitPanel.vue`, `GitStart.vue`, `RepoReviewView.vue`, `RepoFileTree.vue`, `RepoSearchView.vue`, `RepoTreeRow.vue`, `RepoSearchRow.vue`, `repo/git/*`), `workbench/GitCredentialDialog.vue`, `workbench/GitPairingDialog.vue`, `state/coderepos.ts`, `state/repoTabs.ts`, `state/gitCredential.ts`, `state/gitClients.ts`, `state/repoOpenHold.ts`. New app lives at `apps/kira-space`, built the same way `apps/kira-studio` is (this phase's own planning pass confirms the exact shell/build setup), reusing `packages/git-core`/`git-ipc`/`git-ui` exactly as `apps/kira-studio-vscode` already does rather than duplicating them. `apps/kira-studio` keeps only its DB/HTTP/gRPC/queue client surface once this lands — no leftover git code, dependency, or dead route. The extension is not an independent product: it already runs as a thin client over a paired socket/RPC connection (`internal/gitsock`/`gitrpc`, device pairing via `GitPairingDialog.vue` and the `git_clients` table) to a running backend, and does not function without one. That backend relationship moves from `apps/kira-studio` to `apps/kira-space` as part of this extraction — the extension depends on Kira Space at runtime the same way it depends on Kira Studio today, just retargeted — and the extension is distributed as part of the Kira Space release rather than as an independent listing (this phase's own planning pass picks the exact packaging mechanism: bundled in the same installer/release artifact, or published separately but version-locked to it, whichever the existing VS Code extension distribution setup makes least disruptive). The existing VS Code extension (`apps/kira-studio-vscode`, currently named "Kira Version") is renamed to match the new "Kira Space" branding — package name, `displayName`, every `kiraVersion.*` command/view/container id, and every user-facing string this phase's own planning pass finds; the plan states the exact new identifiers it picks. New icon, shared by the new app and the renamed extension: today's shared Kira-cat mascot icon (`apps/kira-studio/build/appicon.icon/Assets/kira_icon_vector.svg`) moves from its current tan/brown gradient background to a blue one, with the "database stack" and "sql cell grid" layered glyphs removed from the composition — Kira Space is git-only, not a DB client, so those two don't belong on its icon; this phase's own planning pass decides whether the remaining glyphs (document braces, message queue) still read as sensible on a git-focused mark or should also go. This phase's own planning pass also decides whether the combined scope (backend extraction, frontend extraction, extension rename, new icon) needs its own split into multiple phases — the way P98 was later split into P98/P99 — rather than landing as one oversized sequential implementation | New, large architectural initiative: Kira Studio narrows to its DB/HTTP/gRPC/queue client scope; git functionality becomes its own dedicated product (a desktop app plus a VS Code extension) under one consistent "Kira Space" brand instead of living inside the DB client app |

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

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
