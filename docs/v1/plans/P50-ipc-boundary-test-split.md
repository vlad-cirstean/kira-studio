# P50 — Splitting `tests/ui/`'s adapter specs at the IPC boundary

> **The phase, in the user's own words:**
>
> > *"Take the current ui tests and split them between be and fe tests. Leave like 2-3 full ones that
> > prove the full app still works, but all the rest split at the ipc level. But there is one vital
> > rule, the ipc mocks are in the exact same file/folder. So the backend part output si validated by
> > the same file that is used as input for the frontend only. Now consider if the be will be part of
> > the current db suite or not. Also consider running tests paralelised if they don't flake."*
>
> **And in SPEC.md:1073's own framing** — *"the current per-adapter `tests/ui/` specs conflate two
> different things behind one Electron launch … so a frontend-only regression can only be caught by
> paying for a full adapter+Electron run, and a backend contract drift can hide behind a frontend
> mock that nothing keeps in sync."* The row names the binding rule the same way: *"the mock payload
> a frontend test injects and the fixture a backend test's real response is checked against live in
> the same file, in the same folder, so the backend test is what keeps the frontend's mocked contract
> honest."*
>
> **Two questions the row explicitly defers to this plan**, both resolved below with evidence rather
> than by default: whether the new backend tier joins `tests/db/` (**D1** — no, and for a mechanical
> reason, not a taste one), and whether the new tests can run in parallel without flaking (**D2** —
> the frontend tier yes, measured; the backend tier no, and the reason is in the container helpers).
>
> **Everything load-bearing in this plan was run, not reasoned about.** The whole mocking mechanism
> — both IPC halves — was built as a throwaway Playwright spec against the tree at `b1e6eae`, run for
> real under `xvfb-run`, and deleted. So was the backend tier's execution model, run under
> `ELECTRON_RUN_AS_NODE=1 electron` against a real temp-file SQLite database. So was the
> parallelisation question, measured at four concurrent Electron apps × five repeats. The four
> measured results are quoted in §1 and §6; two of them **contradict** the assumption the phase brief
> started from (F1, F5), which is exactly why they were run.
>
> **Branch tip when this plan was written: `b1e6eae` on `claude/split-ui-tests-be-fe-yrw277`**
> (`62798be` on `feature/kickoff` plus the `docs(spec)` commit that queued this row);
> `git status --porcelain` over the repo was empty apart from this file. Re-grep before editing.

---

## 0. Ground rules for this phase

- **Ten spec files are in scope, and only ten.** `tests/ui/{sqlite,redis,mongo,mariadb,mysql,
  clickhouse,rabbitmq,s3,sqs,kafka}.spec.ts` — the per-adapter specs SPEC.md:1073 enumerates by name.
  The other twenty-one spec files under `tests/ui/` are **not touched** (§7 says why, and hands the
  question forward rather than pretending it was never asked).
- **No production code changes at all.** Not one line under `src/`. The mocking mechanism §6 lands on
  needs none — it was chosen, in part, *because* it needs none, and that was verified by building it.
  If implementing a split turns up a real defect, write it up in §9 and leave it; a green new test
  that passes only because a fix rode along with it proves nothing about the fix (P44 D51).
- **`tests/db/` is not edited, in either direction.** No file added, moved out, or changed —
  including `support/*` and `fixtures/*`, which the new tier **imports** exactly as
  `tests/electron-db/kafka.spec.ts:18-21` already does. `git diff --name-only` for this whole phase
  must show **zero** paths under `tests/db/`. This is not deference to P44 D49 for its own sake: the
  container helpers' memo/reset discipline is what P29 D14 depends on for per-spec-file container
  isolation, and it is fragile enough that P36, P37 and P29 each wrote out its reasoning separately
  rather than trust it from memory.
- **Every scenario in a split spec must land somewhere.** For each of the seven specs that split,
  §4's table accounts for every one of its assertions as backend, frontend, or explicitly dropped
  with a reason. A spec is deleted only in the same commit that lands both of its halves. "It was
  covered elsewhere" is a claim that needs a `file:line`, not a shrug.
- **The fixture module is the single source of truth, and nothing else may be mock data.** No
  frontend spec may hand-roll a payload, inline a literal page, or import mock data from anywhere but
  its own adapter folder's fixture module. The acceptance checklist (§8) makes this greppable.
- **The fixture is generated from a real backend run, never hand-written** (D5). §1 F2 is the
  evidence: a hand-written fixture in this very planning session was *silently wrong* in a way the
  app rendered rather than rejected.
- **No new dependency.** `node:test`/`node:assert/strict` for the backend halves (the
  `tests/electron-db/` precedent), `@playwright/test` for the frontend halves, `esbuild` for the
  bundle — all already in `package.json`. One new shell script under `scripts/`, mirroring
  `native-electron-build.sh` and `verify-packaging.sh`.
- **No new tsconfig project.** Both halves are Node/Electron-typed, so `tests/ipc/**/*.ts` joins
  `tsconfig.node.json`'s `include` beside the `tests/ui/**/*.ts` entry that is already there
  (`tsconfig.node.json:22`). This is a deliberate simplification against P44's route, and D8 records
  why it is safe here and was not there.
- **`bun run lint`, `bun run typecheck` (all five projects) and `bunx electron-vite build` stay green
  after every commit.** Conventional Commits, one per step of §5.

---

## 1. Findings

F-numbers and D-numbers are local to this plan, per P47/P48/P49's convention.

### A. What the IPC boundary actually is in this app — and why "one boundary" is wrong

**F1 — there are two IPC surfaces, they reach two different processes, and only one of them goes
through `src/main/ipc/*` at all.** The phase brief treats "the IPC level" as one thing. The tree does
not:

| | Control channel | Bulk-data channel |
|---|---|---|
| Renderer entry | `src/renderer/bridge/control.ts:44-166` (`window.kira.*`) | `src/renderer/bridge/data.ts:38-66` → `bridge/port.ts:77-97` |
| Transport | `contextBridge` → `ipcRenderer.invoke` (`src/preload/index.ts:48-155`) | a real `MessagePort` (`preload/index.ts:159-161`) |
| Lands in | **the main process**, `ipcMain.handle` (`src/main/ipc/*`) | **the engine utility process**, directly |
| Reaches | `TreeService`, `ConnectionsService`, storage repos, then `engineHost.call()` | `src/engine/rpc.ts`'s `dispatch` → `src/engine/data.ts` |
| Channel names | `src/shared/protocol/ipc.ts:20-87` (`IPC`) | `src/shared/protocol/data-ops.ts:10-26` (`DATA_OP`) |

`src/main/index.ts:129-137` is the wiring that makes the second one bypass main entirely: a
`MessageChannelMain`'s two ends go to the engine (`engineHost.attachRendererPort`) and to the
renderer (`win.webContents.postMessage('kira:port', …)`), on every `did-finish-load`.
`data-ops.ts:7-9` states the rule in its own words: *"result pages travel renderer↔engine over the
MessagePort, never through main."*

**Consequence for this phase, and it shapes everything below:** a "backend IPC test" and a "frontend
IPC mock" each have to cover *both* surfaces, by two different techniques, because the two surfaces
have nothing in common but the word IPC.

**F2 — the `src/main/ipc/*` handlers hold almost no logic; the interesting behaviour is one layer
behind them.** All thirteen files were read. Every handler is `schema.parse(payload)` followed by a
single delegate call — `tree.ts:20-35`, `connections.ts:15-45`, `queries.ts:51-86`, `ops.ts:12-19`,
`filters.ts:15-22`, `tabs.ts:11-15`, `layout.ts:8-9`, `settings.ts:9-23`, `app.ts:6-12`,
`engine.ts:6`, `files.ts`. The only original logic in the whole directory is `errors.ts:8-15`'s
`[CODE] message` folding.

What a fixture actually has to pin therefore lives in:

- **`src/main/tree-service.ts:82-148`** — the L1 cache-aside that decides `source: 'cache' | 'server'`,
  and P43 iter2 D22/iter3 D38's rule that a truncated listing is dropped rather than cached
  (`:105-107`).
- **`src/engine/control.ts:161-177`** — `handleFrame`, the `PortResponse` envelope and `toWireError`.
  Plus `handleChildren:92-94`, which emits `truncated` *only when the adapter said so* — the exact
  shape difference a frontend mock would guess wrong.
- **`src/engine/rpc.ts:56-87`** — `dispatch`, the other envelope, including the `E_UNSUPPORTED`
  unknown-op branch and the `code` extraction at `:74`.
- **`src/engine/data.ts:33-76`** — `handleRead`'s L2 cache-aside (`source: 'server'` then `'cache'`),
  `:78-111`'s L3 count cache with its `stale`/`at`/`exact` envelope, and `:128-157`'s
  `invalidateAfterMutation` in a `finally` (P43 F12/D17).

