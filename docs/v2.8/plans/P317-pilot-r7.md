# P317 pilot round 7: judge

Prompt: worktree `agent-afa61e1e493ff1715`, commit `e679ecf` (round-6 proposed fixes 1-6 applied
to `memory.rewrite.system`). Data: scratchpad `p315-pilot/round-7` (arm A, 120 repo comments) and
`round-7/b` (arm B, 40 third-party comments plus 10 prose notes), same units as rounds 5 and 6.
Every record has `calls.rewrite >= 1`. Judged from before/after text only; implementer labels not
used. Rubric as round 6: unchanged is neutral or missed-trivia, never bad; shorter is not better;
`kept:width` counts as missed-trivia (the input ships with its label or over-width line).

Implementer numbers recomputed from `results.jsonl`/`idem.jsonl`; all match: arm A rewritten 100,
unchanged 16, kept 4 (width 3, grew 1); second pass fed 100, changed 7, kept 0; arm B rewritten 9,
unchanged 41, second pass 9 fed, 0 changed. Final lines over 100 columns: arm A #24, #64, #73 (all
`kept:width`, input shipped). Arm B #32 is a 108-column URL line (unbreakable, not counted); #40-#49
are prose notes, where the prompt sets no width rule. So the 11 arm-B "over-width" ids do not matter.

## Result: FAIL

