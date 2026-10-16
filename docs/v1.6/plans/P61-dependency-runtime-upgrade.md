# P61 — Dependency and runtime upgrade

## 0. Scope, and the tree this lands on

SPEC's P61 row: bring the toolchain and every major dependency to current latest stable, on the tree
**P60 leaves**. P60a/P60b removed all ten `@codemirror/*` + `@lezer/highlight` entries from root
`package.json`; confirmed gone (`grep -rn "codemirror\|@lezer" package.json packages/*/package.json
apps/*/frontend/package.json` returns nothing). So P61 starts from a `package.json` that was already
disturbed once, which is the whole reason SPEC sequenced it here.

SPEC also says the current-vs-latest inventory belongs in this plan, checked at plan time. It is §2-§4
below. **Two of SPEC's own opening numbers are still true** (Go `1.27.0`, Wails `v3.0.0-beta.16`);
everything else was re-checked rather than copied.

This phase changes versions, a handful of version literals in scripts/config, and nothing else. No
feature work, no API adoption (§12).

---

## 1. How this inventory was built

Checked 2026-09-14, directly, not from memory:

- **Go**: `go.mod` read in full for current versions; `https://proxy.golang.org/<module>/@latest` for
  latest, and `/@v/list` where a version needed confirming.
- **npm**: root `package.json`, all eight workspace manifests and `bun.lock` for current;
  `https://registry.npmjs.org/<pkg>` for latest, plus `peerDependencies`/`engines`/`exports` where a
  jump needed judgment.
- **Runtimes**: no `.tool-versions`, no `engines` field anywhere except the VS Code extension's
  `engines.vscode`. CI pins nothing but `bun-version: latest` and `go-version-file: go.mod`.
- **Wails**: both module versions extracted into the local Go module cache and diffed source-to-source
  (§5). `wails.io`/`v3.wails.io` are 403-blocked per `docs/DEV_ENVIRONMENT.md`, so the module source
  is the only honest reference — the same rule that file already states.

A version table goes stale. **Re-run the two `@latest` sweeps at implementation time** and treat any
row that moved further as a bump of the same class, not as a reason to re-plan.

---

## 2. Go modules

### 2.1 Bump — routine

| Module | Current | Latest |
| --- | --- | --- |
| `github.com/aws/aws-sdk-go-v2` | v1.45.1 | v1.47.0 |
| `github.com/aws/aws-sdk-go-v2/config` | v1.33.2 | v1.33.4 |
| `github.com/aws/aws-sdk-go-v2/credentials` | v1.20.2 | v1.20.4 |
| `github.com/aws/aws-sdk-go-v2/service/s3` | v1.110.0 | v1.113.1 |
| `github.com/aws/aws-sdk-go-v2/service/sqs` | v1.50.0 | v1.52.0 |
| `github.com/go-sql-driver/mysql` | v1.10.0 | v1.10.1 |
| `github.com/moby/moby/api` | v1.55.0 | v1.56.0 |
| `golang.org/x/text` | v0.41.0 | v0.42.0 |
| `golang.org/x/time` | v0.15.0 | v0.16.0 |

Indirect, moving with the above or on their own: `golang.org/x/crypto` v0.55.0 to v0.57.0,
`x/net` v0.58.0 to v0.59.0, `x/sys` v0.47.0 to v0.48.0, `x/sync` v0.22.0 to v0.23.0,
`x/oauth2` v0.36.0 to v0.37.0, `x/mod` v0.40.0 to v0.41.0.

### 2.2 Bump — needs a real look

| Module | Current | Latest | Why it is not routine |
| --- | --- | --- | --- |
| `github.com/wailsapp/wails/v3` | v3.0.0-beta.16 | v3.0.0-beta.21 | §5 — its own section |
| `modernc.org/sqlite` | v1.57.0 | v1.58.0 | This is the app's **own storage engine** (`KIRA_HOME`'s database) *and* the sqlite adapter, and it is a transpiled C codebase whose minor releases carry real upstream SQLite changes. `internal/adapters/sqlite/*_test.go` and the storage tests are the check; both run with no Docker (`bun run test:go`) |
| `go.mongodb.org/mongo-driver/v2` | v2.8.2 | v2.9.1 | Minor on the driver behind a whole adapter kind. `internal/adapters/mongo` conformance suite is the check; needs a real container |
| `github.com/jackc/pgx/v5` | v5.10.0 | v5.11.0 | Same shape, Postgres. `internal/adapters/postgres` conformance suite; needs a real container |
| `github.com/modelcontextprotocol/go-sdk` | v1.7.0 | v1.8.0 | Backs `internal/repomap`'s MCP server — the six tools `CLAUDE.md` requires every session to navigate with. A wire/protocol change here breaks the dogfooding path itself, and the failure mode is "the tool answers wrongly", not "it fails to build". Verify by actually calling the server over the `curl` recipe in `CLAUDE.md`, not just by compiling |

### 2.3 Already current — no action