**None of that is reachable from `tests/db/`.** `tests/db/*.spec.ts` instantiates adapters directly
via `src/engine/adapters/registry.ts` (`tests/db/postgres.spec.ts:12`) and calls `adapter.read(...)`.
It never touches `src/engine/rpc.ts`, `src/engine/cache.ts`, `src/main/tree-service.ts`, or either
envelope. That gap is the new tier's entire subject.

**F3 — `ipcMain` itself cannot be driven outside a real Electron browser process, and re-testing it
would buy nothing anyway.** `src/main/ipc/errors.ts:2` and five sibling files import `ipcMain` from
`electron`. Under `ELECTRON_RUN_AS_NODE=1 electron` — the runtime `tests/electron-db/kafka.spec.ts`
established, and the only one that can load the Kafka driver (ARCHITECTURE.md:199-206) — `electron`
resolves to a path string, so `ipcMain` is `undefined` and `registerIpc()` throws on its first
`handle()`.

This is a real limit and the plan states it rather than routing around it: **the backend tier's
boundary is the payload that crosses the IPC surface, not Electron's own `ipcMain` plumbing.** The
payload is produced verbatim by `TreeService` / `handleFrame` / `dispatch`, all three of which are
plain functions with no `electron` import (`grep -rn "from 'electron'" src/main/ src/engine/` →
`tree-service.ts`, `connections.ts`, `storage/**` and `engine/{control,rpc,data,cache}.ts` are all
absent from the results). And `ipcMain.handle`'s own registration is still exercised on every run of
the three full-E2E specs §4 keeps, so nothing is lost.

### B. What was actually built and run while writing this plan

Four throwaway probes, all against the tree at `b1e6eae`, all deleted afterwards
(`git status --porcelain` empty before this file was written). Two of them overturned an assumption
the brief started from.

**F4 — `window.kira` is deeply frozen and non-configurable. Renderer-side monkey-patching of the
control channel is impossible, and the brief's suggested mechanism does not work.** Measured, in the
real app under `xvfb-run`:

```
frozen:                    true
descriptor of window.kira: {"value":{},"writable":false,"enumerable":true,"configurable":false}
w.kira.treeChildren = fn:  silently no-ops (assignment took: false)
defineProperty(w.kira,…):  TypeError: Cannot redefine property: treeChildren
defineProperty(window,…):  TypeError: Cannot redefine property: kira
```

Two independent reasons it could never have worked, either way. `contextBridge.exposeInMainWorld`
(`src/preload/index.ts:155`) installs a non-writable, non-configurable, frozen object — that is the
measurement above. And even if it were writable, `src/renderer/bridge/control.ts:34` reads
`const kira = window.kira;` **at module scope**, so every `control.*` call is already bound to the
original object before any test can run. Re-pointing `window.kira` would change nothing.

**F5 — swapping `ipcMain` handlers from the main process works, takes effect immediately, and the
repo already does exactly this on a smaller scale.** Measured: `electronApp.evaluate(({ ipcMain }) =>
{ ipcMain.removeHandler(ch); ipcMain.handle(ch, fn); })` followed by `page.reload()`, and the tree
rendered the fixture connection — *"Fixture Postgres"*, one tree row — with no engine, no adapter and
no database anywhere.

This is not a new technique in this repo, which matters for how load-bearing it is allowed to be:
`tests/ui/s3.spec.ts:314-318` already stubs `dialog.showSaveDialog` through
`kira.app.evaluate(({ dialog }) => …)`, with the comment *"the only way to test a native dialog
Playwright cannot click — stub it in the main process so filesChooseSave's IPC handler returns a path
we control."* This phase generalises one file's trick to the whole control channel.

**F6 — the bulk-data port can be replaced from the renderer with nothing but public DOM API, because
the production code already has that seam.** `src/renderer/bridge/port.ts:29-42` listens for a
`window` `message` event carrying `{ __kira: 'port' }` and, on each one, **closes the old port,
rejects everything pending, and adopts the new one** — the seam that exists so *"a renderer reload or
an engine restart re-attaches a fresh port"* (`:35-36`). A test can therefore create its own
`MessageChannel` in the renderer and post it through the same door.

Measured, end to end, in a real Electron window: control handlers swapped in main (F5), then a
renderer-side `MessageChannel` whose `port2` answers `data:read` with a hand-built `TabularPage`.
Double-clicking the table row rendered the real grid with the fixture's rows — `101` /
`alpha-fixture` — and the fake port's op log read `["data:read"]`. **3.2 s, no container, no adapter,
no network.** The equivalent Docker-backed spec carries a 240 s timeout
(`tests/ui/mariadb.spec.ts:13`).

One ordering fact the probe established that a reading would have missed: `page.reload()` makes main
hand the renderer a **real** port again (`src/main/index.ts:131`, on `did-finish-load`), so the fake
port must be attached *after* the last load, not before. The probe got this wrong on its first
attempt and the plan carries the correction into §6.

**F7 — a hand-written fixture was silently wrong, and the app rendered the mistake instead of
rejecting it.** The first version of the probe gave a tree node a `path` shaped like `ENGINE_OP`'s
own payload — `{ connectionId, segments: [...] }`. The real wire shape is an encoded **string**
(`src/shared/domain/tree.ts:78`, `path: z.string()`). Nothing threw at the boundary. What happened
instead:

```
tree row: { kind: "database", path: "[object Object]", text: "fixturedb\nAn object could not be cloned." }
```

— a rendered row with a garbage path and a contextBridge clone failure baked into its label, i.e. a
frontend test that would have "passed" against a shape the backend never produces. This is precisely
the drift the user's vital rule exists to prevent, reproduced by accident in the first hour of
planning. It is the single strongest argument in this plan, and it is why D5 makes fixtures
**generated**, never authored.

For contrast, the backend probe printed the true shape on its first run, from the real engine:

```
ORDER_ITEMS NODE: {"kind":"table","name":"order_items","path":"database:main/table:order_items","hasChildren":false}
```

**F8 — the backend tier runs, for real, in this sandbox, and reaches assertions `tests/db/` cannot
make.** A throwaway `node:test` spec was esbuild-bundled (`--platform=node --format=cjs
--external:electron`) and run under `ELECTRON_RUN_AS_NODE=1 electron` against a real temp-file SQLite
database from `tests/db/support/sqlite.ts`. It drove the real `handleFrame` (connect, two `children`
frames) and the real `dispatch` (two `data:read` frames):

```
ROOT NODES:        ["database:main"]
ORDER_ITEMS NODE:  {"kind":"table","name":"order_items","path":"database:main/table:order_items","hasChildren":false}
COLUMNS:           ["id","order_id","product_id","quantity"]
SOURCE: server     POSITION: {"offset":0,"pageSize":100,"hasMore":false,"nextToken":null,"prevToken":null,"strategy":"keyset"}
ROWS:              [["1","1","1","2"],["2","1","2","1"],["3","2","1","5"]]
SECOND READ SOURCE: cache
✔ 1 pass, 0 fail, 1152ms
```

The last line is the point. `SECOND READ SOURCE: cache` is an assertion about `src/engine/data.ts:39-42`
and `src/engine/cache.ts` — **a layer `tests/db/sqlite.spec.ts` structurally cannot reach**, because
it calls `adapter.read()` and the cache sits above the adapter. Same for `position.strategy:
'keyset'`, which is `sql-text.ts`'s pagination shaping as it appears *on the wire*, not as the
adapter's return value.

Two harness facts the run established:

1. **`src/engine/control.ts:10-12`'s `emit()` calls `process.parentPort.postMessage`**, and
   `wireScheduler` binds it at module scope (`:14-17`). Outside a utility process there is no
   `process.parentPort`, so the harness must install a two-method stub *before* the module is
   imported — which means a dynamic `import()` inside the test body, not a static one. (esbuild's CJS
   output rejects top-level `await`; the probe hit that and moved the imports into the test.)
2. **Bundling moves `__dirname`.** `tests/db/support/sqlite.ts:7` resolves
   `../fixtures/0009_sqlite_seed.sql` relative to `__dirname`; from a bundle at `out/tests/…` that
   becomes `out/fixtures/…` and the run fails `ENOENT`. Copying `tests/db/fixtures` to the sibling of
   the bundle's own directory fixes it with **no edit to `tests/db/`** — verified, and §5 commit 1
   folds the copy into the runner script. Only the five `.sql`-reading helpers are affected; the six
   `.ts` seed modules are imported and therefore bundled.

**F9 — four concurrent real Electron apps, fully parallel, twenty runs, zero flakes.** Measured with
four copies of the mocked-IPC probe:

```
$ playwright test <4 specs> --workers=4 --fully-parallel                  →  4 passed (8.4s)
$ playwright test <4 specs> --workers=4 --fully-parallel --repeat-each=5  → 20 passed (25.6s)
```

Nothing in the mocked tier contends: `tests/ui/fixtures.ts:29-33` already gives every test its own
`mkdtemp` `KIRA_HOME`, and `src/main/index.ts:24-26` puts Chromium's own `userData` (and therefore
its singleton lock) *inside* that directory, so two concurrent apps share no profile, no lock file
and no port — the mocked tier opens no socket at all.

