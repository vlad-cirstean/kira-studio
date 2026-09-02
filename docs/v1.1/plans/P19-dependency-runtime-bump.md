# P19 — Dependency and runtime version bump

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md:34`, the P19 row, verbatim):
> *"Bump every dependency this repo tracks — root `package.json` and any workspace packages,
> `shell/go.mod`, the Go toolchain version, the Node/Bun runtime versions pinned anywhere, and any
> other pinned toolchain version — to the latest available stable release, and fix whatever breaks
> as a result: compile errors, failing tests, deprecated APIs, config-format changes the new
> versions expect."* Why: *"P5-P10's feature and perf work is substantive enough that bumping first
> would mean chasing a moving target while it's still landing; doing it after that work is stable
> and before P12's own review rounds and P20's docs sweep means both of those run against the final,
> up-to-date dependency set instead of one about to go stale under them."*
>
> (The row still says `shell/go.mod`; P3 moved the module to the repo root, so the file this row
> means is `go.mod`. Same for "any workspace packages": the one workspace member,
> `apps/kira-studio/frontend/package.json`, declares no dependencies of its own — §1.1.)
>
> **⚠ This phase is being run out of order, before P12.** See §0.1 — it changes nothing about what
> P19 does, but it does invalidate half of the SPEC row's own stated rationale, and that is recorded
> plainly rather than absorbed.
>
> **The headline, in one line: of 39 npm pins and 28 direct Go modules, 50 are already at the latest
> stable release, 17 need a patch/minor bump, exactly two are majors (`vite` 7→8 and `typescript`
> 5.9→6/7), and the single most consequential change in the phase is not a dependency at all — it is
> the Go directive, `go 1.25.0` → `go 1.27.0`, two releases at once.**
>
> **Two of the three "obvious" bumps are traps, and both are declined here with evidence.**
> **TypeScript 7.0.2 is stable and this repo must not take it**: TS7 ships no stable programmatic
> compiler API until 7.1, and `vue-tsc` — which is what `bun run typecheck:web` runs — consumes that
> API in-process (F2). **`flatbuffers` looks like a routine Go patch and is not**: the Go module, the
> npm package and `scripts/generate-wire.sh`'s pinned `flatc` are three pins on *one* version, and
> npm has never published the 25.12.19 the Go proxy offers, so the only self-consistent move is to
> hold all three (F8).
>
> **The Go bump is the one with a real blast radius, and it is not the compiler.** Go 1.26 makes
> `net/url.Parse` reject malformed colons in the host — and seven adapter clients parse a
> user-supplied connection URI through exactly that call (F12) — and turns the Green Tea GC on by
> default, which moves the very numbers P5 and P7 spent whole phases measuring. P7's darwin-cgo
> build-tag split and P14's `LocalAuthentication` cgo shim are *not* affected in kind: the build
> constraints `darwin && cgo` / `!darwin || !cgo` mean exactly what they meant in 1.25 (F13).
>
> **P16 handed this phase two named items and they are both real.** OQ-3: three default container
> images are stale (`mongo:7`, `redis:7`, `localstack/localstack:3`) and P16 deliberately left them
> because changing a default changes what regular CI runs. OQ-4: `go-redis` v9.22.0's README now
> lists Redis 8.10 as supported, so the compat matrix's redis ceiling can move off 8.8 honestly for
> the first time (F14, F15).
>
> All version data below was researched on **2026-09-02** against the live npm registry,
> `proxy.golang.org`, `go.dev/dl`, Docker Hub's tag API and each project's own release notes — not
> from memory. Every "latest" is cited.

---

## 0. What this phase is, and what it is not

### 0.1 This phase runs before P12, and that is a deviation worth naming

`docs/v1.1/SPEC.md`'s P19 row justifies its own position in the list partly like this: *"doing it
… before P12's own review rounds and P20's docs sweep means both of those run against the final,
up-to-date dependency set instead of one about to go stale under them."* An earlier draft of the
spec had P12 (code review, two iterations) running *before* the dependency bump; the row as written
already assumes the opposite.

**The user has asked for P19 to run now, ahead of P12.** Consequences, stated plainly:

- **What does not change.** Nothing about P19's own work. The inventory, the target versions, the
  breakage to fix, the verification — all identical whether P12 has run or not. This plan is
  written against the tree as it stands at `5d19165` (P18 complete).
- **What does change.** P12's two review iterations will now run against the *post-bump* dependency
  set: Go 1.27, Vite 8/Rolldown, whatever TypeScript this phase lands on, bumped drivers. Read one
  way that is strictly better than the SPEC's own plan — P12 will be reviewing the code in the
  versions that actually ship, and a review round that finds a bug in a library version the repo is
  about to leave behind is wasted effort.
- **What is genuinely lost.** The SPEC row's rationale is *bidirectional* and only one direction
  survives. The row wanted P19 late so it wouldn't chase a moving target ("P5-P10's feature and perf
  work is substantive enough that bumping first would mean chasing a moving target"). P18 has
  landed, so that half holds. But running P19 *before* P12 means **P12's fixes land on top of a
  freshly bumped dependency set that has had no review pass over it** — the churn this phase creates
  (a Rolldown bundler swap, a two-release Go jump, possibly a TypeScript major) is exactly the kind
  of change a review round is good at catching problems in, and P12 will now be reviewing both the
  app's own logic *and* the fallout of this phase in the same pass. That is more surface per round,
  not less.
- **The honest summary.** This is a real reordering with a real trade, not a formality. It is very
  probably the better order — but the cost is that P19's own fallout gets reviewed by the same two
  P12 iterations that were scoped to review P3-P18's feature work, rather than by a round of its
  own. P12's plan should be written knowing that.

Nothing in this plan is contingent on that decision. It is recorded here because the plan doc and
the commit log are this repo's durable record (`AGENTS.md`), and a silently-reordered phase list is
exactly the kind of thing that reads as an accident a year later.

### 0.2 Baseline

Tree at `5d19165` (`docs(agents): pin the exact wails3 bindings regeneration command`), branch
`claude/feature-v1-1-p5-onwards-2isfzt`. Verified green in this sandbox before any of the research
below:

- `bun run lint` → `Checked 358 files in 511ms. No fixes applied.` exit 0.
- `go build ./apps/kira-studio/internal/...` → exit 0.
- `apps/kira-studio/frontend/bindings/` exists and `wails3` (beta.15) is on `PATH`, so
  `bun run typecheck` / `bun run build` are runnable here without re-provisioning.
- Local toolchains in this sandbox: `go version go1.25.0 linux/amd64`, `bun 1.3.11`.

One pre-existing failure is carried, not caused: `TestFixture_Redis`
(`apps/kira-studio/internal/ipcfixture/redis_test.go`) fails against a fresh `redis:7` container
here with a one-key count drift (`AGENTS.md`, Known open items). It is directly relevant to C8 —
see F16.

### 0.3 Scope

1. **Enumerate every version pin in the repo** (§1) — not just `package.json` and `go.mod`, but the
   pins that live in a shell script, a JSON `$schema` URL, a Go constant and a workflow `uses:`.
2. **Establish the real latest stable for each** (§2), cited, researched today.
3. **Bump everything that is safe, gate everything that is not, and log — with a reason — anything
   deliberately left behind** (§5, §6). No pin is skipped silently.
4. **Fix what the bumps break** — compile errors, type errors, failing tests, deprecated APIs,
   config-format changes — as part of the same commit that caused them.
5. **Prove nothing regressed** (§7), including the specific proof P16 earned: if a DB driver or a
   default server image moves, the adapter conformance suites run again against real containers.

### 0.4 Not in this phase

- **TypeScript 7.0.2.** Declined with evidence (F2, D3). It is the newest stable `typescript` on
  npm and taking it would break `bun run typecheck:web`.
- **Vue 3.6.** `vue`'s `latest` dist-tag is `3.5.42`; 3.6 is at `3.6.0-rc.6` (§2.1). "Latest
  available stable release" is 3.5.42. P6 already declined Vapor mode on its own merits and
  `docs/ARCHITECTURE.md:653` already records that a future 3.6 upgrade keeps VDOM mode — nothing
  here revisits that.
- **A `renovate.json` / `dependabot.yml`.** The repo has neither (`.github/` holds only
  `workflows/`). Adding automated dependency PRs is a process change, not a version bump, and
  `AGENTS.md`'s "no per-phase PRs, one feature branch" makes bot PRs an awkward fit. Handed forward
  as OQ-3.
- **Bumping the `macos-15` runner image to `macos-26`.** Available and GA, and deliberately not
  taken — see F18. It changes the macOS SDK the shipped binary links against, which is a product
  decision about the minimum macOS version, not a dependency bump.
- **Raising `MIN_SERVER_VERSION`'s user-facing strings** (`packages/shared/domain/connection.ts:36-45`).
  No driver's documented *floor* moved in any bump this phase takes (F14), so the notes P16 verified
  stay exactly as they are. Changing them without a driver floor moving would be fabricating a
  claim, which is precisely what P16 §2's "the published minimum is the verified minimum" rule
  forbids.
- **New tests.** `AGENTS.md`'s bar is explicit and a dependency bump generates no logic to test.
  The existing suites — six adapter conformance packages, `tests/ui`, `tests/unit`, `tests/ipc`,
  `tests/e2e-real`, `verify:packaging` — *are* this phase's test. The one new artefact is a
  regenerated fixture, if C8 moves one (C9).
- **P16's OQ-1, OQ-2, OQ-5.** A 5.7-compatible MySQL seed, a connect-time version gate, and
  unifying `e2e-real`'s three image pins with the Go side. All were deliberately handed forward by
  P16 as work in their own right; none is a version bump.

### 0.5 Ground rules

- **Every pin gets *checked*; not every pin gets *bumped*.** The phase's deliverable is that no
  version in this repo is stale by accident. A version left behind is fine — a version left behind
  without a written reason is not. §5.3 is the exception log and it is part of the deliverable.
- **A config change to satisfy a new default is a bump; disabling a new default is a shortcut.**
  Concretely, for TypeScript 6: setting `rootDir` explicitly because the default moved is adapting
  to a config-format change (in scope, that is literally what the SPEC row asks for). Setting
  `noUncheckedSideEffectImports: false` to silence a new check is turning the upgrade off, and
  `AGENTS.md`'s "best practices throughout, no shortcuts" forbids it — if that is what it takes,
  the bump is deferred with a reason instead.
- **Never weaken an assertion to make a bump pass.** Same rule P16 §2 set for version assertions,
  applied to the whole phase. If a bumped library changes behaviour, either the app changes to match
  or the bump is deferred; a test never gets relaxed to accommodate it.
- **One dependency domain per commit, majors alone.** §6's order is safe-first precisely so that
  when something breaks, the commit that broke it is unambiguous.
- **Research, don't remember.** Every version in §2 was fetched today. A Sonnet implementer must
  still re-fetch before pinning — see D14 — because these numbers age in days.

---

## 1. Every version pin this repo has

### 1.1 npm — one manifest, 39 pins, `exact = true`

`bunfig.toml:1-2` sets `[install] exact = true`, so every entry in `package.json` is an exact
version with no range prefix — a bump is a literal string edit, and there is no "already satisfied
by the range" ambiguity anywhere.

`package.json:33-73` — 37 `devDependencies` (`:33-69`) + 2 `dependencies` (`:70-73`). The full list,
with line numbers, is the left column of §2.1.

**The workspace has exactly one other member and it declares nothing.** `package.json:8-10` sets
`"workspaces": ["apps/*/frontend"]`, and `apps/kira-studio/frontend/package.json` (10 lines) has a
`scripts` block and no `dependencies`/`devDependencies` at all. `packages/db-fixtures/` and
`packages/shared/` are plain source directories with no `package.json`. **So the root manifest is
the entire npm surface** — the SPEC row's "any workspace packages" resolves to nothing to do.

### 1.2 Go — one module, 28 direct requires, 80 indirect

`go.mod:1` `module github.com/kirathecat/kira-studio`, `go.mod:3` `go 1.25.0`, `go.mod:5-32` the
direct `require` block (28 modules), `go.mod:34-115` the indirect block (80 modules). Full direct
list in §2.2.

### 1.3 Toolchain and tool pins that do not live in a manifest

These are the ones an implementer who only reads `package.json` and `go.mod` will miss. All six are
in scope.

| # | Pin | Where | Value today |
|---|---|---|---|
| T1 | Go language/toolchain directive | `go.mod:3` | `go 1.25.0` (no `toolchain` line) |
| T2 | `flatc` compiler | `scripts/generate-wire.sh:14` `FLATC_VERSION=25.9.23`, plus three release-asset SHA-256s at `:27`, `:40`, `:45` | 25.9.23 |
| T3 | Biome config schema | `biome.json:2` `https://biomejs.dev/schemas/2.5.10/schema.json` | 2.5.10 |
| T4 | `wails3` CLI | **derived, not pinned separately** — `scripts/wails-dev-setup.sh:21` and both workflows (`ci.yml:33`, `:62`, `release.yml:45`) `grep` the version out of `go.mod` and `go install` exactly that | tracks `go.mod:29` |
| T5 | GitHub Actions | `ci.yml:22,23,26,49,50,53,71,83,84,87,101,102,105`, `release.yml:21,22,25,88`, `docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml:24,25` | `checkout@v4`, `setup-go@v5`, `setup-bun@v2`, `upload-artifact@v4` |
| T6 | CI runner images | `ci.yml:19,46,80,98`, `release.yml:16` | `macos-15`, `ubuntu-latest` |

