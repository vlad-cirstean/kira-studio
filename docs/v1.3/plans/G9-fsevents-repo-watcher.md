# G9 — FSEvents repo watcher: an O(1)-per-repo event source behind an unchanged watcher

> **What this phase is.** The ninth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> one that closes G2 F10 / G8 §7.2 blocker 4 — the file-descriptor cost of `fsnotify`'s kqueue
> backend — at the root rather than by measuring it. It changes the watcher's **OS event source
> only**. Everything above that source (classification, the leading-window debounce, the
> `refsChanged`/`worktreeChanged` vocabulary, `RepoWatcher`'s public API, `gitsession`'s whole
> session model) is unchanged.
>
> **In one line: `internal/gitclient`'s watcher grows a two-implementation `backend` seam;
> `//go:build darwin && cgo` gets a new `github.com/fsnotify/fsevents` implementation that watches
> the repository's `.git` tree recursively through one FSEvents stream; `//go:build !darwin || !cgo`
> keeps today's `fsnotify` implementation verbatim, so this container's dev/test loop keeps working
> exactly as it does now; and nothing outside `internal/gitclient` changes at all.**
>
> **The honest headline, stated once here and never softened below:** the FSEvents file itself
> **cannot be compiled, type-checked, vetted or tested in this Linux container** — not with
> `GOOS=darwin CGO_ENABLED=0` (the dependency's own cgo half is excluded and the package fails to
> build before our file is ever reached) and not with `CGO_ENABLED=1` (no macOS SDK; `clang` refuses
> `-arch`). Both were run here; §1 F8 records the exact output. `gofmt` is the only tool in this
> container that will ever look at that file. Everything else about this phase *is* provable here,
> and §7 splits the three tiers precisely.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `2a0ad11e` (the SPEC edit that inserted this
phase). Every claim below was checked against source read or a command run **in this container**,
never against prose — including G2's and G8's own plans, which are records of intent and are
verified against the code they produced.

| Claim | Evidence |
|---|---|
| The watcher is 240 lines, one file, and `fsnotify` appears in exactly one production file in the whole repo | `wc -l internal/gitclient/watcher.go` → 240; `grep -rn fsnotify --include=*.go .` → `watcher.go` (5 hits) plus three *comments* in `gitsession/registry.go:55`, `gitsession/entry.go:227`, `gitsock/matrix_support_test.go:65` |
| `gitsession` reaches the watcher only through an interface it declares itself | `gitsession/entry.go:25-28` — `type Watcher interface { Signals() <-chan gitclient.Signal; Close() error }`; `registry.go:39` — `NewWatcher func(gitclient.RepoSummary) (Watcher, error)`; `registry.go:60` defaults it to `gitclient.NewRepoWatcher` |
| `classify` never reads an event's `Op`/kind — G2 D9's deliberate design | `watcher.go:57-77`; the only `fsnotify` field read anywhere is `ev.Name` (`:209-210`) and `fsnotify.ErrEventOverflow` (`:222`) |
| `fsnotify v1.10.1` has **no** FSEvents backend; darwin is kqueue | `ls $(go env GOMODCACHE)/github.com/fsnotify/fsnotify@v1.10.1/backend_*.go` → `fen`(solaris) `inotify`(linux) `kqueue`(`freebsd \|\| openbsd \|\| netbsd \|\| dragonfly \|\| darwin`) `other` `windows`. `CHANGELOG.md` has no FSEvents entry; its `#479` entry states the problem outright: "kqueue requires a file descriptor for every file in a directory" |
| This repo **already** contains darwin-only cgo code, with an established build-tag convention | `internal/secrets/keyring_darwin.go` (`darwin && cgo`, `keybase/go-keychain`), `internal/metrics/responsible_darwin.go` (`darwin`, `import "C"`), `internal/localauth/evaluate_darwin.go` (`darwin && cgo`, Objective-C) — each with a `_nocgo_darwin.go` / `_other.go` companion |
| `build/darwin/Taskfile.yml` pins `CGO_ENABLED: 1` for every darwin build task | `apps/kira-studio/build/darwin/Taskfile.yml:57` |
| `go test ./apps/kira-studio/internal/gitclient/...` is green here today | run: `ok …/gitclient`, `…/catfile`, `…/logsession`, `…/porcelain` |
| `git config user.email` / `user.name` | `noreply@anthropic.com` / `Claude` — checked before this plan was committed, per the prompt's own standing instruction |
| `CONTRACT_VERSION` is 16 on both sides | `gitrpc/contract.go:13` `ContractVersion = 16`; `packages/git-ipc/src/validate.ts:7` `CONTRACT_VERSION = 16` |

### 0.2 Scope

1. Split the watcher's OS event source behind a two-line `backend` interface, leaving
   classification, debounce and public API in one platform-agnostic file (§3.1, D6).
2. Move today's `fsnotify` plumbing, verbatim in behaviour, into a `!darwin || !cgo` file (§3.3, D5).
3. Add a `darwin && cgo` FSEvents implementation (§3.2, D1/D8/D9/D10).
4. Resolve symlinks once, at watcher construction, so FSEvents' realpath-only event paths can
   possibly match (§3.1, D7, F9 — the single highest-probability way to get this phase wrong).
5. Add the two tests that the new seam makes possible and that meet `AGENTS.md`'s bar (§3.4).
6. Change nothing else — not `gitsession`, not `gitrpc`, not `gitsock`, not one line of TypeScript,
   not `CONTRACT_VERSION` (§4, D11).

### 0.3 Not in this phase

- **No behaviour change on any platform.** The same two signals, the same 200 ms leading window, the
  same payload. If a reviewer finds a user-visible difference other than "the watcher no longer runs
  out of file descriptors", something is out of scope.
- **No `gitsession` change of any kind.** F2 establishes that the existing `NewWatcher` seam is
  sufficient; §4 makes "gitsession is untouched" an exit criterion rather than an outcome.
- **No `CONTRACT_VERSION` bump.** D11 states why, and states what to do if the implementer ever finds
  themselves wanting one.
- **No recursive *worktree* watch.** G2 D9 declined it on three grounds, only one of which
  (per-file descriptors) this phase removes. The other two — no third `kind` the contract can carry,
  and no exclusion policy for `node_modules`/`target`/`.venv` — are untouched, and FSEvents on a
  large monorepo worktree would deliver a firehose this app has nothing to do with. G4 still owns
  the unstaged-edit question (G2 §10).
- **No removal of G8 D7's `invalidateAfterWrite`.** It is a second line of defence for our *own*
  writes and costs nothing; a phase that improves the watcher is not a reason to delete a backstop.
- **No edit to `docs/v1.3/SPEC.md`**, per `docs/v1.1/README.md`'s standing rule. Everything this
  plan settles that the SPEC left open is settled here.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` applies in full: no stubbed error handling, no `TODO: fix later`, no skipped
  validation. Where the FSEvents file cannot be verified here, the plan says so — it does not
  compensate with a stub or a "best effort" path.
- **Reach for a library before hand-rolling.** D1 applies it; D2 and D3 record where it declines,
  naming the requirement, as `AGENTS.md` requires.
- Comments very concise, only where the code cannot say it itself.
- Tests only where `AGENTS.md`'s bar is met. This phase clears it in exactly two new places (§3.4);
  everything else is the existing suite, unchanged.

---

## 1. Findings

### F1 — Only about 55 of the watcher's 240 lines are actually platform-specific, and none of the interesting ones are

`watcher.go` divides cleanly, which is what makes this phase small:

| Lines | What | Platform-specific? |
|---|---|---|
| `:16-51` | `Signal`, the two constants, `debounceWindow`, `refIshNames`, `stripLockSuffix` | **No** |
| `:53-77` | `classify` — the ordered-rule table | **No** |
| `:79-93` | `addRefsTree` — `filepath.WalkDir` + `fsnotify.Add` per directory | Yes (exists *only* because fsnotify has no recursive watch, G2 F9) |
| `:95-159` | `RepoWatcher` struct, `NewRepoWatcher`, `Signals`, `Close`, `emit` | Mixed — the API is not, the `fsnotify.NewWatcher`/`Add` calls are |
| `:161-173` | `maybeWatchNewRefsDir` — D10's on-`Create` directory extension | Yes (same reason as `addRefsTree`) |
| `:175-240` | `run` — the two pending flags, the leading-window timer, the `Events`/`Errors`/`timerC`/`stop` select | Mixed — the debounce is not, the two channel *sources* are |

The whole of `classify` and the whole of the debounce survive a backend swap untouched. That is not
luck: G2 D9/D11 deliberately built both to read nothing but a path, and G2's own §7.2 note said why
— *"`nodeFileWatcher.ts:1-11`'s note that FSEvents-style coalescing makes an event's `kind`
untrustworthy — which is why `classify` never reads `Op`"*. G2 scoped for FSEvents six phases before
FSEvents arrived, and this finding is the payoff.

### F2 — The `gitsession` seam is already sufficient; `gitsession` needs **zero** changes

`gitsession/entry.go:25-28` declares the seam itself rather than importing a concrete type:

```go
type Watcher interface {
    Signals() <-chan gitclient.Signal
    Close() error
}
```

and `registry.go:39/60` reaches `gitclient` through a function field defaulted to
`gitclient.NewRepoWatcher`. G3 built that seam so a test could inject a counting fake; it turns out
to be exactly the abstraction boundary an OS-mechanism swap needs. As long as `NewRepoWatcher`'s
signature, `Signals()`'s element type and `Close()`'s error contract are unchanged — and D11 keeps
all three — **not one file under `internal/gitsession` is touched by this phase.** That is the
cleanest available outcome and it is achievable; §7.3 makes it a checklist item.

### F3 — `fsnotify` cannot be configured out of the problem; the per-file descriptor cost is inherent to kqueue

`fsnotify v1.10.1`'s backend set is `fen`/`inotify`/`kqueue`/`other`/`windows`; `backend_kqueue.go`
carries `//go:build freebsd || openbsd || netbsd || dragonfly || darwin`. There is no FSEvents
backend, no build tag that selects one, and no open path to one in the CHANGELOG. Its own history
records the cost as a property of the API, not a choice: entry `#479` — *"kqueue requires a file
descriptor for every file in a directory; this would …"* — and `#617` (`O_CLOEXEC` so those
descriptors are not passed to children) is the shape of a project managing an unavoidable fd budget.