**F10 — Playwright 1.62.1 supports a per-project `workers` limit, so this needs one config, not
two.** Checked against the installed typings
(`node_modules/playwright/types/test.d.ts:752`, inside `interface TestProject` at `:106`, with the
doc comment *"workers limit for this project"*) and then measured with a scratch two-project config:

```
serial project (workers: 1):  841583→841984 → 842004→842405 → 842437→842838 → 842858→843259   (strictly sequential)
par    project (workers: 4):  841577, 841584, 841594, 842004                                   (overlapping)
8 passed (2.7s)
```

### C. Why the current suite is serial, and which of those reasons the new tier inherits

**F11 — three distinct reasons hold `playwright.config.ts:5-6` at `fullyParallel: false, workers: 1`,
and the mocked tier inherits none of them.**

1. **Timing and RSS budgets.** `budgets.spec.ts` asserts p50/p95 interaction budgets (`:62`, `:94`),
   `perf.spec.ts` a rAF tripwire and retained-byte symmetry (`:10-14`), `memory.spec.ts` the §2.2 RSS
   budget, `startup.spec.ts` cold start, `leaks.spec.ts` a 600 s leak sweep. Concurrent Electron apps
   contend for CPU and RAM; these would flake, and a flaky budget is worse than no budget.
2. **Container cost and per-file isolation.** P29 D14 states the dependency in as many words:
   *"`playwright.config.ts:6-7` runs `workers: 1, fullyParallel: false`, and
   `tests/db/support/postgres.ts:91-97`'s `stop()` resets the module memo, so each UI spec file gets
   its **own** container — a table created in `budgets.spec.ts` cannot be seen by `tree.spec.ts`."*
   Every helper is a module-scope memo with a reset in `stop()` — `support/mariadb.ts:28-33,144-150`,
   `support/redis.ts:27-32,78-84`, `support/sqlite.ts:37-42,105-111` — each carrying the same comment
   naming `workers:1` as the reason.
3. **`fullyParallel: true` would be actively wrong for the existing specs**, independent of cost: it
   parallelises tests *within* a file, and every Docker-gated spec starts its container in a
   `beforeAll` that the whole file shares.

Correctness under file-level parallelism (`workers: N`, `fullyParallel: false`) is actually fine —
each Playwright worker is its own OS process with its own module registry and therefore its own memo
and its own container — but reason 1 is decisive on its own, and reason 2 makes it expensive.

**F12 — `bun test` runs a directory's spec files in one process, which is a second, independent
reason the backend tier must not go into `tests/db/`.** P44 D53 records the behaviour (*"Bun runs a
directory's spec files in one process"*) and it is why the memo pattern works there at all. But the
engine carries module-level singletons of its own — `src/engine/cache.ts`'s `cache` and
`src/engine/adapters/live.ts`'s live-adapter map — and the new tier's whole subject is those
singletons' behaviour. Folding it into `tests/db/` would have a `postgres.spec.ts` adapter run and an
IPC-tier `dispatch` run sharing one L2 cache and one live-adapter registry inside one process. That
is not a preference; it is cross-contamination between a suite that asserts cache hits and a suite
that has never heard of the cache.

---

## 2. Shapes introduced in this plan

### 2.1 The directory — both halves and the fixture, in one folder per adapter

The user's vital rule is a **colocation** requirement, and it is satisfied literally: backend spec,
frontend spec and the fixture they share are three files in one directory, and the fixture is the
same imported module in both.

```
tests/ipc/
  support/
    harness.ts         # backend: process.parentPort stub, in-process EngineHost, temp KIRA_HOME db
    decode.ts          # backend: Page -> LogicalPage, over @shared/protocol/page's own cellText/isNull
    capture.ts         # backend: KIRA_IPC_FIXTURES=write -> rewrite the fixture module (D5)
    mockControl.ts     # frontend: installControlMocks(app, fixture) — the main-process ipcMain swap
    mockPort.ts        # frontend: installMockPort(page, fixture) — the renderer MessageChannel
    types.ts           # the fixture vocabulary both halves import (below)
    harness.spec.ts    # Docker-free self-test of the whole loop (§5 commit 1)

  mariadb/
    mariadb.fixture.ts        # THE shared file — generated, committed, reviewed as a diff
    mariadb.backend.spec.ts   # node:test, ELECTRON_RUN_AS_NODE=1 electron
    mariadb.frontend.spec.ts  # @playwright/test, real Electron UI, both IPC halves mocked
  redis/    …
  mysql/    …
  clickhouse/ …
  rabbitmq/ …
  sqs/      …
  kafka/    …
```

Naming carries the runner split: `*.backend.spec.ts` is bundled by the shell runner,
`*.frontend.spec.ts` is matched by Playwright's `ipc-frontend` project. Nothing else distinguishes
them, and a file in the wrong runtime fails immediately and legibly (`node:test` has no
`@playwright/test`, and vice versa).

### 2.2 The fixture vocabulary (`tests/ipc/support/types.ts`)

A fixture is **logical**, not binary (D6). `TabularPage` and its siblings are three typed arrays per
column (`src/shared/protocol/page.ts:47-53`); a fixture that stored those would be an unreviewable
blob whose drift is invisible in a diff, and it would have to survive Playwright's own `evaluate`
argument serialisation. Rows of decoded text survive both trivially.

```ts
/** One control-channel snapshot: the args that produce it, and the response, verbatim. */
export interface ControlSnapshot<T> {
  channel: string;            // a value from shared/protocol/ipc.ts's IPC map
  args: unknown;              // exactly what the renderer sends
  response: T;                // exactly what main returns — the assertion AND the mock
}

/** One bulk-data snapshot. `page` is logical; the frontend half re-encodes, the backend decodes. */
export interface PortSnapshot {
  op: string;                 // a value from shared/protocol/data-ops.ts's DATA_OP map
  payload: unknown;           // exactly what bridge/data.ts sends over the port
  response: LogicalPortResponse;
}

export type LogicalPage =
  | { kind: 'tabular'; columns: ColumnDescriptor[]; rows: (string | null)[][]; position: PagePosition; truncatedCells: number }
  | { kind: 'document'; ids: (string | null)[]; bodies: (string | null)[]; position: PagePosition }
  | { kind: 'keyvalue'; fields: (string | null)[]; values: (string | null)[]; redisType: string; ttlMs: number | null; memoryBytes: number | null; position: PagePosition }
  | { kind: 'stream';  keys: …; headers: …; attrs: …; timestamps: …; bodies: …; position: PagePosition };
```

`fetchedAt` and `byteSize` are deliberately **absent** from `LogicalPage`: they are wall-clock and
size-derived, so a captured value would make every fixture a false failure on the next run. The
backend half asserts them structurally (`typeof === 'number'`, `> 0`); the frontend encoder
synthesises them.

### 2.3 The two mock installers

Both take the fixture module and nothing else. Both are ~40 lines. Neither touches `src/`.

```ts
// mockControl.ts — F5's mechanism. Runs in the MAIN process.
export async function installControlMocks(app: ElectronApplication, snapshots: ControlSnapshot<unknown>[]): Promise<void>;

// mockPort.ts — F6's mechanism. Runs in the RENDERER, after the last load (F6's ordering fact).
// Returns a handle whose `.ops()` reads back every PortRequest the UI actually issued —
// a capability no spec in this repo has today.
export async function installMockPort(page: Page, snapshots: PortSnapshot[]): Promise<MockPortHandle>;
```

`installMockPort`'s `page.evaluate` body is one self-contained function — the fixture arrives as its
JSON argument and the `TextColumnChunk` encoder is defined inside it, because Playwright serialises
only the top-level function's own source and no helper it closes over. That is a constraint, not a
preference, and the probe was written that way.

**The encoder validates itself, through production code.** `src/renderer/bridge/data.ts:32-36` calls
`assertPageStructure(response.page)` on **every** read, and `page.ts:588-607` checks each chunk's
four typed-array types and its `offsets`/`nulls` lengths against `rowCount`. A malformed mock page
therefore fails the frontend spec loudly at the first read rather than rendering something plausible.
No extra guard is needed and none is added.

### 2.4 The backend harness (`tests/ipc/support/harness.ts`)

It replaces **exactly two transports and nothing else** — the two pieces that are Electron plumbing
rather than app logic:

| Real | In the harness | Why this is legitimate |
|---|---|---|
| `utilityProcess.fork` + `child.postMessage` (`src/main/engine-host.ts:38,85-101`) | an `EngineHost` whose `call(op, payload)` awaits `handleFrame({kind:'req',id,op,payload})` in-process | `engine-host.ts`'s whole job is transport; every line of behaviour it wraps is in `control.ts` |
| `process.parentPort` (`src/engine/control.ts:11`) | `{ postMessage(){}, on(){} }`, installed **before** the dynamic import (F8) | the emitted `ENGINE_EVENT.connectionState` frames are transport-only; the state they carry is asserted through `handleFrame`'s own return |

Everything else is real: a real `openDb()`/`migrate()` over a temp `KIRA_HOME` (`storage/**` has no
`electron` import — verified in F3), the real `createTreeService`, the real `handleFrame`, the real
`dispatch`, the real adapter, the real container or temp file. `ConnectionsService` is stubbed to the
narrow shape `TreeService` reads (`tree-service.ts:73-79` calls only `stateOf`), because the real one
needs `secret-cipher.ts`'s `safeStorage`, which does not exist under `ELECTRON_RUN_AS_NODE=1`.

### 2.5 `playwright.config.ts` — two projects, one config (F10)

```ts
export default defineConfig({
  workers: '50%',                       // the ceiling; each project narrows it below
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  projects: [
    { name: 'e2e',           testDir: './tests/ui',  fullyParallel: false, workers: 1 },
    { name: 'ipc-frontend',  testDir: './tests/ipc', testMatch: '**/*.frontend.spec.ts',
      fullyParallel: true,   workers: '50%' },
  ],
});
```

`testDir`/`fullyParallel`/`workers` move from the top level into the `e2e` project, byte-for-byte
preserving today's behaviour for everything under `tests/ui/` (D2).

### 2.6 `package.json` — four script lines

```json
"test:ipc":     "bun run test:ipc:be && bun run test:ipc:fe",
"test:ipc:be":  "sh scripts/run-ipc-backend.sh",
"test:ipc:fe":  "electron-vite build && playwright test --project=ipc-frontend",
"test:ui":      "electron-vite build && playwright test --project=e2e",
```

`test:ipc:fe` deliberately has **no `pre` hook**. `pretest:ui` runs `native-electron-build.sh`, which
cannot fetch Electron's C++ headers in this sandbox (AGENTS.md's Kafka section, F20) — and the
mocked frontend tier loads no adapter at all, so it needs no native driver by construction. That
makes it the one Playwright command in this repo that runs unconditionally in Claude Code's Linux
containers.

