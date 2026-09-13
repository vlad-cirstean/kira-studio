# G33 — Docs update: the v1.3 chapter's closeout

> **Phase row (SPEC.md:346), abbreviated:** the root `README.md` (silent on git), `docs/ARCHITECTURE.md` (git as a real, shipped subsystem — transport, session model, package list), `CLAUDE.md` (new environment/convention notes), and this chapter's own `Known open items` / `Out of scope` sweep. Explicitly **not** in scope: `docs/v1.3/plans/G<N>-*.md`. **No new code.**

> **Run out of order, by explicit instruction.** Normally G33 depends on G30–G32. The user asked for this docs phase **first**; the three review rounds run later, in a separate pass. HEAD is `2c092795`; **G1–G29 are shipped, merged and verified** and are treated as ground truth throughout. Two parts of the row's scope are therefore only *partially* completable now and are handed forward explicitly in §6 — nothing in this plan guesses at what a future review round might find.

---

## 0. Scope, in one table

| In scope now (G1–G29 ground truth) | Out of reach this pass |
|---|---|
| `README.md` — the git module gets its own feature section, plus requirements/scripts/tests/layout/docs sweeps | — |
| `docs/ARCHITECTURE.md` — a new `## Git module (v1.3)` section (transport, session model, package list), plus Storage/Process-model/Testing/bound-service integration | — |
| `CLAUDE.md` — the durable environment facts G1–G29 actually produced, plus a chapter-pointer staleness sweep | The review rounds' own notes (G30–G32 haven't run) |
| `docs/v1.3/SPEC.md` — `Known open items` and `Out of scope for v1.3` swept against what **G1–G29** closed | Anything only G30–G32 would close |
| `docs/PERF.md` — one new `§2.13` recording G3/G8's transport re-baseline (see §3.5 for why this is in scope, not creep) | Real-hardware macOS numbers (§3 has never been run) |
| — | `docs/v1.3/plans/G<N>-*.md` — historical records, untouched |
| — | Any `.go`, `.ts`, `.vue`, `.sql`, `.json` file |

---

## 1. Findings

### 1.1 `README.md` (316 lines) — the SPEC row's claim is correct, and there is collateral drift

**The claim holds exactly.** `## Studio features` (`:69–118`) and `## Api features` (`:120–138`) exist; there is no git section. A grep of the whole file for `git`/`Git`/`VS Code`/`v1.3` returns **eight hits, none of them about the git module**: the CI badge URL (`:3`), a ClickHouse driver URL (`:60`), the VS-Code-*flavoured* keyboard set (`:111`), a Colima URL (`:149`), `git clone` (`:157`), the `.githooks/` pre-commit paragraph (`:212–214`), and `gitignored` in the layout block (`:265`). The module — its socket, its extension, its `.vsix`, `review.db`, the *Connected editors* pane — appears nowhere.

**The house style to match**, read off the two existing sections: an `## X features` heading; a flat bullet list; each bullet opens with a **bolded noun phrase** followed by an em dash and one to three sentences of concrete, honest prose that names real limits (`README.md:86–87` "These writes execute immediately against the server, with no staging or preview"; `:133–134` "with a 'only the last 30 are kept' notice once older ones roll off"). Studio additionally carries a short "A couple of things worth knowing up front" list after its table (`:62–67`). Studio gets 16 bullets, Api gets 7 — a git section of ~11 sits correctly between them.

**Collateral drift found while reading, all of it inside sections this phase already opens:**

| Line(s) | Drift | Evidence |
|---|---|---|
| `:11–14` | Status says Api "is in active development as the v1.2 chapter" | `docs/v1.3/SPEC.md:3` — "v1.2 **built** the Api module"; v1.3 is the live chapter |
| `:60` | "Uses `github.com/ClickHouse/clickhouse-go/v2` — a native Go adapter" | **No such dependency exists.** `grep clickhouse-go go.mod` → nothing; `docs/ARCHITECTURE.md:224–231` is authoritative: a hand-rolled `net/http` client with **no driver dependency at all** (P58b M6.4) |
| `:194` | "`bun run typecheck` — Runs the three splits below" | `package.json` runs **five** (`:tests`, `:web`, `:unit`, `:api-core`, `:git`) |
| `:187–206` | Script table missing 6 real scripts | `typecheck:api-core`, `typecheck:git`, `build:vscode`, `package:vscode`, `test:webview`, `test:matrix` |
| `:198` | `test:unit` described as `apps/kira-studio/tests/unit` only | It now also runs `packages/{api-core,git-core,git-ipc,git-ui,kira-ui}` and `apps/kira-studio-vscode/src` |
| `:208–210` | App data lists only `kira.db` and `logs/` | `~/.kira-studio/` now also holds `review.db`, `git.sock`, `git.sock.lock` (`main.go:145–146`) |
| `:218` | "Four TypeScript suites" | A fifth exists: `apps/kira-studio-vscode/tests/{layout,interaction}`, two Playwright projects |
| `:263–274` | Layout block omits `apps/kira-studio-vscode`, `packages/git-{ipc,core,ui}`, `packages/kira-ui`; says "docs/v1.2 is the live record" | `ls apps/ packages/`; `docs/v1.3/` is live |
| `:290–297` | Documentation list has no `docs/v1.3/` entry | — |
| `:303–312` | "Not shipped" names no git-side non-goal | `docs/v1.3/SPEC.md:439–442` |

### 1.2 `docs/ARCHITECTURE.md` (2283 lines) — the git module is effectively **absent**, not "described as a plan"

Read in full. A grep for `git|Git|vsix|VS Code|rpcstream|v1\.3` across all 2283 lines returns **exactly two substantive hits**, both incidental sub-clauses inside rows about something else:

- **`:36`** (Stack, *Packaging* row): "The `.dmg` also carries `Contents/Resources/kira-version.vsix` (the packaged VS Code extension, `@vscode/vsce`, G10) — copied in before the ad-hoc sign so the signature covers it — installed from the *Connected editors* pane's own 'Install VS Code Integration' button (`internal/gitvsix`)".
- **`:53`** (the driver-libraries paragraph): "and — as of v1.3's G9 — `internal/gitclient`'s FSEvents-backed repo watcher) use cgo for real OS integrations".

Everything else is a false positive (`VS Code Dark Modern` tokens `:30`, `git-ignored` bindings `:1810`, Go module paths). So the module is **not** described as a plan — it is simply not described at all. A reader arriving from `:36` learns a `.vsix` is bundled and has no way to find out what it is for.

**What the file's own register requires**, read off how Api and Studio are documented:

- **Depth:** Api gets a dense multi-paragraph treatment inside `## UI architecture` (`:1146–1163` the three-directories/one-package/four-Go-packages paragraph; `:1166–1174` a five-row "every couple that would block splitting this out" audit table). Studio's engine layer gets `## Adapter contract` (`:97–156`) plus a per-engine section each.
- **Voice:** decisions are stated with their reason and their alternative — "Not a shared library, on purpose — a template engine like Handlebars or Mustache HTML-escapes by default, which would corrupt a JSON/XML body" (`:1304–1306`); "a permanent, honest `false`" (`:124`); "recorded as a loss rather than mitigated" (`:2076`). **Nothing is marketing.** Losses are named.
- **Anchors:** real identifiers, real file paths, real numbers.
- **Section granularity:** `##` for a subsystem (`Storage`, `Caching`, `Process model`, `Testing`), `###` beneath it.

**Structural staleness found, adjacent to what this phase touches:**

| Line | Stale | Correct |
|---|---|---|
| `:1942` | "registers **fifteen** bound services under `internal/bridge/`" and enumerates them | `main.go:317–338` registers **22**; six are v1.2's (`GrpcService`, `CollectionsService`, `VariablesService`, `ResponseHistoryService`, `GrpcHistoryService`, `DataGripService`) and one is v1.3's `GitClientsService` |
| `:1772` | "**Two processes**: the webview … and the Go shell" | True of Studio/Api; the git module adds a third process over a second transport |
| `:2182` | "Its `workflow_dispatch` CI workflow is written and staged, not live (`CLAUDE.md`'s Known open items)" | **Dead pointer** — `CLAUDE.md:124–135`'s Known open items holds only the window-clamp item. The staged file is `docs/pending-workflows/test-matrix.yml` |
| `:2129` | "Four suites, under `apps/kira-studio/tests/`" | A fifth exists under `apps/kira-studio-vscode/tests/` |
| `:542–603` | The `kira.db` schema block | Missing `git_clients` (migration `0016_g1_git_clients.sql`) and `git_repo_settings` (`0017_g18_git_repo_settings.sql`) |
| `:849–865` | The "every table is growth-bounded" table (headed "all nineteen tables") | Two tables added since; the table needs both rows |
| `:11–13` | "Where this file and `docs/v1/SPEC.md` disagree…" | Four chapters exist now |

### 1.3 `CLAUDE.md` (300 lines) — the precedent notes, and what G1–G29 genuinely produced

**The two precedents the SPEC row names.** The `docs/pending-changes/` note is **`CLAUDE.md:105–122`**, its own `##` section titled "`.github/workflows/` changes can't be pushed from here" (commit `78653447`). The "verification-scope" note is **not** in this file — it is `docs/v1.3/SPEC.md:351–364`, "**Full verification scope, 2026-09-07**". So "same spirit" means: *a durable, mid-chapter operational rule, written where it belongs, in the host document's own register* — not "both live in CLAUDE.md".

**The file's own governing rules, which constrain what may be added (`:1–5`, `:96–103`):**
- *"Facts about the app itself — driver choices, protocol constraints, capability quirks — live in `docs/ARCHITECTURE.md`, not here. This file is process and environment only."*
- *"Keep this file lean — prune as you go, don't just append… a phase or review round's discovery belongs in that phase's plan doc… Before adding a bullet, ask whether it's a standing rule for how this team works, not a one-off result. When you touch this file, remove what's gone stale too."*
- *"'Known open items' is the one durable exception — keep an item only while genuinely open, delete it the moment it's resolved rather than marking it done in place."*

**Candidates assessed against that bar:**

| Candidate (source) | Verdict |
|---|---|
| **`CGO_ENABLED=1 GOOS=darwin` cannot cross-compile here** — `clang: error: unsupported option '-arch'` inside `runtime/cgo`; `CGO_ENABLED=0 GOOS=darwin GOARCH=arm64` succeeds (G29 plan `:7`, `:33–34`, `:177–178`, measured, not reasoned) | **ADD.** A durable environment fact about *this container*, with a real design consequence (it is why `startupfail` is pure-Go `osascript` rather than a cgo `NSAlert`). Textbook `CLAUDE.md` content |
| **Running/testing the git module here** — the git Go tests need only a real `git ≥ 2.38` on `PATH` and a `t.TempDir()` (no Docker, no display); `KIRA_HOME` scopes the *socket* as well as the DB; the perf probes are `KIRA_GIT_PERF=1` and assert nothing; FSEvents is `darwin && cgo` so Linux runs the `fsnotify` companion; `test:webview` needs no VS Code and no `xvfb` | **ADD**, as one new `##` section, mirroring the existing per-topic sections (`Docker`, `tests/ipc/`, `ClickHouse`, `SQLite`, `Secrets`, `Wails v3 / Go`) |
| **`internal/gitclient` belongs in the `darwin && cgo` package list** (`CLAUDE.md:262`) | **ADD** (one identifier into an existing list) — `docs/ARCHITECTURE.md:53` already names it; `CLAUDE.md` says only "any package that later follows the same pattern" |
| **Chapter pointers are stale** — `:12–13`, `:33`, `:98` all say `docs/v1.2/SPEC.md` / `docs/v1.2/plans/`; `:46` says "One feature branch for all of v1" | **FIX.** This is precisely the file's own `:100–102` instruction ("remove what's gone stale too — a pointer to a deleted file/subsystem") |
| G27's NFC tier-1/tier-2 rule; G28's `refs/kira/*` namespace; G23's conformance-corpus twin rule; G16's rendered-box-height guard | **DECLINE for `CLAUDE.md`.** Every one is a *fact about the app*, which `CLAUDE.md:3–5` explicitly routes to `docs/ARCHITECTURE.md`. All four are in this plan's ARCHITECTURE additions instead |
| Review-round findings | **Cannot be done** — G30–G32 have not run (§6) |

**`CLAUDE.md`'s own `Known open items` (`:124–135`)** holds one item: the first-launch window-size clamp (P22 D6(a)). **Still genuinely open.** G29 touched `main.go`'s boot sequence for *failure alerts*; it did not defer startup window creation past `ApplicationDidFinishLaunching`, which is what closing it needs. **Keep verbatim.**