**T4 is a good design and this phase must not break it.** Because the CLI version is derived from
`go.mod`, bumping Wails is a one-line change that propagates to the dev script and both workflows
automatically. `AGENTS.md` is emphatic about why: an `@latest` install once resolved a beta ahead of
the runtime library and silently skewed the bindings generator. Nothing in this phase should
introduce a second, independent Wails pin.

### 1.4 What is *not* pinned — the Node/Bun half of the SPEC row

The SPEC row asks for "the Node/Bun runtime versions pinned anywhere". Searched exhaustively
(`.nvmrc`, `.node-version`, `.tool-versions`, `.bun-version`, `engines`, `packageManager`,
`volta`, Dockerfiles):

- **There is no `.nvmrc`, `.node-version`, `.tool-versions` or `.bun-version`** anywhere in the
  repo.
- **`package.json` has no `engines` and no `packageManager` field.**
- **There is no Dockerfile at all.** The only compose file is
  `scripts/demo-dbs/docker-compose.yml`, which starts demo database servers and pins no toolchain.
- **CI pins Bun as `bun-version: latest`** (`ci.yml:25`, `:51`, `:89`, `:107`; `release.yml:24`),
  i.e. it already floats to whatever Bun is current on the day the job runs.
- The only Bun *version* string in the repo is the **type package** `bun-types` at
  `package.json:58`, and it is already `1.4.0` — which is Bun's own current `latest` (§2.3).
- **There is no vendored Node runtime any more** (`AGENTS.md`, P58f M10) and nothing at runtime
  depends on Node or Bun: every adapter is native Go (`docs/ARCHITECTURE.md:27`).

**So the Node/Bun clause of the SPEC row has no work in it** beyond confirming `bun-types` matches
Bun's `latest`, which it does. That is a finding, not an omission — recorded here so P20's docs
sweep and any future reader can see it was checked rather than skipped.

### 1.5 Container image pins — three independent sets

Not dependencies in the manifest sense, but they are pinned versions this repo tracks, they are the
thing P16 just spent real container time on, and P16 explicitly handed three of them to this phase.

**Set A — the eight default images the regular `bun run test:go` uses** (one constant per kind):

| File:line | Constant | Value |
|---|---|---|
| `testsupport/postgres.go:56` | `defaultPostgresImage` | `postgres:17-alpine` |
| `testsupport/mariadb.go:29` | `mariaImage` | `mariadb:11.4` |
| `testsupport/mysql.go:29` | `mysqlImage` | `mysql:8.4` |
| `testsupport/clickhouse.go:31` | `clickhouseImage` | `clickhouse/clickhouse-server:26.3` |
| `testsupport/mongo.go:23` | `MongoImage` | `mongo:7` |
| `testsupport/redis.go:19` | `RedisImage` | `redis:7` |
| `testsupport/kafka.go:29` | `kafkaImage` | `confluentinc/cp-kafka:8.0.7` |
| `testsupport/localstack.go:20` | `LocalStackImage` | `localstack/localstack:3` |

(All under `apps/kira-studio/internal/adapters/testsupport/`.)

**Set B — `scripts/db-compat.sh:40-55`'s sixteen-row min/max matrix**, P16's deliverable. Each is a
deliberate, evidence-backed choice recorded in P16 §3, not a casual pin.

**Set C — `packages/db-fixtures/support/`'s three `e2e-real` images**, pinned independently of Set A
(`postgres.ts:10` `postgres:17-alpine`, `mariadb.ts:10` `mariadb:11.4`, `kafka.ts:17`
`confluentinc/cp-kafka:8.0.7`). P16's OQ-5 explicitly left unifying them out of scope; this phase
keeps them consistent with Set A rather than unifying the mechanism.

---

## 2. The version table — pinned today vs. latest available

**Researched 2026-09-02.** npm figures come from `registry.npmjs.org/<pkg>`'s `dist-tags.latest`
(cross-checked with `bun outdated`); Go figures from `go list -m -u` against `proxy.golang.org`; Go
toolchain from `https://go.dev/dl/?mode=json`; container tags from
`https://hub.docker.com/v2/repositories/<repo>/tags/<tag>` (HTTP 200 = exists).

### 2.1 npm — 28 of 39 already current

**Already at `latest` — no action (28):** `flatbuffers` 25.9.23 (`:71`, see F8),
`@codemirror/autocomplete` 6.20.3 (`:35`), `@codemirror/commands` 6.11.0 (`:36`),
`@codemirror/lang-json` 6.0.2 (`:37`), `@codemirror/lang-sql` 6.10.0 (`:38`),
`@codemirror/lang-xml` 6.1.0 (`:39`), `@codemirror/language` 6.12.4 (`:40`), `@codemirror/lint` 6.9.7
(`:41`), `@faker-js/faker` 10.6.0 (`:44`), `@lezer/highlight` 1.2.3 (`:45`), `@playwright/test`
1.62.1 (`:46`), `@tailwindcss/vite` 4.3.3 (`:47`), `@tanstack/vue-virtual` 3.13.36 (`:48`),
`@testcontainers/{kafka,mariadb,postgresql}` 12.1.0 (`:49-51`), `@types/pg` 8.23.1 (`:53`),
`@typescript/native-preview` 7.0.0-dev.20260707.2 (`:54`, see F4), `@vitejs/plugin-vue` 6.0.8
(`:55`), `@vscode/codicons` 0.0.46-24 (`:56`, see §3), `bun-types` 1.4.0 (`:58`), `pg` 8.23.0
(`:60`), `sql-formatter` 15.8.2 (`:62`), `tailwindcss` 4.3.3 (`:63`), `testcontainers` 12.1.0
(`:64`), `vue-tsc` 3.3.11 (`:68`).

**Needs a bump (11):**

| Package (`package.json:`line) | Pinned | Latest | Δ | Published | Risk |
|---|---|---|---|---|---|
| `@biomejs/biome` (`:34`) | 2.5.10 | **2.5.11** | patch | 2026-08-27 | none — but `biome.json:2`'s `$schema` URL must move with it (F19) |
| `@codemirror/state` (`:42`) | 6.7.1 | **6.7.2** | patch | 2026-08-31 | none |
| `@codemirror/view` (`:43`) | 6.43.9 | **6.43.10** | patch | 2026-08-31 | none |
| `@types/node` (`:52`) | 26.3.0 | **26.4.1** | minor | 2026-09-01 | types-only |
| `@wailsio/runtime` (`:57`) | 3.0.0-beta.15 | **3.0.0-beta.16** | prerelease | 2026-08-29 | must move atomically with `go.mod:29` (F9) |
| `mariadb` (`:59`) | 3.5.3 | **3.5.4** | patch | 2026-09-01 | test-only (`e2e-real` seeding) |
| `simple-icons` (`:61`) | 16.28.0 | **16.29.0** | minor | 2026-08-29 | additive icon set |
| `vue` (`:67`) | 3.5.41 | **3.5.42** | patch | 2026-08-27 | none. 3.6 is `rc.6`, not stable |
| `zod` (`:72`) | 4.4.3 | **4.5.4** | minor | 2026-08-29 | additive (`z.compile`, `z.validate`, new validators); no removals |
| **`vite`** (`:66`) | 7.3.6 | **8.2.2** | **MAJOR** | — | **Rolldown replaces Rollup+esbuild** — F5 |
| **`typescript`** (`:65`) | 5.9.3 | **7.0.2** (6.0.3 also available) | **MAJOR ×2** | 7.0.2 on 2026-07-08 | **7 breaks `vue-tsc`** — F2/F3; target is 6.0.3 |

### 2.2 Go modules — 22 of 28 direct already current

**Already at latest — no action (22):** `aws-sdk-go-v2` v1.45.1, `smithy-go` v1.28.1,
`go-sql-driver/mysql` v1.10.0, `google/go-cmp` v0.7.0, `google/uuid` v1.6.0, `jackc/pgx/v5` v5.10.0,
`keybase/go-keychain` v0.0.1, `testcontainers-go` + its five modules v0.44.0, `twmb/franz-go`
v1.21.6, `franz-go/pkg/kadm` v1.18.0, `franz-go/pkg/kmsg` v1.13.1,
`go.mongodb.org/mongo-driver/v2` v2.8.2, `modernc.org/sqlite` v1.57.0.

**Needs a bump (6):**