`smithy-go` v1.28.1, `protocompile` v0.14.1, `fsevents` v0.2.0, `fsnotify` v1.10.1, `go-cmp` v0.7.0,
`uuid` v1.6.0, `keybase/go-keychain` v0.0.1, `redis/go-redis/v9` v9.22.0, `gopsutil/v4` v4.26.8,
`testcontainers-go` v0.44.0 and all five of its modules, `franz-go` v1.21.6 with `kadm` v1.18.0 and
`kmsg` v1.13.1, `grpc` v1.83.2, `protobuf` v1.36.12.

**All eleven tree-sitter modules are already at their newest tags** (`go-tree-sitter` v0.25.0, css/go/
javascript/python v0.25.0, json v0.24.8, java v0.23.5, html/typescript v0.23.2, rust v0.24.2,
svelte v1.0.2). Nothing to bump, which also means the ABI-14-inside-[13,15] check
`docs/ARCHITECTURE.md:49` records stays exactly as measured.

**One proxy quirk, so it is not mistaken for a downgrade:**
`proxy.golang.org/github.com/tree-sitter/go-tree-sitter/@latest` answers **v0.24.0**, while `@v/list`
shows v0.25.0 and its `.mod` fetches cleanly with the correct module path. v0.25.0 is real and not
retracted; `go.mod` is already on it. Leave it. If `go list -m -u` stays silent on this module, that
is why.

### 2.4 Hold — `github.com/google/flatbuffers` (§6.1)

v25.9.23+incompatible, latest v25.12.19+incompatible. **Do not bump.** Reason in §6.1.

### 2.5 Go toolchain

`go.mod`'s directive is `go 1.27.0`; there is no `toolchain` directive. Latest stable is **go1.27.1**.

Bump the directive to `1.27.1`. It is not cosmetic: `scripts/lib.sh:go_directive()` feeds it to
`GOTOOLCHAIN=go<directive> go install` for the `wails3` CLI (P20 F7 — an unpinned toolchain once
degraded the bindings generator into 52 spurious warnings), CI resolves its Go from
`go-version-file: go.mod`, and `scripts/setup.sh` reinstalls `wails3` whenever the installed binary's
own build toolchain is older than the directive. So one edit moves the local dev loop, CI and the
CLI's build toolchain together, by design.

---

## 3. npm packages

Root `package.json` unless noted. `bunfig.toml` sets `install.exact = true`, so every version is a
literal string — and several appear in more than one manifest (§7.1).

### 3.1 Bump — routine

| Package | Current | Latest | Note |
| --- | --- | --- | --- |
| `zod` | 4.5.4 | 4.6.5 | also `packages/shared` |
| `@biomejs/biome` | 2.5.11 | 2.5.13 | `biome.json`'s `$schema` carries the version too (§7.1) |
| `@types/node` | 26.4.1 | 26.5.1 | |
| `@vitejs/plugin-vue` | 6.0.8 | 6.0.9 | also `packages/git-ui`, `packages/kira-ui` |
| `bun-types` | 1.4.0 | 1.4.2 | also four `packages/*` |
| `simple-icons` | 16.29.0 | 16.31.0 | icon *data*; `EngineIcon.vue` reads `path`/`hex`, so a changed mark moves a visual snapshot. `NOTICES.md` names the package but pins no version, so no notice edit |

### 3.2 Bump — needs a real look

| Package | Current | Latest | Why |
| --- | --- | --- | --- |
| `vite` | 8.2.2 | 8.3.0 | Minor on Rolldown-backed Vite. It cannot break types, but it **can move chunking** — and `docs/ARCHITECTURE.md:29` records a measured chunk inventory (`index-*.js` 1 307.65 kB raw / 384.15 kB gzip post-P60b; `monacoEntry-*.js` 3.81 MB / 972 kB gzip) that is a claim about this build. Re-measure and correct it, or confirm unchanged. Also in `packages/git-ui` |
| `@playwright/test` | 1.62.1 | 1.63.0 | Moves the **bundled WebKit revision**, and WebKit is what `ui`, `ui-timing` and `visual` all run on (`playwright.config.ts:49,74,102`) — deliberately, to match what a packaged build embeds. A browser bump can move rendered geometry, so the five committed `.png` baselines and the timing suite are both genuinely at risk. This container also needs `bunx playwright install webkit` re-run plus the exact system libraries `docs/DEV_ENVIRONMENT.md` names |
| `@wailsio/runtime` | 3.0.0-beta.16 | 3.0.0-beta.21 | Not independent — must equal `go.mod`'s Wails version exactly. §5.3 |

### 3.3 Already current — no action

`@faker-js/faker` 10.6.0, `@tailwindcss/vite` 4.3.3, `tailwindcss` 4.3.3, `@testcontainers/{kafka,
mariadb,postgresql}` 12.1.0, `testcontainers` 12.1.0, `@types/pg` 8.23.1, `@vscode/codicons`
0.0.46-24, `@vscode/vsce` 3.9.2, `mariadb` 3.5.4, `pg` 8.23.0, `sql-formatter` 15.8.2, `vue` 3.5.42,
`vue-tsc` 3.3.11, `@floating-ui/dom` 1.8.0, `flatbuffers` 25.9.23 (npm has no newer release at all —
§6.1), `fuzzysort` 4.0.2, `monaco-editor` 0.56.0, `shlex` 3.0.0, `slickgrid` 5.20.0, `seti-icons`
0.0.4.