`scripts/run-ipc-backend.sh` mirrors `test:db:kafka`'s command shape, once per backend spec:

```sh
mkdir -p out/tests/ipc out/tests/fixtures
cp -R tests/db/fixtures/. out/tests/fixtures/       # F8: bundling moves __dirname
for spec in tests/ipc/**/*.backend.spec.ts tests/ipc/support/harness.spec.ts; do
  bunx esbuild "$spec" --bundle --platform=node --format=cjs \
    --external:electron --external:@confluentinc/kafka-javascript \
    --external:ssh2 --external:cpu-features \
    --outfile="out/tests/ipc/$(basename "$spec" .ts).cjs"
  ELECTRON_RUN_AS_NODE=1 electron "out/tests/ipc/$(basename "$spec" .ts).cjs" || fail=1
done
```

One `electron` process per spec file, sequentially — D2's resolution for this tier, and also what
gives each file its own container via the module memo (F11 reason 2, inverted in our favour).

---

## 3. Decisions

### The two the phase mandate defers to this plan

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | **The backend tier is its own suite — `tests/ipc/**/*.backend.spec.ts`, run by `bun run test:ipc:be` under `ELECTRON_RUN_AS_NODE=1 electron`. It does not join `tests/db/`.** It *reuses* `tests/db/support/*`'s container lifecycle and `tests/db/fixtures/*`'s seed data by direct import, exactly as `tests/electron-db/kafka.spec.ts:18-21` already does, so no container is stood up twice within a run and no seed data is duplicated. `tests/db/` itself is not edited. | Four grounds, the first two mechanical. **(a) `bun run test:db` is `bun test tests/db` — a directory glob** (`package.json:29`). A `node:test` file dropped in that directory would be picked up by Bun and fail on the spot. `tests/electron-db/` exists for precisely this reason and its own header says so (`kafka.spec.ts:23-28`: *"this suite left Bun for `ELECTRON_RUN_AS_NODE=1 electron` … because Bun cannot load the native driver at any ABI"*). **(b) The runtime is not negotiable.** The tier must cover sqlite (this repo's Bun lacks `node:sqlite` — AGENTS.md's SQLite section) and kafka (Bun cannot load the driver at any ABI — ARCHITECTURE.md:199-206). Both work under Electron-as-node; F8 measured it. **(c) F12 — `bun test` runs a directory's files in one process**, so folding in would share `engine/cache.ts`'s L2 singleton and `adapters/live.ts`'s registry between a suite that asserts cache behaviour and a suite that bypasses the cache entirely. **(d) Different subject.** `tests/db/`'s scope is stated in ARCHITECTURE.md:545-556 and SPEC.md §9.1 as *the adapter against a real container*; F2 shows the new tier's subject is the four layers above the adapter. P44 D49's practical half applies verbatim too: `bun run test:db` cannot go green in any box without Docker, so burying a differently-gated tier inside it destroys that tier's own signal. **What D1 does *not* say:** it does not put the backend half in a *different folder from its frontend twin*. The user's binding rule is colocation of the two halves and the fixture, and §2.1 honours it literally — "separate suite" here means a separate command, runtime and tsconfig include, not a separate directory from the file that shares its fixture. |
| **D2** | **The frontend tier runs `fullyParallel: true` at `workers: '50%'`. The `tests/ui/` tier stays `fullyParallel: false, workers: 1`, byte-for-byte. The backend tier runs one Electron process per spec file, sequentially, with a concurrency knob defaulting to 1.** One `playwright.config.ts` with two projects, not two config files. | **The frontend tier: measured, not argued.** F9 — four concurrent real Electron apps, `--fully-parallel`, five repeats: **20/20 pass, 25.6 s, zero flakes**. It contends over nothing: no container, no socket, no adapter; per-test `KIRA_HOME` (`tests/ui/fixtures.ts:29-33`) and per-`KIRA_HOME` Chromium `userData` (`src/main/index.ts:24-26`) mean no shared profile or singleton lock. **`tests/ui/` stays serial** for the reason F11 gives first: `budgets`/`perf`/`memory`/`startup`/`leaks` assert wall-clock and RSS numbers, and CPU contention from concurrent Electron apps would make them flake — the user's own *"if they don't flake"* clause, applied honestly. Container cost (F11.2) and `fullyParallel`'s within-file semantics against a shared `beforeAll` container (F11.3) each reinforce it. **One config, because F10 measured that Playwright 1.62.1 honours a per-project `workers` limit** (`playwright/types/test.d.ts:752`, inside `TestProject`) — the scratch two-project run showed the serial project strictly sequential while the parallel one overlapped. Two config files would have been the fallback and are not needed. **The backend tier is not parallelised, and the reason is in the helpers, not in caution.** Every container helper is a module-scope memo (`support/mariadb.ts:28-33`, `support/redis.ts:27-32`, `support/sqlite.ts:37-42`); parallel *within* a process would hand concurrent tests one container and one `engine/cache.ts` singleton, and `engine/adapters/live.ts` keys live adapters by `connectionId`, which every fixture in a given adapter folder shares. Across *processes* it is safe by construction — separate registries, separate memos, separate containers — so `run-ipc-backend.sh` takes a concurrency argument; it defaults to **1** because N concurrent processes means N concurrent database containers plus N Electron runtimes, and this tier's value is correctness, not wall clock. |

### The rest

