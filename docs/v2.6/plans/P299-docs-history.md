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
    the row prose. v2.0 has 26 plans with `## Result`. Other `##`/`###` headings (`## Chapter close`,
    `### 8.18 Browse panel (P41)`) are chapter prose.
  - Number tables (`| # | Check | Result |`, rows `| 1 |`) never match the ID pattern.
- Sizes: phase units 1.82 MB, 457 units, median 1.7 KB, max 25 KB; none over `MaxDistillRunes` 120,000 or 16
  chunks. Marker lines outside tables and result sections: 151; marker lines naming another phase: 49.
- Distill pipeline: `memorycli.Run` (`kira-space memory-mcp`, `appwire/wire.go:57`) wires
  `importer.Distiller` into `ingest_files`; `distillInput` (`mcpserver/ingest.go:162`) takes `{distill, text}`,
  returns `structuredContent.lines[].text`, `unresolved`, `costUsd`; on error returns no cost. Per call:
  `DistillSpendCapUSD` 2.00, 3 extract workers, no retry. go-sdk v1.8.0 in `go.mod`; client precedent
  `mcp.CommandTransport` in `internal/claudeheadless/usermcp.go:166`. No MCP SDK in the JS deps.
- Runtime readers of `docs/v*/`: only the memory eval harness. `memory_eval_corpus_test.go:37,44,48` joins
  `docs/v2.5/plans/` for `P285-corpus`, `P291-corpus`, the runs dirs (`P285-runs`, `KIRA_EVAL_RUNS_DIR`) and
  `<dir>/<round>` refs; `internal/llmprompts/cmd/promptsizes/main.go:39` defaults to
  `docs/v2.5/plans/P289-runs/allowed-losses.tsv`; `biome.json:18-20` excludes three v2.5 run dirs; the site page
  `memory-formats.md` lists v2.5/v2.6 plans as `sources:` (checked to exist by `docsRules.ts:235`). Corpus
  sources under `docs/v2.0`, `docs/v2.2` are read by `git show 9ed83ae8:<path>`: deletion-safe.
  `memory_docs_test.go`/`memory_ingest_test.go` `docs` paths are temp repos.
- References to v1 to v2.2 outside `docs/v*/`: 198 lines in about 120 files (Go/TS comments, `scripts/*.sh`
  error hints, `check-conventions.ts:486` message, `.githooks/pre-commit:2`, `.github/workflows/release.yml:15,53`,
  `ARCHITECTURE.md` 30, `PERF.md` 24, `PACKAGING.md` 6, `DEV_ENVIRONMENT.md` 6, `CLAUDE.md:49`, app READMEs,
  `searchConformance.json` `_comment`). `README.md:262` calls v2.5 the current chapter.
- Hooks: pre-commit runs biome on staged files, `check-docs.ts` on `.md` (site content only), full lint and
  typecheck when `scripts/`, `.githooks`, `biome.json` change. Biome lints JSON, not `.md` or `.jsonl`. No hook
  or lint reads `docs/v*/`.

## 2. Decisions

### D1. Tool: Go, `scripts/docshistory/`

`package main`: `main.go` (subcommands), `parse.go`, `units.go`, `distill.go`, `render.go`, `verify.go`,
`repoint.go`, `parse_test.go`. Run `go run ./scripts/docshistory <cmd> [flags] <chapter...>`. Go because the
distill call is MCP and go-sdk is already a dependency; a Bun MCP client would need a new dep or a hand-rolled
JSON-RPC client. No new deps. Deterministic: sorted output, no timestamps, source pinned by commit (D3).