| Module (`go.mod:`line) | Pinned | Latest | Δ | Risk |
|---|---|---|---|---|
| `aws-sdk-go-v2/config` (`:7`) | v1.31.15 | **v1.33.2** | minor | routine |
| `aws-sdk-go-v2/credentials` (`:8`) | v1.18.19 | **v1.20.2** | minor | routine |
| `aws-sdk-go-v2/service/s3` (`:9`) | v1.109.1 | **v1.110.0** | minor | s3 adapter — conformance suite covers it |
| `aws-sdk-go-v2/service/sqs` (`:10`) | v1.48.1 | **v1.50.0** | minor | sqs adapter — conformance suite covers it |
| `redis/go-redis/v9` (`:18`) | v9.20.0 | **v9.22.0** | minor | **DB driver** — F14 |
| `shirou/gopsutil/v4` (`:19`) | v4.26.7 | **v4.26.8** | patch | P7's metrics fall back to it on non-darwin |
| `wailsapp/wails/v3` (`:29`) | v3.0.0-beta.15 | **v3.0.0-beta.16** | prerelease | F9 |
| `google/flatbuffers` (`:13`) | v25.9.23+incompatible | v25.12.19+incompatible | **HELD** | F8 |

**No major-version module path exists for any direct dependency.** Probed
`pgx/v6`, `go-redis/v10`, `mongo-driver/v3`, `franz-go/v2`, `aws-sdk-go-v3`, `sqlite/v2`,
`mysql/v2`, `uuid/v2`, `gopsutil/v5`, `testcontainers-go/v2`, `go-keychain/v2`, `kadm/v2` against
the module proxy on 2026-09-02 — every one returns *no matching versions*. **The entire Go side of
this phase is patch/minor. There is no Go major-bump risk to manage at all** (F10).

Indirect modules (80, `go.mod:34-115`) move as a consequence of `go mod tidy`; notable ones offered
an update today are `stretchr/testify` v1.11.1→v1.12.1, `sirupsen/logrus` v1.9.4→v1.10.2,
`klauspost/compress` v1.18.7→v1.19.2, `coder/websocket` v1.8.14→v1.8.15, `docker/go-connections`
v0.7.0→v0.8.1, `moby/*`. All are transitively required by `testcontainers-go` or Wails — see D6 for
why they are bumped by `go get -u ./...` rather than pinned by hand.

### 2.3 Toolchains

| Pin | Today | Latest stable | Notes |
|---|---|---|---|
| **Go** (`go.mod:3`) | `go 1.25.0` | **1.27.1** (`go.dev/dl`, `"stable": true`) | Two releases. 1.26 shipped Feb 2026, 1.27 Aug 2026. F11/F12 |
| **Bun** | unpinned (`bun-version: latest` in CI) | 1.4.0 | `bun-types` already 1.4.0 = match. Nothing to change (§1.4) |
| **Node** | not pinned anywhere, not a runtime dependency | — | Nothing to change (§1.4) |
| **`flatc`** (`generate-wire.sh:14`) | 25.9.23 | 25.12.19 exists upstream | **HELD** — F8 |
| **Biome schema** (`biome.json:2`) | 2.5.10 | 2.5.11 | Moves with the package (F19) |
| **`wails3` CLI** | derived from `go.mod:29` | — | Moves with C3 automatically (T4) |

**The Go toolchain jump is provably runnable in this sandbox.** `GOTOOLCHAIN` is `auto` here and
`GOTOOLCHAIN=go1.27.1 go version` downloaded and ran `go1.27.1 linux/amd64` successfully on
2026-09-02. So raising `go.mod:3` to `1.27.0` does not strand a Sonnet implementer on a box with
Go 1.25 installed — the toolchain fetches itself from `proxy.golang.org`, which `AGENTS.md` already
confirms is reachable. CI needs no change either: both workflows use
`actions/setup-go` with `go-version-file: go.mod`, which reads the new directive.

### 2.4 GitHub Actions and runner images

| `uses:` | Pinned | Latest | Δ |
|---|---|---|---|
| `actions/checkout` | `@v4` | **v7.0.1** | **3 majors** |
| `actions/setup-go` | `@v5` | **v7.0.0** | **2 majors** (v7 = ESM migration) |
| `actions/upload-artifact` | `@v4` | **v7.0.1** | **3 majors** |
| `oven-sh/setup-bun` | `@v2` | **v2.2.0** | current major — no change |
| runner | `macos-15` | `macos-26` GA since 2026-02-26 | **deliberately held** — F18 |

### 2.5 Container images

| Kind | Default pin | Newest published tag | Verified |
|---|---|---|---|
| postgres | `postgres:17-alpine` | 18 line exists (`postgres:18-alpine` → 200) | already the compat MAX; default is current-ish, P16 F12 |
| mariadb | `mariadb:11.4` | `mariadb:12.3` → 200 | 11.4 is a supported LTS; P16 F12 calls it reasonable |
| mysql | `mysql:8.4` | `mysql:9.7` → 200 | 8.4 is the LTS; P16 F12 calls it reasonable |
| clickhouse | `clickhouse/clickhouse-server:26.3` | 26.8 | P16 F12 calls it reasonable |
| kafka | `confluentinc/cp-kafka:8.0.7` | 8.3.0 | P16 F12 calls it reasonable |
| **mongo** | **`mongo:7`** | `mongo:8.3` → 200 (`8.4` → 404) | **stale — P16 OQ-3** |
| **redis** | **`redis:7`** | `redis:8.10` → 200 | **stale, and below go-redis's official floor — P16 OQ-3/F5** |
| **localstack** | **`localstack/localstack:3`** | `localstack/localstack:4` → 200 | **stale — P16 OQ-3** |

---

## 3. Findings

### F1 — The whole phase has exactly two majors, and both are on the npm side

50 of 67 tracked direct pins are already current; 15 are patch/minor; **two are majors** (`vite`,
`typescript`) and both are frontend tooling. The Go side has no major available at any path (§2.2).
This is what makes a complete sweep realistic in one phase rather than an unbounded chase — the
"latest available stable" target is *already met* for three quarters of the surface, the bulk of the
rest is mechanical, and the judgment calls concentrate in four places: TypeScript, Vite, the Go
directive, and the three stale default images.

### F2 — TypeScript 7.0.2 is stable, and taking it would break `bun run typecheck:web`

`registry.npmjs.org/typescript` on 2026-09-02: `dist-tags.latest` = **7.0.2**, published
2026-07-08. The 6.x line published 6.0.2 and 6.0.3. So "latest available stable release" literally
means 7.0.2 — and this repo cannot take it.