So SPEC's G9 row is right that this needs a different library, not a different flag.

### F4 — `github.com/fsnotify/fsevents` v0.2.0 requires cgo, is darwin-only at the file level, and pulls in no Go dependency at all

Read in this container at `$(go env GOMODCACHE)/github.com/fsnotify/fsevents@v0.2.0`:

- **cgo, unavoidably.** `wrap.go:6-7` — `#cgo LDFLAGS: -framework CoreServices`,
  `#include <CoreServices/CoreServices.h>`; `wrap.go:30` — `import "C"`. FSEvents is a CoreServices
  C API driven by a callback on a dispatch queue; there is no syscall-level equivalent to bind
  against (the raw `/dev/fsevents` device the daemon itself reads is root-only and undocumented).
- **Every file is `//go:build darwin`** — `fsevents.go:1`, `wrap.go:1`, and both test files. On any
  other `GOOS` the package has no files at all, so a `//go:build darwin`-tagged importer on our side
  never resolves the import.
- **`go.mod` is two lines**: `module github.com/fsnotify/fsevents`, `go 1.17`. No requires. Nothing
  new enters the dependency graph beyond the module itself.
- **BSD-3-Clause** (`LICENSE`, read in full: the three-clause Google/Go text). Fully open source, no
  dual licensing, no gated feature — `AGENTS.md`'s bar.
- **Published 2024-05-14** (`proxy.golang.org/.../@v/v0.2.0.info`), under the same GitHub org as the
  `fsnotify` this repo already depends on.
- **API surface used**: `EventStream{Paths, Flags, Latency, Device, Resume, Events}`, `Start()`,
  `Stop()`, `Event{Path, Flags, ID}`, and the `CreateFlags`/`EventFlags` constants — nine symbols.

### F5 — `rjeczalik/notify` has the same cgo requirement on darwin, and one disqualifying failure mode fsevents does not

Also read here, at `notify@v0.9.3`:

- `watcher_fsevents.go:5` / `watcher_fsevents_cgo.go:5` — `//go:build darwin && !kqueue && cgo`,
  with `#cgo LDFLAGS: -framework CoreServices`. **Identical cgo requirement.** Adopting it buys
  nothing on the central question.
- `watcher_kqueue.go:5` — `//go:build (darwin && kqueue) || (darwin && !cgo) || dragonfly || …`.
  **A darwin build with `CGO_ENABLED=0` silently gets kqueue back**, at the same import, behind the
  same API, with no compile error and no runtime signal. That is precisely the failure this phase
  exists to eliminate, made invisible.
- Published **2023-01-12**; `fsnotify` — the library adopting `notify` would *replace* — is at
  `v1.10.1`, **2026-05-04**. The trade swaps the better-maintained library for the worse one.
- Adopting it changes the **Linux** backend too (notify's own inotify implementation), so every
  currently-green watcher test in this repo would be re-verifying a different library for no gain.
- Its `tree_recursive.go`/`tree_nonrecursive.go` bookkeeping exists to emulate recursion on backends
  that lack it. We want one recursive root and no emulation.

### F6 — This repo already has three darwin+cgo packages, with a documented convention — so `AGENTS.md`'s fast loop is **not** the invariant this phase threatens

This is the decisive finding, and it inverts the prompt's own working assumption.

| Package | cgo file | Tag | Companion | Companion's tag |
|---|---|---|---|---|
| `internal/secrets` | `keyring_darwin.go` (`keybase/go-keychain`) | `darwin && cgo` | `keyring_nocgo_darwin.go`, `keyring_other.go` | `darwin && !cgo`, `!darwin` |
| `internal/metrics` | `responsible_darwin.go` (`import "C"`, libSystem) | `darwin` | `responsible_nocgo_darwin.go`, `probe_other.go` | `darwin && !cgo`, `!darwin \|\| !cgo` |
| `internal/localauth` | `evaluate_darwin.go` (Objective-C, LocalAuthentication) | `darwin && cgo` | `evaluate_other.go` | `!darwin \|\| !cgo` |

Their own comments already state the whole doctrine this phase needs, in the repo's own words:

- `keyring_nocgo_darwin.go`: *"This app never ships that way (`build/darwin/Taskfile.yml` pins
  `CGO_ENABLED=1` for every darwin build task), but `go vet`/`go build` should still type-check the
  combination."*
- `evaluate_darwin.go`: *"it cannot be compiled or exercised outside a real macOS toolchain (the same
  wall P7 §1.4 hit: `CGO_ENABLED=1 GOOS=darwin go build` fails here with `clang: error: unsupported
  option '-arch'`). Read it for structure, not for a compiler's blessing here."*
- `evaluate_other.go`: *"`New()`'s own startup log line is what makes a build that accidentally ships
  this way say so out loud."*

So: **`AGENTS.md`'s load-bearing property is "`go test ./apps/kira-studio/internal/...` on Linux needs
nothing but the Go toolchain", and G9 preserves it exactly** — a `darwin`-tagged file is invisible to
a Linux build. What G9 does *not* preserve, because it was never true, is the literal reading
"the product's own Go code is entirely cgo-free": three packages already break that on macOS, and
`docs/ARCHITECTURE.md:50`'s stronger claim (*"The whole product binary is cgo-free for its own code
— only Wails' own macOS bindings still need `CGO_ENABLED=1`"*) is already false today. D13 handles
the documentation question and flags it as a human call rather than fixing it quietly.

### F7 — A **scoped** `CGO_ENABLED=0 GOOS=darwin go vet` is runnable and green here today; the unscoped one is not, and never was

Run here, on the current tree:

```
$ CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet \
    ./apps/kira-studio/internal/gitclient/... ./apps/kira-studio/internal/gitsession/... \
    ./apps/kira-studio/internal/gitrpc/... ./apps/kira-studio/internal/gitsock/...
(no output)                                                        # green

$ CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/...
# github.com/wailsapp/wails/v3/pkg/application
…/application/events_common_darwin.go:14:10: undefined: macosApp
…/application/application.go:57:2: undefined: fatalHandler
… (too many errors)                                                # fails, in Wails, not in us
```

The failure is entirely inside `wailsapp/wails/v3`, reached through `internal/bridge`, and predates
this phase. So the darwin cross-vet is a **real and useful** verification lever for this phase, but
only when scoped to the git packages — which is the same scoping SPEC's own "Full verification scope,
2026-09-07" note already applies to the race run. §7.1 uses it that way.

`CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/secrets/... ./…/metrics/... ./…/localauth/...`
is also green here, which is the evidence that the `_nocgo_darwin.go` convention actually works.

### F8 — Nothing about the FSEvents file's own compilation can be checked in this container. Both routes were tried; here is exactly what they print

A minimal probe package (a `//go:build darwin` file constructing an `fsevents.EventStream` and
calling `Start()`, plus a `//go:build !darwin` no-op) was built in the scratchpad and run through
every plausible check:

| Command | Result |
|---|---|
| `go build ./...` (linux, cgo on) | **green** — the darwin file is excluded, so this proves nothing about it |
| `go vet ./...` (linux) | **green** — same |
| `gofmt -l .` | **green** — the *only* tool here that reads the darwin file's bytes; it proves the file parses and is formatted, and nothing more |
| `CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build ./...` | **fails inside the dependency**: `github.com/fsnotify/fsevents/fsevents.go:21:8: undefined: EventFlags` … `:167:3: undefined: stop` — `wrap.go` is a cgo file, so `CGO_ENABLED=0` excludes it, leaving `fsevents.go` referencing eight symbols that no longer exist. The compiler never reaches our file |
| `CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./...` | identical failure, identical reason |
| `CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build ./...` | `# runtime/cgo` → `clang: error: unsupported option '-arch' for target 'x86_64-pc-linux-gnu'` — no macOS SDK, no `osxcross`. It fails before compiling anything of ours |

**Conclusion, stated plainly and not softened anywhere else in this document: in this container the
FSEvents file gets `gofmt` and nothing else.** No lint pass, no vet pass, no build, no test, and no
combination of flags proves that it compiles, that its types line up, that its constants exist, or
that its teardown sequence is deadlock-free. Any claim in an implementation report that a check here
"validated" that file is false. This exactly matches `localauth/evaluate_darwin.go`'s own recorded
experience (F6), so it is a known and previously-accepted cost in this repo, not a new one.

