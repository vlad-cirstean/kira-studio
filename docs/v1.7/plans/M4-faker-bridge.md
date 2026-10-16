# M4 — Faker exposed via MCP: the one Go→Faker bridge M4 and M5 share

`docs/v1.7/SPEC.md`'s M4 row, turned into concrete steps. Everything below was read in the current
tree (`v1.7` at `3bee8c37`, M3 landed) or measured in this container; line numbers are from that
tree, not from M1/M2/M3's plan docs.

Two deliverables, one phase:

1. `internal/fakegen` — the bridge: this repo's own `@faker-js/faker@10.6.0`, reachable from Go,
   deterministic under a caller-supplied seed.
2. `generate_fake_data` — a seventh MCP tool over it (M1 §9's named seam), callable with no
   connection and no database.

M5 reuses the bridge; it does not build a second one.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Is `packages/api-core/src/http/dynamic/*` reusable? | **No — a false lead**, confirmed by reading it. It is a browser-side name catalogue plus a lazily-imported generator record, consumed by `views/httprequest/state.ts` and two siblings through `loadDynamicGenerator()`. No process, no server, no seeding. Its *shape* (eager names / lazy generators) is copied; none of its code is | §1.2 |
| The bridge mechanism | **goja** (`github.com/dop251/goja`, MIT) running a `bun build` bundle of this repo's own faker, embedded with `go:embed`. No subprocess, no external runtime, no second generator. Byte-identical to the frontend's faker, measured across all 24 generators | §2 |
| Subprocess lifecycle, wire protocol, crash recovery | The question dissolves: there is no child process. The failure modes that replace it (compile failure, script error, cancellation) are named and each has one stated behaviour | §2.3, §4.4 |
| Does faker's use here already seed? | Yes — `generate.ts:270`/`:311` already call `faker.seed(seed)`, and D10 already records that a re-seed fully resets the stream. Measured: same seed → byte-identical output, in Bun and in goja, in the same process and across processes | §5.1 |
| The whole seed chain | MCP `seed` (int64) → Go → `faker.seed([hi, lo])` as two uint32 halves → generators drawn in a fixed order. An omitted seed is minted and **echoed**, never hidden | §5.2 |
| The determinism hole nobody named | `date.recent`/`date.past`/`date.birthdate` default their `refDate` to the wall clock, so seed alone does not pin them. Every date generator is called with an explicit `refDate`; it is echoed in the response and is part of the contract | §5.3 |
| Generator catalogue | All **24** `GeneratorId`s, no curation — every one already returns a JSON string, so nothing is excluded on serialisation grounds. api-core's separate 57-name `fake.*` vocabulary is deliberately not merged | §7.1 |
| Locale | `en` only, not a tool argument. Parity with the frontend's own `/locale/en` is what M5's live preview rests on; the all-locale bundle is 2.40 MB against 0.45 MB (measured) | §7.2 |
| When is the locale chunk paid for? | Once per process, lazily, on the first call: 28 ms compile + 7–10 ms per VM (measured). Never per call | §7.2 |
| Count / batch shape | `generators` (1–20 ids) × `count` (1–500, default 5), product capped at 2000 values. Rows, not columns | §6.1 |
| How M5 consumes it | `Engine.Values(generator, refDate, seeds)` — one crossing for many independent seeds. M5 derives each seed as `sha256(salt ‖ generatorId ‖ realValue)[:8]`, so one real value always maps to one fake value, and the salt keeps the map non-invertible | §9 |
| Tests | Two, both named: the Go/TS parity-and-determinism fixture pair. Everything else declined | §10 |
| One Sonnet pass or a split | One, with a named fallback seam after step 4 | §12.2 |

## 1. Confirmed current state

### 1.1 The two faker surfaces this repo already has

| Surface | Entry | How it is reached | Seeded? |
|---|---|---|---|
| Grid "Generate data" (P15) | `views/grid/fakeData/fakerEntry.ts:7` — `export { faker } from '@faker-js/faker/locale/en'` | `generate.ts:24`-`33`'s memoised dynamic `import()` | **Yes** — `faker.seed(seed)` at `generate.ts:271` and `:311` |
| HTTP/gRPC dynamic values (P6/P17) | `packages/api-core/src/http/dynamic/fakerEntry.ts:10` — the same one line, deliberately duplicated (`http/**` may not import `views/**`) | `catalog.ts`'s `loadDynamicGenerator()` | No |

`generate.ts:268`-`278`'s own comment already states the property M4 depends on: *"faker.seed() fully
resets the RNG stream each time it is called"*, so a preview and a real run with the same seed
produce byte-identical leading rows.

The catalogue is `views/grid/fakeData/types.ts:6`-`30` — **24** ids, `person.fullName` through
`binary.hex`, counted not estimated. `recipes.ts:16`-`44`'s `RECIPE_CATALOG` carries the same 24 with
a label and the `typeClass`es each is offerable for; `generate.ts:94`-`187`'s `fakerCall` is the
switch that turns an id into a call, wrapping each in `clamp(…, bounds.maxLength)` and the
numeric-bounds logic P21 round 3 added — that wrapping exists because those values are **INSERTed
into a typed column** (§7.3).

`GeneratorId` is used in five `.ts` files and — invisible to `find_references`, §14 — three times in
`workbench/GenerateDataDialog.vue`.

### 1.2 `packages/api-core/src/http/dynamic/*` — read directly, and it is a false lead

Three files, 378 lines:

- `catalog.ts` (259) — Postman's own `$random*` spellings, names only, faker-free by construction so
  the live-preview chip can import it eagerly.
- `generators.ts` (109) — `Record<FakeName, (f: Faker) => string>`, 57 entries, statically importing
  `./fakerEntry` because *it* is only ever reached through a dynamic import. `generate(name)`
  (`:102`-`109`) resolves an alias and calls one entry.
- `fakerEntry.ts` (10) — the `/locale/en` re-export.

Consumers are all renderer-side: `views/httprequest/state.ts:166`, `:242`,
`views/grpcrequest/state.ts:160`, `:293`, `api/DynamicValuesDialog.vue:31`.

So "dynamic-HTTP-and-faker mechanism" names a *dynamic-variable vocabulary for HTTP requests*, not a
dynamic HTTP server. There is no process for Go to call, no wire protocol, no seed anywhere in it —
`generate('$randomEmail')` draws from a module-scope faker nobody seeds. Nothing here is reusable as
a bridge.

Two things in it **are** worth copying, and §3 does: the eager-names / lazy-generators split, and
`generators.ts:9`-`12`'s exhaustiveness trick — `Record<FakeName, …>` over a `const`-asserted tuple's
derived union makes a missing or extra entry a `tsc` error rather than something a test must catch.

### 1.3 The MCP server after M3

Six tools, registered in `buildMCPServer` (`dbmcp/server.go:175`-`207`) as six `mcp.AddTool` calls:
`list_connections`, `list_children`, `describe_table`, `describe_schema`, `run_query`,
`explain_query`. Handlers are `func(ctx, *mcp.CallToolRequest, In) (*mcp.CallToolResult, any, error)`
in `tools.go` (`:23`, `:61`, `:83`, `:102`, `:142`, `:278`); `jsonResult` (`render.go:34`-`40`) and
`errResult` (`render.go:23`-`28`) are the two result helpers, and M1 §5.3's split is the rule —
`IsError` for anything the caller can fix, a Go `error` only for an internal fault.

`Config` (`server.go:73`-`97`) carries `Home`, `Token`, `Conns`, `Tree`, `Query`, `Approvals`,
`ExplainThreshold`, `Logger`, each required field checked in `New` (`:140`-`151`). The three backend
fields are consumer-declared interfaces in `dbmcp` (A11 discipline). `instructions` is one
paragraph at `:127`.

Construction is `main.go:275`-`278`: `dbMcpApprovals := dbmcp.NewApprovalBroker(time.Now)`, then
`dbMcpSvc := &bridge.DbMcpService{…}`, then `bridge.StartDbMcpIfEnabled`. The broker is built there
rather than inside `startLocked` precisely so it outlives a server toggle
(`bridge/dbmcp.go:108`-`133` is `startLocked`, `:149`-`158` is `stopLocked`).

### 1.4 What the app actually ships — the fact that decides this phase

The shipped artifact is one Wails bundle: a Go binary plus `//go:embed all:frontend/dist`
(`main.go:66`), packaged as a `.dmg` (`bun run package` → `wails3 task darwin:package:dmg`).

**No JavaScript runtime is shipped, and none is a documented prerequisite.** `go.mod` carries no JS
engine. Bun is a build-time tool (`package.json`'s scripts, `bun.lock`) and a dev-loop tool
(`scripts/mcp-repo-map.ts`); nothing in the packaged app runs it.

The app does spawn and discover external programs — `gitclient/runner.go:246` (git),
`ghclient/runner.go:121` (gh), `gitvsix/exec.go:96` (code), `mcpinstall/exec.go:72` (claude),
`preconnect/supervisor.go:127` (`/bin/sh -c`, the user's own script). Every one of those is an
*optional integration with a tool the user already chose*: absent git, the Git module says so and
the rest of the app is unaffected. A generator M5's anonymization depends on is not that.

### 1.5 The subprocess precedents, since a subprocess bridge would have to follow them

`internal/preconnect`'s package doc claims the role outright — *"it owns every child process the app
spawns on the user's behalf"* — and is the only long-lived-child supervisor: `Setpgid` process group,
a 2 s settle window classifying one-shot versus sidecar, a drained stderr tail, kill escalation with
a 2 s grace (`supervisor.go:127`-`190`). Every other spawn is one short-lived command awaited to
completion.

**No Go code in this repo manages a long-lived child over a request/response protocol.** M4 would be
the first, and would be inventing the pattern — which is an argument against choosing it when a
mechanism with no child process at all is available and measurably adequate.

## 2. The bridge

### 2.1 Measured first, decided second

Run in this container against the repo's own `@faker-js/faker@10.6.0`, bundled with
`bun build --target=browser --format=iife --minify` (0.45 MB) and executed both in Bun and in
`goja@v0.0.0-20260911104922`:

| | Bun | goja |
|---|---|---|
| All 24 generators at seed 42 | reference | **byte-identical, all 24** |
| Seed array `[hi, lo]`, row batches | reference | **byte-identical** |
| `faker.seed(n)` + one draw | 17 µs | 1.17 ms |
| One draw, already seeded | ~8 µs | 0.21 ms |
| `faker.seed(n)` alone | — | 0.96 ms |
| 1000 rows × 2 generators, one seed | ~15 ms | 422 ms |
| Compile the bundle | — | 28 ms, once (`*goja.Program` is shared) |
| Evaluate it into a fresh VM | — | 7–10 ms |
| Heap per VM | — | 2.6 MB |

The only divergences were the three clock-dependent date generators, differing by the seconds
between the two runs — and their `refDate`-pinned variants matched exactly. That is §5.3's finding,
not a goja defect.

Also measured: the all-locale bundle is 2.40 MB against `en`'s 0.45 MB.

### 2.2 Decision: goja, in process

**`internal/fakegen` embeds a bundle of this repo's own faker and runs it in goja.** No subprocess,
no external runtime, no second generator library.

Why, in the order the reasons matter:

1. **It works in the shipped app.** §1.4: nothing else on this list does, without either shipping a
   JS runtime or requiring one the user never installed.
2. **It is the same faker, so M5's two surfaces agree.** SPEC's M5 row puts the same anonymizing
   transform on the MCP path *and* in the grid/cell editor, so the user can "see what an AI client
   would see". If the two sides ran different generators, that preview would be a lie. Running the
   same package at the same version, from one shared generator table (§3), makes them agree by
   construction — and §10's fixtures fail on the same bytes if they ever stop.
3. **M5's cost is per value, on the query-result path.** An in-process call has no framing, no pipe,
   no restart storm and no partially-written line to recover from.
4. **There is no lifecycle to get wrong.** Nothing to spawn, supervise, reap or restart; §4.4's
   whole failure surface is three named cases.
5. **Adequate, measured.** 0.21 ms per value; the tool's own 2000-value ceiling is ~0.4 s, and the
   dominant per-value cost for M5 (0.96 ms, the Mersenne Twister re-init inside `faker.seed`) is
   named with its escape hatch in §9.3 rather than discovered there.

Costs, stated rather than buried: a new Go dependency (goja, MIT; its own deps `dlclark/regexp2`
MIT, `go-sourcemap/sourcemap` BSD-2, `google/pprof` Apache-2.0 — all standard-attribution licences
`go.mod` already carries, so **no `NOTICES.md` entry is needed**, that file being for terms beyond
MIT/BSD/Apache); 449 KB of committed generated JS; an estimated few MB of binary growth from the
interpreter itself (not measured — it would not change the decision, the nearest alternative being
60–100 MB, §2.3).

goja is pure Go, so it adds no second cgo toolchain requirement beyond the tree-sitter one the repo
already has.

### 2.3 Refused, each with its reason

**A Bun/Node subprocess — SPEC's own leading candidate.** Refused on §1.4: the runtime is not
shipped and not a prerequisite, so the tool would work on the developer's machine and silently not
on a user's. Discovering one on `PATH` is the posture this repo uses for *optional* integrations,
not for a generator M5's whole anonymization rests on. It also needs the bundle materialised on disk
anyway (a `go:embed` extracted to `KIRA_HOME`), so it pays §3's cost *plus* a child process, a wire
protocol this repo has no precedent for (§1.5), and the crash/restart/zombie surface that comes with
it — to buy ~70× on an operation that is already fast enough.

**A `bun build --compile` sidecar binary.** Removes the runtime dependency honestly, and would work.
Refused on size and build surface: a standalone Bun binary is tens of megabytes per platform, inside
a `.dmg` for a tool whose entire job is producing short strings, plus a second Mach-O to sign and
notarize in `scripts/sign-bundle.sh`'s own path.

**Driving the renderer's faker from Go**, correlation-id style, the way `ApprovalBroker` already
turns a Wails event plus a bound method into a Go-blocking request/response. Tempting — the chunk is
already shipped and the parity question vanishes. Refused because it makes an MCP tool, and then
every anonymized MCP query result in M5, depend on a live window and the UI thread: a macOS app with
its window closed still serves MCP (M1 §3.1), and a headless AI path that stalls on a renderer is
the wrong shape twice over.

**A Go faker library** (`brianvoe/gofakeit` and peers). Refused against a named requirement, per
`CLAUDE.md`: reason 2 above. A second generator produces different values for the same seed, so
M5's grid preview and M5's MCP output would disagree about what the AI client sees — the one thing
that preview exists to show. Nothing about the library's quality is at issue.

**Porting the plan-port trick from M3** (reimplement the generators in Go against shared fixtures).
That *is* hand-rolling a second generator, at 24 generators over a locale data set of hundreds of
kilobytes, and would drift the moment faker is bumped.

### 2.4 Risks, named

- **goja is an interpreter with partial modern-JS coverage.** Verified today against this exact
  bundle, including `BigInt` (`number.bigInt`), `Date`, template literals and classes. A future
  faker major could use something it lacks. Containment: the bundle is pinned and committed, so a
  faker bump is a deliberate act that must re-run `bun run generate:fakegen` and re-green §10's
  fixtures — it cannot happen by `bun install` alone.
- **Two tables of faker calls exist afterwards** (§7.3): `generate.ts`'s column-bounds-aware switch
  and `packages/shared/fakegen/generators.ts`'s bare record. They share one catalogue and one
  parity fixture, and they answer different questions. Stated, not hidden.

## 3. The JavaScript side

### 3.1 Files, and the split they follow

| File | What | Faker? |
|---|---|---|
| `packages/shared/domain/fakegen.ts` | `GENERATOR_IDS` (24, `const`-asserted, `RECIPE_CATALOG`'s order), `GeneratorId`, `isGeneratorId`, `FAKEGEN_CATALOG_VERSION` | **no** — eager-safe, `catalog.ts`'s own rule |
| `packages/shared/fakegen/generators.ts` | `Record<GeneratorId, (f: Faker, ctx: GenContext) => string>`, statically importing `@faker-js/faker/locale/en` | yes — reached only through a dynamic import (`generators.ts:1`-`5`'s precedent) |
| `packages/shared/fakegen/entry.ts` | The bundle entry: defines `globalThis.__kiraFakegen = { version, ids, rows, values }` | through the record |
| `scripts/build-fakegen.ts` | `bun build` → `apps/kira-studio/internal/fakegen/faker.bundle.js` | — |

`packages/shared/package.json` gains `"@faker-js/faker": "10.6.0"` — the exact pin `api-core` already
declares, not a floating range.

`GenContext` is `{ refDate: Date }` today. It exists so §5.3's pinning is a parameter rather than a
global, and so a later locale (§13) has somewhere to arrive.

`views/grid/fakeData/types.ts`'s `GeneratorId` becomes a re-export of the shared type — one line, no
behaviour change, and it is what makes "the catalogue" one list rather than two that agree by luck.
`recipes.ts`, `generate.ts` and `GenerateDataDialog.vue` are otherwise untouched.

### 3.2 The entry's own surface

Two functions, because the Go side has two callers with different shapes (§4.2, §9):

```ts
// rows: one seed, N rows, ids drawn left-to-right per row — generate_fake_data's shape.
rows(ids: string[], count: number, seed: [number, number], refDateMs: number): string[][]
// values: one generator, N independent seeds, one value each — M5's shape.
values(id: string, seeds: [number, number][], refDateMs: number): string[]
```

Both re-seed exactly where the semantics say to: `rows` seeds **once** and draws `count × ids.length`
values in a fixed order (the frontend's `runGeneration` semantics, `generate.ts:311`-`318`);
`values` seeds **per entry**, which is what makes one real value map to one fake value in M5.

An unknown id throws; §4.4 turns that into an `errResult`.

### 3.3 The bundle is a committed, generated artifact

`bun build packages/shared/fakegen/entry.ts --target=browser --format=iife --minify --outfile
apps/kira-studio/internal/fakegen/faker.bundle.js`, wrapped in `scripts/build-fakegen.ts` and exposed
as `"generate:fakegen"` in the root `package.json` beside `"generate:wire"`.

`--target=browser --format=iife` is the combination verified in §2.1: no `require`, no
`module.exports`, no Node built-in, one self-executing script goja evaluates as-is.

**Committed**, like `internal/page/wire/*.go` (FlatBuffers output, generated by
`scripts/generate-wire.sh` and in the tree). Three consequences, each deliberate:

- `go build ./...` and `go test ./...` work with no Bun anywhere — CI, a fresh clone, a Go-only
  contributor.
- `biome.json`'s `files.includes` gains `"!apps/kira-studio/internal/fakegen/faker.bundle.js"`, the
  same `!` treatment `packages/shared/protocol/wire.ts` already has.
- A stale bundle is caught by §10's parity fixtures, not by trust.

## 4. The Go side — `internal/fakegen`

### 4.1 Package shape

`apps/kira-studio/internal/fakegen/`, a new package below `internal/bridge`
(`internal/layering_test.go` enumerates every `internal/*` package from `go list`, so it is covered
the moment it exists). It imports goja and stdlib only — not `dbmcp`, not `adapters`.

| File | What |
|---|---|
| `bundle.go` | `//go:embed faker.bundle.js` |
| `catalog.go` | `var generatorIDs = map[string]bool{…}` — the 24 ids, in `RECIPE_CATALOG`'s order, plus `GeneratorIDs() []string` and `catalogVersion` |
| `engine.go` | `Engine`, `New`, `Rows`, `Values`, the VM pool, the seed split, error mapping |
| `engine_test.go` | §10's fixture parity and determinism test |
| `faker.bundle.js` | §3.3's committed artifact |

`generatorIDs` is spelled as a `map[string]bool` literal deliberately: that is the exact shape
`tests/unit/go-ts-vocabulary-parity.spec.ts`'s `extractGoStringSet` reads out of Go source as plain
text (P2 D10's technique), which is how §10 keeps the Go and TS catalogues one list.

### 4.2 API

```go
// Engine runs this repo's own @faker-js/faker in an embedded ES VM. Safe for concurrent use; the
// compiled program is shared and each caller borrows a VM from a small pool. Construction is free —
// nothing is compiled until the first call, so an app whose user never touches the tool pays
// nothing.
type Engine struct{ … }

func New(logger *slog.Logger) *Engine

// Rows draws count rows, one value per generator per row, from a single seed — generate_fake_data's
// own shape. Drawing order is part of the contract (§5).
func (e *Engine) Rows(ctx context.Context, generators []string, count int, seed int64, refDate time.Time) ([][]string, error)

// Values draws one value per seed from one generator — M5's shape (§9): independent seeds, one
// crossing into the VM, so a page of cells costs one call rather than one per cell.
func (e *Engine) Values(ctx context.Context, generator string, seeds []int64, refDate time.Time) ([]string, error)

// Known reports whether id is in this build's catalogue; GeneratorIDs lists it.
func (e *Engine) Known(id string) bool
func GeneratorIDs() []string
```

### 4.3 The VM pool

goja runtimes are not safe for concurrent use, and the MCP transport is `Stateless: true`, so two
tool calls can overlap.

```go
const maxVMs = 4 // 2.6 MB each, measured — a bounded ~10 MB even fully warm
```

- `sync.Once` compiles `faker.bundle.js` into a `*goja.Program` (28 ms) and latches any compile
  error. A `*goja.Program` is immutable and shared by every VM.
- `sem chan struct{}` (cap `maxVMs`) bounds concurrency and is acquired under the caller's `ctx`, so
  a cancelled request waits for nothing.
- `free chan *goja.Runtime` (cap `maxVMs`) holds warm VMs. An empty `free` with a token in hand
  means "build one": `goja.New()` + `RunProgram` (7–10 ms), once per VM for the process's life.
- **An interrupted VM is dropped, not returned** — after `Interrupt` a runtime may hold torn state,
  and a 2.6 MB rebuild is the cheap side of that trade.

`Close` does not exist. There is nothing to close, which is §2.2's point restated as an API.

### 4.4 Failure modes — the whole surface

| Case | Behaviour |
|---|---|
| Bundle fails to compile | Latched by the `sync.Once`, logged once at `Error`, and returned to every caller as the same error. Deterministic by nature: a bundle that compiles in CI compiles everywhere |
| Unknown generator id | Rejected in Go by `Known` **before** a VM is taken; the tool's `errResult` names the id and lists the catalogue, so the model self-corrects in one turn |
| A generator throws | The goja error's own message, wrapped with the id, as an `errResult` |
| `ctx` cancelled, or the 5 s hard cap | `time.AfterFunc` calls `vm.Interrupt`; the call returns `ctx.Err()` (or a cap error naming the 5 s), and the VM is dropped (§4.3). The cap exists because the tool's own ceiling is ~0.4 s, so anything an order of magnitude past it is a bug, not a slow day |

No case leaves a process behind, because there is no process. The question SPEC framed as *"what
happens to a `generate_fake_data` call if the subprocess has died or hasn't started yet"* has this
answer: the first call pays 28 ms + 10 ms of warm-up and then answers; there is no "died".

## 5. Determinism

### 5.1 What already holds, measured not assumed

`faker.seed(n)` fully resets the generator's stream — `generate.ts:268`-`278` says so, and §2.1
confirms it in both runtimes. Measured in Bun: `faker.seed(42)` then three draws, twice, gives the
same three values; a fresh `new Faker({locale: en})` seeded 42 gives the same values as the shared
instance seeded 42. Measured in goja: every one of the 24 generators at seeds 42 and 7 matches Bun
byte for byte.

So the property M5 needs is a property of the library, not something this phase invents.

### 5.2 The seed's whole path

```
generate_fake_data { seed: 7 }            MCP JSON, an integer
  → runQuery-style handler                Go int64
  → fakegen.Rows(…, seed int64, …)
  → hi := uint32(uint64(seed) >> 32); lo := uint32(uint64(seed))
  → vm: __kiraFakegen.rows(ids, count, [hi, lo], refDateMs)
  → faker.seed([hi, lo])                  faker's own init_by_array path
  → draws, left-to-right, row by row
```

Two uint32 halves rather than one JS number, because a JS number is a double: above 2⁵³ an int64
seed would not survive the crossing intact. The array form is faker's own documented seeding shape
and was verified byte-identical across goja and Bun (§2.1), including a full-width
`[305419896, 2596069104]`.

`seed` is optional. When omitted, Go mints one from `crypto/rand`, uses it, and **returns it in the
response**. A caller can therefore always reproduce a batch, and there is never a hidden seed the
tool used but did not disclose.

### 5.3 The clock, which is the part that would have silently broken M5

`date.recent`, `date.past` and `date.birthdate` default `refDate` to the current time. Measured: the
same seed twelve seconds apart produced `2026-09-14T23:33:16.430Z` and `2026-09-14T23:33:28.188Z`;
the same seed with `refDate` pinned to `2020-01-01T00:00:00.000Z` produced
`2019-12-31T08:59:19.892Z` in both runtimes, identically.

**Every date generator is therefore called with an explicit `refDate`**, carried through
`GenContext` (§3.1). `refDate` is an optional tool argument; when omitted, Go fills it from the wall
clock and echoes it. The contract is stated in exactly these terms, in the tool description and in
`engine.go`'s doc comment:

> Same `generators` + `count` + `seed` + `refDate` + catalogue version → byte-identical output.

Defaulting to the clock rather than to a fixed epoch keeps "recent date" meaning recent; echoing it
is what keeps the contract exact. M5 stores a `refDate` per rule, so an anonymized birthdate does not
drift from one query to the next (§9.2).

### 5.4 How it is verified, without implementing it here

§10's two tests, which are one fixture read from both languages:

1. Every id × three fixed seeds × a fixed `refDate`, generated **from the TypeScript side** (the
   reference implementation) into `tests/fixtures/fakegen/catalog-en.json`, then asserted from Go.
   M3 §11.1 step 2's rule, restated: generating the expected values from the Go side would pin the
   port to itself.
2. In Go: the same call twice returns identical output; two *different* pooled VMs return identical
   output (the pool must not be a source of variance); a seed past 2³² round-trips through the hi/lo
   split; a run under `-race` with concurrent callers stays identical.

A drift in either language then fails a test in that language, on the same bytes — M3 §2.4's own
argument, reused because the situation is the same shape.

## 6. The tool

### 6.1 Input

```go
type generateFakeDataArgs struct {
	Generators []string `json:"generators" jsonschema:"Generator ids, drawn left to right for each row. One of: person.fullName, person.firstName, person.lastName, internet.email, internet.url, phone.number, location.city, location.country, location.state, location.zipCode, location.streetAddress, company.name, finance.amount, date.recent, date.birthdate, date.past, lorem.sentence, lorem.words, lorem.slug, string.uuid, datatype.boolean, number.int, json.object, binary.hex. 1-20 ids."`
	Count      int      `json:"count,omitempty" jsonschema:"Rows to generate, 1-500. Default 5. generators × count may not exceed 2000 values."`
	Seed       *int64   `json:"seed,omitempty" jsonschema:"Seed for reproducible output. Omit and one is minted and returned, so any batch can be reproduced by passing the seed back."`
	RefDate    string   `json:"refDate,omitempty" jsonschema:"RFC 3339 instant the date generators are relative to. Omit and the current time is used and returned — the same seed with a different refDate gives different dates."`
}
```

**No `connectionId`, and no permission gate.** This tool touches no connection, opens nothing,
executes nothing and reads no data; there is nothing for M2's read/write/DDL vocabulary to classify.
It is available whenever the server is running, which is exactly SPEC's *"callable by an AI client
independent of anonymization"*. `access.go` is untouched by this phase.

The ids are spelled into the schema description rather than left to prose: it is the only place the
model can learn them, they are self-describing faker `module.method` names, and an unknown id costs
one corrective turn (§4.4) rather than a guess.

### 6.2 Output

```json
{"generators":["person.fullName","internet.email"],
 "count":3,
 "seed":7,
 "refDate":"2026-09-15T14:31:00Z",
 "locale":"en",
 "rows":[["Mr. Guillermo Yundt","Clarissa.Yundt77@hotmail.com"],
         ["Citlalli Nolan","Grover44@hotmail.com"],
         ["…","…"]]}
```

Rows, not columns: a model composing an `INSERT` reads rows. `seed`, `refDate` and `locale` are
always echoed — they are the contract of §5.3, and a response that omitted them would not be
reproducible.

### 6.3 Caps, and why these numbers

| Cap | Value | Why |
|---|---|---|
| `generators` | 20 | A wider fake row than any plausible test table, and it bounds the product below |
| `count` | 500, default 5 | 500 is `generate.ts:39`'s own `BATCH_SIZE`, already argued for in P15 D6; matching it avoids inventing a second number for the same idea. Default 5 because a model usually wants examples, not a data set |
| `generators × count` | 2000 | The real cost is per value: 2000 × 0.21 ms ≈ 0.4 s (§2.1), and 2000 `lorem.sentence`s is already more JSON than a model wants in its context |

Over the product cap, the tool refuses with an `errResult` naming both dimensions and the ceiling —
never a silent truncation, which would hand the model fewer rows than it asked for without saying so
(M3 §13's own LIMIT-injection reasoning).

**Bulk seeding of a real table is not this tool's job**, and the description says so: that is the
app's own Generate-data dialog, which writes rows straight into the table
(`generate.ts:309`-`337`'s `runGeneration`) instead of routing every value through a model's context
window.

### 6.4 Registration

A seventh `mcp.AddTool` in `buildMCPServer` (`server.go:207`), M1 §9's named seam, unchanged:

> `generate_fake_data` — Generate realistic fake values (names, emails, addresses, companies, dates,
> lorem text, UUIDs, numbers) as rows, from the same generator set this app's own "Generate data"
> dialog uses. Deterministic: the same seed and refDate always produce the same values, and both are
> returned so any batch can be reproduced. Touches no database. English (`en`) values only. For
> filling a real table with many rows, use the app's own Generate data dialog instead.

`instructions` (`server.go:127`) gains one sentence: `generate_fake_data` needs no connection and
runs nothing against a database, and its output is reproducible from the `seed` and `refDate` it
returns.

## 7. Catalogue and locale

### 7.1 All 24 ids, no curation

Every `GeneratorId` in `types.ts:6`-`30` is exposed. The curation criterion SPEC anticipated —
generators whose output does not serialise cleanly to MCP JSON — **excludes nothing here**, checked
per id rather than assumed: all 24 already produce a plain string in `generate.ts`'s own switch,
including `binary.hex` (`0x…` text, not bytes), `json.object` (a JSON *string*) and
`datatype.boolean` (`"true"`/`"false"`). Faker's image and binary-shaped calls are not in this
catalogue at all.

**api-core's 57 `fake.*` names are deliberately not merged in.** They are Postman's `$random*`
vocabulary, kept for collection-import compatibility (`catalog.ts:5`-`12`), keyed by alias, serving
HTTP request bodies. Merging two catalogues would make one list answer two unrelated contracts, and
M5's per-column rules need ids the grid's own picker already renders. If a later phase wants
`internet.ipv4` over MCP, the move is to add it to the 24-id catalogue and to `RECIPE_CATALOG`
together — recorded in §13 so it is not rediscovered as a merge.

### 7.2 `en` only; locale is not a tool argument

Three reasons, in order:

1. **Parity.** Both existing faker entries are `/locale/en` (`fakerEntry.ts:7`, api-core's `:10`).
   M5's live preview runs the frontend's faker; a value generated under `de` on the MCP path could
   not be reproduced there without pulling every locale into the boot bundle — the exact cost SPEC's
   "~150 KB locale chunk" note is about.
2. **Size, measured.** The all-locale bundle is 2.40 MB against 0.45 MB (§2.1), embedded in the
   binary and compiled by goja on first use.
3. **Surface.** A locale would become a second axis in M5's rule storage, in every fixture and in
   every cached value, for no stated requirement in either row.

`"locale":"en"` is echoed in the response regardless, so adding locales later changes no response
shape.

**Answering SPEC's own question about when the locale cost is paid**: once per process, lazily, on
the first call — 28 ms to compile plus 7–10 ms per VM, then reused for the app's life. Never per
call, and never at boot for a user who does not use the tool.

### 7.3 Why `generate.ts`'s call table is not reused

`fakerCall` (`generate.ts:94`-`187`) wraps every generator in `clamp(…, bounds.maxLength)` and, for
`finance.amount`/`number.int`/`binary.hex`, in numeric-bounds logic derived from the column's own
declared type. That exists because those values are **INSERTed into a typed column** — P21 round 3
found a value one character over `varchar(n)` aborting a whole batch.

`generate_fake_data` has no column, and M5's anonymization never writes anything back. So the shared
record (§3.1) calls the bare generator, and `generate.ts` keeps its own bounds-aware switch for its
own job. Two tables, one catalogue, different questions — `json.object`'s and `binary.hex`'s
composite bodies are copied across verbatim (minus the clamping) so the two agree in shape, and
§10's fixtures pin the shared one.

## 8. Wiring

| File | Change |
|---|---|
| `apps/kira-studio/main.go:275` | `dbMcpFake := fakegen.New(slog.Default())` beside `dbMcpApprovals`, passed into `DbMcpService`. Constructed here for the broker's own stated reason (`main.go:270`-`274`): it must outlive a server toggle, so re-enabling the server does not recompile the bundle. Free to construct — nothing is compiled until first use (§4.2) |
| `internal/bridge/dbmcp.go:33` | `DbMcpService` gains `Fake *fakegen.Engine`; `startLocked`'s `dbmcp.Config` literal (`:113`-`122`) gains `Fake: s.Fake` |
| `internal/dbmcp/server.go:73` | `Config.Fake FakeGenerator` — a consumer-declared interface (`Rows`, `Known`, plus `Values` for M5), A11 discipline, the same shape `QueryRunner` has. Required, checked in `New` beside `Approvals` (`:147`) |
| `internal/dbmcp/server.go:127`, `:207` | The instructions sentence and the seventh `AddTool` (§6.4) |
| `internal/dbmcp/tools.go` | `generateFakeDataArgs` + `generateFakeData` (§6) |
| `packages/shared/package.json` | `"@faker-js/faker": "10.6.0"` |
| `package.json` | `"generate:fakegen": "bun run scripts/build-fakegen.ts"` |
| `biome.json` | `"!apps/kira-studio/internal/fakegen/faker.bundle.js"` |
| `views/grid/fakeData/types.ts` | `GeneratorId` re-exported from `@shared/domain/fakegen` (§3.1) |

**No `.vue` file changes, no new settings leaf, no new zod schema, no migration, no wire channel.**
The tool rides the server the user already enables in Settings; there is nothing per-connection to
store. That also means **no fixture sweep** — the trap M1ab, M2 §8 and M3 §9.4 each had to call out
does not arise, because no `ConnectionSummary`/`ConnectionInput` field is added.

## 9. The M5 seam, designed now

### 9.1 The call

M5's anonymizer holds a rule per `(connection, table, column)`: a method, a `generatorId`, and a
`refDate`. For one page of results it collects the distinct real values per column and makes **one**
call:

```go
fakes, err := engine.Values(ctx, rule.GeneratorID, seeds, rule.RefDate)
```

`Values` is on the `Engine` from this phase, and on `dbmcp.Config.Fake`'s interface from this phase,
so M5 adds no plumbing — it inserts its transform where M1 §9 and M2/M3 have said all along:
between `Query.Execute` and `render.go`'s projection (`renderPage`, still the single entry point).

### 9.2 How a real value becomes a seed

```
seed = int64(binary.BigEndian.Uint64(sha256(salt ‖ generatorId ‖ []byte(realValue))[:8]))
```

- **Deterministic**: the same real value always yields the same seed, so the same fake value comes
  back — `orders.customer_name` and `customers.name` anonymize to the same fake person, and a join
  across a foreign key still joins. That is the correlation property SPEC's M5 row asks for.
- **Per generator**: including `generatorId` keeps two columns anonymized by different generators
  independent, and re-pointing a rule at a different generator re-randomizes cleanly.
- **Non-invertible in practice**: without `salt`, anyone could take a leaked fake value and
  brute-force the real one over a dictionary of names or emails. `salt` is generated per connection,
  stored beside the rules and **never returned to an MCP client** — M5's own plan owns where it
  lives; M4 only states that the seed is derived from a secret, not from the value alone.
- **`refDate` is stored with the rule**, not taken from the clock, or an anonymized birthdate would
  change between two queries about the same row (§5.3).

M5 is free to change this derivation — it is M5's, not M4's. What M4 fixes is the bridge's own
contract: *an int64 seed in, a byte-identical value out*.

### 9.3 The cost, measured, with its escape hatch

~1.2 ms per **distinct** value (0.96 ms `faker.seed` + 0.21 ms draw). A page of 200 rows × 3 PII
columns is 600 cells but usually far fewer distinct values; a `(generatorId, seed) → value` memo per
request collapses the repeated-FK case, and that memo belongs to M5, not here.

If it ever proves too slow, the named escape hatch is faker's own `randomizer` option — a
constant-time seeded PRNG in place of the Mersenne Twister, which is where the 0.96 ms goes. It
would change **every** value, so it can only land as a catalogue-version bump applied to both
surfaces at once, never as a silent optimization. `FAKEGEN_CATALOG_VERSION` (§3.1) exists so that
bump has somewhere to be recorded.

### 9.4 What M5 still has to decide

Named so M5's planning pass knows these are open, not settled here: which method fits which PII
class, the rule storage and UI, where the salt lives, whether the grid preview computes its values in
the renderer (its own faker) or displays what Go computed, and what happens to a NULL or an empty
string. M4 answers only "how does a Go process get a deterministic realistic value".

## 10. Tests

`CLAUDE.md`'s default is no dedicated unit test. **One pair** clears the bar — one fixture, read from
both languages. Everything else is named and declined.

**`internal/fakegen/engine_test.go` + `apps/kira-studio/tests/unit/fakegen-parity.spec.ts`, over
`apps/kira-studio/tests/fixtures/fakegen/catalog-en.json`.**

The fixture: every one of the 24 ids × seeds `[0, 42, 9007199254740993]` (the last past 2³², pinning
the hi/lo split) × `refDate` `2020-01-01T00:00:00.000Z` → the expected value, generated from the
TypeScript side (§5.4).

Why it earns its keep, beyond restating that faker is deterministic:

- **Two runtimes execute one contract.** The value a model sees over MCP and the value M5's grid
  preview shows must be the same string. Nothing else in the repo would notice if they stopped
  being — both sides would keep passing their own tests. This is M3 §2.4's argument, and the same
  answer: read the same bytes.
- **It pins the committed bundle to the installed faker.** A `bun install` bump without
  `bun run generate:fakegen` fails the TS half against a fixture the Go half still passes, which is
  exactly the drift §2.4 names as the standing risk.
- **It pins the two catalogues together.** The TS half also runs
  `go-ts-vocabulary-parity.spec.ts`'s `extractGoStringSet` over `internal/fakegen/catalog.go` and
  compares to `GENERATOR_IDS` — P2 D10's technique, on the vocabulary that would otherwise be the
  fourth list with no compiler behind it.

The Go half additionally asserts, in the same table test: the same call twice is identical; two
different pooled VMs are identical; concurrent callers under `-race` are identical.

Declined, explicitly:

- **The tool handler's clamping and defaults** — `count` bounds, the product cap, the unknown-id
  refusal. One- and two-condition guards over a constant; a test would restate them.
- **The VM pool on its own** — a bounded borrow/return with no ordering or backpressure semantics
  beyond "wait for a free one". The concurrency that matters (does a second VM produce the same
  values) is asserted in the determinism test, where it means something.
- **`catalog.go`'s map** — a list.
- **`bridge/dbmcp.go` and `main.go` wiring** — thin pass-throughs; `bridge/repomap.go`, their model,
  has no test either.
- **The shared `generators.ts` record** — 24 one-line faker calls whose completeness the compiler
  already proves via `Record<GeneratorId, …>` (§1.2's trick, and api-core's `generators.ts:9`-`12`
  declines its own test for exactly this reason). Their *output* is pinned by the fixture anyway.
- **No adapter conformance change, no real-container change.** M4 adds no `Adapter` method, touches
  no adapter and runs no statement; `adapters/*/*_test.go` and the P25/P26 suites gain nothing.
- **No new `tests/ui/` spec.** M4 has no frontend surface.

Fast checks per commit: `go build ./...`, `go vet ./...`, `go test ./...`, `bun run typecheck`,
`bun run lint`. Once, near the end: `bun run test:unit` in full and `bun run build`. **The full
Playwright suite is not re-run**: the only `frontend/src` edit is a one-line type re-export whose
failure mode is a `vue-tsc` error, and no fixture-shaped field is added anywhere (§8). Stated as a
decision so nobody reads it as an omission.

## 11. Files

New:

| File | What |
|---|---|
| `packages/shared/domain/fakegen.ts` | `GENERATOR_IDS`, `GeneratorId`, `isGeneratorId`, `FAKEGEN_CATALOG_VERSION` (§3.1) |
| `packages/shared/fakegen/generators.ts` | The `Record<GeneratorId, …>` call table (§3.1) |
| `packages/shared/fakegen/entry.ts` | The goja entry, `rows`/`values` (§3.2) |
| `scripts/build-fakegen.ts` | The bundle build (§3.3) |
| `apps/kira-studio/internal/fakegen/faker.bundle.js` | Committed generated artifact (§3.3) |
| `apps/kira-studio/internal/fakegen/bundle.go` | `//go:embed` |
| `apps/kira-studio/internal/fakegen/catalog.go` | The 24 ids as a `map[string]bool` literal (§4.1) |
| `apps/kira-studio/internal/fakegen/engine.go` | `Engine`, pool, seed split, error mapping (§4) |
| `apps/kira-studio/internal/fakegen/engine_test.go` | §10 |
| `apps/kira-studio/tests/fixtures/fakegen/catalog-en.json` | §10's shared fixture |
| `apps/kira-studio/tests/unit/fakegen-parity.spec.ts` | §10's TS half |

Modified: the eight rows of §8's table, plus `go.mod`/`go.sum` (goja) and `bun.lock`
(`packages/shared`'s new dependency).

`frontend/bindings/` is gitignored and regenerated by the Wails build; M4 adds no bound method
anyway.

## 12. Order and sizing

### 12.1 Implementation order

JS first, then Go, then the tool — each step green before the next, the discipline M1/M2/M3 all used.

1. `packages/shared/domain/fakegen.ts` + `packages/shared/fakegen/{generators,entry}.ts` +
   `packages/shared/package.json` + `types.ts`'s re-export. `bun run typecheck` and `bun run lint`
   green.
2. `scripts/build-fakegen.ts` + the `generate:fakegen` script + `biome.json`'s exclusion; generate
   and commit `faker.bundle.js`.
3. `internal/fakegen`: `bundle.go`, `catalog.go`, `engine.go`. `go build ./...` green.
4. Fixtures: generate `catalog-en.json` **from the TypeScript side**, then `engine_test.go` and
   `fakegen-parity.spec.ts`. `go test ./internal/fakegen/...` and `bun run test:unit` green.
5. `dbmcp`: `Config.Fake` + its required check, `generateFakeData`, the seventh `AddTool`, the
   instructions sentence.
6. `bridge/dbmcp.go` + `main.go` wiring.
7. Full `go test ./...`, `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run build`.

Commits per numbered step, Conventional Commits: `feat(fakegen):`, `feat(dbmcp):`, `build(fakegen):`
for the generated artifact, `test(fakegen):`.

Step 4 before step 5 is load-bearing for the same reason M3's step 2 was: the expected values must
come from the reference implementation, or the port is pinned to itself.

### 12.2 One pass, one fallback seam

One Sonnet pass. Smaller than M2 and much smaller than M3: 11 new files, 8 edits, and the largest
single piece of new logic is the ~120-line `engine.go`. The chain is short but strictly ordered —
the entry's function signatures in step 1 are what `engine.go` calls in step 3, and the fixture in
step 4 is what both halves read.

**Fallback seam — after step 4.** The bridge is then complete, tested and deterministic, with only
the MCP surface (steps 5–6, both mechanical: one handler, one `AddTool`, two struct fields)
remaining. A reader of the commit log sees a bridge land, then a tool land.

Do not split anywhere else. In particular never between steps 2 and 3, which would leave a committed
generated artifact nothing reads, and never between 5 and 6, which would leave a required `Config`
field nothing supplies — the server would refuse to start.

## 13. Out of scope, and the seams later phases plug into

Out, stated so it stays out entirely rather than half-built:

- **Locales beyond `en`** (§7.2). Adding one means: the bundle grows toward 2.40 MB (or gains
  per-locale bundles compiled on demand), `locale` becomes an argument and a stored axis in M5's
  rules, *and* the frontend needs the same locale for M5's preview to stay honest. One coherent piece
  of work or none.
- **Merging api-core's 57 `fake.*` names** (§7.1). The move, if ever wanted, is to grow the 24-id
  catalogue and `RECIPE_CATALOG` together, not to teach one tool two vocabularies.
- **Column-aware generation** — `maxLength` clamping, numeric precision, enum members. That is
  `generate.ts`'s job because it writes into a typed column (§7.3); this tool has no column.
- **Collapsing the three `fakerEntry.ts`-shaped files into one.** The existing two are duplicated on
  purpose (`http/**` may not import `views/**`) and this phase adds a third home in
  `packages/shared`, which both may import. Consolidating is a refactor of two shipped features for
  no behaviour change, and belongs to whoever has a reason.
- **Any write path.** `generate_fake_data` returns values; it never inserts them. Seeding a real
  table stays the Generate-data dialog's job (§6.3).
- **Caching generated values.** M5 owns memoization, where the repeat rate is known (§9.3).

Seams:

| Later phase | Seam |
|---|---|
| M5 anonymization | `Engine.Values` (§9.1) and `dbmcp.Config.Fake`'s interface, both landed by this phase; the transform still goes between `Query.Execute` and `renderPage`, M1 §9's unchanged single entry point |
| M5's grid/cell-editor preview | `packages/shared/fakegen/generators.ts` — the same record the bundle is built from, dynamically imported by the renderer exactly as `fakerEntry.ts` is today |
| M5's rule picker | `recipes.ts:16`-`44`'s `RECIPE_CATALOG` (label + `typeClass`es per id) and `NAME_HEURISTICS` — a "which generator for a column called `email`" table that already exists and already has tests |
| A later locale phase | `GenContext` (§3.1) already carries per-call context; `catalogVersion` already exists to record a value-changing bump |
| A later performance pass | faker's `randomizer` option (§9.3), behind a catalogue-version bump applied to both surfaces at once |

## 14. Dogfooding note

The repo-map MCP server was used throughout this planning pass, started per `CLAUDE.md`'s headless
steps and called over curl — the native tool surface does not appear in an agent-harness session, as
that section documents.

It did real work: `search_files` on "fakeData" enumerated all six files of the P15 surface in one
call; `outline_file` on `internal/bridge/dbmcp.go` gave all 24 declarations with line numbers —
§8's whole wiring table — without reading 400 lines; `read_symbol` on `jsonResult` and `errResult`
returned each function with its doc comment (§1.3's evidence) instead of `render.go`'s 270;
`search_symbols` on `GeneratorId` located the type and both fields named after it.

Four observations, for the log keeper to fold into `docs/v1.7/mcp-repo-map-issues.md`:

1. **Non-trivial, and it cost this pass something concrete — the `.vue` blind spot, reproduced on
   this phase's own material.** `find_references{"symbol":"GeneratorId"}` returns 5 references, all
   `.ts`. `grep -rn GeneratorId --include=*.vue` returns 3 more, in
   `workbench/GenerateDataDialog.vue` (`:21`, `:168`, `:187`) — the dialog that owns the generator
   picker, i.e. the single most relevant consumer for a phase about the generator catalogue. A
   planning pass that trusted the reference list would have missed it. Same class as v1.6's
   P60a/P63/P67e entries, but worth recording that it bites on a *type* consumed from a `.vue`
   script block, not only on symbols declared in one.
2. **M1c's field fix confirmed again, on unrelated material.** `search_symbols{"query":
   "GeneratorId"}` returns `field NameHeuristic.generatorId` and `field Recipe.generatorId` with
   exact lines, in TypeScript — the TS half of M1c's extension. Closure evidence, not a new finding.
3. **The token-plaintext restart cost recurred, a third time.** M3's observation #4 described it;
   this pass hit it identically: the running server printed "Using this repository's existing token,
   valid until 2026-09-22T13:00:44Z" and no command, so the only route to a usable token was
   `CLAUDE.md`'s documented one — kill the server, delete `mcp-repo-map-*-token.json`, restart. Three
   consecutive planning passes have now paid this. Worth promoting from an observation to a line in
   `CLAUDE.md`'s own section ("a fresh session must plan to re-mint"), since it is now clearly the
   normal case rather than an incident.
4. **`pgrep -af` self-match reconfirmed, exactly as v1.7's existing entry describes.** `pgrep -af
   "mcp-repo-map"` returned two rows: the real `bun run scripts/mcp-repo-map.ts` and this session's
   own `/bin/bash -c … pgrep …`. Killing by the PID read out of that output works; piping it into
   `kill` would have killed the shell.