| metric | bar | round 7 | round 6 |
|---|---|---|---|
| meaning-level bad (A) | <= 3/120 | 1 (#45) pass | 1 |
| missed-trivia (A) | <= 12/120 | 6 pass | 5 |
| harmful second-pass changes (A+B) | 0 | 1 (#87) **fail** | 1 (#61) |
| second-pass churn (A) | <= 5% | 7/100 = 7.0% **fail** | 8/102 = 7.8% |
| arm B meaning-level bad | 0 | 0 pass | 0 |
| arm B churn (not gated) | - | 0/9 | 0/10 |

Counts A: good 80, neutral 28, missed-trivia 6, bad-lost-why 0, bad-wrong 1, bad-style 5.

## Arm A first pass

- #45 bad-wrong (regression; round 6 kept it): "previously" dropped from "TrackerFor's own Add
  (previously issued with no lock held, after unlocking mu) could not guarantee". The parenthesis
  now says Add is issued with no lock held. The next sentence says Add runs under the lock. The
  prompt keeps a change marker whose clause is false without it; the model dropped it anyway.
- Missed-trivia 6:
  - #5 leftover `actually` ("the compat run actually asked for"), as round 6; second pass fixed it.
  - #77 leftover `actually` ("`T` generic is actually instantiated"). `dropped` lists it, but the
    text keeps it. The reflow of the 104-column line held (round 6 kept:width).
  - #103 leftover `actually` ("the template actually reads"). `dropped` lists it, text keeps it;
    second pass fixed it.
  - #24 kept:width (regression; round 6 good). The draft reflowed but left a final line over 100
    columns (4 leading tabs count 16).
  - #64 kept:width, as round 6. The draft never touched the inherited 101-column line. Labels
    P2 R1 and P99 §9.3 ship. The draft also dropped "refDebounced replaces the watch+setTimeout
    pair this used to hand-roll", which the new history rule says to keep (not shipped).
  - #73 kept:width (regression; round 6 good). The draft left the 101-column line and its
    `actually`. Label P22 iter2-onset D3 ships.
- bad-style 5 (not graded):
  - #27 "with D15's size guard" became "with size guard"; #48 "§7.13's path-scoped blockers' own
    input" became "is path-scoped blockers' own input"; #61 "as D5's WHERE clause" became "as
    WHERE clause", and "(P5's "never ..." ground rule" lost its article. Round 6 wrote "the" in
    each. A possessive label before a noun is now deleted with no determiner.
  - #113 lowercase quoted lead `"repository with no commits" state`, as rounds 5 and 6.
  - #116 brackets dropped: `Axe `aria-allowed-role`:` (capitalised tool name as lead); "(layout,
    not a page banner)" stays vague, as round 6.
- Neutral, borderline (not counted):
  - #16 drops "the same single defer conn.Close() this replaces used to cover every later
    failure". The contract stays; the clause is what the code replaced, which the prompt now keeps.
  - #55 "used to walk" became "walked"; #79 "used to outlive" became "outlives". Both reword kept
    words. Meaning holds; #79 reads as a standing lifetime fact, which is why the hook exists.
  - #100 "previously staged" became "staged"; #109 "used to reset" became "reset". Past tense
    keeps the bug in the past, but the contrast with the current code is weaker.
  - #96 drops the hoisted-from note, "unchanged" and the byte-for-byte sentence (moved-from, listed).
    "`columns` replaces its hard-coded ..." now has a vague "its".
  - #62, #63, #65, #107, #112: same final as round 6, same verdicts.
- Unchanged 16 (#9, 13, 14, 26, 33, 38, 46, 59, 60, 70, 76, 82, 90, 91, 101, 117): all neutral.
  #76 keeps "today's OperationsPanel.vue". The closed history list does not name it, so keeping
  it is per prompt. Round 6 dropped it.
- Kept #40 (`grew`): the draft turned backticked `\` into `\\` again. The copy-fidelity sentence
  did not stop it. Neutral; input shipped.
- Fixed from round 6: #94 keeps the grid clause and the no-automatic-count rule (round-6 bad);
  #34 keeps "The id used to be the literal "test"" (the why for a fresh id); #37 keeps how the
  old guard failed; #41 keeps the shared-palette sentence; #53 keeps "`editor.openAllChanges`'s
  own replacement"; #67 and #68 keep their reason clauses; #0 keeps "the four are equal"; #6
  drops `actually`; #44 keeps "just no longer unbounded"; #77 reflows.

## Round-6 prompt fixes

| round-6 fix | target | round 7 |
|---|---|---|
| 1 closed history list | #45, #55, #61, #85, #94 | partial. First pass keeps more reason clauses (#34, #37, #53, #61, #67, #87, #94). #61 second pass now stable. #45 first pass regressed. Second pass still drops past-tense clauses (#37, #67, #87) |
| 2 "own" only with label | #48, #107, #114, #118 | held: #31, #105, #114, #118 keep `own`; #107 second pass unchanged. Side effect: possessive labels lose their determiner (#27, #48, #61) |
| 3 capitalisation | #116 | partial: brackets removed instead of kept lowercase; #113 unchanged |
| 4 width, also untouched lines | #64, #77 | partial: #77 held; #64 still fails; #24 and #73 regress to kept:width |
| 5 copy fidelity | #40, #89 | partial: #40 escape slip repeats; no trailing-space slip seen |
| 6 already clean | churn | not met: 7.0% |

## Arm A second pass

100 re-fed, 93 unchanged, 7 changed, 0 kept. Model-level non-verbatim 7/100.

| id | change | verdict | why the prompt let it change |
|---|---|---|---|
| 5 | drops `actually` | benign polish (first-pass leftover) | listed hedge |
| 103 | drops `actually` | benign polish (first-pass leftover) | listed hedge; first pass listed it as dropped but kept it |
| 44 | drops ", just no longer unbounded" | benign polish | the bound is stated ("same fixed upper bound"); "no longer" read as change marker, whole clause dropped |
| 85 | "moved down to" becomes "lives in" | benign, rewording | moved-from note is listed history; model reworded instead of dropping |
| 37 | drops "— a query-string password (?user=u&password=secret) was never masked at all before this fix, regardless of userinfo" | oscillation, rule breach, not harmful | how earlier code failed, which the prompt now keeps. Query masking is still stated in the opening paragraph |
| 67 | drops ", so the CodeMirror-only glue `editor/hover.ts`'s `buildHoverSource` existed for has no equivalent to keep" | oscillation, rule breach, not harmful | what the current code replaced; round 6 first pass dropped it too |
| 87 | drops "and used to rely on lang-sql's own implicit language-data keyword source (its own stale comment at the mount site said so)" and "such" | **harmful, bad-lost-why** | "this is that keyword/type source, made explicit" now points at a dropped referent; what the source replaces is gone. Same defect as round-5 #87. "used to" pulled the clause into history |

Harmful 1 (#87). Round-6 #61 is now stable.

Common cause of churn and #87: the closed list names change-marker words ("used to", "no longer",
"previously") with the instruction "drop the word, keep the clause". When dropping the word makes
the clause false, the prompt says nothing direct, and the model resolves the conflict by dropping
the whole clause (#37, #44, #67, #87). The first pass usually keeps such clauses; the second pass,
seeing a cleaner text where those clauses stand out, drops them. #45 is the same conflict in the
other direction: the word dropped, the false clause kept.

## Arm B

First pass: 9 rewritten, 41 unchanged, 0 kept. All 9 good, 0 meaning loss:
- Hedges: #0 (`really`, `simply`), #4 (`actually` plus reflow), #8 (`just` as hedge), #20 (`just`
  plus reflow), #41 note (`really`, line structure kept).
- Reflow of over-width lines only, every word kept: #26, #31 (spec steps), #34, #39.

Second pass: 9 re-fed, 9 unchanged. Harmful 0, churn 0%.

#33 is now unchanged and keeps `actually` in the quoted behaviour name "only re-render on
properties you actually read" (round 6 dropped it). Missed hedge, not meaning loss; inside a quote
keeping it is defensible. Notes #40-#49 come back verbatim; #42 keeps "Previously ...". #18 keeps
"not just on". #32 keeps its URL line.

## Proposed prompt fix

Generic wording for `memory.rewrite.system` only. Not applied. No repo literal, no ledger, no
"shorter" rule.

1. Change-marker conflict (#87, #37, #44, #67, #45; churn). Append to the history bullet:

   > Test each change-marker word alone: remove it and reread its clause. If the clause is still
   > true, drop only the word. If the clause is now false or reads as current behaviour, keep the
   > word and the whole clause. A change-marker word is never a reason to drop a clause or
   > sentence; only the items before the semicolon are.

2. Possessive labels (#27, #48, #61). Append to the label bullet:

   > A possessive label before a noun ("X's guard") becomes "the" ("the guard").

3. Dropped list must match text (#77, #103). Append after the `"dropped"` field description:

   > Every entry in "dropped" is absent from "text"; check each one before answering.

4. Width (#24, #64, #73). Replace the width sentence in Form with:

   > Code comment lines at most {{.MaxWidth}} columns, indentation and markers included; a tab
   > counts 4. Before answering, measure every code comment line of "text", including lines no
   > drop touched; reflow any line over the width at the last space that fits.

5. Quoted lead (#113, #116). Replace the round-7 capitalisation sentence with:

   > Capitalise only the first word of a sentence, and only when it is a plain word; a sentence
   > that now starts with a quote, bracket, tool name or code keeps it as written.

Fix 1 targets both failing bars. Fixes 2-5 address passing-bar noise. A rerun of both arms costs
about 4.2 USD (this round's figure). The owner decides.

## Cost

| | USD | per call |
|---|---|---|
| arm A first pass (120) | 2.0870 | **0.0174 per comment** |
| arm A second pass (100) | 1.4569 | 0.0146 |
| arm B first pass (50) | 0.5602 | 0.0112 per unit |
| arm B second pass (9) | 0.1103 | 0.0123 |
| round 7 total | 4.2145 | within 4.70 |

Per-comment cost is up 8% on round 6 (0.0161), from the longer prompt. Pilot spend about 28.5 USD
against the 25.00 cap stated in round 6.