**Why.** TypeScript 7 is the Go-native port. It ships **no stable programmatic compiler API** until
7.1; anything that imports the compiler *as a library* must stay on 6.0. `vue-tsc` is exactly that:
`vue-tsc@3.3.11`'s dependencies are `@volar/typescript@2.4.28` and `@vue/language-core@3.3.11`,
which drive template type-checking for `.vue` files through the TS compiler API in-process. Its
`peerDependencies` are `typescript: ">=5.0.0"` — permissive enough to *install* against 7.0.2 and
not a statement that it works. `vuejs/language-tools` tracks TS7 support as an open issue (#5381)
and discussion (#6121); the ecosystem-wide answer is that the stable API lands in **7.1, expected
around October 2026**.

`package.json:17` runs `typecheck:web` as `vue-tsc --noEmit -p apps/kira-studio/frontend/tsconfig.json`
and `ci.yml:38` / `release.yml:51` both run `bun run typecheck`. Breaking `vue-tsc` breaks CI and
the release pipeline.

**The ceiling for this repo is therefore `typescript@6.0.3`.** This is the same wall
`docs/ARCHITECTURE.md:26` already anticipated in prose — *"converge on one toolchain once `vue-tsc`
runs on TS7"* — and P19 is not the phase where that becomes possible.

### F3 — TypeScript 6.0's breaking changes, checked one by one against this repo's four tsconfigs

TS 6.0's headline breakages, and what each does here. The four configs are `tsconfig.json` (root, 3
lines, `files: []` + one reference), `apps/kira-studio/tsconfig.json` (project references only),
`apps/kira-studio/frontend/tsconfig.json`, `apps/kira-studio/tsconfig.tests.json`, and
`apps/kira-studio/tests/unit/tsconfig.json`.

| TS 6.0 change | Effect here |
|---|---|
| `strict` defaults to `true` | **No-op.** All three real configs already set `"strict": true` (`frontend:6`, `tests:6`, `unit:6`) |
| `types` defaults to `[]` | **No-op.** All three already set it explicitly: `["vite/client"]`, `["node"]`, `["bun-types"]` |
| `module` defaults to `esnext`, `target` to `es2025` | **No-op.** All three set `"target": "ES2022"` and `"module": "ESNext"` explicitly |
| `moduleResolution: node10`/`classic` removed | **No-op.** All three use `"moduleResolution": "Bundler"` |
| `--baseUrl` removed | **No-op.** No config sets `baseUrl`; all path mapping is via `paths` with relative prefixes |
| `target: es5`, `downlevelIteration`, `outFile`, AMD/UMD/SystemJS modules removed | **No-op.** None used |
| `esModuleInterop`/`allowSyntheticDefaultImports` forced on | **Probably no-op.** No config sets either; the change makes interop *safer*, and `verbatimModuleSyntax: true` is already on everywhere |
| **`rootDir` now defaults to the tsconfig's own directory** | **The real risk.** All three configs `include` files *outside* their own directory: `frontend/tsconfig.json:23` pulls `../../../packages/shared/**/*.ts`; `tsconfig.tests.json:16-22` pulls `../../packages/{shared,db-fixtures}/**`; `tests/unit/tsconfig.json:22` pulls `../../frontend/src/env.d.ts` and `../support/**`. A default `rootDir` of the config's own directory can produce TS6059 ("file is not under rootDir") for every one of those. **The fix is one explicit `"rootDir"` line per config** pointing at the repo root — legitimate config-format adaptation, exactly what the SPEC row calls for |
| **`noUncheckedSideEffectImports` defaults to `true`** | **One call site to check.** `apps/kira-studio/frontend/src/main.ts:13` is `import './theme/base.css';`, the only bare side-effect import of a non-TS asset in the tree. `frontend/tsconfig.json:11` already sets `"types": ["vite/client"]`, and `vite/client` declares `*.css` modules — so this should resolve cleanly. Verify, don't assume |
| Legacy `module Foo {}` syntax errors; `assert` import attributes → `with` | **No-op.** Neither construct appears in the tree |

**Conclusion: TS 6.0 is a plausible, bounded bump for this repo** — mostly because the configs were
already written strictly. The two live risks are `rootDir` and the one CSS import, both cheap to
check. It is still gated in §6 (its own commit, after everything else) because a major is a major.

### F4 — `@typescript/native-preview` is frozen upstream and is already at npm-latest

`package.json:54` pins `@typescript/native-preview@7.0.0-dev.20260707.2`, and that **is** the
package's `dist-tags.latest` — 401 versions published, the newest on 2026-07-07, `time.modified`
2026-07-07, no `deprecated` flag. Its own README now says: *"For TypeScript 7.0 RC and later, use
`tsc` just like for TypeScript 6.0… This package is intended for testing and experimentation. It
will eventually be replaced by the official TypeScript package."*

The package stopped publishing the day before `typescript@7.0.2` shipped. `tsgo` — which
`package.json:18` and `:19` use for `typecheck:tests` and `typecheck:unit` — is therefore a
standalone binary that is (a) already at its own latest, and (b) superseded but not yet removable,
because the thing that supersedes it (`typescript@7`) is the thing `vue-tsc` can't take (F2).

**It stays, at the version it's on, and this is not a skipped bump — there is nothing newer.**
Retiring `tsgo` in favour of a single `tsc` is the "converge on one toolchain" work
`docs/ARCHITECTURE.md:26` describes, and it becomes possible when TS 7.1 lands. Handed forward as
OQ-1.

### F5 — Vite 8 is a bundler swap, and this repo's config uses exactly one renamed option

Vite 8.0 replaces the Rollup+esbuild pair with **Rolldown**, a single Rust bundler. The breaking
surface, and what it touches here:

| Vite 8 breaking change | Effect on this repo |
|---|---|
| `build.rollupOptions` → `build.rolldownOptions` (old name kept with a deprecation warning) | **The one hit.** `apps/kira-studio/frontend/vite.config.ts:40` is the repo's only `rollupOptions`, carrying `external: [/^\/wails\//]` — the rule that keeps the generated bindings' `"/wails/runtime.js"` import literal. Rename it; keep the regex |
| `esbuild` config block → `oxc`; `transformWithEsbuild` → `transformWithOxc` | **No-op.** Grepped the tree: no `esbuild:` config block, no `transformWithEsbuild` call, no `esbuild` dependency in `package.json`. The only `esbuild` mentions left are prose comments in `tests/ui/support/*.ts` describing a workaround P58f deleted |
| Rollup hooks removed (`shouldTransformCachedModule`, `resolveImportMeta`, `renderDynamicImport`, `resolveFileUrl`) | **No-op for this repo's own code** — there are no custom Vite plugins in the tree; only `@vitejs/plugin-vue` and `@tailwindcss/vite`, both of which declare vite `^8` support (F6) |
| AMD and SystemJS output formats dropped | **No-op.** Default ESM output |
| CJS interop changes (`legacy.inconsistentCjsInterop` escape hatch) | **Low risk** — the frontend graph is ESM throughout. Watch the two dynamic-import chunks (`sql-formatter`, `@faker-js/faker`) |
| Node engine `^20.19.0 \|\| >=22.12.0` | **No-op.** Builds run under Bun 1.4 / CI's `bun-version: latest` |

**`vite.config.ts` is the only Vite config in the repo** (one `find` result) and Playwright does not
run a Vite dev server — `tests/ui` and `tests/ipc:fe` drive a static file server against
`frontend/dist` (`AGENTS.md`), so the dev-server half of Vite 8 is not on any test path.

### F6 — Both Vite plugins already declare Vite 8 support

Straight from the registry on 2026-09-02:

- `@vitejs/plugin-vue@6.0.8` → `peerDependencies: { vue: "^3.2.25", vite: "^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0" }`
- `@tailwindcss/vite@4.3.3` → `peerDependencies: { vite: "^5.2.0 || ^6 || ^7 || ^8" }`

Neither needs a version change to accept Vite 8; both are already at their own latest. So the Vite
major does **not** cascade into a plugin-compatibility hunt — which is the usual reason a Vite major
becomes a multi-day chase.

### F7 — Vue 3.6 is not stable, and `vue` is a one-patch bump

`registry.npmjs.org/vue`'s `dist-tags` on 2026-09-02: `latest: 3.5.42`, `rc: 3.6.0-rc.6`,
`beta: 3.6.0-beta.17`, `alpha: 3.6.0-alpha.7`. **Latest stable is 3.5.42**, one patch above the
pinned 3.5.41. There is no Vue major or minor decision in this phase at all.

Worth stating because P6 evaluated and declined Vapor mode and `docs/ARCHITECTURE.md:653` already
says *"A future Vue 3.6 upgrade keeps VDOM mode"* — someone reading "bump every dependency to
latest" could reasonably wonder whether P19 is where 3.6 arrives. It is not, because 3.6 is not
stable.

### F8 — `flatbuffers` is three pins on one version, and npm has not published the newest

`github.com/google/flatbuffers` offers `v25.12.19+incompatible` on the Go proxy. Taking it looks
like a routine minor. It is not, because **this repo pins the same FlatBuffers version in three
places that must agree**:

1. `go.mod:13` `github.com/google/flatbuffers v25.9.23+incompatible` — the Go runtime library the
   generated `apps/kira-studio/internal/page/wire/*.go` links against;
2. `package.json:71` `"flatbuffers": "25.9.23"` — the TypeScript runtime the generated
   `packages/shared/protocol/*.ts` links against;
3. `scripts/generate-wire.sh:14` `FLATC_VERSION=25.9.23` — the schema compiler that *produced* both,
   with three pinned release-asset SHA-256s at `:27`, `:40`, `:45`.

**npm's `flatbuffers` `dist-tags.latest` is `25.9.23`, published 2025-09-24. There is no 25.12.19 on
npm at all** (the published version list ends `…25.1.24, 25.2.10, 25.9.23`). So bumping the Go
module alone would put the Go decoder a release ahead of the TypeScript encoder and the compiler
that generated both, across a wire format both halves of the app share — for no gain, since the
FlatBuffers wire format itself does not change between these releases.

**Decision: hold all three at 25.9.23** (D7). This is the phase's clearest deliberate exception, and
it is a *self-consistency* argument, not a laziness one: the only way to bump this dependency
correctly is to bump all three, and one of the three has nothing to bump to. Revisit when npm
publishes a matching release (OQ-2).

Note the script would also need three new SHA-256s (one per platform asset) if `flatc` ever moves —
so a future flatbuffers bump is a four-value change, not a one-liner.

### F9 — Wails beta.15 → beta.16 is a two-day nightly, and it is a three-place atomic change

`proxy.golang.org` timestamps: `v3.0.0-beta.15` tagged **2026-08-27T18:36:41Z**,
`v3.0.0-beta.16` tagged **2026-08-29T15:11:21Z**. `@wailsio/runtime` published `3.0.0-beta.15` at
2026-08-27T18:38:16Z and `3.0.0-beta.16` at 2026-08-29T15:13:03Z — i.e. **the Go module and the npm
runtime are published in lockstep, ~90 seconds apart**, and are two halves of one release.

beta.16's own release notes describe an automated nightly with a small change set: a notarization
prompt change, a macOS systray click-type fix, and CI housekeeping. No bindings-generator change, no
API change. Still, **three things move together and there is no way to move one**:

- `go.mod:29` (the runtime library),
- `package.json:57` (`@wailsio/runtime`, which `frontend/tsconfig.json:20` maps
  `"/wails/runtime.js"` onto for typechecking),
- the `wails3` CLI, which `scripts/wails-dev-setup.sh:40-52` reinstalls automatically the moment
  `go.mod` and the installed binary disagree — and which must then **regenerate the bindings** with
  the exact flags `AGENTS.md` insists on: `wails3 generate bindings -clean=true -b -names -ts -i`
  from `apps/kira-studio/`.

`AGENTS.md` is unusually loud about `-names` being load-bearing: without it every generated call
site emits `$Call.ByID(<n>, …)` instead of `$Call.ByName("<fqn>", …)`, and
`tests/ui/support/mockRuntime.ts`'s whole interception layer is keyed on the `ByName` FQN — a
`-names`-less regeneration silently breaks every `tests/ui/` spec at the first bound call with an
error that points nowhere near bindings. C3 must use the pinned command verbatim.

### F10 — There is no Go major-version bump available anywhere, for any direct dependency

Probed twelve plausible `/vN+1` module paths on 2026-09-02 (§2.2). Every one returns *no matching
versions for query "latest"*. `pgx` is still v5, `go-redis` still v9, `mongo-driver` still v2,
`franz-go` still v1, `testcontainers-go` still v0, `aws-sdk-go-v2` still v2.

**This is worth stating as a finding rather than an absence**, because the SPEC row's own risk model
("fix whatever breaks: compile errors, deprecated APIs") is mostly a *Go* risk model in a repo whose
product code is entirely Go — and it does not apply. Every Go bump in this phase is within a major.

### F11 — Go 1.25 → 1.27 is two releases, and the macOS floor moves to 13 (below this app's own 14)

`go.dev/dl?mode=json` on 2026-09-02: newest `"stable": true` entry is **go1.27.1**. `go.mod:3` says
`go 1.25.0`. Go 1.26 shipped February 2026, 1.27 August 2026.

**Go 1.27 requires macOS 13 Ventura or later** (1.26 was the last to support macOS 12). This app
already declares **macOS 14+** (`docs/ARCHITECTURE.md:25`, and `release.yml`'s own notes say
"macOS 14+"), so the toolchain's new floor is strictly *below* the product's. **No product-level
minimum-macOS change follows from the Go bump** — a genuinely useful negative result, since a
toolchain raising the OS floor above a product's is the normal reason a Go major-version jump gets
deferred.

There is no `toolchain` directive in `go.mod` today. Raising the `go` line to `1.27.0` is sufficient;
Go's own `GOTOOLCHAIN=auto` fetches the matching toolchain (verified working in this sandbox, §2.3),
and `go mod tidy` may add a `toolchain go1.27.1` line, which is correct and should be committed.

### F12 — What Go 1.26/1.27 actually changes that can bite *this* tree

Not a general changelog — the four items with a real call site here.

1. **`net/url.Parse` is stricter about colons in the host (Go 1.26).** `Parse()` now rejects
   malformed URLs with a colon in the host (e.g. `http://::1/`); bracketed IPv6 is still accepted.
   `GODEBUG=urlstrictcolons=0` restores the old behaviour. **Seven adapter clients parse a
   user-supplied connection URI through `url.Parse`**: `redis/client.go:39`,
   `sqlite/client.go:26`, `mysqlfamily/client.go:50`, `kafka/client.go:38`, `mongo/client.go:106`,
   `clickhouse/client.go:64`, plus `clickhouse/query.go` and `testsupport/localstack.go:77`.
   `kafka/client.go:34` even carries a comment noting `url.Parse` is *deliberately more permissive*
   than the TypeScript `new URL` it replaced — so a stricter `url.Parse` is a behaviour change in a
   place this repo consciously reasoned about. **This is the single most likely source of a real
   failure in the Go bump**, and the verification for it is `go test ./apps/kira-studio/internal/connections/...`
   plus the six adapter conformance suites (which build URIs like
   `postgres://postgres:pw@host:5432/db` and `mariadb://user:pw@host:3306/db` — bracketed-host and
   plain-host forms, all legal). **Fix, do not set the GODEBUG** (§0.5).
2. **The Green Tea GC is on by default (Go 1.26).** 10-40% less GC overhead. **P5 was an entire
   phase about RAM usage and P7 an entire phase about making the CPU/memory readout correct**, and
   `docs/PERF.md` records measured numbers from both. A GC change moves RSS and CPU profiles. This
   does not *break* anything, but P19 must not pretend the numbers are still the measured ones —
   §7.5 and C12.
3. **`stdversion` vet now runs by default in `go test` (Go 1.27).** It flags stdlib symbols newer
   than the `go` directive allows. Raising `go.mod:3` to `1.27.0` makes this *more* permissive, not
   less, so it should be silent — but it is a new default check running inside `bun run test:go` and
   the implementer should not be surprised by a new class of message.
4. **`asynctimerchan` GODEBUG permanently removed (Go 1.27); `time` channels are always
   unbuffered.** Grep for timer-channel patterns in `internal/preconnect`, `internal/connections`
   and `internal/adapterhost` — the process-group-kill and stream-drain code is the only place with
   real timing structure. `AGENTS.md` already warns those tests poll with multi-second timeouts
   because this container's init reaps slowly; that guidance stands and must not be tightened.

Not applicable: the `crypto` random-parameter changes (this repo passes `crypto/rand` implicitly, at
`internal/id/uuid.go:7`, `internal/secrets/cipher.go:6`, `internal/secrets/keyring_darwin.go:6` —
none injects a custom `io.Reader`), the TLS hybrid-PQ default (no server TLS config in the product),
and the ppc64/wasm/Windows-ARM items.

### F13 — P7's darwin-cgo split and P14's cgo shim: what the Go bump does and does not touch

Both were called out as "couldn't be compiled in this sandbox", so both deserve an explicit answer
rather than a shrug.

**The build-constraint mechanism is unchanged.** Neither Go 1.26 nor 1.27 changes build-tag
semantics; 1.26's release notes carry no build-constraint changes, and 1.27's only mention is the
`stdversion` vet check *reading* build tags, not changing them. The eight files that split on cgo
keep meaning exactly what they mean today:

- `internal/metrics/probe_darwin.go:1`, `processlist_darwin.go:1`,
  `probe_darwin_calibration_test.go:1` — `//go:build darwin && cgo`
- `internal/metrics/probe_other.go:1`, `processlist_other.go:1` — `//go:build !darwin || !cgo`
- `internal/metrics/responsible_nocgo_darwin.go:1` — `//go:build darwin && !cgo`
- `internal/secrets/keyring_{darwin,nocgo_darwin,other}.go`
- `internal/localauth/evaluate_darwin.go:1` (`//go:build darwin && cgo`, the P14
  `LocalAuthentication`/`LAContext` Objective-C shim) and `evaluate_other.go:1`

**What does change, and where to look.** Go 1.26 reduces baseline cgo call overhead by ~30% and adds
**heap base address randomization on 64-bit platforms** for cgo-using programs
(`GOEXPERIMENT=norandomizedheapbase64` disables it). Neither alters semantics, but both touch
programs that use cgo — which the shipped darwin binary does (`CGO_ENABLED=1` for every darwin build
task, per `build/darwin/Taskfile.yml`). The faster cgo path is mildly *good* for P7's per-tick
`proc_pid_rusage` probe.

**The unchanged wall.** `CGO_ENABLED=1 GOOS=darwin go build` still fails in this sandbox
(`clang: error: unsupported option '-arch'`, recorded in `evaluate_darwin.go`'s own header comment
and P7 §1.4). Go 1.27 does not change that — it is a missing macOS cross-toolchain, not a Go
limitation. **So the D5 guard that P7 and P14 both established stays the verification here:**
`CGO_ENABLED=0 GOOS=darwin go build ./apps/kira-studio/internal/...` must still type-check (that is
what `probe_other.go`/`keyring_other.go`/`evaluate_other.go` exist for), and the `darwin && cgo`
half remains a real-Mac check (§7.4).

### F14 — `go-redis` v9.22.0 adds Redis 8.10, which resolves half of P16's OQ-4

P16 F5 quoted `go-redis/v9@v9.20.0`'s README: officially 8.0/8.2/8.4/8.8, unofficially 7.0+. It then
noted Redis 8.10 shipped 2026-07-29 — newer than anything the pinned library listed — and
deliberately capped the compat matrix at **8.8**, *"the library's claim, not the newest image"*,
handing 8.10 forward to P19 as OQ-4.

**Read directly from `go-redis/v9@v9.22.0/README.md` on 2026-09-02**, the supported list is now:

> Redis 8.0 · Redis 8.2 · Redis 8.4 · Redis 8.8 · **Redis 8.10**
> …Although it is not officially supported, `go-redis/v9` should be able to work with any Redis 7.0+.

**The unofficial floor is unchanged at 7.0**, so `MIN_SERVER_VERSION.redis`
(`packages/shared/domain/connection.ts:42`, *"Requires Redis 7.0 or newer."*) stays exactly as P16
verified it. But **the ceiling can honestly move**: bumping `go-redis` to v9.22.0 is what makes
`REDIS_MAX="redis:8.10"` a library-backed claim rather than a guess. `library/redis:8.10` → HTTP
200, confirmed today.

That is a genuine, evidence-backed improvement this phase enables, and it is the *only* change to
`scripts/db-compat.sh`'s matrix. (The README also documents a new Redis-8.8+ `AR*` array command
family, marked experimental — the adapter does not use it and should not start.)

