# P12 — Hardening: §2 budgets, cache tuning, cold start, unsigned packaging

> Plan for SPEC.md §10 phase **P12**. Deliverable: *Memory/perf pass against §2 budgets, cache
> tuning, cold-start time, unsigned packaging.* "Measure once the surface is complete — nothing
> should still be changing under it" — read as the binding scope signal: this phase adds
> measurement, tuning of existing constants, and packaging config. It does not add product
> surface, and every code change it makes must be traceable to a number it measured first.

## 0. Ground rules for this phase

- **Measure, then tune — never the reverse.** §3 below defines what is measured and where the
  assertion lives; §4 defines the pre-approved tuning levers and the exact trigger that unlocks
  each one. A lever whose trigger did not fire is not pulled. If nothing triggers, the phase's
  deliverable is the recorded numbers plus the two new docs, and that is a complete phase — not a
  reason to invent tuning busywork.
- **No new feature surface, with exactly one exception:** §8.2's **Advanced** settings section
  (engine memory cap, op-log retention) becomes real. It is today two disabled inputs and the
  stale note "Available once data views land." Both knobs are precisely the §2.2/storage bounds
  this phase is about, and no later phase owns §8.2 — so it lands here or never. Everything else
  in §8 is left alone.
- **No new IPC, protocol, or debug channel for measurement.** Every number in §3 is obtainable
  from `electronApp.evaluate()` (main-process context) or from the page's own DOM APIs. The one
  production-code addition for measurement is a single `electron-log` line at window
  `did-finish-load` (D9) — logging is §3's existing observability mechanism, not new protocol.
- **Scope boundary with the two phases that follow this one** (both added after the original v1
  plan; a P13/P15 planner reading this doc should treat everything below as already existing):
  - **P13 (nonfunctional correctness sweep — memory leaks, storage leaks, redundant DB
    interaction, caching gaps)** is out of scope here. P12 establishes the *tuned baseline* and
    the measurement harness P13 starts from; it does not hunt leaks. Three known items are handed
    to P13 explicitly and must not be "fixed" here: `engine/cache/counts.ts`'s unbounded `Map`,
    renderer page retention across many long-lived tabs (§4 lever L-B), and lifetime-cumulative
    L2 `hits`/`misses` counters that `clearCaches()` does not reset.
  - **P15 (GitHub tooling — pre-commit hook, macOS-only Actions CI, tag-triggered unsigned build,
    auto-update verification)** is out of scope here. P12 delivers only the **local, manual**
    packaging pipeline: an `electron-builder` devDependency, `electron-builder.yml`, two
    `package.json` scripts, and a human-run verification checklist in `docs/PACKAGING.md`. No
    workflow file, no tag trigger, no CI config, no release publishing. P15 layers onto exactly
    that config; `--publish never` is on both scripts so nothing this phase adds can publish.
  - **Auto-update is not touched.** SPEC.md §1 lists it under "Explicitly deferred" and §3 says
    "No auto-update." That deferral is lifted by P15, not by P12. `dmg.writeUpdateInfo: false` is
    set so the local build does not emit half of an update channel nobody wired up.