Two of those are worth stating rather than leaving as a blank row, because a reader will otherwise
assume they were missed:

- **`monaco-editor` 0.56.0 is the latest release.** P60 just migrated the entire app onto it; no bump
  exists to take. `NOTICES.md:110` names 0.56.0 and stays correct.
- **`vue` 3.5.42 is the latest release.** `docs/ARCHITECTURE.md:2260`'s note that *"a future Vue 3.6
  upgrade keeps VDOM mode"* is about a release that does not exist yet. Nothing to do, nothing to
  re-decide.

### 3.4 Hold — `typescript`, `@typescript/native-preview`, `@types/vscode` (§6.2, §6.3)

---

## 4. Runtimes

| Runtime | Pinned where | Current | Latest |
| --- | --- | --- | --- |
| Go | `go.mod` `go` directive | 1.27.0 | 1.27.1 (bump, §2.5) |
| Bun | **nowhere** — CI uses `bun-version: latest` | this container: 1.3.11 | 1.4.2 |
| Node | **nowhere** — no `engines`, no `.tool-versions` | this container: v22.22.2 | v26.8.2; newest LTS v24.21.0 |

**There is no Bun or Node version to bump, because neither is pinned.** Say this plainly rather than
inventing a pin: `bun-types` is the closest thing to a declared Bun floor (`docs/v1/plans/P35`'s own
note says so), and it moves as a routine dependency in §3.1. Node matters in exactly one place —
`docs/DEV_ENVIRONMENT.md`'s rule to run `tests/e2e-real/` through `node node_modules/.bin/playwright`
rather than `bunx`, because Bun's `testcontainers` integration hangs in this sandbox. That rule is
about *which runtime*, not which version.

**Do not add an `engines` field or a `.tool-versions` in this phase.** Introducing a floor that never
existed is new policy, not an upgrade — and a wrong floor breaks a contributor's clone for no gain.
If a floor is wanted, it is its own decision (OQ-3).

One honest mismatch to record, not fix: this container's Bun (1.3.11) is **older** than the pinned
`bun-types` (1.4.0, going to 1.4.2), so the types can describe APIs the local runtime lacks. CI, on
`bun-version: latest`, does not have this skew. Pre-existing, unrelated to P61, and a container fact —
if it is worth writing down it belongs in `docs/DEV_ENVIRONMENT.md`, not here.

---

## 5. Wails v3 — the one dependency that needed real work

SPEC singles this out: a pre-release the whole app builds on, with `internal/shell` named as the
usage site at risk.

### 5.1 Is there a stable v3?

**No.** `proxy.golang.org/github.com/wailsapp/wails/v3/@v/list` ends at `v3.0.0-beta.21`; `@latest`
answers `v3.0.0-beta.21` (tagged 2026-09-13), which is itself proof no `v3.0.0` release tag exists —
the proxy prefers a release over a pre-release and would have returned one. So the only question is
**beta.16 to beta.21**, five betas.

### 5.2 What `internal/shell` actually calls

Read `apps/kira-studio/internal/shell/*.go` (1 809 lines across 16 files) plus `main.go` — the only
other file importing Wails (`internal/adapters/adapter.go:7` and `internal/bridge/app.go:17` mention
the module path in a comment and a `debug.ReadBuildInfo` lookup, neither an import). Extracted every
`application.*` / `events.*` / `notifications.*` symbol referenced: just over 70 distinct
names, the load-bearing ones being `application.New`, `Options`, `WebviewWindowOptions`, `MacOptions`, `MacWindow`,
`MacWebviewPreferences`, `MacTitleBarHidden`, `AssetOptions`, `AssetFileServerFS`, `NewService`,
`InvokeAsync`, `StreamConn`, `Rect`/`WindowXY`, the eight `Permission*` values, the menu constructors
and eighteen `Role` constants, `CustomEvent`, `WindowEvent`, `ApplicationEvent`, `FatalError`, plus
`events.Common.Window{Closing,DidResize,DidMove,RuntimeReady}` and
`events.Mac.ApplicationShouldHandleReopen`, and the `notifications` service.

### 5.3 The diff, done properly

Both module versions were fetched into the Go module cache and compared:

1. **Exported declarations across `pkg/application`, `pkg/events`, `pkg/services/notifications`**:
   1 633 in beta.16, 1 668 in beta.21. **Zero removed.** All 35 additions are `Test*` functions and
   methods on unexported types (`cancellationTestCDP`, `webViewAssetRequest.Context`, …) — no new
   public API at all.
2. **Full signatures** of every type and function named in §5.2, extracted from both versions and
   diffed: **identical**.
3. **Struct fields** of `Options`, `WebviewWindowOptions`, `MacOptions`, `MacWindow`, `AssetOptions`,
   `MacWebviewPreferences`: **identical**.
4. **`pkg/events` and `pkg/services/notifications` have no changed file at all** between the two.
5. Only 23 non-test files differ under `pkg/`, nearly all Windows- or private-macOS-API-specific
   (`request_cancellation_windows.go`, `popupmenu_windows.go`, `mac_private_api_darwin.*`,
   `webview_window_darwin.*`, `transport_http.go`, `pkg/w32`, `pkg/updater`).