The design consequence — and the whole reason §3 is shaped the way it is — is that **the
unverifiable surface must be as small as possible**: one file, no branching logic, no state machine,
just "start an FSEvents stream, translate its events into `rawEvent`, stop it".

### F9 — FSEvents reports **resolved** paths, this is new, and getting it wrong makes the watcher silently produce nothing

`fsevents`' own README, Caveats: *"FSEvents returns events for the named path only, so unless you
want to follow updates to a symlink itself (unlikely), you should use `filepath.EvalSymlinks` to get
the target path to watch."* Its own test harness does exactly that (`helpers_test.go:513` —
`tmp, err = filepath.EvalSymlinks(tmp)`).

Why it bites here specifically:

- `Identify` (`repo.go:171-180`) sets `CommonDir`/`GitDir` from `git rev-parse --absolute-git-dir` /
  `--git-common-dir --path-format=absolute`, `filepath.Clean`'d. Git does **not** resolve symlinks
  there — it returns the path derived from the caller's cwd.
- On macOS `/tmp` is a symlink to `/private/tmp`, and `$TMPDIR` (hence `t.TempDir()`) is
  `/var/folders/…`, with `/var` a symlink to `/private/var`.
- `classify` (`watcher.go:57-77`) is pure path-prefix and path-equality matching.

So on macOS, a repository under `t.TempDir()` would have `CommonDir = /var/folders/…/.git` while
every FSEvents path arrives as `/private/var/folders/…/.git/…`. **Every comparison fails, `classify`
returns `("", false)` for everything, and the watcher emits nothing — with no error, no log line,
and no failing assertion anywhere except the watcher tests themselves timing out.** That is the
single most likely way to ship this phase broken.

The current kqueue backend is immune, which is why this has never come up: kqueue events echo back
the path the caller registered, so `classify` compares a string against itself.

### F10 — FSEvents is recursive from a root, and a linked worktree's `gitDir` is already inside `commonDir` — so the watched set collapses to one or two paths

- `fsevents`' README: *"A Stream can recursively monitor many directories."* One `EventStream` takes
  a `Paths []string` and covers each one's whole hierarchy.
- Verified here with real git:
  ```
  $ git worktree add ../wt -b feat
  $ cd ../wt && git rev-parse --path-format=absolute --absolute-git-dir
  /tmp/…/main/.git/worktrees/wt
  $ git rev-parse --path-format=absolute --git-common-dir
  /tmp/…/main/.git
  ```
  A linked worktree's `gitDir` is `<commonDir>/worktrees/<name>` — already covered by a recursive
  watch on `commonDir`.

So G2's three watched sets (`commonDir` flat, the linked worktree's `gitDir` flat, and every
directory under `commonDir/refs` enumerated-and-extended) collapse to **`Paths: [commonDir]`**, plus
`gitDir` only in the case where it is genuinely not under `commonDir` (a `--separate-git-dir` layout,
where in practice `gitDir == commonDir` anyway). `addRefsTree` and `maybeWatchNewRefsDir` — the two
functions that exist only because `fsnotify` has no recursion (G2 F9) — have no FSEvents counterpart
at all.

**The cost side of that recursion, stated rather than glossed:** watching `commonDir` recursively
also delivers events for `objects/**`, `logs/**` and `hooks/**`, which the kqueue design never saw. A
`git fetch` or `git gc` on a large repository will produce a burst of loose-object and pack-file
events. Every one of them falls through `classify`'s three rules to `("", false)` — a handful of
string comparisons, no allocation, no signal. That is a CPU cost of the same order as the burst
itself and it is the price of recursion; it is not a correctness problem, and it is bounded by the
debounce regardless of how many events arrive.

### F11 — FSEvents' own dropped-event vocabulary maps cleanly onto the rule G2 already wrote for `ErrEventOverflow`

`wrap.go:97-230` exposes the callback flags. Four matter:

| Flag | Meaning | Existing analogue |
|---|---|---|
| `MustScanSubDirs` | "too many events coalesced; rescan this subtree yourself" | `fsnotify.ErrEventOverflow` |
| `KernelDropped` / `UserDropped` | events were dropped in the kernel or in the client buffer | same |
| `RootChanged` | a watched root was moved or deleted (only delivered with the `WatchRoot` create flag) | nothing today — `fsnotify` silently drops the watch |

`watcher.go:222-225` already handles the class: *"Something changed, we don't know what — raise both
signals (D10)."* All four map onto that identical rule. So G2's design absorbs FSEvents' coalescing
semantics without a redesign — **confirmed by reading the flag set, not assumed** — and the one place
that needs a new arm (`RootChanged`) is a strict improvement over what kqueue gives us today.

The other half of G2's anticipation also holds: `classify` reading only the path means
`ItemCreated|ItemModified|ItemRenamed` arriving OR'd together on one event, which FSEvents does
routinely, changes nothing.

### F12 — Three concrete traps in the library's own API that a straight port of its example would walk into

Read from the source, not the README:

1. **`Device` must stay zero.** `fsevents.go:96-99` — when `Device != 0`, `setupStream` uses
   `EventStreamCreateRelativeToDevice` (`wrap.go:16`) and paths come back **device-relative, with no
   leading `/`**. The library's own test harness confirms it by trimming that way
   (`helpers_test.go:376-383` strips the leading slash from the prefix before trimming). **The
   library's own `example/` sets `Device: dev`.** An implementer copying it gets relative paths,
   `classify` matches nothing, and the watcher goes silent with no error — the same end state as F9
   and just as invisible. With `Device: 0` the non-device `EventStreamCreate` is used and paths are
   absolute.
2. **`Events` is unbuffered and the C callback blocks on it.** `wrap.go:281` — `es.Events <- events`,
   from `fsevtCallback`, running on the stream's dispatch queue. A consumer that is slow, or parked,
   stalls that queue. Our own `run` loop must do nothing per event but classify and set a bool
   (which is already true), and must never call something that can block while it is the only
   drainer.
3. **`Stop()` does not close `Events`.** `fsevents.go:165-177` — it releases the stream and the
   queue and deletes the registry entry; the channel stays open forever. So `RepoWatcher.Close`
   cannot use "the source channel closed" as its termination condition the way the fsnotify path
   does (`watcher.go:205-207`), and it must not stop the stream while a callback might be blocked
   mid-send. D10 fixes the ordering explicitly.

Also noted, and handled by construction: `wrap.go:453-457` installs a `runtime.SetFinalizer` that
calls `Stop()` if an `EventStream` is collected without one, with its own `TODO` conceding it may
not run before exit. We always `Stop()` explicitly, so the finalizer never matters.

### F13 — The library's own README says it is unstable and not well maintained, and documents a 4096-path process limit

Quoted verbatim from `README.md`:

> **Warning:** This API should be considered unstable.

> FSEvents is currently not well maintained or well tested. Patches will generally get merged *if*
> there's a decent signal they're correct.

> There is an internal macOS limitation of 4096 watched paths. Watching more paths will result in an
> error calling `Start()`. Note that FSEvents is intended to be a recursive watcher by design, it is
> actually more efficient to watch the containing path than each file in a large directory.

Three things follow, and none of them is a reason to decline (D1 weighs them):

1. It is under the same GitHub org as `fsnotify`, is BSD-3-Clause, has zero dependencies, and is
   ~700 lines of which we use nine symbols. The blast radius of "unstable" is small and legible.
2. The 4096 limit is a **process** limit on watched *paths*, and this design uses one path per
   repository (F10). 4096 simultaneously-open repositories is not a state this app can reach; the
   thing it replaces is a *shared* 24576-descriptor budget consumed at one per loose ref.
3. There is no better-maintained alternative: `rjeczalik/notify` is older and has F5's disqualifying
   fallback, and `fsnotify` itself has no FSEvents backend (F3).

### F14 — The fd number cannot be produced here, P-i is unaffected by this phase, and the honest claim is a complexity class, not a measurement

- `gitsock/perf_test.go:323-350`'s **P-i** counts this *process's* inotify watch descriptors via
  `/proc/self/fdinfo` and is explicitly `t.Skip`ped off Linux (`:328`). It measures the **fsnotify**
  path, which G9 leaves byte-for-byte unchanged on Linux. **So P-i's number is expected to be
  identical before and after this phase, and that is correct, not a gap** — it was never a proxy that
  could move.
- The macOS number (`lsof -p $(pgrep -f 'Kira Studio') | grep -c '/\.git/'`) is G8 §7.2 step 7's
  manual measurement and is the only thing that can answer the real question.
- What this phase can honestly assert from this container is a **complexity class**: kqueue costs
  O(files under the watched directories) descriptors per repository (`fsnotify`'s own
  `backend_kqueue.go:581-620` `watchDirectoryFiles` → `internalWatch` → `unix.Open`, G2 F10);
  FSEvents costs **O(1) per repository** — one stream, one dispatch queue, no per-path descriptor —
  regardless of loose-ref count. D12 fixes the exact wording so nobody upgrades it into a number.

---

## 2. Decisions

### D1 — `github.com/fsnotify/fsevents v0.2.0`, added; `github.com/fsnotify/fsnotify v1.10.1`, **kept**

Two direct dependencies where there was one. `go.mod` gains one require; `go.sum` gains its two
lines; nothing else enters the graph (F4: the module has no requires of its own).

