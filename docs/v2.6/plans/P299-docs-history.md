# P299 plan: docs history

SPEC row P299 (`docs/v2.6/SPEC.md`) plus three user amendments relayed 2026-10-18: distill is real (MCP
`ingest_files` distill), a CLAUDE.md chapter-rollover rule, and cost measured by a planner pilot with no hard
cap. Base: `08394d55` (v2.6). Planner: Opus. Implementer: one sequential Sonnet subagent, after the user accepts
the Cost section. No split: the tool's parser feeds distill, render, verify and repoint, and deletion waits on
all of them. Nothing below is started except the pilot.

Discovery: `codegraph_explore` over `evalPlansDir memory eval corpus runs`, `check-docs.ts check-conventions.ts`,
`memorycli Run addIngestTools ingestInput ingestOutput Distiller Distill`, `memorycli/run.go NewCLIRunner`,
`DefaultBudget ChunkMarkdown tooManyFacts verifyBatch`. Docs are not indexed: SPEC headings and table first
cells surveyed by grep only; no old SPEC read whole. Pilot: `P299-pilot/pilot.md`.

## Cost

From the pilot (10 units, real pipeline; `P299-pilot/`). Units: 457 phases plus 13 chapter-notes units.

- Per unit: mean 0.068 USD, spread 0.018 (146 chars) to 0.249 (25,179 chars). Fixed part dominates small
  units (0.13 USD per 1,000 chars at 146 chars, 0.010 at 25,000). Wall 7 to 40 s per unit.
- Projection, pilot points interpolated by unit size, per chapter (units, input KB, USD, serial min):
  v1 53, 143, 2.67, 17 · v1.1 22, 18, 0.77, 5 · v1.2 30, 135, 1.95, 11 · v1.3 34, 41, 1.25, 9 ·
  v1.4 7, 19, 0.42, 3 · v1.5 14, 19, 0.57, 4 · v1.6 23, 32, 0.90, 7 · v1.7 10, 14, 0.39, 3 ·
  v1.8 25, 179, 2.07, 12 · v1.9 57, 661, 6.74, 31 · v2.0 89, 432, 5.95, 32 · v2.1 26, 28, 0.86, 6 ·
  v2.2 67, 96, 2.67, 19.
- Total: 27.2 USD for phases, about 0.7 for notes units, about 3 for retries (pilot: 1 failure in 11, each
  retry about 0.07). **Expected about 31 USD.** Wall: 159 min serial; 3 workers (D4) about 60 to 75 min.
- Worst case, every unit at the pilot's high envelope (0.06 USD fixed plus 0.012 per 1,000 chars) plus 10%
  retried: about 50 USD, about 2 h. Theoretical ceiling: per-call cap 2.00 USD times about 520 calls, about
  1,040 USD; it needs every call to hit its cap, which no pilot call came near (max 0.25).
- No hard cap in this plan; the user decides. The tool still takes `--max-usd` (D4) for the orchestrator to set.
- Output: pilot ratio projects about 700 KB of distilled lines, so `HISTORY.md` is about 740 KB, 4,600 lines.
  Largest chapter section v1.9 about 175 KB. Not readable in one go; D5 picks full output, read per chapter.
  Alternative for the user: a render cap of 8 lines per phase gives about 470 KB, and drops lines in source
  order (decisions late in a result section are lost).

## 1. Current state (verified)

- `docs/` chapters: v1, v1.1 to v1.9, v2.0, v2.1, v2.2, v2.5, v2.6 (no v2.3, v2.4). Each has `SPEC.md`,
  `plans/`, a `README.md` (1 to 3 KB) except v2.5/v2.6. Extra files: `v1.1/WEBVIEW-SCROLL-MEMORY.md` (29 KB,
  a live measurement method, cited by `DEV_ENVIRONMENT.md:863`, `PERF.md`, `internal/shell/*.go`,
  `perfProbe.ts`, `wkhost.swift`), `v1.5/mcp-ab-test.md`, `v1.{5,6,7,8}/mcp-repo-map-issues.md` (repo-map, dropped
  in P97). `v2.2/plans/P2{56,58,61}-shots/*.png` (15 files).
