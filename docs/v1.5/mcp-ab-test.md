# Repo-map MCP: A/B validation experiment

## Question

Does the repo-map MCP server (C3) actually reduce token usage on real work, without hurting
correctness or speed — measured on real implementation, not a synthetic benchmark.

## Design

Run C7 (repository search: in-file plus repository-wide, Go-native — no ripgrep, see
`docs/v1.5/SPEC.md`'s Grounding section) **twice**, from the same base commit (v1.5 at C6 complete,
before C7/C8 exist), on two isolated worktrees:

- **Arm A**: repo-map MCP server running and registered for that worktree.
- **Arm B**: identical setup, MCP server not registered (its default-off state).

Both arms get:

1. The same Opus planning prompt, word-for-word, run in parallel — one plan per arm, each
   committed to its own worktree/branch.
2. **Pick the better of the two plans** (correctness, completeness, fit with C5/C6's shipped
   shape) and use that single plan for both arms' implementation. Implementing two different
   plans would let a plan-quality difference explain an implementation-time or token difference —
   the number would then reflect "which plan was better," not "does the MCP server help." Using
   one plan for both makes the implementation stage's only variable the MCP server's presence.
   Note which plan won and why, but discard the losing plan's own implementation-relevant content
   — it does not get built.
3. The same Sonnet implementation handoff, run in parallel, each implementing the **one chosen
   plan** to completion (build, tests, verification) on its own branch — Arm A with the MCP
   server registered, Arm B without.

C7 was chosen (over a smaller synthetic task) for being real, bounded, and genuinely
implementation-dependent: it needs the agent to choose a Go-native search implementation (a
hand-rolled walk-and-scan over C1's or C8's own file-enumeration source vs. a pure-Go search
library, weighed against `CLAUDE.md`'s library-reuse bar), design how matches stream back, and
wire a result click into C5's workspace as a preview tab — real decisions, not scripted lookups.
Smaller than C9 (the git-graph phase, ~30 Vue files + ~20 Go files) on purpose: two full parallel
implementations of something C9-sized was judged too expensive to run twice for a measurement.

## Metrics

Planning stage (both plans, before one is picked): `subagent_tokens` and `duration_ms` per arm,
tool-call count/shape, and which plan was chosen plus why — recorded for transparency, but not
the headline number (see Design step 2: a plan-quality gap would confound it).

Implementation stage (the number this test is actually for — one plan, two arms):

- `subagent_tokens` and `duration_ms` from each arm's own completion report.
- Tool-call count and shape (how much of it is repo-map queries vs. Read/Grep/Glob) for Arm A.
- Whether the two arms converge on materially the same implementation, or diverge, and if they
  diverge, whether one is meaningfully more correct — with a fixed plan, a divergence here is
  itself a finding about what the MCP server changed.

## Mechanics as actually run

Per `CLAUDE.md`'s own repo-map section (corrected during C4/C5 dogfooding): native MCP registration
never surfaces tools to a subagent in this harness at all, regardless of worktree. So "Arm A has
MCP" means Arm A's agent is instructed to call a real `kira-repo-map` server instance (started with
`-repo <arm-A-worktree>`) over raw HTTP/JSON-RPC via `curl`, per `CLAUDE.md`'s documented recipe;
Arm B's agent gets no server and is told not to attempt any MCP/curl call. Two literal git worktrees
(`/home/user/kira-studio-c7-arm-a` on branch `v1.5-c7-arm-a`, `/home/user/kira-studio-c7-arm-b` on
branch `v1.5-c7-arm-b`), both branched from `v1.5` at `daa59624` (C6 complete), rather than two
sibling subagents sharing one tree — this resolves the "mechanics to confirm" question the design
left open: worktree isolation, not subagent-config isolation, is what made per-arm MCP availability
actually differ.

## Results

### Planning stage

- **Arm A** (MCP): plan committed `955ddb55` on `v1.5-c7-arm-a`. 746 lines. `subagent_tokens`
  241,160; `duration_ms` 898,689 (~15.0 min); 67 tool uses (~33 repo-map MCP calls, ~35
  Read/Grep/Bash). Logged one real repo-map gap while dogfooding: constant declarations (Go `const`,
  TS `export const`) are absent from the index — `search_symbols`/`find_definition`/`find_references`
  all answer "not found" for one, across both languages.
- **Arm B** (no MCP): plan committed `82f5f1e0` on `v1.5-c7-arm-b`. 744 lines. `subagent_tokens`
  245,345; `duration_ms` 671,131 (~11.2 min); 60 tool uses, 0 MCP calls (24 Read, 2 Grep, ~16 Bash
  inspection, 0 Glob).
