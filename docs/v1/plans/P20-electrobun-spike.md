# P20 — Electrobun migration spike

> Plan for SPEC.md §10 phase **P20**. Deliverable, verbatim from the phasing table: *"On a branch
> cut from this point, migrate the app off Electron onto Electrobun; then run the full automated
> perf suite (`tests/ui/budgets.spec.ts`, `perf.spec.ts`, `memory.spec.ts`, `startup.spec.ts` — see
> `docs/PERF.md`) on both branches and record the results side by side. Run each branch's suite
> multiple times, not once — these tests have real run-to-run variability (see `docs/PERF.md` §2.1's
> methodology note), so a single sample per branch isn't sufficient to call a difference real."*
> Marked *"Comparative, not a one-way door: the deliverable is the measured before/after, not a
> commitment to ship the migration."*
>
> **Read §0 before anything else.** This phase is not shaped like P0–P19. Every prior phase was
> additive inside the existing Electron architecture; this one proposes replacing the runtime that
> every other phase was built on and measured against. The research below found two independent
> hard blockers — one environmental, one methodological — and the plan is built around them rather
> than around the phasing table's optimistic wording.

---

## 0. Feasibility verdict (read this first)

**Electrobun cannot be bootstrapped in this sandbox. The phase as literally worded cannot be
executed here, and no amount of scoping-down changes that** — the blocker is at install time,
before a single line of app code would be touched.

Three findings, in order of how much they constrain the phase:

### 0.1 The Electrobun runtime and SDK are unreachable from this network (hard blocker)

`electrobun` on npm is a **45.8 kB, zero-dependency bootstrap that contains no runtime, no SDK, and
no native binary**. Its own `lib/moved.cjs` is a single `throw`:

```
Electrobun 2.x APIs come from the Hutch devkit, not node_modules.
Run `npx electrobun dev` (or `hutch electrobun prepare`) so imports resolve from .hutch/devkit …
```

Everything real is fetched at first use by **Hutch** (`hutch.blackboard.sh`), Blackboard's separate
workspace orchestrator. The bootstrap fetches Hutch itself from **GitHub Releases**, which *is*
reachable here — but Hutch then resolves **Cottontail** (its JSC-based build/run runtime) and the
Electrobun devkit from `electrobun-artifacts.blackboard.sh` / `hutch.blackboard.sh`, both of which
this sandbox's egress proxy denies at CONNECT time.

Exact commands and exact output:

```
$ npm view electrobun
electrobun@2.0.1 | MIT | deps: none | versions: 310
The lightweight npm bootstrap for Electrobun and Hutch.
.unpackedSize: 45.8 kB          # bin/electrobun.cjs, bin/resolve-hutch.cjs, lib/moved.cjs only

$ bun add electrobun
installed electrobun@2.0.1 with binaries:
 - electrobun
1 package installed [117.00ms]                                 # install SUCCEEDS

$ bun x electrobun --version
Downloading Hutch 0.24.3 for Electrobun 2.0.1 (linux-x64)...   # Hutch fetch SUCCEEDS (GitHub Releases)
hutch: could not resolve Cottontail: ReleaseDownloadFailed     # runtime fetch FAILS

$ bun x electrobun init
Electrobun projects use Hutch; installing the latest production release...
electrobun: Hutch installer returned HTTP 403                  # init FAILS

$ curl -sS -o /dev/null -w '%{http_code}\n' https://hutch.blackboard.sh/hutch/install.sh
curl: (56) CONNECT tunnel failed, response 403
000

$ curl -sS -o /dev/null -w '%{http_code}\n' https://electrobun-artifacts.blackboard.sh/
curl: (56) CONNECT tunnel failed, response 403
000

$ curl -sS -o /dev/null -w '%{http_code}\n' https://electrobun.dev/
curl: (56) CONNECT tunnel failed, response 403
000
```

The two override knobs Hutch exposes were both tried and both fail:

```
$ DASH_ARTIFACTS_BASE_URL=https://github.com/blackboardsh/electrobun/releases/download/v2.0.1 \
    ~/.hutch/npm/electrobun/2.0.1/linux-x64/bin/hutch electrobun --help
hutch: could not resolve Cottontail: ReadFailed      # the GitHub release does not host the devkit index

$ DASH_RELEASE_OFFLINE=1 ~/.hutch/npm/electrobun/2.0.1/linux-x64/bin/hutch electrobun --help
hutch: could not resolve Cottontail: ReleaseMetadataUnavailableOffline
```

This is the same *class* of denial P17 hit with Docker Hub / ECR / GHCR blobs, confirmed against
the same instrument (`curl -sS "$HTTPS_PROXY/__agentproxy/status"` shows the allow-list:
`registry.npmjs.org, jsr.io, npm.jsr.io, pypi.org, files.pythonhosted.org, index.crates.io,
proxy.golang.org` and nothing else relevant). The only reason the *bootstrap* got as far as it did
is that GitHub Releases' `releases/download/...` path is permitted; the Blackboard artifact CDN is
not.

**Nothing about the app, the repo, or the plan can route around this.** The runtime simply is not
obtainable here.

### 0.2 Linux is supported by Electrobun — but Linux is the wrong platform for this measurement

Linux is **not** the blocker, and this is worth stating explicitly because it is the thing one would
assume:

- Electrobun's own README lists **macOS 14+, Windows 11+, and Ubuntu 24.04+** (community support for
  other distros on GTK3 + WebKit2GTK-4.1). It is not macOS-only.
- Hutch publishes all four platform archives — verified by reading the release's own index,
  `hutch-artifacts.json` for v2.0.1, which carries `macos-arm64`, `linux-arm64`, **`linux-x64`**,
  `windows-x64` entries with sizes and SHA-256s; and `bin/resolve-hutch.cjs`'s `releasedPlatforms`
  map is exactly those four.
