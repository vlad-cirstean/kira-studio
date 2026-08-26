# P45 — Docs cleanup: the living docs move up, `docs/v1/` becomes the v1 record

> **The phase, in the user's own words** (SPEC.md:1065): *"SPEC.md and its `plans/` are retired as
> v1 history rather than a living spec; whatever in them is still true and durable moves into
> `ARCHITECTURE.md`, which `AGENTS.md` points to and which itself points out to the general docs
> (`PACKAGING.md`, `PERF.md`); the `docs/` folder structure is reconsidered to match"*, with the
> *why* column recording the framing directly: *"spec and its plans are now 'an element of the past
> of v1'."*
>
> **Two of that sentence's clauses are already true, and finding that out changes the whole shape of
> the phase.** `ARCHITECTURE.md`, `PACKAGING.md` and `PERF.md` all exist (F50) — this phase
> originates none of them, and inventing content for them would be the wrong reading. `AGENTS.md`
> already points at `ARCHITECTURE.md`, six times (F61). What is *not* true is the part nobody
> spelled out: **`ARCHITECTURE.md` currently defers to `SPEC.md` for four live facts and names
> SPEC.md authoritative in its own second paragraph** (F52). That inversion — not a missing file, not
> a missing pointer — is the actual deliverable.
>
> **"The `docs/` folder structure is reconsidered" turns out to mean the opposite of a big move.**
> `docs/v1/` already says "v1" in its own name; its problem is that it holds three *living*,
> version-agnostic docs alongside the v1 record. So the three living docs move **up** to `docs/`, and
> `docs/v1/` is left holding only what is genuinely the past (D57/D58). That is a 26-reference change
> this plan lists exhaustively, not a 50-file rename — and it **repairs five references that have been
> dangling since `f660ffd` created `docs/v1/` in the first place** (F53).
>
> **"Retired as history" is given three concrete rules rather than a gesture** (D60): SPEC.md loses
> its normative role to ARCHITECTURE.md; no historical record is ever retro-edited to match a later
> move; and §10's phasing ledger keeps accruing rows, because P45 and P46 are queued *in it* right
> now and freezing it would delete the one place this sequence records what it did (F56).
>
> **P44's handed-forward `tests/db/` → `tests/unit/` reconciliation is in scope and was run, not
> assumed** (F57/F58, D66). It is not the ten-minute `git mv` P44 §8 item 4 expected: moving
> `run-state.spec.ts` into `tests/unit/` **breaks `view-state.spec.ts`** — reproduced, root-caused to
> Bun's shared module registry, and fixed with a shared stub whose fix was proven by running it
> (`63 pass, 0 fail, 539 expect() calls, 1.31 s`). One of the three files is deliberately left behind,
> for a measured reason: `preconnect.spec.ts` is **23.0 s of a 24.1 s** total.
>
> **Thirteen commits, none touching runtime `src/` behavior.** Three `src/` comment repairs (D68) and
> one `tests/` move are the only non-`docs/` diffs.
>
> **Branch tip when this plan was written: `741347e` on `feature/kickoff`; `git status --porcelain`
> over the repo was empty apart from this file.** Baselines measured here, on that tree:
> `bun run lint` → *"Checked 461 files in 637ms. No fixes applied."*; `bun run typecheck` → exit 0,
> all five projects; `bunx electron-vite build` → *"✓ built in 5.22s"*; `bun test tests/unit` →
> **52 pass, 0 fail, 411 ms**. Re-grep before editing.

---

## 0. Ground rules for this phase

- **Nothing is invented.** Every sentence that lands in `ARCHITECTURE.md` is either moved from
  `SPEC.md` (with its provenance stated in the commit body) or corrected against the tree with a
  `file:line` read. This phase writes no new claim about the app that it did not verify. Where a
  moved sentence is *stale*, it is corrected in the move and the correction is called out — never
  copied forward silently, and never "improved" beyond correctness.
- **History is never retro-edited.** A plan file or a §10 row that names a path is a statement about
  the tree *as it was when that phase ran*. Rewriting `docs/v1/plans/P43-functionality-review-iter3.md`
  to say `tests/unit/run-state.spec.ts` would make it say something that was not true in P43. The
  archive banner (D61) carries this caveat once, for all 49 files, instead.
- **Every file move is proven complete by grep before it is made, and by grep after.** The exhaustive
  reference lists in F53/F54/F60 are the ones the implementing session re-runs; a move whose
  post-move grep finds a surviving old path is not done.
- **No new dependency, no new build step, no `package.json` script change.** The one new
  non-documentation file this phase adds is `tests/unit/support/window.ts` (D66) — a test-support
  module, mirroring the `tests/db/support/` directory that already exists.
- **No runtime behavior changes at all.** The only `src/` diffs are three stale path strings inside
  comments (D68). `git diff` for those three files must show comment lines and nothing else.
- **`bun run lint`, `bun run typecheck` (node, web, db, unit) and `bunx electron-vite build` stay
  green after every commit**, including the pure-documentation ones — the same discipline every prior
  phase used. `bun test tests/unit` is re-run after commits 11 and 12. Conventional Commits, one per
  step of §4.
- Comments per AGENTS.md: only where the code cannot say it for itself. `tests/unit/support/window.ts`
  gets one header comment, because the hazard it exists to prevent (F58) is invisible from the code.

---

## 1. Findings

F-numbers continue from P44, which ended at **F49**. Decisions continue from **D56**.

### F50 — All three "general docs" already exist. This phase originates none of them.

The mandate reads as if `ARCHITECTURE.md`, `PACKAGING.md` and `PERF.md` were a structure to build.
They are a structure that is already built, in the wrong folder:

```
$ find docs -maxdepth 2 -type f -name '*.md' | sort
docs/v1/ARCHITECTURE.md
docs/v1/PACKAGING.md
docs/v1/PERF.md
docs/v1/SPEC.md

$ wc -l AGENTS.md README.md docs/v1/*.md
   199 AGENTS.md
   245 README.md
   203 docs/v1/ARCHITECTURE.md
   220 docs/v1/PACKAGING.md
   266 docs/v1/PERF.md
  1386 docs/v1/SPEC.md
```

`PACKAGING.md` (P14/P15) and `PERF.md` (P12/P13) are both substantial, both current, and both
already own exactly the content the mandate implies they should. **Neither is rewritten by this
phase** (D64). The aspirational reading — "create the three docs and distribute SPEC.md into them" —
is wrong on the evidence, and following it would mean either duplicating what those two files
already say or inventing content to fill a shape.

### F51 — `docs/v1/`'s problem is its *contents*, not its path.

The folder is already versioned. What makes it read wrong is that it mixes two kinds of file:

| Under `docs/v1/` today | What it actually is |
|---|---|
| `ARCHITECTURE.md` | **living** — the current-state reference, version-agnostic |
| `PACKAGING.md` | **living** — how to build and verify a package, today |
| `PERF.md` | **living** — its own header: *"It is expected to be re-measured, not rewritten from scratch"* (`PERF.md:8`) |
| `SPEC.md` | the v1 record |
| `plans/` (49 files, 33 297 lines) | the v1 record |
| `design/` (16 artboards, 1.3 MB) | **living** — the visual reference new UI is built to match |

So "reconsider the folder structure" resolves to moving four living things **out** of the v1 folder,
not to renaming the v1 folder. See D57/D58.

### F52 — `ARCHITECTURE.md` defers to `SPEC.md` for four live facts, and names SPEC.md authoritative.

This is the finding the phase turns on.

