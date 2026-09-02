# P21 — Docs refresh

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md:36`, P21 row): *"Sweep the repository's
> own documentation — `docs/ARCHITECTURE.md`, `docs/PERF.md`, `docs/PACKAGING.md`, `README.md`,
> `AGENTS.md`'s "Known open items", and any other doc `docs/v1/README.md`'s own discipline points at
> — for drift against the tree as it actually stands once P1-P20 have landed, and fix whatever's gone
> stale: outdated architecture descriptions, superseded perf numbers, packaging steps P10 changed
> underneath them, version and dependency mentions P19 just superseded, and so on."* Why: *"The
> chapter's closing phase, on the same footing as v1's own closing `docs/v1/plans/P14-docs.md`:
> documentation drift compounds with every phase that lands without a dedicated pass to catch it, so
> this chapter gets the same discipline v1 applied at the close of its own list."*
>
> **The headline, in one line: the drift is not evenly spread — `docs/PACKAGING.md` is the worst
> file in the repository by a wide margin (fourteen findings, including a paragraph that contradicts
> another paragraph in the same file), `README.md` is the most *misleading* one (it describes a
> feature set five phases old and states two engine facts that are flatly wrong), and
> `docs/PERF.md`'s numbers turn out to be **fine** — the one thing this phase was told to suspect
> hardest is the one thing that holds up.**
>
> A fresh `bun run build` on this branch reproduces §2.11's Vite 8/Rolldown figures to within
> +620 bytes on the main chunk and **byte-for-byte** on both lazy chunks (F46), so no recorded
> bundle number in `docs/PERF.md` is stale. What *is* stale in that file is path prose that P57/P58f
> renaming never reached (`cd shell`, twice) and a methodology claim P7 invalidated (the status-bar
> readout and `cmd/g1measure` are described as "the same instrument"; since P7 one reports
> `ri_phys_footprint` and the other sums RSS).
>
> The other structural finding: `docs/v1/README.md` — the doc this SPEC row explicitly sends the
> sweep to — misdirects a reader to the wrong ledger. It says `docs/v1/SPEC.md` §10's phasing table
> "keeps accruing rows as new phases land, v1 or post-v1"; that table ends at P58, and every v1.1
> row lives in `docs/v1.1/SPEC.md`, exactly as `docs/v1.1/README.md:18-19` already says (F48).

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Every phase P1-P20 has landed on `claude/feature-v1-1-p5-onwards-2isfzt`. The tree at the time of
writing is at `62c7e84` (`fix(scripts): stop clobbering a caller's GOBIN, and fix the dead PATH
hint`), the last of P12 round 2's fixes. What that means for this sweep:

| Landed | What it put into the tree that a doc might not know about |
|---|---|
| P5 | renderer page-store pruning; the fourth, unbudgeted renderer cache tier |
| P6 | Vapor mode evaluated and **declined** — VDOM stays |
| P7 | darwin memory switched from RSS to `ri_phys_footprint`; CPU normalized (0…100) |
| P8 | multi-window: *Window → New Window* ⇧⌘N, `windows` table, `tabs.window_key`, `EmitFocused` |
| P9 | `appearance.rowColoring` setting; string-typed cells lost their distinct colour |
| P10 | the `.dmg` is what ships; `bun run package` runs `darwin:package:dmg` |
| P11 | FlatBuffers data plane; `scripts/generate-wire.sh` |
| P12 (×2) | code-review fixes across both halves; `docs/PERF.md`'s Green Tea caveat widened |
| P13 | Format button (⇧⌥F), `sql-formatter` as a lazy chunk |
| P14 | credential reveal behind `internal/localauth` (`LAContext`), 5-minute grace |
| P15 | fake-data generator, `@faker-js/faker` as a lazy chunk |
| P16 | `scripts/db-compat.sh`, `testsupport.ImageFor` override, `MIN_SERVER_VERSION` in the dialog |
| P17 | settings staged in a draft, applied on Save; Revert to Defaults |
| P18 | `SchemaService`, `connection_ddl`, `connections.auto_explain`, EXPLAIN + auto-explain, the DDL-driven SQL language service, `advanced.expensiveQueryRows` |
| P19 | Go 1.27.0, Wails `v3.0.0-beta.16`, TypeScript 6, Vite 8/Rolldown; three staged action bumps |
| P20 | `scripts/install-deps.sh` + `scripts/wails-dev-setup.sh` → `scripts/setup.sh` + `scripts/lib.sh`; the Docker cross-compile path deleted; `test:e2e-real` script added |

### 0.2 Scope — the doc set

The five files the SPEC row names, plus everything `docs/v1/README.md`'s own discipline and
`README.md`'s own Documentation section point at:

| File | Lines | Findings | Why in scope |
|---|---|---|---|
| `docs/PACKAGING.md` | 365 | F1-F14 | SPEC row; P20's own §5 D13 named it as a deferred handoff |
| `docs/ARCHITECTURE.md` | 1097 | F15-F25 | SPEC row; both READMEs call it authoritative for today |
| `README.md` | 268 | F26-F36 | SPEC row |
| `AGENTS.md` | 310 | F37-F40 | SPEC row ("Known open items", plus what else proved stale) |
| `docs/PERF.md` | 1025 | F41-F47 | SPEC row |
| `docs/v1/README.md` | 18 | F48 | the SPEC row's *"any other doc `docs/v1/README.md`'s own discipline points at"* — and the discipline statement itself has drifted |
| `scripts/demo-dbs/README.md` | — | F49 | linked from `README.md:253`'s Documentation list |
| `docs/design/kira-design-system/README.md` | — | F50 | linked from `README.md:250`'s Documentation list |
| `apps/kira-studio/README.md` | 24 | F51 | the app directory's own entry doc; P20 fixed its step *order* and left the rest |

### 0.3 Not in this phase

- **`.github/workflows/*.yml`.** This session's GitHub credential lacks the `workflow` OAuth scope
  (`AGENTS.md:107-110`). F11/F12 are fixed by correcting `docs/PACKAGING.md`'s *prose about* those
  files, never by editing them. Nothing in this phase moves a staged workflow live.
- **`docs/v1.1/SPEC.md` and `docs/v1/SPEC.md`.** Both READMEs freeze them: *"kept exactly as
  originally written once a phase starts. Neither is retro-edited to track a later change."* P21
  does not add a row, correct a row, or annotate one. (`docs/v1/README.md` itself is *not* frozen —
  it is the folder's explainer, not the record — which is why F48 is fixable.)
- **`docs/v1/plans/*` and `docs/v1.1/plans/*`.** Same freeze, stated by both READMEs. A path named
  in a plan is true as of that phase. The one exception is
  `docs/v1.1/plans/p19-pending-ci-workflow/README.md`, which P20 already updated and which is
  correct as it stands — read it, do not touch it.
- **Any code, test, script, or Taskfile change.** If this sweep turns up a real product bug, record
  it in §7 and stop. A doc that describes the tree wrongly is fixed by changing the doc.
- **`NOTICES.md`.** Read and verified: it is scoped to bundled *icon assets*, and the eight
  Simple Icons marks plus the hand-drawn SQS/S3 glyphs it names match `simple-icons@16.29.0` and
  the current engine set. `sql-formatter` and `@faker-js/faker` are code dependencies, not icon
  assets, and are correctly absent. Nothing to do.

### 0.4 Ground rules

1. **The tree outranks every doc** (`docs/ARCHITECTURE.md:10-11`, `docs/v1/README.md:11-13`,
   `docs/v1.1/README.md:14-16`). Every finding below cites a file:line on both sides. If a citation
   does not reproduce, the finding is wrong — re-derive it, do not "fix" the doc anyway.
2. **A recorded measurement is a dated record, not a claim about today.** `docs/PERF.md` §2.1-§2.11
   are historical stanzas. Correct a *path*, a *file name*, or a *claim about the present tense*
   inside one; never change a number, a date, or a verdict. New numbers go in a new stanza (D4) —
   the same convention §2.6 → §2.7 → §2.8 already established in that file.
3. **Prune while you are in there** (`AGENTS.md:91-103`). A sentence whose subject no longer exists
   is deleted, not annotated with "(removed)".
4. **No new sections in `AGENTS.md`.** It is process-and-environment only; an app fact goes to
   `docs/ARCHITECTURE.md` (`AGENTS.md:3-5`, `:91-96`).
5. **Say plainly what was checked and did not fire.** §5.3 lists the claims this sweep verified as
   *correct*; the implementer should not "improve" them.

---

## 1. Findings — `docs/PACKAGING.md`

This is the worst file in the repository. P20's own plan named it as a deliberate handoff:

> `docs/v1.1/plans/P20-scripts-dev-package-overhaul.md:774` (D13): *"**Everything else in
> `README.md`, `docs/PACKAGING.md` and `docs/ARCHITECTURE.md` is left to P21.**"*

### F1 — §1 states a Go version P19 superseded, and the same file contradicts it 70 lines later

- **Doc says** (`:17`): *"Requires macOS arm64, Bun, Go (`go.mod`: 1.25.0), and Xcode command-line
  tools."*
- **Tree shows** `go.mod:3` — `go 1.27.0`.
- **Same file, `:87`**: *"The floor is 14 rather than 13 because **Go 1.27** builds its own objects
  for macOS 13 minimum"* — already correct. §1 is the stale half.
- **Fix**: `1.25.0` → `1.27.0`.

### F2 — §1 states a `wails3` pin P19 superseded

- **Doc says** (`:18-19`): *"the `wails3` CLI at the version `go.mod` pins (`v3.0.0-beta.15`)"*.
- **Tree shows** `go.mod` — `github.com/wailsapp/wails/v3 v3.0.0-beta.16`;
  `package.json:63` — `"@wailsio/runtime": "3.0.0-beta.16"`; `docs/ARCHITECTURE.md:25` already says
  `v3.0.0-beta.16`.
- **Fix**: `v3.0.0-beta.15` → `v3.0.0-beta.16`. Consider dropping the parenthetical entirely —
  `scripts/lib.sh`'s `pinned_wails_version()` reads it from `go.mod`, so hardcoding it here is what
  went stale in the first place. Preferred: *"at the version `go.mod` pins"*, no number.

### F3 — §1 names two scripts P20 deleted (the named, deferred gap)

- **Doc says** (`:25-31`): *"`bun run package` and `bun run dev` both run `bun run setup` first
  (wired as `prepackage`/`predev`), which is **`scripts/install-deps.sh`** (`bun install` +
  `go mod download`) followed by **`scripts/wails-dev-setup.sh`** (the pinned `wails3` CLI +
  generated bindings). Both scripts are idempotent … `sh scripts/wails-dev-setup.sh` installs the
  pinned wails3 and generates the Wails bindings …"*
- **Doc also says** (`:65`): *"`predev` runs `wails-dev-setup.sh` first."*
- **Tree shows** `ls scripts/` — `db-compat.sh  demo-dbs/  generate-wire.sh  lib.sh  setup.sh
  sign-bundle.sh  verify-packaging.sh`. Neither named file exists. `package.json:11-13` wires
  `setup` → `sh scripts/setup.sh`, with `predev`/`prepackage` both `bun run setup`.
- **Fix**: rewrite `:25-31` around the real shape, which is worth stating precisely because it is
  more than a rename (`scripts/setup.sh:1-8`, `:99-127`; `scripts/lib.sh:1-9`):
  - one entry point, `scripts/setup.sh`, sourcing `scripts/lib.sh` (the shared `ROOT_DIR`,
    `require_cmd`, `ensure_gopath_on_path`, `sha256_file`, `pinned_wails_version`, `go_directive`);
  - it does `bun install`, `go mod download`, then installs the pinned `wails3` **with `GOTOOLCHAIN`
    pinned to `go.mod`'s own `go` directive** — never `auto`, which resolves the toolchain from
    Wails' floor and silently degrades the bindings generator's type-checker (`setup.sh:64-71`,
    `:88-92`);
  - it reinstalls when the pinned version changed **or** when the installed binary's own build
    toolchain is older than the directive (`setup.sh:73-80`);
  - bindings regeneration is delegated to `wails3 task common:generate:bindings`, gated on an
    identity stamp at `apps/kira-studio/.task/bindings.stamp` **and** on the bindings directory's own
    presence (`setup.sh:113-127`).
  - `:65` becomes *"`predev` runs `bun run setup` first"*.

### F4 — the binding-generation command is missing `-clean=true` (and `-f`)

- **Doc says** (`:29`): *"generates the Wails bindings (`wails3 generate bindings -b -i -ts -names`
  — gitignored …)"*.
- **Tree shows** `apps/kira-studio/build/Taskfile.yml`'s `generate:bindings`:
  `wails3 generate bindings -f '{{.BUILD_FLAGS}}' -clean=true{{if eq .OBFUSCATED "true"}} -obfuscated{{end}} -b -names -ts -i`.
- **Also**: `setup.sh` no longer types a flag list at all — it calls the task, deliberately (P20 D8,
  `setup.sh:99-104`), so the task is the single authority.
- **Fix**: quote the task's real command, and point at `wails3 task common:generate:bindings` (or
  `bun run setup`) as the thing a human should actually run. Same correction applies to
  `docs/ARCHITECTURE.md:697` (F19) and `AGENTS.md:275` (F39) — three copies of one drifting string,
  which is itself the argument for citing the task rather than the flags.

### F5 — §2's task table and §5 still document a Docker cross-compile path P20 deleted

- **Doc says** (`:120`): *"| `darwin:build` → `build:docker` | off macOS only: cross-compiles in the
  `wails-cross` Docker image. Never exercised in this repo (§5) |"*
- **Doc says** (`:246-248`): *"**`build:docker`** (`darwin:build`'s automatic off-macOS branch)
  needs Docker plus a locally built `wails-cross` image (`wails3 task setup:docker`). Not
  attempted …"*
- **Doc says** (`:184`): *"| `wails3 task darwin:package` | **not run** — needs macOS (or the
  untested Docker cross-compile path, §5) |"*
- **Tree shows** `apps/kira-studio/build/darwin/Taskfile.yml:6-16` — no `build:docker` task exists;
  `build` now carries a precondition instead:
  ```yaml
  preconditions:
    - sh: '[ "$(uname -s)" = Darwin ]'
      msg: "Kira Studio builds on macOS only — see docs/PACKAGING.md."
  ```
  Deleted in `a52c52e` (`fix(build)!: drop the unreachable Docker cross-compile path`) and
  `c047866` (`chore(build): drop unreachable non-Darwin branches from darwin/Taskfile.yml`), per
  P20 D5.
- **Fix**: delete the `:120` table row; rewrite `:246-248` to say the off-macOS door is *closed by
  a precondition that names the constraint*, not left unverified; drop the `:184` parenthetical.
  §5's framing ("On Linux that leaves three doors") becomes two.

### F6 — `codesign:skip` does not exist

- **Doc says** (`:121`): *"then `codesign:adhoc` on macOS (`codesign:skip` elsewhere)"*.
- **Doc says** (`:249-250`): *"`create:app:bundle` falls back to `codesign:skip` (a printed
  warning), and `sign-bundle.sh` exits 1 on purpose."*
- **Tree shows** `grep -rn "codesign:skip"` over the whole repo returns `docs/PACKAGING.md` and
  nothing else. `apps/kira-studio/build/darwin/Taskfile.yml`'s `create:app:bundle` ends
  unconditionally with `- task: codesign:adhoc`, and the task is only reachable behind F5's Darwin
  precondition.
- **Fix**: both places. There is no fallback; off macOS you never reach the task.

### F7 — the PlistBuddy step no longer skips silently, it hard-fails

- **Doc says** (`:106-107`): *"or one where the PlistBuddy step silently skipped (**its guard is
  `-x /usr/libexec/PlistBuddy`, absent off macOS**), fails the check rather than shipping quietly."*
- **Tree shows** `apps/kira-studio/build/darwin/Taskfile.yml`'s `create:app:bundle`:
  ```
  else
    echo "create:app:bundle: no PlistBuddy — this is a broken macOS environment (build/package
    already precondition on Darwin), not a supported one" >&2
    exit 1
  ```
- **Fix**: A5 is still the right assertion and the sentence should keep it; the "silently skipped"
  branch it hedges against no longer exists — the bundle step fails first.

### F8 — §6 says every §4 item is unrun; §4 itself records five as passed under P10

- **Doc says** (`:285-286`): *"**Every item in §4 is unrun** — no macOS hardware has been available.
  Whoever runs a build on real hardware should fill in those rows."*
- **Same file, §4** (`:196-236`): items **1, 2, 3, 10** are marked **pass (P10)** on macOS 26.5.2
  arm64 (item 10 records real figures: *"42 MB for the `.app`, 16 MB for the compressed `.dmg`"*),
  and item **11** is **partial**. §4's own preamble (`:197-199`) says so explicitly.
- **Fix**: replace the §6 bullet with what is actually outstanding — items 4-9, plus item 11's
  drag-onto-Applications gesture and how the Finder window looks.

### F9 — S5/S2's descriptions of `verify-packaging.sh` are both wrong

- **Doc says** (`:352`): *"**S2** — no `autoUpdater`/`electron-updater` reference anywhere in
  `src/`."*
- **Tree shows** `scripts/verify-packaging.sh:40` — *"`--- S2: no updater code in apps/ or
  packages/`"*. There has been no `src/` since P3's restructure and P58f's `src/engine/` deletion.
- **Doc says** (`:353-354`): *"**S5** — `package.json`'s `package` script still runs `wails3 task
  darwin:package`, so this check fails loudly if the packaging entry point is swapped …"*
- **Tree shows** `scripts/verify-packaging.sh:52-55`:
  ```sh
  # `darwin:package` alone stops at the .app and would leave the release with nothing to upload —
  *"wails3 task darwin:package:dmg"*) ;;
  *) fail "package script changed" "package.json's 'package' script no longer runs 'wails3 task
     darwin:package:dmg' …"
  ```
  and `package.json:31` — `wails3 task darwin:package:dmg && sh ../../scripts/sign-bundle.sh`. P10
  moved this and the doc's S5 line did not follow.
- **Fix**: both bullets, verbatim from the script.

### F10 — §3's verify-packaging row names the wrong check set

- **Doc says** (`:183`): *"**pass** — static checks S1/S2/S5 ran; A1/A3/N2 correctly reported
  *skipped*, since no `apps/kira-studio/bin/Kira Studio.app` exists here"*.
- **Tree shows** — running it in this environment right now prints:
  ```
  verify-packaging: note — skipped A1/A3/A5/N2 — "apps/kira-studio/bin/Kira Studio.app" not present
  verify-packaging: note — skipped A4/N3 — "apps/kira-studio/bin/Kira Studio.dmg" not present
  verify-packaging: all checks passed
  ```
  A5 (the version assertion §2 already documents at `:104-107`) and the P10 `.dmg` pair A4/N3 are
  both missing from the row.
- **Fix**: quote the two skip lines above. This is a §3 "results from this environment" table, so
  updating it with a run made *in this environment* is exactly what it is for — not a rewrite of
  history.

### F11 — §7's closing line contradicts §7's own opening line

- **Doc says** (`:310-312`, §7's first paragraph): *"**Status:** applied.
  `.github/workflows/{ci,release}.yml` now hold the content described below — the staging directory
  … is gone."*
- **Doc says** (`:363-365`, §7's last paragraph): *"**Whether the release workflow has actually
  run:** *no — and the workflow file in `.github/workflows/` is still the pre-P57 Electron one (§6),
  so the first tag pushed must not be pushed before those files are applied.*"*
- **Tree shows** `.github/workflows/ci.yml` and `release.yml` are the Wails/Go workflows §7's table
  describes — `runs-on: macos-15`, `bun run package`, the `hdiutil attach` DMG smoke assertions,
  `kira-studio-macos-arm64.dmg`. There is no Electron workflow anywhere.
- **Fix**: keep *"no, the release workflow has never run"*; delete the pre-P57-Electron half
  outright. It is a leftover from before the staged P58 workflows were applied.

### F12 — §7 does not mention the two workflow bumps that *are* still pending

- **Doc says**: nothing. §7 describes the live workflows as if they were final.
- **Tree shows** two staged, finished-but-unapplied sets, both blocked on the same missing
  `workflow` OAuth scope (`AGENTS.md:107-116`):
  - `docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml` — P16's `workflow_dispatch`-only
    compatibility-suite workflow;
  - `docs/v1.1/plans/p19-pending-ci-workflow/{ci,release}.yml` — P19's `actions/{checkout,setup-go,
    upload-artifact}` `@v4/@v5` → `@v7` bump, **plus** P20's rerouting of all three inline
    binding-generation blocks through `sh scripts/setup.sh` and the corrected `ci.yml` step name.
    Confirmed by `diff .github/workflows/ci.yml docs/v1.1/plans/p19-pending-ci-workflow/ci.yml`:
    five `uses:` bumps and two inline blocks replaced.
- **Fix**: add a short §7 note pointing at `AGENTS.md`'s Known open items and each staged README.
  Do not duplicate the `git mv` instructions — each staged README already carries them.

### F13 — §7's `checks` row describes a binding step that is about to change

- **Doc says** (`:318`): *"`bun install --frozen-lockfile`, install the `wails3` version pinned in
  `go.mod`, generate bindings, then `lint`, `typecheck`, `build`, `test:go`, `verify:packaging`"*.
- **Tree shows** this is accurate *for the live file* (`.github/workflows/ci.yml:30-36`) and will
  become `sh scripts/setup.sh` the moment F12's staged file is applied.
- **Fix**: keep the row (it describes what runs today) and let F12's note carry the pending change.
  Recorded so the implementer does not "fix" a correct row.

### F14 — nothing in this file mentions `scripts/db-compat.sh`

- **Doc says**: §7 is titled *"CI, releases, and auto-update"* and enumerates every job.
- **Tree shows** `package.json:34` — `"test:compat": "sh scripts/db-compat.sh"`, an on-demand
  sixteen-pair min/max matrix (`scripts/db-compat.sh:1-14`) deliberately outside `bun run test:go`
  and outside `ci.yml`.
- **Fix**: one sentence in §7 saying it exists, that it is deliberately not in CI (P16's SPEC row's
  own words), and that its `workflow_dispatch` workflow is staged, not live. The suite's *design*
  belongs in `docs/ARCHITECTURE.md`'s Testing section (F23), not here — this is just the CI-shaped
  half.

---

## 2. Findings — `docs/ARCHITECTURE.md`

This file is in far better shape than `docs/PACKAGING.md` — P11, P14, P15, P18 and P19 all updated
it as they landed. The findings split into **one genuinely wrong paragraph** (F15), **five stale
counts** (F16-F20), and **three completeness gaps** (F21-F23) where a v1.1 capability has no
structural home in a file whose whole job is to be the current-state reference.

### F15 — the PostgreSQL/MariaDB/MySQL intro is pre-P58 prose, contradicted 14 lines below it

- **Doc says** (`:154-158`): *"MariaDB and MySQL share one driver (**`mariadb`**, a genuine dual
  client) and one core (**`engine/adapters/mysql-family/`**) — `mariadb/` and `mysql/` each hold
  only their own profile (server label, **`applyEngineOptions`**) and re-export everything else."*
- **Tree shows** three separate errors:
  1. `go.mod` — the driver is `github.com/go-sql-driver/mysql v1.10.0`. The npm `mariadb@3.5.4` in
     `package.json:61` is a *test fixture* dependency, read only by
     `packages/db-fixtures/support/mariadb.ts:3`.
  2. `engine/adapters/mysql-family/` has not existed since P58b; the core is
     `apps/kira-studio/internal/adapters/mysqlfamily/` (12 files, including `profile.go`).
  3. `mariadb/` and `mysql/` each hold `adapter.go`, `caps.go`, `client.go` — not "only their own
     profile"; the `Profile` type lives in `mysqlfamily/profile.go`, and the method is Go-cased
     `ApplyEngineOptions`.
- **The same file already says all of this correctly** at `:170-187`: *"`apps/kira-studio/internal/
  adapters/mysqlfamily/`, `github.com/go-sql-driver/mysql` … `mysqlfamily/` holds one `Adapter`
  implementation, and `mariadb/`/`mysql/` each hold only their own `Profile` (server label,
  `ApplyEngineOptions`)."*
- **Fix**: delete the stale sentence from `:155-158`. The paragraph below it is the correct,
  complete statement; the intro should keep only the design facts that survived (keyset-on-PK
  pagination, `pg_cancel_backend`/`KILL QUERY` on a side connection).

### F16 — "thirteen bound services" is fourteen, and the list omits P18's `SchemaService`

- **Doc says** (`:810-815`): *"`apps/kira-studio/main.go` builds the `application.New` options and
  registers **thirteen** bound services under `apps/kira-studio/internal/bridge/` — `AppService`,
  `SettingsService`, `LayoutService`, `TabsService`, `WindowsService` …, `ConnectionsService`,
  `TreeService`, `EngineService`, `OpsService`, `FiltersService`, `FilesService`, `QueriesService`,
  `LifecycleService`."*
- **Tree shows** `apps/kira-studio/main.go:201-214` — fourteen `application.NewService` calls, with
  `bridge.SchemaService` at `:213` (between `QueriesService` and `LifecycleService`);
  `apps/kira-studio/internal/bridge/schema.go` is its file.
- **Fix**: `thirteen` → `fourteen`, and insert `SchemaService` in the list with a parenthetical
  naming what it is: P18's per-connection DDL document store, backing `connection_ddl` and the
  DDL-driven language service the same section already describes at `:622-628`.

### F17 — the `tests/ui/` count is exactly half of reality

- **Doc says** (`:1063-1064`): *"**`tests/ui/`** … is its replacement for everything that ported:
  **36 tests across 18 spec files** driving the real built `apps/kira-studio/frontend/dist` bundle"*.
- **Tree shows** `npx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui
  --list` → **`Total: 72 tests in 25 files`**.
- **Fix**: `72 tests across 25 spec files`. Re-run the `--list` command at implementation time and
  use whatever it prints, not this number, in case a later commit moves it.

### F18 — the `tests/e2e-real/` count is wrong, and P8's own spec is missing from the list

- **Doc says** (`:1076-1077`): *"**`tests/e2e-real/`** is the full-stack *wiring* tier, and it is
  deliberately small — **three specs (sqlite, postgres, mariadb), five tests.**"*
- **Tree shows** `--project=e2e-real --list` → **`Total: 6 tests in 4 files`**:
  `mariadb-real.spec.ts` (2), `multiwindow-real.spec.ts` (1), `postgres-real.spec.ts` (2),
  `sqlite-real.spec.ts` (1). The fourth is P8's — *"two windows, one backend: each keeps only its
  own tabs (P8 F6)"*.
- **Fix**: `four specs (sqlite, postgres, mariadb, multiwindow), six tests`, and add one clause
  saying what the multiwindow spec proves. It is the only full-stack proof of P8's
  `tabs.window_key` isolation, and the section that describes that isolation
  (`:855-860`) currently names no test at all.

### F19 — the bindings command is missing `-clean=true`

- **Doc says** (`:696-697`): *"the Wails-generated TypeScript bindings … (git-ignored, regenerated
  by `wails3 generate bindings -b -i -ts -names`)"*.
- **Tree shows** the `generate:bindings` task's real command — see F4.
- **Fix**: as F4. Prefer *"regenerated by `wails3 task common:generate:bindings`, which
  `scripts/setup.sh` calls"* over a flag list that has now drifted in three files at once.

### F20 — `packages/db-fixtures/`'s inventory is a file short, and the fixture glob is wrong

- **Doc says** (`:1008-1011`): *"`fixtures/*.sql` (read by
  `apps/kira-studio/internal/adapters/testsupport/{postgres,mariadb,mysql,sqlite,clickhouse}.go` by
  absolute path) and **five** `support/*.ts` modules (`docker`, `postgres`, `mariadb`, `sqlite`,
  `kafka`)"*.
- **Tree shows** `ls packages/db-fixtures/support/` → **six** files: `connectionConfig.ts`,
  `docker.ts`, `kafka.ts`, `mariadb.ts`, `postgres.ts`, `sqlite.ts`. And
  `ls packages/db-fixtures/fixtures/` includes `0005_kafka_seed.ts`, which is not a `.sql` file.
- **Fix**: `six`, add `connectionConfig`, and widen the fixture description to
  `fixtures/*.{sql,ts}` (or name the Kafka seed's exception).

### F21 — P17's whole behavioural model has no home in this file

- **Doc says**: nothing. `grep -nE "apply-on-save|applyOnSave|Revert to Defaults"` over
  `docs/ARCHITECTURE.md` returns zero hits; `P17` returns zero hits.
- **Tree shows** a real structural rule, and one this file's "UI architecture" section exists to
  record — from `docs/v1.1/plans/P17-settings-apply-on-save.md`'s own headline: *"every control in
  the Settings dialog calls `patchSettings()` from its own `@change` handler, and `patchSettings()`
  writes to the app-wide store, the SQLite `settings` table and an app-wide `Emit` broadcast in one
  go"* — P17 replaced that with a local draft applied only on Save, plus a Revert to Defaults action
  writing `model.DefaultSettings()` (`apps/kira-studio/internal/storage/model/settings.go:36-52`).
- **Fix**: one short "UI architecture" paragraph, in this file's own idiom: settings are staged in a
  per-dialog draft and committed as one patch on Save; `SettingsDialog.vue` is still the only caller
  of `patchSettings` in the tree; Revert to Defaults writes the same default set the Go side
  declares, so the two cannot disagree. Note the app-wide side of the line is unchanged — settings
  remain **app-wide** in P8's per-window/app-wide split (`:836-838`), so a Save broadcasts to every
  window.

### F22 — P9's row-coloring setting is undocumented, and the setting list is where it belongs

- **Doc says**: nothing. `grep -nE "row coloring|rowColoring"` → zero hits in
  `docs/ARCHITECTURE.md`.
- **Tree shows** `apps/kira-studio/internal/storage/model/settings.go:5-11` —
  `AppearanceSettings{FontFamily, FontSize, RowDensity, WordWrap, RowColoring}`, default
  `RowColoring: true` (`:38-44`); `apps/kira-studio/tests/ui/row-coloring.spec.ts` is its guard.
  P9's own headline states the mechanism precisely: *"the grid's 'row coloring' is not a background,
  a stripe, a parity rule or a hash — it is a per-**column** text colour derived from the column's
  `typeClass` … there is exactly one function that decides it"* (`DataGrid.vue`'s
  `colorForColumn`).
- **Fix**: one sentence in "UI architecture" — the colour is per *column type class*, not per row;
  one function decides it; `appearance.rowColoring` turns it off wholesale; string-typed cells no
  longer get a distinct colour at all. This is exactly the kind of "so a future session does not
  reinvent it" fact the section's own preamble (`:542-544`) asks for.

### F23 — the Testing section does not know P16's compatibility suite exists

- **Doc says** (`:1022`): *"Per-engine scenario coverage … now lives in
  `apps/kira-studio/internal/adapters/*/*_test.go`, one Go test file per engine, run by
  `bun run test:go`. **Local-only for now — no CI wiring in v1.**"*
- **Tree shows** `scripts/db-compat.sh` (`package.json:34`, `bun run test:compat`): the same
  conformance packages run against each kind's oldest and newest supported server image via a
  `testsupport.ImageFor` env-var override, sixteen (kind, min|max) pairs, every pair run even when an
  earlier one fails (`db-compat.sh:6-14`). Plus a user-visible half:
  `packages/shared/domain/connection.ts:36`'s `MIN_SERVER_VERSION` map, rendered per kind by
  `apps/kira-studio/frontend/src/project/ConnectionDialog.vue:9,192`.
- **Fix**: extend that paragraph — the same coverage also runs on demand against the version
  extremes; name the script, the override mechanism, and the connection-dialog note. Keep
  "no CI wiring" but make it accurate: the `workflow_dispatch` workflow is written and staged, not
  live (cross-reference `AGENTS.md`'s Known open items rather than restating the OAuth reason).

### F24 — the `tests/ui/` coverage sentence stops at pre-v1.1 subjects

- **Doc says** (`:1069-1074`): *"It covers what the old tier covered minus the full-stack anchors:
  panel toggles, settings persistence, connection CRUD, tree expansion and caching, opening the same
  table twice with independent state, pagination, projection, search toolbar modes, stop button, cell
  editor, document expand/collapse, PK/FK navigation, context menus, copy/paste, the sticky ancestor
  band's geometry, the checkbox tree filter, plus the budgets/perf/leaks specs."*
- **Tree shows** eight of the 25 spec files are v1.1 subjects and appear nowhere in that list:
  `console-format.spec.ts` (P13), `console-explain.spec.ts` + `sql-schema.spec.ts` +
  `autocomplete.spec.ts` (P18), `fake-data.spec.ts` (P15), `credential-reveal.spec.ts` (P14),
  `row-coloring.spec.ts` (P9), `settings-apply-on-save.spec.ts` (P17).
- **Fix**: extend the enumeration. This is the sentence a future session reads to decide "is this
  behaviour covered?", and right now it answers "no" for every v1.1 feature.

### F25 — checked, and **not** a finding: the Stack table

Recorded so the implementer does not touch it. Every row at `:23-39` was re-verified against the
tree this session:

- `Wails v3 (v3.0.0-beta.16)` = `go.mod`. ✅
- `TypeScript 6 (tsc/vue-tsc)` = `package.json:78` `"typescript": "6.0.3"`, `vue-tsc 3.3.11`; the
  `@typescript/native-preview` `tsgo` note matches `package.json:62` and the three `typecheck:*`
  scripts. ✅
- Vite 8/Rolldown, *"Two dynamically-imported chunks as of P15 … ~37 KB gzip … ~155 KB gzip"* —
  a fresh `bun run build` prints `sqlFormatterEntry` at 37.41 KB gzip and `fakerEntry` at
  155.46 KB gzip. ✅ (F46)
- Zod's *"remaining TypeScript-side job is connection-dialog input"* — verified: the only
  `safeParse` call sites in `apps/kira-studio/frontend/src` + `packages/shared` are
  `ConnectionDialog.vue:270` and `:293`. ✅
- Storage's schema block (`:452-470`) — verified against migrations `0001_init.sql`,
  `0002_p8_windows.sql`, `0003_p18_connection_ddl.sql`, `0004_p18_auto_explain.sql`. ✅
- Metrics needles (`:879-880`) — `internal/metrics/ticker.go:20-21` is
  `AnchorNeedles = ["Kira Studio"]`, `HelperNeedles = ["com.apple.WebKit", "webkitgtk", "bwrap"]`. ✅
- The renderer-security posture (`:929-932`) — `internal/shell/security.go:17-25`. ✅
- Playwright parallelism (`:1092-1097`) — `apps/kira-studio/playwright.config.ts:27-52`. ✅

---

## 3. Findings — `README.md`

The product-facing file, and the one where drift costs a reader most. Two findings (F27, F28) are
not "stale" but **wrong**: they state engine behaviour the opposite of what ships.

### F26 — the Status section says v1 is in development

- **Doc says** (`:10-11`): *"**Beta — v1 is in development.**"*
- **Tree shows** `docs/v1.1/README.md:3` — *"v1 shipped (`docs/v1/SPEC.md`, closed out through
  P58). This folder holds the next chapter"*, and `docs/v1.1/SPEC.md` carries P1-P21, all landed.
- **Fix**: *"Beta — v1 shipped; v1.1 is in development"* (or the equivalent). Keep the
  expect-bugs/breaking-changes warning and the unsigned-build consequence, both still true.

### F27 — the SQLite footnote states a capability flag that is the opposite of the code

- **Doc says** (`:45-48`, footnote ³): *"SQLite has no server, no auth, and no cancel — **`caps.cancel`
  is `false`, the app's first honest one**: `node:sqlite` has no `sqlite3_interrupt` and its whole
  API is synchronous, so a running statement blocks the event loop and an abort could never be
  delivered while one runs."*
- **Tree shows** `apps/kira-studio/internal/adapters/sqlite/caps.go` — `Cancel: true`, with the
  file's own comment: *"modernc.org/sqlite has a real sqlite3_interrupt, reached by cancelling the
  adapter-owned per-op driver context (adapter.go's runOnConn), so this is the Go port's first honest
  `true` instead."* `docs/ARCHITECTURE.md:113` and `:191-202` both already say so.
- **Fix**: rewrite the footnote. Keep the two facts that survived (no server, no auth; a SQLite
  connection points at a file, not a host/port) and replace the cancel half with the real one —
  cancel *is* supported, via a per-op dedicated `*sql.Conn`, which is a different mechanism from the
  side-connection cancel Postgres/MariaDB/MySQL use.

### F28 — the MySQL footnote names the wrong driver and offers an option that does not exist

- **Doc says** (`:39-43`, footnote ²): *"Uses the same **`mariadb` driver package** as the MariaDB
  adapter — a genuine dual client, no second dependency. `sslmode=require` is the documented default
  for MySQL 8's `caching_sha2_password` handshake: a plaintext connection needs either TLS or
  **`allowPublicKeyRetrieval=true` (a per-connection option)** the first time a given user
  authenticates, or the server refuses to send its RSA key."*
- **Tree shows**: same driver error as F15 (`go-sql-driver/mysql` via `mysqlfamily`), and
  `docs/ARCHITECTURE.md:185-187` records the option's removal as an accepted capability loss:
  *"`allowPublicKeyRetrieval` has **no equivalent** — the driver requests the server's RSA public key
  unconditionally over plaintext when `caching_sha2_password` needs one and TLS is off, with no
  option to refuse that request."*
- **Fix**: name `go-sql-driver/mysql` and the shared `mysqlfamily` core (the "one driver, two kinds,
  no second dependency" point still holds — it is just a different driver); replace the
  `allowPublicKeyRetrieval` clause with what the Go driver actually does. Also worth checking
  whether the *other* documented Node-era capability loss belongs here —
  `docs/ARCHITECTURE.md:183-185`'s *"the query console's 'N row(s) affected' status text is gone"* —
  since the README's engine table implies a full write story for MySQL.

### F29 — README claims prefetch; ARCHITECTURE says prefetch was removed

- **Doc says** (`:90-91`): *"**Caching** — three tiers: persisted metadata, a byte-budgeted in-memory
  result-page LRU, and counts; **with prefetch** and a hit-rate readout"*.
- **Tree shows** `docs/ARCHITECTURE.md:520-523`: *"**No speculative fetching.** A page is loaded only
  in direct response to a user action … There is no background prefetch of the next page and no
  automatic count-on-open; **both existed at one point and were removed by user request** as unwanted
  background work rather than kept as an opt-out setting."* No `prefetch` leaf exists in
  `internal/storage/model/settings.go`'s `DataSettings` (`:13-15` — `DefaultPageSize` only).
- **Fix**: drop "with prefetch".

### F30 — the Settings bullet is wrong on four counts

- **Doc says** (`:95-96`): *"**Settings** — Appearance (font family/size, row density), Data
  (default page size, **prefetch, count-on-open**), Cache (L2 byte budget, hit rate, clear caches),
  Advanced (op-log retention)."*
- **Tree shows** `apps/kira-studio/internal/storage/model/settings.go:5-33`:
  - `AppearanceSettings` = `FontFamily, FontSize, RowDensity, **WordWrap**, **RowColoring**` — the
    last two undocumented (word wrap from v1's P42, row coloring from v1.1's P9);
  - `DataSettings` = `DefaultPageSize` **only** — `prefetch` and `count-on-open` do not exist (F29);
  - `AdvancedSettings` = `OpLogRetentionDays`, **`ExpensiveQueryRows`** (P18's estimated-rows-read
    threshold, default 100 000, bounds 1 000…1 000 000 000 at `:105`) — undocumented;
  - and nothing anywhere records P17's apply-on-save model or the Revert to Defaults action.
- **Fix**: rewrite the bullet from the Go struct, and add the P17 behaviour (staged, applied on Save,
  Revert to Defaults) as a short clause — it is the single most user-visible settings change in this
  chapter.

### F31 — the Features list carries no v1.1 capability at all

- **Doc says** (`:63-97`): fourteen feature bullets, every one describing a v1 capability.
- **Tree shows** five user-facing v1.1 capabilities with zero README presence
  (`grep -nE "Format button|faker|auto-explain|Show password|New Window" README.md` → nothing):
  | Capability | Phase | Where it lives |
  |---|---|---|
  | Format button in every console (⇧⌥F) | P13 | `views/console/sqlFormatterEntry.ts`, `menutemplate.go:82` |
  | Generate data… (fake-data generator) | P15 | `views/grid/fakeData/fakerEntry.ts` |
  | SQL language service (completions/diagnostics/hovers) from pasted DDL, plus Explain and per-connection auto-explain | P18 | `views/console/{sqlLanguageService,sqlDiagnostics,sqlHover,explain,planParsers/*}.ts`, `connections.auto_explain`, `connection_ddl` |
  | Confirm-before-reveal for a saved password (Touch ID / system password, 5-minute grace, in-app fallback) | P14 | `internal/localauth`, `docs/ARCHITECTURE.md:438-449` |
  | Multiple windows (*Window → New Window*, ⇧⌘N) | P8 | `internal/shell/menutemplate.go:100`, the `windows` table |
- **Fix**: one bullet each, in the existing voice — what it does, not how. Depth belongs in
  `docs/ARCHITECTURE.md`, which already covers four of the five (F21/F22 add the missing two).

### F32 — the keyboard list is missing three shortcuts

- **Doc says** (`:92-94`): *"`⌘,` settings, `⌘B` project panel, `⌘J` operations panel, `⇧⌘P`
  palette, `⌘F` find, `F5` refresh, `⌘↩` run statement, `⇧⌘↩` run all, `⌃Tab`/`⌃⇧Tab` switch tabs,
  `⌘W` close tab, `⇧⌘W` close window."*
- **Tree shows** `apps/kira-studio/internal/shell/accel.go:39-55` — the same eleven **plus**:
  - `"app.newConnection": {Key: "N", CmdOrCtrl: true}` → **⌘N New Connection** (predates v1.1, never documented)
  - `"view.format": {Key: "F", Shift: true, Alt: true}` → **⇧⌥F Format** (P13)
  - `"window.new": {Key: "N", CmdOrCtrl: true, Shift: true}` → **⇧⌘N New Window** (P8)
- **Fix**: add all three. `menutemplate.go:45`, `:82`, `:100` are the menu items that surface them.

### F33 — "Not in v1" still lists a feature P8 shipped

- **Doc says** (`:256-258`): *"Light mode; Windows/Linux; DDL editing; export to CSV/JSON;
  connection folders; split editor groups; **multiple windows**; SSH tunneling (planned for v2);
  code signing/notarization."*
- **Tree shows** `internal/shell/menutemplate.go:100` (*New Window*, ⇧⌘N), the `windows` table
  (`0002_p8_windows.sql`), `tabs.window_key … ON DELETE CASCADE`,
  `apps/kira-studio/tests/e2e-real/multiwindow-real.spec.ts`, and `docs/ARCHITECTURE.md:827-873`'s
  whole multi-window subsection.
- **Fix**: remove "multiple windows" from the list. Verified as still-absent and correctly listed:
  no light-mode toggle, no Windows/Linux target, no DDL editing, no CSV/JSON export
  (`grep -rln "exportCsv\|Export to CSV" apps/kira-studio/frontend/src` → nothing), no connection
  folders, no split editor groups, no SSH tunneling, no signing/notarization. The section heading
  itself ("Not in v1") may want to become "Not in v1.1" or "Not shipped" now that v1 is closed —
  implementer's call, but say which was chosen in the commit message.

### F34 — the e2e-real description is wrong twice over

- **Doc says** (`:187-190`): *"**`apps/kira-studio/tests/e2e-real/`** — **two specs** against a real
  `-tags server` Go binary, deliberately launched through plain Node rather than `bunx` … **rather
  than through a `package.json` script** — see `AGENTS.md`'s Docker section for why."*
- **Tree shows** four specs / six tests (F18), and `package.json:29` —
  `"test:e2e-real": "bun run build && node node_modules/.bin/playwright test
  --config=apps/kira-studio/playwright.config.ts --project=e2e-real"`, added by P20 (its D12).
  The *plain-Node* reason still holds — the script itself invokes `node node_modules/.bin/playwright`,
  never `bunx` — but "rather than through a `package.json` script" is now false.
- **Fix**: four specs; and the script exists and preserves the plain-Node invocation, which is the
  point `AGENTS.md:148-153` actually makes.

### F35 — the script table omits three scripts

- **Doc says** (`:145-161`): a fifteen-row table.
- **Tree shows** `package.json:11-35` also has:
  - `test:e2e-real` (P20) — F34;
  - `test:compat` → `sh scripts/db-compat.sh` (P16);
  - `generate:wire` → `sh scripts/generate-wire.sh` (P11's FlatBuffers schema codegen).
- **Fix**: three rows. `generate:wire` should say it regenerates the Go and TypeScript FlatBuffers
  code from `wire.fbs` and that it is not part of a normal build.

### F36 — the `bun run dev` row and `docs/PACKAGING.md:65` each name half the truth

- **README says** (`:148`): *"the Wails task itself drives the frontend build via
  `common:build:frontend`"*.
- **`docs/PACKAGING.md` says** (`:63-65`): *"the Wails task's own dev-mode config drives the frontend
  build via `common:dev:frontend`"*.
- **Tree shows** `apps/kira-studio/build/config.yml`'s `dev_mode.executes` runs **both**:
  ```yaml
  - cmd: wails3 build DEV=true       # → darwin:build → deps: common:build:frontend
    type: blocking
  - cmd: wails3 task common:dev:frontend   # → the Vite dev server, `bun run dev --port … --strictPort`
    type: background
  - cmd: wails3 task run
    type: primary
  ```
- **Fix**: make both files say the same thing — a blocking `common:build:frontend` for the embedded
  bundle, then `common:dev:frontend` running Vite in the background for HMR. Low severity, but two
  standing docs contradicting each other on the dev loop is exactly what this phase is for.

---

## 4. Findings — `AGENTS.md`

`AGENTS.md` came out of this sweep in the best shape of the five. Its Docker, ClickHouse, SQLite and
Wails/Go sections were re-read line by line against the tree and are accurate; see §5.3.

### F37 — the p19 Known-open-item understates what is staged

- **Doc says** (`:114-116`): *"`docs/v1.1/plans/p19-pending-ci-workflow/{ci,release}.yml` — **P19's
  GitHub Actions major-version bump** (`actions/checkout`, `actions/setup-go`,
  `actions/upload-artifact` to `@v7`) applied to the two live workflows."*
- **Tree shows** the staged files carry more than that, and their own README already says so
  (`docs/v1.1/plans/p19-pending-ci-workflow/README.md:9-16`, *"**P20 … has since revised these
  beyond P19's three `uses:` bumps.**"*). Confirmed by diff: five `uses:` bumps **plus** all three
  inline "install pinned wails3, then generate bindings" blocks replaced with `sh scripts/setup.sh`,
  **plus** `ci.yml`'s step name corrected (it cited `src/renderer/bridge/*.ts`, gone since P3).
- **Fix**: extend that bullet to name P20's revision. The item stays open — both staged sets are
  genuinely unapplied, verified against the live files.

### F38 — the conformance-suite exemption names four adapter packages; nine have suites

- **Doc says** (`:80-87`): *"**The adapter conformance suites are exempt from that bar** …
  `apps/kira-studio/internal/adapters/{postgres,mysqlfamily,sqlite,clickhouse}/*_test.go` are the
  sole successors to the deleted `packages/db-fixtures/*.spec.ts` files, and nothing else exercises
  a Go adapter capability by capability."*
- **Tree shows** nine adapter packages carry `*_test.go`: `clickhouse` (2), `kafka` (3), `mongo` (4),
  `mysqlfamily` (2), `postgres` (1), `redis` (4), `s3` (2), `sqlite` (3), `sqs` (1). The rule the
  bullet states ("keep per-capability coverage there even where it reads like a CRUD round-trip") is
  right; the enumeration is a snapshot of which `.spec.ts` files were deleted last, not of which
  suites the rule governs.
- **Fix**: widen to `apps/kira-studio/internal/adapters/*/*_test.go`. Keep the exemption's reasoning
  verbatim — only the path glob is wrong.

### F39 — the "exact flags" line is not the exact flags

- **Doc says** (`:273-276`): *"Regenerate bindings with the exact flags
  `apps/kira-studio/build/Taskfile.yml`'s `generate:bindings` task uses — **`wails3 generate bindings
  -clean=true -b -names -ts -i`** (run from `apps/kira-studio/`) — never a shorter hand-typed
  version"*.
- **Tree shows** the task's command also passes `-f '{{.BUILD_FLAGS}}'` and, conditionally,
  `-obfuscated`.
- **Fix**: this bullet's own advice is the fix — it already says *"prefer `wails3 task
  common:generate:bindings` (or `scripts/setup.sh`, which calls it) so the flags are never retyped at
  all."* Lead with that and stop reproducing a flag list that has now drifted in three files (F4,
  F19, F39). Keep the `-names` load-bearing paragraph (`:279-287`) verbatim — it is correct, and it
  is the most expensive thing in the file to rediscover.

### F40 — checked, and **not** a finding

- The Docker section (`:118-163`): `mirror.gcr.io` retag rule, the Bun/testcontainers hang, the
  deleted `scripts/run-ipc-backend.sh` and `scripts/capture-*.ts` — all still accurate; those files
  are absent from the tree and the section describes them as deleted.
- The `tests/ipc/` section (`:165-195`): six adapter directories under
  `apps/kira-studio/tests/ipc/` (clickhouse, kafka, mariadb, mysql, redis, sqs) plus `support/`,
  exactly as described; `KIRA_IPC_FIXTURES=write` is still the regeneration path.
- The ClickHouse (`:197-215`) and SQLite (`:217-230`) sections: both explicitly historical and
  labelled as such.
- The Wails/Go section (`:247-310`): the `GOTOOLCHAIN` pin, the GTK4/WebKitGTK requirement, the
  `-tags server` substitute for GUI-driven proofs — all match `scripts/setup.sh` and
  `apps/kira-studio/playwright.config.ts`. `scripts/setup.sh` does now do the install
  automatically, exactly as `:260` claims.
- **Do not touch any of it.**

---

## 5. Findings — `docs/PERF.md`

The phase brief asked hardest about this file. The answer is that **its numbers are current** and
its *prose about how to reproduce them* is not.

### F41 — §3's packaging command names a directory deleted at P3 and a task P10 replaced

- **Doc says** (`:917-919`): *"**The bundle these procedures run against.** `bun run package`
  (**`cd shell && wails3 task darwin:package`**, then `scripts/sign-bundle.sh`; see
  `docs/PACKAGING.md`) produces **`apps/kira-studio/bin/Kira Studio.app`**."*
- **Tree shows** `package.json:31` —
  `cd apps/kira-studio && wails3 task darwin:package:dmg && sh ../../scripts/sign-bundle.sh`. There
  is no `shell/` directory. P10 made the `.dmg` the shipped artifact; the run produces **both**
  `Kira Studio.app` and `Kira Studio.dmg` (`docs/PACKAGING.md:36-40`).
- **Fix**: `cd apps/kira-studio && wails3 task darwin:package:dmg`, and name both artifacts. The
  next sentence's claim (*"The only measurement-relevant path inside the bundle is
  `Contents/MacOS/Kira Studio` itself"*) is still true and stays.

### F42 — §3's g1measure command names the same deleted directory

- **Doc says** (`:951-953`): *"`cd shell && go run ./cmd/g1measure`"*.
- **Tree shows** `apps/kira-studio/cmd/g1measure/` exists; `shell/` does not.
- **Fix**: `cd apps/kira-studio && go run ./cmd/g1measure`. (Both §2.3 and §2.4 already spell the
  package path correctly as `apps/kira-studio/cmd/g1measure` — only §3's shell command drifted.)

### F43 — §3 calls the status-bar readout and `g1measure` "the same instrument"; since P7 they are not

- **Doc says** (`:945-958`): step 2 — *"Read the memory figure from the app's own status bar …
  **That readout *is* the replacement for `app.getAppMetrics()`**: `internal/metrics`' `Sampler` +
  `Ticker` sum RSS and CPU across the app's own process set"*; step 3 — *"Optional second opinion,
  **using the same instrument** §2.3/§2.4 measured gate G1 with: `… go run ./cmd/g1measure` …, or a
  `ps -o rss=` sum over the same set"*.
- **Tree shows** they measure two different things on darwin, and P7 is why:
  - `apps/kira-studio/internal/metrics/probe_darwin.go:21-29`, `:100-107` — one
    `proc_pid_rusage(pid, RUSAGE_INFO_V2, …)` per pid per tick, reading **`ri_phys_footprint`**;
    `sampler.go:4` and `:30` state it outright: *"is RSS everywhere except darwin, where it is
    phys_footprint"*.
  - `apps/kira-studio/cmd/g1measure/main.go:1`, `:87-88` — *"sums **RSS** across the app's whole
    process set"*, via gopsutil's `mi.RSS`. It was never updated by P7.
  - `docs/ARCHITECTURE.md:882-888` explains the difference and why footprint is the right one
    (shared dyld/WebKit pages counted once per process by RSS, once total by footprint).
  - And the **350 MB target** step 1 names comes from §2.2, an RSS-summed Electron scenario.
- **Fix**: this is the one substantive PERF correction. Rewrite step 2/3 to say plainly: the status
  bar reports **phys_footprint** on darwin (Activity Monitor's "Memory" column), `cmd/g1measure` and
  `ps -o rss=` report **RSS** ("Real Memory"), the two are not interchangeable, and the 350 MB budget
  was set against an RSS sum — so a footprint reading is *not* a like-for-like comparison against it.
  State which one a future run should record, and record both if in doubt. **Do not change the
  budget** (it is SPEC-derived); do not "fix" `g1measure` (code is out of scope, §0.3) — hand it to
  §7 instead.

### F44 — §3's platform floor disagrees with every other doc

- **Doc says** (`:912`): *"Run these once on **macOS 13+** arm64 and record the results here."*
- **Tree shows** `README.md:12` and `:100` (macOS 14+), `docs/ARCHITECTURE.md:25` (macOS 14+),
  `docs/PACKAGING.md:83-89` (`LSMinimumSystemVersion 14.0.0`, hand-narrowed from Wails' 12.0.0), and
  `apps/kira-studio/build/darwin/Taskfile.yml`'s `MACOSX_DEPLOYMENT_TARGET: "14.0"` /
  `CGO_CFLAGS: -mmacosx-version-min=14.0`.
- **Fix**: `macOS 14+`.

### F45 — §2.1's body still cites the tier P12 round 2 corrected in its heading

- **Doc says** (`:59-62`): *"**Console keystroke → completion popup.** Docker/Colima is available on
  this environment …, so the Postgres-backed **`tests/e2e/budgets.spec.ts`** suite runs in full
  rather than self-skipping; the row above is a real measurement, not a carry-over."*
- **Tree shows** `tests/e2e/` was deleted at P57 (`docs/ARCHITECTURE.md:1051`); the tier is
  `apps/kira-studio/tests/ui/budgets.spec.ts`. P12 round 2 (`86a57e0`) fixed §2.1's *heading* for
  exactly this reason and did not reach this paragraph.
- **Fix**: `tests/ui/budgets.spec.ts`. Two other `tests/e2e/` mentions in §2.1 — `:93`
  (`tests/e2e/data-view.spec.ts`, inside the P47 record) and `:120-121` (the P57 M5 port
  description) — are **historical statements about what was ported** and must be left alone.

### F46 — the bundle numbers were re-measured this session and are current

Not a correction; a confirmation, and the mechanically-checkable half of this phase's verification.
`bun run build` on `62c7e84` (Vite 8.2.2 / Rolldown, 631 modules):

| Chunk | §2.11 recorded (P19) | This session | Delta |
|---|---|---|---|
| `index-*.js` | 1,115,370 B raw / 351.14 KB gzip | **1,115,990 B raw / 351.31 KB gzip** | +620 B (+0.06%) / +0.17 KB |
| `sqlFormatterEntry-*.js` | 130,746 B raw / 37.41 KB gzip | **130,746 B / 37.41 KB** | **identical** |
| `fakerEntry-*.js` | 415,801 B raw / 155.46 KB gzip | **415,801 B / 155.46 KB** | **identical** |
| `index-*.css` | not recorded | 120,067 B raw / 21.77 KB gzip | — |

Both dynamic-import splits survive (P19 §7.2's acceptance bar); nothing collapsed into the main
chunk. The +620 B on the main chunk is P12 rounds 1-2's own frontend fixes and is noise at this
scale.

- **Fix**: **do not edit §2.11.** Add a short **§2.12** stanza recording this re-measurement at the
  chapter's close — the same convention §2.6 → §2.7 → §2.8 already uses in this file. Say plainly
  that §2.11's figures are confirmed still current, that the two lazy chunks are byte-identical, and
  that the Green Tea caveat (§2.11's second half) is **unchanged and still applies** to §2.3-§2.8 —
  no Go-side wall-clock number was re-measured by this phase either.

### F47 — the file's own currency preamble predates §2.9-§2.11

- **Doc says** (`:11-17`): a three-sentence currency statement covering §2.1's capture dates and
  §3's unrun manual procedures, and nothing else.
- **Tree shows** the file has since grown §2.9 (P5's renderer heap), §2.10 (P12 r1's bundle
  re-measure), §2.11 (P19's bundle + the Green Tea caveat) — and, after F46, §2.12.
- **Fix**: extend the preamble by one sentence naming what is *not* current and where the caveat
  lives, so a reader learns it before reading a Go-side wall-clock table rather than 880 lines
  later. Do not restate the caveat; point at it.

---

## 6. Findings — the linked docs

### F48 — `docs/v1/README.md` sends a reader to the wrong phasing ledger

- **Doc says** (`docs/v1/README.md:15-18`): *"The one part of this folder still being added to is
  `SPEC.md` §10, the phasing table: **every phase, v1 or post-v1, gets a row** recording what changed
  and why, and that ledger **keeps accruing rows as new phases land** — it just does not otherwise
  change what earlier phases already said about themselves."*
- **Tree shows** `docs/v1/SPEC.md` §10's table ends at **P58** (`| **P58 DB adapters in Go, Node
  engine sidecar removed** |` is the last row). None of v1.1's P1-P21 has a row there. The live
  ledger is `docs/v1.1/SPEC.md`, and `docs/v1.1/README.md:18-19` already says so: *"`SPEC.md`'s
  phasing table keeps accruing rows as new phases land, the same way `docs/v1/SPEC.md`'s did"* —
  past tense, deliberately.
- **Why this one matters most**: it is the doc the P21 SPEC row explicitly points the sweep at, and
  a session following it would go add v1.1 rows to a frozen v1 record.
- **Fix**: rewrite `:15-18` to say the v1 ledger is **closed at P58** and that post-v1 phases accrue
  in `docs/v1.1/SPEC.md`, cross-referencing `docs/v1.1/README.md`. Everything else in the file (the
  history-not-documentation framing, the never-retro-edited rule, the tree-outranks-both precedence)
  is correct and stays. **This edits `docs/v1/README.md`, never `docs/v1/SPEC.md`** — the README is
  the folder's explainer, not the frozen record (§0.3).

### F49 — `scripts/demo-dbs/README.md` says the app's SQLite adapter is `node:sqlite`

- **Doc says** (`:10-12`): *"The tenth engine, SQLite, needs no container at all (P35 D36) …
  `sqlite/seed.ts` builds one directly with `bun`, **using the same `node:sqlite` module the app's
  own adapter reads it with**."*
- **Tree shows** the app's adapter is `modernc.org/sqlite` (`go.mod`;
  `apps/kira-studio/internal/adapters/sqlite/`), pure-Go and cgo-free, since P58b M6.3. The seed
  script may well still use `node:sqlite` — that part is fine — but "the same module the app's own
  adapter reads it with" is not.
- **Fix**: keep the seeding description; drop or correct the "same module" clause. Verify what
  `scripts/demo-dbs/sqlite/seed.ts` actually imports before rewording.

### F50 — `docs/design/kira-design-system/README.md` names a path deleted at P3

- **Doc says** (`:12-13`): *"Static mockups, not a clickable prototype. **Nothing under
  `src/renderer/` is touched** by anything in this folder."*
- **Tree shows** no `src/` at the repo root; the frontend is
  `apps/kira-studio/frontend/src`.
- **Fix**: one path. Do not restructure this file — it is a design artefact's README, and its
  `build.mjs` / `parts/` description is accurate.

### F51 — `apps/kira-studio/README.md` re-teaches the step P20 collapsed

- **Doc says** (`:14-22`): a four-step fresh-clone recipe —
  `cd apps/kira-studio` → `wails3 task common:generate:bindings` → `cd ../..` → `bun run build` →
  `cd apps/kira-studio` → `go run .`
- **Tree shows** P20 fixed this block's *order* (D13/F21) and left its shape. The repo now has one
  entry point that does the first step correctly, including the `GOTOOLCHAIN` pin and the identity
  stamp: `bun run setup` (`scripts/setup.sh:99-127`). Running `wails3 task common:generate:bindings`
  by hand works but skips the CLI-version/toolchain check that P20's F5-F7 existed to add.
- **Fix**: lead with `bun run setup` from the repo root, then `bun run build`, then
  `cd apps/kira-studio && go run .`. Keep the *reason* sentence (`:12-14`) — that `frontend/src`
  imports the generated bindings, so they must exist before Vite runs — which is what makes the order
  load-bearing. Also confirm `blank/` and `cmd/g1measure/` still exist before keeping `:23-24`
  (they do).

---

## 7. Decisions

| | Decision | Why |
|---|---|---|
| **D1** | **Every fix is in place, in the doc's own voice and structure.** No new top-level sections anywhere except `docs/PERF.md` §2.12 (D4). | Five files, ~50 findings; a restructure would make the diff unreviewable and would fight `AGENTS.md:91-103`'s prune-don't-append rule. |
| **D2** | **`docs/v1.1/SPEC.md` and `docs/v1/SPEC.md` are not touched. `docs/v1/README.md` is.** | Both READMEs freeze the SPECs and the plans. A README is the folder's explainer, and F48 is a statement about *where the live ledger is* — precisely the thing a README owes a reader. |
| **D3** | **No `.github/workflows/*` edit.** F11/F12 are fixed by correcting prose about those files. | No `workflow` OAuth scope (`AGENTS.md:107-110`); the staged sets and their `git mv` instructions already exist and are correct. |
| **D4** | **`docs/PERF.md` §2.11 is not edited. A new §2.12 records the P21 re-measurement.** | A measurement stanza is a dated record (§0.4 rule 2). §2.6 → §2.7 → §2.8 established this exact pattern in this exact file. |
| **D5** | **New capability prose goes where the file's own structure already puts that kind of fact** — P17 and P9 into `docs/ARCHITECTURE.md`'s "UI architecture", P16 into its "Testing", never into a new "v1.1 features" section. | That file is organised by subsystem so a future session can look something up (`:3-8`). A phase-shaped section would defeat it, and would age the same way `docs/PACKAGING.md`'s did. |
| **D6** | **`README.md` gets one line per feature, no rationale.** Depth lives in `docs/ARCHITECTURE.md`. | It is the product README; `README.md:231-233` already delegates. |
| **D7** | **The three linked READMEs (F49-F51) get one-line corrections only.** | They are in scope because `README.md`'s Documentation section links them, not because they are drifting broadly. Each has exactly one wrong claim. |
| **D8** | **Cite the Taskfile task, not the binding flag list, in all three places it appears** (F4/F19/F39). | The same string has now gone stale in `docs/PACKAGING.md`, `docs/ARCHITECTURE.md` and `AGENTS.md` simultaneously. One authority (`common:generate:bindings`) cannot drift three ways. `AGENTS.md` already recommends this; the other two should follow it. |
| **D9** | **Where two standing docs disagree, make them agree by pointing one at the other** rather than duplicating the fact. F36 (dev loop), F29 (prefetch), F27/F28/F15 (driver + cancel facts) all become: `docs/ARCHITECTURE.md` states it, `README.md` summarises and links. | It is how the drift happened. Two copies of a fact drift; one copy plus a link does not. |
| **D10** | **Do not fix `cmd/g1measure` to report footprint.** Record the RSS-vs-footprint divergence in `docs/PERF.md` (F43) and hand the code question to §10. | §0.3: this phase changes docs. Changing the gate-G1 instrument would also invalidate §2.3/§2.4's comparability, which is a real decision needing its own phase. |

---

## 8. Implementation order

One commit per file, in dependency order — the files that *others cite* are corrected first, so a
later commit can link a corrected statement instead of restating it. Run `bun run lint` after each
(Biome checks Markdown formatting in this repo); nothing else is affected by a docs change.

### C1 — `docs(v1): point the v1 record's discipline at the live v1.1 ledger`
**File:** `docs/v1/README.md`. **Findings:** F48.
First because both other READMEs and `docs/ARCHITECTURE.md:11-14` cite this file's discipline.

### C2 — `docs(arch): correct the mysql-family driver prose, the service and test counts, and record P9/P16/P17`
**File:** `docs/ARCHITECTURE.md`. **Findings:** F15-F24.
Order within the commit: F15 (the wrong paragraph) → F16-F20 (counts and paths) → F21-F24 (the three
additions plus the `tests/ui/` enumeration). Re-run both `playwright … --list` commands immediately
before writing F17/F18's numbers.

### C3 — `docs(packaging): rewrite §1 around scripts/setup.sh, and drop the deleted Docker and codesign:skip paths`
**File:** `docs/PACKAGING.md`. **Findings:** F1-F14.
The largest commit. Suggested internal order: §1 (F1-F4) → §2 (F5 row, F6, F7) → §3 (F10, F5's
parenthetical) → §4/§6 (F8) → §5 (F5, F6) → §7 (F9, F11, F12, F13, F14).

### C4 — `docs(perf): re-point §3 at apps/kira-studio, separate footprint from RSS, and record the P21 bundle re-measure`
**File:** `docs/PERF.md`. **Findings:** F41-F47.
Do F46's `bun run build` first and write §2.12 from that run's own output, not from this plan's
table — if the numbers moved between now and implementation, the fresh ones are right.

### C5 — `docs(readme): correct the SQLite and MySQL engine facts, and document what v1.1 shipped`
**File:** `README.md`. **Findings:** F26-F36.
Last of the five, so every fact it summarises has already been corrected at its source. F36 also
touches `docs/PACKAGING.md:63-65` — land that half here, in the same commit, so the two files change
together.

### C6 — `docs(agents): widen the conformance-suite glob and note P20's revision of the staged workflows`
**File:** `AGENTS.md`. **Findings:** F37-F39. Nothing else in the file is touched (F40).

### C7 — `docs: fix the three stale paths in the linked READMEs`
**Files:** `scripts/demo-dbs/README.md`, `docs/design/kira-design-system/README.md`,
`apps/kira-studio/README.md`. **Findings:** F49-F51.
Small enough to be one commit; keep it separate from C5 so the product README's diff stays readable.

---

## 9. Verification

### 9.1 Mechanical — must be run, output pasted into the commit or the final report

| Check | Command | Expected |
|---|---|---|
| Bundle figures for §2.12 | `bun run build` | four chunks; `index-*.js` ≈ 1,115,990 B / 351.31 KB gzip; both lazy chunks unchanged from §2.11 |
| `tests/ui` count (F17) | `npx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui --list` | `Total: 72 tests in 25 files` |
| `e2e-real` count (F18) | `… --project=e2e-real --list` | `Total: 6 tests in 4 files` |
| verify-packaging skip lines (F10) | `sh scripts/verify-packaging.sh` | the two `skipped A1/A3/A5/N2` / `skipped A4/N3` notes, then `all checks passed` |
| No deleted script survives in prose | `grep -rn "install-deps.sh\|wails-dev-setup.sh\|codesign:skip\|build:docker" README.md AGENTS.md docs/ARCHITECTURE.md docs/PACKAGING.md docs/PERF.md` | zero hits (`docs/v1*/plans/**` is frozen history and will still match — exclude it) |
| No `cd shell` / `shell/` path survives | `grep -rn "cd shell\|\`shell/" README.md AGENTS.md docs/*.md` | zero hits |
| No superseded version survives | `grep -rn "1\.25\.0\|beta\.15" docs/PACKAGING.md docs/ARCHITECTURE.md README.md` | zero hits |
| Formatting | `bun run lint` | clean |

`bun run typecheck` and the test suites are unaffected by a docs-only change and need not be run,
but `bun run lint` must be — Biome formats Markdown in this repo and the pre-commit hook runs it.

### 9.2 Manual — the actual work

For each corrected file, re-read it end to end against the tree, not against this plan. The specific
re-reads worth doing deliberately:

1. **`docs/PACKAGING.md` §1-§2 against `scripts/setup.sh`, `scripts/lib.sh`,
   `apps/kira-studio/Taskfile.yml`, `apps/kira-studio/build/Taskfile.yml` and
   `apps/kira-studio/build/darwin/Taskfile.yml`, open side by side.** Every task name, every script
   name, every flag. This file drifted because nobody did that after P10 or P20.
2. **`docs/PACKAGING.md` §7 against `.github/workflows/{ci,release}.yml`** and against both staged
   directories. Confirm the two Known-open items are still genuinely open before writing F12's note
   (`diff` each staged file against its live counterpart).
3. **`README.md`'s engine table and its four footnotes against each adapter's `caps.go`.** F27 and
   F28 were both found this way; a fifth footnote may not survive the same treatment.
4. **`README.md`'s Settings and Features bullets against
   `apps/kira-studio/internal/storage/model/settings.go` and the 25 `tests/ui/*.spec.ts` filenames.**
   The spec filenames are a good proxy for "what shipped that a user can see".
5. **`docs/ARCHITECTURE.md`'s Testing section against `ls apps/kira-studio/tests/*/` and
   `packages/db-fixtures/`.** Counts and inventories are what went stale here, three times.
6. **`docs/PERF.md` §3 against `internal/metrics/probe_darwin.go` and `cmd/g1measure/main.go`.**
   F43 is the one finding in that file a reader could act on and get a wrong number from.

### 9.3 Checked this session and **correct** — do not "fix" these

Recorded so the implementer does not spend the phase re-deriving them, and does not change something
that is right:

- `docs/ARCHITECTURE.md`'s Stack table, storage schema block, metrics needles, renderer-security
  table, Zod claim, and Playwright parallelism — all verified (F25).
- `docs/PERF.md`'s §2.11 bundle figures — re-measured, current (F46). Its Green Tea caveat, widened
  by P12 round 2, is accurate and complete.
- `AGENTS.md`'s Docker, `tests/ipc/`, ClickHouse, SQLite and Wails/Go sections (F40).
- `README.md`'s Requirements (Go 1.27+, the `go.mod`-read `wails3` pin) — P20 already fixed this;
  `README.md:101` is correct.
- `README.md`'s Install section and top-level layout block — the `.dmg`/`.app` paths, `bun run
  setup`, and the `apps/`/`packages/`/`docs/`/`scripts/` tree all match.
- `docs/PACKAGING.md` §2's "Where the version comes from" table — verified against
  `apps/kira-studio/Taskfile.yml`'s `APP_VERSION`/`VERSION_VAR`, `create:app:bundle`'s PlistBuddy
  step, and `verify-packaging.sh`'s A5.
- `NOTICES.md` — in scope, read, nothing to change (§0.3).

---

## 10. Acceptance checklist

- [ ] `docs/v1/README.md` names `docs/v1.1/SPEC.md` as the live phasing ledger and describes v1's own
      §10 as closed at P58.
- [ ] `docs/ARCHITECTURE.md` no longer claims a `mariadb` npm driver or an `engine/adapters/`
      path anywhere; says **fourteen** bound services and lists `SchemaService`; carries the real
      `tests/ui` and `tests/e2e-real` counts; and has a home for P9, P16 and P17.
- [ ] `docs/PACKAGING.md` §1 describes `scripts/setup.sh` + `scripts/lib.sh` and nothing else; no
      `install-deps.sh`, `wails-dev-setup.sh`, `codesign:skip` or `build:docker` survives anywhere in
      it; Go 1.27.0 and `v3.0.0-beta.16` (or no hardcoded pin at all).
- [ ] `docs/PACKAGING.md` §6 no longer says every §4 item is unrun; §7's S2/S5 quote the real
      `verify-packaging.sh` checks; §7's closing paragraph no longer claims an Electron workflow is
      live; §7 mentions both staged workflow sets and `bun run test:compat`.
- [ ] `docs/PERF.md` has a §2.12 recording this session's `bun run build`, §2.11 is byte-for-byte
      unchanged, no `cd shell` survives, §3's macOS floor is 14, and §3 distinguishes phys_footprint
      from RSS explicitly.
- [ ] `README.md`'s SQLite footnote says cancel is supported; its MySQL footnote names
      `go-sql-driver/mysql` and does not offer `allowPublicKeyRetrieval`; "prefetch" is gone; the
      Settings bullet matches `model/settings.go`; the five v1.1 capabilities each have a bullet;
      ⌘N / ⇧⌘N / ⇧⌥F are listed; "multiple windows" is out of the not-shipped list; the script table
      gains `test:e2e-real`, `test:compat` and `generate:wire`.
- [ ] `AGENTS.md`'s conformance glob covers every adapter package; the p19 Known-open item names
      P20's revision; both Known-open items are still genuinely open (verified by diff); nothing else
      in the file changed.
- [ ] The three linked READMEs each have their one stale claim corrected.
- [ ] Every §9.1 mechanical check run and green; every §9.2 side-by-side re-read done.
- [ ] `bun run lint` clean; nothing under `.github/`, `docs/v1/SPEC.md`, `docs/v1.1/SPEC.md`, or any
      `plans/` file except this one is touched.
- [ ] No code, script, Taskfile or test file changed by this phase.

---

## 11. Open questions and observations, handed forward

1. **`cmd/g1measure` still sums RSS while the shipped readout reports phys_footprint (D10, F43).**
   Two instruments, one described in `docs/PERF.md` as interchangeable with the other. P21 documents
   the divergence; closing it means either teaching `g1measure` the darwin footprint probe
   `internal/metrics` already has, or retiring it in favour of the status-bar figure — and either
   choice changes how §2.3/§2.4's gate-G1 numbers should be read. Needs a phase, not a docs edit.
2. **`docs/PERF.md` §3's manual procedures have never been run** — items 4-9 of
   `docs/PACKAGING.md` §4 likewise. P10 ran five of eleven packaging items on real hardware; the
   perf procedures got none. Every packaged cold-start and packaged-RSS number in this repository is
   still absent, and no amount of doc work changes that. It needs a human with a Mac.
3. **`docs/PACKAGING.md` §2's `LAContext`-under-ad-hoc-signing question (P14 F7 item 1) is still
   open** and correctly recorded as open at `:160-169`. Whoever runs item 4 of §4 can answer it in
   the same session.
4. **Two CI workflow bumps remain staged** (F12, F37). Nothing in P21 changes that; a session whose
   push credential carries the `workflow` scope should apply both per their own READMEs and then
   delete both `AGENTS.md` Known-open bullets.
5. **Observation, not a finding: `docs/v1.1/plans/` has no plan doc for P2, P10, or either P12
   iteration** — P12's SPEC row and `AGENTS.md:29-39` both call for one file per pass. Not P21's to
   fix (a plan doc is written before its phase, and those phases are done), and nothing in the
   standing docs is wrong because of it — recorded here because a reader counting plan files against
   the phasing table will notice the gap and should know it is known.
6. **`docs/PERF.md` §2.5-§2.8's Go-side wall-clock numbers still predate Green Tea.** P12 round 2
   widened the caveat rather than re-measuring, and P21 does not re-measure either (§0.3: no new
   throwaway measurement programs). The caveat is honest and complete; the numbers underneath it are
   the oldest live figures in the repository.
