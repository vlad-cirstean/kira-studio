# P51 — Electrobun migration spike, reopened

> This document is the plan only. No Electrobun install, no code change, no test move, no spec
> triage has been performed yet. Producing this document is the entirety of this session's work on
> P51 — the actual spike (installing Electrobun, analyzing its bridge, building the isolated-webkit
> FE harness, triaging every `tests/e2e/*` spec) does not start until the user reviews this plan and
> explicitly signs off. **Do not begin implementation from this document alone.**

## 0. Why this reopens P20

`docs/v1/plans/P20-electrobun-spike.md` investigated this once already and its outcome (§9) was
**out of scope — will not be done**, on two dealbreakers:

1. **No E2E testing path.** Electrobun's webview is WKWebView (macOS) / WebKit2GTK (Linux); neither
   exposes a WebDriver/CDP endpoint Playwright (or Cypress) can attach to. `_electron.launch()` has
   no equivalent, and the one working alternative — Appium's `mac2-driver`/XCUITest — drives the OS
   accessibility tree, not the DOM, meaning a full rewrite of the suite's interaction model.
2. **The bulk-data architecture would regress.** SPEC §4's `MessageChannelMain` design hands the
   engine subprocess a port straight into the renderer so bulk query results never transit or block
   the main process. Electrobun's RPC bridge only copies payloads — no `Transferable`/`ArrayBuffer`/
   `structuredClone`/port-transfer primitive — so every bulk page would move onto the same event
   loop as the native menu and window chrome.

P20 also noted the original network block (Hutch/Cottontail's download hosts, `hutch.blackboard.sh`
/ `electrobun-artifacts.blackboard.sh`, both 403 from this sandbox) turned out not to be the real
blocker — a later session with open egress got a real Electrobun build running, and the verdict
still came back "won't be done" on the two grounds above, not on network access.

**What's changed since P20**, prompting this reopening:

- P50 split the old monolithic `tests/ui/*.spec.ts` (now `tests/e2e/*.spec.ts`) per-adapter suites
  into two tiers at the IPC boundary: a **backend** tier (`tests/ipc/*/*.backend.spec.ts`, adapter
  logic against a real driver/container, run under `ELECTRON_RUN_AS_NODE=1 electron` purely for
  ABI-correct native-module loading — no window, no renderer, no Playwright driver at all) and a
  **frontend** tier (`tests/ipc/*/*.frontend.spec.ts`, real Electron window via `_electron.launch()`,
  mocked `ipcMain` handlers, real `contextBridge`/`ipcRenderer.invoke` boundary).
- The user has now pre-accepted losing dealbreaker #1's full-fidelity E2E coverage entirely, on
  the condition that the BE and FE tiers survive in some form, with FE's shape changing to run the
  built renderer bundle in Playwright's own `webkit` project in isolation (no real Electrobun window
  at all), rather than trying to solve the WebDriver/CDP gap.
- Dealbreaker #2 (bulk-data regression) is pre-accepted as livable *if* the spike's own analysis
  turns up no viable alternative — it is no longer an automatic stop, but the analysis still has to
  happen, not be skipped.

## 1. Premises for this spike (already decided by the user — not open questions)

1. Losing the full `tests/e2e/` tier's *shell-integration* fidelity (a real native window, driven
   end-to-end through the actual production bridge) is accepted outright.
2. The migration must still leave both a **BE** tier and an **FE** tier standing in some form —
   losing IPC-boundary coverage entirely is not on the table.
3. Every current `tests/e2e/*.spec.ts` scenario gets triaged: moved into whichever of BE/FE it fits,
   where relevant. Anything that fits neither is accepted as dropped coverage (see §5 — this
   session enumerates the files but does not perform the triage itself).
4. FE tests run the built renderer bundle in Playwright's **`webkit`** project, in isolation — not
   against any real Electrobun window — with a hand-built fake bridge standing in for `window.kira`.
   This is understood and accepted to mean FE tests validate the Vue frontend's own logic and
   interaction, decoupled from Electrobun's actual native shell/bridge/menu/packaging; it is *not*
   equivalent to the shell-integration coverage FE currently gets by running inside a real Electron
   window (see §3 for exactly what this does and doesn't catch).
5. Bulk-data transmission: the spike must analyze what's actually available (§2.A) before falling
   back to acceptance. Accepting the regression is the default if nothing better turns up, not a
   foregone conclusion the spike skips past.
6. The spike's report must surface every other disadvantage it can find, not just the two from P20
   — §2.B re-audits P20's 15 "realities" against these new premises as a starting point.

## 2. What the spike still has to determine

### 2.A Bulk-data transmission alternatives

P20 checked one thing (`rpc.ts`/`bridge-payload-ownership.test.ts`, no transfer primitive found)
and stopped once the architecture question was answered. Before accepting the regression, the
spike needs to actually survey:

- Whether Cottontail (Bun-based) exposes any Bun-native IPC primitive the main↔engine channel could
  use directly, bypassing Electrobun's own webview bridge for that hop entirely (the engine↔main
  leg doesn't need to go through Electrobun's webview-RPC layer at all — only main↔renderer does).
