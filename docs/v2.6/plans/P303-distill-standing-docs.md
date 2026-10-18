# P303 plan: distill the standing docs

SPEC row P303 (`docs/v2.6/SPEC.md`). Base: `83e59846b` (v2.6). Planner: Opus. Implementer: one sequential
Sonnet subagent, Stream B, worktree `/home/user/kira-p303`, branch `v2.6-p303`. No split inside the phase:
the tool gates the runs, the runs gate verify, verify gates render and repoint.

Discovery: `codegraph_explore` (default index; the worktree has none, same code at base) over `docshistory
main.go run cmdUnits distill units ledger`, `verify.go repoint.go records.go Record`, `internal/textloss
LostText`, `teleLoss isLocator Recall`, `memfmt StripMarkup`, `materialise evalManifest`, `distillChapter`.
Docs and configs: `grep` for headings, table first lines and references only; no standing doc read whole.
Pilot: `P303-pilot/pilot.md` (9 real distill calls, 1.226 USD).

## 1. Current state (verified)

- `docs/ARCHITECTURE.md`: 600,492 bytes, 6,069 lines, 66 headings (1 `#`, 19 `##`, 46 `###`, no `####`), no
  numbered sections. Largest leaf bodies: UI architecture top 107 KB, Storage 62 KB, Stack 41 KB, Process model
  40 KB, Memory 34 KB, Known open items 29 KB (70 entries), Testing 27 KB. 15 tables (196 lines), 3 code blocks,
  35 unique `E_*` codes. Paragraphs are long single lines (table rows up to 7.8 KB).
- `docs/PACKAGING.md`: 42,785 bytes, sections `## 1.` to `## 8.` plus `### Where the version comes from`.
  3 code blocks, 3 tables. §3 holds the `verify-packaging.sh` check ids (S1, S2, S5, A1, A3, A4, A5, N2, N3).