- The linux-x64 Hutch archive downloaded and verified successfully in this container.
- This container is Ubuntu 24.04.4. It has `libgtk-3.so.0` but **no** WebKit2GTK
  (`ldconfig -p | grep -c webkit` → `0`), which Electrobun needs on Linux — however
  `libwebkit2gtk-4.1-0` *is* installable: `apt-cache policy` shows candidate
  `2.52.3-0ubuntu0.24.04.1` from `archive.ubuntu.com`, which is reachable.

So on a machine with the Blackboard hosts allowed, a Linux spike would build. **It still would not
answer the question the phase asks.** SPEC §1 and §3 scope this app to **macOS 13+, arm64, native
title bar**; `docs/PERF.md`'s §3 manual procedures and P12's whole packaged-app story are macOS.
Electrobun's headline claim is that it uses the *system* webview — which means **WKWebView on macOS
and WebKit2GTK on Linux: two different engines with different memory and frame-scheduling
characteristics.** A Linux Electrobun-vs-Electron number would not transfer to the macOS decision
this phase exists to inform. See D4.

### 0.3 The perf suite cannot run against a non-Electron build at all (methodological blocker, independent of the network)

This is the finding that survives even on an unblocked, macOS machine, and it changes what the
phase's deliverable can honestly be.

All four named specs are wired to Electron-specific Playwright and Electron-specific APIs:

| Dependency | Where | Why it does not survive the swap |
|---|---|---|
| `_electron.launch({ args: [mainEntry], env })` | `tests/ui/fixtures.ts:44` — the `relaunch` fixture every spec builds on | Playwright has an Electron driver and a browser driver. It has **no** Electrobun driver, and Electrobun's window is a native WKWebView/WebKit2GTK surface, not a CDP-speaking Chromium. `_electron.launch` cannot attach. |
| `app.getAppMetrics()` | `tests/ui/support/measure.ts:21` (`sampleRss`), the sole input to `memory.spec.ts` | Electron/Chromium-only API. Its per-process breakdown (`Browser`/`GPU`/`Utility:NodeService`/`Tab`) — the exact table `docs/PERF.md` §2.2 is written around — has no Electrobun counterpart, because Electrobun has no Chromium process model. |
| `app.evaluate(() => process.uptime() * 1000)` | `measure.ts:198` (`uptimeMs`), gating both `startup.spec.ts` assertions | Executes inside the **Electron main process**. Electrobun's equivalent is a Cottontail/Bun process Playwright cannot evaluate into. |
| `page.evaluate` + MutationObserver timing | `measureClickToDom`, `measureScrollResponses` | The measurement technique is runtime-neutral; the *transport* (a Playwright `Page` obtained from `app.firstWindow()`) is not. |