### F15 — P16 explicitly handed three stale default image pins to this phase, by name

`docs/v1.1/plans/P16-db-compat-suite.md` F12: *"Bumping the defaults is P19's row in SPEC.md
(`docs/v1.1/SPEC.md:34`). P16 records the observation in §8 and changes nothing, because changing a
default pin changes what regular CI runs, which is exactly what this phase is scoped not to touch."*
And OQ-3: *"`mongo:7` (8.3 is current), `redis:7` (below go-redis's own official floor of 8.0),
`localstack/localstack:3` (4 is current). P19 owns the bump."*

Verified today: `mongo:8.3` → 200 (`mongo:8.4` → 404, so 8.3 is the newest GA line),
`redis:8.10` → 200, `localstack/localstack:4` → 200. The other five defaults P16 called
"reasonable current-ish pins" are still reasonable and stay.

**This is a named handoff, not an inference**, so it is in scope — and it is the one part of this
phase that changes what regular CI runs.

### F16 — Bumping a default image is the only bump here that can break a *committed* fixture

Two mechanisms make this different from a library bump:

1. **The six version assertions are already version-derived, so they will not break.** P16 D4
   replaced the hardcoded regexes with `testsupport.VersionPattern(<name>, <kind>ServerMajor())`
   (e.g. `redis/redis_test.go:37`, `postgres/postgres_test.go:24`,
   `mysqlfamily/mysqlfamily_test.go:123`, `:128`), which derives the expected major from the
   *resolved* image tag. Changing a default constant changes the assertion with it. Free.
2. **`apps/kira-studio/internal/ipcfixture`'s committed fixtures are the real exposure.** Six
   per-adapter fixtures (`clickhouse`, `kafka`, `mariadb`, `mysql`, `redis`, `sqs`) are captured
   against real containers and committed under `apps/kira-studio/tests/ipc/<adapter>/`. `serverVersion`
   is masked (`ipcfixture/frozen.go`'s `MaskContinuationTokens` replaces it with a placeholder), so a
   version string change alone is absorbed — but **content shape is not masked**. `frozen.go:323`
   already documents drift from a floating tag resolving to a different patch, and **`AGENTS.md`'s
   Known open items records that `TestFixture_Redis` already fails against a fresh `redis:7`
   container in this sandbox with a one-key count drift** (`"12 keys"`/`"11"` expected vs
   `"13 keys"`/`"12"` got, reproduced on two independent fresh containers).

So `redis:7` → `redis:8.10` and `mongo:7` → `mongo:8.3` are the two bumps that plausibly require
regenerating a fixture (`KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...`,
then `bunx biome check --write` on the written file — `AGENTS.md`). `localstack:3` → `:4` affects
`sqs` (which does have a committed fixture) and `s3` (which does not).

**And the pre-existing redis failure is a trap worth naming:** an implementer bumping `redis:7` will
see `TestFixture_Redis` fail and may conclude the image bump caused it. It did not — it fails today,
before any change. The correct move is to reproduce the failure on the *unchanged* tree first, then
bump, then regenerate; and if the regenerated fixture makes it pass, say so plainly (that would
resolve a Known-open-item, which is a real result). Do not silently absorb it either way.

### F17 — The CI actions are up to three majors stale, and this session may not be able to commit the fix

`ci.yml` and `release.yml` pin `actions/checkout@v4` (latest **v7.0.1**), `actions/setup-go@v5`
(latest **v7.0.0**, an ESM migration), `actions/upload-artifact@v4` (latest **v7.0.1**), and
`oven-sh/setup-bun@v2` (latest **v2.2.0** — already the current major). Twelve `uses:` lines across
the two live workflows, plus two more in the staged
`docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml:24-25`.

These are unambiguously "pinned tool versions" in the SPEC row's sense, and unambiguously stale.

**But `AGENTS.md`'s Known open items says this session's GitHub push access lacks the `workflow`
OAuth scope, which GitHub requires for any commit touching `.github/workflows/*.yml`** — that is
precisely why P16's finished `db-compat.yml` sits under `docs/v1.1/plans/p16-pending-ci-workflow/`
instead of in `.github/workflows/`.

**So C11 must be attempted and may be refused at push time.** The plan for that is D12: try it; if
the push is rejected, revert the workflow edit into a staged directory beside P16's, with a README
saying exactly the same thing. Do **not** quietly drop the bump, and do **not** conclude the actions
are fine as they are.

### F18 — `macos-15` is held deliberately, and the reason is the SDK, not laziness

`macos-26` has been GA for GitHub-hosted runners since 2026-02-26 and `macos-latest` migrated to it
in mid-2026. `macos-15` remains available.

**Holding it.** The runner image is not a dependency — it is the machine that produces the shipped
artefact. Moving to `macos-26` changes the default Xcode (16.4 → 26.x), the macOS SDK the Wails
binary links against, and the system OpenSSL line (1.1.1 → 3.x). For an app that ships an ad-hoc
signed `.app`/`.dmg` and declares **macOS 14+** support (`docs/ARCHITECTURE.md:25`), the SDK the
binary is built against directly bears on what the minimum runnable macOS actually is. That is a
product decision with its own verification (does the artefact still launch on macOS 14?), and it
cannot be verified from this sandbox at all — there is no Mac here.

Bundling it into a dependency-bump phase would be exactly the kind of "treat a major as routine"
this phase is told not to do. Handed forward as OQ-4.

### F19 — `biome.json`'s `$schema` is a second pin on the Biome version

`biome.json:2` is `"$schema": "https://biomejs.dev/schemas/2.5.10/schema.json"` — a version-pinned
URL that must move with `package.json:34`'s `@biomejs/biome`. It is not enforced by anything (a
stale schema URL only degrades editor completion), which is exactly why it drifts. Trivially fixed
in the same commit; recorded because it is the sort of pin an inventory that only reads manifests
never finds.