- Shapes (grep of headings and table first cells):
  - v1 to v2.1: `| Phase | Deliverable | Why here |`, first cell `**<id> <title>**`. v1 splits it over 4
    tables (header only on the first). No status column; v2.0 rows carry `**Done**`-style tokens.
  - v2.2, v2.5, v2.6: `| Phase | Title | Status |`, first cell `P<n>` or `P<n> Part <k>`.
  - v1.3: upstream table `| Phase | Status upstream | Lands in this chapter as |` (upstream's P0 to P16, not
    this chapter's phases) and `| # | Deliverable | Depends on | Covers upstream |` with `**G<n>**` rows.
  - IDs: `P<n>` (v1, v1.1, v1.2, v1.4 restart at P0/P1, so IDs repeat across chapters), `P5.5`, `P58f`,
    `P52-P57`, `P<n> Part <k>`, `C<n>` (v1.5), `M<n>`/`M1ab`/`M1c` (v1.7), `G<n>` (v1.3).
  - Result sections: `## P<n> result`, `## P<n> Part <k> result`, `## P<n>, P<n>, P<n> result`,
    `## P<n>-P<n> result`, `## P<n> landing note`, `## M1ab result` in v1.7 to v2.2. v1 to v1.6 keep results in
    the row prose. v2.0 has 26 plans with `## Result

Done. Folded v1 to v2.2 into `docs/HISTORY.md`; v2.5 and v2.6 stay.

- Units: 470 (457 phases, 13 notes), all `ok`. 0 fallback, 0 pending. 4 units failed first pass with
  `Claude Code failed: exit 1` (v1-p40, v1-p45, v1.2-p3, v2.0-p126); a `--retry-fallback` rerun passed all four.
- Ledger (`P299-runs/spend.jsonl`, 510 calls, 40 failed): real spend 29.04 USD (sum of `costUsd` on ok calls).
  Ledgered 39.04 USD (failed calls charged by the tool; cost is not returned on error). Plan estimate was about 31.
  Final run `--max-usd 60` never bound.
- Throttle: v1 finished with `--jobs 1`. Added rate-limit handling (`362ec85c`): a rate-limit error waits with
  backoff, charges 0 and does not consume a try. None occurred in the v1 run.
- `docs/HISTORY.md`: 913,049 bytes, 6,106 lines, no per-phase line cap. Rerun `render` before and after
  deletion: `git diff --exit-code` clean.
- Verify (`P299-verify.md`, 12 sampled phases): every sample has its block and lines; sampled decisions
  (P175, P108 Part 13, P80, P12, ...) are carried. `[CHECK]` lines are marker phrases ("rather than") in
  neighbouring rows, read by hand, no lost decision found.
- Repoint: 199 references in 111 files, plus 14 hand edits (wrapped paths, `G`/`M` plan refs, mockup comments,
  PACKAGING staging dirs, README). `git grep` for `docs/v(1|1.x|2.0-2.2)/` is empty outside the tool's own
  fixtures (`scripts/docshistory`), `docs/pending-changes/` and `.github/workflows/`.
- Deleted: 528 tracked files under 13 chapter folders. `WEBVIEW-SCROLL-MEMORY.md` moved to `docs/`.
- Checks: `go test`, `go vet ./scripts/...`, `bun run lint:go` (0 issues), pre-commit hooks passed on every commit,
  `check-docs.ts` clean.

Deviations: `release.yml` needs no new patch hunk, the existing patch already deletes both commented lines.
CLAUDE.md rule now passes `--runs docs/history-runs` (tool default is the P299 dir). `repoint` also rewrote the
tool's own test fixtures once; reverted by hand. Not run: real-`claude` suites (none touched).
