# P154 — Isolate tests from the real app home: plan

Plan for `docs/v2.0/SPEC.md`'s **P154** row. Planned on branch `v2.0-c` at `f97a1753` (P153 landed).
Line numbers are at that commit.

**Status: planned.**

**Discovery method, disclosed.** Worktree has no `.codegraph/` index. `codegraph_explore` ran
against the main checkout's index (3 calls: `gitsession.NewRegistry`/`Registry.Review`,
`gitreview.DefaultPath`/`ensureOpen`, `config.KiraSpaceHome`/`KiraHome`, `kirapaths.Home`, every
`os.UserHomeDir`/`kirapaths.Home` caller). Code shown matched this worktree. Inventory is two
real runs on this tree (§1), plus grep. Nothing was written to the tree except this file.

Single sequential implementer. Tests-only, plus one named production seam (§3.1).

---

## 1. Inventory

### 1.1 Method (repeatable)

Two probes, both against this tree, neither edits it. `$S` is any scratch dir.

**Probe A — sentinel `HOME`, what gets written.** Every app home resolves through
`internal/kirapaths.Home(envVar, dir)` = `$envVar`, else `$HOME/<dir>`. So with both env vars unset
and `HOME` at a fresh dir, any write to an app home lands in the sentinel:

```sh
env -u KIRA_HOME -u KIRA_SPACE_HOME HOME=$S/home \
  GOCACHE=$(go env GOCACHE) GOMODCACHE=$(go env GOMODCACHE) GOPATH=$(go env GOPATH) \
  GIT_CONFIG_GLOBAL=$HOME/.gitconfig GOTELEMETRY=off \
  go test -count=1 ./...
find $S/home -mindepth 1 -not -path '*/.config*'
```

`GOCACHE`/`GOMODCACHE`/`GOPATH` pinned so moving `HOME` does not rebuild or re-download.
Per-package attribution: same command per `go list` package, a fresh `HOME` each.

