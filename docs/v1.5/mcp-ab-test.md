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
2. Once both plans land, the same Sonnet implementation handoff, run in parallel, each
   implementing its own arm's plan to completion (build, tests, verification) on its own branch.

C7 was chosen (over a smaller synthetic task) for being real, bounded, and genuinely
implementation-dependent: it needs the agent to choose a Go-native search implementation (a
hand-rolled walk-and-scan over C1's or C8's own file-enumeration source vs. a pure-Go search
library, weighed against `CLAUDE.md`'s library-reuse bar), design how matches stream back, and
wire a result click into C5's workspace as a preview tab — real decisions, not scripted lookups.
Smaller than C9 (the git-graph phase, ~30 Vue files + ~20 Go files) on purpose: two full parallel
implementations of something C9-sized was judged too expensive to run twice for a measurement.

## Metrics

For each stage (planning, implementation), each arm:

- `subagent_tokens` and `duration_ms` from that agent's own completion report.
- Tool-call count and shape (how much of it is repo-map queries vs. Read/Grep/Glob) for Arm A.
- Whether the two arms converge on materially the same design/implementation, or diverge, and if
  they diverge, whether one is meaningfully more correct.

## Mechanics still to confirm at run time

- How per-worktree MCP availability is actually wired for a spawned subagent in this harness —
  subagents may inherit the orchestrating session's own tool/MCP configuration rather than take
  a per-agent config, in which case Arm A and Arm B may need to run as genuinely separate
  sessions rather than sibling subagents of one session. Resolve this against the harness's real
  behavior when C3 exists, not by assumption now.

## Results

_Not yet run — pending C6 (diff tabs and code navigation) landing, so the base commit has the full
C5+C6 workspace this test's own task (C7, search) opens results into._