| # | Decision | Rationale |
|---|----------|-----------|
| D3 | **The control channel is mocked in the main process** (`ipcMain.removeHandler` + `ipcMain.handle` via `electronApp.evaluate`), **never in the renderer.** | F4, decisively: `window.kira` is frozen and non-configurable, and `bridge/control.ts:34` binds it at module scope anyway, so renderer-side patching is impossible twice over. F5 measured the main-process route working. It also has a property renderer patching would not: the mock sits **behind** the real `contextBridge` and the real `ipcRenderer.invoke`, so the frontend spec still exercises the real preload surface and the real structured-clone boundary — which is exactly the boundary F7's hand-written fixture broke against. `tests/ui/s3.spec.ts:314-318` is the existing precedent. |
| D4 | **The bulk-data channel is mocked in the renderer**, by posting a `MessageChannel`'s `port1` through the same `{ __kira: 'port' }` door `preload/index.ts:159-161` uses — **after** the last page load, because `src/main/index.ts:131` re-attaches a real port on every `did-finish-load`. | F6. The seam is production code's own (`bridge/port.ts:29-42` closes the old port and adopts the new one by design, for renderer reloads and engine restarts), so no production change is needed and no private API is touched. Mocking the port in *main* instead was considered and rejected: main only hands the channel over, so a main-side mock would have to impersonate the engine utility process — more moving parts for a strictly smaller reach. The ordering fact is written into `installMockPort`'s own contract because the probe got it wrong first. |
| D5 | **Fixtures are captured from a real backend run and then asserted forever after, never hand-written.** The backend spec run with `KIRA_IPC_FIXTURES=write` rewrites its adapter's fixture module from the real responses; every ordinary run `deepStrictEqual`s against it and a mismatch fails. The generated file is committed and reviewed as a diff. | F7, which is the whole phase in one incident: a hand-written tree node used the payload's `NodePath` shape where the wire uses an encoded string (`domain/tree.ts:78`), nothing threw, and the app rendered `path: "[object Object]"` with *"An object could not be cloned"* in the row label. A frontend-only test built on that would have been green and meaningless. Capture makes the wire shape unguessable-at, and the committed diff makes a change to it visible in review. Rejected: **hand-authoring with a schema check** — most of these payloads have no zod schema on the response side (`TreeChildrenResult`, `ReadResponse` and the whole `LogicalPage` family are interfaces, not schemas), so there is nothing to check against; and F7's error was *shape-valid TypeScript* at the call site regardless. Rejected: **capturing at frontend-run time** — that would make the frontend test its own oracle, which is the drift the rule forbids. |
| D6 | **A fixture stores logical rows (decoded text and `null`), not encoded pages.** The backend half decodes the real page with `@shared/protocol/page`'s own `cellText`/`isNull`; the frontend half re-encodes into real typed arrays inside `page.evaluate`. `fetchedAt`/`byteSize` are excluded and asserted structurally instead. | Four reasons, each sufficient. A binary blob is unreviewable, so D5's "visible in the diff" guarantee evaporates. Playwright's `evaluate` argument serialisation is a risk a plain-JSON fixture simply does not run. Both directions go through the production codec's own contract, so a codec change breaks the fixture rather than sliding under it. And `assertPageStructure` — which `bridge/data.ts:34` already calls on every read — validates the re-encode for free, in production code, on every frontend run (§2.3). Excluding `fetchedAt` is not laziness: a captured wall-clock value would fail on the next run, and the field is genuinely not part of the contract under test. |
| D7 | **Each frontend spec asserts the requests the UI issued, not only the pixels it rendered.** `installMockPort` records every `PortRequest`; `installControlMocks` records every invoke. A spec may assert e.g. *"pressing ⏭ sent `data:read` with `cursor: { mode: 'after', token: <the fixture's own nextToken> }`"*. | This is capability the split *creates*, and it is the honest answer to "what does a frontend test still prove once the backend is gone?" Today a pager assertion can only observe rendered rows, which a dozen things also produce; P44 F47 made exactly this complaint about `views/keyvalue/state.ts`'s reload branch and had to reach for a unit test to say it. With the port mocked, the request payload is directly observable. It also closes the split's one real gap: without it, a frontend spec cannot tell "the UI asked for the right thing" from "the mock answered regardless". |
| D8 | **No new tsconfig project. `tests/ipc/**/*.ts` joins `tsconfig.node.json`'s `include`, beside the `tests/ui/**/*.ts` entry already at `:22`.** | Both halves are Node/Electron-typed: the backend needs `node:test` (in `@types/node`) and the frontend needs Electron's types for `app.evaluate(({ ipcMain }) => …)` — which is exactly `tsconfig.node.json`'s `"types": ["node", "electron"]`. It already includes `tests/db/support/**/*.ts`, which the backend halves import. P44 D49 needed a *new* project because `tests/unit` is `bun-types`-typed and could not share one; that reason does not exist here, and adding a fifth project to typecheck files a fourth already covers correctly would be ceremony. |
| D9 | **A spec is deleted only in the commit that lands both of its halves**, and every scenario is accounted for in §4 as backend, frontend, or dropped-with-a-reason. | The one way this phase can silently lose coverage is a split that quietly drops an assertion nobody re-reads. Deleting in the same commit keeps every intermediate state of the branch honest (no window where coverage exists twice or not at all) and makes the diff reviewable as a move rather than a rewrite. |
| D10 | **The three kept full-E2E specs each gain a header comment naming what it is the sole remaining proof of**, and nothing else changes in them. | After this phase, `tests/ui/sqlite.spec.ts`, `mongo.spec.ts` and `s3.spec.ts` are the only places the real preload → real `ipcMain` → real `TreeService` → real `utilityProcess` → real `MessageChannelMain` → real adapter chain is exercised end to end. That is a load-bearing fact about the suite that is invisible from inside any one of those files, which is exactly D50's test in P44 for when a header comment earns its place. |

---

## 4. Disposition, spec by spec

### 4.1 The three that stay whole, and why each

| Spec | Lines | Kept because |
|---|---|---|
| **`tests/ui/sqlite.spec.ts`** | 604 | **The Docker-free anchor.** It is the only DB-backed UI spec with no `isDockerAvailable()` gate (`grep -n "isDockerAvailable\|test.skip" tests/ui/sqlite.spec.ts` → no output), so it is the one full-stack proof that executes in *every* environment this repo runs in, including this sandbox — AGENTS.md's SQLite section calls this out by name. It also happens to be the spec that would benefit least from splitting: its content is overwhelmingly frontend already (selection edge caps `:238-297`, context-menu keyboard nav `:149-190`, the cell editor's format picker `:336-350`, console result chips `:374-407`, column virtualisation `:446-467`, word wrap `:418-431`), riding on a backend so cheap that removing it saves nothing. Splitting it would trade the repo's only universally-runnable full-stack proof for no wall-clock win. |
| **`tests/ui/mongo.spec.ts`** | 404 | **The Docker-backed anchor, and the document page kind.** Something has to keep proving the Testcontainers-plus-real-container path still wires all the way through, and it cannot be sqlite. Mongo is the pick because its page kind (`DocumentPage`) is covered by nothing else in the kept set, it carries a real write path end to end (edit `:160-184`, delete `:185-203`, delete-via-menu `:194`), a real cancel (`:208`), a console (`:228`) and P27's render tripwires (`:346-397`). Postgres was the other candidate and is not available: there is no `tests/ui/postgres.spec.ts` — Postgres drives `data-view`/`console`/`cell-editor`/`tree`/`interaction`/`budgets`, all of which stay untouched anyway (§7), so the Docker full-stack proof has to come from an adapter spec. |
| **`tests/ui/s3.spec.ts`** | 736 | **The widest stack of the ten.** It is the only spec that exercises `src/main/ipc/files.ts` — a real `dialog.showSaveDialog` on download (`:306-350`) and a real `dialog.showOpenDialog` on upload (`:492-539`) — and the only one covering `DATA_OP.objectDownload`, whose whole contract is that *the engine writes the file itself and bytes never transit main or the renderer* (`data-ops.ts:21-23`, `engine/data.ts:159-178`). A mocked port cannot honestly stand in for that: the mock would answer `{ bytes: n }` while no file appeared on disk, and the assertion that matters is the file. It also covers the object-store tree, the `KeyValuePage` shape reused for an object, the browse tab, delete, the read-only guard, and the over-limit/binary refusals — three main-process surfaces (`files.ts`, `tree.ts`, `connections.ts`) in one spec. |

**Rejected as keep-whole candidates, with reasons** (so the absence reads as a decision):

- **`redis.spec.ts`** — its page kind (`KeyValuePage`) and its view (`KeyValueView.vue`) are already
  covered full-stack by the kept `s3.spec.ts`, which renders an object through the same component.
  What is distinctive about redis — the browse tree's descend/Up/filter (`:322-369`), cursor-page
  Refresh behaviour (`:154-189`), TTL and memory badges (`:221-239`) — is frontend-shaped almost
  without residue, which makes it the ideal *pilot-adjacent* split, not the anchor.
- **`kafka.spec.ts`** — tempting as the `StreamPage` anchor, and rejected for the same reason it is
  the hardest spec in the repo to run: it needs Docker **and** an `electron-rebuild` that cannot
  fetch Electron's C++ headers here (AGENTS.md F20). Making the phase's only stream-kind full-stack
  proof depend on the least-runnable gate in the repo is the wrong trade. `sqs.spec.ts`'s split keeps
  the stream kind's *backend* covered in `tests/ipc/`, and `kafka.spec.ts`'s own split keeps its
  frontend covered with no native driver at all.
- **`mariadb` / `mysql` / `clickhouse` / `rabbitmq` / `sqs`** — each is a single 135–250-line scenario
  of the shape "connect → tree → open a tab → count/filter → cancel", the most mechanically
  splittable thing in the suite and the reason the phase exists.

### 4.2 `tests/ui/mariadb.spec.ts` — read in full, split scenario by scenario

145 lines, one test, five phases. This is the pilot (§5 commit 1).