`fsevents` is chosen because it is the only maintained Go binding to the API SPEC's G9 row names, it
is under the same org as the dependency it sits beside, it is BSD-3-Clause with no gated features
(`AGENTS.md`'s licence bar checked at the package level *and* for the feature used — the whole
package is one licence and one feature), it has zero transitive cost, and its nine-symbol surface is
small enough that F13's "unstable" warning is a legible risk rather than an open-ended one.

`fsnotify` is **kept**, not dropped, for a reason that is the whole point of this phase's shape:

- It is the backend for `!darwin || !cgo` (D5). Dropping it would leave the Linux dev/test loop with
  either no watcher at all or a hand-rolled inotify binding — a strictly worse outcome than today,
  and `AGENTS.md`'s library rule says so.
- It is what keeps `watcher_test.go`'s existing real-repository tests (`TestRepoWatcher_*`) running
  and meaningful in this container.
- It is what makes `CGO_ENABLED=0 GOOS=darwin go vet` type-check (F7): the darwin-no-cgo build gets a
  real, compiling implementation rather than a stub, which is a small improvement on the
  `_nocgo_darwin.go` convention F6 records.

### D2 — `rjeczalik/notify` is declined, and the reason is its silent kqueue fallback, not its cgo requirement

`AGENTS.md` requires naming the requirement when declining a library. The requirement is: **a darwin
build must never silently use kqueue.** That is the entire subject of this phase.

`notify` fails it by construction (F5): `watcher_kqueue.go`'s build tag includes `darwin && !cgo`,
so `CGO_ENABLED=0 GOOS=darwin` compiles cleanly, imports identically, and quietly reinstates the
per-file descriptor cost. There is no compile error, no API difference and no runtime signal to
detect it by. With the explicit build tags of D5 in our *own* files, the same configuration produces
a named constant (`watcherBackend`) that a startup log line prints and an exit criterion checks.

Secondary, all pointing the same way: identical cgo requirement on darwin so nothing is gained on
the central question (F5); it would replace `fsnotify` wholesale, changing the Linux backend under
every green test for no benefit; it is three years older than the library it would replace; and its
recursive-tree emulation is machinery this design does not want (F10).

### D3 — A `purego`/dlopen binding, and a hand-rolled one, are both declined

`github.com/ebitengine/purego` (v0.11.0, resolvable through the proxy here) can call C from Go on
darwin without cgo, so a cgo-free FSEvents binding is *theoretically* possible. It is declined
because **no such binding exists** — `AGENTS.md`'s rule is "reach for an existing, well-maintained
library", and there is none to reach for. Writing one means hand-rolling CoreFoundation FFI:
`CFStringCreateWithCString`/`CFArrayCreate` marshalling, `dispatch_queue_create`, and a
`purego.NewCallback` trampoline for `FSEventStreamCallback` with its five raw pointer arguments —
squarely the "non-trivial infrastructure" the rule exists to prevent, in a file this container
cannot compile either (F8), so it would trade a maintained dependency for unverifiable
hand-written FFI and gain only the removal of a cgo requirement the shipped darwin build already has
in three other packages (F6) and in Wails itself.

The named requirement that would justify it: none. There is no requirement in this chapter that a
darwin build be cgo-free — `build/darwin/Taskfile.yml:57` pins `CGO_ENABLED: 1` for every darwin
build task.

### D4 — The invariant this phase must preserve is "**Linux**'s `go test ./apps/kira-studio/internal/...` needs nothing but the Go toolchain", and it is preserved exactly

Resolving the prompt's central question, with F6's evidence.

- **Preserved, exactly:** a `//go:build darwin`-tagged file is invisible to a Linux build. After G9,
  `go build`/`go test ./apps/kira-studio/internal/...` in this container compiles the same
  `fsnotify` watcher it compiles today, links no C, and needs no headers. `fsevents` is downloaded
  by `go mod download` (it is in the module graph) but never built.
- **Not newly broken, because it was never true:** the stronger reading — "the product's own Go code
  is entirely cgo-free" — is already false on macOS in `internal/secrets`, `internal/metrics` and
  `internal/localauth` (F6). G9 adds `internal/gitclient` to that existing list of four.
- **What actually changes for a macOS developer:** `go test ./apps/kira-studio/internal/gitclient/...`
  on a Mac now compiles cgo. That requires a C toolchain, which every Mac running this repo already
  has — `scripts/setup.sh` and the whole Wails build need it, and `gitclient/discovery.go`'s own
  probe order gates on `xcode-select -p`, i.e. this app already treats the Xcode Command Line Tools
  as present. Cost: a few seconds of extra compile on a cold cache. Nothing else.
- **The deliberate break, named:** `CGO_ENABLED=0 GOOS=darwin` no longer gets the FSEvents backend.
  D5 makes that a *compiling, working, correct* configuration (it falls back to `fsnotify`) rather
  than a build failure, and makes it *loud* rather than silent.

### D5 — Three files, the repo's own darwin/cgo convention, and a named backend constant that says out loud which one shipped

Mirroring `internal/metrics`' shape exactly (F6):

| File | Build tag | Contents |
|---|---|---|
| `watcher.go` | *(none — every platform)* | `Signal`, `debounceWindow`, `refIshNames`, `stripLockSuffix`, `classify`, `RepoWatcher`, `NewRepoWatcher`, `Signals`, `Close`, `emit`, `run` (the debounce), the `backend`/`rawEvent` seam |
| `watcher_fsevents_darwin.go` | `darwin && cgo` | `const watcherBackend = "fsevents"`; `newBackend` over one `fsevents.EventStream`. **The only file in this repo that imports `github.com/fsnotify/fsevents`.** |
| `watcher_fsnotify.go` | `!darwin \|\| !cgo` | `const watcherBackend = "fsnotify"`; `newBackend` over one `fsnotify.Watcher` — today's `addRefsTree`/`maybeWatchNewRefsDir`/`Errors` handling, behaviourally verbatim |

Rejected: a `darwin && cgo` file with **no** `!cgo` companion (so `CGO_ENABLED=0 GOOS=darwin` fails
to build). It would take away F7's working cross-vet — currently the only automated check in this
container that will ever look at the darwin *side* of this package at all — for the sake of a
build-time error in a configuration `build/darwin/Taskfile.yml:57` already makes unreachable.

Rejected: a `darwin && !cgo` **stub** that returns an error, the way `keyring_nocgo_darwin.go` does.
A stub is right when the capability genuinely does not exist without cgo (there is no Keychain
without `go-keychain`); here there *is* a working watcher without cgo, and refusing to use it would
make the cross-vet configuration a lie about the code's behaviour.

**How the fallback is made loud, per `evaluate_other.go`'s own stated pattern** (*"`New()`'s own
startup log line is what makes a build that accidentally ships this way say so out loud"*):
`NewRepoWatcher` logs once per watcher, at `Info`:

```go
slog.Info("gitclient: repo watcher started", "scope", "watcher",
    "backend", watcherBackend, "paths", paths)
```

One line per opened repository, on a path that already logs at `Warn` for a failed `Add`. A packaged
build that somehow shipped the kqueue fallback says `backend=fsnotify` in its own log the first time
a repository is opened, and §7.2's macOS run checks for `backend=fsevents` by name.

### D6 — The backend seam is two methods and one struct, and it carries no platform vocabulary

```go
// rawEvent is one filesystem notification, stripped of every backend-specific concept. Path is
// absolute and symlink-resolved (D7). Rescan means "events were dropped or coalesced beyond
// recognition, or a watched root moved" — the caller must assume everything changed.
type rawEvent struct {
    Path   string
    Rescan bool
}

// backend is the OS event source, and the only part of this file's job that differs by platform.
// Events is closed when the backend stops on its own; Close stops it and is idempotent.
type backend interface {
    Events() <-chan rawEvent
    Close() error
}

// newBackend is implemented once per platform (watcher_fsevents_darwin.go, watcher_fsnotify.go).
// commonDir and gitDir are already symlink-resolved.
func newBackend(commonDir, gitDir string) (backend, error)
```

Deliberately *not* on the seam, and why each stays platform-agnostic:

- **`classify`** — reads only a path, and its ordered-rule table is the thing every test in
  `watcher_test.go` exercises. Pushing it below the seam would put the phase's most-tested logic in
  the phase's least-verifiable file.
- **The debounce** — pure `time.Timer` and two booleans, identical on both backends.
- **Symlink resolution** — done once, above the seam, so both backends and `classify` agree by
  construction (D7).
- **The refs-tree walk and the on-`Create` extension** — these are `fsnotify`'s *workaround for
  having no recursion* (G2 F9), not a repository concept. They belong inside the fsnotify backend
  and have no FSEvents counterpart (F10).

The result is that the unverifiable file (F8) contains no branching, no state machine and no
repository knowledge: it starts a stream, loops over batches, emits `rawEvent`s, and stops.

### D7 — Symlinks are resolved once, in the shared constructor, against a copy of the summary

Resolving F9.

```go
func NewRepoWatcher(summary RepoSummary) (*RepoWatcher, error) {
    // FSEvents reports realpaths, always (F9): on macOS /tmp and /var are symlinks into /private,
    // so an unresolved commonDir never prefix-matches an event path and the watcher silently
    // classifies nothing. Resolved once here, for both the backend's watch roots and classify's
    // comparisons, so they cannot disagree. Falls back to the unresolved path if the directory
    // does not exist yet (a repository mid-init), which is what the fsnotify backend already
    // tolerates.
    resolved := summary
    resolved.CommonDir = resolveOrKeep(summary.CommonDir)
    resolved.GitDir = resolveOrKeep(summary.GitDir)
    ...
}
```

