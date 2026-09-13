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

_Running — Arm A (MCP) and Arm B (no MCP) both implementing `82f5f1e0`'s plan in parallel, in their
respective worktrees._