- Both plans converged heavily despite the tool-access difference: identical no-library decision
  (stdlib `regexp`/RE2 plus git's own `ls-files` plus a hand-rolled scanner), identical
  results-live-in-the-panel-not-a-tab-kind call, identical streaming design lineage (the `grpcCoalescer`
  push-channel precedent), identical "not an op-log op" and "no `EnsureIndex`" calls, and — found
  independently, by each arm reading the same source — the *same* real pre-existing bug (Cmd+F is a
  no-op in a repo file tab today, because `SHORTCUTS['view.find']` is a global native-menu
  accelerator that no repo view registers a handler for).
- **Chosen plan: Arm B's** (`82f5f1e0`), used for both implementation arms — copied into
  `kira-studio-c7-arm-a` as commit `897f0caa`, replacing Arm A's own plan there. Decisive factors,
  both safety/robustness, not style: (1) Arm B routes every candidate path through the existing
  `ValidateRelPath` boundary (resolves the *whole* path, catching a symlinked intermediate
  directory); Arm A instead skips symlinked files via a leaf-only `os.Lstat` check, which is cheaper
  but does not catch that case — a real gap for a phase whose entire job is opening every file in
  the worktree, not just ones a user clicks. (2) Arm B streams via `bufio.Scanner` with an explicit
  huge-single-line skip (`maxSearchLineBytes`), bounding peak memory at `workers × 1 MiB`; Arm A
  reads whole files up to the 8 MiB viewer cap, bounding it at `workers × 8 MiB` with no dedicated
  minified-file guard. Arm A had real strengths not carried over (single-regex-path simplicity
  instead of Arm B's literal-fast-path/regex dual matcher; a generic `coalescer[T]` extraction
  shared with the gRPC path instead of a second small coalescer; a more forensic trace of the Cmd+F
  root cause down to `menutemplate.go:88`) — noted for the record, not merged in, per this
  experiment's own rule that only one plan gets built.

### Implementation stage

- **Arm A** (MCP): `d8040ce6..3b4236d0`, 11 commits, `v1.5-c7-arm-a`. `subagent_tokens` 498,227;
  `duration_ms` 3,012,077 (~50.2 min); 320 tool uses (~9 repo-map MCP calls — 1 `tools/list`, 6
  `outline_file` on the six new/touched Go files, 2 `find_references`/`find_definition` — vs.
  ~60-70+ Read/Grep/Bash). Self-reported honestly: `outline_file` saved a discovery step on
  unfamiliar Go files but every file still needed a full `Read` after it for exact shapes; the two
  `find_references`/`find_definition` calls were the clearest wins (confirmed all 4 real callers of
  `openRepoFileTab` in one call). No MCP use on the ~25 Vue/TS files touched.
- **Arm B** (no MCP): `82f5f1e0..ab4cc36a`, 11 commits, `v1.5-c7-arm-b`. `subagent_tokens` 498,521;
  `duration_ms` 3,026,399 (~50.4 min); 303 tool uses (~90 Read, ~20 Grep, ~110 Bash), 0 MCP calls.
- **Independently verified both** (not just trusting each arm's own report): `go build ./...`,
  `go vet ./...`, `go test ./apps/kira-studio/internal/...` green for both; `bun run typecheck`,
  `bun run lint` (same one pre-existing unrelated info-level note in both,
  `UncommittedChangesStrip.vue`), `bun run build` green for both; `bun run test:unit` 1284/1284 pass
  for both; `bun run test:ui` (repo-workspace/tabs/mode-switch/smoke/connection-dialog-tabs) 17/17
  pass for both — including Arm B's own self-reported `mode-switch.spec.ts` flake, which passed
  clean on this independent re-run, confirming it was a load-based flake and not a real C7 defect.
- **Tokens and duration came out within noise of each other** (498,227 vs. 498,521 tokens; 50.2 vs.
  50.4 min) — MCP availability did not measurably change implementation-stage cost on this task,
  despite Arm A spending real tool calls on repo-map queries instead of Read/Grep. This is the
  headline finding: with a fixed plan, an already-warm mental model of the codebase (both arms had
  just read the same six Go files and ~25 Vue/TS files during dogfooding/verification), and a task
  this size, repo-map's targeted-answer savings on the *files it was used on* didn't show up as a
  measurable end-to-end win, because it wasn't used on most of the phase's own surface area (the
  Vue/TS side) and the Go side still needed full reads regardless per Arm A's own admission.
- **Convergence, spot-checked directly** (not just from each arm's self-report): both independently
  implemented `ValidateRelPath` as the sole gate on every candidate path (`search.go:274` in Arm A,
  `search.go:265` in Arm B) and `bufio.Scanner` with the identical `maxSearchLineBytes = 1 * 1024 *
  1024` cap (Arm A `search.go:26`, Arm B `search.go:25`) — the plan's two decisive safety points from
  the planning-stage comparison both landed correctly and identically in both implementations.
  Genuine implementation-level divergences, none safety-relevant: Arm A's `CancelSearch` uses the
  existing `session()` helper; Arm B's uses a plain `Registry.Lookup` (the plan left `CancelSearch`'s
  signature under-specified — both are reasonable, neither is wrong); Arm B removed a redundant
  `stripCR` after discovering `bufio.Scanner`'s default split already strips it, a cleanup Arm A
  didn't make (dead code, not a defect); Arm A's in-file search binds Monaco's `view.find`, Arm B's
  binds `StartFindAction` directly — same outcome (opens Monaco's own find widget on a read-only
  editor), different call site, both correct per the plan's own D13.
- **Verdict**: no measurable MCP win on this phase, and no regression either. Proceeding to C8
  (source-line context on repo-map results) as planned — the improvement C8 targets (avoiding the
  "still needed a full Read afterward" pattern Arm A reported) is precisely the mechanism that could
  turn this into a real difference on the re-run. Canonical-implementation choice deferred until
  after the C8 re-run (see below), so the comparison is apples-to-apples on the same close call.