- `resolveOrKeep(p)` is `filepath.EvalSymlinks(p)`, returning `p` unchanged on any error.
- The **resolved copy is watcher-local**. `summary.RepoID` is on the wire (`Identify` sets it to the
  worktree root, `repo.go:203-206`) and every cache key, every `Event.RepoID` and every
  `gitsession` map key keeps using the *unresolved* value. Nothing outside this file sees the
  resolved form.
- `classify` keeps its current signature `classify(summary RepoSummary, path string)` and is called
  with the resolved copy — so `watcher_test.go`'s `TestClassify` needs **no change at all**.
- It is applied on **every** platform, not just darwin. On Linux the fsnotify backend registers the
  resolved paths, so its echoed-back event paths are resolved too, and the two agree. This is what
  makes the decision partly provable here (§3.4's symlink test).

### D8 — One `EventStream`, `Paths = [commonDir]` (+ `gitDir` only if it is genuinely outside), and each stream parameter justified

```go
es := &fsevents.EventStream{
    Paths:   paths,                        // resolved; commonDir, plus gitDir iff not under it
    Flags:   fsevents.FileEvents | fsevents.WatchRoot,
    Latency: 0,
    Device:  0,                            // NOT DeviceForPath — see below
    Resume:  false,
}
```

| Parameter | Value | Why |
|---|---|---|
| `Paths` | `[commonDir]`, plus `gitDir` when `gitDir` is not `commonDir` and not under it | FSEvents is recursive per root (F10), and a linked worktree's `gitDir` is always `<commonDir>/worktrees/<name>` — verified with real git. The `gitDir` entry survives only for a `--separate-git-dir` layout, where in practice it equals `commonDir` and collapses away. One path per repository is what makes the fd claim O(1) *and* keeps F13's 4096-path process limit irrelevant |
| `FileEvents` | set | **Required.** Without it FSEvents reports the containing *directory*, so `HEAD`, `index` and `packed-refs` would all arrive as `<commonDir>` and `classify` could not tell `refsChanged` from `worktreeChanged` at all |
| `WatchRoot` | set | Delivers `RootChanged` if `.git` itself is moved or deleted — a lost-watch mode `fsnotify` handles by silently dropping the watch, and exactly the class of silent failure G8 F5 said the design has no defence against. Mapped to `Rescan` (D9) |
| `NoDefer` | **not** set | It is a kernel-side leading-window debounce; we already have one, tested, at 200 ms (`watcher.go:186-201`). Two of them stacked is a second timing rule nobody can reason about |
| `IgnoreSelf` | **not** set | It suppresses events caused by *this process*. Every write this app makes is made by a `git` child process, so it would suppress nothing while adding a subtle "why did my own commit not fire" trap |
| `Latency` | `0` | Preserves parity with today's behaviour and with G8's measured ~210 ms stale window (its §12 baseline), so the debounce stays the single timing rule. The library's own test harness uses `Latency: 0` (`helpers_test.go:96`). A non-zero latency is a legitimate later tuning knob, recorded in §10, not a G9 change |
| `Device` | `0` | **F12 trap 1.** With `Device != 0` the stream is created relative to the device and every `Event.Path` comes back *device-relative with no leading slash*, `classify` matches nothing, and the watcher goes silent with no error. The library's own `example/` sets it. It stays zero |
| `Resume` | `false` | `Start()` then uses `eventIDSinceNow` (`wrap.go:427-430`) — future events only. Replaying history on every `repo.open` would fire a spurious `repo.changed` at every window's startup |

### D9 — `Rescan` is raised for the four dropped/coalesced flags, and maps onto the rule G2 already wrote

Resolving F11. The FSEvents backend sets `rawEvent.Rescan` when an event's flags carry any of
`MustScanSubDirs`, `KernelDropped`, `UserDropped` or `RootChanged`, and the shared `run` loop treats
`Rescan` exactly as `watcher.go:222-225` treats `fsnotify.ErrEventOverflow` today: raise **both**
pending flags and arm the window. `Path` is ignored for a `Rescan` event.

Both flags rather than one, unchanged from G2 D10, because the honest content of the signal is
"something changed and we do not know what" — and under-signalling here is a silently stale cache in
two windows (G8 F5), while over-signalling is one extra `refs.list`/`status.get` round trip.

The `!darwin || !cgo` backend keeps producing `Rescan` from `ErrEventOverflow`, so both backends
feed the same rule and the shared loop has no platform branch.

### D10 — Teardown is drain-first, then stop, then exit — specified here because it cannot be debugged in this container

Resolving F12 traps 2 and 3. `fsevents.Stop()` does not close `Events`, and the C callback can be
parked mid-send on the unbuffered channel while `FSEventStreamStop`/`Invalidate` want the dispatch
queue. So "close the source and let the range loop end" — the fsnotify backend's shape
(`watcher.go:205-207`) — is not available, and a naive `Stop()` from a goroutine that is also the
only drainer risks a deadlock that this container cannot reproduce, observe or fix.

The FSEvents backend's `Close()` therefore runs this exact sequence, on the caller's goroutine:

1. Set a `stopping` flag (a closed channel) that its own forwarding goroutine observes. The goroutine
   **keeps draining `es.Events` and discards** — it does not return yet. This guarantees any callback
   parked on the send completes.
2. Call `es.Stop()`. With a live drainer, no callback can be blocked, so `FSEventStreamStop` /
   `Invalidate` / `Release` have nothing to wait on.
3. Close a second `done` channel; the forwarding goroutine sees it, closes the `rawEvent` channel and
   returns.
4. Join the goroutine, so `Close()` returns only once nothing is left running.

`sync.Once`-guarded, so `Close()` is idempotent — `RepoWatcher.Close` is already called from both
`RepoEntry.teardown` and test cleanups (`entry.go:300`, `watcher_test.go:108`), and
`TestRepoWatcher_Close_StopsSignals` already asserts a second `Close()` returns nil.

This is the one piece of the unverifiable file that is more than mechanical, which is why it is
specified as a numbered sequence here rather than left to the implementer, and why §7.2 makes "the
watcher stops cleanly, repeatedly, on real macOS" an explicit manual step rather than a footnote.

### D11 — Classification, debounce, the public API, `gitsession` and `CONTRACT_VERSION` are all unchanged, and that is an exit criterion

- **`classify`, `refIshNames`, `stripLockSuffix`, `debounceWindow` and the leading-window timer:
  unchanged, character for character**, apart from `classify` receiving the resolved-summary copy
  (D7), which is a caller change and not a signature change. G2 D9/D11's design already anticipated
  FSEvents (F1).
- **`NewRepoWatcher(RepoSummary) (*RepoWatcher, error)`, `Signals() <-chan Signal`, `Close() error`:
  unchanged.** This is what makes F2 true.
- **`internal/gitsession`: not one file touched.** Its `Watcher` interface and `Registry.NewWatcher`
  field are satisfied identically before and after.
- **`CONTRACT_VERSION` stays 16** (`gitrpc/contract.go:13`, `packages/git-ipc/src/validate.ts:7`).
  `repo.changed`'s payload is `{repoId, kind}` either way; no request, event or stream key is added,
  removed or reshaped. **If the implementer finds themselves reaching for a version bump, stop** —
  it means something has become wire-visible that this phase has no business making wire-visible, and
  it should be reported rather than bumped.

### D12 — What this phase may claim about the fd cost, in exactly these words

Resolving F14. The claim, and the only claim:

> **The new design's file-descriptor cost is O(1) per open repository instead of O(files under the
> watched `.git` directories).** One FSEvents stream and its dispatch queue per repository,
> independent of loose-ref count, replacing `fsnotify`'s kqueue backend's one `unix.Open` per file in
> every watched directory (`backend_kqueue.go:581-620`, G2 F10).

What must **not** be claimed, by this plan, by the implementing agent, or in a commit message:

- Any *number*. The measurement is macOS-only and this container cannot take it (F8, F14).
- That the existing green Linux suite says anything about it. It exercises the unchanged `fsnotify`
  backend, and P-i's inotify count is expected to be **identical** before and after (F14).
- That G8 §7.2 blocker 4 is *closed*. It is closed by design and remains **open by measurement**
  until §7.2 step 3 is run on real hardware. The difference is that the measurement is now a
  confirmation with a sharp expected value (near zero, ref-count-independent) rather than an open
  question with an unbounded one.

### D13 — `AGENTS.md` needs no change; `docs/ARCHITECTURE.md:50` is already inaccurate and its wording is a human call (§11)

- **`AGENTS.md`:** its actual sentence is about *this environment* — "`go test`/`go build
  ./apps/kira-studio/internal/...` need nothing but the Go toolchain … so prefer
  `./apps/kira-studio/internal/...` for a fast loop". That remains true and unqualified after G9
  (D4). The parenthetical justification ("the product's own Go code is entirely cgo-free") is the
  imprecise part, and it was already imprecise before this phase (F6). **This plan does not edit
  `AGENTS.md`** — it is the orchestrating session's file and the change is a wording question, not
  an engineering one. §11 puts the proposed one-line wording in front of a human.
- **`docs/ARCHITECTURE.md:50`** — *"The whole product binary is cgo-free for its own code — only
  Wails' own macOS bindings still need `CGO_ENABLED=1`"* — is **already false** (`internal/secrets`,
  `internal/metrics`, `internal/localauth`). G9 adds a fourth package. Correcting it is a real
  documentation fix that belongs to whoever owns that file's accuracy; §11 proposes the wording and
  leaves the call.

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/internal/gitclient/`.