### F20 — Vite 8 will move numbers `docs/PERF.md` records, and P20 needs to know

`docs/ARCHITECTURE.md:28` records two dynamically-imported chunks with measured sizes —
`sql-formatter` at ~38 KB gzip (P13) and `@faker-js/faker` at ~154 KB gzip (P15) — and
`docs/PERF.md:802-804` records the production chunk at **1,050,930 B / 333.97 KB gzip** from P5's
tree-shaking A/B.

Rolldown chunks and minifies differently from Rollup+esbuild. Those three figures will change, and
possibly the *chunk layout* will too (whether the two dynamic imports stay as two separate chunks is
a Rolldown chunking decision, and if they collapse into the main bundle, that is a real regression —
both were split deliberately so neither costs a launch). **§7.2 makes re-measuring them a gate on
C6, not an afterthought**, and C12 updates the two docs. P20's sweep should not be the first place
this is noticed.

---

## 4. Checked, and not fired

Things a reader might expect in this phase, checked and deliberately empty:

- **A `Dockerfile`.** None exists. `scripts/demo-dbs/docker-compose.yml` starts demo servers for
  manual use and pins no toolchain worth bumping in this phase.
- **`.nvmrc` / `.node-version` / `.tool-versions` / `engines` / `packageManager` / `volta`.** None
  exist (§1.4). The SPEC row's Node/Bun clause has no work in it.
- **Workspace package dependencies.** `apps/kira-studio/frontend/package.json` declares none;
  `packages/*` have no manifests (§1.1).
- **`bun.lock`.** `lockfileVersion: 1`, regenerated by `bun install` — not a pin to bump.
- **`@vscode/codicons`.** `dist-tags.latest` is `0.0.46-24` (what's pinned); a `next` tag points at
  `0.0.46-39`. `next` is not "latest available stable". No change.
- **`@faker-js/faker`, `sql-formatter`, `@playwright/test`, `testcontainers`, `tailwindcss`,
  `@tailwindcss/vite`, `@vitejs/plugin-vue`, `@tanstack/vue-virtual`, `@lezer/highlight`, `pg`,
  `@types/pg`, `vue-tsc`, five `@codemirror/*` packages.** All verified at `latest` today. The
  phases that built on them (P13 `sql-formatter`, P15 `@faker-js/faker`, P18 the CodeMirror stack)
  need no follow-up.
- **`zod` 4.4.3 → 4.5.4 as a risk.** Checked the release notes: 4.5 is additive (`z.compile()`,
  `z.validate()`, `z.creditCard()`, `z.properties()`, `z.deepPartial()`, eight new locales). The
  stricter-string changes landed in **4.4**, which this repo is already on. Zod's remaining job here
  is connection-dialog input validation (`docs/ARCHITECTURE.md:33`) plus the settings/domain schemas
  in `packages/shared/domain/`. Treated as a routine minor.
- **A `renovate.json` / `dependabot.yml`.** Neither exists; adding one is out of scope (§0.4).
- **Go major-version module paths.** Twelve probed, none exist (F10).
- **`MIN_SERVER_VERSION` string changes.** No driver floor moved (F14).
- **`@typescript/native-preview`.** Already at its own latest; frozen upstream (F4).

---

## 5. Decisions

### D1 — Three tiers, and every pin lands in exactly one

The phase is scoped by *tier*, not by "bump what we can get to". This is the judgment call the
SPEC row leaves open, and it is made explicitly here so a Sonnet implementer has a finish line:

- **Tier GREEN — every patch/minor bump is taken.** 15 npm + Go entries. No case-by-case
  deliberation; they go in two sweep commits (C1, C2) and the standard gate (§7.1) is the proof.
- **Tier GATED — a major (or prerelease-line) bump gets its own commit, its own verification, and
  a pre-check for breaking API usage in *this* codebase before it is attempted.** Four items:
  Wails beta.16 (C3), Go 1.27 (C4), Vite 8 (C6), TypeScript 6 (C7). Each has a documented "what
  breaks" analysis already done in §3, so the implementer is checking a hypothesis, not exploring.
- **Tier DEFERRED — a pin deliberately left behind, with the reason written down.** §5.3. A
  deferred pin is a *deliverable*, not a gap.

**Why this is the realistic scope for one phase, stated plainly:** the sweep is not enormous. 50 of
67 direct pins are already current, so the work is 15 mechanical bumps, four gated ones, and one
container-image decision with a fixture-regeneration tail. What would make this unbounded is
treating a major as an open-ended migration — and the two majors here have both been *reduced to a
known diff* by the research above (Vite: one renamed config key; TypeScript: two config risks, both
identified with line numbers). That is why the whole sweep fits, and why the plan does not need to
say "check some, defer the rest".

### D2 — The exception log is §5.3 of this document, and nowhere else

`AGENTS.md`: *"No findings document survives a round once it's fixed"* and a phase's discoveries
belong *"in that phase's own plan doc"*. So there is no `DEPENDENCIES.md`, no `deferred.json`, no
comment block in `package.json`. §5.3 is the record.

### D3 — `typescript` goes to **6.0.3**, not 7.0.2

F2. Taking 7.0.2 breaks `vue-tsc`, which breaks `bun run typecheck` in CI and the release workflow.
6.0.3 is the newest version this repo's toolchain can actually run.

**And the bump is gated on cleanliness, not forced.** Per §0.5: adding an explicit `rootDir` to the
three real tsconfigs is *adapting to a config-format change* and is in scope; fixing genuine new
type errors in the app's own code is in scope and is exactly what the SPEC row means by "fix
whatever breaks". **Turning off a new TS 6 default** (`noUncheckedSideEffectImports: false`,
`strict: false`, re-adding a removed option) **is a shortcut**, and if that is what it takes, C7 is
abandoned, `typescript` stays at 5.9.3, and the reason goes in §5.3. TypeScript is the one bump this
phase is allowed to walk away from, because nothing else depends on it moving.

### D4 — `vite` goes to **8.2.2**, with `rollupOptions` → `rolldownOptions`

F5, F6. One config key renamed at `apps/kira-studio/frontend/vite.config.ts:40`; both plugins already
declare `vite ^8`; no custom plugins, no `esbuild` config, no AMD/SystemJS output. The deprecation
shim would keep the old key working — **use the new name anyway**, since shipping on a deprecated
alias is exactly the kind of half-migration `AGENTS.md` rules out.

The acceptance bar for C6 is not "it builds": it is that the built bundle still has the **two
separate dynamic-import chunks** and that the recorded sizes are re-measured (F20, §7.2).

### D5 — The Go directive goes to **1.27.0**, in its own commit, after the module sweep

F11, F12. Two releases in one step, and it is the change with the widest blast radius in the phase —
so it lands alone (C4), after C2's module bumps are already proven green under Go 1.25, so that any
failure is attributable.

If `go mod tidy` writes a `toolchain go1.27.1` line, commit it. CI needs no edit: both workflows use
`go-version-file: go.mod`.

### D6 — Go modules: explicit `go get` for the six direct bumps, `go get -u ./...` for the rest

```
go get github.com/aws/aws-sdk-go-v2/config@v1.33.2 \
       github.com/aws/aws-sdk-go-v2/credentials@v1.20.2 \
       github.com/aws/aws-sdk-go-v2/service/s3@v1.110.0 \
       github.com/aws/aws-sdk-go-v2/service/sqs@v1.50.0 \
       github.com/redis/go-redis/v9@v9.22.0 \
       github.com/shirou/gopsutil/v4@v4.26.8
go get -u ./...      # sweeps the 80 indirect requires
go mod tidy
```

Direct bumps are named explicitly so the diff is auditable and `flatbuffers` is provably excluded
(D7) — `go get -u ./...` on its own would drag it to v25.12.19. **Run `go get -u ./...` *after* the
explicit list and then re-check `go.mod:13` still reads `v25.9.23+incompatible`**; if it moved, pin
it back with `go get github.com/google/flatbuffers@v25.9.23+incompatible`.

### D7 — `flatbuffers` is frozen at 25.9.23 in all three places

F8. Go module, npm package, and `scripts/generate-wire.sh`'s `flatc` pin stay together. The
generated code under `apps/kira-studio/internal/page/wire/` and `packages/shared/protocol/` is not
regenerated. Reason logged in §5.3 and handed forward as OQ-2.

### D8 — Wails beta.16 is one commit covering all three places plus regenerated bindings

F9. `go.mod:29` + `package.json:57` + `sh scripts/wails-dev-setup.sh` (which reinstalls the CLI
because the installed binary no longer matches `go.mod`) + `wails3 generate bindings -clean=true -b
-names -ts -i` from `apps/kira-studio/`. `frontend/bindings/**` is gitignored, so the commit itself
carries only the two version strings — but the regeneration must happen before `bun run typecheck`
and `bun run build` in the same working tree, and `bun run test:ui` is the proof that `-names`
survived.

### D9 — Three default images move; five stay

F15, F16. `testsupport/mongo.go:23` `mongo:7` → **`mongo:8.3`**; `testsupport/redis.go:19` `redis:7`
→ **`redis:8.10`**; `testsupport/localstack.go:20` `localstack/localstack:3` →
**`localstack/localstack:4`**. The other five (`postgres:17-alpine`, `mariadb:11.4`, `mysql:8.4`,
`clickhouse/clickhouse-server:26.3`, `confluentinc/cp-kafka:8.0.7`) stay — P16 F12 assessed them as
current-ish, and moving a default that P16 did not flag would be churn.

`packages/db-fixtures/support/`'s three `e2e-real` pins (Set C) all mirror Set A constants that are
**not** moving, so they need no edit — which is a small piece of luck worth verifying rather than
assuming.

**Choosing `redis:8.10` over `redis:8.8`:** 8.10 is the newest release `go-redis` v9.22.0 officially
lists (F14), and it is the version the compat MAX also moves to (D10) — keeping the default and the
ceiling on the same version means one fixture capture, not two.

### D10 — One line changes in `scripts/db-compat.sh`: `REDIS_MAX` 8.8 → 8.10

F14. `scripts/db-compat.sh:51` `REDIS_MIN="redis:7.0"` is unchanged (the library's unofficial floor
did not move); `:52` `REDIS_MAX="redis:8.8"` → `"redis:8.10"`. Every other row in the sixteen-row
matrix is a P16 decision backed by evidence that this phase's bumps do not disturb, and P16 §2's
rule — *"the published minimum is the verified minimum"* — means a row does not move without a
library statement behind it. Only redis has one.

The same edit belongs in P16's own plan §3 table? **No** — P16's plan is the record of what P16
found and decided; it is not amended after the fact. This plan's §5.3/§9 is where the delta lives.

### D11 — CI action majors are bumped; the runner image is not

F17, F18. `actions/checkout@v4` → `@v7`, `actions/setup-go@v5` → `@v7`, `actions/upload-artifact@v4`
→ `@v7`, `oven-sh/setup-bun@v2` stays. Applied to `ci.yml`, `release.yml`, **and** the staged
`docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml` (which is a plain doc file and carries no
push-scope problem).