### 1.4 `docs/v1.3/SPEC.md` — the two sections, item by item

#### `## Known open items` (`:444–453`)

**Item 1 — "RE2 vs. JS `RegExp` in search (G23)" (`:446–450`). RESOLVED by G23.**

The item asked for "a byte-boundary post-check implementation in `gitsearch` rather than a direct pattern port". What actually shipped is *stronger* than what the item specified, and `internal/gitsearch/doc.go` documents it as a **three-tier posture**:

1. **Literal mode** (`literal.go`) runs *no regex engine at all* — occurrence enumeration plus a byte-level word-boundary post-check, "byte-exact to JS by construction, not by coincidence".
2. **Regex mode** (`dialect.go`) *translates* seven constructs into RE2 (`.`, `\s`/`\S`, `\p`/`\P`, `\uXXXX`/`\u{…}`, `\cA`-`\cZ`, bare `\0`, unknown identity escapes), and applies whole-word as a **consuming rewrite**, explicitly because "a post-check disagrees with JS's own backtracking-into-a-different-alternative behaviour on a pattern like `foo|foobar`" — i.e. the item's own suggested fix was found insufficient and improved on.
3. What RE2 genuinely cannot express is **refused as data** — `ErrUnsupportedPattern` → `{kind: "unsupportedPattern"}` — so the item's stated failure mode ("a hit's presence depends on which page happens to be loaded") is structurally impossible. `doc.go` cites `docs/v1.3/SPEC.md:446-450` at that exact line.

Both matchers are pinned by one shared corpus, `packages/git-core/testdata/searchConformance.json`, read by `conformance_test.go` (Go) and `conformance.test.ts` (TS). Two divergences are knowingly accepted and recorded in `doc.go` (regex-mode case folding is RE2's `(?i)` not ECMA-262 `Canonicalize`; `[\S]` *inside* an open class falls back to RE2's ASCII `\S`) — recorded, not open.

→ **Delete the item.** Its substance moves to `docs/ARCHITECTURE.md`'s git section, which is where an app fact belongs.

**Item 2 — "Perf budgets need re-measurement, not re-derivation… in G3 and G8" (`:451–453`). RESOLVED by G3 and G8. Not stale — genuinely done.**