```
$ grep -n "SPEC\.md" docs/v1/ARCHITECTURE.md
3:This is the **current-state** companion to `docs/v1/SPEC.md`. SPEC's §10 phasing table is a
7:phase-history prose. When the two ever appear to disagree, SPEC.md is authoritative for behavior
23:tab instead, SPEC.md §8.18) — and the UI reads *only* `Caps`, never a `connection.kind` check, to
27:Full per-database mapping table (tree shape, pagination, exact count, cancel mechanism): SPEC.md
142:(SPEC.md §8.18). Object node paths still carry the *full* bucket-relative key on their own
190:instead (SPEC.md §8.18) — `SCAN`'s own cursor/count-budget discipline is unchanged, only where
196:Electron's `safeStorage` (Keychain-backed on macOS); see SPEC.md §6 for the storage schema and
203:SPEC.md §4 for the full diagram and rationale.
```

Line 7 is the sentence the mandate contradicts outright: *"When the two ever appear to disagree,
SPEC.md is authoritative for behavior and this file should be corrected to match."* That is precisely
"SPEC.md as a living spec." It must invert.

Lines 27, 196 and 203 are the three places `ARCHITECTURE.md` is a **stub over SPEC.md** rather than a
document in its own right:

- `ARCHITECTURE.md:27-28` — *"Full per-database mapping table … : SPEC.md §5.1."* (§5.1 is 28 lines,
  an 11-engine table.)
- `ARCHITECTURE.md:193-197` — the whole "Storage" section is 5 lines ending *"see SPEC.md §6 for the
  storage schema and the secret-cipher design."* (§6 is 53 lines.)
- `ARCHITECTURE.md:199-203` — the whole "Process model" section is 5 lines ending *"See SPEC.md §4
  for the full diagram and rationale."* (§4 is 29 lines.)

Retiring SPEC.md without moving those three bodies would leave `ARCHITECTURE.md` pointing at a
document it has just declared non-authoritative. That is the concrete meaning of *"whatever in them
is still true and durable moves into ARCHITECTURE.md."*

### F53 — `f660ffd` left six dangling references behind. Moving the living docs up repairs five of them.

`f660ffd` (*"docs: move spec/plans/design under docs/v1/"*, 2026-08-24) moved `docs/*.md` →
`docs/v1/*.md` and updated most references, but not all. These paths resolve to nothing today:

```
$ grep -rn "docs/PACKAGING\.md\|docs/PERF\.md\|docs/plans/\|docs/design/" \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out . | grep -v "docs/v1/"
./src/renderer/theme/primitives.css:1:  P16 design system (docs/design/kira-design-system) …
./src/renderer/theme/tokens.css:30:     Radius tier system (VS Code Modern UI, docs/design/vscode-modern-ui) …
./src/renderer/theme/tokens.css:55:  P16 design system (docs/design/kira-design-system): one type scale …
./scripts/verify-packaging.sh:3:# deliverable (docs/plans/P15-gh-tooling.md §2, §4) …
./scripts/verify-packaging.sh:65:      … see docs/PACKAGING.md §7"
./scripts/verify-packaging.sh:67:      … see docs/PACKAGING.md §7. Set KIRA_STRICT_UPDATE_CHECK=1 …
./.githooks/pre-commit:2:# Kira Studio pre-commit — see docs/plans/P15-gh-tooling.md §3.
```

plus, inside `docs/v1/` itself:

```
./docs/v1/PACKAGING.md:111:   `docs/PERF.md` §3*
./docs/v1/PACKAGING.md:113:   … record against 350 MB. — *not yet run, see `docs/PERF.md` §3*
./docs/v1/PERF.md:8:  rewritten from scratch — `docs/plans/P12-hardening.md` is the frozen design record
./docs/v1/PERF.md:208:1. `bun run package:mac` (see `docs/PACKAGING.md`).
./docs/v1/SPEC.md:10:>  implementation plans live in `docs/plans/`.
./docs/v1/SPEC.md:351:  4/6/8px corner-radius system) lives in `docs/design/kira-design-system/`
```

**Five of these become correct for free** the moment the living docs move up (D57): `verify-packaging.sh:65,67`
and `PERF.md:208` point at `docs/PACKAGING.md`; `PACKAGING.md:111,113` point at `docs/PERF.md`. A
sixth, `SPEC.md:351`'s `docs/design/kira-design-system/`, becomes correct when `design/` moves up
(D59) — as do `primitives.css:1` and `tokens.css:55`.

The four that do **not** self-repair are `docs/plans/` references (the plans stay put, D57) and
`tokens.css:30`'s `docs/design/vscode-modern-ui`, which is stale twice over: that folder was renamed
to `kira-design-system` in `248ba39` (P16/P24) and then moved in `f660ffd`. Confirmed absent:

```
$ find . -path ./node_modules -prune -o -name "*vscode-modern-ui*" -print
(no output)
```

Those four are repaired explicitly, in commit 1 (D68).

### F54 — Nothing mechanical reads `docs/v1/SPEC.md` or `docs/v1/plans/`. Fifty-six pieces of prose do.

No script, CI job, lint config, build step or test reads either path — the only non-prose consumers
of anything under `docs/` are `biome.json:16` and `.gitignore:157,159`, and both name `design/`
(F60), not `SPEC.md` or `plans/`.

```
$ grep -rn "docs/v1/SPEC\.md" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out . \
    | grep -v "^\./docs/v1/plans/"
./README.md:19:  `docs/v1/SPEC.md` §6.
./README.md:195:… skipping main entirely — see `docs/v1/SPEC.md` §4 for the
./README.md:217:See [`docs/v1/SPEC.md`](docs/v1/SPEC.md) §11 for the full directory breakdown.
./README.md:221:- [`docs/v1/SPEC.md`](docs/v1/SPEC.md) — the full specification: scope, architecture …
./AGENTS.md:11:- Each phase (see `docs/v1/SPEC.md` §10 phasing table) gets an Opus-authored plan
./AGENTS.md:199:Full spec: `docs/v1/SPEC.md`. Current-state architecture reference: `docs/v1/ARCHITECTURE.md`.
./docs/v1/ARCHITECTURE.md:3:This is the **current-state** companion to `docs/v1/SPEC.md`. …

$ grep -ro "docs/v1/plans/" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out . | wc -l
56
```

Of those 56, **six are live `src/`/`tests/` comments** citing a plan by path as the reason a piece of
code is shaped the way it is:

```
./src/renderer/views/shared/sqlIdent.ts:48:   (docs/v1/plans/P18-autocomplete.md D8).
./src/renderer/views/grid/DataGrid.vue:1180: … docs/v1/plans/P6-interaction-completeness.md for why).
./src/renderer/theme/primitives/AutocompleteField.vue:14,135:  docs/v1/plans/P18-autocomplete.md
./src/engine/adapters/adapter.ts:150:        docs/v1/plans/P1-connections-and-tree.md §4b
./src/main/storage/db.ts:57:                  see D2 in docs/v1/plans/P0-foundations.md
./tests/ui/budgets.spec.ts:14:                docs/v1/plans/P12-hardening.md
```

**This is the decisive evidence against moving `plans/`.** A rename would dangle all six of those
plus 49 files' worth of cross-citation, and repairing the citations inside the plan files would mean
rewriting frozen history to name a path that did not exist when it was written. See D57.

### F55 — SPEC.md's twelve sections split into durable and history, and the split is measurable.

Section sizes, from the file at `741347e`:

```
$ awk '/^## /{if(prev){print prev": "NR-start" lines"}; prev=$0; start=NR} \
       END{print prev": "NR-start+1" lines"}' docs/v1/SPEC.md
## 1. Scope: 30            ## 5. Driver adapter model: 96   ## 9.  Testing: 43
## 2. Non-functional: 42   ## 6. Storage: 53                ## 10. Phasing: 103
## 3. Stack: 28            ## 7. Caching: 28                ## 11. Repository layout: 306
## 4. Process arch: 29     ## 8. UI: 604                    ## 12. Working agreement: 12
```