**Probe B — guard overlay, what resolves a home at all (reads included).** `go test -overlay`
swaps `internal/kirapaths/paths.go` for a copy whose `Home` panics when `testing.Testing()` and
`$envVar` is empty (exactly §3.1's guard). Any package that resolves a default home fails with
`panic: kirapaths: KIRA_SPACE_HOME unset in a test binary` and a stack naming the call site.

One `go.mod` (repo root) covers every Go package, so `./...` is every Go test.

### 1.2 Results

Probe A, whole suite: 74 packages `ok`, sentinel gained `.kira-space/` and `.kira-space/logs/`
(no `kira.db`, no `review.db` this run), and `.bash_history`. Per-package attribution:

- `apps/kira-space/internal/gitreview`: `.kira-space/logs`.
- `apps/kira-space/internal/gitsession`: `.kira-space/logs`.
- `internal/terminal`: `.bash_history` (not an app home, §1.4).

No `.kira-studio` anywhere: every Kira Studio test reaching `storage.Open()` already sets
`KIRA_HOME` per test (`t.Setenv`, 11 call sites in 9 files; `ipcfixture.NewApp` too).

Probe B, whole suite: exactly 4 packages panic, every other package passes:

| Package | First call site | Path to `kirapaths.Home` |
|---|---|---|
| `kira-space/internal/ade` | `board_test.go:37` | `gitsession.NewRegistry` → `gitreview.DefaultPath` (`registry.go:109`, `db.go:18`) |
| `kira-space/internal/gitrpc` | `detail_test.go:31` | same |
| `kira-space/internal/gitsession` | `registry_test.go:96` | same |
| `kira-space/internal/gitreview` | `normalize_test.go:39` | `Store.ensureOpen` → `config.EnsureLayout()` (`db.go:32`) |

A panic aborts the package binary, so the table lists the first site only. Per-package fix
(§3.2) covers the whole binary, so the set of packages is complete. `gitsock` passes: P152's
`TestMain` already sets `KIRA_SPACE_HOME`.

### 1.3 Why `review.db` itself was not created this run

`NewRegistry` builds `gitreview.NewStore(DefaultPath())` eagerly but opens lazily. These tests
never serve a review request through the default store. Files calling `NewRegistry` without
overriding `Review`: 17 now (P152 counted 23 on an older tree):

- `gitsession`: `remote_test.go`, `walk_test.go`, `registry_test.go`, `autofetch_test.go`.
- `gitrpc`: `remote_test.go`, `settings_test.go`, `graph_test.go`, `smoketest_test.go`,
  `stack_test.go`, `gh_test.go`, `handlers_test.go`, `stash_test.go`, `detail_test.go`.
- `ade`: `workflows_test.go`, `integration_test.go`, `runengine_test.go`, `board_test.go`.

Any new review-touching test in those files would open the real `~/.kira-space/review.db`. Files
that do override `Review` (`gitsession/testentry_test.go`, `incremental_test.go`, `gh_test.go`)
still resolve `DefaultPath()` first. `ade` tests open `kira.db` via `storage.OpenAt(t.TempDir())`,
so `kira.db` is already isolated there.

`gitreview`'s leak is different: `Store.ensureOpen` calls `config.EnsureLayout()` on the default
home even for a store at `t.TempDir()/review.db`. That is where `.kira-space/logs` came from.

### 1.4 Out of scope, recorded

- `internal/terminal` tests write `$HOME/.bash_history` (interactive bash in a pty). Real user
  file, not an app home. Not P154's subject; orchestrator decides on a row. Terminal is P157's area.
- `gitreview.Store.ensureOpen` resolving the default home instead of `filepath.Dir(s.path)` is a
  production quirk with no user effect (production always uses `DefaultPath()`). §3.2's `TestMain`
  covers the test side. A one-line fix (`config.EnsureLayoutAt(filepath.Dir(s.path))`) is a
  production edit outside this tests-only ask; not done unless the orchestrator approves it.
- Non-Go suites: Kira Space UI and VS Code extension tests mock IPC, no backend, no home
  (grep: no `KIRA_SPACE_HOME`/`homedir` under their `tests/`). Kira Studio `e2e-real` already uses a
  per-test `KIRA_HOME` and asserts it is under the OS tmpdir (`tests/e2e-real/fixtures.ts:198`).

---

## 2. Decisions

- **D1 Helper:** one function in existing `internal/testx` (repo-root, already shared by both apps'
  tests). Standard `testing.M` + `os.MkdirTemp` + `os.Setenv`; no library fits better.
- **D2 Per package, not per test:** `TestMain` in each of the 4 packages. Per-test `t.Setenv` would
  touch 91 test functions in the 17 files (P150 is editing some), and panics under `t.Parallel`. P152's gitsock shape,
  generalized.
- **D3 Both vars, always:** the helper sets `KIRA_HOME` and `KIRA_SPACE_HOME` unconditionally. Kills
  the KIRA_HOME-vs-KIRA_SPACE_HOME mix-up class: a package using the helper cannot pick the wrong one.
  Does not touch `HOME` (git tests need the real global git config).
- **D4 Guard = panic in `kirapaths.Home` under a test binary when the env var is empty.** Every
  default app home resolves there (2 callers: both apps' `config` wrappers; grep finds no other
  `.kira-space`/`.kira-studio` path built in Go). Fires at the exact call site, on every `go test`,
  at zero cost; catches reads, not only writes. Rejected: `scripts/check-test-home.sh` running the
  suite under a sentinel `HOME` — costs a full extra suite run (~3 min), only catches writes, and no
  hook runs `go test` (`pre-commit` = lint+typecheck, `pre-push` = build+lint), so it would only
  run when someone remembers. Probe A stays as the phase's one-off end check (§5), not a gate.
- **D5 Guard in non-production builds only:** `kirapaths` already has the `production` build-tag
  pair (`prod.go`/`prod_default.go`). The guard lives in `prod_default.go`; `prod.go` gets a no-op.
  A shipped binary never links `testing`.
- **D6 Known limit:** a developer who exports `KIRA_SPACE_HOME=~/.kira-space` and runs a package
  without the helper bypasses the guard. Packages with the helper override it anyway. Accepted.

---

## 3. Changes

### 3.1 Production seam (the guard)

`internal/kirapaths/paths.go` `Home`: after the env lookup returns empty, before
`os.UserHomeDir()`, call `requireTestHome(envVar)`.

`internal/kirapaths/prod_default.go` (`//go:build !production`):

```go
// requireTestHome fails a test binary that would resolve an app home from $HOME, i.e. the real
// user's data. Tests set the env var; testx.RunWithTempHomes does it per package.
func requireTestHome(envVar string) {
	if testing.Testing() {
		panic("kirapaths: " + envVar + " unset in a test binary; call testx.RunWithTempHomes from TestMain")
	}
}
```

`internal/kirapaths/prod.go` (`//go:build production`): `func requireTestHome(string) {}`.

No unit test (CLAUDE.md bar). §5 step 3 proves it fires.

### 3.2 Helper and per-package `TestMain`

New `internal/testx/apphome.go`:

```go
// RunWithTempHomes points KIRA_HOME and KIRA_SPACE_HOME at fresh dirs under one temp root for the
// whole test binary, runs m, then removes the root. Child processes the tests spawn inherit both.
// Use: func TestMain(m *testing.M) { os.Exit(testx.RunWithTempHomes(m)) }
func RunWithTempHomes(m *testing.M) int
```

Body: `os.MkdirTemp("", "kira-test-home-")`; on error print to stderr, return 1. Set `KIRA_HOME` =
`<root>/studio`, `KIRA_SPACE_HOME` = `<root>/space` (names hardcoded: repo-root `testx` must not
import app packages; one comment says so). On `Setenv` error print, remove root, return 1.
`code := m.Run()`, `os.RemoveAll(root)`, return `code`. No `defer` before `os.Exit` concerns: the
caller exits, the helper returns.

Per package:

- New `apps/kira-space/internal/gitrpc/main_test.go`: `TestMain` calling the helper.
- New `apps/kira-space/internal/gitsession/main_test.go`: same.
- New `apps/kira-space/internal/gitreview/main_test.go`: same.
- `apps/kira-space/internal/ade/runengine_test.go:37-42`: keep the fake-claude branch first, then
  `os.Exit(testx.RunWithTempHomes(m))` instead of `os.Exit(m.Run())`. Fake-claude children inherit
  the env.
- `apps/kira-space/internal/gitsock/main_test.go`: replace its hand-rolled `TestMain` body with
  the helper. Keep `isolatedRegistry` unchanged. Comment shrinks to one line.

Leave every existing per-test `t.Setenv("KIRA_HOME", t.TempDir())` in Kira Studio as is (already
isolated, guard passes). Leave per-test `Review` overrides as is.

Any package the guard newly flags during §5 (none expected; Probe B found 4) gets the same
`main_test.go`, same commit.

### 3.3 Docs

`docs/DEV_ENVIRONMENT.md`, next to the `KIRA_SPACE_HOME` bullet (~line 158): one terse bullet.
A test binary panics if it resolves an app home without `KIRA_HOME`/`KIRA_SPACE_HOME` set. A
package whose tests reach one calls `testx.RunWithTempHomes` from `TestMain`.

---

## 4. Ownership and commits

Files (only these):

- `internal/kirapaths/paths.go`, `prod.go`, `prod_default.go`
- `internal/testx/apphome.go` (new)
- `apps/kira-space/internal/{gitrpc,gitsession,gitreview}/main_test.go` (new)
- `apps/kira-space/internal/ade/runengine_test.go` (TestMain only)
- `apps/kira-space/internal/gitsock/main_test.go`
- `docs/DEV_ENVIRONMENT.md`, `docs/v2.0/SPEC.md` (P154 row), this file (Result)

P150 concurrently edits `ade`/`gitrpc`/`gitsession` tests in the main checkout. New `main_test.go`
files and one `TestMain` line keep rebase conflicts mechanical. At landing: if P150 added its own
`TestMain` to one of these packages, merge into one `TestMain`; a duplicate fails compilation, so it
cannot slip through.

Commits, in order (each leaves `go test ./...` green):

1. `test: run gitrpc, gitsession, gitreview, ade and gitsock tests under temp app homes` —
   helper + 5 `TestMain` changes.
2. `test(kirapaths): fail a test binary that resolves an app home from $HOME` — §3.1.
3. `docs: note test app-home isolation` — §3.3.
4. `docs(v2.0): P154 result` — Result below + SPEC row.

Trailers on every commit as CLAUDE.md and the session reminder require. No push.

---

## 5. End checks

Run from this worktree. `$S` = scratch dir.

1. `go build ./...`, `go vet ./...`, `bun run lint:go` clean. `go build -tags production ./internal/kirapaths/`
   builds (no-op `requireTestHome` present).
2. **Probe A again** (§1.1 command, fresh `$S/home`, plus `-race`): suite green and
   `find $S/home -mindepth 1 -not -path '*/.config*' -not -name .bash_history` prints nothing.
3. **Guard fires:** overlay `apps/kira-space/internal/gitrpc/main_test.go` with a file holding only
   `package gitrpc`; `env -u KIRA_SPACE_HOME go test -count=1 -overlay … ./apps/kira-space/internal/gitrpc/`
   must fail with `kirapaths: KIRA_SPACE_HOME unset in a test binary`. Then the same run without the
   overlay passes.
4. **Real home:** first confirm no other `go test`/`*.test` process runs anywhere (`pgrep -af '\.test( |$)|go test'`
   empty; P150 shares `/root`) and no Kira Space process runs. Wait until quiet; never skip. Then
   `rm -rf ~/.kira-space ~/.kira-studio`, run `go test -count=1 ./...` with the normal env, and
   `test ! -e ~/.kira-space && test ! -e ~/.kira-studio`.
5. `grep -rn "KIRA_HOME" --include=*_test.go apps/kira-space` prints nothing (no Kira Space test sets
   Kira Studio's var).

## 6. Acceptance

- Probe B (§1.1) without the overlay, i.e. the real guard: whole suite green.
- §5 steps 2 and 4: no app-home dir created under the sentinel or the real home.
- §5 step 3: a package missing the helper fails loudly at the call site.
- Production binary unchanged in behaviour; `production` build never links `testing` (D5).
- No `t.Skip`, no retries, no `--no-verify`.

## 7. SPEC row update

P154 row's status cell becomes: **Done.** One sentence each: 4 packages resolved the default
`KIRA_SPACE_HOME` (`ade`, `gitrpc`, `gitsession` via `NewRegistry`; `gitreview` via
`ensureOpen`); `testx.RunWithTempHomes` in each `TestMain`; `kirapaths.Home` panics in a test
binary with the env var unset. Plan link. Note the `.bash_history` observation (§1.4) as an open
item for the orchestrator if no row exists by then.

---

## Result

Commits:

- `eb66defa` test: run gitrpc, gitsession, gitreview, ade, gitsock and terminal tests under temp homes
- `30968939` fix(gitreview): lay out the store's own dir, not the default home
- `4c78973f` test(kirapaths): fail a test binary that resolves an app home from $HOME
- docs commit: DEV_ENVIRONMENT bullet, this Result, SPEC row

Checks:

1. `go build ./...`, `go vet ./...`, `bun run lint:go` (0 issues), `go build -tags production ./internal/kirapaths/` all clean.
2. Probe A, `-race`, sentinel `HOME`: suite green, `find` printed nothing (not even `.bash_history`).
3. Guard: gitrpc with empty `main_test.go` overlay panics `kirapaths: KIRA_SPACE_HOME unset in a test binary`; without overlay `ok`.
4. Real home: waited for quiet, `rm -rf ~/.kira-space ~/.kira-studio`, `go test -count=1 ./...` green, both paths still absent.
5. `grep KIRA_HOME` in kira-space tests: 2 comment hits only, no setter.

Newly flagged by guard: none beyond the 4 packages.

Deviations (orchestrator decisions):

- Included `gitreview.Store.ensureOpen` -> `config.EnsureLayoutAt(filepath.Dir(s.path))` (own `fix` commit).
- Added `testx.RunWithTempUserHome` plus `internal/terminal/main_test.go`: temp `HOME` so pty bash stops writing the real `~/.bash_history`.