`setup-go@v7`'s ESM migration is internal to the action; `go-version-file: go.mod` is unchanged
across v5→v7. `upload-artifact@v4`→v7 keeps `name`/`path`/`retention-days`. `checkout@v4`→v7 keeps
the zero-input default usage this repo has.

**Verification is limited and that is stated honestly:** none of these can be exercised from this
sandbox — there is no runner here. The change is mechanical and reviewable by reading, and the first
real proof is the first CI run after the branch is pushed.

### D12 — If the workflow commit cannot be pushed, it is staged, not dropped

F17. Attempt C11 normally. If `git push` is refused for lack of the `workflow` OAuth scope: move the
two edited workflow files to `docs/v1.1/plans/p19-pending-ci-workflow/` with a short README
mirroring P16's (what the change is, why it is here, the exact `git mv` a scoped session runs to
apply it), restore `.github/workflows/*` to their committed state, and add one bullet to
`AGENTS.md`'s Known open items. The `db-compat.yml` half of the change lands normally either way.

### D13 — No new tests

`AGENTS.md`'s bar. A version bump produces no parser, no cursor arithmetic, no cache-eviction rule,
no concurrency structure — nothing that clears it. The existing suites are the test. The only new
*artefact* is a regenerated `ipcfixture` fixture if C8 moves one (C9), which is generated, not
written.

### D14 — Re-fetch every version before pinning it

Every number in §2 was true on 2026-09-02 and several were published within 72 hours of that
(`@types/node` 26.4.1 and `mariadb` 3.5.4 on 2026-09-01, `@codemirror/*` on 2026-08-31). A Sonnet
implementer must re-run the checks before writing a version string:

```
bun outdated                                   # npm, vs. dist-tags.latest
go list -m -u all                              # Go, vs. the proxy
curl -s 'https://go.dev/dl/?mode=json' | head  # newest "stable": true
```

If a version has moved past what §2 names, take the newer one **if it is the same tier** (a newer
patch/minor is still GREEN). If a *new major* has appeared for something §2 lists as GREEN, drop it
to GATED and apply the same treatment — do not take a newly-appeared major on the strength of this
plan's tiering.

### 5.3 The exception log — pins deliberately not bumped

| Pin | Today | Available | Why not | Revisit |
|---|---|---|---|---|
| `go.mod:13` `google/flatbuffers` | v25.9.23+incompatible | v25.12.19+incompatible | npm's `flatbuffers` has no 25.12.19; the Go lib, the npm lib and `flatc` are three pins on one version that must agree across a shared wire format (F8) | When npm publishes a matching release — OQ-2 |
| `package.json:71` `flatbuffers` | 25.9.23 | — (already latest on npm) | Same | Same |
| `scripts/generate-wire.sh:14` `FLATC_VERSION` | 25.9.23 | 25.12.19 upstream | Same; also needs three new asset SHA-256s | Same |
| `package.json:65` `typescript` | 5.9.3 → **6.0.3** target | 7.0.2 | TS7 ships no stable programmatic API until 7.1; `vue-tsc` consumes it in-process (F2) | TS 7.1, ~Oct 2026 — OQ-1 |
| `package.json:54` `@typescript/native-preview` | 7.0.0-dev.20260707.2 | — (is latest) | Frozen upstream; superseded by `typescript@7`, which this repo cannot take (F4) | Retire alongside OQ-1 |
| `package.json:67` `vue` | 3.5.42 after C1 | 3.6.0-rc.6 | Not stable (F7) | When 3.6.0 goes GA |
| `package.json:56` `@vscode/codicons` | 0.0.46-24 | 0.0.46-39 on `next` | `next` is not stable; `latest` is what's pinned | When `latest` moves |
| `ci.yml:19` etc. `macos-15` | macos-15 | macos-26 (GA) | Changes the macOS SDK the shipped binary links against — a product decision about the minimum supported macOS, unverifiable from this sandbox (F18) | OQ-4 |
| Five default container images | postgres 17-alpine, mariadb 11.4, mysql 8.4, clickhouse 26.3, cp-kafka 8.0.7 | newer tags exist | P16 F12 assessed each as a reasonable current pin; moving one P16 did not flag is churn with a fixture-regeneration cost | Whenever one goes EOL |
| `scripts/db-compat.sh` matrix, 15 of 16 rows | as P16 set them | — | Each row is an evidence-backed P16 decision; only redis has a new library statement behind it (F14, D10) | P16's own OQ-4 (`--check-ceilings`) |

---

## 6. Implementation order

Twelve commits, safe first, each independently green. Conventional Commits throughout.

### C1 — `chore(deps): bump every npm patch and minor to latest`

`package.json`: `@biomejs/biome` 2.5.10→2.5.11, `@codemirror/state` 6.7.1→6.7.2,
`@codemirror/view` 6.43.9→6.43.10, `@types/node` 26.3.0→26.4.1, `mariadb` 3.5.3→3.5.4,
`simple-icons` 16.28.0→16.29.0, `vue` 3.5.41→3.5.42, `zod` 4.4.3→4.5.4. Plus `biome.json:2`'s
`$schema` → `2.5.11` (F19). **Not** `@wailsio/runtime` (C3), `vite` (C6), `typescript` (C7).
`bun install` regenerates `bun.lock`.
**Gate:** §7.1 full frontend gate.

### C2 — `chore(deps): bump the Go module's direct and indirect dependencies`

D6's command sequence. Then confirm `go.mod:13` still reads `v25.9.23+incompatible`.
**Gate:** §7.1 Go gate. **Plus** the six adapter conformance suites against real containers,
because `service/s3`, `service/sqs` and `go-redis` are live DB/queue drivers (§7.3).

### C3 — `chore(wails): move to v3.0.0-beta.16`

D8. `go.mod:29` and `package.json:57` to `3.0.0-beta.16`/`v3.0.0-beta.16`; run
`sh scripts/wails-dev-setup.sh` (reinstalls the CLI, since the installed binary now disagrees with
`go.mod`) and regenerate bindings with the exact pinned command.
**Gate:** §7.1 both halves, **and `bun run test:ui`** — the `-names` proof (F9).

### C4 — `chore(go): raise the toolchain to Go 1.27`

D5. `go.mod:3` `go 1.25.0` → `go 1.27.0`; `go mod tidy` (commit any `toolchain` line it writes).
**Gate:** §7.1 Go gate **plus** the four F12 checks:
`go test ./apps/kira-studio/internal/connections/...` (the `url.Parse` strictness),
`go vet ./...` (the new `stdversion` default), the six conformance suites (URI parsing against real
servers), and `CGO_ENABLED=0 GOOS=darwin go build ./apps/kira-studio/internal/...` (P7/P14's D5
guard, F13).

### C5 — `fix(adapters): <whatever C4 actually broke>` — **conditional**

Only if C4 turns up real failures. Most likely shape: a connection URI form that Go 1.26's stricter
`net/url.Parse` now rejects, in one of the seven clients listed in F12. Fix in the adapter, never
with `GODEBUG=urlstrictcolons=0`. **If C4 is clean, this commit does not exist and the plan says so
in the phase summary rather than manufacturing a change.**

### C6 — `chore(deps): move the frontend build to Vite 8 (Rolldown)`

D4. `package.json:66` 7.3.6→8.2.2; `vite.config.ts:40` `rollupOptions` → `rolldownOptions` (keep
`external: [/^\/wails\//]` verbatim).
**Gate:** §7.1 frontend gate, **plus** §7.2's bundle check — the two dynamic-import chunks must
still be separate chunks, and their gzip sizes plus the main chunk's are re-measured.

### C7 — `chore(deps): move to TypeScript 6` — **gated, abandonable**

D3. `package.json:65` 5.9.3→6.0.3. Expect to add an explicit `rootDir` to
`frontend/tsconfig.json`, `tsconfig.tests.json` and `tests/unit/tsconfig.json` (F3). Fix any real
type errors the stricter defaults surface. **If it cannot be made green without disabling a TS 6
default, revert the commit entirely, leave `typescript` at 5.9.3, and record it in §5.3.**
**Gate:** `bun run typecheck` (all three projects, `vue-tsc` included), then §7.1 frontend gate.

### C8 — `chore(testsupport): bump the three stale default container images`

D9. `testsupport/mongo.go:23` → `mongo:8.3`; `testsupport/redis.go:19` → `redis:8.10`;
`testsupport/localstack.go:20` → `localstack/localstack:4`.
**Gate:** `go test ./apps/kira-studio/internal/adapters/{mongo,redis,sqs,s3}/... -count=1` against
real containers, pulled via `mirror.gcr.io` per `AGENTS.md`. The version assertions derive from the
image tag and should follow automatically (F16); if one does not, that is a `ServerMajor` parsing
bug worth fixing, not an assertion to relax.

### C9 — `test(ipcfixture): regenerate the fixtures the image bump moves` — **conditional**