- Whether a `SharedArrayBuffer`/shared-memory approach is viable across Electrobun's process
  boundaries at all (unverified either way as of P20).
- Whether chunked/streamed responses over the existing copy-based RPC can bound worst-case latency
  well enough that the *architecture* regresses (extra copies, main-thread contention) without the
  *interaction budgets* (`docs/PERF.md` §2.1) actually regressing in practice — i.e., is this a real
  measured regression or a theoretical one, once actually built and profiled.
- A plain recommendation: adopt an alternative, or accept the regression — and if accepting, an
  estimate of how much of `docs/PERF.md` §2.1's budget headroom (5.6ms p50 scroll against 8ms, etc.)
  it's expected to cost.

### 2.B Re-audit of P20's realities under the new premises

| # | P20 finding | Status under this spike's premises |
|---|---|---|
| 1 | `electrobun` npm package is a thin Hutch-download shim, not the SDK itself | Unchanged — still a supply-chain/reproducibility risk distinct from reachability (see #3) |
| 2 | Hutch/Cottontail download hosts were 403 from this sandbox | Resolved by the user's own note (any URL can be allowed here now) — no longer a blocker, in this sandbox or otherwise |
| 3 | Electrobun 2.x is ~1 year old and already superseded 1.x (SDK moved off npm entirely) | Unchanged — still a maturity/stability risk to accept explicitly, not something the new premises address |
| 4 | App's Electron surface is small and isolated (11 files import `'electron'`; renderer imports it nowhere) | Unchanged, still the strongest structural argument *for* feasibility |
| 5 | Rewrite surface ~3 200 lines (`src/main` + `src/preload`), not the whole app | Unchanged |
| 6 | 56 IPC channels, 4 shapes: invoke, main→renderer push, fire-and-forget, `MessagePort` transfer | The first 3 shapes look expressible over Electrobun's typed main↔webview RPC; the 4th is exactly §2.A |
| 7 | `MessagePort` transfer is architectural (SPEC §4), no Electrobun equivalent found | Downgraded from "dealbreaker" to "§2.A's open question," per the user's pre-acceptance |
| 8 | Engine is an Electron `utilityProcess` with an Electron-specific memory cap (`--max-old-space-size` via `execArgv`, P12 lever L-E); Electrobun has no `utilityProcess` | **Still open and unaddressed by the new premises.** The engine becomes an ordinary spawned child with a hand-rolled channel, and the V8 flag has no meaning under Cottontail's JSC runtime — P12's L-E lever and the `advanced.engineMemoryCapMb` setting need a replacement or removal |
| 9 | Six DB drivers (`pg`, `mariadb`, `mongodb`, `ioredis`, `kafkajs`, `@aws-sdk/client-{s3,sqs}`) run on Electron's embedded Node; compatibility under Cottontail/Bun is unverified | **Still open.** P50's BE tier is exactly the scaffolding that *could* answer this empirically once ported (§4), but the split itself doesn't answer it |
| 10 | Storage (`drizzle-orm/sqlite-proxy` over `node:sqlite`) needs a driver swap; `node:sqlite` doesn't exist under Bun; Cottontail's own SQLite story is unknown | **Still open** — unaddressed by the new premises |
| 11 | Window/menu/lifecycle surface is small but 100% Electron API (`BrowserWindow`, native `Menu`, 12 accelerators, `app.*` lifecycle) | Unchanged — real rewrite cost, not resolved by accepting the E2E/bulk-data losses |
| 12 | Logging (`electron-log`) requires Electron, sits on the cold-start path | Unchanged |
| 13 | Packaging is entirely `electron-builder`-shaped, asserted by `scripts/verify-packaging.sh` | Unchanged, explicitly out of scope for *this* spike (as it was for P20's D14) — a full migration's packaging story is separate, larger work |
| 14 | Electron fully vendored/runnable here; Electrobun previously wasn't | Resolved per #2 above, for this sandbox — doesn't change #1/#3's standing supply-chain/maturity risk once it *is* reachable |
| 15 | `docs/PERF.md` §2.2's baseline RSS (~620MB, Chromium/Electron process overhead) is the motivating number | Unchanged — still the reason to even ask the question, and still what a spike would need to re-measure under Electrobun's baseline |

### 2.C A disadvantage P20 didn't have to consider: instrumentation, not just access

P20 already found (§0.3 / realities table) that `app.getAppMetrics()` and
`app.evaluate(() => process.uptime())` are Electron/Chromium-only APIs with no Electrobun
counterpart. Under the premises here, that cuts deeper than it did for P20: `tests/e2e/budgets.spec.ts`,
`perf.spec.ts`, and `startup.spec.ts` don't just lose their *driver* (dealbreaker #1) — the
measurement APIs they call don't exist under Electrobun/Cottontail at all, with or without a
harness. That coverage doesn't move to BE or FE (§5); it's gone unless Electrobun exposes its own
analogous instrumentation, which is unverified and should be checked explicitly rather than assumed
away.

Similarly, `tests/e2e/hardening.spec.ts` and `secrets.spec.ts` exercise Electron-specific
main-process behavior — `safeStorage`'s OS-keychain-backed encryption (P25) chief among them.
Electrobun's main process would need an equivalent, or P25's whole credential-encryption design
needs redoing on a different primitive. This is a real, separate cost the spike's report should
name, not fold silently into "the FE tier now runs in isolation."

## 3. FE tier's new shape — what it would and wouldn't cover

The design (not yet built): serve the built renderer bundle (`out/renderer/`) to a Playwright
`webkit` page via `page.addInitScript()`, injecting a hand-written stand-in for `window.kira` before
the bundle's own scripts run — mirroring the shape `tests/ipc/support/mockControl.ts` already fakes
today, except this time with no real main process or `contextBridge` behind it at all, since there
is no Electrobun window in the loop.

What this catches: the Vue frontend's own rendering and interaction logic, exactly as it does
today — tree/grid/console behavior, given a scripted set of responses.

What this does **not** catch, and the report must say so plainly:

- Electrobun's actual bridge/RPC implementation (the fake stands in for it entirely).
- Electrobun's actual native window/menu/lifecycle chrome.
- Playwright's `webkit` is Playwright's own maintained WebKit build, not the system WKWebView
  Electrobun would actually embed on macOS (the target platform per SPEC §3) — rendering/behavior
  differences between the two are out of this tier's reach.
- Anything in §2.C (measurement APIs, `safeStorage`) that has no equivalent to fake in the first
  place.

## 4. BE tier under Electrobun

BE today validates adapter/driver logic under `ELECTRON_RUN_AS_NODE=1 electron` — Electron acting as
a plain Node binary with the exact ABI the packaged app ships. Under Electrobun the shipped runtime
is Cottontail (Bun-based), not Electron's embedded Node, so BE's own execution mechanism has to
change to run directly under Cottontail (or plain Bun, if close enough) to remain a meaningful
ABI-correctness check — this is new design work, not a port of the existing script, and it's the
concrete way to actually answer reality #9/#10 above rather than leave them as unverified risk.

## 5. `tests/e2e/*` triage — required deliverable, not performed in this session

The spike must produce a per-file disposition for all 22 current specs (moved into an adapter's BE,
moved into FE-isolated-webkit, or dropped with a stated reason) rather than a blanket call:

```
autocomplete.spec.ts   budgets.spec.ts*    cell-editor.spec.ts   connections.spec.ts
console.spec.ts        data-view.spec.ts   definition.spec.ts    hardening.spec.ts*
interaction.spec.ts    leaks.spec.ts       mongo.spec.ts         mutations.spec.ts
perf.spec.ts*          preconnect.spec.ts  s3.spec.ts            secrets.spec.ts*
smoke.spec.ts          sqlite.spec.ts      startup.spec.ts*      tabs.spec.ts
tooltips.spec.ts       tree.spec.ts        workbench.spec.ts
```

`*` marked files are the ones §2.C already flags as likely-dropped outright (no instrumentation or
main-process equivalent to test against), rather than movable into either tier — a preliminary flag
for the spike to confirm, not a final call.

## 6. Explicitly out of scope for this document

- No Electrobun install or build attempted.
- No code change under `src/` or `tests/`.
- No per-spec triage actually performed (§5 lists the inputs only).
- No bulk-data alternative actually implemented or benchmarked (§2.A is a research question, not
  a result yet).

## 7. Decision gate

The spike's eventual deliverable is a written report — §2.A's recommendation, §2.B's updated
realities table with empirical re-verification (not just reasoned-through status), §2.C's
instrumentation findings, the FE-harness design, the BE-under-Cottontail design, and §5's completed
per-spec triage — plus an explicit go/no-go call. **No implementation phase starts until the user
has reviewed that report and signed off**, exactly as this phase's kickoff requested.