**Verdict: bump to `v3.0.0-beta.21`.** The API this app uses is byte-stable across the five betas; the
"breaking API change" SPEC's row flagged as the risk is, checked, not there. Staying on beta.16 would
mean holding five betas of Windows request-cancellation and macOS webview fixes for no reason anyone
can state.

Two behavioural changes to verify rather than assume, both real and both cheap to check:

- **`application.go`: signal-handler setup moved out of `New()` into `Run()`**, after the startup
  callback. This app has genuine quit/close ordering logic (`internal/shell/quit.go`,
  `closeflush.go`, and `quit_test.go`'s 260 lines), so exercise a real quit and a real window close,
  not just a boot.
- **`webview_window_options.go`: several macOS options are now documented as no-ops without
  `-tags private_mac_apis`** (`OpenInspectorOnStartup`, `MacBackdrop` transparency, Liquid Glass
  `GroupID`/`GroupSpacing`). Grepped the whole repo: **this app sets none of them**, so the caveat
  does not touch it. Recorded so a later reader does not re-derive it.

### 5.4 What moves in lockstep with it

- **`@wailsio/runtime` 3.0.0-beta.16 to 3.0.0-beta.21.** Not optional and not independent: the npm
  package is published straight out of the module
  (`internal/runtime/desktop/@wailsio/runtime/package.json` carries the matching version string). The
  two versions' runtime sources were diffed: **only `package.json` and `package-lock.json` differ —
  every `.js` file is identical.** So this is a version-string-only change with no behavioural risk,
  which is a useful thing to know before touching `bridge/port.ts`'s transport or the
  `mockRuntime.ts`/`mockStream.ts` fakes built against it. Do not touch those fakes.
- **The `wails3` CLI**, reinstalled automatically: `scripts/setup.sh` reads
  `scripts/lib.sh:pinned_wails_version()` (a `grep` of `go.mod`) and reinstalls when it changed. So
  editing `go.mod` is the whole trigger; never `go install …@latest`, which `lib.sh`'s own comment
  records as having skewed the generator against the runtime once already.
- **`apps/kira-studio/frontend/bindings/**` (48 generated `.ts` files)** — regenerate with
  `wails3 task common:generate:bindings`, never a hand-typed flag list, per `docs/DEV_ENVIRONMENT.md`.
  The **only** generator change between the two betas is in `internal/generator/render/create.go`,
  and it is confined to **generic** named class types. This repo's bound services declare no generic
  methods, so the expected regenerated diff is **empty**. Treat a non-empty diff as a finding worth
  reading line by line, not as noise to commit.
  - `-names` remains load-bearing for the same reason `docs/DEV_ENVIRONMENT.md` spells out at length:
    without it every call site emits `$Call.ByID(<n>)` and `tests/ui/support/mockRuntime.ts`'s
    `CHANNEL_TO_FQN` map — keyed on the `ByName` FQN string — silently breaks every `tests/ui/` spec
    at the first bound call of boot. The task supplies it; a hand-run command may not.
- **`docs/ARCHITECTURE.md:26`** contains the literal `v3.0.0-beta.16` (§7.1).

---

## 6. Deliberate pins found, each investigated

Searched `go.mod` (no `replace`, `exclude`, `retract` or `toolchain` directives at all), every
`package.json`, `docs/DEV_ENVIRONMENT.md`, `docs/ARCHITECTURE.md`, `scripts/`, `biome.json` and the
Vite config. Three real pins, plus the Wails pin already resolved in §5.

### 6.1 FlatBuffers 25.9.23 — **pin holds, reason restated**

Not one pin but a **coupled trio**, and the coupling is enforced in code:

| Artifact | Where | Version |
| --- | --- | --- |
| `flatc` compiler | `scripts/generate-wire.sh:18` `FLATC_VERSION=25.9.23`, downloaded into `.tools/`, SHA-256 checked, and its `--version` output asserted equal at `:92-96` | 25.9.23 |
| Go runtime | `go.mod` `github.com/google/flatbuffers` | v25.9.23+incompatible |
| TS runtime | root `package.json`, `packages/shared`, `packages/git-ipc` | 25.9.23 |

`generate-wire.sh:3-5` states the reason in its own header: *"an unpinned compiler is exactly how
generated code drifts from what's committed"*. Its `:101-103` comment goes further, recording that
`--gen-onefile` is a presence-only boolean **in this exact version** and another flag does not exist
in 25.9.23 at all — the CLI surface is version-specific, so the generator pin is doing real work.

**Is the reason still valid? Yes, and the bump is not even available.** The Go module has
v25.12.19+incompatible, but **npm `flatbuffers` has no release newer than 25.9.23** (registry versions
end at 25.9.23; nothing in the 25.10-25.12 range exists). Bumping the Go runtime alone would put the
Go side ahead of both the generator that emitted
`apps/kira-studio/internal/page`/`packages/shared/protocol`/`packages/git-ipc/src/generated` and the
TS runtime that decodes the same buffers — a wire-format skew across the data plane, which is the
single worst thing to get wrong in this app.

**Hold all three at 25.9.23.** Revisit when npm publishes a matching release: then bump `FLATC_VERSION`,
the Go module and all three npm entries in **one** commit, re-run `bun run generate:wire`, and
review the regenerated diff.

### 6.2 `typescript` 6.0.3 + `@typescript/native-preview` — **both already at their newest usable release; no TypeScript change in P61**

This is the largest apparent gap in the whole inventory and the one most likely to be mis-bumped, so
it is settled here with evidence rather than left to the implementer.

Current arrangement: four typecheck projects run `tsgo` from `@typescript/native-preview`
(7.0.0-dev.20260707.2); three run `vue-tsc` 3.3.11, which needs a real `typescript`, pinned 6.0.3 in
the root plus `packages/git-ui` and `packages/kira-ui`.

What changed upstream: **`typescript` 7.0.2 is now the `latest` dist-tag** (7.0.1-rc preceded it), and
`@typescript/native-preview` has published nothing since 2026-07-07, its README now saying it *"will
eventually be replaced by the official TypeScript package"* and *"For TypeScript 7.0 RC and later, use
`tsc`"*. So `tsgo` is superseded in principle.

**Why `typescript` still cannot go to 7.0.2 here.** TypeScript 7 is the native port, and its package
**no longer ships the classic JS compiler API**. Verified from the published tarball, not from memory:
7.0.2 has no `main`, and its `exports` map is `"."` to `./lib/version.cjs` plus `./unstable/*`
JSON-RPC entry points; the tarball's only `lib/` files are `version.cjs`, `getExePath.js` and
`tsc.js`, with the compiler itself in twenty platform `optionalDependencies`. Probed it directly:

```
require.resolve('typescript/lib/tsc')  ->  ERR_PACKAGE_PATH_NOT_EXPORTED
require('typescript')                  ->  { version, versionMajorMinor };  createProgram undefined
```

`vue-tsc` 3.3.11 resolves its compiler as exactly `require.resolve('typescript/lib/tsc')`
(`node_modules/vue-tsc/index.js`, `resolveTscPath`) and drives it through `@volar/typescript`'s
classic-API `runTsc`. Under `typescript@7.0.2` it cannot start. `vue-tsc`'s peer range
(`typescript: ">=5.0.0"`) does not save it — the range permits an install that then fails at runtime.
There is no newer `vue-tsc`: 3.3.11 **is** `latest`, as is `@vue/language-core` 3.3.11.

**And `typescript` 6.0.3 is the newest classic release** (the 6.x line ends there), so the repo is
already at the top of the only line `vue-tsc` can consume. Likewise `@typescript/native-preview`
7.0.0-dev.20260707.2 **is** its `latest` tag. Both entries are current. **No TypeScript edit in P61.**

The migration that does exist, recorded so the next person does not rediscover it: `vue-tsc`'s own
`resolveTscPath` has a branch for `typescript` being aliased to **`@typescript/typescript6`** (a real
published package, 6.0.2, whose `main` is `./lib/typescript.js` and whose dependency is
`"@typescript/old": "npm:typescript@^6"`). So a TS-7 toolchain is reachable by aliasing `typescript`
to `@typescript/typescript6` and installing `typescript@7` under a second alias for the four native
checks. That is two aliased TypeScript installs and a specifier that no longer means what it says, to
replace a frozen-but-working preview with a supported release — a real refactor with a real payoff and
real cost. **Out of scope for a version-bump phase** (§12), and flagged as OQ-1 for a human.

### 6.3 `@types/vscode` 1.134.0 — **pin holds, and it is not really a dependency pin**

Latest is 1.137.0. But `apps/kira-studio-vscode/package.json` declares `engines.vscode: "^1.134.0"`,
and the types version is conventionally that floor's twin: raising the types lets the extension
compile against APIs a 1.134 host does not have, and raising `engines.vscode` to match **raises the
minimum VS Code version for every user**. That is a product decision about supported hosts, not a
dependency refresh.

**Hold both at 1.134.0.** Nothing in this chapter needs a 1.135+ API. Raising the floor is its own,
deliberate change whenever a real need appears.

### 6.4 What was checked and is *not* a pin

- **No `go.mod` `replace`, `exclude` or `retract` directive exists.** Nothing is held back there.
- **`confluentinc/cp-kafka:8.0.7` and the other container image tags** (`docs/DEV_ENVIRONMENT.md`,
  `packages/db-fixtures/support/*.ts`, `scripts/db-compat.sh`'s min/max matrix) are **test-fixture
  pins, not dependency pins** — they fix *which database versions this app is tested against*, which
  is the subject of `scripts/db-compat.sh` and P16's own version table, not of P61. Leave every one
  alone; moving them silently changes what compatibility means. Explicitly out of scope (§12).
- **`monaco-editor` 0.56.0** reads like a pin (`docs/ARCHITECTURE.md:51` and `NOTICES.md:110` both say
  "pinned 0.56.0") but it is simply the current release. No hold to re-affirm.

---

## 7. Lockstep couplings

### 7.1 A version literal that lives in more than one file

`bunfig.toml`'s `install.exact = true` means every npm version is a literal. Enumerated across all
nine manifests; these are the ones with a duplicate, so a bump that edits only the root leaves a
second copy installed:

| Package | Manifests naming it | Moves in P61? |
| --- | --- | --- |
| `bun-types` | root + `api-core`, `git-ipc`, `git-core`, `kira-ui` (5) | yes, 1.4.2 |
| `@vitejs/plugin-vue` | root + `git-ui`, `kira-ui` (3) | yes, 6.0.9 |
| `zod` | root + `shared` (2) | yes, 4.6.5 |
| `vite` | root + `git-ui` (2) | yes, 8.3.0 |
| `flatbuffers` | root + `shared`, `git-ipc` (3) | no — §6.1 |
| `typescript`, `vue-tsc` | root + `git-ui`, `kira-ui` (3 each) | no — §6.2, already current |
| `vue` | root + `git-ui`, `kira-ui` (3) | no — current |
| `@types/vscode` | root + `kira-studio-vscode` (2) | no — §6.3 |
| `@floating-ui/dom`, `shlex`, `slickgrid`, `@vscode/codicons`, `@faker-js/faker` | root + one package each | no — current |

Non-manifest literals that must move with their package:

- **`biome.json:2`** `"$schema": "https://biomejs.dev/schemas/2.5.11/schema.json"` — bump to 2.5.13
  with `@biomejs/biome`.
- **`docs/ARCHITECTURE.md:26`** — the Stack table's `Wails v3 (v3.0.0-beta.16)`.
- **`scripts/generate-wire.sh:18`** — `FLATC_VERSION`, which stays (§6.1) but is where it lives.

Derived automatically, so **not** to be hand-edited: `go.mod`'s Wails version is read by
`scripts/lib.sh:pinned_wails_version()`, the `go` directive by `go_directive()`, and the running
Wails version is read from build info by `internal/bridge/app.go:wailsVersion()` — whose comment
records that a hand-copied `"v3.0.0-beta.15"` literal had drifted once, which is exactly why it reads
build info now. Do not reintroduce a literal anywhere.

---

## 8. Sequencing

Six groups, each landing as its own commit(s), ordered cheapest-and-safest first so a later failure
has a small, obvious blast radius. **Run the fast checks after every group**; the expensive suites run
once, in G6, per `CLAUDE.md`'s implement-then-test rule.

| # | Group | Contents | Verification for this group |
| --- | --- | --- | --- |
| **G1** | npm routine | `zod`, `@types/node`, `@vitejs/plugin-vue`, `bun-types`, `simple-icons` — **every manifest** per §7.1. `bun install` | `bun run typecheck && bun run lint && bun run build` |
| **G2** | Biome | `@biomejs/biome` 2.5.13 **and** `biome.json`'s `$schema`. Run `bun run format` and commit any reformatting **separately** from the version bump | `bun run lint`. A formatting-only diff is expected and fine; a *rule* change that edits real code is a finding to read, not to accept blindly |
| **G3** | Go routine | §2.1's nine direct modules and their indirect fallout. `go mod tidy` | `go build ./apps/kira-studio/internal/... && go vet ./... && bun run test:go` |
| **G4** | Go, attention-needed | §2.2 minus Wails: `modernc.org/sqlite`, `mongo-driver/v2`, `pgx/v5`, `go-sdk`. **One commit each**, so a bisect lands on the right one | `bun run test:go`, plus the matching adapter conformance suite against a real container, plus a live `curl` call to the repo-map server for the MCP SDK |
| **G5** | Wails + Go toolchain | `go.mod`: `go 1.27.1` and `wails/v3` v3.0.0-beta.21; `@wailsio/runtime` 3.0.0-beta.21; `bun run setup` (reinstalls the CLI at the new pin and the new toolchain); `wails3 task common:generate:bindings`; `docs/ARCHITECTURE.md:26` | `go build`, `bun run typecheck`, `bun run build`, and the **bindings diff must be empty** (§5.4). Then a real quit/close check (§5.3) |
| **G6** | Vite + Playwright | `vite` 8.3.0 (root + `git-ui`); `@playwright/test` 1.63.0 + `bunx playwright install webkit`. **The full suite runs here** | Everything in §10, including the visual baselines and the re-measured bundle |

G6 is last on purpose: it is the only group that can move a rendered pixel or a bundle byte, so every
other change is already proven green underneath it when its diffs appear.

---

## 9. Implementation steps

1. **Re-run both `@latest` sweeps** (§1) and note any row that moved past this plan's numbers. Same
   class of change, no re-plan.
2. **G1** — npm routine bumps across every manifest; `bun install`; fast checks.
3. **G2** — Biome + `$schema`; then a separate `bun run format` commit if it reformats anything.
4. **G3** — `go get` the nine §2.1 modules; `go mod tidy`; `go build`/`go vet`/`test:go`.
5. **G4** — four commits, one per §2.2 module (minus Wails), each with its own targeted test run.
6. **G5** — `go.mod` toolchain + Wails; `@wailsio/runtime`; `bun run setup`; regenerate bindings;
   confirm the bindings diff is empty; update `docs/ARCHITECTURE.md:26`.
7. **G6** — Vite, then Playwright (separate commits — they fail differently); reinstall WebKit.
8. **Full suite** (§10), then fix-up commits for whatever it finds.
9. **Docs** (§11), including re-measured bundle figures if G6 moved them.

Commits: `chore(deps):` for a plain version bump, `build:` for a toolchain/config change,
`docs:` for §11, `fix:`/`test:` for anything a bump breaks and this phase repairs.

---

## 10. Testing — the acceptance bar

### 10.1 Mechanical, reachable from this environment

```
bun run typecheck       # all five projects
bun run lint            # biome + scripts/check-tokens.sh
bun run build           # record index-*.js raw + gzip
bun run test:unit
bun run test:go
bun run test:ui         # ui + ui-timing, WebKit
bun run test:visual     # 5 committed baselines
bun run test:webview    # the VS Code extension's own webview suites
go vet ./...
```

Plus, because G5 touches generated output and G4 touches the MCP server:

- `git status apps/kira-studio/frontend/bindings/` clean after regeneration (§5.4).
- `bun run mcp:repo-map` in the background, then a real `tools/call` over the `curl` recipe in
  `CLAUDE.md` — the MCP SDK bump's failure mode is a wrong answer, not a build error.

### 10.2 Containers

`bun run test:go`'s adapter conformance suites and `tests/e2e-real/` need real containers. Reachable
here **only** through `mirror.gcr.io` with a local re-tag (Docker Hub blobs 403 through the proxy) and
with `dockerd` started by hand — both recipes are in `docs/DEV_ENVIRONMENT.md` and neither is
optional for G4's sqlite/mongo/pgx/driver bumps. The sqlite adapter and the app's own storage need no
container at all (`modernc.org/sqlite` is pure Go against a `t.TempDir()` file), so §2.2's highest-risk
bump is also its cheapest to check.

### 10.3 Needs real hardware or a GUI — out of reach for a non-interactive implementer

Stated explicitly, not skipped silently — same category P60a §12.3 and P60b §12.3 already flagged:

- **A real macOS launch of the Wails shell.** `internal/shell`'s darwin paths, the hidden-inset title
  bar, the menu bar and its eighteen roles, the notifications service, and §5.3's moved signal-handler
  ordering are only genuinely exercised by a human running the packaged app on macOS. This container
  cannot even compile the `darwin && cgo` files (`docs/DEV_ENVIRONMENT.md`: `CGO_ENABLED=1
  GOOS=darwin` fails inside `runtime/cgo` here).
- **Quit and window-close behaviour under beta.21** — `quit_test.go` covers the logic, but the
  Wails-side ordering change is a runtime property of a real app loop.
- **`bun run package` / `verify:packaging`** — macOS-only.
- **Any visual baseline the WebKit bump moves.** The five `.png` diffs must be *reviewed by a human*,
  never blind-updated with `test:visual:update`. If they move, say so in the commit message with what
  changed and why the new rendering is correct.

### 10.4 What must not regress

- Bundle: `index-*.js` against the current 1 307.65 kB raw / 384.15 kB gzip baseline
  (`docs/ARCHITECTURE.md:29`, recorded at P60b), and exactly one `editor.worker-*.js` in
  `dist/assets/` with no language-service worker — P60a/P60b's one-worker invariant.
- `docs/PERF.md` §2.1's interaction budgets. Re-run rather than re-derive; a Vite or WebKit bump is
  exactly the kind of change that moves them.

---

## 11. Documentation to update

- **`docs/ARCHITECTURE.md:26`** — the Wails version literal, to `v3.0.0-beta.21`.
- **`docs/ARCHITECTURE.md:29`** — the chunk inventory, only if G6's build actually moved it.
- **`docs/PERF.md`** — a new sub-section only if a budget moved; a re-measurement that confirms the
  existing numbers needs no new prose.
- **`docs/DEV_ENVIRONMENT.md`** — only if a toolchain step genuinely changed (e.g. the WebKit
  reinstall needing a different system-library list under Playwright 1.63). Not a changelog.
- **`docs/v1.6/mcp-repo-map-issues.md`** — whatever dogfooding the repo-map server turns up, per
  `CLAUDE.md`. The `go-sdk` v1.8.0 bump makes this phase a genuinely useful test of that server.
- **`docs/ARCHITECTURE.md` "Known open items"** — add the FlatBuffers hold (§6.1) *only if* it is
  judged a real current limitation rather than a routine "upstream has not released yet". It reads to
  this plan like the latter; prefer leaving the section alone.
- **`docs/v1.6/SPEC.md`** — a "Deliverable" paragraph on the P61 row only if what shipped diverges
  from the row, per this chapter's own convention. Never retro-edit the row itself.

**Not updated:** `NOTICES.md`. It names `monaco-editor` 0.56.0 and `fuzzysort` 4.0.2, both unchanged,
and pins no version for `simple-icons` or `seti-icons`.

---

## 12. Explicitly out of scope

- **Adopting any API a new version unlocks.** Nothing in `zod` 4.6, Vite 8.3, Playwright 1.63 or
  Wails beta.21 gets used because it is now available. A dependency upgrade ships the same behaviour
  on newer code — the same rule P60a §11 applied to the Monaco migration.
- **The TypeScript 7 toolchain migration** (§6.2). Real, understood, costed, and not a version bump.
- **Raising `engines.vscode`** (§6.3).
- **Introducing a Bun or Node version floor** (§4). There is none today; adding one is policy.
- **Container image tags and `scripts/db-compat.sh`'s min/max matrix** (§6.4) — that table defines
  tested DB compatibility, and moving it is P16's subject, not P61's.
- **`bun.lock` transitive churn beyond what a direct bump drags in.** No `bun update` sweep, no
  `overrides` block, no dedupe pass. Each entry in §3 moves because it was checked.
- **Removing a dependency that looks unused.** Checked `pg`, `mariadb`, `testcontainers`,
  `simple-icons`, `fuzzysort`, `shlex`, `seti-icons`, `@faker-js/faker` — every one has live callers.
  Nothing to prune, and pruning is not this phase's job anyway.
- **Anything P62-P65 touch.** `pkg/updater/helper.go` changed between the two betas and P64 is the
  update-banner phase; P61 does not read it, use it, or plan for it.

---

## 13. Verification checklist

**Inventory**
- [ ] Both `@latest` sweeps re-run; any drift from §2/§3 noted in the commit message.

**Versions landed**
- [ ] Every §3.1 package bumped in **every** manifest naming it (§7.1) — `bun.lock` shows one resolved
      version per package, not two.
- [ ] `biome.json`'s `$schema` matches the installed Biome.
- [ ] `go.mod`: `go 1.27.1`, `wails/v3 v3.0.0-beta.21`, §2.1 and §2.2 at their new versions,
      `google/flatbuffers` **still** v25.9.23+incompatible.
- [ ] `@wailsio/runtime` equals `go.mod`'s Wails version exactly.
- [ ] `scripts/generate-wire.sh`'s `FLATC_VERSION` unchanged; `typescript`, `@typescript/native-preview`
      and `@types/vscode` unchanged.

**Wails**
- [ ] `bun run setup` reinstalled `wails3` at beta.21, built with the 1.27.1 toolchain
      (`go version -m $(command -v wails3)`).
- [ ] Bindings regenerated via the task; `git status` on `frontend/bindings/` is clean.
- [ ] `tests/ui/` boots (a `-names`-less regeneration would fail at `layoutGetAll`, per
      `docs/DEV_ENVIRONMENT.md`).
- [ ] A real quit and a real window close behave as before (§5.3's moved signal handler).

**Suites**
- [ ] `typecheck`, `lint`, `build`, `test:unit`, `test:go`, `test:ui`, `test:visual`, `test:webview`,
      `go vet ./...` all green.
- [ ] Adapter conformance suites green for sqlite, mongo and postgres against real containers.
- [ ] One `tools/call` against a running `bun run mcp:repo-map` returns a correct answer.
- [ ] Visual diffs reviewed individually; none blind-updated.

**Budgets**
- [ ] `index-*.js` raw + gzip recorded against 1 307.65 kB / 384.15 kB.
- [ ] Exactly one `editor.worker-*.js`, no language-service worker.
- [ ] `docs/PERF.md` §2.1 budgets re-run.

**Left undone, on purpose**
- [ ] §10.3's macOS-only checks named in the phase's closing report as not run here, not quietly
      omitted.

---

## 14. Open questions for a human

**OQ-1 — the TypeScript 7 toolchain.** §6.2 holds `typescript` at 6.0.3 and
`@typescript/native-preview` at its final published build, because `vue-tsc` 3.3.11 cannot start
against `typescript@7.0.2` (proved by direct probe, not inference) and both entries are already the
newest release of the only line each can use. The migration exists — alias `typescript` to
`@typescript/typescript6` and add `typescript@7` under a second alias — but costs two aliased
TypeScript installs and a specifier that no longer means what it says, to replace a working frozen
preview. *Recommendation: hold in P61; revisit when `vue-tsc`/Volar ship a release that consumes
TypeScript 7's own API, at which point one `typescript@7` serves all five typecheck projects and the
preview package is deleted outright.*

**OQ-2 — Wails on a beta, indefinitely.** §5 bumps beta.16 to beta.21 and finds no API break, but
there is still no `v3.0.0`. This app ships on a pre-release and will keep doing so for the
foreseeable future. Is tracking the newest beta each chapter the right standing policy, or should the
app pin one beta and move only for a named fix? *Recommendation: track the newest beta while the
diff stays this small and this checkable. The check in §5.3 took one source diff and found zero
removed API; that is a cheap price for five betas of fixes, and drifting far behind a moving
pre-release is the more expensive failure.*

**OQ-3 — no declared Bun or Node floor.** §4 found neither pinned anywhere, and this container's Bun
(1.3.11) is already older than the pinned `bun-types` (1.4.x). P61 deliberately does not invent a
floor. Should one be declared (`engines`, or a `.tool-versions` CI and contributors both read)?
*Recommendation: yes, but as its own small change with a deliberately-chosen floor — not smuggled
into a version-bump phase where a wrong number breaks clones for no gain.*

**OQ-4 — FlatBuffers, when npm catches up.** §6.1 holds the trio at 25.9.23 because npm has no newer
release, while the Go module has moved to 25.12.19. Should a later phase own the coupled bump plus
regeneration, or should it wait until a real need appears? *Recommendation: wait. The trio is
internally consistent today, the wire format is the worst thing in this app to desync, and "the Go
module has a newer tag" is not a requirement.*