- `docs/HUMAN_CODE_REVIEW.md`: 2,184 bytes, 44 lines, 3 `##`; referenced nowhere (only the SPEC row).
- `§n` citations: 0 of ARCHITECTURE (none exists outside the SPEC row's own wording). PACKAGING: `§4`
  (`release.yml:160`), `§6` (`ARCHITECTURE.md:334`, pending `release.yml` patch), `§7` (`README.md:271`),
  "Kira Space packaging" section (`apps/kira-space/README.md:178`).
- ARCHITECTURE citations, outside `HISTORY.md`, testdata and `docs/v2.6/`: 64 lines in 42 files.
  - Line refs, 2, both already stale: `tabViews.ts:20` (`:28`, now the table separator) and
    `fakeData/generate.ts:40` (`:69`).
  - Section-name refs: Stack table 2, Caching 2, Git module 3, Testing 3, Storage 3, ClickHouse, DB MCP,
    Process model, per-engine section 2, "sslmode semantics per engine" 2, Known open items 6, Per-database
    mapping. Resolve while headings stay.
  - Phrase refs: "Go owns the network" (present), "provably read-only" 2, "no Vue reactivity on row data",
    "WebKit's clipboard gesture heuristics", "Multi-window section", "MariaDB/MySQL tree", "Postgres tree"
    (all 0 hits today: already stale).
  - Rest name the file only (comments, READMEs, `CLAUDE.md` 3, `DEV_ENVIRONMENT.md` 13, site `sources:` 4).
- Nothing reads the three docs at runtime: no Go/TS/test opens them (`git grep`, comments only). The memory
  eval corpus pins ARCHITECTURE by commit (`manifest.json` `commit` plus `git show`, corpus test line 82).
  `check-docs.ts` scans only `site/src/content/docs`; its `sources:` rule needs the path to exist. Biome
  ignores `.md`. So: no doc-derived constant to protect; the reverse direction (numbers the doc states) is
  covered by the loss report (§5).
- `scripts/docshistory`: chapter-only. `run()` rejects any non-`v<n>` argument (`checkChapter`). Reusable:
  `distillOne`, `ledger`, `distillUnit`, `estimate`, `Record`, `loadRecords`, `appendLine`, `git`, `sha`.
- `internal/textloss`: `LostText(old, cur)` (numbers, backtick and quoted spans, identifiers, paths, names,
  negation counts) and `Recall(old, cur) (total, kept)`; `memfmt.StripMarkup` drops inline Markdown.
- Worktree: no `node_modules` (planner ran `bun install --frozen-lockfile`, done), no generated bindings
  (`bun run typecheck` fails: `Cannot find module '@bindings/...'`), no `frontend/dist`
  (`go build -tags server ./apps/kira-space`: `pattern all:frontend/dist: no matching files found`).

## 2. Decisions

D1. **Replace in place, no side-by-side copy.** One file per doc stays the one home of its facts, so the
`CLAUDE.md` rule ("facts about the app live in `docs/ARCHITECTURE.md`") and its 64 citations hold unchanged.
A copy would drift: every phase edits ARCHITECTURE, and two files mean two edits or a stale one. Every heading
stays byte-identical, so section-name citations and GitHub anchors resolve and agents still read by section.
The original stays in git; render writes one line under the title: `Distilled in P303, one fact per line.
Full earlier text: git show <commit>:docs/ARCHITECTURE.md.` (`<commit>` = the records' 12-char source commit).
New facts from later phases go in as bullets in the same style. Site `sources:` and `check-docs` unaffected.

D2. **Segments and section ids.** The splitter walks the file at its source commit and emits segments in order:
- Heading lines: verbatim, always.
- Verbatim segments: the intro before the first `##`; whole sections on the per-file keep list (D4, D5);
  fenced code blocks; lookup tables (mean cell 100 chars or less). Lookup tables in ARCHITECTURE: 11, 15.4 KB
  (Per-database mapping, storage bounds `Table | Grows with | Bound`, i18n, package, ADE tables).
- Prose: the rest, including prose-cell tables (Stack 37 KB, Coupling, P46 control), flattened per row as the
  pilot did: first cell a bold paragraph, every other cell `<header>: <cell>`.
- A prose run under one heading over 12,000 chars splits at paragraph or row boundaries into parts of at most
  12,000 chars (a single paragraph never splits; largest is 19,677 chars). A prose run under 400 chars stays
  verbatim (fixed cost, nothing to cut).
- Unit id (record slug): `<doc>/<heading-anchor>/<k>`, e.g. `architecture/ui-architecture/03`; anchor is the
  GitHub slug of the nearest heading, `k` counts that heading's prose units from 1. Unit text is P299's shape:
  `# <file>: <heading path>`, a `Section: <heading>.` paragraph, the body.
- Render: each prose unit becomes its lines as `- ` bullets, in source position among the verbatim segments.
  No escaping; agents read raw text.
- Deviation from the SPEC row's "tables only as one headline figure": no ARCHITECTURE table is a table of
  figures. Prose tables are decision records (the Stack table is the library-choice record), so they are
  flattened and distilled. Lookup tables are capability and limit matrices; one figure would drop them.
  Orchestrator: confirm or overrule before group 2.

D3. **Pointer scheme.** No `§n` exists for ARCHITECTURE, so no new numbering. Headings are the ids, unchanged.
- The 2 line refs go to the section name (`docs/ARCHITECTURE.md's Stack table`).
- Each phrase ref: if the phrase or its fact is under a heading of the new file, cite that heading. If distill
  dropped the fact, cite `git show 83e59846b:docs/ARCHITECTURE.md` plus the heading.
- The already-stale "Multi-window section" ref gets the same treatment.
- PACKAGING `§n` refs resolve unchanged (headings kept). `docs/HISTORY.md` is never hand-edited; its
  ARCHITECTURE mentions name sections and stay.
- Files under `apps/kira-space/frontend/src/ade/` or ADE tests are P302's. A ref there is listed for the
  orchestrator, never edited.

D4. **ARCHITECTURE keep list:** intro, `## Known open items` (whole, 29,202 bytes, 70 entries), per the row's
"known open items entry text" verbatim. Everything else per D2. Prose to distill: about 535 KB in about 92 units.

D5. **PACKAGING, per section.**
- Verbatim: intro, `## 1. Building locally` (build commands and the bundle-layout block), `## 3. Verification
  checklist` (check ids and results), `## 4. Human checklist` (exact commands and recorded pass results), and
  `## 6. Known gaps`. Pilot evidence: distilling §1 dropped 2 of 14 commands and the layout block. Distilling §6
  dropped an open item ("§4 items 1, 2, 3 and 10 passed ... items 4-9 are still unrun").
- Distilled: `## 2.` with `### Where the version comes from` (its code block verbatim), `## 5.`, `## 7.`,
  `## 8.`. About 30 KB in about 6 units.
- Command gate: every backticked span in a distilled PACKAGING unit that starts with `bun`, `wails3`, `go`,
  `git`, `gh`, `scripts/`, `codesign`, `spctl`, `xattr`, `hdiutil`, `open`, `curl` or `task` must appear in
  that unit's lines, backticks aside. Check ids must appear too. If one is missing, the whole section stays
  verbatim (`keep` record, D6). No rerun loop.

D6. **HUMAN_CODE_REVIEW.md: reasoned keep, verbatim.** Pilot ran it through the pipeline: 2,235 to 1,911 chars
(15%). Lost: the **WIP.** status, all three headings (the 1-3 rubric's structure), the `asFooTab`-style and
"Zod schema + inferred type, no logic" examples. Negations fell: "n't" 2 to 0, "no" 4 to 2. Hard-token loss 7 of
28. A 2 KB rubric that is already one rule per bullet gains nothing from a 15% cut. Same verification as the
others: pilot loss counts recorded (`P303-pilot/`), and `git diff --exit-code 83e59846b -- docs/HUMAN_CODE_REVIEW.md`
is empty at the end.

D7. **Tool: one new subcommand, chapter path untouched.** `main()` dispatches `doc` before `run()`'s chapter
parsing. Everything else is new code in `scripts/docshistory/standing.go`:
`go run ./scripts/docshistory doc <units|distill|render|verify|keep> [flags] <docs/ARCHITECTURE.md|docs/PACKAGING.md>`.
- Per-file keep lists (D4, D5) live in a two-entry map in code, not in flags, so every subcommand agrees.
- Flags: `--runs` (default `docs/v2.6/plans/P303-runs`), `--binary`, `--max-usd`, `--only`, `--redo`
  (comma slugs; reruns ok units once), `--out` (verify report path).
- `units`: prints slug, kind and chars per segment, plus totals.
- `distill`: pins the source commit (last commit touching the file, refuses a dirty file, like
  `chapterCommit`/`checkClean`). Records go to `<runs>/<DOC>.jsonl` (`ARCHITECTURE.jsonl`, `PACKAGING.jsonl`).
  It skips a unit whose ok record has the same input sha (resumable, like `distillChapter`). It reuses
  `distillUnit` and the shared `spend.jsonl` ledger, with `--jobs` fixed at 1.
- `keep <slug>...`: appends a record with state `verbatim`, so render emits the source text.
- `render`: rebuilds the file from `git show <commit>:<path>` plus the records. Refuses while any prose unit has
  no ok or verbatim record. Idempotent.
- `verify`: renders in memory and writes the report (§3).
- `estimate` (P299 envelope) unchanged; the cap gets margin instead (§4).
- One table test, `standing_test.go`, for the splitter and render. Its rules interact: headings, fences,
  lookup vs prose tables, 12 KB cap, 400-char floor, keep list. The test asserts segment kinds and slugs, and
  that render with every unit kept verbatim reproduces the input byte for byte.
- Existing `parse_test.go` and chapter subcommands stay green and unchanged.

## 3. Verification (`doc verify`, report `docs/v2.6/plans/P303-verify.md`)

V1. Structure, objective, must pass:
- The heading list of the rendered file equals the source's (ARCHITECTURE 66, PACKAGING 10).
- Every verbatim segment is byte-identical in the render.
- Known open items: rendered section equals source byte for byte, 70 entries.
- PACKAGING §1, §3, §4, §6 and `HUMAN_CODE_REVIEW.md`: byte-identical.

V2. Loss gate per unit, `internal/textloss`.
- Compute `LostText(StripMarkup(src), StripMarkup(lines))`. Strip both sides because distill output drops
  backticks. Classify each loss as number, identifier, path, quoted or negation; names and negation counts are
  reported but not gated (noise and sentence-count effects, see pilot).
- Hard loss rate = lost unique hard tokens / source unique hard tokens. Pilot ARCHITECTURE: 27% to 67% per unit,
  36% overall. Losses read as trivia: line locators, file-name evidence, version history.
- Flag a unit when hard total is 20 or more and hard loss is over 50% (pilot: security, 84 of 150). Also flag it
  when any source `E_*` code is missing from its lines, or a cited phrase from §1 is missing.
- Doc gate: ARCHITECTURE overall hard loss over 45% stops the phase before render. Report to the orchestrator;
  do not re-scope.
- Report: per unit, slug, chars in and out, cost, hard lost/total by class, negation drops, flag, and the lost
  hard tokens (clipped to 30).

V3. Flagged units, each hand-read side by side (source unit vs lines). Missing decision, constraint, limit,
error string or flipped negation: rerun once (`--redo`). Still missing: `keep` the unit verbatim. Losses that
are trivia only: accept, with a one-line reason in the report.

V4. Hand-read sample: 12 ARCHITECTURE units not in the pilot, at most one per `##`, picked by sha1 of slug,
plus every distilled PACKAGING unit (about 6). Per unit, record: decisions carried (y/n with the missed one),
negation flips, invented facts, open-state text lost. Any lost decision: V3 treatment.

V5. Refs: for each of the 64 citation lines, show the cited heading or phrase and whether the render resolves
it. Unresolved: repoint per D3 (group 6).

## 4. Cost

Pilot (9 units, `P303-pilot/`): 0.005 USD fixed plus 0.0185 per 1,000 chars. That is about 1.9 times P299's
per-char rate, because ARCHITECTURE is denser (output/input 0.68, P299 0.22 to 0.36).
- Row formula, units times 0.068: ARCHITECTURE 92 times 0.068 = 6.26; PACKAGING 6 times 0.068 = 0.41; total
  6.7 USD. It understates for this doc.
- Pilot fit: ARCHITECTURE 535 KB, 10.4 USD; PACKAGING 30 KB, 0.6 USD; retries about 10% (P299 and P300
  failure rate), 1.1. **Expected about 12 USD.** Wall: about 70 min serial (pilot 23 to 83 s per unit).
- Worst case: every unit at 1.3 times the fit (13.5), plus 20 failed tries charged at the 0.25 estimate (5),
  plus `--redo` on 10 flagged units (2): **about 21 USD.** Theoretical ceiling: per-call cap 2.00 USD times about
  200 tries, about 400 USD; no pilot call came near (max 0.39).
- Cap: `--max-usd 22` total on the shared ledger, run in steps (4, 8, 12, ...) to commit between them.
- Output: ARCHITECTURE about 0.68 times 535 KB plus 61 KB verbatim, about **425 KB (minus 29%)**. PACKAGING
  about 33 KB. The cut is modest because the doc is already fact-dense; that is the measured result, not a
  target missed.

## 5. Steps and commit groups (one sequential implementer)

0. Setup, no commit: in `/home/user/kira-p303` run `bun run setup` (bindings; any `scripts/` change makes
   the pre-commit hook run full `bun run lint` plus `bun run typecheck`). `node_modules` is already installed.
   For the distill binary, use `scripts/prepare-worktree.sh` or an `index.html` placeholder in
   `apps/kira-space/frontend/dist` and `dist-mobile` (gitignored). Then `go test ./scripts/docshistory` must
   be green before any change.
1. `feat(docshistory): doc subcommand for standing docs`: `standing.go`, `standing_test.go`, the `main.go`
   dispatch and usage line. `go test ./scripts/docshistory`, `go vet ./scripts/...`, `bun run lint:go`. Paste
   `doc units` totals for both docs into the Result.
2. `docs(v2.6): P303 ARCHITECTURE distill runs`: `doc distill docs/ARCHITECTURE.md` in `--max-usd` steps.
   Commit `P303-runs/` after each step. An interrupted run resumes from the records on disk.
3. `docs(v2.6): P303 PACKAGING distill runs`: same, PACKAGING. Then `doc keep` any section D5's command gate
   fails.
4. `docs(v2.6): P303 verify report`: `doc verify` both docs. Do V3 reruns or keeps (commit runs), then V4 and
   V5. Write the hand-read notes into `P303-verify.md`. V1 must pass and the doc gate must hold before group 5.
5. `docs: distill ARCHITECTURE.md and PACKAGING.md (P303)`: `doc render` both. A second render gives
   `git diff --exit-code` clean. `HUMAN_CODE_REVIEW.md` is untouched.
6. `docs: repoint ARCHITECTURE references (P303)`: the 2 line refs plus every V5-unresolved ref, per D3.
   Comment-only edits; the hook runs biome, `lint:rules` and the affected typecheck.
7. `docs(v2.6): P303 result`: fill `## Result

Done. Verify report: `docs/v2.6/plans/P303-verify.md`. Records: `docs/v2.6/plans/P303-runs/`.

| Item | Value |
|---|---|
| Commits | `f5df2c0d8` feat(docshistory): doc subcommand for standing docs; `46da2ac4f`, `eb503b25e`, `8a1d05ed7` ARCHITECTURE distill runs (3 steps); `e2352a566` PACKAGING distill runs; `c03e80972` verify report; `d853e7eb8` distill ARCHITECTURE.md; `13af63618` repoint ARCHITECTURE references; result commit after this table |
| Units per doc: total / ok / verbatim-kept / redone | ARCHITECTURE 91 / 89 / 2 / 2. PACKAGING 7 / 0 / 7 / 2 |
| Spend | 10.6789 USD charged on the shared ledger = sum of every call's `costUsd` (102 calls, 0 failures, 0 rate limits). Final ok records: ARCHITECTURE 9.5545. Cap 22; projection 12 (worst 21) |
| Bytes, lines before / after | ARCHITECTURE 600,492 / 6,069 to 459,256 / 3,127 (-23.5% bytes). PACKAGING 42,785 / 544 unchanged. HUMAN_CODE_REVIEW 2,184 / 44 unchanged (`git diff --exit-code 83e59846b` empty) |
| V1 structure | Headings 66/66 and 10/10. Verbatim segments 94/94 (ARCHITECTURE), 24/24 (PACKAGING). Known open items 70/70 byte-identical (29,202 bytes). PACKAGING sections 1, 3, 4, 6 identical |
| V2 loss | ARCHITECTURE distilled units: hard lost 1,798 of 6,407 (28.1%): numbers 457/1,531, identifiers 540/2,881, paths 635/1,726, quoted 166/269. Whole doc 24.4% (1,798/7,377). Doc gate 45%: held. Flagged 9 on pass 1, 7 after keeps. `E_*` kept 35/35. PACKAGING: command gate failed in sections 2 and 7, both reverted to verbatim |
| V3 flagged outcome | process-model/01 redone, still missing `E_ENGINE_DOWN`: kept. renderer-security-surface/01 redone, still lost pending SPI grep: kept. invariants/01, sslmode/01, storage/02, ui-architecture/02, ui-architecture/10, git-module/01, testing/02: accepted, trivia only (reasons in verify report). PACKAGING sections 5 and 8 redone, still lost open-state text: kept |
| V4 hand-read | 12 ARCHITECTURE units plus all 7 PACKAGING units read. Decisions lost 0. Negation flips 0. Invented facts 0. One ambiguous attribution (git-module/01, "before P116 Cmd+W closed the window") |
| Refs | 60 lines in 41 files outside the tool: resolved as-is 50; repointed to heading 10; `git show` pointers 0; ADE listed 0. "WebKit's clipboard gesture heuristics" resolves (verbatim section, line-wrapped) |
| Render | Idempotent (second render byte-identical). PACKAGING render equals source, no note line |
| Checks | `go test ./scripts/docshistory`, `go vet ./scripts/...`, `bun run lint:go` (0 issues), hooks passed on every commit |
| Deviations | Spend cap stepped 4, 8, 12 for ARCHITECTURE (3 commits, not 1). Loss counts use the unit body only, not the `# file: heading` header, so small differences from the pilot (hcr 5/26 vs 7/28). Added `doc show`. `render` writes the note line only when a unit is distilled. PACKAGING ends fully verbatim by the plan's own gates; ARCHITECTURE shrank 23.5%, not the projected 29%, because 2 large units were kept. Untracked placeholders `frontend/dist{,-mobile}/index.html` created for build only (gitignored) |