Only if C8 changes a committed fixture's content. `KIRA_IPC_FIXTURES=write go test
./apps/kira-studio/internal/ipcfixture/...` then `bunx biome check --write` on the written
`.fixture.ts` files (`AGENTS.md`). **Before regenerating, reproduce `TestFixture_Redis`'s
pre-existing failure on the unchanged tree** (F16) so the commit message can say honestly whether
the bump caused a change, absorbed a known failure, or neither.

### C10 — `chore(compat): raise the redis compatibility ceiling to 8.10`

D10. `scripts/db-compat.sh:52` `REDIS_MAX="redis:8.8"` → `"redis:8.10"`.
**Gate:** `sh scripts/db-compat.sh --only redis --mirror` (both extremes — the min row is cheap and
proves the matrix still parses).

### C11 — `ci: bump the GitHub Actions majors` — **may be push-blocked**

D11, D12. `checkout@v4`→`@v7`, `setup-go@v5`→`@v7`, `upload-artifact@v4`→`@v7` across `ci.yml`,
`release.yml` and `docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml`. `setup-bun@v2` unchanged.
**Gate:** reading, plus the first CI run after push. If the push is refused, apply D12's staging
fallback in a follow-up commit.

### C12 — `docs: record what this phase changed underneath the docs`

Only what P19 *actually* invalidated, not a general sweep (that is P20's row):

- `docs/ARCHITECTURE.md:25` — Wails `v3.0.0-beta.16`.
- `docs/ARCHITECTURE.md:26` — the TypeScript row (TS 6, and why not 7 — F2/F4 in one sentence).
- `docs/ARCHITECTURE.md:28` — the two dynamic-import chunk sizes, re-measured under Rolldown (F20).
- `docs/PERF.md:802-804` — the production chunk size, re-measured; and a one-line note that
  Go 1.26's Green Tea GC is now the default under which every RSS/CPU figure in that document was
  *not* measured (F12 item 2). **Do not fabricate re-measured Go-side numbers** — say the figures
  predate the GC change and leave re-measurement to whoever runs the P5/P7 procedures on a Mac.
- `AGENTS.md` — only if C9 resolved the `TestFixture_Redis` item (delete it, per `AGENTS.md`'s own
  rule that a resolved item is removed rather than marked done), or if D12's staging fallback fired
  (add one bullet).

---

## 7. Verification

### 7.1 The gate every commit passes

**Frontend half** (any commit touching `package.json`, `vite.config.ts`, a tsconfig, or bindings):

```
bun install
bun run lint          # biome, 358 files — green today
bun run typecheck     # tsgo ×2 + vue-tsc
bun run build         # vite build → apps/kira-studio/frontend/dist
bun run test:unit     # bun test apps/kira-studio/tests/unit
bun run test:ui       # playwright, headless WebKit, against the built bundle
```

**Go half** (any commit touching `go.mod`, `go.sum`, or a `testsupport` constant):

```
go build ./...
go vet ./...
go test ./... -count=1
```

`-count=1` is not optional where an image changed: P16 F13 found `go test`'s result cache will
silently reuse a run across image overrides.

`bun run test:ipc:fe` and `bun run verify:packaging` run once at the end (§7.3) rather than per
commit — neither is sensitive to a single dependency bump, and `verify:packaging` needs a full
`bun run package`.

### 7.2 The extra gate on each gated commit

| Commit | Extra proof required |
|---|---|
| C3 (Wails) | `bun run test:ui` **green** — the specific `-names` failure mode is every spec timing out at `[data-testid="status-bar"]` with `Error: no CHANNEL_TO_FQN entry for undefined` (F9). If that appears, the bindings were regenerated wrong, not broken by beta.16 |
| C4 (Go 1.27) | The four F12 checks (see C4). Plus `CGO_ENABLED=0 GOOS=darwin go build ./apps/kira-studio/internal/...` — P7 D5 / P14 D10's guard that the no-cgo darwin combination still type-checks (F13) |
| C6 (Vite 8) | `ls -la apps/kira-studio/frontend/dist/assets/` — **two separate dynamic-import chunks must still exist** (the `sql-formatter` and `@faker-js/faker` splits from P13/P15). Re-measure all three gzip sizes (`gzip -c <chunk> \| wc -c`) and carry them into C12. A collapsed chunk is a regression, not a cosmetic change: both splits exist so neither library costs a launch (`docs/ARCHITECTURE.md:28`) |
| C7 (TypeScript 6) | `bun run typecheck` green **without any TS 6 default disabled**. Diff the three tsconfigs and confirm every added line is an explicit restatement of a moved default (e.g. `rootDir`), not a relaxation |
| C8 (images) | §7.3 |

### 7.3 The DB-compat rule — this is the non-negotiable one

**P16 spent real container time proving specific driver/server pairs work. Nothing in this phase is
allowed to silently undo that.** The rule, in order of cost:

1. **If any DB/queue driver version changes** — this phase: `go-redis` v9.20.0→v9.22.0,
   `aws-sdk-go-v2/service/s3`, `aws-sdk-go-v2/service/sqs` (C2) — **run that kind's full conformance
   package against a real container at the default pinned image**:
   `go test ./apps/kira-studio/internal/adapters/{redis,sqs,s3}/... -count=1`. That is P16's
   "default-pinned-version fixtures" floor, and it is mandatory.
2. **If any default image changes** — this phase: mongo, redis, localstack (C8) — same, for those
   kinds, at the new image.
3. **If a compat-matrix row changes** — this phase: redis MAX only (C10) — **run that row for real**:
   `sh scripts/db-compat.sh --only redis --mirror`. A matrix edit that has never been executed is a
   hypothesis, which is precisely the standard P16 §2 set for itself (*"the version table is a
   hypothesis until it runs green"*).
4. **The full sixteen-row matrix is *not* required**, and that is a deliberate scope call: no
   library floor moved (F14), thirteen rows are untouched by anything this phase does, and a full
   run is a ~2-hour container marathon. If time allows, `sh scripts/db-compat.sh --mirror` is a
   worthwhile bonus — but it is not a gate, and saying so is more honest than listing it and having
   it skipped.

Docker in this sandbox: start the daemon (`nohup dockerd > /tmp/dockerd.log 2>&1 & disown`), pull
through `mirror.gcr.io` and re-tag — `AGENTS.md`'s Docker section has the exact prefix rule
(`library/` for unnamespaced official images, none for already-namespaced ones). `db-compat.sh`'s
own `--mirror` flag does this automatically for the matrix.

### 7.4 What must be checked on a real Mac, and cannot be checked here

Stated so it is not mistaken for coverage this phase has:

- **The `darwin && cgo` half of P7's metrics probe and P14's `LocalAuthentication` shim.**
  `CGO_ENABLED=1 GOOS=darwin go build` still fails in this sandbox with
  `clang: error: unsupported option '-arch'` (F13) — unchanged by Go 1.27. A real Mac must build
  and launch the app once after C4 and confirm the status-bar CPU/memory readout still produces
  sane numbers and a credential reveal still raises the Touch ID / password prompt.
- **`bun run package` / `bun run verify:packaging`** — the `.app` + `.dmg` pipeline, ad-hoc signing,
  `Info.plist` bundle ID and version stamping. macOS-only. This is CI's `package-smoke` job, so the
  first real proof is the first push to a non-PR ref.
- **The three CI action majors** (C11) — no runner here (F17/D11).

### 7.5 What must not regress

- **The generated-bindings call shape.** `$Call.ByName(...)`, never `$Call.ByID(...)` (F9).
- **The two dynamic-import chunks.** Separate, and roughly their recorded sizes (F20).
- **The six version assertions.** Still derived from the resolved image tag, still asserting the
  version that was asked for — never widened to `\d+` to make a bump pass (P16 D4, §0.5).
- **`MIN_SERVER_VERSION`'s eight strings.** Byte-identical (§0.4, F14).
- **`scripts/db-compat.sh`'s matrix.** Fifteen of sixteen rows byte-identical (D10).
- **The `wails3` CLI's single source of truth.** Still derived from `go.mod` by
  `wails-dev-setup.sh:21`, `ci.yml:33`/`:62` and `release.yml:45` — no second Wails pin introduced
  (T4).
- **`docs/PERF.md`'s Go-side RSS/CPU figures.** Not silently overwritten with numbers nobody
  measured; annotated as pre-Green-Tea instead (C12).

---

## 8. Acceptance checklist

- [ ] Every pin in §1 is either bumped or in §5.3's exception log with a reason. None silently
      skipped.
- [ ] Every target version was re-fetched at implementation time (D14), not copied from §2.
- [ ] `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`
      green on the final tree.
- [ ] `go build ./...`, `go vet ./...`, `go test ./... -count=1` green on the final tree.
- [ ] `bun run test:ipc:fe` green.
- [ ] `CGO_ENABLED=0 GOOS=darwin go build ./apps/kira-studio/internal/...` green (F13).
- [ ] `go.mod:3` reads `go 1.27.0`; `go.mod:13` still reads `flatbuffers v25.9.23+incompatible`
      (D7).
- [ ] `go.mod:29` and `package.json:57` both read beta.16; bindings regenerated with `-names`; a
      `tests/ui` spec ran green after it (F9).
- [ ] `vite.config.ts` uses `rolldownOptions`, not the deprecated alias; the two dynamic-import
      chunks still exist and their sizes are recorded (D4, §7.2).
- [ ] TypeScript is at 6.0.3 with no TS 6 default disabled — **or** at 5.9.3 with the reason in
      §5.3 (D3).
- [ ] The three bumped default images ran their kind's conformance suite against a real container
      (§7.3.2), and any fixture the bump moved was regenerated with `KIRA_IPC_FIXTURES=write` +
      `biome check --write` (C9).
- [ ] `sh scripts/db-compat.sh --only redis --mirror` ran green after C10 (§7.3.3).
- [ ] `redis`, `sqs`, `s3` conformance suites ran green after their drivers moved (§7.3.1).
- [ ] The CI action bump is either committed or staged under
      `docs/v1.1/plans/p19-pending-ci-workflow/` with a README (D12).
- [ ] `biome.json:2`'s `$schema` matches the installed Biome (F19).
- [ ] C12's doc edits cover only what this phase actually invalidated, with no fabricated
      measurements.
- [ ] `AGENTS.md`'s Known open items reflects reality: the `TestFixture_Redis` item deleted if C9
      resolved it, a staging bullet added only if D12 fired.
- [ ] The out-of-order note (§0.1) is carried into the phase's closing summary so P12's plan author
      sees it.

---

## 9. Open questions, handed forward

- **OQ-1 — Retire `tsgo` and converge on one TypeScript.** `docs/ARCHITECTURE.md:26` has wanted this
  since the toolchain split. It becomes possible when TS **7.1** ships the stable programmatic API
  (expected ~Oct 2026) and `vue-tsc`/`@vue/language-tools` adopt it: then `typescript@7`'s own `tsc`
  replaces both `@typescript/native-preview`'s `tsgo` (`package.json:54`, `:18`, `:19`) and the
  5.x/6.x `typescript` peer `vue-tsc` needs, and `package.json`'s three `typecheck:*` scripts
  collapse toward one tool. Not P19's — the enabling release does not exist yet (F2, F4).
- **OQ-2 — `flatbuffers` npm publication.** The Go module is at v25.12.19 and npm is stuck at
  25.9.23 (F8). Whoever next touches the wire format should re-check npm; if a matching release
  appears, all three pins move together and `packages/shared/protocol/*.ts` +
  `apps/kira-studio/internal/page/wire/*.go` are regenerated with the new `flatc` (plus three new
  asset SHA-256s in `scripts/generate-wire.sh`). If npm stays stale indefinitely, the real question
  is whether the TypeScript runtime dependency is still needed at all now that decode is a typed-array
  view over received bytes (P11).
- **OQ-3 — Automated dependency updates.** This sweep found 17 stale pins accumulated across roughly
  one chapter of work, several of them (the CI action majors, `biome.json`'s `$schema`, the three
  default images) invisible to anyone reading only `package.json`. A Renovate/Dependabot config
  would surface them continuously — but `AGENTS.md`'s "no per-phase PRs, one feature branch for all
  of v1" makes bot PRs an awkward fit, so this needs a process decision before a config file.
- **OQ-4 — The `macos-15` → `macos-26` runner migration.** Deferred here for SDK reasons (F18). It
  needs its own decision — does the app still support macOS 14 when built against the macOS 26 SDK,
  and is that verified by launching the artefact on a 14 machine? — plus a `docs/PACKAGING.md` and
  `README.md` update if the floor moves. GitHub still offers `macos-15`, so there is no deadline
  pressure yet.
- **OQ-5 — P16's own `--check-ceilings` idea, now more clearly worth building.** P16 OQ-4 proposed a
  `db-compat.sh` mode that queries the registry and reports tags newer than the matrix names. This
  phase did that work by hand for eight images and one library README (F14, F15, §2.5) and it was
  the most tedious part of the research. The next phase to touch `db-compat.sh` should build it.