On top of that, three of the four specs need Docker, which this sandbox does not have:
`docker info` → `failed to connect to the docker API at unix:///var/run/docker.sock … no such file
or directory`. `budgets.spec.ts`, `perf.spec.ts` and `memory.spec.ts` all open with
`if (!(await isDockerAvailable())) test.skip(...)` and start Postgres/MariaDB/Mongo/Redis
Testcontainers. **`startup.spec.ts` is the only Docker-free spec** — by design; its own header comment
says so ("no Docker: session restore never opens a connection … so the restored-session cold start
is fully measurable against unreachable-host connections"), and it dials TEST-NET-3 addresses that
are never reached.

So the measurable matrix in *this* sandbox, on the Electron side alone, is one spec out of four.
And on the Electrobun side it is zero out of four, because the harness cannot launch the app.

### 0.4 Verdict and recommended scope

| Question | Answer |
|---|---|
| Can Electrobun be installed here? | The **npm bootstrap** yes; the **runtime/SDK** no — 403 at `hutch.blackboard.sh` and `electrobun-artifacts.blackboard.sh`. |
| Does Electrobun support Linux? | Yes (Ubuntu 24.04+, GTK3 + WebKit2GTK-4.1); linux-x64 Hutch archive downloads fine. Linux is not the blocker. |
| Can the phase's literal deliverable be produced here? | **No.** Runtime unobtainable; and even with it, the perf harness is Electron-bound and 3 of 4 specs need Docker. |
| Can it be produced on a suitable machine? | Partially — see D1/D5/D7. A *full-parity port* is not a realistic single phase. A **scoped spike measuring startup and RSS through a runtime-neutral instrument** is. |
| What should happen now? | Land this document as the phase's research record. Do **not** start a migration. Get a decision from the user on §8's questions, then run Stage 1+ on a macOS arm64 machine with unrestricted egress. |

**The recommended scope of the eventual implementation phase is a throwaway proof-of-concept
shell, not a migration** — see D3, D7 and §3's staging. The phasing table's own framing
("comparative, not a one-way door") is exactly the licence for that reading: if the deliverable is
the measurement, then the cheapest artefact that produces a *trustworthy* measurement is the right
artefact, and porting 34 000 lines is not it.

---

## 1. Ground rules for this phase

- **No application implementation code is written under this plan until §8's questions are
  answered.** This is the first phase in the repo's history where the research verdict is "the
  named deliverable is not achievable as written," and silently attempting it anyway would burn a
  large amount of effort on a doomed port.
- **The Electron branch is never modified.** Every artefact of this phase lives on a branch cut
  from the v1 feature branch and is expected **not to merge**. `src/main`, `src/preload`,
  `electron.vite.config.ts`, `electron-builder.yml` and `scripts/verify-packaging.sh` stay exactly
  as they are on the mainline.
- **`tests/ui/*.spec.ts` are not edited.** Not one of the four perf specs, and not `fixtures.ts`.
  A new, additive harness is built alongside them (D6) — the existing suite's numbers must stay
  comparable to the ones already recorded in `docs/PERF.md` §2.
- **Both sides of every comparison are measured by the same instrument.** A number produced by
  `app.getAppMetrics()` on one branch and by `ps -o rss` on the other is not a comparison; it is two
  unrelated numbers. See D6.
- **Multiple runs, reported as a distribution.** The phasing table demands this and `docs/PERF.md`
  §2.1's methodology note earns it: that note documents a case where p95 moved by a full frame
  period for reasons that had nothing to do with app work. See D8.
- **Nothing in this phase relaxes an existing budget or edits `docs/PERF.md` §2.** P20's results go
  in a new §5, clearly labelled as a different instrument on a different runtime.

### Realities this phase works with (verified against the tree and the tooling)

1. **The `electrobun` npm package contains no Electrobun.** `npm pack electrobun` yields six files:
   `bin/electrobun.cjs` (a 60-line front door), `bin/resolve-hutch.cjs` (1 363 lines of
   download/verify/cache logic), `lib/moved.cjs` (a 12-line `throw`), `package.json`, `README.md`,
   `LICENSE`. `package.json` declares no `dependencies`, no `optionalDependencies`, no `os`/`cpu`
   constraints, and **no install lifecycle script** — the download happens on first CLI invocation,
   not at `bun add` time. That is why §0.1's `bun add` succeeds and `bun x electrobun` does not.
2. **The download chain is two hops, and only the first is reachable here.** `resolve-hutch.cjs`
   pins `PAIRED_HUTCH_VERSION = "0.24.3"` and `defaultReleasesBaseUrl =
   "https://github.com/blackboardsh/electrobun/releases/download"` (reachable) for the Hutch
   archive; the installed `hutch` binary then resolves Cottontail and the Electrobun devkit from
   the only two hosts baked into it — `strings hutch | grep https://` returns exactly
   `https://electrobun-artifacts.blackboard.sh` and `https://hutch.blackboard.sh` (both 403).
3. **Electrobun 2.x's distribution model is one year old and already replaced 1.x's.** npm shows
   310 published versions; `1.18.1` (a 660 kB package with the SDK in `dist/api/bun/core/*.ts`,
   six runtime dependencies, and native artefacts fetched straight from
   `releases/download/${version}/electrobun-core-${platform}-${arch}.tar.gz`) and `2.0.1` (45.8 kB,
   zero deps, Hutch-mediated, SDK removed from npm entirely) are different products wearing the
   same name. Guessed 1.x asset URLs 404 and the release list cannot be enumerated from here
   (github.com HTML/API is repo-scoped by this session's proxy), so 1.x was not pursued — and
   planning a migration onto a superseded major would be the wrong answer anyway. This is a
   maturity signal that belongs in the decision (D16), not a footnote.
4. **The app's Electron surface is genuinely small and well-isolated.** Exactly **11 files in
   `src/` import from `'electron'`**: ten under `src/main` + `src/preload`, and one in
   `src/engine/index.ts` — and that one is `import type { MessagePortMain }`, a *type-only* import.
   `src/renderer` imports `'electron'` **nowhere**; it reaches the platform only through
   `window.kira` (the `contextBridge` surface) and a `window.postMessage`-relayed `MessagePort`
   (`renderer/bridge/port.ts`). This is the single most encouraging finding for a hypothetical
   migration and it is why D13's "prove the seam" spike is meaningful.
5. **The surface to rewrite is ~3 200 lines, not 34 000.** `src/main` is 46 files / 2 990 lines;
   `src/preload` is 1 file / 208 lines. For contrast: `src/engine` 69 files / 9 352 lines,
   `src/renderer` 125 files / 21 611 lines, `src/shared` 21 files / 2 188 lines, `tests` 56 files /
   14 026 lines.
6. **The IPC surface is 56 channels across four shapes.** `src/shared/protocol/ipc.ts`'s `IPC`
   const has **56** entries. Registration: **30** `handle(...)` calls through `main/ipc/errors.ts`'s
   wrapper, **7** direct `ipcMain.handle`, **1** `ipcMain.on` (the quit-flush ack). Consumption:
   **36** `ipcRenderer.invoke` sites and **38** `ipcRenderer.on/off/send` sites, all inside
   `src/preload/index.ts`. Four distinct patterns must survive any port: request/response
   (`invoke`), main→renderer push (`webContents.send` + `on`), renderer→main fire-and-forget
   (`send` + `ipcMain.on`), and **`MessagePort` transfer**.
7. **The `MessagePort` transfer is architectural, not incidental.** SPEC §4 ("Bulk data skips the
   main process") is implemented as: `main/index.ts` builds a `MessageChannelMain` per
   `did-finish-load`, hands `port1` to the engine via `child.postMessage({kind:'attach-port'},[port])`
   and `port2` to the renderer via `win.webContents.postMessage('kira:port', {generation}, [port2])`;
   `preload/index.ts` relays it out with `window.postMessage({__kira:'port'}, '*', event.ports)`
   because "a MessagePort cannot cross contextBridge directly" (its own comment);
   `renderer/bridge/port.ts` picks it up. Electrobun's documented bridge is **typed RPC between the
   main process and the webview** — there is no published equivalent of transferring a
   `MessagePort` endpoint into a *third* process. Whether bulk pages can bypass the main process at
   all under Electrobun is **the single largest open architectural question** of this phase (D12,
   §8 Q3). `engine/rpc.ts`'s `transfer` argument is already documented as "always undefined today
   … kept as a typed pass-through" — so today's payloads are structured-clone, not zero-copy, which
   softens but does not remove the question.
8. **The engine is an Electron `utilityProcess`, with an Electron-specific memory cap.**
   `main/engine-host.ts` calls `utilityProcess.fork(join(__dirname,'engine.js'), [], {serviceName:
   'kira-engine', stdio:'pipe', execArgv:['--max-old-space-size=' + maxOldSpaceMb]})` — that
   `execArgv` is P12's lever L-E and a user-facing setting (`advanced.engineMemoryCapMb`), and
   `engine/index.ts` talks back over `process.parentPort`. Electrobun has no `utilityProcess`; the
   engine would become an ordinary spawned child with a hand-rolled bidirectional channel, and the
   V8 old-space flag has no meaning under a JSC-based Cottontail runtime at all.
9. **Six DB drivers currently run on Electron's embedded Node — not on Bun, and not on JSC.**
   `pg`, `mariadb`, `mongodb`, `ioredis`, `kafkajs`, `@aws-sdk/client-{s3,sqs}`. SPEC §3 is explicit
   that "Electron runs on its embedded Node — Bun is tooling only." Under Electrobun the engine's
   host runtime becomes Cottontail (JSC) or Bun. Each driver's compatibility under that runtime is
   unverified and is a real risk, not a formality.
10. **Storage would need a driver swap, and one obvious candidate is verified *not* to work.**
    `main/storage/db.ts` is `drizzle-orm/sqlite-proxy` over **`node:sqlite`**
    (`DatabaseSync`/`prepare`, plus a 200-entry statement cache and a narrow `RawDb` escape hatch
    for PRAGMAs and `schema_version`). Measured in this container:

    ```
    $ node sqlitecheck.js   →  node:sqlite OK, rows = 1                            (node v22.22.2)
    $ bun  sqlitecheck.js   →  node:sqlite FAILED: No such built-in module: node:sqlite   (bun 1.3.11)
    ```

    So a Bun-hosted main process needs `bun:sqlite` (or another driver) instead. The good news is
    that `sqlite-proxy` is exactly the seam for that: the nine repos, four migrations and all
    Drizzle schemas are driver-agnostic above it. The bad news is that Cottontail is JSC-based, and
    whether it exposes *any* SQLite is unknown from here (§8 Q4).
11. **The window/menu/lifecycle surface is small but all of it is Electron API.** `main/window.ts`
    (56 lines): `new BrowserWindow` with `webPreferences.preload`/`contextIsolation`/`sandbox`,
    `titleBarStyle:'default'`, restored bounds, `ready-to-show`, `did-finish-load` (the cold-start
    log line `docs/PERF.md` §3 tells a human to grep), debounced `resize`/`move` persistence,
    `loadURL`/`loadFile`. `main/menu.ts` (123 lines, **12** accelerators) is a native `Menu` whose
    items `webContents.send` the `kira:menu:*` channels. `main/index.ts` uses `app.setName`,
    `app.setPath('userData')`, `app.whenReady`, `activate`, `window-all-closed`, and a
    `before-quit` flush handshake with a 2 s timeout.
12. **Logging is `electron-log`.** `main/log.ts` uses `electron-log/main` with a custom
    `resolvePathFn` into `~/.kira-studio/logs/kira-YYYY-MM-DD.log`, a `scope(name)` per subsystem,
    console transport disabled under `NODE_ENV=test`, and a 30-day sweep. `electron-log` requires
    Electron. This is small (45 lines) but it is on the cold-start path, so a replacement's cost
    lands inside the very metric being compared (D6).
13. **Packaging is entirely electron-builder-shaped, and a shell script asserts that it is.**
    `electron-builder.yml` (asar, `asarUnpack: out/main/engine.js` — required because a
    `utilityProcess.fork` entry cannot exec from inside an asar — `identity:'-'` ad-hoc,
    `electronLanguages:['en']`, dmg+zip arm64). `package.json` has `package:mac` /`package:mac:dir`.
    `scripts/verify-packaging.sh`'s checks S1–S5 grep `package.json` and `electron-builder.yml` by
    name, and A3–A5 assert on `dist/mac-arm64/Kira Studio.app`'s ad-hoc signature, unpacked
    `engine.js`, and `CFBundleIdentifier`. None of it survives a runtime change; all of it is out of
    scope for a spike (D14).
14. **Electron itself is fully vendored here and the build works.** `node_modules/electron/dist/electron`
    is a 221 MB binary; `out/main/{index,engine}.js`, `out/preload/index.js` and `out/renderer/`
    are all present from a prior `electron-vite build`. (The binary refuses to *run* as root
    without `--no-sandbox`, which is why the suite runs under `xvfb-run`; `/usr/bin/xvfb-run` is
    present.) The Electron side of any comparison is therefore fully available in this sandbox —
    it is only the Electrobun side that is not.
15. **`docs/PERF.md` §2.2 already records that the memory budget fails, and *why*.** Baseline
    overhead with zero connections and zero tabs is ≈ 620–626 MB (Browser 254.8 + GPU 149.6 +
    NetworkService 81.3 + Tab 134.8), against a 350 MB budget — "Chromium/Electron process
    overhead … not something P12's levers act on," while the app's own loaded delta is only
    ≈ 25–97 MB. **This is the strongest existing argument for even asking the Electrobun
    question**, and it also tells you what the spike must measure: the *baseline*, not the delta.
    A shell that boots an empty window is enough to answer it (D7).

---

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **This phase does not migrate the app.** Its deliverable is this research record plus, if and when the user green-lights §3's Stage 1+, a throwaway measurement spike. The phasing table's "migrate the app off Electron onto Electrobun" is explicitly **not** adopted as the scope. | The table's own qualifier — "comparative, not a one-way door: the deliverable is the measured before/after, not a commitment to ship the migration" — makes the *measurement* the deliverable and the port merely one possible means to it. Reality #5 and #7–#13 put a parity port at ~3 200 lines of main/preload rewritten against an undocumented bridge, plus a new engine host, plus a storage driver swap onto a runtime with unverified SQLite, plus six drivers re-validated on a JSC runtime, plus an entire replacement packaging and test-harness story. That is not a phase; it is a second v1. Meanwhile §0.3 shows the port would still produce **zero** comparable numbers without a new harness — so the port is not even sufficient. |
| D2 | **No Electrobun work is attempted in this sandbox. Full stop.** The blocker is reported to the user as the phase's primary finding rather than worked around. | §0.1. The runtime is not obtainable: two hosts, both 403 at CONNECT, both override knobs exhausted (`DASH_ARTIFACTS_BASE_URL` → `ReadFailed`, `DASH_RELEASE_OFFLINE=1` → `ReleaseMetadataUnavailableOffline`). Vendoring the artefacts by hand would mean hand-assembling a devkit that Hutch's own byte-length + SHA-256 verification is designed to reject, on a runtime nobody in this project has ever run — the resulting numbers would be worthless even if it booted. |
| D3 | If the user green-lights the work elsewhere, the artefact is a **throwaway Electrobun shell**, not a port of `src/main`. It boots a window, loads the **real, unmodified renderer bundle**, proves the bridge on a representative slice (D13), and exposes a timing/RSS probe. It lives at `spike/electrobun/` on its own branch and is deleted, not merged. | A shell answers both questions the decision actually hinges on — baseline RSS (reality #15: the 350 MB failure is ~620 MB of runtime overhead before the app does anything) and cold start — at a small fraction of the cost, and answers them *sooner*, which matters because a bad answer should stop the work early. A parity port would answer them no better: the interaction budgets it would additionally unlock are already comfortably met on Electron (5.6 ms p50 scroll against an 8 ms budget; 1.7/5.3/1.8 ms p50 for the three 50 ms budgets), so they are not where a runtime change would be decided. |
| D4 | **The spike runs on macOS arm64 only.** A Linux run is explicitly not an acceptable substitute, even though Linux is supported and would be easier to arrange. | SPEC §1/§3 scope the product to macOS 13+ arm64; `docs/PERF.md` §3's unfilled packaged-app procedures are macOS. Electrobun's value proposition *is* the system webview — WKWebView on macOS, WebKit2GTK on Linux. Those are different engines with different process models, different memory behaviour and different frame scheduling. A Linux delta would not predict the macOS delta, and presenting one as if it did would be the exact failure mode `docs/PERF.md` §2.1's methodology note warns about: reporting a number that measures the environment rather than the thing under test. |
| D5 | **The comparison set is narrowed to two metrics: cold start and total RSS.** `budgets.spec.ts`'s four interaction budgets and `perf.spec.ts`'s tripwires are **not** part of P20's comparison. | Both surviving metrics are measurable through a runtime-neutral instrument against a shell (D6/D7). The interaction budgets are not: they need a loaded 10 000-row grid, a live Postgres, a populated tree and a second data tab — i.e. the whole app — which is exactly the parity port D1 rules out. They are also, per §2.1, already passing with 1.5–5× headroom, so they carry the least decision weight per unit of effort. |
| D6 | **Build one runtime-neutral harness (`tests/perf/` — new, additive) and re-baseline Electron with it.** RSS from the OS (`ps -o rss=` over the process tree / `/proc/<pid>/status`), start time from wall clock at spawn to a marker the app itself writes on first paint. Both branches measured by this same harness. `tests/ui/*.spec.ts` and `tests/ui/support/measure.ts` are untouched. | §0.3: `app.getAppMetrics()` and `app.evaluate` are Electron-only, so a cross-runtime comparison *cannot* use them. The temptation is to keep Electron's existing numbers as the "before" — that would be comparing `getAppMetrics()`'s Chromium working-set accounting against `ps` RSS, which differ systematically. Re-measuring Electron with the new instrument costs one afternoon and is the only thing that makes the delta real. Keeping `docs/PERF.md` §2 pristine also keeps P12's record intact and comparable to itself. |
| D7 | The spike's scenario is deliberately **the empty baseline**: launch, one window, the real renderer bundle, zero connections, zero tabs. No Docker, no Testcontainers, no live database. | Reality #15 is the whole reason to ask this question: the 350 MB budget fails by ~450 MB, ~620 MB of which is present with nothing open. If Electrobun's empty baseline is not dramatically lower, the migration cannot fix the thing it was proposed to fix and the phase can stop there — one measurement, one decision. If it *is* dramatically lower, that is a strong enough signal to justify funding the much larger loaded-scenario work as a separate, deliberately-scoped phase. It is also the only scenario that runs identically on both runtimes without Docker. |
| D8 | **N ≥ 5 launches per branch per metric, reported as median + min/max (or IQR), alongside a stated minimum detectable difference.** A single number per branch is never reported. Differences smaller than the wider branch's own spread are reported as "not distinguishable," not as a result. | The phasing table demands multiple runs; `docs/PERF.md` §2.1 shows why, in this repo's own history: a p95 that read as a 78 % budget overrun turned out to be a frame-scheduling artefact, proven only by re-measuring under a forced condition. The existing Electron cold-start numbers (589 ms and 640 ms wall for two different scenarios) are the scale a difference must beat to mean anything. |
| D9 | **`docs/PERF.md` gains a new §5 "P20 — Electrobun comparison (different instrument, different runtime)"; §§1–4 are not edited.** If the spike is not run, §5 records the feasibility verdict and stops there. | `docs/PERF.md` describes itself as "expected to be re-measured, not rewritten." Its §2 numbers are Electron-under-`getAppMetrics()` and must stay that, or P12's record stops being comparable to future Electron re-measurements. A clearly-fenced new section says what was compared, with what, on what hardware — and admits what it does not cover. |
| D10 | **The spike branch never merges.** No `package.json` dependency on `electrobun`, no `hutch.config.ts`, no `.hutch/` in the mainline; `.gitignore` gains `.hutch/` and `spike/electrobun/node_modules/` only on the spike branch. | "Comparative, not a one-way door." A dependency on a 45.8 kB bootstrap that pulls an unversioned toolchain from a single vendor's CDN at first use (realities #1–#3) is a supply-chain and reproducibility commitment this repo should not make to answer a question. Keeping it off the mainline keeps the door genuinely two-way. |
| D11 | Storage in the spike is **stubbed, not ported**. The shell boots the renderer against an empty in-memory settings/layout stub. | D7's scenario has no connections, no tabs and no saved layout, so the nine repos and four migrations contribute nothing to the number being measured. Reality #10 says the real port is a `sqlite-proxy` driver swap — a bounded, well-seamed job — but it is a job for a migration, not for a measurement. Doing it in the spike would add the risk of a `bun:sqlite`-vs-`node:sqlite` behaviour difference to a run whose only output is a millisecond count. |
| D12 | The engine process is **out of the spike entirely**. No `utilityProcess` replacement, no driver validation, no `MessagePort` equivalent is built. What the spike produces instead is a **written finding** on whether Electrobun can do a three-process bulk-data channel at all. | Reality #7: transferring a port endpoint into a *third* process is not something Electrobun's documented main↔webview RPC covers, and reality #9 puts six unvalidated drivers behind it. This is the largest architectural unknown in the whole phase and it deserves a real answer — but it is an *architecture* question answered by reading Electrobun's bridge API and writing down what it can and cannot express, not a question a startup-time measurement is going to settle. §8 Q3 escalates it. |
| D13 | The bridge slice the spike **does** prove is exactly three calls, chosen to cover three of reality #6's four patterns: one request/response (`appInfo` — trivially self-contained), one main→renderer push (`settingsChanged` — the shape all 13 `kira:menu:*` channels share), one renderer→main fire-and-forget (`appFlushed`). The fourth pattern — `MessagePort` transfer — is the D12 finding, not a built thing. | Three calls prove that the 56-channel surface is mechanically portable and let a real cost-per-channel be extrapolated, without porting 56 channels. They are also the three that need no storage (D11) and no engine (D12), so the slice stands alone. |
| D14 | **Packaging is out of scope.** No Electrobun bundle is produced, no `verify-packaging.sh` analogue is written, no signing. Measurements are taken against the dev/run output, on both branches, for symmetry. | Reality #13: the packaging story is `electron-builder.yml` + two scripts + a 5-static/5-artifact-check verification script, all Electron-shaped. Building an Electrobun equivalent is weeks and produces nothing the comparison needs. Measuring the *packaged* Electron app against an *unpackaged* Electrobun one would be the D6 mistake in a different costume; measuring both unpackaged is symmetric and honest, and `docs/PERF.md` §3's packaged macOS procedures remain unfilled for both. |
| D15 | **The three Docker-dependent specs stay out of P20's comparison, and their skip is not "fixed."** | They already `test.skip` cleanly when Docker is absent (`isDockerAvailable()` / `DOCKER_UNAVAILABLE_MESSAGE`), which is correct behaviour, and D5/D7 removed them from the comparison on their own merits regardless of Docker. Anyone re-running P20 on a Docker-capable macOS machine gets the Electron half of those numbers for free from the existing suite; the Electrobun half still needs the parity port D1 rules out. |
| D16 | If the spike proceeds, it **pins an exact Electrobun version and records it, plus the paired Hutch and Cottontail versions**, in the results section — and the write-up states the maturity risk explicitly rather than leaving it implied. | Reality #3: 310 npm versions; the 1.x→2.x boundary moved the entire SDK *out of npm* and behind a separate vendor toolchain, within roughly a year. A comparison is a snapshot of one version's behaviour and must be labelled as such. This is also material to the ship/don't-ship decision independent of any number: Electron 43.4.1 is a known, vendorable, reproducible dependency (reality #14 — the binary is sitting in `node_modules`); Electrobun 2.0.1 is not obtainable without live access to one vendor's CDN. |

---

## 3. Implementation order

### Stage 0 — in this sandbox, achievable now (this document)

1. Feasibility investigation. **Done** — §0, with commands and verbatim output.
2. Migration-surface survey. **Done** — realities #4–#14.
3. This plan committed to `docs/plans/`. Nothing installed, nothing added to `package.json`,
   nothing committed from the throwaway `bun add electrobun` (removed; the Hutch bootstrap cached
   under `~/.hutch/` is outside the repo and touches nothing tracked).
4. `docs/SPEC.md` §10's P20 row updated from "Not yet implemented" to point at this plan and state
   the blocker. **No other SPEC edit.**
5. **Stop.** Await §8.

### Stage 1 — prerequisites, on the target machine (blocked on §8 Q1/Q2)

6. macOS 14+ arm64 (Electrobun's own floor; note it is above SPEC §3's macOS 13), unrestricted
   egress to `hutch.blackboard.sh` and `electrobun-artifacts.blackboard.sh`, Xcode CLT, Bun.
7. Reproduce §0.1's chain to the point of success: `bun add electrobun@<pinned>` →
   `bun x electrobun init` → a stock template that builds and runs. **If this fails, stop and
   report** — the same way §0 stopped. Record versions per D16.
8. Read Electrobun's bridge/RPC API and its process model and write the D12 finding: can a third
   process hold one end of a bulk channel, or must all data pass through main? Answer this
   **before** step 9 — a "no" changes the entire architecture question and may end the phase.

### Stage 2 — the neutral harness (independently useful; do this before any Electrobun code)

9. `tests/perf/` — new directory, additive, no edits to `tests/ui/`. A launcher that spawns an app
   under test, waits for a first-paint marker, records wall-clock ms, then samples summed RSS over
   the process tree from the OS at a fixed cadence, N times.
10. Re-baseline **Electron** with it: D7's empty scenario, N ≥ 5. Compare the shape (not the
    values) against `docs/PERF.md` §2.1's 589/640 ms and §2.2's ~739 MB baseline as a sanity check,
    and record the systematic offset between `ps` RSS and `getAppMetrics()` working-set. This is
    the "before" half of every P20 number.

### Stage 3 — the spike (blocked on step 8's answer)

11. `spike/electrobun/` on branch `spike/p20-electrobun`: minimal Electrobun app, window sized like
    `main/window.ts`'s defaults, loading the **unmodified** `out/renderer/` bundle produced by the
    existing `electron-vite build`. Storage stubbed (D11), engine absent (D12).
12. The D13 bridge slice: three calls, one per pattern, shimmed behind the same `window.kira`
    shape the renderer already expects — so the renderer bundle needs no edit. Record what each
    cost in lines and in awkwardness; that is the extrapolation input for a real port's cost.
13. Measure with the Stage 2 harness, N ≥ 5, same machine, same session, alternating branches to
    spread thermal/background drift across both.

### Stage 4 — the deliverable

14. `docs/PERF.md` §5 (D9): instrument description, machine, versions (D16), both distributions,
    the minimum detectable difference, and an explicit list of what was **not** measured (interaction
    budgets, loaded-scenario RSS, packaged app, engine-process behaviour, driver compatibility).
15. A written recommendation with three possible shapes, chosen on the numbers: *not worth
    pursuing* / *worth a scoped follow-up phase to answer D12's architecture question properly* /
    *worth a real migration phase, whose cost is then re-estimated against realities #5–#13*.
16. Delete `spike/electrobun/`; the branch is never merged (D10).

---

## 4. Explicitly out of scope

- **Migrating the application.** `src/main` (46 files), `src/preload`, `electron.vite.config.ts`,
  `electron-builder.yml`, `package:mac`/`package:mac:dir` and `scripts/verify-packaging.sh` are not
  touched by this phase, on any branch that could merge (D1, D10).
- **Any Electrobun work in this sandbox** (D2) — the runtime is unobtainable here (§0.1).
- **A Linux spike** (D4), even though Linux is supported and would be cheaper to arrange. The
  product is macOS-only and the webview differs.
- **`budgets.spec.ts`, `perf.spec.ts`, `memory.spec.ts`, `startup.spec.ts`,
  `tests/ui/support/measure.ts` and `tests/ui/fixtures.ts`** — not edited, not ported, not made
  runtime-agnostic (D6). The new harness is additive and lives in `tests/perf/`.
- **The interaction budgets** (scroll response, cell→editor, tab switch, tree expand) as P20
  comparison metrics (D5). They need the whole app and they already pass with wide margins.
- **The loaded 5-connection/10-tab memory scenario** (D7). It needs Docker, Testcontainers and six
  working drivers on the new runtime; the empty baseline is where the ~620 MB lives anyway.
- **The engine process, the six drivers, and `MessagePort`-based bulk transfer** (D12) — a written
  architectural finding, not an implementation.
- **SQLite/storage** on the new runtime (D11); the `bun:sqlite`-vs-`node:sqlite` gap is documented
  (reality #10) but not bridged here.
- **Packaging, signing, notarization, bundle-size comparison, auto-update** (D14).
- **Electrobun 1.x** (reality #3). A superseded major whose distribution model the vendor already
  abandoned is not a migration target, and its assets could not be located from here anyway.
- **Any change to `docs/PERF.md` §§1–4, or to any budget in SPEC §2** (D9). P20 measures; it does
  not relax.
- **A recommendation for or against Electrobun in the absence of numbers.** This document reports
  what is and is not feasible. It does not pre-judge the outcome of a measurement it could not take.

---

## 5. Target tree

### At the end of Stage 0 (what this phase produces now)

```
docs/
  plans/P20-electrobun-spike.md   NEW  this document
  SPEC.md                         MOD  §10 P20 row -> points here, states the sandbox blocker
```

Nothing else. No `package.json` change, no lockfile change, no `src/` change, no `tests/` change.

### At the end of Stage 4 (only if §8 unblocks the work, on a suitable machine)

```
tests/perf/                       NEW  runtime-neutral harness (D6) — additive; tests/ui/ untouched
  launch.ts                       NEW  spawn an app under test, wait for first-paint marker, time it
  rss.ts                          NEW  summed RSS over the process tree, from the OS
  report.ts                       NEW  N runs -> median/min/max + minimum detectable difference (D8)
  electron.perf.ts                NEW  the Electron "before" half, D7's empty scenario
spike/electrobun/                 NEW  throwaway, branch-only, deleted at step 16 (D3, D10)
  ...                                  minimal shell + D13's three-call bridge slice
docs/
  PERF.md                         MOD  new §5 only; §§1-4 untouched (D9)
  plans/P20-electrobun-spike.md   MOD  results appended, or the "did not proceed" record
tests/ui/**                        --  UNCHANGED (deliberately — D6)
src/**                             --  UNCHANGED (deliberately — D1)
electron-builder.yml               --  UNCHANGED
scripts/verify-packaging.sh        --  UNCHANGED
package.json                       --  UNCHANGED on any mergeable branch (D10)
```

---

## 6. Acceptance checklist

### Stage 0 (this phase, now)

- [x] Feasibility established **empirically**, not from documentation: `bun add electrobun`
      succeeds; `bun x electrobun --version` fails with
      `hutch: could not resolve Cottontail: ReleaseDownloadFailed`; `bun x electrobun init` fails
      with `electrobun: Hutch installer returned HTTP 403`.
- [x] The blocking hosts identified from the tool's own source and confirmed by probe:
      `hutch.blackboard.sh` and `electrobun-artifacts.blackboard.sh`, both
      `curl: (56) CONNECT tunnel failed, response 403`.
- [x] Both documented override paths tried and shown not to help
      (`DASH_ARTIFACTS_BASE_URL` → `ReadFailed`; `DASH_RELEASE_OFFLINE=1` →
      `ReleaseMetadataUnavailableOffline`).
- [x] Linux support settled from the vendor's own artefact index, not assumed: `linux-x64` and
      `linux-arm64` present in `hutch-artifacts.json`; the linux-x64 Hutch archive downloads and
      verifies here; `libwebkit2gtk-4.1-0` absent but installable from a reachable archive. Linux
      is **not** the blocker.
- [x] Docker confirmed unavailable (`dial unix /var/run/docker.sock: connect: no such file or
      directory`), so only `startup.spec.ts` of the four is runnable here even on Electron.
- [x] The Playwright/`getAppMetrics` harness dependency identified as an Electron-bound blocker
      independent of the network (§0.3).
- [x] Migration surface quantified against the tree: 11 `'electron'`-importing files (one
      type-only, in the engine), 2 990 + 208 lines of main/preload, 56 IPC channels, 38 handler
      registrations, 36 invoke sites, 38 event sites, plus the `MessagePort` architecture.
- [x] `node:sqlite`-under-Bun tested rather than assumed (fails; Node 22 passes).
- [x] Nothing installed into the repo, nothing committed, nothing pushed; the throwaway
      `bun add electrobun` worktree removed.
- [ ] `docs/SPEC.md` §10's P20 row updated to point at this plan and name the blocker.
- [ ] User has answered §8 before any Stage 1 work begins.

### Stages 1–4 (only if unblocked)

- [ ] Electrobun bootstraps on the target machine; exact `electrobun` / Hutch / Cottontail versions
      recorded (D16).
- [ ] The D12 architecture finding is written **before** any spike code is built, and explicitly
      answers whether a third process can hold a bulk-data channel endpoint.
- [ ] `tests/perf/` exists, is additive, and `tests/ui/` shows a clean `git diff` (D6).
- [ ] Electron is re-baselined with the new instrument, and the systematic offset from
      `getAppMetrics()` is recorded (D6).
- [ ] The spike loads the **unmodified** `out/renderer/` bundle — the renderer needs no edit for the
      shell to boot (D3/D13).
- [ ] Both branches measured N ≥ 5, alternating, same machine, same session; results reported as
      distributions with a stated minimum detectable difference; any difference smaller than the
      spread is reported as "not distinguishable" (D8).
- [ ] `docs/PERF.md` gains **only** a new §5; §§1–4 byte-identical (D9).
- [ ] The write-up lists what was not measured, in full (§4).
- [ ] `spike/electrobun/` deleted; the branch is not merged; `package.json` on the mainline never
      referenced `electrobun` (D10).

---

## 7. If the numbers come back good — what P20 still would not have answered

Recorded here so a favourable startup/RSS result is not mistaken for a green light, and so the
follow-on phase's real cost is visible at the moment the decision gets made:

1. **Can bulk data still bypass the main process?** (reality #7, D12.) SPEC §4 makes this
   architectural. If Electrobun cannot express it, every result page routes through main, and P12's
   whole "silky UI" story needs re-deriving from scratch.
2. **Do the six drivers run on Cottontail/Bun?** (reality #9.) Six drivers × seven engines' worth of
   adapter behaviour, currently validated by 56 test files / 14 026 lines that themselves assume
   Node and Electron.
3. **Does the runtime have usable SQLite?** (reality #10.) `sqlite-proxy` is the seam, so this is a
   driver swap on Bun — but it is an unknown on JSC.
4. **Does the renderer behave the same on WKWebView?** 21 611 lines of Vue plus CodeMirror 6 plus
   Tailwind v4, and a virtual-scrolling `DataGrid` whose overscan and page sizes were tuned in P12
   against Chromium's frame scheduling.
5. **Native chrome parity.** `titleBarStyle:'default'`, the 12-accelerator native menu, window
   bounds persistence, macOS `activate`/`window-all-closed` conventions, the `before-quit` flush
   handshake (reality #11).
6. **Packaging, ad-hoc signing, and a `verify-packaging.sh` equivalent** (reality #13).
7. **Supply-chain posture.** Electron ships as a vendored 221 MB binary in `node_modules`
   (reality #14). Electrobun requires live access to one vendor's CDN at build time, mediated by a
   second tool (Hutch) on its own release cadence, with a major-version boundary in recent memory
   that removed the SDK from npm entirely (reality #3).

---

## 8. Open questions for the user

1. **Is there a machine available for this at all?** The phase needs macOS 14+ arm64 (Electrobun's
   floor, above SPEC §3's macOS 13) with unrestricted egress to `hutch.blackboard.sh` and
   `electrobun-artifacts.blackboard.sh`. `docs/PERF.md` §3 already records that no macOS hardware
   has been available to this project for P12's manual procedures. **If the answer is no, P20
   should be marked blocked-on-hardware and the phase closed at Stage 0** — this document is then
   the deliverable, and that is a legitimate outcome rather than a failure.
2. **Is the scope reduction acceptable?** D1/D3/D5/D7 replace "migrate the app and run the full
   perf suite on both branches" with "build a throwaway shell and compare cold start and baseline
   RSS through a neutral instrument." This is a deliberate reinterpretation of the phasing table,
   justified by §0.3 (the full suite *cannot* run against a non-Electron build) and by the table's
   own "comparative, not a one-way door." If the intent was genuinely a full port, that is a
   multi-phase programme and should be planned as one, not as P20.
3. **How much does D12's bulk-data question matter to the decision?** If Electrobun turns out not
   to support a third process holding a channel endpoint, SPEC §4's core architecture does not
   survive the move regardless of how good the RSS number is. Should that question be answered
   *first*, on its own, before any measurement work — possibly making the measurement moot?
4. **Would a cheaper experiment answer the real question?** The motivation is reality #15: ~620 MB
   of Chromium overhead with nothing open. A ~50-line "hello world" in Electrobun measured against
   a ~50-line "hello world" in Electron would bound the ceiling of any possible saving in an
   afternoon, with none of D3's bridge work. If that gap turns out to be small, P20 ends there. Is
   that the preferred first move?
5. **Is `tests/perf/` (D6) wanted independently of Electrobun?** A runtime-neutral, OS-level
   startup/RSS harness is useful on its own — it is the only way to measure the *packaged* macOS
   app that `docs/PERF.md` §3 still has as an unfilled manual procedure. It could be built and
   landed on the mainline as a small standalone phase whether or not Electrobun is ever tried.
6. **Should SPEC §10's P20 row be rewritten to match this plan's scope, or left verbatim with a
   pointer here?** Stage 0 step 4 assumes the latter (minimal edit: point at this plan, state the
   blocker). Rewriting the row is the alternative if the reduced scope in D1 is accepted as the
   phase's real definition.