The distinction that matters is **"a live fact about the system as it exists today"** versus
**"a record of why or when a decision was made."** Applied to the actual text:

| § | Verdict | Evidence from the file itself |
|---|---|---|
| Front matter (1–12) | **history, and stale** | *"Status: **P0–P31 implemented**"* (`SPEC.md:5`) — the tree is at P44. |
| 1 Scope | **mixed** | The in-scope engine list and per-engine write matrix are live (they match README's own table and every `caps.ts`). *"Deferred to the end of the v1 plan: pre-connect scripts … See phase P11"* (`:38-40`) is history — P11 shipped. |
| 2 Non-functional | **live invariants, but already owned elsewhere** | The budget table (`:50-56`) is `PERF.md` §1's subject. What is *not* owned elsewhere is the six "rules that follow" (`:58-64`) — no driver in the renderer, no DOM node per off-screen cell, columnar rows, no Vue reactivity on row data, byte-budgeted caches. Those are live architectural constraints. |
| 3 Stack | **live** | A table of what the app actually depends on. Verified against `package.json` at `741347e`. |
| 4 Process architecture | **live** | The three-process diagram, *"Why a separate engine process"*, *"One engine for all connections"*, *"Bulk data skips the main process."* `ARCHITECTURE.md:199-203` is a stub over it. |
| 5 / 5.1 Adapter model | **live, with one stale part** | §5.1's 11-engine table is entirely live. §5's `Caps` code block is explicitly *illustrative* and already outrun — the file says so itself: *"Beyond the illustrative fields above, the real `Caps` also carries…"* (`:186`). `ARCHITECTURE.md:15-44` already owns the accurate version. |
| 6 Storage | **live** | The `~/.kira-studio/` layout, the SQL schema block (`:257-271`), credentials-at-rest, the S3 and SQLite column-reuse rules. `ARCHITECTURE.md:193-197` is a stub over it. |
| 7 Caching | **live** | L1/L2/L3, their invalidation stories, *"No speculative fetching."* `ARCHITECTURE.md` has **nothing** on caching. |
| 8 UI | **live description, fastest-rotting** | 604 lines, 18 subsections. Genuinely current (§8.4's tab-identity rule, §8.18's Browse model, §8.14's staged-vs-immediate write split) but laced with phase attribution (*"(P31 D8)"*, *"(P42)"*) and mockup-vs-shipped narrative. See D63. |
| 9 Testing | **live, and wrong** | *"**No unit tests.** Two suites only."* (`:926`). P44 added `tests/unit/`; `tests/electron-db/` has existed since P32. There are four test directories. |
| 10 Phasing | **history — and still accruing** | See F56. |
| 11 Repository layout | **live tree, history annotations** | The tree is real (*"This is the tree as built"*, `:1072`) but its annotations are ~80 % phase narrative — *"(P39) contextMenu.ts and layout.ts joined this folder from workbench/"*, *"Iteration 2 also found, but left unfixed…"*. It is also **stale**: the `tests/` block (`:1306-1311`) lists `db/`, `electron-db/`, `ui/` and no `unit/`, and `docs/` is a bare entry with no children. |
| 12 Working agreement | **live, and duplicated** | Both bullets restate what `AGENTS.md` already says (branch policy, no per-phase PRs). |

### F56 — §10's phasing table is not finished history. P45 and P46 are queued *in it*, today.

```
$ tail -3 <the §10 table>
| **P44 Unit tests** | … | Implemented per `docs/v1/plans/P44-sparse-unit-tests.md`, five commits …
| **P45 Docs cleanup** | … | Not yet planned — queued |
| **P46 Disable unnecessary Chromium/Electron features** | … | Not yet planned — queued |
```

`AGENTS.md:11` depends on this: *"Each phase (see `docs/v1/SPEC.md` §10 phasing table) gets an
Opus-authored plan…"*. The table is simultaneously (a) the definitive record of what P0–P44
shipped — the only durable record of decisions like P43's D46 (`Caps.maxPageSize`) and P44's D49
(`tests/unit/` vs `tests/db/`) — and (b) the live backlog the next phase is read out of.

**A reading of "retired as history" that freezes this table deletes the sequence's own ledger and
leaves P46 homeless.** D60 resolves it: the ledger is history *in kind* — it records what happened —
and history of an ongoing thing keeps being written. It stays where it is and keeps accruing rows.

### F57 — `tests/db/` holds three Docker-free specs, and one of them is 95 % of the runtime.

```
$ for f in preconnect metadata-cache run-state; do bun test tests/db/$f.spec.ts; done
preconnect       Ran 12 tests across 1 file. [22.99s]
metadata-cache   Ran  6 tests across 1 file. [1111.00ms]
run-state        Ran  5 tests across 1 file. [ 102.00ms]

$ bun test tests/db/preconnect.spec.ts tests/db/metadata-cache.spec.ts tests/db/run-state.spec.ts
 23 pass  0 fail  447 expect() calls   Ran 23 tests across 3 files. [23.61s]

$ bun test tests/unit          # the P44 baseline
 52 pass  0 fail  109 expect() calls   Ran 52 tests across 5 files. [411.00ms]
```

P44 §8 item 4 hands all three forward. But they are not three of a kind:

- `metadata-cache.spec.ts` and `run-state.spec.ts` (P43 iteration 3) need **nothing** — `bun:sqlite`
  in memory, and a stubbed `window`. 1.2 s combined.
- `preconnect.spec.ts` (P11 D16) spawns **real OS processes** — `sh`, `sleep`, `echo` — and waits on
  them. 23.0 s. Its own header says so: *"it spawns real short-lived processes against the OS itself,
  mirroring redis.spec.ts's numbered scenario style."*

Moving all three would take `bun run test:unit` from **411 ms to 24 s**, a 58× slowdown of the one
suite whose entire value is that it is instant. D66 moves two and states the rule that leaves the
third.

### F58 — Moving `run-state.spec.ts` into `tests/unit/` breaks `view-state.spec.ts`. Reproduced, root-caused, fixed.

This is not a `git mv`. Copying all three into `tests/unit/` and running the suite:

```
$ bun test tests/unit
tests/unit/view-state.spec.ts:
# Unhandled error between tests
64 |   onFlushBeforeClose: (cb: () => void): (() => void) => kira.onFlushBeforeClose(cb),
                                                                  ^
TypeError: kira.onFlushBeforeClose is not a function.
      at <anonymous> (/home/user/kira-studio/src/renderer/bridge/control.ts:64:62)
      at /home/user/kira-studio/src/renderer/state/tabs.ts:130:9

 70 pass  1 fail  1 error   Ran 71 tests across 8 files. [23.62s]
```

**Root cause.** Both specs install a `globalThis.window` stub, and they install *different* ones:

```
tests/db/run-state.spec.ts:11:  (globalThis as { window?: unknown }).window = { kira: {} };
tests/unit/view-state.spec.ts:17: (globalThis as { window?: unknown }).window = {
                                     kira: new Proxy({}, { get: () => () => () => {} }),
                                     addEventListener: () => {} };
```

`bun test` runs every file in one process with **one shared module registry**, and
`src/renderer/bridge/control.ts:33` captures `const kira = window.kira` **at module scope**. Files
load in name order, so `run-state.spec.ts` imports `state/ops` → `bridge/control` first, freezing
`control.ts` around the bare `{}`. When `view-state.spec.ts` later imports `state/tabs`,
`tabs.ts:130` calls `control.onFlushBeforeClose(...)` against that frozen bare object and throws
at import time — taking the whole file's five tests with it.

`view-state.spec.ts`'s own header (lines 13–16) already documents this exact hazard *for itself*. The
hazard is not that a stub is wrong; it is that **a per-file stub is order-dependent, and the weakest
one wins.**

**Fix, proven by running it.** One shared stub, in a support module imported before any dynamic
import, used by both files. With `tests/unit/support/window.ts` in place and both specs importing it:

```
$ bun test tests/unit            # with all three moved in
 75 pass  0 fail  556 expect() calls   Ran 75 tests across 8 files. [24.27s]

$ bun test tests/unit            # with the two of D66 moved in
 63 pass  0 fail  539 expect() calls   Ran 63 tests across 7 files. [1313.00ms]

$ bun run typecheck:unit ; echo exit=$?
exit=0
$ bunx biome check tests/unit/
Checked 9 files in 19ms. No fixes applied.
```

The scratch files were removed afterwards; `git status --porcelain` is empty.

### F59 — `README.md` carries four claims the tree falsifies today.

Each verified against the tree at `741347e`, not against another document:

1. **`README.md:176`** — *"There are two suites, and deliberately no unit tests."* False since P44:
   `tests/unit/` holds five specs and `bun run test:unit` is a real script (`package.json:31`).
2. **`README.md:237`** — the *"Not in v1"* list still contains *"credential encryption"* and
   *"unit tests."* Credential encryption shipped in P25 — `src/main/secret-cipher.ts` exists, and
   README's own line 18 says *"**Credentials are encrypted at rest**"* eighteen lines above the list
   that denies it. The file contradicts itself.
3. **`README.md:35,241`** — S3's Writes column reads *"read-only"* and line 241 says *"S3 is
   read-only."* False since P33: `src/engine/adapters/s3/` contains `mutate.ts` **and** `transfer.ts`,
   and `s3/caps.ts`'s own header comment reads *"P33: object edit/delete/upload/download, all
   executed immediately (D1)."*
4. **`README.md:156-159,227`** — *"`bun run typecheck` — Runs all three splits below"* (there are
   four: `typecheck:node`, `:web`, `:db`, `:unit`), with `typecheck:unit` and `test:unit` absent from
   the script table; and *"`docs/v1/plans/` — one implementation plan per phase, **P0 through P23**"*
   against 49 files reaching P44. Line 211-213's layout block also omits `tests/unit`.

D67 bounds what this phase does about these.

### F60 — `biome.json` and `.gitignore` pin `docs/v1/design` by path.

```
$ grep -rn "docs/v1/design" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out . \
    | grep -v "^\./docs/v1/plans/"
./src/renderer/theme/primitives/ViewChrome.vue:12:// in docs/v1/design/kira-design-system). …
./src/renderer/theme/primitives/ViewChrome.vue:81:  … (see docs/v1/design/kira-design-system LAW 12). -->
./README.md:228:- [`docs/v1/design/kira-design-system/`](docs/v1/design/kira-design-system/) …
./biome.json:16:      "!docs/v1/design",
./.gitignore:157:# canvas editor). Rebuild it with docs/v1/design/kira-design-system/build.mjs
./.gitignore:159:docs/v1/design/*/[a-z]*-design-system.html
```

Six sites, two of them behavioral (`biome.json`'s lint exclusion, `.gitignore`'s generated-artboard
ignore). `f660ffd`'s own commit message records that it had to fix these same two when it created
`docs/v1/`, *"…that would otherwise have started linting/tracking files they're meant to exclude."*
This is why the `design/` move is its own commit (D59) with its own verification, not folded in
with the three `.md` files.

### F61 — Non-finding: `AGENTS.md` already points at `ARCHITECTURE.md`, and already splits process from facts.

The mandate's *"which `AGENTS.md` points to"* is already satisfied, six times over:

```
$ grep -n "ARCHITECTURE\.md" AGENTS.md
4:live in `docs/v1/ARCHITECTURE.md`, not here. This file is process and environment only …
111:See `docs/v1/ARCHITECTURE.md`'s Kafka section for *why* …
140:See `docs/v1/ARCHITECTURE.md`'s SQLite section for what the adapter itself relies on
163:See `docs/v1/ARCHITECTURE.md`'s ClickHouse section for the adapter's own design facts …
181:See `docs/v1/ARCHITECTURE.md`'s RabbitMQ section for the adapter's own design facts …
199:Full spec: `docs/v1/SPEC.md`. Current-state architecture reference: `docs/v1/ARCHITECTURE.md`.
```

`AGENTS.md:3-5` already states the division of labour this phase is meant to establish: *"Facts about
the app itself … live in `docs/v1/ARCHITECTURE.md`, not here. This file is process and environment
only."* So AGENTS.md needs **two** changes, not a restructure: the six paths, and line 199's framing
— *"Full spec: `docs/v1/SPEC.md`"* is the last place in a live document that calls SPEC.md the spec.

Recorded as a non-finding so a later phase reads the small AGENTS.md diff as sufficient rather than
as an oversight.

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| **D57** | **`docs/v1/SPEC.md` and `docs/v1/plans/` do not move. Their paths are unchanged, byte-for-byte, and no `git mv` touches either.** The restructure is the inverse: the living documents move *out* of `docs/v1/`. | F54 is decisive. 56 in-repo citations name `docs/v1/plans/` by path, six of them in live `src/`/`tests/` comments explaining why a piece of code is shaped as it is; `docs/v1/SPEC.md` is named by README ×4, AGENTS.md ×2 and ARCHITECTURE.md ×1. A move dangles all of them, and the only way to un-dangle the 50 inside `docs/v1/` is to rewrite frozen history to name a path that did not exist when it was written — the exact falsification "retired as history" exists to prevent (§0). Against that cost, a move buys nothing: `docs/v1/` **already** says "v1" (F51). A folder does not become history by being renamed; it becomes history by containing only history and saying so (D61). |
| **D58** | **`ARCHITECTURE.md`, `PACKAGING.md` and `PERF.md` move up to `docs/`.** `docs/v1/` is then left holding exactly the v1 record: `SPEC.md`, `plans/`. Target tree in §3. | This is the whole of "the `docs/` folder structure is reconsidered to match," and it is what makes the structure self-describing: **`docs/*.md` is living, `docs/v1/` is the v1 record.** It also repairs five references that have dangled since `f660ffd` (F53) — `verify-packaging.sh:65,67` and `PERF.md:208` already say `docs/PACKAGING.md`; `PACKAGING.md:111,113` already say `docs/PERF.md`. Twenty-six reference sites change, all listed in commit 2, none of them mechanical consumers (F54). |
| **D59** | **`docs/v1/design/` moves to `docs/design/`, in its own commit**, with `biome.json:16` and `.gitignore:157,159` updated in that same commit and the exclusion re-verified by running `bun run lint` and `git status` before and after. | The design system is a living reference, not a phase record: its own README describes a rebuild command (`node build.mjs`) and `ViewChrome.vue:12,81` cites it as the current authority for view-chrome layout ("LAW 12"). Leaving it inside the v1 *record* folder would contradict D58's rule on its first application. Its own commit because two of its six reference sites are behavioral, and `f660ffd`'s commit message records those same two as a thing it nearly got wrong (F60). Bonus: `SPEC.md:351`, `primitives.css:1` and `tokens.css:55` already say `docs/design/kira-design-system/` and become correct (F53). |
| **D60** | **"Retired as history" means exactly three things, and nothing more.** (1) **SPEC.md loses its normative role.** `ARCHITECTURE.md:7`'s *"SPEC.md is authoritative for behavior"* inverts: `ARCHITECTURE.md` is authoritative for what the app is today, the tree is authoritative over both, and SPEC.md is the record of what v1 was specified to be. (2) **No historical record is ever retro-edited** — not a plan file, not a §10 row — so a path named in one is read as "as of that phase" (D61 says this once, in the banner). (3) **§10's ledger keeps accruing rows**, and `AGENTS.md`'s plan-per-phase convention keeps writing into `docs/v1/plans/`. | (1) is the mandate's own sentence. (2) is the only reading under which the word "history" means anything — a record edited to match the present is not a record. (3) is forced by F56: P46 is queued in that table right now, six live `src/` comments cite plan files as live rationale, and there is no second place in this repo where a phase's outcome is written down. Freezing the ledger would not retire history; it would end it. The alternative considered and rejected — a new `docs/plans/` for post-v1 phases — splits one continuously-numbered sequence across two directories *and* makes six already-dangling `docs/plans/P1x-*.md` references resolve to a directory that exists but lacks the file, which is worse than dangling. |
| **D61** | **A new `docs/v1/README.md` is the archive banner** — twenty-odd lines, no content of its own: what this folder is, that it is the v1 record and not a specification, that `docs/ARCHITECTURE.md` is authoritative for current behavior, that every path named inside is as-of-that-phase and may have moved since, and that §10's phasing table is the one part still being appended to. `SPEC.md`'s own front matter (`:1-12`) is rewritten to say the same in three lines and to fix its stale *"P0–P31 implemented"* status and its `docs/plans/` pointer. | A banner file is how the two rules in D60 get stated **once** instead of 49 times, and it is the piece that makes D57's "don't move it" honest — the folder announces what it is instead of relying on its name. Rewriting SPEC.md's front matter is the one edit this phase makes to SPEC.md's body outside §10, and it is navigational, not historical: lines 1–12 are a reader's-guide header, not a record of anything. |
| **D62** | **`ARCHITECTURE.md` absorbs six bodies from SPEC.md**, each replacing a stub or filling a gap, in five commits (§4 commits 4–8): §4 Process architecture → replaces `ARCHITECTURE.md:199-203`; §6 Storage → replaces `:193-197`; §7 Caching → **new**, there is nothing today; §5 + §5.1 → the mapping table replaces the pointer at `:27-28` (§5's illustrative `Caps` block is *not* copied — `:15-44` already carries the accurate one, F55); §3 Stack + §2's six "rules that follow" + §9 Testing → new; §11's tree → new, re-derived from the actual tree. | This is the mandate's *"whatever in them is still true and durable moves into `ARCHITECTURE.md`."* The selection is F55's verdict column, filtered to what `ARCHITECTURE.md` does not already own. Each body is a self-contained section, so each is one commit and one revert. |
| **D63** | **`ARCHITECTURE.md` deliberately does *not* absorb §8's 604 lines verbatim.** It gains one **UI architecture** section of roughly 60–80 lines carrying the durable *structure* — which view kinds exist and what selects one (page kind, never connection kind); the tab-identity rule (`{id, connectionId, path, kind, state}`, identity is `id` not `path`, §8.4); the session-restore reconnect gate; the staged-pending-changes model for SQL grids versus immediate writes everywhere else (§8.14 vs §8.7–8.9); the cell editor as a panel five view kinds mount rather than a tab kind; the Browse panel's one-level-at-a-time model and why it exists (§8.18, `caps.keyBrowser`); and the shared find/chunked-scan machinery. It does **not** restate per-dialog field lists, per-menu row inventories, or mockup-versus-shipped narrative, and it says so in its own text, pointing at `docs/v1/SPEC.md` §8 for the v1-era detail and at `tests/ui/` for what is actually asserted. | §8 is 44 % of SPEC.md and the fastest-rotting part of it. Copying it wholesale would recreate the living-spec this phase exists to retire — a 600-line prose restatement of UI behavior whose real source of truth is the code plus 26 Playwright specs, and which the very next UI phase makes stale. Distilling the structural rules keeps what a future session actually needs to look up (why a Redis bucket is a leaf, why a tab reopens rather than reuses) and drops what it would be misled by. Stated as a decision, at length, so a later phase reads the omission as chosen (§6). |
| **D64** | **`PACKAGING.md` and `PERF.md` are moved and not otherwise edited**, beyond the two internal `docs/PERF.md` links in `PACKAGING.md:111,113` that the move makes correct on their own. No content is originated for either. | F50: both already exist, are current, and already own their subject. The mandate names them as *pointer targets* — *"which itself points out to the general docs"* — not as documents to write. Originating content for them would mean inventing packaging or performance claims this phase cannot verify (`PERF.md`'s own unrun macOS rows are honest gaps owned by whoever next has the hardware, not gaps for a docs phase to fill). |
| **D65** | **The 49 files in `docs/v1/plans/` are edited by exactly zero commits in this phase.** `git diff --name-only` for the whole phase must show no path under `docs/v1/plans/` other than this plan file itself. | D60 rule 2. The alternative — sweeping the plans for paths this phase moves — would touch 20+ files to make historical statements say something that was not true when written, and would still miss the ones where the path is embedded in quoted command output. The banner (D61) covers all of them, correctly, in one sentence. |
| **D66** | **P44's handoff is honoured for two of its three files.** `tests/db/metadata-cache.spec.ts` and `tests/db/run-state.spec.ts` are `git mv`'d to `tests/unit/`; **`tests/db/preconnect.spec.ts` stays.** The rule that decides it, recorded in `ARCHITECTURE.md`'s new testing section so the residue is a decision and not an oversight: **`tests/unit/` is the suite that needs nothing external and finishes in about a second; `tests/db/` is the Bun suite that needs a real external resource — a container for every engine, and the OS process table for `preconnect.spec.ts`.** The move additionally adds `tests/unit/support/window.ts` (F58) and repoints both `run-state.spec.ts` and `view-state.spec.ts` at it. No import path changes: both moved files use `../../src/…`, and `tests/unit/` sits at the same depth as `tests/db/` (verified — `typecheck:unit` exit 0 with no edit). | P44 §8 item 4 names three files and calls it "a ten-minute job." Two of its premises are wrong on measurement. First, `preconnect.spec.ts` is **23.0 s of 24.1 s** (F57) — folding it in makes `bun run test:unit` 58× slower, destroying the property that makes a unit suite worth running. It is also not a unit test by P44's own gates: it spawns real `sh`/`sleep` processes and waits on the OS. "Needs an external resource" puts it on the right side of a real line rather than "is not a container" putting it on the wrong side of an arbitrary one. Second, the move is not mechanical: it breaks `view-state.spec.ts` outright (F58), and the fix — one shared stub — was written and run here (`63 pass, 0 fail, 1.31 s`). |
| **D67** | **`README.md` is repaired only where a claim is false, and only in the four places F59 lists**, plus the link updates D58/D59 force. Its Documentation section is restructured to the new two-tier shape (living docs first, then `docs/v1/` as the v1 record). No feature audit, no rewrite of the engine table, no new prose about the app. | README is the front door to every document this phase moves, so its links change whether or not its content does — and a docs-cleanup phase that leaves the entry point saying *"deliberately no unit tests"* one phase after adding them, and listing *"credential encryption"* as not-in-v1 eighteen lines below saying credentials are encrypted, has not cleaned anything up. The bound is what keeps it a docs phase: each of the four repairs is one line to a handful of words, each verified against a named file in the tree (F59), and anything requiring a judgment about the app rather than a lookup is out of scope (§6). |
| **D68** | **Three stale `src/` comment paths are repaired in commit 1**, together with the two non-`docs/` script comments: `src/renderer/theme/tokens.css:30` (`docs/design/vscode-modern-ui` → `docs/design/kira-design-system`, a folder renamed in `248ba39`), `scripts/verify-packaging.sh:3` and `.githooks/pre-commit:2` (`docs/plans/` → `docs/v1/plans/`), plus `docs/v1/PERF.md:8`'s same `docs/plans/` slip. `primitives.css:1`, `tokens.css:55` and `ViewChrome.vue:12,81` are handled by commit 3's `design/` move instead. | These are the four references F53 shows will **not** self-repair, and they are dangling *today*, independently of anything this phase does. Repairing them first, in one small revertible commit, means every later commit's post-move grep can assert **zero** stale `docs/` paths repo-wide rather than "zero except the four that were already broken." Comment-only diffs; `git diff` for the three source files shows comment lines and nothing else (§0). |

---

## 3. The `docs/` tree, before and after

```
BEFORE                                  AFTER
docs/                                   docs/
  v1/                                     ARCHITECTURE.md   ← authoritative for current behavior
    ARCHITECTURE.md                       PACKAGING.md      ← moved verbatim (D64)
    PACKAGING.md                          PERF.md           ← moved verbatim (D64)
    PERF.md                               design/
    SPEC.md                                 kira-design-system/   ← moved verbatim (D59)
    design/                               v1/               ← the v1 record, path unchanged (D57)
      kira-design-system/                   README.md       ← NEW: the archive banner (D61)
    plans/  (49 files)                      SPEC.md         ← front matter only (D61)
                                            plans/  (49 files, byte-for-byte untouched, D65)
```

The rule the shape encodes: **`docs/*.md` is living and gets corrected; `docs/v1/` is the record of
v1 and gets appended to, never rewritten.**

`AGENTS.md` (repo root, process and environment only) and `README.md` (repo root, the front door)
are unchanged in location and unchanged in role.

---

## 4. Implementation order

Thirteen commits. Each is one sitting, independently reviewable and independently revertible, and
each leaves `bun run lint` / `bun run typecheck` (node, web, db, unit) / `bunx electron-vite build`
green — pure-documentation commits included, per §0.

Ordering rationale: repair what is already broken (1), then move files without changing a word
(2–3), then move content into `ARCHITECTURE.md` (4–8) **before** declaring SPEC.md non-authoritative
(9) — so there is never a window where the archive is marked non-authoritative while
`ARCHITECTURE.md` still stubs out to it. Pointers follow the content (10), the test move is
independent of all of it (11–12), and the §10 row is written last (13), per this repo's convention.

1. **`docs: repair the dangling docs/ paths f660ffd left behind`** — D68/F53.
   `src/renderer/theme/tokens.css:30`, `scripts/verify-packaging.sh:3`, `.githooks/pre-commit:2`,
   `docs/v1/PERF.md:8`. Comment/prose lines only; no behavior. Verify: `git diff` shows only comment
   lines in the two source-adjacent files, and `grep -rn "docs/plans/" --exclude-dir={node_modules,.git,out} .`
   returns only hits inside `docs/v1/` (frozen history, D65).

2. **`docs: ARCHITECTURE.md, PACKAGING.md and PERF.md move up to docs/`** — D57/D58.
   `git mv docs/v1/{ARCHITECTURE,PACKAGING,PERF}.md docs/`. Then every reference, exhaustively
   (26 sites, from F52/F53/F54's greps):
   - `README.md` — lines 11, 100, 139, 223, 225, 238 (`docs/v1/PACKAGING.md` ×4,
     `docs/v1/PERF.md` ×2).
   - `AGENTS.md` — lines 4, 111, 140, 163, 181, 199.
   - `.github/workflows/ci.yml:71`; `.github/workflows/release.yml:40,51,60`;
     `electron-builder.yml:45`.
   - `src/engine/cache/counts.ts:9`, `src/engine/adapters/registry.ts:11`, `src/main/window.ts:31`
     (comment lines only).
   - `tests/ui/memory.spec.ts:313`, `tests/ui/leaks.spec.ts:241`, `tests/ui/budgets.spec.ts:172`
     (comment lines only).
   - Inside the moved files: `PACKAGING.md:3` and `PERF.md:3`'s `../README.md` relative links become
     `../README.md` → still one level up from `docs/`, so **unchanged** — confirm rather than assume.
   **No content edit of any kind in this commit.** Post-move grep must return zero hits for
   `docs/v1/ARCHITECTURE.md`, `docs/v1/PACKAGING.md`, `docs/v1/PERF.md` outside `docs/v1/plans/`.

3. **`docs: the design system moves to docs/design/`** — D59/F60.
   `git mv docs/v1/design docs/design`. Update `biome.json:16` (`!docs/v1/design` → `!docs/design`),
   `.gitignore:157,159`, `README.md:228`, `src/renderer/theme/primitives/ViewChrome.vue:12,81`.
   **Verify the two behavioral pins specifically**: `bun run lint` before and after must both report
   the same file count (461 at `741347e`) — a broken exclusion shows up as the 16 generated
   `.dc.html` artboards entering the check; and `git status --porcelain` must stay empty after the
   move, proving `.gitignore`'s generated-artboard pattern still matches.

4. **`docs(architecture): the process model moves out of the retired spec`** — D62.
   `ARCHITECTURE.md`'s 5-line "Process model" stub (`:199-203`) is replaced by SPEC.md §4's body: the
   three-process diagram, *"Why a separate engine process"*, *"One engine for all connections"*,
   *"Bulk data skips the main process."* The `MessageChannelMain`/`MessagePort` claim is re-verified
   against `src/main/engine-host.ts` and `src/renderer/bridge/port.ts` before it is moved.

5. **`docs(architecture): storage and caching move out of the retired spec`** — D62.
   §6's body (the `~/.kira-studio/` layout, the schema block, credentials-at-rest, the S3 and SQLite
   column-reuse rules) replaces `ARCHITECTURE.md:193-197`'s stub; §7's body (L1/L2/L3, invalidation,
   *"No speculative fetching"*, the observability line) is a **new** section — `ARCHITECTURE.md` has
   nothing on caching today. The schema block is re-verified against
   `src/main/storage/schema/` and `src/main/storage/migrations/` before it is moved.

6. **`docs(architecture): the per-engine mapping table moves in`** — D62.
   §5.1's 11-engine table (tree levels, default view, pagination, exact count, cancel mechanism) plus
   the SQS/RabbitMQ read-policy and cancellation paragraphs replace `ARCHITECTURE.md:27-28`'s pointer.
   §5's illustrative `Caps` code block is **not** copied (F55) — `ARCHITECTURE.md:15-44` already
   carries the accurate contract. The three structural `canUpdate`/`canDelete: false` rationales
   (ClickHouse/Kafka/RabbitMQ) are already in `ARCHITECTURE.md`'s per-engine sections; SPEC §5's
   copies are dropped rather than duplicated.

7. **`docs(architecture): the stack, the invariants and the testing strategy move in`** — D62/D66.
   Three new sections. **Stack** = §3's table, re-verified against `package.json` at implementation
   time. **Invariants** = §2's six "rules that follow" (no driver in the renderer; no DOM node per
   off-screen cell; columnar rows with no Vue reactivity; virtualized long lists; byte-budgeted
   caches; every >150 ms op shows progress and a working stop) with a pointer to `docs/PERF.md` §1
   for the budgets themselves rather than a second copy of the table. **Testing** = §9, corrected:
   there are four test directories, not two suites — `tests/unit/`, `tests/db/`, `tests/electron-db/`,
   `tests/ui/` — and D66's rule for which is which is stated here.

8. **`docs(architecture): a UI architecture section, distilled from the spec's §8`** — D63.
   One new section, 60–80 lines, carrying only the durable structure D63 enumerates, and saying in
   its own text what it deliberately omits and where to find it.

9. **`docs(v1): SPEC.md and plans/ are the v1 record, not a living spec`** — D60/D61.
   New `docs/v1/README.md` (the archive banner). `SPEC.md:1-12`'s front matter rewritten — the stale
   *"P0–P31 implemented"* status corrected, the `docs/plans/` pointer fixed to `docs/v1/plans/`, and
   two lines saying what this document now is. `ARCHITECTURE.md:1-13`'s opening inverted: it is
   authoritative for current behavior, the tree outranks both, `docs/v1/SPEC.md` is the record of
   what v1 was specified to be, and a "Related documents" block points out to `docs/PACKAGING.md`,
   `docs/PERF.md`, `docs/design/`, `README.md` and `AGENTS.md` — the pointer structure the mandate
   names. **No `docs/v1/plans/` file is touched** (D65).

10. **`docs: AGENTS.md and README point at the new docs layout`** — D67/F61.
    `AGENTS.md:199` rewritten — *"Full spec: `docs/v1/SPEC.md`"* is the last live sentence calling
    SPEC.md the spec; it becomes a pointer to `docs/ARCHITECTURE.md` as the current-state reference
    and `docs/v1/` as the v1 record. `AGENTS.md:11`'s *"see `docs/v1/SPEC.md` §10 phasing table"*
    stays — that is F56's live backlog and it is still correct. `README.md`: the Documentation
    section restructured to the two-tier shape (§3), the layout block gains `tests/unit` and a
    corrected `docs/` line, the script table gains `typecheck:unit`/`test:unit` and stops saying
    "three splits," the Tests section stops saying *"deliberately no unit tests"*, the *"Not in v1"*
    list drops credential encryption and unit tests, and S3's Writes cell and line 241 stop saying
    read-only (F59, all four verified against named files).

11. **`test(unit): one shared window stub for the specs that install one`** — D66/F58.
    New `tests/unit/support/window.ts`; `tests/unit/view-state.spec.ts`'s inline block (lines 17–25)
    replaced by `import './support/window';`, its explanatory comment kept and generalized into the
    support module's header. No behavior change and no move yet — this commit exists so the fix is
    reviewable on its own and so commit 12 is a clean move. **Verify by running:**
    `bun test tests/unit` → **52 pass, 0 fail** (unchanged from the baseline); `bun run typecheck:unit`
    → exit 0.

12. **`test(unit): the two Docker-free specs move out of tests/db/`** — D66/F57/F58.
    `git mv tests/db/metadata-cache.spec.ts tests/db/run-state.spec.ts tests/unit/`;
    `run-state.spec.ts`'s bare `window` stub (its line 11) replaced by `import './support/window';`.
    No import-path edits — both files already use `../../src/…` and `tests/unit/` is the same depth.
    `tests/db/preconnect.spec.ts` is untouched (D66). **Verify by running:** `bun test tests/unit`
    → **63 pass, 0 fail, 539 expect() calls, ~1.3 s** (measured, F58); `bun run typecheck` → exit 0,
    all five projects; `bun test tests/db/preconnect.spec.ts` → 12 pass.

13. **`docs(spec): record P45's docs cleanup`** — the §10 P45 row, written **after** commit 12 lands.
    Per this repo's convention (P44 §8 item 1, and every phase before it), the row is a separate
    final commit outside the numbered implementation order. It must cover: the `docs/` restructure
    and the rule it encodes; that `SPEC.md`/`plans/` did **not** move and why (D57); what
    `ARCHITECTURE.md` absorbed and what it deliberately did not (D62/D63); the three rules of "retired
    as history" (D60), because they are a standing repository convention from now on and not a detail
    of one phase; and the `tests/db/` → `tests/unit/` reconciliation including the third file left
    behind and the measured reason (D66).

---

## 5. Verification

**What this box can do, plainly.** `bun run lint`, `bun run typecheck` (all five projects),
`bunx electron-vite build` and `bun test tests/unit` all run here for real; all four were run against
`741347e` while writing this plan, with the results quoted in the header. Docker image pulls return
403, so every Testcontainers spec self-skips or fails at `isDockerAvailable()`;
`tests/electron-db/kafka.spec.ts` additionally needs an `electron-rebuild` that cannot fetch
Electron's headers here.

**Almost none of that matters to this phase**, and that is worth stating rather than hedging. Twelve
of the thirteen commits touch only documentation, configuration comments, and two test files that run
here. The only commits with any executable consequence are:

| Commit | What could actually break | How it is caught here |
|---|---|---|
| 1 | Nothing — comment text in a `.css`, a shell script and a git hook | `bun run lint`; `sh -n scripts/verify-packaging.sh`; `git diff` shows comment lines only |
| 2 | Nothing — `.md` moves plus comment/prose updates. CI/workflow/`electron-builder.yml` hits are all inside `name:`/`description:` strings, not paths anything resolves | `bun run lint`/`typecheck`/`build`; post-move grep returns zero old paths |
| 3 | **Real risk**: `biome.json`'s lint exclusion and `.gitignore`'s generated-artboard ignore both name the moved path | `bun run lint` file count identical before and after (461); `git status --porcelain` empty after the move (F60, and `f660ffd`'s own commit message on the same hazard) |
| 4–10 | Nothing — documentation prose | `bun run lint` (Biome checks `.md` in this repo — 461 files includes them); `typecheck`; `build` |
| 11 | `tests/unit/view-state.spec.ts` losing its stub | `bun test tests/unit` → 52 pass, 0 fail; `typecheck:unit` exit 0 |
| 12 | The F58 collision, and `test:db`'s content changing | `bun test tests/unit` → 63 pass, 0 fail, ~1.3 s; `bun test tests/db/preconnect.spec.ts` → 12 pass; `bun run typecheck` exit 0 |

**Every claim in this plan about a file's contents, a reference site, or a test result was produced
by running the command and reading the output**, at `741347e`. Specifically: the move of all three
Docker-free specs into `tests/unit/` was performed in a scratch copy and run (**70 pass, 1 fail, 1
error** — F58's collision); the two-file move plus the shared stub was performed and run
(**63 pass, 0 fail, 539 expect() calls, 1.31 s**); `bun run typecheck:unit` and `bunx biome check
tests/unit/` were run against both arrangements (exit 0, *"Checked 9 files… No fixes applied."*);
and the scratch files were removed, leaving `git status --porcelain` empty. Per-spec timings in F57
are three separate real runs.

**The one thing this phase cannot verify here** is `bun run test:db` end to end after commit 12 —
it needs Docker. But the change to it is subtractive and mechanical (two files leave a directory the
runner globs), the one Docker-free spec left in it was run here (12 pass), and `bun run typecheck:db`
covers the rest. Recorded as a known, bounded gap rather than a green claim.

---

## 6. Explicitly out of scope

Written up at length so a later phase reads each absence as a decision, not an oversight — this
repo's own convention.

- **Moving or renaming `docs/v1/SPEC.md` or `docs/v1/plans/`.** D57. The 56-citation cost is real and
  measured (F54); the benefit is a folder name that already says "v1."
- **Editing any of the 49 plan files.** D65. Including the ones whose text will, after commit 12,
  name `tests/db/metadata-cache.spec.ts` and `tests/db/run-state.spec.ts` at paths that no longer
  exist (`P43-functionality-review-iter3.md:708-709,728-729,764,774,784,888-889,905-907,998`;
  `P44-sparse-unit-tests.md:110-111,121,131,587,742-743,853-854,898-899`). Those sentences were true
  when written and the banner (D61) says so once for all of them. This is D60 rule 2 applied to the
  case that most tempts an exception.
- **Copying SPEC.md §8's 604 lines into `ARCHITECTURE.md`.** D63. The distilled structural section
  replaces it deliberately.
- **Copying SPEC.md §10 (the ledger) or §12 (the working agreement) anywhere.** §10 stays put and
  keeps accruing (D60 rule 3). §12's two bullets already exist in `AGENTS.md` — *"One feature branch
  for all of v1. No per-phase PRs"* — and a third copy is how they drift apart.
- **Rewriting `PACKAGING.md` or `PERF.md`.** D64. Both are current and own their subjects.
  `PERF.md`'s unrun macOS rows and `PACKAGING.md` §4's *"not yet run"* human checklist are honest
  gaps owned by whoever next has real hardware — a docs phase filling them in would be fabricating
  measurements.
- **A general `README.md` accuracy audit.** D67 bounds it to F59's four verified-false claims plus
  the link updates the moves force. The engine capability table, the Features list and the keyboard
  section are not re-derived from the tree here; if that is wanted it is its own phase, and it is a
  *content* review, not a docs-structure one.
- **Any `src/` change beyond four comment strings.** D68 and commits 2–3's comment updates. This
  phase changes no runtime behavior; `git diff` for every touched source file shows comment lines
  only.
- **Moving `tests/db/preconnect.spec.ts`, and creating a third test directory for it.** D66. It needs
  a real external resource (the OS process table) and costs 23 s; a `tests/integration/` directory
  holding exactly one file is a structure invented for a single case. P11 D16 put it in `tests/db/`
  deliberately and the rule D66 writes down keeps it there for a stated reason.
- **`package.json` script changes.** None are needed: `test:db` globs a directory whose contents
  shrink by two, `test:unit` globs one whose contents grow by two, and both already exist.
- **`scripts/demo-dbs/README.md`.** It is accurate, self-contained, and names no path this phase
  moves — verified by grep.

---

## 7. Acceptance checklist

- [ ] `docs/` contains exactly `ARCHITECTURE.md`, `PACKAGING.md`, `PERF.md`, `design/` and `v1/` at
      its top level; `docs/v1/` contains exactly `README.md`, `SPEC.md` and `plans/`.
- [ ] `git log --diff-filter=R --name-status` for this phase shows the three `.md` moves, the
      `design/` move and the two spec moves — **and no rename under `docs/v1/plans/`.**
- [ ] `git diff --stat` for the whole phase shows **zero** changed lines in any file under
      `docs/v1/plans/` other than `P45-docs-cleanup.md` itself (D65).
- [ ] `grep -rn "docs/v1/\(ARCHITECTURE\|PACKAGING\|PERF\)\.md\|docs/v1/design" --exclude-dir={node_modules,.git,out} .`
      returns hits only inside `docs/v1/plans/` (frozen history).
- [ ] `grep -rn "docs/plans/\|docs/design/vscode-modern-ui" --exclude-dir={node_modules,.git,out} .`
      returns hits only inside `docs/v1/` (frozen history) — the four live ones in F53 are repaired.
- [ ] `bun run lint` reports the same file count as the baseline (**461**), proving `biome.json`'s
      `design/` exclusion still matches after the move.
- [ ] `git status --porcelain` is empty after commit 3, proving `.gitignore`'s generated-artboard
      pattern still matches.
- [ ] `docs/ARCHITECTURE.md` contains no sentence deferring to `SPEC.md` for a live fact — the four
      at `:7`, `:27-28`, `:196`, `:203` are gone (F52). Any surviving `docs/v1/SPEC.md` mention is a
      pointer to the v1 record, not a claim of authority.
- [ ] `docs/ARCHITECTURE.md` has sections covering: adapter contract, per-engine facts, the §5.1
      mapping table, process model, storage, caching, stack, invariants, testing, UI architecture,
      repository layout — and a Related-documents block naming `docs/PACKAGING.md`, `docs/PERF.md`,
      `docs/design/`, `README.md`, `AGENTS.md` and `docs/v1/`.
- [ ] `docs/ARCHITECTURE.md`'s testing section names four test directories and states D66's rule.
- [ ] `docs/v1/README.md` exists and states: this is the v1 record, `docs/ARCHITECTURE.md` is
      authoritative for current behavior, paths inside are as-of-that-phase, §10's table is still
      appended to.
- [ ] `SPEC.md`'s front-matter status line no longer reads *"P0–P31 implemented"* and no longer
      points at `docs/plans/`.
- [ ] `AGENTS.md:199` no longer calls `docs/v1/SPEC.md` the full spec; `AGENTS.md:11`'s §10 pointer
      is unchanged and still resolves.
- [ ] `README.md` no longer says *"deliberately no unit tests"*, no longer lists credential
      encryption or unit tests under "Not in v1", no longer calls S3 read-only, and its script table
      lists `typecheck:unit` and `test:unit`.
- [ ] `tests/unit/` holds seven spec files plus `support/window.ts` and `tsconfig.json`;
      `tests/db/` holds `preconnect.spec.ts` plus the eleven Testcontainers specs, `fixtures/`,
      `support/` and `tsconfig.json`.
- [ ] `bun test tests/unit` → **63 pass, 0 fail**, in under 3 s.
- [ ] `bun test tests/db/preconnect.spec.ts` → **12 pass, 0 fail**.
- [ ] `bun run lint`, `bun run typecheck` (five projects) and `bunx electron-vite build` green after
      **every** commit, including the pure-documentation ones.
- [ ] SPEC.md §10's P45 row is written in a final `docs(spec):` commit and covers D57, D60, D62/D63
      and D66.

---

## 8. What is left, and who owns it

**Handed forward:**

1. **`SPEC.md` §8's 604 lines remain the only prose description of the app's UI behavior, and they
   are now in the archive.** D63 moves the structure and leaves the detail. That is the right call
   today — the detail's real source of truth is the code and `tests/ui/`'s 26 specs — but it means a
   future session looking for "what exactly does the filter history menu do" finds a v1-era answer in
   a document marked historical. **Owner: nobody yet, deliberately.** If a later phase finds itself
   repeatedly re-deriving a §8 answer, that is the signal to promote that specific subsection into
   `docs/ARCHITECTURE.md` — one subsection at a time, on evidence, not the whole 604 lines on
   principle.

2. **`README.md`'s engine capability table, Features list and keyboard section were not re-derived
   from the tree.** D67 bounded this phase to four verified-false claims. The rest of README reads
   plausible and nothing in F59's investigation contradicted it, but *"nothing contradicted it"* is
   not *"it was checked."* If a README accuracy review is wanted, it is its own phase.

3. **`PERF.md`'s macOS rows and `PACKAGING.md` §4's human checklist are still unrun**, exactly as
   P12/P15 left them. Untouched by D64. **Owner: whoever next has macOS hardware or a green CI run.**

4. **P43 iteration 2's commit 3 (the Kafka EOF/high-watermark clamp) has still never been executed
   anywhere.** P43 iteration 3 §8 item 4 and P44 §8 item 7 both own it; nothing in this phase changes
   that. **Owner: whoever next runs CI or the macOS/Colima box.**

5. **`tests/db/`'s remaining Docker-free spec is one file.** D66 leaves `preconnect.spec.ts` there on
   a stated rule. If a later phase ever adds a second non-container, non-instant Bun spec, that is
   the point to reconsider whether the rule wants a third directory — not before.

**Not handed forward, because it is now settled:** the `tests/db/` ↔ `tests/unit/` split P44 §8
item 4 raised. After commit 12 the split is: `tests/unit/` = needs nothing, ~1 s; `tests/db/` = needs
a real external resource; `tests/electron-db/` = needs Electron's ABI; `tests/ui/` = needs a browser.
The rule is written down in `docs/ARCHITECTURE.md`, not only in a plan file.