| # | Scenario (`file:line`) | Goes to | What it becomes |
|---|---|---|---|
| 1 | Create the connection via `window.kira.connectionsCreate` (`:52-77`) | **neither** | Harness setup, not an assertion. Backend: the fixture's connection config. Frontend: `installControlMocks` serves `connectionsList`/`connectionsStates`. |
| 2 | Connect → `.status-dot[data-status=connected]` (`:79-85`) | **both** | Backend: `handleFrame(ENGINE_OP.connect)` returns a `serverVersion` matching `/^\d+\.\d+/` and `caps` equal to `mariadbCaps` — captured into the fixture. Frontend: the fixture's `ConnectionState` is served by the mocked `connectionsConnect`, and the dot must turn green from it. |
| 3 | Tree: `database:kira_test` → `table:order_items`, no schema level, table has no twisty (`:87-95`) | **both** | Backend: `TreeService.children` for `''` and for `database:kira_test`, both captured, plus the `source: 'server'` → `'cache'` transition on a second call — an assertion `tests/db/mariadb.spec.ts` cannot make. Frontend: `data-kind="database"` / `data-kind="table"` and `.twisty` hidden, from the fixture's nodes. |
| 4 | Open a data tab; `grid-header-cell[data-column=id]`; first gutter reads `1` (`:100-103`) | **both** | Backend: `dispatch(DATA_OP.read)`'s page — columns, rows, `position` — captured. Frontend: the grid renders those columns and rows, and the gutter numbering derives from `position.offset`. |
| 5 | Count → tooltip contains `3` (`:105-112`) | **both** | Backend: `dispatch(DATA_OP.count)`'s `{value, exact, at, stale, source}`; asserts `source: 'server'` then `'cache'` (`engine/data.ts:83-92`). Frontend: `toolbar-count`'s `data-kira-tip` from the fixture's count. |
| 6 | Filter `quantity > 1` → 2 rows (`:114-118`) | **both** | Backend: a second `DATA_OP.read` with `filter` set, its own fixture entry, plus **D7**: the fixture records the exact `ReadRequestWire` the filter produces. Frontend: typing the filter must send that exact payload and render that page. |
| 7 | Cancel a slow read on `big_rows` (`:120-142`), including the MariaDB-specific `SLEEP` construction | **backend only** | The assertion is `opsRecent(...).find(o => o.kind === 'read')?.status === 'cancelled'` — a fact about the op log and `handleCancel`/`cancelOp`, produced entirely server-side. A mocked port can only replay a cancelled status it was handed, which proves nothing. **The frontend half keeps the *button*:** that `toolbar-stop` is enabled during an in-flight read and issues `opsCancel` with the running op's id (D7) — which is the renderer's actual responsibility. |
| 8 | `expect(consoleErrors).toEqual([])` (`:144`) | **both** | Kept verbatim in the frontend half (it is a renderer-console assertion); meaningless in the backend half, which has no renderer. |

Nothing is dropped. The Docker-specific screenshot (`:97`) moves to the frontend half, where it now
renders deterministically from a fixture instead of from whatever the container returned.

### 4.3 `tests/ui/redis.spec.ts` — read in full, split scenario by scenario

372 lines, two tests. §5 commit 2.

| # | Scenario (`file:line`) | Goes to | Note |
|---|---|---|---|
| 1 | Connect, two logical dbs are leaves with invisible twisties (`:92-100`) | both | Backend captures `children('')`; frontend asserts `.twisty` has class `invisible` — pure rendering. |
| 2 | db1 browse tab: one namespace level, `data-level`, no truncated strip (`:106-116`) | both | Backend captures the level's nodes and **`truncated` absent** (P43 iter2 D21 — `control.ts:92-94` only sets it when the adapter did); frontend asserts `browse-truncated` has count 0 *from that fixture*. This pair is the anti-drift rule doing exactly its job: the day the engine starts emitting a bare `truncated: false`, the backend assertion fails in the same file. |
| 3 | Descend user → 1 → hash key; `data-kind` per row (`:118-133`) | both | Three captured `children` calls; frontend asserts breadcrumb/`data-level` transitions and row kinds. |
| 4 | Hash key tab: type badge, field/value rows, field names match `HASH_FIELDS` (`:134-144`) | both | Backend captures the `KeyValuePage` (`redisType: 'hash'`, fields, values); frontend asserts the badge and row set. |
| 5 | A reload clears the cell editor (P43 iter2 F20/D27) (`:146-152`) | **frontend only** | Entirely renderer state; the reload's *response* is the same fixture page. |
| 6 | Cursor-paged Refresh returns to page one (P43 iter3 D40/F37) (`:154-189`) | **both, split at the seam** | Backend: `dispatch(DATA_OP.read)` for a `cursor`-strategy key, capturing `position.strategy: 'cursor'` and its `nextToken`. Frontend (**D7**): after next → next → Refresh, the third request carries `{ mode: 'offset', offset: 0 }` and `pageIndex` is back to 0 — a *request-payload* assertion, which is what P44 F47 said this behaviour actually needs and could previously only get from a unit test. |
| 7 | Virtualisation: `<100` DOM rows for a 100-row page (P49 F7/D5) (`:177-181`) | **frontend only** | A DOM-count claim about the renderer. Needs a 100-row fixture — captured once, committed. |
| 8 | List key: type badge, `N loaded` status, pager both-disabled (`:191-219`) | both | |
| 9 | TTL key: badges populated, not placeholders (`:221-239`) | both | Backend captures `ttlMs`/`memoryBytes` non-null; frontend asserts the badges do not read `no expiry`/`unknown`. |
| 10 | Delete the TTL key → browse level already refreshed with no manual Refresh (P43 F11/D15) (`:241-252`) | **both, split at the seam** | Backend: the real mutate/delete against the real server, and the resulting `children` listing no longer containing the key. Frontend: `browseInvalidate()`'s cross-tab effect, driven by a fixture whose *second* `children` response omits the row — i.e. the renderer's own bookkeeping, isolated from whether the server actually deleted anything. |
| 11 | Console: `DBSIZE` → one kv row containing `11` (`:254-268`) | both | Backend: `dispatch(DATA_OP.execute)` against the real server. Frontend: `console-result-kv-row` rendering from the captured page. |
| 12 | Browse filter and Up, second test (`:276-369`) | **frontend only** | Every assertion is over an *already-loaded* level: substring filter (`:334-338`), `browse-count` "1 of 4", Up walking the breadcrumb, `browse-up` disabled at the root, and the D39 supersession guard (`:360-369`) — whose own comment already concedes *"This local fixture answers too fast to force the race"*. Mocked, the guard becomes forceable for the first time: two `treeChildren` mocks resolved out of order (D7's request log makes the interleaving observable). |

### 4.4 The remaining five, by scenario category

`mysql` (135), `clickhouse` (156), `rabbitmq` (160), `sqs` (182) and `kafka` (254) are each one
scenario of the same shape as mariadb's, and are split by the same table. `s3`'s and `sqlite`'s
categories are listed here for completeness even though both stay whole — the categorisation is the
plan's claim, and it should be legible against the two files it does *not* apply to.

**Stated plainly: the per-scenario tables above were derived from three specs read in full
(`mariadb`, `redis`, `sqlite`). The five below were categorised from their test names, their
`// ---` scenario markers and their support files, not verified assertion by assertion.** §5 makes
each of their commits responsible for producing its own literal table before splitting.

| Category | Definition | Backend half asserts | Frontend half asserts |
|---|---|---|---|
| **Connect / caps** | connect, status dot, `serverVersion`, cap-gated affordances | `handleFrame(connect)`'s payload; caps equal the adapter's own `caps.ts` | the dot, the tooltip, and which buttons a cap disables |
| **Tree enumeration** | root/level children, `data-kind`, twisty presence, folders | `TreeService.children` per level; `source` cache/server; `truncated` present-or-absent | row kinds, twisties, folder labels, ordering |
| **Describe / definition** | column metadata, DDL sections | `TreeService.describe`/`definition` payload and its cache transition | which sections render, in what order, with what text |
| **First page / paging** | open a tab, page forward/back, page size | `dispatch(read)`'s page and `position` (`strategy`, `nextToken`, `hasMore`) | rows rendered, gutter numbering, pager enablement, **and (D7) the exact cursor each control sends** |
| **Count** | count-all, stale count | `dispatch(count)`'s `{value, exact, at, stale, source}` | the tooltip, the pager's last-page enablement |
| **Filter / sort** | `WHERE`, `ORDER BY`, filter-by-value | the resulting page, and the request the filter produced | the input's value (incl. quoting style), the re-render, the count invalidation |
| **Mutations** | add/delete/edit row, commit, preview, refusals | the real write, the real error text, `invalidateAfterMutation`'s effect on the next read's `source` | staging, the pending-change strip, the confirm dialog, the error strip, sibling-tab reload |
| **Console / execute** | run statement, run all, result sets | `dispatch(execute)`'s pages | result chips, close, new-vs-append toggle, search toolbar |
| **Cancel** | stop a slow op | op-log status `cancelled` via `handleCancel` | the stop button's enablement and the `opsCancel` payload it sends (D7) |
| **Pure rendering** | selection edges, keyboard menu nav, virtualisation counts, badges, tooltips, cell editor | — | all of it, from a fixture |
| **File transfer** | download to disk, upload from a dialog | the bytes actually written | — *(this category is why `s3.spec.ts` stays whole; a mocked port cannot produce a file)* |

Adapter-specific notes for the five:

- **`mysql` / `clickhouse`** — identical to mariadb's shape plus a quoting assertion (backtick /
  double-quote) that belongs to **both**: the backend fixture captures the `WHERE` fragment the
  adapter's own filter-by-value produces, and the frontend asserts the input shows it.
  ClickHouse additionally has *delete gating* — a caps-driven affordance, frontend.