Subcommands, each on named chapters only: `distill` (tokens), `render`, `verify`, `repoint` (all zero tokens),
`fold` (all four in order, stops after verify's report for the human or agent check). `units <ch>` prints the
unit list and sizes, zero tokens. `--only <slug,...>` limits any subcommand to listed units. Refuses `v2.6` and any chapter with uncommitted changes under `docs/<ch>/`.

### D2. Parsing rules (`parse.go`)

- ID: `(?:[PCMG]\d+(?:\.\d+)?[a-z]*(?:\s*-\s*[PCMG]?\d+[a-z]*)?(?:\s+Part\s+\d+)?)`; whitespace collapsed.
- Phase rows: every table row whose first cell, `**` stripped, starts with an ID, in any table, in file order.
  First occurrence wins. Title: rest of the first cell (leading `:` stripped); if empty, the `Title` column.
  Status: the column headed `Status` (v2.2+ shape), first sentence, at most 80 chars; else the first bold
  status token in the row (`**Done**`, `**Landed**`, `**Superseded ...**`, `**Dropped**`, `**Deferred**`);
  else empty. A table whose header has `Status upstream` is skipped (one rule, named for v1.3).
- Result sections: `^#{2,3} <ID>(, <ID>)* (result|landing note)\b` (case-insensitive); body runs to the next
  `#`/`##` heading. A comma list or range heading files the same body under each listed ID. A section with no
  row creates a phase with empty title. v2.0 plans: a `## Result` section (or `# P<n> result`) of a plan file
  whose name starts with the ID (`P131-part2-...` maps to `P131 Part 2`) is appended to that unit.
- Chapter notes: marker lines (D4 list) outside tables and outside result sections, plus the README's first
  paragraph and marker lines of the extra `.md` files. Marker lines naming another phase's ID are also
  appended to that phase's unit under `## Mentioned elsewhere`.
- `parse_test.go` (a parser with interacting rules, allowed by `CLAUDE.md`): fixtures for both table shapes,
  v1's headerless continuation tables, the v1.3 skip, `P5.5`/`P58f`/`P52-P57`/`Part k`, comma and range result
  headings, number tables ignored, section splice idempotency (D5).

### D3. Units (`units.go`)

Unit text (markdown): `# <chapter> <id>`, blank line, title as a paragraph (the pilot's title-only H1 gave 0
lines), `Status: <s>`, each other row cell as a paragraph, `## Result` with the result bodies, `## Mentioned
elsewhere` with cross lines. Chapter notes unit: `# <chapter> notes` plus its lines. Slug
`<chapter>-<id lower, non-alnum to ->`. `inputSha256` of the text. Source commit: `git log -1 --format=%H --
docs/<ch>` (contains the files; stable until deletion).

Markers: decision, decided, user override, declined, rejected, instead of, rather than, supersed*, reverted,
renumbered (word-bounded, case-insensitive).

### D4. Distill (`distill.go`)

- Binary: `go build -tags server -o <tmp>/kira-space ./apps/kira-space` once per run, or `--binary <path>`.
- Per unit: spawn `<bin> memory-mcp` with fresh temp `KIRA_MEMORY_HOME` and `KIRA_SPACE_HOME` (user DB never
  touched; default prompts), connect with `mcp.CommandTransport`, call `ingest_files` `{distill: true, text}`,
  read `lines[].text`, `costUsd`, `unresolved` count; close. One process per unit isolates failures (1 s
  overhead against 7 to 40 s calls). Context timeout 15 min per unit.
- Workers: `--jobs 3` default (each distill runs up to 3 extract calls, so at most 9 `claude` processes).
- Retry: a tool error other than a refusal (`input is ... the limit is`, `splits into`, `too many facts`,
  spend-cap text) is retried once after 30 s.
- Fallback (refused, or failed twice): record `state: "fallback"` and the error; render shows title, status,
  row's first sentence (180 chars) and the unit's marker lines (each 200 chars), then `(not distilled: <reason>)`.
- Spend: `spend.jsonl` line per call `{slug, try, ok, costUsd, charged, wallMs}`; a failed call is charged
  2.00 USD (no cost on the error path). `--max-usd` optional: no new unit starts once charged total plus 2.00
  per running unit would exceed it. Order newest chapter first, so a binding cap leaves the oldest units;
  unstarted units are `state: "pending"` and render lists them under their chapter.
- Resume: results append one JSON line per finished unit to `<runs>/<chapter>.jsonl` (`{slug, id, title, status,
  inputSha256, inChars, state, reason, lines, unresolved, costUsd, wallMs, sourceCommit}`); a torn last line is
  ignored on load. Rerun skips a slug whose last record is `ok` with the same `inputSha256`; `fallback` is
  retried only with `--retry-fallback`. Default runs dir for P299: `docs/v2.6/plans/P299-runs/`; for a
  rollover: `docs/history-runs/`.

### D5. Output format (`render.go`)

`docs/HISTORY.md`: H1, a 4-line preamble (built by `go run ./scripts/docshistory`, never hand-edited; IDs are
chapter-local before v1.6; deleted sources via `git show <sourceCommit>:docs/<ch>/...`; distilled by
`ingest_files`). Then one section per chapter, version order, between `<!-- chapter <ch> -->` and
`<!-- /chapter <ch> -->`:

```
## v1.9
Source: docs/v1.9/ at <sourceCommit 12>. 57 phases.
<notes lines>
### v1.9 P104 <title, 120 chars> (<status>)
<distilled line>
<distilled line>
```

Plain lines, no bullets, ids, tags or indent; a blank line ends each phase block. `render <ch>` replaces only
that chapter's block, or inserts it in version order; same runs give the same bytes. Chapter absent and block
present: no-op. No per-phase line cap (Cost section explains the size; the user may set the 8-line
alternative, a render constant only, no re-distill). The tool prints total and per-chapter bytes.

### D6. Verify (`verify.go`), before any deletion

`verify --sample 12 <ch...>`: 12 phases chosen by `sha1(chapter+" "+id)` order across the given chapters, plus
every `fallback`/`pending` unit listed by count. For each sample: the HISTORY block, the source marker
sentences of its unit (from `git show <sourceCommit>:...`, so it works after deletion too) and its other
marker hits in the SPEC. Output at most about 300 lines, written to `docs/v2.6/plans/P299-verify.md` (rollover:
stdout). Pass: every sample has its title/status block and lines (or a fallback), and the implementer, reading
only this report, finds every sampled marker decision carried. A miss: fix the unit rule, rerun those units,
redraw 12 new samples. Deletion (group 6) only after a pass.

### D7. Repoint (`repoint.go`)

Over `git ls-files` minus `docs/v*/`, `docs/HISTORY.md`, `.github/workflows/`:
- `docs/v1.1/WEBVIEW-SCROLL-MEMORY.md` becomes `docs/WEBVIEW-SCROLL-MEMORY.md` (moved with `git mv`, locators kept).
- `docs/<ch>/plans/<ID>-<name>.md` plus a trailing locator (`§x.y`, `D9`, `section 2.10`, `:446-450`, `Appendix
  A`) becomes `docs/HISTORY.md (<ch> <ID>)`; `docs/<ch>/SPEC.md[...]` becomes `docs/HISTORY.md (<ch>)`.
- Operative refs (instructions someone follows today): files under `scripts/`, `.githooks/`,
  `docs/DEV_ENVIRONMENT.md`, `CLAUDE.md` get `` `git show <sourceCommit 12>:<old path>` `` instead, so the method
  text stays one command away.
- Unmatched shapes (path wrapped across comment lines, bare `docs/v1.6/plans/`, globs like
  `P107-duplication-findings*.md`): printed; the implementer edits them by hand to the same forms.
- `.github/workflows/release.yml:15,53`: append the two comment hunks to the existing, unapplied
  `docs/pending-changes/.github__workflows__release.yml.patch` (`DEV_ENVIRONMENT.md` rule: never a second patch).
- `README.md:262`: current chapter `docs/v2.6/`, earlier ones in `docs/HISTORY.md` (v2.5 still a folder).
- Check: `git grep -nE 'docs/v(1|1\.[1-9]|2\.[0-2])/' -- ':!docs/v2.5' ':!docs/v2.6' ':!.github/workflows'`
  prints nothing.

### D8. v2.5 stays whole

The eval harness reads `docs/v2.5/plans/` at runtime (corpus, runs, rounds; `promptsizes` default). v2.5 is
not folded, not repointed, not deleted. Moving the eval data out of `docs/` is a separate phase; the
implementer adds it to `docs/v2.6/SPEC.md` as the next row (`P299 Memory eval data out of docs/v2.5; fold
v2.5`, Todo) only if the orchestrator confirms with the user.

### D9. Deletion (`git rm -r`)

`docs/v1 docs/v1.1 docs/v1.2 docs/v1.3 docs/v1.4 docs/v1.5 docs/v1.6 docs/v1.7 docs/v1.8 docs/v1.9 docs/v2.0
docs/v2.1 docs/v2.2` (SPEC, plans, READMEs, extra `.md`, PNGs), after `WEBVIEW-SCROLL-MEMORY.md` moves. v2.5,
v2.6, `docs/design/`, `docs/pending-changes/` untouched. Git keeps the files.

### D10. Lint and hooks

- `biome.json`: add `!docs/v2.6/plans/P299-runs` and `!docs/history-runs` beside the v2.5 excludes (precedent;
  `.jsonl` is not linted today, the exclude guards future JSON there).
- `scripts/` change means a full pre-commit run; `go vet`, `bun run lint:go` cover the new package; knip ignores
  Go. `check-docs.ts` does not see `docs/`. No hook greps `docs/v*/`.

### D11. CLAUDE.md and DEV_ENVIRONMENT.md (own commit group)

`CLAUDE.md`, terse style, net shorter where possible:
- Line 49: `(the current chapter's SPEC.md phasing table — docs/v2.2/ today)` becomes `(the current chapter's
  docs/v<chapter>/SPEC.md phasing table)`.
- P-number rule: "scan every prior chapter's SPEC.md for the highest P" becomes "read the highest `P` in
  `docs/HISTORY.md` and in every `docs/v*/SPEC.md` still on disk".
- New bullet: **Opening a chapter folds the previous one.** Run `go run ./scripts/docshistory fold <prev>`
  (distills each phase through `ingest_files`, costs tokens, resumable), read its verify report, commit, then
  `git rm -r docs/<prev>/ docs/history-runs/`, then create `docs/<new>/`. Skip a chapter whose files a test or
  script reads at runtime (move them first, own phase). Never hand-edit `docs/HISTORY.md`.
- Prune any text implying old chapters stay on disk; keep the C/M lettering note (still true in HISTORY).
`DEV_ENVIRONMENT.md`: 4 lines under the real `claude` section: tool needs the logged-in `claude` CLI, builds the
server binary itself, temp memory homes, cost scale (P299 pilot: 0.02 to 0.25 USD per phase).

## 3. Commit groups (in order; start only after the user accepts the Cost section)

1. `feat(scripts): docshistory parser, units, render, verify, repoint` (zero-token parts, `parse_test.go`,
   `biome.json` excludes). Check: `units` totals match section 1 (457 phase units, 1.82 MB).
2. `feat(scripts): docshistory distill over ingest_files` (D4) and `fold`. Smoke: `distill v2.2 --only
   v2.2-p212-part-1` (one unit, about 0.04 USD); compare with `P299-pilot/units.jsonl`.
3. `chore(v2.6): P299 distill <chapter>`, one commit per chapter, newest first, runs files only. Background
   run; on restart rerun the same command (finished units skip).
4. `docs: build docs/HISTORY.md from v1 to v2.2` (render output only), then `verify`, commit
   `P299-verify.md` in the same group. Fix rounds, if any, as follow-up commits before group 5.
5. `docs: move WEBVIEW-SCROLL-MEMORY.md out of v1.1` (`git mv`) and `refactor: repoint docs/v* references to
   HISTORY.md` (D7, pending patch hunk, README).
6. `docs: remove v1 to v2.2 chapter folders` (D9).
7. `docs: chapter rollover rule in CLAUDE.md` plus the DEV_ENVIRONMENT lines (D11).
8. `docs(v2.6): P299 result`.

## 4. Verification

- `go test ./scripts/docshistory/`, `go vet ./scripts/...`, `bun run lint`, `bun run lint:go`: clean.
- Rerun `render v1 ... v2.2` and `distill` (no-op) after group 4: `git diff --exit-code docs/HISTORY.md`.
- Verify report passes (D6); fallback and pending counts stated in Result.
- D7 grep empty; `git grep -n 'WEBVIEW-SCROLL-MEMORY'` points at `docs/WEBVIEW-SCROLL-MEMORY.md` only.
- `ls docs` shows ARCHITECTURE, DEV_ENVIRONMENT, HISTORY, HUMAN_CODE_REVIEW, PACKAGING, PERF,
  WEBVIEW-SCROLL-MEMORY, design, pending-changes, v2.5, v2.6.
- `bun site/scripts/check-docs.ts` passes (v2.5/v2.6 sources still exist). `go vet` in
  `apps/kira-space/tests/claude` compiles (paths unchanged).
- Spend: sum of `spend.jsonl` against the Cost section, in Result.

## 5. Out of scope

Moving v2.5 eval data (D8). Changing distill prompts or the pipeline. Folding v2.6. Rewriting `docs/design/`.

## Result

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