### 3.1 `watcher.go` — edited (D6, D7, D11)

| Symbol | Change |
|---|---|
| `Signal`, `SignalRefsChanged`, `SignalWorktreeChanged`, `debounceWindow` | **unchanged** |
| `refIshNames`, `stripLockSuffix`, `classify` | **unchanged** |
| `rawEvent`, `backend` | **new** — D6's struct and two-method interface |
| `resolveOrKeep(path string) string` | **new** — `filepath.EvalSymlinks`, falling back to the input (D7) |
| `RepoWatcher` | `fsw *fsnotify.Watcher` → `src backend`; gains `summary` already resolved (D7); `out`/`stop`/`done`/`closeOnce` unchanged |
| `NewRepoWatcher` | resolves the summary (D7), calls `newBackend(resolved.CommonDir, resolved.GitDir)`, logs D5's one line, starts `run` |
| `Signals`, `emit` | **unchanged** |
| `Close` | `close(w.stop)`, `<-w.done`, then `w.src.Close()` — same shape as today (`:146-152`), one field renamed |
| `run` | selects over `w.src.Events()`, `timerC`, `w.stop`. Per event: `if ev.Rescan { both = true } else { classify }`. The `armIfNeeded`/`fire` closures, the two booleans and the leading window are **unchanged** (`:182-238`) |
| `addRefsTree`, `maybeWatchNewRefsDir` | **moved** to `watcher_fsnotify.go` unchanged (they are fsnotify's recursion workaround, D6) |

The `fsnotify.Errors`/`ErrEventOverflow` arm (`:218-228`) moves into the fsnotify backend, which
translates it to `rawEvent{Rescan: true}` and keeps the existing `slog.Warn` for every other error.

### 3.2 `watcher_fsevents_darwin.go` — new, `//go:build darwin && cgo` (D5, D8, D9, D10)

**This file cannot be compiled, vetted or tested in this container (F8). It is written to be read,
not to be blessed by a compiler here.** It is deliberately the smallest file in the phase.

```go
//go:build darwin && cgo

// The macOS event source (G9). FSEvents watches a whole tree through one stream, so this backend
// holds no per-directory state and no file descriptor per ref — unlike the kqueue backend it
// replaces, which opens one descriptor per file in every watched directory (G2 F10). It cannot be
// compiled or exercised outside a real macOS toolchain (the same wall internal/localauth hit):
// read it for structure, and see G9 §7.2 for what a human must run on a Mac to confirm it.
package gitclient

const watcherBackend = "fsevents"

type fseventsBackend struct { /* es *fsevents.EventStream; out chan rawEvent; stopping, done chan struct{}; wg sync.WaitGroup; closeOnce sync.Once */ }

func newBackend(commonDir, gitDir string) (backend, error)
func (b *fseventsBackend) Events() <-chan rawEvent
func (b *fseventsBackend) Close() error
```

Contents, and nothing more:

1. **Path set** — `[commonDir]`, appending `gitDir` only when `gitDir != commonDir` and `gitDir` is
   not under `commonDir` (D8). Both arrive already resolved (D7).
2. **Stream construction and `Start()`** — D8's exact parameter table. A `Start()` error is returned
   to `NewRepoWatcher`, which returns it to `Registry.Acquire` — the existing failure path
   (`registry.go:90-93` already returns a watcher construction error).
3. **One forwarding goroutine** — `for batch := range es.Events { for _, ev := range batch { … } }`,
   emitting one `rawEvent` per event: `Rescan` when the flags carry
   `MustScanSubDirs|KernelDropped|UserDropped|RootChanged` (D9), otherwise `{Path: ev.Path}`. It
   does no classification and holds no lock.
4. **`Close()`** — D10's four-step sequence, `sync.Once`-guarded.

No other logic. Anything else that seems to belong here belongs above the seam.

### 3.3 `watcher_fsnotify.go` — new file, moved code, `//go:build !darwin || !cgo` (D5)

`const watcherBackend = "fsnotify"`, plus today's plumbing moved verbatim in behaviour:

- `newBackend(commonDir, gitDir)` — `fsnotify.NewWatcher()`, `Add(commonDir)`, `Add(gitDir)` when it
  differs, `addRefsTree(fsw, filepath.Join(commonDir, "refs"))`. Today's `IsLinkedWorktree` gate
  (`watcher.go:127-129`) becomes a plain `gitDir != commonDir` check — equivalent for every case
  `Identify` can produce, and the backend no longer needs a whole `RepoSummary`.
- `addRefsTree`, `maybeWatchNewRefsDir` — moved unchanged, except that `maybeWatchNewRefsDir` takes
  the `commonDir` string it needs rather than reading `w.summary`.
- One forwarding goroutine translating `fsnotify.Events` → `rawEvent{Path: ev.Name}` (calling
  `maybeWatchNewRefsDir` first, exactly as `watcher.go:209` does today) and
  `fsnotify.Errors` → `rawEvent{Rescan: true}` for `ErrEventOverflow`, `slog.Warn` otherwise.
- `Close()` — `fsw.Close()`, which closes `Events`/`Errors`, which ends the goroutine, which closes
  the `rawEvent` channel.

**Behavioural equivalence with today is the acceptance test for this file**, and it is checkable:
every existing `TestRepoWatcher_*` test in `watcher_test.go` must pass unchanged.

### 3.4 `watcher_test.go` — edited: everything kept, two tests added

**Kept unchanged**: `TestClassify` (both summaries, all sixteen cases), `TestStripLockSuffix`,
`TestRepoWatcher_CommitProducesRefsChanged`, `TestRepoWatcher_AddProducesWorktreeChanged`,
`TestRepoWatcher_BurstCoalesces`, `TestRepoWatcher_NewRefNamespaceSeenOnSecondUpdateToo`,
`TestRepoWatcher_Close_StopsSignals`, and the `awaitSignal`/`newWatcherFixture` helpers. All seven
run against the fsnotify backend here, as they do today, and their continued passing is what proves
§3.3's move is behaviour-preserving.

**Two added**, each meeting `AGENTS.md`'s bar and neither restating a short function body:

1. **`TestRepoWatcher_SymlinkedRepoStillClassifies`** — creates a fixture repo, makes a symlink to
   its parent directory, `Identify`s **through the symlink** so `CommonDir` is the unresolved path,
   starts a watcher, commits, and asserts `refsChanged` arrives. Without D7 this hangs, because the
   backend's own event paths are resolved while `classify`'s comparison target is not. It is the
   only automated check anywhere for the failure mode F9 describes, it is *partial* (Linux's
   symlink semantics are not macOS's `/private` prefixing, and only macOS actually forces the
   realpath) and §7.2 says so — but a partial guard on the phase's highest-risk decision is worth
   the twelve lines. Skipped on Windows-like platforms; this repo has none.
2. **`TestRepoWatcher_RescanRaisesBothSignals`** — drives `RepoWatcher` through an in-package **fake
   backend** (a `chan rawEvent` the test writes to), pushes one `rawEvent{Rescan: true}`, and asserts
   both `refsChanged` and `worktreeChanged` arrive, coalesced into one firing. This is the first
   test in the repo's history that can exercise D9/G2-D10's overflow rule at all — `ErrEventOverflow`
   is not producible on demand from a real inotify watcher — and it exercises it on **every**
   platform, including the FSEvents one, because the rule lives above the seam (D6). Requires an
   unexported `newRepoWatcherWith(summary RepoSummary, src backend) *RepoWatcher` that
   `NewRepoWatcher` also calls; it is a constructor split, not a test-only accessor.

**Not added**, deliberately: a test that asserts `watcherBackend`'s value. It would be a tautology on
whichever platform ran it. The backend identity is checked where it matters — in the startup log
line a human reads during §7.2's macOS run.

### 3.5 `go.mod` / `go.sum` — one new direct require (D1)

`github.com/fsnotify/fsevents v0.2.0` joins the direct require block. `github.com/fsnotify/fsnotify
v1.10.1` stays exactly where it is (`go.mod:13`). No indirect dependency is added — `fsevents`'
`go.mod` has no requires at all (F4).

The diff must be `go mod tidy`'s own output, never hand-edited. Note for the implementer: `go mod
tidy` considers all build configurations, so a dependency imported only from a `darwin && cgo` file
is kept, not pruned — verified in this container against the scratchpad probe.

---

## 4. Everything else is untouched — and that is an exit criterion, not an expectation

- **`internal/gitsession`, `internal/gitrpc`, `internal/gitsock`, `internal/bridge`, `main.go`: zero
  changes.** F2 establishes why for `gitsession`; the rest never referenced the watcher at all.
- **`packages/git-ui`, `packages/git-core`, `packages/git-ipc`, `apps/kira-studio-vscode`: zero
  changes.** SPEC's standing rule for `git-ui`, and there is nothing for the others to react to — the
  event, its payload and its timing are identical.
- **`CONTRACT_VERSION`: 16 on both sides**, unchanged (D11).
- **`bun run lint` / `bun run typecheck` / `bun run test:unit`: green and *unchanged*, not merely
  passing.** If any of them differs, something has drifted out of scope.
- **`internal/layering_test.go`: no exemption added.** `gitclient` is a domain package and stays one.

---

## 5. Implementation order

Three commits. `go build ./apps/kira-studio/internal/...` and `go test
./apps/kira-studio/internal/gitclient/...` run after **each** — they are fast and need nothing but
the Go toolchain. The scoped race run and the darwin cross-vet run once, at C3.

- **C1** `refactor(gitclient): put the repo watcher's OS event source behind a backend seam`
  — §3.1 + §3.3 + the two new tests in §3.4. **No new dependency, no darwin file, no behaviour
  change on any platform.** `fsnotify` is still the only backend that exists; it has simply moved
  behind `newBackend` and gained D7's symlink resolution and D9's `Rescan` vocabulary. Every existing
  watcher test must pass **unchanged** — that is this commit's entire acceptance criterion, and
  landing it alone means the risky commit that follows has a green, restructured baseline under it.
- **C2** `feat(gitclient): FSEvents repo watcher backend on darwin, replacing kqueue's per-ref fds`
  — §3.2 + §3.5. Adds `watcher_fsevents_darwin.go` and the `go.mod`/`go.sum` entry. **In this
  container this commit changes nothing that any test can observe**, by construction: the new file is
  excluded from every build here. The checks that apply to it are `gofmt -l`, `go build`/`go test`
  still green (proving the exclusion is correct), and the scoped `CGO_ENABLED=0 GOOS=darwin go vet`
  still green (proving the `!cgo` companion still satisfies the package). The commit message must
  say, in its body, that the file is unverified here and name §7.2 as the thing that verifies it.
- **C3** `test(gitclient): re-verify the watcher suite and the darwin cross-vet under the new seam`
  — the full §7.1 run, recorded. If C1 and C2 leave nothing to fix, this commit is the §7.1 evidence
  and nothing else; if it would be empty, fold its run into C2's message rather than inventing a
  change to commit.

Dependency order: C1 strictly before C2 — the seam must exist and be green before the file that
cannot be checked is written against it. C3 last.

---

## 6. What a reviewer should look at first

In order, because the risk is very unevenly distributed:

1. **`watcher_fsevents_darwin.go`'s `Device` field is zero** (F12 trap 1). If it is
   `fsevents.DeviceForPath(...)`, the watcher is silently dead on macOS.
2. **`NewRepoWatcher` resolves symlinks before both `newBackend` and `classify`** (D7/F9). If it does
   not, the watcher is silently dead on macOS.
3. **`Flags` includes `FileEvents`** (D8). If it does not, `refsChanged` and `worktreeChanged` become
   indistinguishable.
4. **`Close()` drains before it stops** (D10/F12 trap 3). If it stops first, macOS teardown can
   deadlock — including at app quit, where `Registry.Close()` tears down every entry.
5. **`internal/gitsession` has no diff at all** (F2/§4).

---

## 7. Exit criteria, and exactly how each is proven

The three tiers the prompt asks for, kept strictly apart. Nothing in tier 1 is evidence for tier 2 or
3, and the plan never implies otherwise.

### 7.1 Tier 1 — provable here, automatically, and expected green

**(a) `go test ./apps/kira-studio/internal/gitclient/...`** — real `git`, real fsnotify/inotify, no
Docker, no display.

- All seven existing watcher tests pass **unchanged**: the `classify` table (both summaries), the
  `.lock` strip, commit → `refsChanged`, `git add` → `worktreeChanged`, a 20-branch burst coalescing,
  a new `refs/heads/<ns>/` namespace seen on its *second* update too, and `Close` closing `Signals`
  idempotently. This is what proves §3.3's move is behaviour-preserving.
- `TestRepoWatcher_SymlinkedRepoStillClassifies` passes — a partial guard on D7 (§3.4 states the
  limit).
- `TestRepoWatcher_RescanRaisesBothSignals` passes — the first automated coverage of the
  overflow/dropped-events rule, and it covers the FSEvents path too because the rule is above the
  seam.

**(b) The scoped race run** (SPEC's "Full verification scope, 2026-09-07"):
`go test -race ./apps/kira-studio/internal/{gitclient,gitclient/porcelain,gitclient/catfile,gitclient/logsession,gitpreflight,gitops,gitsession,gitrpc,gitsock,gitstore,gitwire,bridge,bridge/rpcstream,}` —
green, and **`gitsession`'s and `gitsock`'s results unchanged**, which is the practical proof of F2's
"gitsession needs zero changes".

**(c) `CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/gitclient/... ./…/gitsession/... ./…/gitrpc/... ./…/gitsock/...`** — green (F7).
What this *does* prove: the package compiles for darwin; `watcher.go`'s platform-agnostic half
type-checks under `GOOS=darwin`; the `!cgo` companion satisfies every symbol `watcher.go` needs;
`newBackend`'s signature is consistent across implementations. What it **does not** prove: anything
about `watcher_fsevents_darwin.go`, which this configuration excludes by tag. Note the scoping:
unscoped, this command fails inside Wails and always has (F7).

**(d) `gofmt -l apps/kira-studio/internal/gitclient/` — empty.** This is the *only* check in this
container that reads `watcher_fsevents_darwin.go`'s bytes at all, and all it establishes is that the
file parses and is formatted.

**(e) `go build ./apps/kira-studio/internal/...` — green, and cgo-free**, i.e. `AGENTS.md`'s fast
loop is intact (D4). A quick confirmation that the darwin file really is excluded:
`go list -f '{{.GoFiles}}' ./apps/kira-studio/internal/gitclient` must not mention it.

**(f) `bun run lint` / `bun run typecheck` / `bun run test:unit` — green and unchanged** (§4).

**(g) `go test ./apps/kira-studio/internal/` — the layering test still passes**, with no exemption
added.

**(h) `go.mod`/`go.sum` diff is `go mod tidy`'s own output**, adding exactly
`github.com/fsnotify/fsevents v0.2.0` and its `go.sum` lines, and removing nothing.

### 7.2 Tier 2 — what can be checked here about the darwin file: essentially nothing, and this is not a hedge

**`gofmt` parses it. That is the complete list.** F8 records both cross-compilation attempts and their
exact output: `CGO_ENABLED=0` fails inside the dependency before reaching our file, `CGO_ENABLED=1`
fails in `runtime/cgo` with `clang: error: unsupported option '-arch'`. There is no `osxcross`, no
macOS SDK, and no plan to add one for one file.

Concretely, none of the following is known until a Mac runs it:

- that the file compiles at all;
- that `fsevents.CreateFlags`/`EventFlags` constants are spelled as this plan spells them;
- that `Event.Path` is absolute with `Device: 0` (F12 trap 1 is reasoned from the library's source
  and its test harness, **not** observed);
- that D10's teardown sequence does not deadlock;
- that `Start()` succeeds on a `.git` directory, or what it returns when it does not;
- that a `git commit` produces a classifiable path within the debounce window.

**An implementation report that claims a check here validated this file is wrong.** The correct
report is: "written, `gofmt`-clean, excluded from every build in this container, unverified."

### 7.3 Tier 3 — the macOS run, which is now the only thing that can close G8's ship blocker

To be run once on real hardware before G9 is called done. Steps 1–2 are correctness; step 3 is the
measurement that has been open since G2 F10.

1. **`go test ./apps/kira-studio/internal/gitclient/...` on macOS.** Not a weaker substitute for
   §7.1(a) — it is the *same* suite, on the backend that actually ships, and the first time any of
   it has ever run against FSEvents. All seven existing tests plus both new ones must pass. **The
   symlink test (§3.4) is the one to watch**: on macOS `t.TempDir()` is under `/var/folders`, so it
   exercises F9's real `/private` prefixing rather than Linux's weaker form.
2. **`go test -race -count=5 -run TestRepoWatcher ./apps/kira-studio/internal/gitclient/`** — five
   sequential runs, because D10's teardown ordering is the one piece of unverifiable logic with a
   real deadlock shape, and a start/stop cycle repeated is what surfaces it. A hang here is the
   expected failure mode, not a race report.
3. **The measurement — G8 §7.2 step 7, now with a sharp expected value.** On a repository with a
   deliberately large loose-ref set (`for i in $(seq 1 5000); do git branch b$i; done`, then
   **without** `git pack-refs`), open it in Kira Studio and record:
   ```
   lsof -p $(pgrep -f 'Kira Studio') | grep -c '/\.git/'
   find .git/refs -type f | wc -l
   sysctl kern.maxfilesperproc
   ```
   **Expected: the first number is small and does not scale with the second** — that is the whole
   claim (D12). G8's pre-G9 expectation was "roughly one per loose ref plus a handful"; if the number
   still tracks the ref count, the FSEvents backend is not the one running and step 4 will say so.
   Record all three in §12 alongside G8's own.
4. **Confirm the backend by name.** The app's log must contain `gitclient: repo watcher started …
   backend=fsevents` for the opened repository (D5). `backend=fsnotify` in a packaged build is a
   ship blocker: it means the darwin+cgo file was excluded, and step 3's number is meaningless.
5. **Two-window cross-invalidation still works** (G8 M1, re-run because the invalidation source
   changed underneath it): two VS Code windows on the **same** repository; a `git commit` made in a
   terminal must reach both, and a branch deleted in window A must be gone from window B's ref list.
   This is G8 F5's "the watcher is the only invalidation source" property, now on a new watcher.
6. **A new ref namespace, on FSEvents.** `git branch feature/brand-new` on a repository with no
   existing `refs/heads/feature/` directory, then `git branch -f feature/brand-new HEAD` — both must
   produce a `repo.changed`. On kqueue this needed G2 D10's on-`Create` directory walk; on FSEvents
   it should be free, and this is the step that confirms recursion actually behaves as F10 claims.
7. **A linked worktree.** `git worktree add`, open the linked worktree as a repository, and confirm
   its own `index`/`HEAD` changes produce events (F10's claim that `<commonDir>/worktrees/<name>` is
   covered by the single recursive root).
8. **Teardown under real use.** Open and close the same repository several times (VS Code window
   reload), then quit Kira Studio with repositories open, and confirm the process exits promptly and
   leaves no `git` child behind (`pgrep -fl git`) — D10's sequence in the two paths that actually run
   it, `Registry.expire` and `Registry.Close`.
9. **A `git gc` / large `git fetch` while a repository is open** — F10's noise case. The app should
   stay responsive and produce a small number of coalesced `repo.changed` events, not a flood.

### 7.4 The checklist

- [ ] `watcher.go` has no build tag and imports neither `fsnotify` nor `fsevents`.
- [ ] `classify`, `refIshNames`, `stripLockSuffix` and the debounce loop are unchanged.
- [ ] `NewRepoWatcher`/`Signals`/`Close` signatures are unchanged.
- [ ] `watcher_fsevents_darwin.go` is `//go:build darwin && cgo` and is the only file in the repo
      importing `github.com/fsnotify/fsevents`.
- [ ] `watcher_fsnotify.go` is `//go:build !darwin || !cgo` and is a real working watcher, not a stub.
- [ ] `watcherBackend` exists in both and is logged once per watcher at start.
- [ ] `Device` is zero; `Flags` are `FileEvents | WatchRoot`; `Latency` is 0; `Resume` is false.
- [ ] Symlinks are resolved once in `NewRepoWatcher`, and only the watcher's own copy of the summary
      is resolved — `RepoID`, `Root` and every wire/cache value stay unresolved.
- [ ] `Rescan` is raised for `MustScanSubDirs`/`KernelDropped`/`UserDropped`/`RootChanged` on darwin
      and for `ErrEventOverflow` elsewhere, and raises **both** signals.
- [ ] `Close()` drains, then stops the stream, then joins — and is idempotent.
- [ ] `internal/gitsession` has an empty diff. So do `gitrpc`, `gitsock`, `bridge` and `main.go`.
- [ ] No TypeScript, Vue or root-config file changed; `CONTRACT_VERSION` is still 16 on both sides.
- [ ] `go.mod` gains exactly one direct require and keeps `fsnotify`.
- [ ] §7.1(a)–(h) all green.
- [ ] The commit message for C2 says the darwin file is unverified in this container.
- [ ] §7.3's nine macOS steps all pass, and step 3's three numbers are recorded.

---

## 8. Sequencing — one implementer, sequential

**Recommendation: one sequential Sonnet subagent for the whole phase.**

The phase is three commits in one package. There is no independent second lane: C2 is written against
C1's seam, and the only two files that could plausibly be split (`watcher_fsevents_darwin.go` and
`watcher_fsnotify.go`) are the two implementations of the *same* interface — the exact case
`AGENTS.md` names as not genuinely independent. Splitting them across agents would also put the
unverifiable file in a head that never compiled the seam it implements, which is the worst possible
allocation of this phase's one real risk.

Two instructions to carry into the implementing prompt, because a fresh subagent starts cold and both
are counter-intuitive:

1. **`watcher_fsevents_darwin.go` cannot be verified in this container, and no amount of flag-tweaking
   will change that** (§7.2, with F8's exact command output). An agent that spends its budget trying
   to make `GOOS=darwin go vet` cover it is burning time on something this plan already established
   is impossible — and, worse, might "fix" it by weakening the build tag.
2. **A green test run after C2 proves the darwin file was correctly *excluded*, not that it is
   correct.** Report it that way.

---

## 9. Explicit non-goals for G9

| Not in G9 | Owner |
|---|---|
| A recursive worktree watch, and any `status.get`-driven refresh decision that depends on one | G4's question, still open (G2 §10) |
| Removing G8 D7's `invalidateAfterWrite` second line of defence | nobody — it stays |
| Tuning `Latency`, `debounceWindow`, or the four-slot read pool | §10, on evidence from §7.3 |
| Changing what P-i measures, or making it a real fd proxy | impossible (F14); it stays as the Linux inotify record it is |
| Any wire/contract change, any `CONTRACT_VERSION` bump | D11 — and a bump is a signal to stop, not to proceed |
| Editing `AGENTS.md` or `docs/ARCHITECTURE.md` | §11, a human call |
| Editing `docs/v1.3/SPEC.md`, or retro-editing G2's or G8's plan docs | house rule; this plan is the record |
| A Linux/Windows FSEvents equivalent, or dropping `fsnotify` | D1 — fsnotify is the non-darwin backend and stays |
| Shipping, `.vsix` packaging, DMG bundling | G10 |

---

## 10. Handed forward

- **`Latency: 0` is a parity choice, not a tuned one** (D8). A small non-zero FSEvents latency (say
  25–50 ms) would coalesce in the kernel before our own debounce and cut callback churn during a
  `git gc` or a large `fetch` (F10's noise case). It adds to the total signal delay, which G8 measured
  at ~210 ms. **Whichever phase next has a real macOS profile in front of it** — realistically G10's
  own acceptance run — can revisit it; changing it on this container's evidence would be exactly what
  SPEC's own "re-measurement, not re-derivation" note warns against.
- **The FSEvents 4096-watched-paths-per-process limit is now the resource ceiling** (F13), at one path
  per open repository. It is far out of reach (it would take 4096 simultaneously-open repositories),
  but it is the number that replaces `kern.maxfilesperproc` in this design's failure story, and any
  future phase that watches something *else* per repository — a worktree tree, a submodule set —
  spends against it. Worth naming in whatever the next phase's own resource discussion is.
- **`docs/ARCHITECTURE.md:50`'s cgo claim is stale and now four packages wrong** (F6/D13). Unowned;
  §11 puts it in front of a human.
- **The `Rescan` path has automated coverage for the first time** (§3.4), but only for the *rule*.
  Whether FSEvents actually raises `MustScanSubDirs` under realistic load, and how often, is
  observable only on macOS and is not measured by §7.3. If a future phase ever sees spurious
  full-refresh storms, that flag is the first thing to log.
- **G2 §10's own hand-forward — *"if the number is uncomfortable the fix is a `git pack-refs`-aware
  strategy … that `fsnotify` cannot express today and would need a different watcher"* — is
  discharged by this phase**, and by a better route than the one it imagined: FSEvents needs no
  pack-refs awareness at all, because it never costs anything per ref. Recorded here so a later reader
  of G2 §10 does not go looking for a strategy that no longer needs to exist.

---

## 11. Two things that want a human call, not an engineering one

**(a) `AGENTS.md`'s cgo sentence.** Today it reads:

> **`go test ./apps/kira-studio/internal/...` / `go build ./apps/kira-studio/internal/...` need
> nothing but the Go toolchain** — the product's own Go code is entirely cgo-free
> (`modernc.org/sqlite` for both the sqlite adapter and the app's own storage). Only the
> `apps/kira-studio` `main` package imports Wails and needs the GTK/WebKit headers…

The *operative* claim (the fast Linux loop) stays true after G9 (D4). The *justification* is already
wrong today — `internal/secrets`, `internal/metrics` and `internal/localauth` are darwin+cgo (F6) —
and G9 makes it a fourth. Proposed replacement for the middle clause, if the orchestrator wants it
tightened:

> — every Go package this loop compiles **on Linux** is cgo-free (`modernc.org/sqlite` for both the
> sqlite adapter and the app's own storage). Four packages have `darwin && cgo` files that a Linux
> build never sees — `internal/secrets`, `internal/metrics`, `internal/localauth`, `internal/gitclient`
> — each with a `!darwin || !cgo` companion so `CGO_ENABLED=0 GOOS=darwin go vet` still type-checks.

**This plan does not make that edit.** `AGENTS.md` is process/environment and belongs to the
orchestrating session; it is also `AGENTS.md`'s own rule that a phase's discovery belongs in the
phase's plan doc, which is where it is. The call is: tighten it, or leave it and accept that a future
reader may take the literal reading at face value.

**(b) `docs/ARCHITECTURE.md:50`.** *"The whole product binary is cgo-free for its own code — only
Wails' own macOS bindings still need `CGO_ENABLED=1`."* This is an app fact, so it does belong in
that file, and it is **already false** — independently of G9. Fixing it is a genuine correction and
not this phase's invention; whether G9's implementing subagent should make it, or whether it belongs
to whoever owns that document's accuracy, is a call for the orchestrator. If the answer is "make it",
it is one sentence and belongs in C3.

Neither is a blocker. Both are recorded because a plan that silently widened an invariant the repo's
own documentation still claims would be exactly the kind of thing this chapter's other plans have
refused to do.