- **`rabbitmq`** — poll-with-requeue-warning and publish. The requeue warning is frontend (a banner);
  the poll's own semantics (`canUpdate`/`canDelete` permanently false, poll requeues rather than
  consumes — ARCHITECTURE.md's RabbitMQ section) are backend.
- **`sqs`** — flat queue tree, `StreamPage` with `pagination: 'batch'`, Poll-only. The "Poll-only"
  claim is a caps assertion (backend) plus a button-state assertion (frontend).
- **`kafka`** — `offsetWindow` pagination and no console. **Its frontend half needs no native driver
  at all** (nothing loads the adapter), so it is the first Kafka UI coverage that runs in this
  sandbox and on any box without an `electron-rebuild`. Its backend half stays gated on both Docker
  and the ABI rebuild, exactly like `tests/electron-db/kafka.spec.ts`.

---

## 5. Implementation order

Seven commits. Each is independently reviewable and revertible; each leaves `lint` / `typecheck`
(five projects) / `bunx electron-vite build` green; and **no commit leaves the tree with a scenario
covered twice or not at all** (D9).

1. **`test(ipc): the tests/ipc harness, and mariadb split at the IPC boundary`** — D1–D10.
   New: `tests/ipc/support/{types,harness,decode,capture,mockControl,mockPort}.ts`,
   `tests/ipc/support/harness.spec.ts`, `tests/ipc/mariadb/{mariadb.fixture.ts,
   mariadb.backend.spec.ts,mariadb.frontend.spec.ts}`, `scripts/run-ipc-backend.sh`.
   Changed: `playwright.config.ts` (two projects, §2.5), `package.json` (four script lines, §2.6),
   `tsconfig.node.json` (one `include` entry, D8). Deleted: `tests/ui/mariadb.spec.ts`.
   **No `src/` change and no `tests/db/` change.**
   - The fixture is produced by running the backend half with `KIRA_IPC_FIXTURES=write` against a
     real MariaDB container, then committed; the same run is repeated in assert mode to prove the
     round trip.
   - **`tests/ipc/support/harness.spec.ts` is the commit's Docker-free proof**, and the only one this
     sandbox can give: it drives the whole capture → assert → decode loop against
     `tests/db/support/sqlite.ts`'s temp-file fixture — the same shape F8 already ran here — so that
     the *harness* is verified everywhere even though the *pilot adapter* is Docker-gated. It is
     harness coverage, not adapter coverage, and its header says so.
2. **`test(ipc): redis split at the IPC boundary`** — §4.3's twelve-row table.
   New: `tests/ipc/redis/{redis.fixture.ts,redis.backend.spec.ts,redis.frontend.spec.ts}`.
   Deleted: `tests/ui/redis.spec.ts`. This is the commit that first exercises a non-tabular page kind
   through the fixture vocabulary (`KeyValuePage`), and the first to use D7's request log for real
   (scenario 6, and the D39 supersession guard the original spec could not force).
3. **`test(ipc): mysql and clickhouse split at the IPC boundary`** — two folders, same shape as
   mariadb's. Each commit message names its own literal scenario table, produced by reading the spec
   in full first (the §4.4 caveat). Deleted: both `tests/ui/*.spec.ts`.
4. **`test(ipc): rabbitmq and sqs split at the IPC boundary`** — the two message-broker shapes;
   `sqs` brings `StreamPage` into the fixture vocabulary. Deleted: both `tests/ui/*.spec.ts`.
5. **`test(ipc): kafka split at the IPC boundary`** — last, because it is the only one whose backend
   half needs the native ABI rebuild on top of Docker, and because its frontend half is the payoff:
   Kafka UI coverage that runs with no driver at all. Deleted: `tests/ui/kafka.spec.ts`.