(Note: these are **v1.3's** G3 and G8, both shipped, not v1.1 phases.) `TestGraphStreamPerf` exists at `internal/gitsock/graphstream_test.go:593` (G3); `TestG8PerfBaseline` at `internal/gitsock/perf_test.go:71` (G8), nine subtests. Both are gated `KIRA_GIT_PERF=1` + `!testing.Short()` + `git` on `PATH`, and **assert nothing** by deliberate decision (G8 D12: "a hard assertion in a suite that also runs on real macOS hardware would be flaky in exactly the way that note warns against").

The numbers were recorded in commit `5729795d`'s message — the durable record `CLAUDE.md:43–45` names — and G8's plan `§12` was left with pre-phase figures only, because that session was instructed not to edit its own plan doc ("flagged for the orchestrator to carry over"). **That carry-over never happened.** The measured results:

```
P-a graph.stream, 1 conn:          n=20000 chunks=10 firstChunk=218ms total=220ms meanBytes/chunk=42167
P-b graph.stream, 2 conns/1 repo:  A firstChunk=230ms total=232ms; B 233ms/235ms; wall=235ms
P-c graph.stream, 2 conns/2 repos: n=8000 A 106ms/110ms; B 110ms/110ms; wall=110ms
P-d commit.detail x50:             solo mean=6.05ms p95=7.01ms; two-conn mean=0.097ms p95=0.178ms
P-e large patch/blob:              fileDiff 282B in 97ms; file.read 1.48MB (raw 1.44MB) in 49ms
P-f ranged walk, 200 commits:      total=9.5ms   (upstream budget <=300ms)
P-g chunk-size distribution, 20k:  min=42156 mean=42167 max=42272 p99=42156 bytes
P-h watcher fan-out latency:       1/2/8 connections all ~203-204ms (the 200ms debounce, not fan-out)
P-i inotify watches, 2000 refs:    4 watches (Linux proxy only)
```

The budget holds with margin on every probe. G8 F12 additionally establishes the structural finding: **`firstChunk ≈ total`** — a whole `logsession.DefaultPageSize = 5000` page is read and parsed before the first chunk is emitted, so first paint is bounded by `git log` + parsing, *not* by the socket or by FlatBuffers.

→ **Delete the item**, but **only together with §3.5's `docs/PERF.md` §2.13**, which is where a measured number belongs (`docs/PERF.md:5–9`: "the numbers recorded from a real run… this file is the living one"). Deleting the item without relocating the numbers would lose the only non-commit-log record.

#### `## Out of scope for v1.3` (`:433–442`)

| Bullet | Verdict |
|---|---|
| **1 — Marketplace/OpenVSX publishing** (`:435–438`) | **Accurate, needs tense.** G10 shipped: `bun run package:vscode` → `kira-version.vsix`, copied to `Contents/Resources/` pre-signature (`docs/ARCHITECTURE.md:36`), installed by `internal/gitvsix` from the *Connected editors* pane. The clause "P12… and P14… are G24 and G25, added 2026-09-07 specifically so upstream's incomplete phases don't ship unfinished here too" is **confirmed accurate and now past-tense**: `ghclient/pr.go` + `gitrpc`'s `branch.resolvePr`/`commit.resolvePr` (G24), `gitops/worktree.go` + `gitprepare` + `worktree.{list,prepare,cancelPrepare}` (G25) all shipped |
| **2 — no embedded git UI in the Wails frontend** (`:439–440`) | **Still out of scope and still true**, but now *imprecise*: the Wails window does have two git surfaces — `SettingsDialog.vue:102`'s `'Connected editors'` and `'Git'` sections. Both were always intended (SPEC `:52–53`); the bullet should say so, or a reader will read it as violated |
| **3 — "Redesigning the extension's UI around native VS Code surfaces… the existing webview UI ships as-is"** (`:441–442`) | **⚠️ QUIETLY UN-SCOPED. This is the one the sweep exists to catch.** The webview UI did *not* ship as-is: **G12** moved every review diff out of the webview into VS Code's own diff editor; **G14** added *Go to file* / *Open in graph* to that native diff toolbar; **G15** rebuilt range-level review marking as gutter decorations/CodeLens *in the native diff editor*; **G12/G14/G19/G21** restyled the webviews onto this app's own components, producing a whole new `packages/kira-ui` (10 `Kui*` components). What genuinely stayed out of scope is narrower: replacing the **graph and review panels themselves** with native tree views/quickpicks. Both are still webviews (`apps/kira-studio-vscode/package.json` → `views.kiraVersion[0].type: "webview"`, `views.kiraVersionReview[0].type: "webview"`). **Must be rewritten** |

No other bullet in the section was un-scoped by a later phase.

### 1.5 The tree, as ground truth for the ARCHITECTURE additions

Every fact below was read from source, not from a plan doc.

**Go packages** (`apps/kira-studio/internal/`): `gitclient` (+ `porcelain`, `catfile`, `logsession`), `gitpath`, `gitstore`, `gitpreflight`, `gitops`, `gitsearch`, `gitreview`, `gitsession`, `gitrpc`, `gitsock`, `gitwire`, `gitaskpass`, `gitprepare`, `gitvsix`, `ghclient`, `startupfail`, `bridge/rpcstream`, `bridge/gitclients.go`. **Note: five of these do not appear in SPEC's own §2 package table** — `gitpath` (G27), `gitprepare` (G25), `gitvsix` (G10), `startupfail` (G29), and `gitsearch`'s final shape. The ARCHITECTURE table below is built from the tree, not from SPEC.

**Transport:** `main.go:145–146` → `${KIRA_HOME}/git.sock` + `git.sock.lock`; listener error is `slog.Warn`, never fatal (`:164`). `gitrpc/contract.go:107` `ContractVersion = 30` ≡ `packages/git-ipc/src/validate.ts:97` `CONTRACT_VERSION = 30`, asserted in `gitsock/stash_test.go:48`. `packages/git-ipc/schema/gitwire.fbs` — `file_identifier "KIG1"`, one `Frame` → `Payload` union → `PackedCommitChunk`, append-only. `gitsock/handshake.go:83,90,121` — `versionMismatch` on both protocol and contract, then `pairingRequired`. `gitsock/pairing.go:13–15` — `pairingTimeout = 120s`, `pairingCooldown = 60s`.

**Session model:** `gitsession/registry.go` package doc (imports `gitclient`, `gitpreflight`, `gitreview`, `ghclient`, stdlib only — no bridge, no rpcstream, no gitsock); `defaultLingerFor = 5 * time.Minute`; `RepoID` = the absolute git dir. `gitsession/entry.go` — `RepoEntry` holds `Repo` + gate, `watcher`, `subs`, `catfile`, `detail`/`diff`/`refs`/`stack` caches, `head`, `undo`, `rangeCount`. `gitclient/watcher_fsevents_darwin.go` + `watcher_fsnotify.go`.

**Storage:** `0016_g1_git_clients.sql` (`token_hash`/`token_salt`, epoch-ms timestamps, comment: "only the salted hash of its token is ever stored, never the plaintext"); `repos/gitclients.go:79–83` — `Revoke` sets `revoked_at`; a re-pair upsert clears it (`:52`, `:61`), so rows are never deleted. `0017_g18_git_repo_settings.sql` — `(repo_id, key)` PK, `repo_id = ''` reserved sentinel. `gitreview/migrations/0001_g11_review.sql` + `0002_g13_comments.sql` — `review_session` / `review_file` / `review_range` / `review_comment`; `gitreview/store.go:11–14` — the file is neither created nor opened until first use.

**Surface:** 46 RPC methods in `gitrpc/handlers.go`; 46 contributed commands in the extension manifest; `contributes.configuration` has **zero properties**; views are `kiraVersion.graph` (panel, "Git Graph") and `kiraVersion.review` (activity bar, "Kira Version"); `engines.vscode: ^1.134.0`. `gitclient/discovery.go:19` `RequiredVersion = "2.38.0"`, `:63–90` the CLT-shim gate. `gitops/stash.go:119–126` `GlobalStashRefPrefix = "refs/kira/globalstash/"` + "Every `refs/kira/` string anywhere in this codebase must be built from this constant"; `porcelain/log.go:52` `--exclude=refs/kira/*` unconditional.

---

## 2. Approach

Four principles, so the implementer needs no further judgement calls:

1. **Write in each host document's own voice**, not in SPEC.md's planning voice. SPEC prose ("this chapter", "a stepping stone", "designed so that…") is forward-looking; ARCHITECTURE is present-tense and authoritative. Nothing below is copy-pasted from SPEC.
2. **Anchor every claim to the tree**, with real identifiers and real numbers, as §1.5 does.
3. **Name losses and limits**, matching `docs/ARCHITECTURE.md`'s established posture (`:2062–2063`, `:2076`).
4. **Delete, don't annotate.** A resolved open item is removed; its substance is relocated to the document whose charter owns it.

---

## 3. Decisions — the exact text

### 3.1 `README.md`

---

**R1 — Status bullet.** Replace `:11–14`:

```markdown
- **Beta.** The database client (**Studio**) shipped through its v1.1 chapter and the API client
  (**Api**) through v1.2. The git client is the v1.3 chapter and is **headless**: the git backend
  runs inside this app, and its frontend is **Kira Version**, a VS Code extension bundled in the
  DMG. Expect bugs and breaking changes between builds. See [Development](#development) and
  [`docs/PACKAGING.md`](docs/PACKAGING.md) to build from source.
```

---

**R2 — ClickHouse footnote correction.** Replace the last sentence of footnote ⁴ (`:59–60`):

> Uses `github.com/ClickHouse/clickhouse-go/v2` — a native Go adapter, no sidecar (P58b M6.4).

with:

```markdown
Uses a hand-rolled `net/http` client reading ClickHouse's own
`JSONCompactStringsEachRowWithNamesAndTypes` format — a native Go adapter with **no driver
dependency at all**, and no sidecar (P58b M6.4); see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s ClickHouse section.
```

*Why here:* the claim names a dependency the repo does not have (`go.mod` has no `clickhouse-go`), directly contradicting `docs/ARCHITECTURE.md:224–231`. `CLAUDE.md:100–102` asks a doc-touching pass to remove what has gone stale.

---

**R3 — the new section.** Insert in full after `:138` (end of `## Api features`), before `## Requirements`:

```markdown
## Git features (Kira Version)

Git is the third module, and the only one that isn't in this window. The backend runs inside Kira
Studio — spawn discipline, porcelain parsing, the paged log walk, pre-flight hazard analysis, every
write — and the frontend is **Kira Version**, a VS Code extension that dials a Unix socket at
`~/.kira-studio/git.sock`. Kira Studio's own window gets no git mode, tab or panel; its only
git-facing surfaces are a *Connected editors* pane and a *Git* section in Settings. The `.vsix`
ships inside the DMG rather than through the Marketplace, and installs from a button on that pane.

- **Commit graph** — a virtualized, lane-drawn log over the whole ref set, paged and streamed from
  the backend as binary FlatBuffers chunks; per-lane ref badges, a checked-out-HEAD indicator, and
  in-graph search.
- **Commit detail and diffs** — file tree, per-file and whole-commit diffs, blob reads, and a
  line-mapped **Go to file** that works on historical content not checked out on disk.
- **Refs, checkout and history rewriting** — branches and tags (create/rename/delete, local and
  remote), checkout, revert, reset in all three modes, cherry-pick, plus an in-progress banner with
  Continue/Abort/Skip for a merge, rebase or cherry-pick left mid-flight.
- **Pre-flight, computed in Go** — every hazardous operation is classified server-side before it
  runs (uncommitted work, a detached `HEAD`, a protected branch, a conflicting pop) and the verdict
  crosses as data, so the editor never re-derives it. A single-slot **undo** covers the last
  undoable operation per repository, labelled with the window that ran it.
- **Remote operations** — fetch, push, force-with-lease, a decomposed pull with a strategy picker,
  background auto-fetch, and real cancellation. A credential prompt is relayed into the VS Code
  window that owns the operation, through an askpass broker that fails rather than hangs.
- **Stash** — the full stack (push/apply/pop/drop/branch-from-stash) with `merge-tree`-based pop
  prediction, plus branch-scoped extras: auto-stash on checkout tagged with the branch it came
  from, cross-branch apply, and a reusable global stash kept under this app's own `refs/kira/*`
  namespace, which never appears in your graph.
- **Branch review** — a base resolver and a ranged walk, with **incremental review state**: what
  you last reviewed is kept per file as a compressed content snapshot, not just a commit sha, so a
  rebase, squash or amend still diffs correctly. Range-level marking happens in VS Code's own diff
  editor. A flat list of file/line **AI review comments** exports as plain text to paste into a
  chat — deliberately a copy-paste workflow, not a live integration.
- **Search** — a cancellable server-side `git log` tail scan paired with a client-side scan of
  already-loaded rows. Go's RE2 and JavaScript's `RegExp` are reconciled explicitly rather than
  approximated: a literal query runs no regex engine at all, a regex query is translated construct
  by construct, and what RE2 genuinely cannot express (lookaround, backreferences) is refused as a
  named result rather than silently mismatched.
- **Worktrees and stacked branches** — `git worktree` create/list/switch/remove with an optional
  per-repository prepare script you approve once, and stacked branches with restacking and stack
  navigation.
- **GitHub PR links** — resolved **per commit**, not per branch tip, so the indicator shows on a
  commit in the middle of a branch's history or in a detached `HEAD`, not only on a checked-out
  tip. Authentication is delegated entirely to the `gh` CLI already on your machine: this app never
  holds a GitHub token, and never reads `gh`'s own stored credential.
- **Several editors at once** — multiple VS Code windows connect to one backend, on the same
  repository or different ones. Repository-level state (the reader/writer gate, the file watcher,
  the caches, the undo slot) is shared; each connection's own paging and walk state is private. A
  new editor asks for approval **in Kira Studio's window**, its token is stored only as a salted
  hash, and revoking it drops every live connection holding it.

Two limits worth knowing up front:

- **Git 2.38 or newer is required** — `git merge-tree --write-tree`, which conflict prediction
  needs. Below that the extension shows a blocked state rather than degrading silently.
- **Kira Studio and the extension are hard-locked to the same contract version.** A mismatch is a
  blocking panel naming both versions, not a reduced feature set — there is no auto-update here and
  the two install separately, so "run an older method set" has no honest meaning.
```

---

**R4 — Requirements.** Insert after `:148` (the Xcode CLT bullet), before the Colima bullet:

```markdown
- **For the git module:** [Git](https://git-scm.com) 2.38 or newer on `PATH`, and
  [VS Code](https://code.visualstudio.com) 1.134+ to install the bundled *Kira Version* extension
  into. Optional: the [GitHub CLI](https://cli.github.com) (`gh`), already logged in, for PR links
  — without it the PR indicator simply stays blank and nothing else changes.
```

---

**R5 — Development script table.** Four edits inside `:187–206`:

(a) Replace the `typecheck` row:

```markdown
| `bun run typecheck` | Runs the five splits below, in parallel |
```

(b) Insert after the `typecheck:unit` row:

```markdown
| `bun run typecheck:api-core` | `packages/api-core` (`tsgo`) |
| `bun run typecheck:git` | `packages/git-ipc`, `packages/git-core` and `apps/kira-studio-vscode` (`tsgo`), plus `packages/git-ui` and `packages/kira-ui` (`vue-tsc`) |
```

(c) Replace the `test:unit` row, and insert three rows after `test:ipc:fe`:

```markdown
| `bun run test:unit` | Unit suite — `apps/kira-studio/tests/unit` plus the in-source specs under `packages/{api-core,git-core,git-ipc,git-ui,kira-ui}` and `apps/kira-studio-vscode/src`. No external resource, finishes in about a second |
```

```markdown
| `bun run test:webview` | Builds the extension bundle, then runs Playwright against the git webviews — a rendered-box-height layout guard plus interaction specs (see Tests below) |
| `bun run build:vscode` | Builds the VS Code extension's bundle (`scripts/build-vscode.ts`) |
| `bun run package:vscode` | Packages it into `kira-version.vsix` (`scripts/package-vscode.ts`) — `bun run package` runs this before bundling it into the app |
```

(d) Insert after the `test:compat` row, and extend the `package` row:

```markdown
| `bun run test:matrix` | `scripts/test-matrix.sh` — each adapter's full auth/config permutation matrix, on demand, not part of CI |
```

```markdown
| `bun run package` | Builds the native Wails bundle and the `.dmg` around it, and ad-hoc signs both — `apps/kira-studio/bin/Kira Studio.{app,dmg}` (`prepackage` runs `bun run setup` first, same as `dev`). The packaged `kira-version.vsix` is copied into the bundle *before* signing, so the signature covers it |
```

---

**R6 — App data paragraph.** Replace `:208–210`:

```markdown
**App data:** the app keeps `kira.db`, `logs/`, the git module's own `review.db`, and its
`git.sock`/`git.sock.lock` under `~/.kira-studio/`. The `KIRA_HOME` environment variable relocates
that whole directory — the test suite uses it to keep tests off a developer's real data, and the
git socket follows it, so two `KIRA_HOME`s are two fully independent backends rather than two
processes fighting over one socket.
```

---

**R7 — Tests section.** Replace the opening paragraph `:218–220`:

```markdown
Four TypeScript suites under `apps/kira-studio/tests/` (`unit/`, `ui/`, `ipc/`, `e2e-real/`), a
fifth under `apps/kira-studio-vscode/tests/` for the git webviews, plus the Go suite under
`apps/kira-studio/`. `packages/db-fixtures/` is a shared fixture corpus (fixtures + support code),
not a spec suite of its own — no `xvfb` is needed for any tier.
```

Insert after the `test:ipc:fe` bullet (`:228–231`):

```markdown
- **`bun run test:webview`** — Playwright against the extension's own built webview documents
  (`apps/kira-studio-vscode/tests/`), in two projects. `layout` asserts **real rendered box
  heights** against the real emitted document and the real bundle, not DOM shape: a build once
  shipped a graph panel whose `aria-rowcount` was correct while the panel was visually collapsed to
  roughly 75 px, which is exactly the failure a DOM-shape check cannot see. `interaction` covers
  the graph columns, the file tree, the review panel and the shared floating-UI geometry. No
  backend, no container, no VS Code.
```

Replace the `test:go` bullet (`:236–238`):

```markdown
- **`bun run test:go`** — the Go test suite (`go test ./...`), including the Testcontainers-backed
  cases against real engines; container-backed cases self-skip without Docker. With Colima, start
  it first: `colima start --cpu 4 --memory 6 --disk 40`. The git packages need no container at all
  — they build real repositories under `t.TempDir()` against the `git` on `PATH`, and skip
  themselves without one; their perf probes are opt-in behind `KIRA_GIT_PERF=1` and assert nothing.
```

---

**R8 — Architecture section.** Insert a third bullet after `:258`:

```markdown
- **The git module is headless**, and is the one subsystem whose frontend is not this webview: it
  runs in the same Go binary as a peer to Studio and Api (`apps/kira-studio/internal/git*`), and a
  separately-installed VS Code extension process reaches it over a Unix socket
  (`~/.kira-studio/git.sock`) rather than through either plane above.
```

Replace the layout block `:263–274`:

```
apps/kira-studio/internal        the Go app: adapters, storage, IPC bridge, tree service, connection state, ops, git
apps/kira-studio/frontend/src    the Vue 3 app (bindings + the built bundle live alongside it, both gitignored)
apps/kira-studio/tests/unit      unit suite — no external resource
apps/kira-studio/tests/ui        Playwright against the built bundle, WebKit, both wire planes mocked
apps/kira-studio/tests/ipc       per-adapter IPC-boundary suite — real Go backend + mocked-IPC frontend
apps/kira-studio/tests/e2e-real  Playwright against a real `-tags server` Go binary
apps/kira-studio-vscode          the Kira Version VS Code extension — the git module's only frontend
packages/shared      wire protocol + domain types the Go side mirrors as its own source of truth
packages/api-core    the Api module's DOM-free logic (substitution, curl/raw, dynamic values)
packages/git-ipc     the git contract, RPC/codec/validation, the socket channel, the FlatBuffers schema
packages/git-core    client-side git logic: commit store, lane layout, the client half of search, ports
packages/git-ui      the git webview UI (graph panel, review panel), hosted by the extension
packages/kira-ui     host-agnostic Vue components shared by the workbench and the git webviews
packages/db-fixtures shared fixture corpus (fixtures/support code, not a spec suite of its own)
docs                 architecture, performance, packaging, design system; docs/v1.3 is the live record
scripts/demo-dbs     local fixture databases for manual testing
```

Replace the closing paragraph `:276–279`:

```markdown
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full current-state breakdown,
[`docs/v1.3/SPEC.md`](docs/v1.3/SPEC.md) for the git chapter, [`docs/v1.2/SPEC.md`](docs/v1.2/SPEC.md)
for the completed Api chapter, and [`docs/v1.1/SPEC.md`](docs/v1.1/SPEC.md) for the completed Studio
chapter (`docs/v1/SPEC.md` is the v1 record — see `docs/v1/README.md`).
```

---

**R9 — Documentation section.** Replace the `docs/v1.2/` entry (`:290–292`) with two entries:

```markdown
- [`docs/v1.3/`](docs/v1.3/) — the git chapter's phasing record:
  [`SPEC.md`](docs/v1.3/SPEC.md) and [`plans/`](docs/v1.3/plans/), one implementation plan per
  phase, G1 through G33.
- [`docs/v1.2/`](docs/v1.2/) — the completed Api chapter's own phasing record (see
  `docs/v1.2/README.md`): [`SPEC.md`](docs/v1.2/SPEC.md) and [`plans/`](docs/v1.2/plans/).
```

---

**R10 — Not shipped.** Append to the section (`:303–312`), as its own paragraph:

```markdown
On the git side: **no git mode, tab or panel inside Kira Studio's own window** — the module is
headless by design, and the transport layer is built so an embedded UI would be additive rather
than a rework. The extension is **not published to the VS Code Marketplace or OpenVSX**; it ships
in the DMG and installs from the *Connected editors* pane.
```

---

### 3.2 `docs/ARCHITECTURE.md`

---

**A1 — Stack table row.** Insert after the *Outbound gRPC client (P11)* row (`:42`):

```markdown
| Git module transport (v1.3) | A Unix domain socket plus `internal/bridge/rpcstream`'s correlated-RPC-with-credits protocol — JSON control frames, FlatBuffers bulk payloads (`"KIG1"`) | The git module is **headless**: the backend is in this binary, the frontend is a separately-installed VS Code extension (`apps/kira-studio-vscode`) reached over `${KIRA_HOME}/git.sock`. **The transport itself took no new runtime dependency** — `net` and `encoding/json` plus the FlatBuffers runtimes P11 already put in the graph. What the module *did* add: `github.com/fsnotify/fsevents` (the darwin repo watcher, `darwin && cgo`, G9), `golang.org/x/text/unicode/norm` (NFC path normalization, G27), and `@vscode/vsce` as a build-time-only packager. See the Git module section below |
```

---

**A2 — the new subsystem section.** Insert as a whole new `##` section **between `## Process model` (ending `:1988`) and `## Renderer security surface` (`:2056`)**.

*Placement rationale:* Process model establishes the webview/Go-shell pair and the two planes; the git module extends exactly that picture with a third, externally-owned process and a second transport, so it reads as a continuation rather than an interruption. It also lands before Testing, which will reference it.

```markdown
## Git module (v1.3)

The third top-level module, beside `studio` and `api`, and the one that runs **headless**: the git
logic lives in this Go binary, and the frontend is a separately-installed VS Code extension
connecting as an external client. Kira Studio's own Wails window has no git mode, no git tab and no
git panel. Its only git-facing surfaces are the Settings dialog's *Connected editors* pane
(pairing, revocation, extension install) and its *Git* section (the two server-owned remote-op
settings below) — both there because Kira Studio is the trust authority and the owner of those
settings, not because a git UI crept in.

**Why headless, structurally.** An in-process Wails stream is unreachable from another process, and
the frontend this module wanted already existed as a VS Code extension. So the module was cut at a
transport seam instead of a UI one: `rpcstream`'s `Conn{Send([]byte) error; Receive() ([]byte,
error)}` is the whole of what the protocol needs from a channel, so the same `Handlers` serve a
Unix socket today and would serve an in-process Wails stream unchanged. An embedded git UI is out
of scope and stays additive rather than a rework — the same "additive, not a rework" shape the
`-tags server` build tag already gives the `studio` data plane.

### Transport

**One Unix domain socket at `${KIRA_HOME}/git.sock`** (default `~/.kira-studio/git.sock`), mode
0600, inside the 0700 directory `config.EnsureLayout` already owns. There is **no discovery or
announce mechanism**: the extension dials the fixed path, and a connection failure means Kira
Studio isn't running — that is the entire signal, and there is nothing further to distinguish. This
app is macOS-only, so a Unix socket is unconditionally viable with no cross-platform fallback.

**Stale-socket recovery is an `flock`, not a liveness probe.** At startup the app takes an
exclusive lock on `${KIRA_HOME}/git.sock.lock`. Lock acquired: any `git.sock` still on disk is a
crash leftover — unlink it and listen. Lock already held: another instance is serving, and this one
does not listen. Either way the app still boots; `main.go` logs the listener's error and never
`Fatal`s on it. A `SIGKILL`ed instance's flock is released by the kernel, so the next launch
recovers with no stale-pid file and no manual cleanup, and a leaked askpass directory needs no
startup sweep because it is inert.

**Pairing is the auth model, and there is no pre-shared token file.** A client's `hello` carries
its identity and, if it has one, an opaque token; the server answers `ready`, `versionMismatch`,
`tokenRejected`, or `pairingRequired`. An unrecognised or invalid token raises an approval prompt
**in Kira Studio's own window** — Kira Studio is the trust authority, not the requesting editor —
one prompt on screen at a time with concurrent requests queued and counted, a 120 s window per
request measured from enqueue (a request arriving before any window exists is *held*, not
auto-denied), and a 60 s cooldown after an explicit denial so a reconnecting extension cannot
re-prompt in a loop. The approved token is 32 `crypto/rand` bytes; **only `sha256(salt‖token)` is
stored**, compared with `subtle.ConstantTimeCompare`. The plaintext is never stored and never
recoverable — not an omission, a consequence: verifying a presented token is the only thing this
app ever needs to do with one, so a reversible form would be strictly more exposure for no
capability. The extension keeps its own copy in VS Code's `context.secrets`. Revoking from the
*Connected editors* pane sets `revoked_at` and closes every live connection holding that id; the
extension receives `tokenRejected`, clears its stored token, and re-dials with none, producing a
fresh prompt. A row is never deleted — a re-pair clears `revoked_at` on the same row, so a fresh
human approval always re-admits.

**Version compatibility is hard lockstep, negotiated in that same handshake.**
`gitrpc.ContractVersion` and `packages/git-ipc/src/validate.ts`'s `CONTRACT_VERSION` are one number
(**30** today), asserted equal by tests on both sides, and it is the *sole* compatibility
authority — not the app version, not a side file. A mismatch is a blocking panel in the extension
naming both versions, never a degraded mode: this app has no auto-update and the extension installs
separately, so "run an older method set" has no honest meaning here.

**Two frame shapes over that one socket — the same split the `studio` data plane already uses, not
a second design.** Control frames (the whole `rpcstream` envelope, every request, and every small
response) stay **JSON text**. Bulk payloads are **FlatBuffers**:
`packages/git-ipc/schema/gitwire.fbs`, generated through the same pinned, digest-verified `flatc`
toolchain and the same Go/npm runtimes `wire.fbs` already uses, with its own file identifier
**`"KIG1"`** — deliberately distinct from the `studio` plane's `"KIF1"` so the two can never be
cross-decoded. A frame not carrying `"KIG1"` is a hard error: no dual-format decoder, no
compatibility shim, the same house rule P11 stated. The schema is deliberately small — one `Frame`
wrapping a `Payload` union whose only member today is `PackedCommitChunk`: the graph's column-wise
commit block (sha bytes, CSR parent offsets, an identity/time table, subject bytes plus offsets, a
delta-numbered string dictionary, and per-row ref decorations). It is append-only — never renumber,
never reorder, never delete a field; retire with `(deprecated)`. The file is named `gitwire.fbs`
rather than `gitWire.fbs` because `flatc`'s TypeScript generator names its entry point after the
filename and its barrel after the namespace, and two names differing only in case collide on a
case-insensitive filesystem.

**`internal/bridge/rpcstream` is module-agnostic infrastructure, and the one deliberate exception
to the module-boundary rule.** It is a correlated-RPC-with-credits state machine —
`req`/`res`/`evt`/`open`/`chunk`/`end`/`credit`/`cancel` in a versioned envelope, a
delete-before-respond guard against a request racing its own cancellation, and an
aborted-versus-real-error split on a stream's `end` — transcribed field-for-field from the
TypeScript `rpc.ts` beside it, so its correctness is checkable by reading the two together rather
than re-deriving the protocol. It never learns what a method means; that is entirely `Handlers`'
job, which is what makes reuse by a second module free rather than a fork.

### Session model

A real, load-bearing requirement rather than a hypothetical: **several VS Code windows connect to
one backend at once**, pointed at the same repository or at different ones. The structure follows
one rule — *a fact about the repository is shared; a fact about one viewer's session is private* —
which is the one genuine structural departure from a single-session design that conflates the two.

```
GitServer (internal/gitsock)
├─ listener (accept loop over the Unix socket) + flock + pairing broker + trust store
├─ Registry (internal/gitsession): map[RepoID]*RepoEntry — mutex + refcount
│    RepoEntry — SHARED by every connection open on that repository
│      reader/writer gate · git driver · cat-file --batch session · repo watcher
│      detail / diff / refs / stack caches · live HEAD · undo slot · active remote op (<=1)
│      subscribers: map[ConnID]chan Event
└─ Conn (internal/gitsession): one per accepted socket
     client identity · its own ctx · its own rpcstream session and Handlers
     walks: map[RepoID]*Walk — PRIVATE per (connection, repository)
       log session, commit store, dictionary marks, paging state, the active review walk
```

- **`RepoID` is the absolute git dir**, NFC-normalized (below), so two clients that reached the
  same repository by different spellings of the same path share one entry rather than racing two.
- **`Registry.Acquire(ctx, path) (*RepoEntry, release func())`** refcounts. Real teardown — kill
  the `cat-file` pair, stop the watcher, drop the caches — happens only at zero, and only after a
  five-minute linger, so closing and immediately reopening a repository costs nothing.
- **The reader/writer gate is unchanged** from the single-client design; it now serializes across
  connections instead of within one, which is the whole point of moving it onto the shared entry.
- **One watcher per repository, fanned out.** It covers `HEAD`, `refs/**`, `packed-refs`, `index`,
  `FETCH_HEAD`, `MERGE_HEAD`, `rebase-*`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` and `sequencer` plus
  the worktree, debounced 200 ms, delivered to each subscriber over its own coalescing buffered
  channel so one slow client cannot stall the watcher for the others. **The darwin backend is
  FSEvents** (`gitclient/watcher_fsevents_darwin.go`, `darwin && cgo`), with the `fsnotify`
  implementation kept as the real `!darwin || !cgo` companion a Linux dev/test loop actually runs.
  The reason is a resource bound, not a preference: `fsnotify`'s kqueue path needs one open file
  descriptor per watched directory — every directory under `commonDir/refs` — which on a repository
  with many loose refs is a real cost against `kern.maxfilesperproc`. FSEvents watches a tree
  recursively through one event stream, which eliminates that cost structurally rather than
  measuring how close it gets. This is the same choice VS Code (`@parcel/watcher`) and Zed (the
  `notify` crate) make on macOS.
- **A client disconnect never kills a write.** `rpcstream.Serve` returning on peer close already
  cancels every in-flight request and stream for that connection; on top of that, the connection's
  own log-session processes are killed and its `RepoEntry` refcounts released. A **write** already
  in flight is instead *detached* from the connection and finishes on its own — its result is
  simply delivered nowhere. A half-applied checkout because a window closed would be far worse than
  a result nobody reads.
- **The undo slot is one per repository**, not per connection, and names the originating client in
  its own label, so a second window reads "Undo reset of `main` (window: repo-review)" rather than
  an anonymous or misattributed action.
- **Credential prompts go to the editor; pairing prompts stay in Kira Studio.** The split is
  deliberate and the two questions are genuinely different: "what is the password for this one
  push" is about an action the user just took in that window, while "should this window ever talk
  to me at all" is a trust decision belonging to the trust authority. `internal/gitaskpass` brokers
  the first over its own private socket behind a `GIT_ASKPASS` shim, relaying to the connection
  that owns the in-flight remote op. If that connection dies mid-prompt the broker fails the
  credential request non-zero rather than hanging, and the wait is bounded regardless — a git
  process blocked forever on a prompt nobody will answer is the failure this design exists to make
  impossible.

**Settings ownership follows the same shared/private line, and it is a correctness question rather
than a preference.** `protectedBranches`, `fetch.autoInterval` and `git.path` are **server-owned**
— two windows disagreeing about a protected-branch list is a safety bug — and are edited in Kira
Studio's own Settings dialog (*Git* section), read fresh on every push pre-flight and every
auto-fetch tick, never cached. Every per-viewer display setting (graph page size and scope, stash
visibility, and similar) is **per repository**, stored server-side in `git_repo_settings` (Storage,
above) and edited from a dialog opened in the graph view itself. Neither category lives in VS
Code's own configuration any more: the extension's manifest contributes **no configuration
properties at all**.

### Go packages

Every git package is its own `internal/git*` (plus `internal/ghclient` and `internal/startupfail`),
and no phase merged git code into a shared file where a per-module one would do.
`internal/layering_test.go`'s `TestDomainPackagesDoNotImportBridge` covers them exactly as it
covers the Studio and Api domain packages — no `internal/git*` package imports `internal/bridge`,
and none imports or is imported by an adapter package.

| Package | Owns |
|---|---|
| `gitclient` | Spawn discipline (argv-only, no shell, env hygiene, `-c core.quotepath=false`, `--no-optional-locks`, `Setpgid` plus group-kill on cancellation, a graceful `WaitDelay`), a streaming runner returning a live pipe rather than a buffered `[]byte`, discovery (macOS-only, a **git 2.38 floor**, an explicit Xcode Command-Line-Tools-shim gate so the shim is never spawned blind, a short TTL cache), the capability probe, the typed error vocabulary, and the per-repository reader/writer gate |
| `gitclient/porcelain` | Framing and parsing for `log`, `for-each-ref`, `status --porcelain=v2`, `diff-tree`, `diff`, `stash list`, `merge-tree` and `cat-file --batch` — NUL and `%x1f` record splitting, against a committed golden-byte corpus rather than hand-written expectations |
| `gitclient/catfile`, `gitclient/logsession` | The two persistent child processes: one `cat-file --batch` pair per repository, and the pausable/resumable paged log walk |
| `gitpath` | The module's single Unicode-canonicalisation point (below) |
| `gitstore` | The column-wise commit store, sha table, string interner and `PackedCommitChunk` builder. It only ever appends and packs — a parent's sha is stored directly and never resolved to a row, because resolving is a renderer concern |
| `gitpreflight` | Hazard classification for checkout, stash pop, reset, revert, cherry-pick, push, pull, stash-branch, restack and worktree add/remove, plus the protected-branch glob matcher and the undo slot. Computed server-side and crossed as data — never duplicated client-side, so the two can't disagree |
| `gitops` | The write side: branch, checkout, tag, revert, reset, cherry-pick, stash, fetch, push, pull, worktree, stack/restack, conflict handling, and stderr progress parsing |
| `gitsearch` | The cancellable, time-boxed tail scan and the Go matcher, plus the RE2/`RegExp` dialect reconciliation (below) |
| `gitreview` | `review.db`'s whole surface: compressed content snapshots, fast/slow-path diff selection, partial-review ranges, the flat AI-comment list, and the TTL reaper (Storage, above) |
| `gitsession` | `Registry`, `RepoEntry`, `Conn`, `Walk` — the session model above. Imports `gitclient`, `gitpreflight`, `gitreview`, `ghclient` and stdlib only |
| `gitrpc` | The method table (**46 methods**, `app.init` through `worktree.prepare`), `ContractVersion`, and the wire types |
| `gitsock` | The Unix listener, length-prefixed framing, the handshake, the pairing broker, the trust store and stale-socket recovery |
| `gitwire` | Generated FlatBuffers code for the git data plane |
| `gitaskpass` | The credential broker and its `GIT_ASKPASS` shim, over its own private socket, with a bounded wait |
| `gitprepare` | The worktree prepare script's execution seam — the one shell exception, below |
| `gitvsix` | Locating the `.vsix` bundled inside a packaged `Kira Studio.app` and installing it via `code --install-extension`, or revealing it in Finder when `code` isn't on `PATH` |
| `ghclient` | `gh` CLI discovery and spawn discipline mirroring `gitclient`'s own `Locator`/probe/TTL-cache shape, a `GhStatus` classification, and PR lookup through `gh api` |
| `startupfail` | Native, pre-window failure alerts for every boot step (below) |
| `bridge/rpcstream` | The correlated-RPC-with-credits protocol (above) — module-agnostic by design |
| `bridge/gitclients.go` | `GitClientsService`, the bound Wails service behind the *Connected editors* pane |

**One deliberate exception to argv-only spawning, and exactly one.** Every other spawn in this
codebase hands a fixed argv straight to `os/exec` with no shell involved. `gitprepare` runs the
user's own worktree prepare script *through* a shell, and its safety argument rests on a single
property rather than on sanitisation: **no app-supplied value is ever interpolated into the command
string.** The command string *is* the user's own typed, explicitly approved (sha256-pinned)
command. App data — the worktree path, its branch, the repository root — reaches the script only as
environment variable *values*, so even a maximally adversarial branch name can at worst be a
word-splittable value, never re-parsed as a command. The package imports nothing beyond the
standard library and knows nothing about repositories, sessions or approval; `gitsession` owns
every policy decision and this package owns only the mechanism, which is what lets the whole
feature be tested without ever spawning a real shell.

**GitHub authentication is delegated entirely to `gh`, and this app holds no GitHub credential of
any kind.** No OAuth flow, no token prompt, no direct call to GitHub's OAuth endpoints, and no
reading of `gh`'s own keychain entry out from under it — PR lookups shell through `gh api`, under
the same spawn discipline as every git call. Re-solving authentication here would be a second,
worse implementation storing a second copy of a secret this app has no business holding. `GhStatus`
is a discriminated union mirroring `GitStatus`'s existing shape: `ok`, `notFound` (install `gh`),
`unauthenticated` (run `gh auth login`), and `forbidden` (a 403 from insufficient scope or
unauthorized org SSO — named as the fix rather than shown as a raw HTTP status). None of these ever
blocks git itself; they only blank the PR indicator, matching the fail-open design the feature's
own enable flag already had.

**Search reconciles Go's RE2 against JavaScript's `RegExp` explicitly rather than approximating
it**, because the server-side tail scan and the client-side scan of already-loaded rows must agree
exactly — otherwise a hit's presence depends on which page happens to be loaded, which is a bug the
user can see and cannot explain. Three tiers, and the module never runs a second, silently
different engine against the same query text:

1. **Literal mode** runs no regex engine at all. A literal query is always a fixed, escaped needle,
   so "the wrapped pattern matches" reduces to "some occurrence of the needle has an acceptable
   word boundary on each side", computed by occurrence enumeration plus a byte-level boundary
   post-check — byte-exact to JavaScript by construction, not by coincidence.
2. **Regex mode** translates the rewritable constructs into RE2 (`.`, `\s`/`\S`, `\p`/`\P`,
   `\uXXXX`/`\u{…}`, `\cA`-`\cZ`, a bare `\0`, an unknown identity escape), and applies whole-word
   as a **consuming rewrite** rather than a post-check — a post-check disagrees with JavaScript's
   own backtracking-into-a-different-alternative behaviour on a pattern like `foo|foobar`.
3. **What RE2 genuinely cannot express** — lookahead, lookbehind, a numbered or named
   backreference — is **refused as data** (`{kind: "unsupportedPattern"}`), never silently dropped
   and never approximated.

The Go matcher and `packages/git-core/src/search/` are twins, not duplicates, pinned by one shared
corpus — `packages/git-core/testdata/searchConformance.json`, read by both languages' suites, so a
semantic change adds a row there first and never edits one side alone. This is the same technique
`internal/apivars/testdata/substitution.json` already uses for `{{name}}` substitution, applied to
a second pair of implementations. **Two divergences are knowingly accepted and recorded rather than
hidden**: regex-mode case folding is RE2's own `(?i)` rather than ECMA-262's `Canonicalize`, so the
Kelvin-sign class of difference can in principle disagree in regex mode only (literal mode stays
exact regardless of case sensitivity); and `\S` *inside* an already-open character class falls back
to RE2's ASCII-only `\S`, since negating a sub-portion of an open class is not expressible by the
insertion that the out-of-class form uses.

**Unicode path normalization is provenance-based, and getting the direction wrong breaks git
outright.** APFS returns filenames from the filesystem in NFD; git stores paths as whatever bytes
the committer's platform produced, usually NFC. `internal/gitpath` is the module's one
canonicalisation point — it exists because five otherwise-unrelated packages need the same one-line
normalization and share no common import that wouldn't invert the layering. The rule is not "is
this a path?" but "where did these bytes come from, and where are they going?":

- **Tier 1 — absolute and directory paths** (`RepoID`, the root, git dir, common dir, worktree
  directories, filesystem-event paths, every client-supplied directory parameter) are normalized to
  **NFC at ingestion, always**. They are only ever map/registry/database keys, comparands, chdir
  targets or `os.Stat` operands, and filesystem access by path is normalization-insensitive on both
  APFS and HFS+, so this carries no functional risk at all.
- **Tier 2 — repository-relative file paths** from porcelain output (`status`, `diff-tree`, `diff`,
  `stash show`) are **never normalized**. Every one of them is handed back to git as a pathspec or
  a `<rev>:<path>` operand, where git does a byte comparison against tree and index entries: an NFC
  spelling of an NFD tree entry produces `fatal: path 'café.txt' does not exist in 'HEAD'`, or a
  silently empty `git diff --name-only`, which is worse.

`gitpath.NFC` is unguarded on purpose — `norm.NFC.String` already has its own fast path and
measured faster than an `IsNormalString` guard in front of it — and is byte-transparent for invalid
UTF-8, so it has no failure mode and returns no error.

**This app's reserved ref namespace is `refs/kira/*`.** The reusable global stash lives at
`refs/kira/globalstash/<sha>` — a real ref rather than a reflog entry, because git's own stash is a
single ordered pop-once stack with no room for "keep this and reuse it". Every `refs/kira/` string
in the codebase is built from one exported constant, and every revision set the graph walks passes
`--exclude=refs/kira/*` unconditionally, so this app's own bookkeeping never shows up as commits in
a user's graph.

**Startup failures are surfaced natively, before any window exists.** Every pre-window `log.Fatalf`
site in `main.go` — `config.EnsureLayout`, `logging.Init`, `storage.Open` (including its refusal to
run against a `schema_version` newer than the binary knows), `repos.New`, the settings read, and
window list/create — used to reach only a log file, with no window ever created and nothing shown:
the app simply failed to launch, silently. `internal/startupfail` renders each as a native OS alert
through an **argv-only `osascript` spawn**, the same discipline `gitvsix` uses for `code`. Wails'
own dialog API is structurally unusable at these sites (it dispatches through `globalApplication`
and `a.impl`, assigned inside `New()` and `Run()` respectively, so both are nil dereferences at
boot). A cgo `NSAlert` shim was declined for a measured reason rather than a stylistic one: a
pure-Go package cross-compiles and unit-tests for `darwin/arm64` from this repo's Linux dev
container, while a cgo one cannot be compiled there at all — and for code whose entire purpose is
to work on the one path nobody exercises interactively, "verifiable where the code is written" is
not a nicety. `internal/gitreview`'s own equivalent refusal is deliberately *not* routed here: it
fires mid-session inside an already-open window, as an RPC-level error, which is a different
surface with a working answer already.

### The extension and its packages

`apps/kira-studio-vscode` is the whole frontend. It contributes a **Git Graph** webview in the
panel and a **Kira Version** webview in the activity bar, **46 commands** (every mutating operation
has one — the command-palette audit that established this happens once, and each later phase
registers its own), SCM-title / editor-title / editor-context / comment-thread menus, keybindings
and colors, and — as above — **no configuration properties**. It reaches Go through
`packages/git-ipc`'s `socketChannel.ts`: `net.connect` plus length-prefixed framing behind the same
`MessageChannelLike` seam a `webview.postMessage` channel satisfies, which is why swapping the
transport was a channel change rather than a rewrite. A handful of host-capability calls — dialogs,
clipboard, "open externally", editor integration, workspace roots, storage, logger, theme, windows,
credential prompt — are answered **locally** by the extension's own ports rather than round-tripped
to Go.

| Package | Holds |
|---|---|
| `packages/git-ipc` | The shared vocabulary: `contract.ts`, `rpc.ts`, `transport.ts`, `codec.ts`, `validate.ts` (`CONTRACT_VERSION`), `socketChannel.ts`, `schema/gitwire.fbs` with its generated code, and `graphChunkCodec.ts` |
| `packages/git-core` | Client-side domain logic: the commit store, the lane-layout graph worker, the client half of search, the wire model types, the settings schema, and the port interfaces the extension implements |
| `packages/git-ui` | The webview UI itself — the graph panel, the review panel, the dialogs, the file tree — Vue, mounted by the extension in both webview roots |
| `packages/kira-ui` | Host-agnostic Vue components (`KuiButton`, `KuiContextMenu`, `KuiDialog`, `KuiIconBox`, `KuiPopoverPanel`, `KuiSearchInput`, `KuiSegmented`, `KuiSelect`, `KuiTextInput`, `KuiTooltip`) plus the shared Floating-UI positioning, tooltip and modal-focus machinery — shared by the workbench and the git webviews so the two frontends stop diverging component by component |

**Every viewport-anchored floating surface in both frontends goes through Floating UI's
collision-aware middleware** (`flip`/`shift`/`size`), rendered teleported so no `overflow: hidden`
ancestor can clip it. The audit that established this is stated per *mechanism*, not per module,
because a first pass concluded one frontend was clear on the strength of its most common mechanism
and missed a second: a native `title` attribute, a CodeMirror `hoverTooltip` (whose container
defaults to the editor's own DOM node unless `parent: document.body` is set explicitly, and which
carries its own hardcoded `z-index` uncoordinated with this app's `--kira-z-tooltip` token), and
any bespoke click-point popup are each their own path. A module is not clear because one of its
mechanisms is.

**A webview panel can instantiate correctly and still be invisible, which is why the guard asserts
pixels.** A shipped build once rendered the graph with a correct `aria-rowcount` while the panel
was collapsed to roughly 75 px, because nothing in the emitted document or the bundled CSS ever
gave `html`/`body`/`#app` a height, so the components' own `height: 100%` resolved to `auto`
against an ancestor chain with none. `apps/kira-studio-vscode/tests/layout/` asserts **real
rendered box height** via `getBoundingClientRect()` against the real emitted document and the real
built bundle. DOM shape is exactly the kind of proxy that passes while the thing it stands for is
broken, and this tier exists because that happened.

**The extension ships in the DMG, not through a marketplace.** `bun run package:vscode` produces
`kira-version.vsix`; the packaging task copies it to `Contents/Resources/kira-version.vsix` before
the ad-hoc signature is applied, so the signature covers it; and the *Connected editors* pane's
*Install VS Code Integration* button shells out to `code --install-extension <path>` — argv-only,
matching every other spawn in this module — with a reveal-in-Finder fallback when the `code` CLI
isn't on `PATH`. The filename carries no version: the version lives inside the manifest, where
`code` reads it.
```

---

**A3 — Storage: the two new `kira.db` tables.** Append to the schema block, after the
`grpc_call_history(...)` entry and before the block's closing fence (`:602`):

```
git_clients(id, label, token_hash, token_salt, created_at, last_seen_at, revoked_at)
                                                       -- G1; the paired VS Code editors' trust
                                                       -- store. Only sha256(salt||token) is ever
                                                       -- stored, never the plaintext. Revoke sets
                                                       -- revoked_at; a re-pair clears it on the
                                                       -- same row, so rows are never deleted.
                                                       -- Timestamps are epoch-millisecond
                                                       -- integers rather than this schema's usual
                                                       -- ISO TEXT -- a new table with no prior
                                                       -- rows anywhere to stay consistent with
git_repo_settings(repo_id, key, value)                  -- G18; per-(repository, leaf) display
                                                       -- settings, shaped like `settings`' own
                                                       -- per-leaf-row pattern plus a repo_id
                                                       -- column -- one row per leaf, never a blob
                                                       -- per repository. repo_id = '' is the
                                                       -- reserved "not scoped to any repository"
                                                       -- sentinel (a real RepoID can never be
                                                       -- empty), so the one non-per-repo key
                                                       -- needs no schema change
```

Append two rows to the growth-bound table, after the `op_log` row (`:862`):

```markdown
| `git_clients` | pairings | one row per paired editor identity, ever; written only by an explicit human approval, never by machinery |
| `git_repo_settings` | user action | a closed key set times the repositories a user has actually opened settings on |
```

Amend the sentence introducing that audit (`:842–843`) — "An audit of all nineteen tables" — to
"An audit of every table then existing (nineteen)", so the count reads as a record of that audit
rather than a claim about the current schema.

---

**A4 — Storage: `review.db`.** Insert as two paragraphs immediately after the "**A known,
deliberate orphan**" paragraph (`:786`), before the DataGrip section:

```markdown
**A second SQLite file, `review.db`, deliberately not a table in `kira.db` (G11/G13).** The git
module's incremental-review state lives in its own file under `${KIRA_HOME}`, because its lifecycle
is nothing like the rest of the app's data: bulk blob content, and TTL purges that want to reclaim
space aggressively without holding a lock on the main database while they do it. Construction is
free — the file is neither created nor opened until the first request that actually needs one, so
an instance that never serves a review request (including a second instance that lost the
`git.sock.lock` flock) never creates the file and never starts its reaper. Four tables:
`review_session`, one per `(repo_id, branch)` with `last_used_at` indexed because that is the
reaper's entire query; `review_file`, one per reviewed path, carrying the reviewed-at sha, git's
own blob oid, a `content_kind` of `text`/`binary`/`tooLarge`/`absent`, the *uncompressed* length,
and for text the content itself stored `flate`-compressed as a `BLOB`; `review_range`, 1-based
inclusive line ranges expressed in the **snapshot's** coordinates rather than the current file's;
and `review_comment`, the flat file/line AI-comment list, anchored by both a commit sha and that
path's blob oid at that commit. Sessions are purged after 14 days idle — returning after that
window starts clean, by design rather than as an error case.

**Why a content snapshot and not just a commit sha.** The trivial case — nothing rewritten since
the last review — is `git merge-base --is-ancestor <lastReviewedSha> HEAD`; when that succeeds an
ordinary `git diff` is exact and cheap, and the stored blob is never read at all. The case this
storage exists for is a rebase, squash or amend: `<lastReviewedSha>` is no longer an ancestor of
`HEAD`, or has ceased to exist, and git has nothing left to diff against. The slow path writes the
stored content to a temp file, resolves current content through `cat-file`, and diffs the two with
`git diff --no-index` — reusing `gitclient`'s own spawn discipline rather than hand-rolling a diff
algorithm in Go for a case git already answers.
```

---

**A5 — Process model opening.** Replace `:1772–1773`:

```markdown
Two processes for the Studio and Api modules: the **webview** running the Vue renderer, and the
**Go shell** that owns the window, all app state, and now every database driver too. The git module
adds a third that this app does not own — a separately-installed VS Code extension host, reached
over a Unix socket rather than through either of the two planes below (see Git module, above).
```

---

**A6 — the bound-service list.** Replace the sentence at `:1941–1948` beginning "**The Go side is
`apps/kira-studio/`.**" through "`LifecycleService`.":

```markdown
**The Go side is `apps/kira-studio/`.** `apps/kira-studio/main.go` builds the `application.New`
options and registers **twenty-two** bound services under `apps/kira-studio/internal/bridge/`.
Thirteen are Studio's and the shell's — `AppService`, `SettingsService`, `LayoutService`,
`TabsService`, `WindowsService` (P8: a page's own boot-time window registration, see Process
model's multi-window subsection below), `ConnectionsService`, `TreeService`, `EngineService`,
`OpsService`, `FiltersService`, `FilesService`, `QueriesService`, `SchemaService` (P18: the
per-connection DDL document store backing `connection_ddl` and the DDL-driven SQL language service
described below). Seven are the Api module's — `HttpService` (P2: `Send`, the outbound HTTP path —
see the op-log paragraph below and Stack, above), `GrpcService` (P11), `CollectionsService` and
`VariablesService` (P4/P5), `ResponseHistoryService` (P8), `GrpcHistoryService` (P11), and
`DataGripService` (P25's connection import). One is the git module's — `GitClientsService`, the
*Connected editors* pane's whole surface (list, revoke, install the bundled `.vsix`), and the only
bound service the headless git module has, since everything else it does crosses its own socket
rather than the bindings (see Git module, above). `LifecycleService` is the twenty-second.
```

---

**A7 — Testing section.** Three edits.

(a) Replace `:2129–2132`:

```markdown
Four suites under `apps/kira-studio/tests/`: `unit/`, `ipc/`, `ui/`, `e2e-real/`; a fifth under
`apps/kira-studio-vscode/tests/` for the git webviews; plus the Go suite in `apps/kira-studio/`
(`bun run test:go`). `packages/db-fixtures/` is a shared fixture corpus, not a suite of its own
(see below). `ipc/` is the odd one out among the first four — it is two suites in one directory, a
Go backend half and a Playwright frontend half per adapter, sharing one fixture module by design
(P50, below).
```

(b) Insert as a new paragraph after the `tests/e2e-real/` paragraph (`:2276`), before
"**Parallelism.**":

```markdown
**`apps/kira-studio-vscode/tests/`** (`bun run test:webview`) is the git module's own frontend tier
— Playwright against the extension's real emitted webview documents and its real built bundle, in
two projects, with no VS Code, no backend and no container. `layout` asserts **rendered box
heights** rather than DOM shape, for a specific reason recorded in the Git module section above: a
build once shipped a graph panel with a correct `aria-rowcount` while the panel was visually
collapsed to roughly 75 px, and every existing check passed. `interaction` covers the graph
columns, the file tree, the review panel and the shared Floating-UI geometry.

**The git module's Go coverage needs no container, and one part of it is opt-in.** Every
`internal/git*` package builds real repositories under `t.TempDir()` against the `git` on `PATH`
and self-skips without one (the app's own 2.38 floor applies to the tests too, so an older `git`
skips more than it runs). `gitclient/porcelain` is guarded by a committed **golden-byte corpus** —
recorded real `git` output, the same pattern `internal/postman`'s round-trip tests use — because a
porcelain parser is exactly the "several interacting rules" case this repo's own testing bar exists
for. `gitsearch` is guarded by `packages/git-core/testdata/searchConformance.json`, read by both
its Go suite and the TypeScript twin's. And the transport's perf probes (`TestGraphStreamPerf`,
`TestG8PerfBaseline`, in `internal/gitsock/`) run only behind `KIRA_GIT_PERF=1` and **assert
nothing** — they print one `key=value` line each. That is deliberate: a hard threshold in a suite
that also runs on real macOS hardware would be flaky in exactly the way "re-measurement, not
re-derivation" warns against. Their numbers are in `docs/PERF.md` §2.13.
```

(c) Fix the dead pointer at `:2181–2182`. Replace "Its `workflow_dispatch` CI workflow is written
and staged, not live (`CLAUDE.md`'s Known open items)." with:

```markdown
Its `workflow_dispatch` CI workflow is written and staged, not live — `docs/pending-workflows/test-matrix.yml`,
staged rather than committed for the push-scope reason `CLAUDE.md`'s own `.github/workflows/`
section explains.
```

---

**A8 — header generalisation.** Replace `:11–14`:

```markdown
The tree itself outranks this file — if they disagree, the tree is right and this file needs
fixing, not the other way around. Where this file and any chapter's `SPEC.md` disagree (`docs/v1/`,
`docs/v1.1/`, `docs/v1.2/`, `docs/v1.3/`), **this file is authoritative for behavior**: each
`SPEC.md` is the record of what that chapter was *specified* to be, phase by phase, kept as
originally written rather than corrected to match later reality — see each chapter's own
`README.md` for what those folders are and aren't.
```

---

### 3.3 `CLAUDE.md`

---

**M1 — chapter-pointer staleness sweep.** Four surgical replacements:

| At | From | To |
|---|---|---|
| `:12–13` | ``Each phase (`docs/v1.2/SPEC.md`'s phasing table) gets an Opus-authored plan committed under `docs/v1.2/plans/` before implementation starts`` | ``Each phase (the current chapter's `SPEC.md` phasing table — `docs/v1.3/` today) gets an Opus-authored plan committed under that same chapter's `plans/` before implementation starts`` |
| `:33` | ``gets its own file under `docs/v1.2/plans/``` | ``gets its own file under the current chapter's `plans/``` |
| `:46` | `No per-phase PRs. One feature branch for all of v1.` | `No per-phase PRs. One feature branch per chapter.` |
| `:98` | ``belongs in that phase's plan doc under `docs/v1.2/plans/``` | ``belongs in that phase's plan doc under the current chapter's `plans/``` |

*Why:* `CLAUDE.md:100–102` — "When you touch this file, remove what's gone stale too — … a pointer
to a deleted file/subsystem". Three chapters have passed since these were written.

---

**M2 — the cgo cross-compile fact.** Insert as a new bullet in the "Wails v3 / Go" section,
immediately after the `go test ./apps/kira-studio/internal/...` bullet (`:266`):

```markdown
- **`GOOS=darwin` cross-compiles here only with `CGO_ENABLED=0`.** A pure-Go package builds and
  vets for `darwin/arm64` from this container (`GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build
  ./…`, exit 0); a cgo one cannot be built for darwin here at all (`CGO_ENABLED=1 GOOS=darwin`
  fails inside `runtime/cgo` with `clang: error: unsupported option '-arch'`), while a real macOS
  build is `CGO_ENABLED=1`. So a `darwin && cgo` file is compiled, vetted and tested by nobody
  until a human builds on a Mac. Treat that as a **design** constraint, not just a testing gap: for
  code whose whole purpose is to work on a path nobody exercises interactively, prefer a pure-Go
  implementation this container can actually build and test —
  `internal/startupfail` chose an argv-only `osascript` spawn over a cgo `NSAlert` shim for exactly
  this reason, and it is checkable in CI as a result.
```

Also amend the parenthetical in the bullet above it (`:261–263`) so the git watcher is named
rather than covered by "any package that later follows the same pattern":

```markdown
(a handful of darwin-only files in `internal/secrets`, `internal/metrics`, `internal/localauth`,
`internal/gitclient`'s FSEvents repo watcher, and any package that later follows the same pattern)
```

---

**M3 — a new operational section for the git module.** Insert as a whole `##` section between the
`Secrets / KIRA_INSECURE_SECRETS` section (ending `:239`) and the `Wails v3 / Go` section (`:241`),
so the Go-toolchain notes stay adjacent to each other.

```markdown
## The git module — running and testing it here (G1-G29)

See `docs/ARCHITECTURE.md`'s Git module section for what it is and why. This section is only about
running it here.

- **`go test ./apps/kira-studio/internal/git...` needs a real `git` on `PATH` and nothing else** —
  no Docker, no container, no display, no VS Code. Each test builds its own repository under
  `t.TempDir()`, and cases that need `git` self-skip without it. The app's own floor is **git
  2.38** (`merge-tree --write-tree`), so an older `git` skips more than it runs rather than failing
  informatively.
- **`KIRA_HOME` scopes the socket, not just the database.** The listener is
  `${KIRA_HOME}/git.sock` with its flock beside it, so two `KIRA_HOME`s are two fully independent
  backends and a test never contends with a `bun run dev` session's socket. Anything needing a
  server builds one over its own temp `KIRA_HOME` — never the fixed path.
- **The perf probes are opt-in and assert nothing.**
  `KIRA_GIT_PERF=1 go test -run 'TestGraphStreamPerf|TestG8PerfBaseline' ./apps/kira-studio/internal/gitsock/ -v`
  prints one `key=value` line per probe. Asserting a threshold was declined deliberately: this
  container's numbers and a real Mac's are not comparable, so a hard bound would be flaky in
  exactly the way it's meant to guard against. Record numbers in the commit message and, when they
  answer a stated budget, in `docs/PERF.md`.
- **The FSEvents watcher is `darwin && cgo`** (`internal/gitclient/watcher_fsevents_darwin.go`), so
  a Linux run exercises the `fsnotify` companion instead. Both satisfy the same seam and both are
  covered by `watcher_test.go`; only the darwin backend's own behaviour needs real hardware.
- **The extension's own suites need neither VS Code nor `xvfb`.** `bun run test:webview` builds the
  extension bundle and drives the real emitted webview documents in headless Chromium (a layout
  project asserting rendered box heights, and an interaction project); `bun run test:unit` covers
  the extension's and `packages/git-*`'s in-source specs alongside everything else.
- **The scoped Go race run** for a git-chapter phase is the git packages actually in play plus
  `internal` itself for the layering test, not the whole tree — `docs/v1.3/SPEC.md`'s own "Full
  verification scope" note fixes the list and the reason. The unscoped tree stays worth running
  occasionally as a backstop, just not per phase.
```

---

**M4 — `Known open items`.** **No change.** The single item (the first-launch window-size clamp,
P22 D6(a), `:126–135`) is still genuinely open: G29 touched `main.go`'s boot sequence for failure
alerts, not the ordering of startup window creation against `ApplicationDidFinishLaunching`, which
is what closing it requires. Nothing in G1–G29 closes it, and inventing a change here would violate
this file's own "keep an item only while genuinely open" rule in the opposite direction.

---

### 3.4 `docs/v1.3/SPEC.md`

---

**S1 — `## Known open items` (`:444–453`).** Replace the section **in full**:

```markdown
## Known open items

Both items this section carried through the chapter are closed and removed, per `CLAUDE.md`'s
"keep an item only while genuinely open, delete it the moment it's resolved" rule. **RE2 vs. JS
`RegExp` in search** was closed by G23, with a stronger answer than this section asked for — a
literal query runs no regex engine at all, a regex query is translated construct by construct with
whole-word as a consuming rewrite (a post-check, which this item proposed, was found to disagree
with JS on `foo|foobar`), and what RE2 cannot express is refused as data rather than silently
mismatched; both matchers are pinned by one shared conformance corpus. **Perf budgets needing
re-measurement** was closed by G3's and G8's own probes over the real socket and the real
FlatBuffers framing. Both now live where a durable app fact and a durable measurement belong —
`docs/ARCHITECTURE.md`'s Git module section and `docs/PERF.md` §2.13 respectively — rather than as
open questions here.

- **G30-G32's own findings have not been swept into this section yet.** G33 was run *ahead* of the
  three review rounds by explicit instruction (see `docs/v1.3/plans/G33-docs-update.md`), so its
  sweep covers what **G1-G29** closed and nothing more. Whatever round 3 leaves genuinely open
  belongs here, and this section — together with `CLAUDE.md`'s own environment/convention notes —
  gets one further pass once G32 finishes. That pass is the chapter's actual last act.
```

---

**S2 — `## Out of scope for v1.3` (`:433–442`).** Replace the section **in full**:

```markdown
## Out of scope for v1.3

- **Marketplace/OpenVSX publishing itself** (upstream's literal P13) — G10's DMG bundling is this
  chapter's answer instead, and it shipped: `bun run package:vscode` builds `kira-version.vsix`,
  the packaging task copies it into the app bundle before the ad-hoc signature so the signature
  covers it, and the *Connected editors* pane installs it via `code --install-extension`. Upstream's
  two unfinished phases are no longer unowned either — P12 (GitHub PR links) shipped as G24 and P14
  (worktree support) as G25, which is what adding them was for.
- **Any git mode, tab or panel inside Kira Studio's own Wails frontend** — deliberately deferred,
  and still absent. What the Wails window *does* have is deliberately not that: a *Connected
  editors* pane and a *Git* settings section, both present because Kira Studio is the pairing trust
  authority and the owner of the server-owned settings, not because a git UI crept in. The
  session/transport layer (`rpcstream`'s `Conn` seam) is built so an embedded UI stays additive
  later rather than a rework.
- **Replacing the graph and review panels with native VS Code surfaces** (tree views, quickpicks) —
  considered and explicitly rejected; both are still webviews. This is narrower than this bullet
  originally read, and the correction is deliberate rather than cosmetic: the webview UI did **not**
  ship "exactly as it is". G12 moved every review diff out of the webview into VS Code's own diff
  editor; G14 added *Go to file* and *Open in graph* to that native diff toolbar; G15 rebuilt
  range-level review marking as gutter decorations there; and G12/G14/G19/G21 restyled the webviews
  onto this app's own components, producing `packages/kira-ui`. What stayed out of scope is
  replacing the panels *themselves* with native surfaces — not using a native surface where it is
  the better host for one interaction.
```

---

**S3 — the G33 phasing row (`:346`).** Append one sentence to the end of the row's Deliverable
cell, before the ` | G30, G31, G32 | new` column separators:

```
. **Run out of order, 2026-09-09**: at the user's explicit instruction this phase ran *before*
G30-G32 rather than after them, so its `CLAUDE.md` pass and its "Known open items" sweep cover
G1-G29 only. The review rounds' own contribution to both is a follow-up pass once G30-G32 land —
see `docs/v1.3/plans/G33-docs-update.md` §6
```

*Note for the implementer:* this row is one long table cell; append to it, do not reflow the table.

---

### 3.5 `docs/PERF.md` — one new subsection

**Why this file is in scope.** The SPEC row scopes G33 to "the main, durable reference docs a
reader actually opens". `docs/PERF.md` is one — README's own Documentation list names it — and its
charter (`:5–9`) is literally "where each budget is measured … and the numbers recorded from a real
run. It is … the living one." Deleting SPEC's perf open item (S1) without relocating the numbers
would destroy the only non-commit-log record of them, which is the opposite of a closeout. This is
the smallest addition that makes S1 honest. **If the orchestrator prefers strict scope, the
alternative is to keep a one-line pointer to commit `5729795d` inside S1 — but the numbers then
live only in a commit message, and `docs/PERF.md` §3's own "run these and record the results here"
convention goes unserved.** Recommendation: take the section.

Insert as a new `###` after §2.12 (`:1470`), before `## 3. Manual procedures`:

```markdown
### 2.13 G3/G8 — the git module's transport, re-measured rather than re-derived

Upstream's ≤300 ms first-paint budget was measured over in-process `postMessage`. v1.3 replaced
that with a Unix socket plus FlatBuffers framing, so `docs/v1.3/SPEC.md` carried a standing note
asking for re-measurement, not re-derivation. G3 built the probe (`TestGraphStreamPerf`) and G8
extended it to nine (`TestG8PerfBaseline`), both in `apps/kira-studio/internal/gitsock/`. Both are
**opt-in** — `KIRA_GIT_PERF=1`, skipped in `-short`, skipped without `git` on `PATH` — and **assert
nothing**: each prints one `key=value` line. That is a decision, not an omission: a hard threshold
in a suite that also runs on real macOS hardware would be flaky in exactly the way
"re-measurement, not re-derivation" warns against.

**This container (Linux, Go 1.27, git 2.43):**

| Probe | Result |
|---|---|
| `graph.stream`, 20 000 commits, one connection | `chunks=10 firstChunk=218ms total=220ms meanBytes/chunk=42167` |
| Same, two connections on **one** repository | A `firstChunk=230ms total=232ms`; B `233ms`/`235ms`; wall `235ms` |
| Same, two connections on **two** repositories (8 000 commits) | A `106ms`/`110ms`; B `110ms`/`110ms`; wall `110ms` |
| `commit.detail` x50 | solo mean `6.05ms`, p95 `7.01ms`; two connections mean `0.097ms`, p95 `0.178ms` (cache-warm) |
| Large patch / blob | `commit.fileDiff` 282 B encoded in `97ms`; `file.read` 1.48 MB encoded (1.44 MB raw) in `49ms` |
| Ranged walk, 200 commits — upstream's own ≤300 ms case | `total=9.5ms` |
| Chunk-size distribution, 20 000 commits | min `42156` / mean `42167` / max `42272` / p99 `42156` bytes |
| Watcher fan-out latency, 1 / 2 / 8 connections | all `~203-204ms` — the watcher's own 200 ms debounce, not fan-out cost |
| `inotify` watches, 2 000 loose refs | 4 watches — a Linux proxy only; it does not answer the macOS kqueue fd-cost question, which G9 removed structurally by switching to FSEvents |

**Three things this says beyond the numbers.** First, **the budget holds with margin**: a
20 000-commit first page lands at 218-235 ms against ≤300 ms, one connection or two, and the ranged
walk the budget was originally written for is 9.5 ms. Second, **`firstChunk ≈ total`** — all ten
chunks leave within about 2 ms of each other, because a whole page (`logsession.DefaultPageSize =
5000`) is read and parsed into the commit store before anything is emitted. First paint is bounded
by `git log` plus parsing, **not** by the socket and not by FlatBuffers, so further transport
optimisation would buy nothing and a page-size change is the lever that would. Third, a page is
~422 KB in 10 chunks of ~42 KB — three orders of magnitude under the 8 MiB frame cap, so frame
sizing is not a live constraint.

**Not measured on real hardware.** These are container numbers, like every other figure in §2. The
macOS equivalents belong in §3's manual procedures, which have still not been run.
```

---

### 3.6 Optional — `docs/v1.3/README.md`

`docs/v1/`, `docs/v1.1/` and `docs/v1.2/` each carry a `README.md` explaining what the folder is
and isn't; `docs/v1.3/` does not. README's Documentation list (R9) follows a
"see `docs/v1.x/README.md`" convention that has nothing to point at for this chapter.

**This is a new file and is therefore outside the row's literal list — offered, not assumed.**
Recommended, because it is cheap and closes an inconsistency the closeout otherwise leaves behind.
If taken, model it on `docs/v1.2/README.md` verbatim, changing only the chapter facts:

```markdown
# docs/v1.3/ — the v1.3 record

v1.2 shipped the **Api** module (`docs/v1.2/SPEC.md`). This folder holds the next chapter, **git**
— a third top-level subsystem beside `studio` and `api`, shipping **headless**: the git backend
runs inside Kira Studio, and the frontend is a separately-installed VS Code extension. It uses a
fresh phase numbering (G1, G2, …) rather than a continuation of v1.2's own. It holds:

- **`SPEC.md`** — the phases this chapter is built against, one row per phase, G1 through G33.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts and never edited afterward.

Same discipline as `docs/v1/`, `docs/v1.1/` and `docs/v1.2/`: all four are kept as originally
written once a phase starts. None is retro-edited to track a later change, so a path or a fact
named inside any of them is true **as of the phase that named it**, and may have moved or changed
since. `docs/ARCHITECTURE.md` is authoritative for how the app actually works today; where the
tree, `ARCHITECTURE.md` and this folder disagree, the tree outranks both, and `ARCHITECTURE.md` is
authoritative for behavior over `SPEC.md`.

`SPEC.md`'s phasing table accrued rows as new phases landed, the same way `docs/v1.1/`'s and
`docs/v1.2/`'s did — it just does not otherwise change what an earlier phase already said about
itself. Its "Known open items" and "Out of scope for v1.3" sections are the one exception, swept at
G33 (the docs closeout) for what the chapter actually resolved.
```

If taken, R9's `docs/v1.3/` entry gains "(see `docs/v1.3/README.md`)" to match the others.

---

## 4. File-by-file change table

| # | File | Change | Kind | Required? |
|---|---|---|---|---|
| R1 | `README.md` | Status bullet: v1.2 shipped, v1.3 is the git chapter and is headless | Replace `:11–14` | Yes |
| R2 | `README.md` | ClickHouse footnote — remove a driver dependency that does not exist | Replace `:59–60` tail | Yes (stale-fact sweep) |
| R3 | `README.md` | **New `## Git features (Kira Version)` section** — preamble + 11 bullets + 2 limits | Insert after `:138` | Yes |
| R4 | `README.md` | Requirements: git 2.38+, VS Code 1.134+, optional `gh` | Insert after `:148` | Yes |
| R5 | `README.md` | Script table: fix `typecheck` count, add 6 scripts, correct `test:unit`, extend `package` | Edit `:187–206` | Yes |
| R6 | `README.md` | App data: `review.db`, `git.sock`, `git.sock.lock`; `KIRA_HOME` scopes the socket | Replace `:208–210` | Yes |
| R7 | `README.md` | Tests: five suites; new `test:webview` bullet; `test:go` git note | Edit `:218–238` | Yes |
| R8 | `README.md` | Architecture: third "worth knowing" bullet; layout block; closing links | Edit `:258–279` | Yes |
| R9 | `README.md` | Documentation: add `docs/v1.3/`, mark v1.2 completed | Replace `:290–292` | Yes |
| R10 | `README.md` | Not shipped: no embedded git UI, no Marketplace | Append to `:303–312` | Yes |
| A1 | `docs/ARCHITECTURE.md` | Stack table: git transport row | Insert after `:42` | Yes |
| A2 | `docs/ARCHITECTURE.md` | **New `## Git module (v1.3)` section** — transport / session model / Go packages / extension | Insert between `:1988` and `:2056` | Yes — the phase's centrepiece |
| A3 | `docs/ARCHITECTURE.md` | Storage: `git_clients` + `git_repo_settings` in the schema block and the growth-bound table; audit-count wording | Edit `:602`, `:842–843`, `:862` | Yes |
| A4 | `docs/ARCHITECTURE.md` | Storage: two `review.db` paragraphs | Insert after `:786` | Yes |
| A5 | `docs/ARCHITECTURE.md` | Process model: name the third process | Replace `:1772–1773` | Yes |
| A6 | `docs/ARCHITECTURE.md` | Bound services: fifteen → twenty-two, grouped by module, `GitClientsService` named | Replace `:1941–1948` | Yes |
| A7 | `docs/ARCHITECTURE.md` | Testing: five suites; webview tier; git Go coverage; fix the dead `CLAUDE.md` pointer | Edit `:2129–2132`, `:2181–2182`, insert at `:2276` | Yes |
| A8 | `docs/ARCHITECTURE.md` | Header: generalise "`docs/v1/SPEC.md`" to any chapter's SPEC | Replace `:11–14` | Recommended |
| M1 | `CLAUDE.md` | Chapter-pointer staleness sweep (4 spots) | Edit `:12–13`, `:33`, `:46`, `:98` | Yes |
| M2 | `CLAUDE.md` | `GOOS=darwin` + `CGO_ENABLED` fact; name `internal/gitclient` in the cgo list | Insert after `:266`; edit `:261–263` | Yes |
| M3 | `CLAUDE.md` | **New `## The git module — running and testing it here` section** | Insert between `:239` and `:241` | Yes |
| M4 | `CLAUDE.md` | `Known open items` | **No change** — still genuinely open | n/a |
| S1 | `docs/v1.3/SPEC.md` | `## Known open items` — delete both resolved items, add the G30–G32 forward note | Replace `:444–453` | Yes |
| S2 | `docs/v1.3/SPEC.md` | `## Out of scope for v1.3` — rewrite all three bullets, bullet 3 substantively | Replace `:433–442` | Yes |
| S3 | `docs/v1.3/SPEC.md` | G33 phasing row: record the out-of-order run | Append to `:346`'s cell | Recommended |
| P1 | `docs/PERF.md` | **New `### 2.13`** — G3/G8 transport re-baseline | Insert after `:1470` | Yes, if S1 is taken (see §3.5) |
| V1 | `docs/v1.3/README.md` | New chapter-record file | **New file** | Optional (§3.6) |
| — | `docs/v1.3/plans/G<N>-*.md` | — | **Explicitly untouched** | — |
| — | any `.go`/`.ts`/`.vue`/`.sql`/`.json` | — | **Explicitly untouched** | — |

**Commit shape.** One commit per document, `docs:` per Conventional Commits, in this order so each
is independently droppable and the SPEC deletions land last (after the docs they point at exist):

1. `docs: describe the git module in ARCHITECTURE.md — transport, session model, packages` (A1–A8)
2. `docs(readme): the git module, and the script/test/layout drift found beside it` (R1–R10)
3. `docs: record G3/G8's transport perf re-baseline in PERF.md` (P1)
4. `docs(agents): the darwin cgo cross-compile constraint, and running the git module here` (M1–M3)
5. `docs(v1.3): sweep Known open items and Out of scope against what G1–G29 closed` (S1–S3)
6. *(if taken)* `docs(v1.3): add the chapter README, matching v1/v1.1/v1.2` (V1)

---

## 5. Verification

Docs-only, so verification is correctness of claims and links, not a test suite.

1. **Nothing but Markdown changed.** `git diff --stat` lists only `.md` files; `git status` shows
   no other modification. This is the phase's hard gate — the row says "No new code".
2. **Every path, identifier and number named in the new prose exists.** Spot-check the load-bearing
   ones, all of which §1.5 recorded from source: `gitrpc.ContractVersion == 30` ≡
   `validate.ts:97`; `"KIG1"` in `gitwire.fbs`; `RequiredVersion = "2.38.0"`; `refs/kira/globalstash/`;
   `${KIRA_HOME}/git.sock` and `git.sock.lock` in `main.go:145–146`; 46 RPC methods; 46 contributed
   commands; 22 `application.NewService` registrations; `git_clients` / `git_repo_settings`
   migrations `0016`/`0017`; `review_{session,file,range,comment}`; `TestGraphStreamPerf`
   (`graphstream_test.go:593`) and `TestG8PerfBaseline` (`perf_test.go:71`); every `packages/*` and
   `apps/*` directory in the new layout block.
3. **Every relative link resolves.** New/changed links: `docs/v1.3/SPEC.md`, `docs/v1.3/plans/`,
   `docs/v1.3/README.md` (only if V1 is taken), `docs/pending-workflows/test-matrix.yml`,
   `docs/PERF.md`. A trivial loop over Markdown link targets is enough.
4. **No dangling cross-reference is created or left.** `docs/PERF.md` §2.13 must exist if S1 cites
   it; the ARCHITECTURE Git module section must exist if S1 and the README cite it. Re-grep for
   `CLAUDE.md`'s Known open items as a *citation target* after A7 lands — the one dead pointer is
   the only occurrence.
5. **`bun run lint`** still passes (Biome does not lint Markdown, but this catches an accidental
   non-doc edit for free). No typecheck/test run is warranted; nothing they cover changed.
6. **Read the three new long sections end to end once**, against their host documents, for register
   — ARCHITECTURE's git section beside its Api section (`:1146–1174`), README's git section beside
   its Api section (`:120–138`), AGENTS' git section beside its Docker section (`:137–171`). A
   docs phase's real failure mode is a section that is accurate and reads like it was pasted in
   from somewhere else.

---

## 6. Handed forward

### 6.1 The two things this pass could only half-do, and why

**(a) `CLAUDE.md`'s "notes the three review rounds produced" — not started, because there is
nothing to fold in.** The SPEC row asks for the environment/convention notes G30–G32 produce.
**G30, G31 and G32 have not run.** There are no findings, and manufacturing what a review round
"probably" finds would be exactly the fabrication `CLAUDE.md:41–42` forbids ("a round that finds
nothing real should say so rather than manufacture a finding"). What §3.3 delivers instead is every
durable environment/convention note **G1–G29's own shipped work** actually produced — the darwin
cgo cross-compile constraint (measured in G29), the git module's operational section, and the
chapter-pointer staleness sweep. **Follow-up required after G32:** re-read `CLAUDE.md` against the
three rounds' findings and append only what is a *standing rule* for how this team works or a
*durable fact about this environment* — routing anything that is a fact about the app to
`docs/ARCHITECTURE.md` instead, per `CLAUDE.md:3–5`, and anything that is one round's discovery to
that round's commit log, per `CLAUDE.md:43–45`.

**(b) `docs/v1.3/SPEC.md`'s "Known open items" sweep — done for G1–G29, one pass still owed.** Both
items the section carried are closed and removed (§3.4 S1), each with cited evidence from shipped
code, not from a plan doc's claim of intent. What cannot be done is the other half: an item that
G30–G32 will surface, or one of theirs that stays genuinely open. §3.4 S1's replacement text says
so explicitly and in place, so the next reader is not misled into thinking the section is final.
**Follow-up required after G32:** sweep the section once more — add whatever round 3 leaves
genuinely open, and delete anything the rounds themselves closed. That pass is the chapter's actual
last act, and G33's own SPEC row should probably be read as covering it.

**A note on sequencing for whoever runs that pass.** It is a small, well-bounded follow-up — one
more read of `CLAUDE.md` and one more read of two SPEC sections — not a re-run of G33. Nothing in
§3.1, §3.2, §3.5 or §3.6 needs revisiting: README, ARCHITECTURE and PERF describe **shipped code**,
and a review round that changes shipped behaviour would need to update them the same way any phase
does, which is ordinary practice rather than a G33 debt.

### 6.2 Genuinely open items this pass found and cannot close

| Item | Status | Owner |
|---|---|---|
| **First-launch window-size clamp** (`CLAUDE.md:126–135`, P22 D6(a)) | Still open. Closing it needs startup window creation deferred past `ApplicationDidFinishLaunching` — a structural change no G-phase made | Unowned; left in `CLAUDE.md` verbatim |
| **`docs/pending-changes/.github__workflows__release.yml.patch`** is still present, i.e. still unapplied | Self-documenting by `CLAUDE.md:120`'s own convention ("a pending-changes entry that's still there means it hasn't been applied yet"). No doc change warranted — it needs a human with push credentials, not a note | The user |
| **`docs/pending-workflows/test-matrix.yml`** is staged, not live | Same shape. A7 fixes only the *pointer* to it, which was dead; the workflow itself still needs applying | The user |
| **`docs/PERF.md` §3's macOS packaged-build procedures have never been run** — no macOS hardware in this environment | Long-standing (`docs/PERF.md:14–16`), not created by v1.3. §2.13's closing line records that the git numbers share this limit rather than implying otherwise | Unowned; needs real hardware |
| **G8's own plan `§12` still holds only pre-phase baseline figures**, because that session was told not to edit its plan doc and flagged the carry-over for the orchestrator, which never happened | **Deliberately left as-is.** `docs/v1.3/plans/` is explicitly out of scope for this phase, and a plan doc is a historical record, not a living one. §3.5's `docs/PERF.md` §2.13 is where those numbers now live durably — which is the better home regardless | Closed by relocation, not by editing the plan |
| **Five Go packages exist that `docs/v1.3/SPEC.md` §2's own package table never listed** — `gitpath`, `gitprepare`, `gitvsix`, `startupfail`, and `gitsearch`'s final shape | **Not a SPEC edit.** §2 is that chapter's design record as written; ARCHITECTURE's package table (§3.2 A2) is built from the tree and is authoritative for what exists today, which is exactly the division of labour both documents' own headers already state | Closed by A2 |

---

### Critical Files for Implementation

- `/home/user/kira-studio/README.md`
- `/home/user/kira-studio/docs/ARCHITECTURE.md`
- `/home/user/kira-studio/CLAUDE.md`
- `/home/user/kira-studio/docs/v1.3/SPEC.md`
- `/home/user/kira-studio/docs/PERF.md`
