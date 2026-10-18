# P299 pilot: distill 10 SPEC units

Planner run, 2026-10-18, tree `08394d55`. Real pipeline: `go build -tags server ./apps/kira-space`, one
`kira-space memory-mcp` process per unit (temp `KIRA_MEMORY_HOME` and `KIRA_SPACE_HOME`, default prompts), MCP
`tools/call` `ingest_files` with `{distill: true, text}`. Claude CLI 2.1.302. Driver was a throwaway Bun script
in the planner's scratchpad (newline JSON-RPC over stdio), not committed; the P299 tool replaces it.

Unit = one phase: `# <chapter> <id>`, the row title, `Status:` when the table has a Status column, the other row
cells as paragraphs, then `## Result` with the phase's `## P<n> result` section(s). Picked by size percentile,
one per chapter, plus the largest unit of all (`v2.0 P131 Part 2`).

## Results

| unit | in chars | lines | out chars | USD | wall s |
|---|---|---|---|---|---|
| v1.3 G5 | 146 | 1 | 140 | 0.018 | 7.4 |
| v1 P16 | 466 | 5 | 495 | 0.042 | 15.0 |
| v1.1 P16 | 889 | 3 | 517 | 0.019 | 9.5 |
| v2.0 P181 | 1,193 | 6 | 963 | 0.039 | 19.6 |
| v2.2 P212 Part 1 | 1,621 | 10 | 1,152 | 0.035 | 13.7 |
| v1.7 M1 | 1,715 | 11 | 1,549 | 0.055 | 22.8 |
| v1.2 P15 | 2,503 | 12 | 1,983 | 0.060 | 24.2 |
| v1.8 P90 | 5,813 | 13 | 2,064 | 0.068 | 25.2 |
| v1.9 P98 | 9,171 | 17 | 2,456 | 0.093 | 32.1 |
| v2.0 P131 Part 2 | 25,179 | 32 | 5,646 | 0.249 | 40.4 |

- `v1.9 P98` first try failed: `Claude Code failed: exit 1` after 23.8 s, no cost reported (the error path
  returns none). Retry passed. 1 failure in 11 calls.
- A first `v1.3 G5` try put the title only in the H1: 0 lines out (0.011 USD). Title text must be a body
  paragraph; the rerun above has it.
- Output/input: 0.6 to 1.06 under 2,500 chars, 0.22 to 0.36 above 5,000. Mean line 154 chars. 0 unresolved.

## Spend

Reported: 0.689 USD over 11 successful calls (`spend.jsonl` `costUsd`). The failed call reports no cost; the
ledger charges it the 2.00 USD per-call cap, so the logged ceiling is 2.689 USD. Under the 5 USD planner limit.

## Quality check against source

Read side by side (source unit vs `units.jsonl` `out`) for `v1 P16`, `v1.2 P15`, `v2.2 P212 Part 1`; marker
lines (decision, declined, rather than, instead of, supersed...) vs output for `v1.9 P98`, `v1.8 P90`,
`v2.0 P131 Part 2`.

- Faithful: no invented fact found. Every decision marker in the six units is carried, reworded: P15 "answers
  what P4 D15 declined", "UI-level promotion ... not a new wire vocabulary", P98 "rather than hand-roll", P90
  "all-pointer Options instead of package constants", P131 "own harness instead of fakeGraphHost".
- Reasons kept with decisions ("because primitives already live in the shared theme layer").
- Not compressed for small units: a 466-char row became 5 lines, 495 chars. Lines restate the phase id.
- Large units keep operational trivia: sandbox limits, fixture gaps, a refused push, flaky specs. True, but low
  value for a history. The pipeline has no knob for that; prompt changes are out of P299 scope.