6. **`test(ui): label the three remaining full-stack anchors`** — D10. A header comment in each of
   `tests/ui/{sqlite,mongo,s3}.spec.ts` naming what it is now the sole proof of, and why it was not
   split (§4.1's reasons, in one paragraph each). **No assertion in any of the three changes.** Plus
   the acceptance sweep in §8.
7. **`docs: record P50's IPC-boundary split`** — `docs/ARCHITECTURE.md`'s Testing section (§7 below),
   `AGENTS.md`'s new environment section, and `docs/v1/SPEC.md`'s P50 row rewritten from *queued* to
   what actually landed. Docs last, as P44 §4 established, so the prose describes the tree rather
   than the plan.

---

## 6. The mocking mechanism, concretely

**Both halves are proven.** What follows is the shape the probe ran in, with the two facts that were
only discovered by running it (F4's frozen object, F6's ordering) written in.

### 6.1 Control channel — main-process handler swap (D3)

```ts
// tests/ipc/support/mockControl.ts
export async function installControlMocks(app, snapshots) {
  await app.evaluate(({ ipcMain }, snaps) => {
    const log: { channel: string; args: unknown }[] = [];
    (globalThis as any).__kiraIpcLog = log;
    for (const s of snaps) {
      ipcMain.removeHandler(s.channel);
      ipcMain.handle(s.channel, (_e, args) => {
        log.push({ channel: s.channel, args });
        return s.response;              // the fixture, verbatim — no transformation anywhere
      });
    }
  }, snapshots);
}
```

Measured working (F5). The mock sits behind the real `contextBridge` and the real
`ipcRenderer.invoke`, so the frontend spec still crosses the real structured-clone boundary — the one
F7's bad fixture broke against, which is a property renderer-side mocking would have thrown away.

A spec then calls `page.reload()` so the renderer re-hydrates from the mocked handlers
(`state/connections.ts:46-67`'s `hydrateConnections` runs at boot), and waits for
`[data-testid="status-bar"]` exactly as `tests/ui/fixtures.ts:72` already does.

### 6.2 Bulk-data channel — renderer port re-attach (D4)

```ts
// tests/ipc/support/mockPort.ts — the evaluate body is self-contained by necessity
await page.evaluate((snaps) => {
  const encoder = new TextEncoder();
  const chunk = (values: (string | null)[]) => { /* data / offsets / nulls / truncated */ };
  const build = (logical) => ({ kind: 'tabular', columns: logical.columns, rowCount: …,
                                chunks: logical.columns.map((_, c) => chunk(column(c))),
                                position: logical.position, truncatedCells: …,
                                byteSize: …, fetchedAt: Date.now() });
  const seen: unknown[] = [];
  const channel = new MessageChannel();
  channel.port2.onmessage = (e) => {
    const req = e.data;                    // PortRequest
    seen.push({ op: req.op, payload: req.payload });
    const snap = match(snaps, req);        // by op + payload shape; an unmatched op is an ok:false
    channel.port2.postMessage({ kind: 'res', id: req.id, ok: true, payload: encode(snap) });
  };
  channel.port2.start();
  window.postMessage({ __kira: 'port' }, '*', [channel.port1]);   // bridge/port.ts:29 adopts it
  (window as any).__kiraPortSeen = seen;
}, snapshots);
```

Measured working end to end (F6): the real grid rendered the fixture's rows and the fake port's op
log read `["data:read"]`.

**Two contract points `installMockPort` must enforce, both learned by running it:**

1. **Attach after the last load.** `src/main/index.ts:131` re-attaches a real port on every
   `did-finish-load`, so a fake attached before a `page.reload()` is silently replaced. The helper
   therefore takes the `Page` *after* the reload and the spec must not reload afterwards; the helper
   asserts this by checking that its own port received the first request the spec makes.
2. **An unmatched op must fail loudly**, answering `{ ok: false, error: { code: 'E_FIXTURE_MISS' } }`
   rather than an empty payload — otherwise a UI that asks for something the fixture never captured
   would render an empty state and the spec would pass.

**Neither half required a production change, and that was a selection criterion, not luck.** The
control seam is Electron's own `ipcMain` registry; the port seam is `bridge/port.ts:29-42`'s
already-documented re-attach path. If either had needed a hook in `src/`, this plan would have said
so here.

### 6.3 What the frontend tier can no longer prove — stated, not glossed

- **That the backend produces the fixture.** That is the backend half's job, in the same folder, on
  the same file. This is the split's whole premise and its whole risk.
- **Anything that leaves the process.** File downloads (`DATA_OP.objectDownload`) and native dialogs
  produce artefacts a mock cannot; §4.1 keeps `s3.spec.ts` whole for exactly this.
- **Real timing.** Cancellation-mid-query, slow-read behaviour and every budget assertion stay in
  `tests/ui/`, which stays serial for that reason (D2).

---

## 7. What changes in `docs/ARCHITECTURE.md`

The Testing section (`:522-566`) is authoritative for the suite layout, so commit 7 rewrites four
things in it:

1. **`:524`, the opening line.** *"Four suites, under `tests/`: `unit/`, `db/`, `electron-db/`,
   `ui/`."* → **five**, adding `ipc/`, with one clause noting that `ipc/` is the only one that is two
   suites in one directory — a `node:test` backend half and a Playwright frontend half per adapter,
   sharing a fixture module by design.
2. **A new paragraph after `:544`** describing the tier and its binding rule: what each half drives
   (the real `handleFrame`/`dispatch`/`TreeService` with no renderer; the real Vue UI with both IPC
   halves mocked), how the fixture is generated and why it is generated rather than written (D5,
   F7), and the anti-drift guarantee in one sentence — *a frontend spec cannot mock a shape the
   backend has stopped producing without that same fixture module's own backend assertion failing
   first*. Plus the two commands and the fact that `test:ipc:fe` needs no Docker, no container and no
   native driver.
3. **`:557-566`, the `tests/ui/` paragraph.** It currently describes `tests/ui/` as *"driving the real
   UI against the real containers"* across a coverage list that includes per-adapter work. Rewritten
   to say that after P50 it holds (a) three full-stack anchors — `sqlite` (Docker-free, runs
   everywhere), `mongo` (Docker-backed, document kind, writes) and `s3` (file transfer and native
   dialogs, which no mock can stand in for) — and (b) the twenty-one non-adapter specs, unchanged;
   with the per-adapter coverage now split into `tests/ipc/`.
4. **A new sentence on parallelism**, since it is now a fact about how the suites run and not just a
   config detail: the `e2e` project stays `workers: 1` because `budgets`/`perf`/`memory`/`startup`/
   `leaks` assert wall-clock and RSS numbers that CPU contention would move; the `ipc-frontend`
   project runs `fullyParallel` because it contends over nothing (per-test `KIRA_HOME`, per-`KIRA_HOME`
   Chromium profile, no socket at all).

`AGENTS.md` gains a short section in its own register (environment, not architecture): the backend
tier's esbuild-plus-`ELECTRON_RUN_AS_NODE` invocation and the `__dirname` fixture-copy it needs
(F8), the fact that `test:ipc:fe` is the one Playwright command that runs here without the blocked
`electron-rebuild`, and which adapters' backend halves stay Docker-gated.

`docs/v1/SPEC.md`'s P50 row moves from *queued* to what landed, and must state D1 and D2 as
repository conventions rather than as details of one phase.

---

## 8. Acceptance checklist

- [ ] `git diff --name-only` for the whole phase shows **zero** paths under `src/`, `tests/db/`,
      `tests/unit/` or `tests/electron-db/`.
- [ ] `tests/ui/` contains exactly three adapter specs — `sqlite`, `mongo`, `s3` — and each opens
      with a header comment naming what it is the sole full-stack proof of (D10). No assertion in any
      of the three changed: `git diff` against `b1e6eae` for those files shows added comment lines
      only.
- [ ] Every one of the seven deleted specs' scenarios is present in `tests/ipc/`, or named in §4 as
      dropped with a reason. Spot-checkable per adapter by comparing the deleted file's `// ---`
      markers against the two new specs' test names.
- [ ] **The vital rule, greppable:** for every adapter folder, `grep -L "\.fixture'" tests/ipc/<a>/*.spec.ts`
      returns nothing — both specs import the fixture — and no `*.frontend.spec.ts` contains an
      object literal with a `kind:`/`nodes:`/`rows:` key of its own. All mock data comes from the
      fixture module.
- [ ] Each `*.fixture.ts` is byte-identical to what its backend spec regenerates:
      `KIRA_IPC_FIXTURES=write bun run test:ipc:be && git diff --exit-code tests/ipc` is clean on a
      box with Docker.
- [ ] `bun run test:ipc:fe` is green **in this sandbox**, with no Docker daemon and no
      `electron-rebuild` — seven adapters' frontend halves, run `fullyParallel`.
- [ ] `bun run test:ipc:be` runs one `electron` process per spec file and reports each file's own
      pass/fail; `tests/ipc/support/harness.spec.ts` is green **in this sandbox** (no Docker).
- [ ] `bun run test:ui` (project `e2e`) behaves exactly as before: `grep -n "workers\|fullyParallel"
      playwright.config.ts` shows `workers: 1, fullyParallel: false` on the `e2e` project, and the
      Docker-free subset (`sqlite`/`startup`/`smoke`/`connections`/`workbench`/`hardening`/`secrets`)
      is still green here.
- [ ] `bun run typecheck` is green over five projects; `grep -n "tests/ipc" tsconfig.node.json` shows
      the one added `include` entry and **no** new `references` entry in the root `tsconfig.json`
      (D8).
- [ ] `grep -rn "vitest\|sinon\|msw\|jest" package.json tests/ipc` returns nothing; `package.json`'s
      dependency lists are byte-identical to their state at `b1e6eae`.
- [ ] At least one frontend spec per adapter asserts a **request payload**, not only rendered output
      (D7) — e.g. the cursor a pager control sends, or the `opsCancel` a stop button issues.
- [ ] No `data-testid` was added, removed or renamed anywhere — this phase adds no production code.

---

## 9. Caveats, and what needs a box this one is not

**What was proven here, for real, at `b1e6eae`** — the four probes of §1, all run under
`xvfb-run` / `ELECTRON_RUN_AS_NODE=1 electron` after installing the Electron binary by the curl
workaround AGENTS.md's Electron section documents, and all deleted afterwards:

| Probe | Result |
|---|---|
| `window.kira` mutability (F4) | frozen, `writable:false, configurable:false`; both redefine paths throw. **Renderer-side control mocking is impossible** — the brief's suggested mechanism does not work. |
| Main-process `ipcMain` swap + full mocked data tab (F5, F6, F7) | **green in 3.2 s**, real Vue grid rendering fixture rows with no engine, no adapter, no container. Also produced F7's silent-wrong-fixture incident. |
| Backend tier under Electron-as-node vs. real SQLite (F8) | **green in 1.15 s**, including `SECOND READ SOURCE: cache` — an assertion `tests/db/` structurally cannot make. |
| Parallel mocked frontend specs (F9, F10) | **20/20 pass at `--workers=4 --fully-parallel`, 25.6 s**; per-project `workers` confirmed in the installed Playwright typings and measured. |

**What could not be run here, and needs CI or the macOS/Colima box:**

1. **Every adapter fixture except sqlite's.** Docker image pulls return 403 through this sandbox's
   proxy (AGENTS.md's Docker section), so **not one of the seven `*.fixture.ts` files can be
   generated here.** The pilot (commit 1) is therefore Docker-gated in this sandbox exactly as
   `tests/db/mariadb.spec.ts` is, and `tests/ipc/support/harness.spec.ts` exists precisely so that
   commit 1 still has a Docker-free proof of the *harness* (§5). **Owner: whoever runs the macOS
   Colima box.** This is the phase's largest piece of owed verification and it should be stated in
   the SPEC.md row in the same terms P48's row uses.
2. **Kafka's backend half needs the native ABI rebuild on top of Docker**, which cannot fetch
   Electron's C++ headers here (AGENTS.md F20). Its *frontend* half is expected to run here — that is
   the payoff of commit 5 and should be confirmed on the first run rather than assumed.
3. **The `--repeat-each` flake sweep for the real seven-adapter frontend tier.** F9 measured four
   copies of one probe. The real tier will have ~20 frontend specs; the implementer should run
   `--repeat-each=3` over the whole `ipc-frontend` project once, on the box that will run it
   routinely, before the parallel setting is called settled. If anything flakes, D2's fallback is a
   per-project `workers: 2` — not a return to serial.

**Handed forward, deliberately out of scope:**

4. **The twenty-one non-adapter `tests/ui/` specs.** `data-view`, `cell-editor`, `console`, `tree`,
   `interaction`, `tabs`, `autocomplete`, `definition`, `mutations` and `tooltips` are all
   Postgres-backed frontend specs that would benefit from exactly this treatment, and together they
   are 5 494 lines against the ten adapter specs' 3 148. They are excluded because
   SPEC.md:1073 enumerates the ten by name, because splitting them is a strictly larger and riskier
   change than the one asked for, and because doing both at once would make a regression
   unattributable. **This is the first thing a follow-up phase should take, and `tests/ipc/` will
   already exist.** `budgets`, `perf`, `memory`, `leaks` and `startup` are a *permanent* exclusion,
   not a deferral: they measure the real stack, and a mocked stack has no numbers worth asserting.
5. **`src/main/ipc/errors.ts`'s `[CODE] message` folding (F2) is still untested anywhere.** It is
   module-private and `ipcMain`-bound, so neither tier reaches it. The three kept full-E2E specs
   exercise it incidentally on any error path. Worth a `tests/unit/` spec if the function is ever
   exported for another reason — not worth exporting it for a test's benefit (P44 F48's rule).
6. **Anything commit 1–5's implementation turns up is a finding, not a fix** (ground rules, §0). A
   defect found while capturing a fixture is written up in the phase's own record and the fixture is
   captured against the tree as it stands, so the defect stays visible rather than being absorbed
   into a green test.