- **No code signing or notarization** (§1, §3: "unsigned local builds; signing/notarization after
  v1"). Ad-hoc signing (D12) is not code signing in that sense — it carries no identity and
  satisfies no Gatekeeper check; it exists solely because Apple Silicon's kernel refuses to
  execute a bundle with no signature at all.
- **No Windows/Linux targets** (§1). `arm64` only, macOS 13+ only (§3).
- **P11 (pre-connect scripts) lands immediately before this phase.** Nothing here may assume
  anything about P11's internals. One consequence is decided up front (D23): a pre-connect
  script's child process is not an Electron process, does not appear in `app.getAppMetrics()`,
  and is outside §2.2's budget — it runs a user-supplied command whose memory the app does not
  control. The §3 scenarios use connections with no pre-connect script.
- **The implementing session cannot build a macOS artifact.** This repo's dev environment is
  Linux; `electron-builder --mac` on Linux fails before producing artifacts. The session must not
  report a green packaging run it did not perform. Its only off-macOS verification is that the
  CLI resolves and parses `electron-builder.yml` before failing with the platform error (§5).
  Everything else in §5 is a checklist for a human on macOS.
- No unit tests beyond the two existing suites. New UI specs mirror the existing per-spec
  conventions (local helpers, `isDockerAvailable()` skip guard, per-spec timeout override). Run
  `bun run lint`, `bun run typecheck` (all three splits), `bunx electron-vite build`,
  `bun run test:db`, and `xvfb-run -a bun run test:ui` before committing.

### Realities this phase works with (verified against the tree)

1. **`tests/ui/perf.spec.ts` already exists and already defers to this phase** — its header
   comment says "§2.1's real measurement is P12's job — this only catches [regressions] in an
   instrumented, unoptimised Playwright build." It measures rAF deltas (`p95 < 24`), a DOM cell
   bound (`< 1500`), `window.__kiraGridRetainedBytes()` open/close symmetry across 10 tabs, and
   reads L2 usage-vs-budget out of the Settings → Cache pane. All four remain valid and none
   duplicates what §3 adds.
2. **`window.__kiraGridRetainedBytes` is installed unconditionally** in `src/renderer/main.ts:22`
   (not gated on `NODE_ENV`) and typed in `tests/ui/global.d.ts`. Precedent that a test hook may
   live in production code — P12 needs no further hook of this kind.
3. **`src/main/engine-host.ts:41` sets `execArgv: ['--max-old-space-size=512']`** on the engine
   `utilityProcess`. This *is* §2.2's "bounded old-space": Electron's `ForkOptions.execArgv`
   (electron.d.ts:21770) passes V8/Node flags to the utility process. The value is hardcoded;
   Settings → Advanced shows a *disabled* input reading "512 MB" that is wired to nothing.
4. **`app.getAppMetrics()` returns everything §2.2 needs.** `ProcessMetric` (electron.d.ts:11320)
   carries `type` (`Browser`/`Tab`/`Utility`/`GPU`/…), `serviceName`, `pid` and `memory`;
   `MemoryInfo.workingSetSize` (electron.d.ts:9463) is "the amount of memory currently pinned to
   actual physical RAM", in KB — the RSS figure Activity Monitor shows. The engine appears as
   `type: 'Utility'`, `serviceName: 'kira-engine'` (set at `engine-host.ts:39`).
5. **`src/engine/cache/lru.ts`** is a touch-on-`get` `Map` byte-LRU; `setBudget()` evicts down to
   the new budget; `set()` **refuses** any entry larger than `budget / 2` with a `console.warn`
   ("one 40 MB page must not evict every other page in a 64 MB budget").
6. **L2 wiring is complete and already user-facing.** `pages.ts`'s `DEFAULT_BUDGET_BYTES` is
   64 MB matching `defaultSettings.cache.l2BudgetMb`; the Settings → Cache budget input flows
   `ipc/settings.ts` → `pushEngineConfig()` → `ENGINE_OP.configureCache` → `cache.configure()`.
   `hits`/`misses` are lifetime counters that `clearPages()` does not reset (P13's).
7. **L3 (`engine/cache/counts.ts`)** is a plain `Map` with `TTL_MS = 5 min` (matching §7) and a
   hard drop at 30 min; entries are three scalars. It has no byte budget and no size cap.
8. **L1 is not in `engine/cache/`** — `engine/cache/index.ts`'s header records that L1 lives in
   main's SQLite `metadata_cache` (P1 D10) so the tree renders while disconnected. And
   `renderer/project/state/tree.ts:103-106` records that *every* expand round-trips
   `kira:tree:children` on purpose. So §2.1's "tree node expand (cached)" budget covers IPC +
   SQLite read + Zod parse + render, not a renderer-local lookup.
9. **Settings → Advanced is the one §8.2 section never implemented** —
   `SettingsDialog.vue:251-261` is a `v-else` with two `disabled` inputs and
   "Available once data views land."
10. **Adding a settings section touches exactly three places** besides the dialog:
    `src/shared/settings.ts` (schema + `defaultSettings`), `storage/repos/settings.ts` (two
    explicit per-section literals in `getAllSettings` and `setSettings`), and
    `renderer/state/settings.ts`'s `applySettings`. Per-leaf `${section}.${key}` storage with a
    defaults fallback means an existing `kira.sqlite` keeps launching with no migration.
11. **`storage/repos/ops.ts` has `RETENTION_DAYS = 30` and `HARD_CAP_ROWS = 20_000`**, applied by
    `pruneOps(db)` which `wireOplog()` calls once at startup.
12. **`engine/adapters/registry.ts` statically imports all six adapters**, with a comment stating
    "a v1 with seven adapters is not big enough to justify lazy loading". That judgement predates
    any measurement; the engine-at-rest number from §3 is the evidence that confirms or overturns
    it (lever L-A). Every driver module (`@aws-sdk/client-sqs`, `kafkajs`, `mongodb`, `mariadb`,
    `pg`, `ioredis`) is therefore resident from engine boot regardless of which kinds are
    connected.
13. **There is no packaging config anywhere** — no `build` field in `package.json`, no
    `electron-builder.{yml,yaml,json,js}`, no `build/` resources dir; `"build"` is
    `electron-vite build`. `.gitignore` already ignores `out` (line 79) and `dist` (line 83), so
    `directories.output: dist` needs no gitignore change.
14. **`package.json` has no `description` and no `author`**, which electron-builder warns about
    and uses for bundle metadata. Its `dependencies` are exactly the runtime set main/engine
    `require` (`externalizeDepsPlugin` keeps them external); every `.node` binary under
    `node_modules` belongs to a **devDependency** (`@tailwindcss/oxide-*`, `@rollup/rollup-*`,
    `lightningcss-*`, `@napi-rs/lzma-*`, `@electron-internal/extract-zip`). SQLite is `node:sqlite`
    (`storage/db.ts`), built into Electron. There is no native production dependency to rebuild.
15. **The packaged code paths already exist.** `main/window.ts:39-42` falls back to
    `loadFile(join(__dirname, '../renderer/index.html'))` when `ELECTRON_RENDERER_URL` is unset;
    preload is `join(__dirname, '../preload/index.js')`; the engine is
    `utilityProcess.fork(join(__dirname, 'engine.js'))`. All three resolve inside `app.asar` under
    `out/`. `app.isPackaged` is used in exactly one place (`menu.ts:10`) to drop Reload/Toggle
    DevTools — so a packaged build legitimately has fewer View-menu items.
16. **Playwright harness**: `workers: 1`, 60 s default timeout raised per-spec (`perf.spec.ts`
    uses `test.describe.configure({ timeout: 180_000 })`); `fixtures.ts` provides `kiraHome` (a
    tmpdir, hard-guarded), `relaunch()` (closes and relaunches against the same `KIRA_HOME`),
    `kira`, and `consoleErrors`. Fourteen specs each define their own local `findRow`/`expandRow`
    helpers — duplication is the established convention, not an accident.
17. **`tests/ui/**` is typechecked by `tsconfig.node.json`** (`types: ["node", "electron"]`), so
    `app.getAppMetrics()` is fully typed inside `electronApp.evaluate()`.
18. **Fixtures are sufficient for a 5-connection/10-tab scenario without touching Kafka/SQS**:
    `app.big_rows` (1 M rows, narrow: `id int`, `hash text`), `app.wide_table`,
    `app.nulls_and_unicode`, mongo `widgets`, and the typed Redis keys, each with an existing
    `tests/ui/support/*.ts` container wrapper.
19. **electron-builder 26.15.3 is the current `latest`**, and its published `MacConfiguration`
    typings state verbatim: identity **not set** → search the keychain, *"there is no automatic
    ad-hoc fallback"*; **`null`** → *"skip signing entirely"*; **`"-"`** → *"opt in to ad-hoc
    signing explicitly"*, with the warning that ad-hoc plus `hardenedRuntime: true` (the default)
    *"requires the `com.apple.security.cs.disable-library-validation` entitlement to prevent app
    launch failures; otherwise set `hardenedRuntime: false`"*. Default mac targets are dmg + zip;
    `gatekeeperAssess` already defaults to `false`.

## 1. Shapes and configuration introduced in this plan

```ts
// tests/ui/support/measure.ts — the only non-re-export module in tests/ui/support/ (D24).
// All three new specs share it so their numbers are produced by identical instrumentation.
import type { ElectronApplication, Page } from '@playwright/test';

export interface ProcessSample {
  type: string;            // 'Browser' | 'Tab' | 'Utility' | 'GPU' | ...
  serviceName: string;     // 'kira-engine' for the engine; '' when Electron reports none
  pid: number;
  rssBytes: number;        // memory.workingSetSize * 1024
}
export interface RssSample {
  totalBytes: number;
  processes: ProcessSample[];
}

/** One `app.getAppMetrics()` reading, summed. No IPC, no production hook (D1). */
export function sampleRss(app: ElectronApplication): Promise<RssSample>;

/** Idle `settleMs`, then `samples` readings `intervalMs` apart (D3). */
export function sampleRssSeries(
  app: ElectronApplication,
  opts?: { settleMs?: number; samples?: number; intervalMs?: number },
): Promise<RssSample[]>;

/** Multi-line per-process min/max breakdown for console.log — printed always, not only on failure. */
export function formatRssSeries(series: RssSample[]): string;

export function percentile(values: number[], p: number): number;

/**
 * Clicks `click`, then resolves at the first MutationObserver callback under `observe` for which
 * `until` holds, returning ms since the synchronous click dispatch. MutationObserver callbacks are
 * microtasks, so resolution is sub-millisecond; a requestAnimationFrame poll would quantise every
 * result to a ~16.7 ms multiple and could never demonstrate a 50 ms budget, let alone 8 ms (D5).
 * Paint is deliberately outside the measurement (D5).
 */
export function measureClickToDom(
  page: Page,
  opts: {
    click: string;
    observe: string;
    until: { selector: string; text?: string; minCount?: number };
    timeoutMs?: number;
  },
): Promise<number>;

/**
 * Per scroll step: sets `scrollTop`, then returns (mutation-callback time − the scroll event's
 * own `timeStamp`) — i.e. the app's whole main-thread response to a scroll, dispatch included,
 * with the frame-boundary wait that inflates a naive measurement excluded (D6).
 */
export function measureScrollResponses(
  page: Page,
  gridSelector: string,
  steps: number,
): Promise<number[]>;

/** `process.uptime() * 1000` read in main — startup cost with Playwright's spawn overhead out (D8). */
export function uptimeMs(app: ElectronApplication): Promise<number>;
```

```ts
// src/shared/settings.ts — §8.2's Advanced section, the phase's one piece of feature-shaped work.
export const advancedSettingsSchema = z.object({
  engineMemoryCapMb: z.number().int().min(256).max(4096),
  opLogRetentionDays: z.number().int().min(1).max(365),
});
export type AdvancedSettings = z.infer<typeof advancedSettingsSchema>;

// `.default(...)` for the same reason data/cache carry one: a pre-P12 kira.sqlite has no
// `advanced.*` rows and must still parse on first launch.
export const settingsSchema = z.object({
  appearance: appearanceSettingsSchema,
  data: dataSettingsSchema.default({ /* unchanged */ }),
  cache: cacheSettingsSchema.default({ l2BudgetMb: 64 }),
  advanced: advancedSettingsSchema.default({ engineMemoryCapMb: 512, opLogRetentionDays: 30 }),
});
```

```ts
// src/main/engine-host.ts — the cap becomes a parameter; the default stays 512 (D18).
export function startEngine(opts: { maxOldSpaceMb: number }): EngineHost;
//   execArgv: [`--max-old-space-size=${opts.maxOldSpaceMb}`]

// src/main/storage/repos/ops.ts — retention becomes a parameter; HARD_CAP_ROWS stays hardcoded.
export function pruneOps(db: KiraDb, retentionDays: number): Promise<void>;

// src/main/oplog.ts
export function wireOplog(
  engineHost: EngineHost,
  db: KiraDb,
  broadcast: (record: OpRecord) => void,
  retentionDays: number,
): void;

// src/main/index.ts — settings are read once, before the engine is forked, and both values are
// passed down. A later patch of either takes effect at next launch (stated in the dialog).
```

```yaml
# electron-builder.yml — unsigned (ad-hoc) local macOS build, arm64 only.
appId: com.kirathecat.kira-studio          # §3 "bundle ID com.kirathecat.kira-studio"
productName: Kira Studio                    # matches app.setName() in src/main/index.ts
copyright: Copyright © 2026 kirathecat
directories:
  output: dist                              # already gitignored (line 83)
files:
  - out/**/*                                # electron-vite's build output; `main` points into it
  - package.json
  - '!**/*.map'
asar: true
npmRebuild: false                           # no native production dependency exists (D14)
electronLanguages:
  - en                                      # dark-mode-only, English-only v1; trims .lproj weight
mac:
  category: public.app-category.developer-tools
  identity: '-'                             # ad-hoc — NOT null (D12)
  hardenedRuntime: false                    # ad-hoc + hardened runtime ⇒ library-validation failure (D12)
  minimumSystemVersion: '13.0'              # §3 "macOS 13+"
  darkModeSupport: true                     # §1 "Dark mode only"
  target:
    - target: dmg
      arch: [arm64]
    - target: zip
      arch: [arm64]
dmg:
  writeUpdateInfo: false                    # no auto-update in v1 (§1/§3); P15's call, not P12's
artifactName: ${productName}-${version}-${arch}.${ext}
```

```jsonc
// package.json
"description": "A visual database and message-broker client for macOS.",
"author": "kirathecat",
"scripts": {
  "package:mac":     "electron-vite build && electron-builder --mac --arm64 --publish never",
  "package:mac:dir": "electron-vite build && electron-builder --mac --arm64 --dir --publish never"
},
"devDependencies": { "electron-builder": "26.15.3" }   // exact pin, like every other devDependency
```

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | Total RSS is measured with `electronApp.evaluate(({ app }) => app.getAppMetrics())`, summing `memory.workingSetSize * 1024` across every returned process. No new IPC channel, no per-process `process.memoryUsage()` plumbing, no production hook. | Reality #4: `getAppMetrics()` already reports every Electron process the app owns — Browser, GPU, the Network/Storage utilities Chromium spawns, the renderer, and our engine (`type: 'Utility'`, `serviceName: 'kira-engine'`) — and `workingSetSize` is the RSS figure §2.2's "total RSS across all processes" names. A debug IPC channel would add protocol surface to the one phase whose premise is that nothing underneath it changes. |
| D2 | The `< 350 MB` budget is **fully automated** in `tests/ui/memory.spec.ts`, not a manual procedure. `docs/PERF.md` additionally documents a macOS *packaged* cross-check as a manual step. | The whole scenario (5 connections, 10 tabs) is scriptable against the existing Testcontainers fixtures and the existing `window.kira` surface; a manual-only budget is a budget nobody re-checks after the phase that wrote it. The manual cross-check exists because the enforced number comes from an unpacked, Playwright-instrumented build, and the packaged number is the one a user experiences. |
| D3 | Sampling protocol: load the scenario, idle 5 s, then take 10 readings 1 s apart; **assert on the minimum total**; log the full per-process min/max breakdown unconditionally. No forced GC. | Forcing GC in three processes would require flags (`--expose-gc`, a CDP `HeapProfiler.collectGarbage` per renderer) that change the thing being measured, and the engine utility process cannot be reached that way at all. The minimum over an idle window is the closest available approximation of the settled floor; everything above it is genuine committed memory, so it is logged rather than discarded. |
| D4 | Scenario: 4 containers (Postgres, MariaDB, MongoDB, Redis); **5 connections** = 2 × Postgres (two distinct connection rows against one container) + MariaDB + MongoDB + Redis; **10 tabs** = 4 Postgres data tabs on `app.big_rows` @ page size 1000, 2 MariaDB data tabs @ 1000, 2 MongoDB document tabs, 2 Redis key/value tabs. Kafka and SQS are excluded. | §2.2 says "5 live connections", not "5 engines". Kafka + LocalStack alongside four other containers is a host-resource problem, not an app one, and it would make the spec the slowest in the suite. Their exclusion understates almost nothing: reality #12 means both drivers' *modules* are resident in the engine regardless, so only their per-connection client state (one admin handle / one `SQSClient`) goes unmeasured. |
| D5 | Every interaction budget is measured in-page as *synchronous trigger → first MutationObserver callback satisfying a predicate*, and asserted on the **p95 of ≥ 20 samples**. Paint is explicitly outside the measurement. | MutationObserver callbacks are microtasks, giving sub-millisecond resolution; a rAF poll quantises to ~16.7 ms and cannot resolve an 8 ms budget at all. §2.1's wording ("editor panel populated", "tab switch", "node expand") describes a DOM/state condition, and the paint cost the measurement omits is already bounded structurally by `perf.spec.ts`'s DOM-cell-count assertion. p95 over 20 samples rather than max, so one GC pause is not a red suite. |
| D6 | The ≤ 8 ms grid budget is asserted as **scroll-event `timeStamp` → DOM committed**, p95 over the scroll steps — *not* as a rAF frame interval. `perf.spec.ts`'s existing rAF p95 < 24 ms tripwire is kept unchanged alongside it. | A rAF delta measures the display's frame *interval* (vsync-locked, ≈16.7 ms floor even for a perfect frame), so it can never demonstrate an 8 ms budget; the quantity §2.1 is actually bounding is per-frame main-thread work, which is what response-to-scroll measures. The two metrics answer different questions, so the old tripwire is not superseded. |
| D7 | `tests/ui/perf.spec.ts` is **kept**, with only its header comment updated to point at the specs that now carry the real measurements; three new specs are added rather than growing it. | Its four assertions (rAF tripwire, DOM cell bound, retained-bytes open/close symmetry, L2-usage-≤-budget) are cheap, single-container, and duplicated by nothing in §3. Folding §3's 4-container memory scenario into it would make the cheapest perf signal in the suite the most expensive one to run. |
| D8 | Cold start yields two numbers: `process.uptime()` sampled in **main** at the moment the workbench is interactive (asserted: ≤ 2500 ms fresh home, ≤ 3000 ms restored session), and outer wall clock around `_electron.launch()` (logged only). | The in-app number excludes Playwright's spawn overhead and is the only part the app controls; the wall clock is kept because it is the number a human perceives and it makes harness overhead visible instead of invisible. Thresholds are regression tripwires sized to survive a loaded machine — the recorded baseline in `docs/PERF.md` is the artifact that matters. |
| D9 | The **packaged** cold-start target is **≤ 1500 ms to interactive**, median of 3 warm launches on macOS 13+ arm64, first-ever launch excluded. It is read from one new `electron-log` line emitted at window `did-finish-load` carrying `process.uptime()`, plus the mount tail quantified by the harness. | SPEC.md states no cold-start number, so one is set here: startup does SQLite open + migrations + engine fork + five hydration IPCs and touches no network (§8.4 restores tabs without connecting), so 1.5 s is the ceiling at which launching feels like opening an editor rather than a database IDE. The first launch after download is excluded because Gatekeeper's quarantine scan of an unsigned bundle is not the app's cost. |
| D10 | `tests/ui/startup.spec.ts` requires **no Docker**: five connection rows are created through `window.kira.connectionsCreate` with unreachable hosts and ten tabs are persisted through `window.kira.tabsSave`, then the app is relaunched. | §8.4: a restored tab renders "Reconnect & load" and nothing else until pressed — session restore never opens a connection. So the restored-session cold start is fully measurable with no live database, making the phase's most-often-run spec its cheapest. |
| D11 | `electron-builder` 26.15.3 (current `latest`, exact-pinned) with config in a standalone **`electron-builder.yml`**, not a `build` field in `package.json`. | Keeps packaging config out of the file whose diffs are dependency churn, and gives P15's CI a single unchanged path to point at. |
| D12 | `mac.identity: '-'` (ad-hoc) with `mac.hardenedRuntime: false` — **not** `identity: null`. | Reality #19, from electron-builder's own published typings: `null` skips signing entirely, and a completely unsigned bundle is killed by the kernel on Apple Silicon, which is the only architecture §3 targets. `'-'` is the documented explicit ad-hoc opt-in, and the same typings state that ad-hoc plus the default `hardenedRuntime: true` requires the `disable-library-validation` entitlement or the app fails to launch — `hardenedRuntime: false` is the option that needs no entitlements file. Ad-hoc carries no identity and satisfies no Gatekeeper check, so §3's "unsigned local builds" still holds. |
| D13 | Targets are `dmg` **and** `zip`, arm64 only, into `dist/`. | dmg is what a human installs from; zip is what a future release pipeline uploads and what verifies quickly without mounting anything. arm64-only per §3. `dist/` is already gitignored, so no `.gitignore` edit is needed. |
| D14 | `npmRebuild: false`. | Reality #14: every `.node` binary in `node_modules` belongs to a devDependency, SQLite is `node:sqlite`, and the production dependency set is pure JS — so the rebuild step can only introduce npm/bun interop failures, never fix anything. |
| D15 | **No app icon.** electron-builder falls back to the default Electron icon; `docs/PACKAGING.md` records this as a known gap. | No icon asset is specified anywhere in SPEC.md and none exists in the tree. Inventing one is a design decision, not a hardening one. |
| D16 | Packaging "done" is a **human-run checklist** in `docs/PACKAGING.md` (§5), not an automated test. Off macOS, the only verification is that `bunx electron-builder --mac --arm64 --dir --publish never` resolves and parses the config before failing with its platform error; that observed message is recorded in `docs/PACKAGING.md`. | There is no CI in this phase (P15's job) and this repo's dev environment is Linux. A checklist a human actually runs is worth more than an assertion that can only ever be skipped. |
| D17 | §8.2's **Advanced** section becomes real: `engineMemoryCapMb` (default 512, applied at fork) and `opLogRetentionDays` (default 30, applied by `pruneOps`), both labelled "takes effect after restart" where true. This is the only feature-shaped work in the phase. | It is the one §8.2 section never implemented, it currently *lies* to the user (two disabled inputs plus a note about data views that shipped in P2), both knobs are exactly the §2.2/storage bounds this phase measures, and P12 is the last originally-scoped phase that could own it. |
| D18 | The engine old-space default **stays 512 MB**. | §2.2 wants "runaway result sets fail loudly instead of swapping the machine" — it is a failure bound, not a working budget. Lowering it toward the 350 MB *total* would convert a legitimate large page into an engine OOM. Raising it would weaken the only guard against a runaway read. The setting exposes it; the default does not move. |
| D19 | L2's 64 MB default, its `> budget / 2` no-cache rule, and L3's 5 min TTL are all **unchanged**. `docs/PERF.md` documents the consequence of the refusal rule: at page size 10 000 on a wide table a page can exceed 32 MB and is then never cached (the user's lever is the budget input in Settings → Cache). | All three values are §7-mandated and already user-adjustable where §7 says they should be. The refusal rule is correct as written — the alternative (letting one page evict the whole cache) is worse — so the honest deliverable is documenting when it bites, not tuning it. |
| D20 | Tuning is **trigger-gated** (§4): each lever has a numeric trigger derived from the baseline measurement; a lever whose trigger did not fire is not pulled, and "nothing fired" is a valid, complete outcome. Expected outcome: **L-A fires, the rest do not.** | Reality #12 — six statically imported adapters mean `@aws-sdk/client-sqs`, `kafkajs` and `mongodb` are resident from engine boot in every session, including one with a single Postgres connection. That is both a §2.2 cost and a cold-start cost, so it is the lever most likely to be justified by the numbers. Every other lever is speculative until measured, and this plan refuses to pre-commit to speculative work. |
| D21 | If the 350 MB budget still fails after every pre-approved lever in §4 has been pulled, the implementing session **stops and reports** the per-process breakdown. It does not relax the assertion, re-scope the scenario, or redesign the process model. | §2.2 is one of the spec's "two hard requirements"; a budget that gets edited when it fails is not a requirement. A structural miss at this point is a finding that needs a decision, not a patch. |
| D22 | Two new docs: `docs/PERF.md` (budget table, automated-vs-manual split, the manual procedures, and the recorded baseline numbers with machine + date) and `docs/PACKAGING.md` (how to build locally, the verification checklist, known gaps). Numbers live there, not in this plan. | A plan is written once and frozen; measurements are re-taken. P13 starts from `docs/PERF.md`'s baseline and P15 starts from `docs/PACKAGING.md`'s config, so both need a home that is expected to change. |
| D23 | P11's pre-connect script child processes are outside `app.getAppMetrics()` and outside §2.2's budget; the §3 scenarios use connections with no pre-connect script. | A pre-connect script is a user-supplied command (a port-forward, per §1) — not an Electron process, not visible to `getAppMetrics()`, and not memory the app allocates or can bound. Counting it would make the budget a property of the user's `kubectl`, not of Kira Studio. |
| D24 | `tests/ui/support/measure.ts` is a real module in a directory that currently holds only container-fixture re-exports, and the three new specs still define their own tree/navigation helpers locally. | The measurement primitives must be byte-identical across the three specs or their numbers are not comparable, which is exactly what a shared module is for; the tree helpers must not be, because reality #16 shows per-spec duplication is this suite's deliberate convention. |

## 3. Budget-by-budget measurement plan

| §2 budget | Metric actually measured | Where | Automated? |
|---|---|---|---|
| Grid scroll frame ≤ 8 ms | scroll-event `timeStamp` → DOM committed, p95 over 20 steps on a 10 000-row page | `tests/ui/budgets.spec.ts` | **asserted** |
| — (secondary) | rAF interval p95 < 24 ms, DOM cells < 1500 | `tests/ui/perf.spec.ts` (unchanged) | asserted |
| Cell selection → editor populated ≤ 50 ms | click cell → `.cm-content` contains the cell's text, p95 over 20 cells | `tests/ui/budgets.spec.ts` | **asserted** |
| Tab switch (cached) ≤ 50 ms | click tab → the other table's header cell present, p95 over 20 alternations | `tests/ui/budgets.spec.ts` | **asserted** |
| Tree node expand (cached) ≤ 50 ms | click twisty → child rows present, p95 over 20 collapse/expand cycles of an already-cached schema node | `tests/ui/budgets.spec.ts` | **asserted** |
| Any DB round-trip async/cancellable | — | already covered by every adapter's cancel scenario (P1–P10) | n/a |
| < 350 MB total RSS, 5 connections / 10 tabs | min of 10 `app.getAppMetrics()` sums over an idle window | `tests/ui/memory.spec.ts` | **asserted** |
| Same, packaged | Activity Monitor / `ps -o rss` sum for the same scenario | `docs/PERF.md` procedure | manual (macOS) |
| Cold start (no SPEC number) | main `process.uptime()` at interactive: fresh ≤ 2500 ms, restored ≤ 3000 ms | `tests/ui/startup.spec.ts` | **asserted** |
| Cold start, packaged | ≤ 1500 ms median of 3 warm launches | `docs/PERF.md` procedure | manual (macOS) |

**`tests/ui/budgets.spec.ts`** — one Postgres container, prefetch turned off first via
`window.kira.settingsSet({ data: { prefetch: false } })` so no idle background op perturbs a
sample. Scenarios, in order, each logging p50/p95 before asserting:
1. *scroll response* — open `app.big_rows`, page size 10 000, `measureScrollResponses(page, '[data-testid="data-grid"]', 20)`, assert `percentile(…, 95) <= 8`.
2. *cell → editor* — 20 distinct cells in the `hash` column; for each, read the cell's own text, then `measureClickToDom({ click: cell, observe: '[data-testid="cell-editor-panel"]', until: { selector: '.cm-content', text } })`; assert p95 ≤ 50.
3. *cached tab switch* — open `app.big_rows` and `app.wide_table` (both loaded, both retained by `views/grid/page.ts`), alternate 20 times, `until` = the target table's distinctive header cell; assert p95 ≤ 50.
4. *cached tree expand* — expand `app` once (populates L1), then 20 collapse/expand cycles, `until` = `[data-testid="tree-row"][data-path=".../table:big_rows"]`; assert p95 ≤ 50.
5. `expect(consoleErrors).toEqual([])`.

**`tests/ui/memory.spec.ts`** — `test.describe.configure({ timeout: 600_000 })`, Docker-skip
guard, four containers started in `beforeAll`. Builds D4's scenario entirely through
`window.kira.connectionsCreate` + `connectionsConnect` for the connections and through the tree UI
for the tabs, then:
1. `sampleRssSeries(app)` **before** any connection (baseline), logged — this is lever L-A's input.
2. connect all 5, open all 10 tabs, wait for every grid/document/key list to render.
3. `sampleRssSeries(app)`, `console.log(formatRssSeries(series))`, assert `min(totalBytes) < 350 * 1024 * 1024`.
4. record the L2 hit rate and usage from the Settings → Cache pane into the log line (for `docs/PERF.md`).
5. disconnect all 5, close all tabs, `sampleRssSeries` again and log — §2.2's "disconnecting releases its driver state and all its cached pages" is *logged, not asserted* here, because asserting a specific release figure is P13's leak sweep, not P12's budget check.

**`tests/ui/startup.spec.ts`** — no Docker.
1. *fresh* — `relaunch()` against an empty `KIRA_HOME`, wall clock around it, `uptimeMs(app)` once `[data-testid="status-bar"]` and `[data-testid="project-panel"]` are visible; assert ≤ 2500 ms; log both numbers.
2. *restored* — create 5 connection rows and save 10 tab records through `window.kira`, `relaunch()`, wait for the tab strip to show 10 tabs and the restored tab to render its "Reconnect & load" state; assert `uptimeMs` ≤ 3000 ms; log both numbers.
3. `expect(consoleErrors).toEqual([])` on both launches.

## 4. Tuning levers (pre-approved, trigger-gated)

Each lever is unlocked only by its trigger, evaluated against §3's recorded baseline. Anything not
listed here is out of scope for this phase even if the numbers look improvable.

| Lever | Trigger | Change | Expected |
|---|---|---|---|
| **L-A** eager driver loading | engine (`Utility`/`kira-engine`) RSS with **zero** connections > 100 MB | make `engine/adapters/registry.ts`'s six entries lazy (`() => require('./kafka').createKafkaAdapter(deps)`) and move each adapter's driver import behind a lazy accessor in its own `client.ts`, so only connected kinds load their driver. Replace registry.ts's "not big enough to justify lazy loading" comment with the measured number that overturned it. Re-run §3's memory **and** startup specs afterwards — this lever moves both. | **fires** |
| **L-B** renderer page retention | renderer RSS(10 tabs) − RSS(0 tabs) > 120 MB **and** `__kiraGridRetainedBytes()` accounts for less than half of it | **none in P12** — record the two numbers in `docs/PERF.md` and hand to P13. A retention policy that drops pages for cold tabs would re-fetch on switch and put the ≤ 50 ms cached-tab-switch budget at risk; that trade is a design decision, not a tuning knob. | no |
| **L-C** L2 budget default | steady state sits at the 64 MB budget **and** total RSS > 350 MB | **none** — 64 MB is §7's stated default and already user-adjustable; record the trade-off in `docs/PERF.md` instead (D19). | no |
| **L-D** bundle weight | packaged `.app` > 300 MB on disk | `electronLanguages: ['en']` is already in the config; record the measured size and, if still over, list what dominates in `docs/PACKAGING.md`. No asar-unpacking or dependency surgery in this phase. | no |
| **L-E** engine old-space cap | peak engine RSS > 400 MB in any §3 scenario | **none** — D18. The number is recorded; a peak near the cap is a P13 input, not a P12 retune. | no |
| **L-F** cached tree expand | expand p95 > 50 ms | serve a re-expand from `renderer/project/state/tree.ts`'s existing `treeState.children` when present and `refresh !== true`, narrowing P1 D10 to first-expand only. Requires re-running `tests/ui/tree.spec.ts`'s op-count assertions. | no |
| **L-G** cell editor populate | p95 > 50 ms | move `views/celleditor/detect.ts`'s scored autodetect off the selection path — show the raw value first, apply the detected format on the following task. | no |
| **L-H** scroll response | p95 > 8 ms | investigate with the logged per-step series **before** changing anything; the pre-approved change is reducing `OVERSCAN_ROWS` in `views/grid/DataGrid.vue`. Nothing else in the grid is touched in this phase. | no |

If the 350 MB assertion still fails once L-A is pulled and every other fired lever is applied:
stop, record the breakdown, report (D21).

## 5. Packaging: local run and manual verification checklist

`docs/PACKAGING.md` carries this verbatim; it is written for a human on macOS 13+ arm64 with Bun
and Xcode command-line tools.

```
bun install
bun run package:mac        # electron-vite build, then electron-builder --mac --arm64
```

Expected artifacts: `dist/Kira Studio-0.1.0-arm64.dmg`, `dist/Kira Studio-0.1.0-arm64-mac.zip`,
`dist/mac-arm64/Kira Studio.app`. `bun run package:mac:dir` produces only the `.app` and is the
faster loop for the cold-start and RSS measurements.

Checklist — every item is a pass/fail a human records in `docs/PACKAGING.md`:
1. `codesign -dv --verbose=2 "dist/mac-arm64/Kira Studio.app"` reports `Signature=adhoc`.
2. `npx asar list "dist/mac-arm64/Kira Studio.app/Contents/Resources/app.asar" | grep -c node_modules/pg` is non-zero. **If it is zero**, electron-builder did not pick up the production dependency tree from Bun's `node_modules`: add `node_modules/**/*` to `files` and re-run. (Everything the engine needs at runtime is external per `externalizeDepsPlugin`; a missing driver is a packaged-only failure that no `out/**` glob would reveal.)
3. Launching the app shows the workbench. **If it dies immediately**, `utilityProcess.fork` could not load the engine from inside the asar: add `asarUnpack: ['out/main/engine.js']` and re-run. The engine status dot in the status bar is the direct signal.
4. Gatekeeper: an unsigned, unnotarized build needs right-click → Open, or `xattr -dr com.apple.quarantine "/Applications/Kira Studio.app"`. Expected, not a defect.
5. `~/.kira-studio/` is created with `kira.sqlite` and `logs/` — the real home, since `KIRA_HOME` is unset in a packaged run (this is also the first time `app.setPath('userData')` is *not* redirected).
6. Create a connection, expand the tree, open a data tab, scroll, open the cell editor, quit cleanly. The View menu has no Reload / Toggle DevTools — expected, `app.isPackaged` is true (reality #15).
7. Cold start: launch 3 times, discard the first, take the median of the `startup` log line in `~/.kira-studio/logs/`; record against the ≤ 1500 ms target (D9).
8. RSS cross-check: rebuild §3's 5-connection/10-tab scenario by hand, sum the app's processes in Activity Monitor, record against 350 MB.
9. Record the `.app` on-disk size (lever L-D).

Known gaps recorded in the same doc: no app icon (D15); ad-hoc signature only, so the build is not
distributable outside the machine that built it (§3 defers signing/notarization); no CI, no
tag-triggered build, no auto-update — all P15.

Off macOS, the implementing session runs `bunx electron-builder --mac --arm64 --dir --publish
never`, expects it to fail with a platform error *after* resolving and parsing
`electron-builder.yml`, and records that exact message in `docs/PACKAGING.md`. That is the whole
of its packaging verification (D16).

## 6. Target tree at the end of P12

```
package.json                MOD — electron-builder 26.15.3 devDependency (exact pin);
                                   package:mac + package:mac:dir scripts; description, author.
electron-builder.yml         NEW — unsigned (ad-hoc) arm64 macOS config (§1).
docs/
  PERF.md                    NEW — §2 budget table, automated-vs-manual split, the two manual
                                    procedures (packaged cold start, packaged RSS), the recorded
                                    baseline numbers with machine + date, the L2 >budget/2
                                    refusal note (D19), and the three items handed to P13.
  PACKAGING.md               NEW — local build commands, §5's verification checklist, known gaps.
src/shared/
  settings.ts                MOD — advancedSettingsSchema (engineMemoryCapMb 512,
                                    opLogRetentionDays 30) + settingsSchema/.default +
                                    settingsPatchSchema + defaultSettings.
src/main/
  index.ts                   MOD — read settings before startEngine(); pass the cap to
                                    startEngine() and the retention to wireOplog().
  engine-host.ts              MOD — startEngine({ maxOldSpaceMb }) drives execArgv.
  oplog.ts                   MOD — retentionDays parameter forwarded to pruneOps.
  window.ts                  MOD — one electron-log line at did-finish-load carrying
                                    process.uptime() (D9). No other change.
  storage/repos/
    settings.ts              MOD — 'advanced' in getAllSettings' and setSettings' section lists.
    ops.ts                   MOD — pruneOps(db, retentionDays); HARD_CAP_ROWS unchanged.
src/renderer/
  state/settings.ts          MOD — applySettings assigns the advanced section.
  workbench/SettingsDialog.vue MOD — Advanced becomes two real inputs
                                    (settings-engine-memory-cap, settings-oplog-retention) with a
                                    "takes effect after restart" note; the stale
                                    "Available once data views land." note is deleted.
src/engine/adapters/
  registry.ts                MOD (conditional, lever L-A) — lazy per-kind factories.
  */client.ts                MOD (conditional, lever L-A) — deferred driver require.
tests/ui/
  support/measure.ts         NEW — sampleRss, sampleRssSeries, formatRssSeries, percentile,
                                    measureClickToDom, measureScrollResponses, uptimeMs.
  budgets.spec.ts            NEW — the four §2.1 interaction budgets, real assertions (§3).
  memory.spec.ts             NEW — §2.2's 350 MB budget, 5 connections / 10 tabs, 4 containers.
  startup.spec.ts            NEW — cold start, fresh + restored, no Docker.
  perf.spec.ts                MOD — header comment only; all four tripwires unchanged (D7).
  workbench.spec.ts          MOD — Advanced-section values persist across relaunch.
docs/plans/
  P12-hardening.md           NEW — this document.
```
