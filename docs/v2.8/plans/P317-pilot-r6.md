# P317 pilot round 6: judge

Prompt and code: worktree `agent-abf6fa1ea2816f12a`, commits `c2690ee` (pre-check and check call
removed), `57bf07b` (round-6 prompt). Data: scratchpad `p315-pilot/round-6` (arm A, 120 repo
comments) and `round-6/b` (arm B, 40 third-party comments plus 10 prose notes), same units as round
5. Every record has `calls.rewrite >= 1`: no pre-check skip. Judged from before/after text only;
implementer labels not used. Source read for #63 and #96. Rubric as round 5: unchanged is neutral or
missed-trivia, never bad; shorter is not better.

## Result: FAIL

| metric | bar | round 6 | round 5 |
|---|---|---|---|
| meaning-level bad (A) | <= 3/120 | 1 (#94) pass | 2 |
| missed-trivia (A) | <= 12/120 | 5 pass | 4 (5 with #76) |
| harmful second-pass changes (A+B) | 0 | 1 (#61) **fail** | 0 |
| second-pass churn (A) | <= 5% | 8/102 = 7.8% **fail** | 3/99 = 3.0% |
| arm B meaning-level bad | 0 | 0 pass | 0 |
| arm B churn (not gated) | - | 0/10 | - |

Counts A: good 88, neutral 24, missed-trivia 5, bad-lost-why 1, bad-wrong 0, bad-style 2.

Churn is not like-for-like with round 5. There the pre-check skipped 67 of 99 re-fed texts, so only
32 reached the model and 3 changed (9.4% per model call). Round 6 sends all 102 to the model: 8
changed (7.8%). The model is no less stable than round 5. The pre-check hid that instability.

## Arm A first pass

- #94 bad-lost-why, as round 5: the clause "the grid was the one view whose header carried no
  facts ..." was dropped as history, but it is why the badges exist. "(§7 forbids computing one
  automatically)" is now dropped whole, so the rule that no count is computed automatically is
  gone too. The round-5 subject-less fragment is gone.
- Missed-trivia 5: #5 leftover `actually` ("the compat run actually asked for"); #6 leftover
  `actually` ("this function actually wrote"; the second pass fixed it); #64 kept:width (draft left
  inherited 101-col line, labels P2 R1 and P99 §9.3 stay); #77 kept:width (draft left the over-width
  `activeSection === '<Section>'` line; label P103 Part 2 stays; leftover `actually` in draft); #95
  change marker "no more" kept after "now" dropped.
- bad-style 2 (not graded): #113 lowercase quoted lead `"repository with no commits" state` (round
  5 too); #116 ``<!-- (Axe `aria-allowed-role`): ...``, which capitalised a tool name inside
  brackets, and "(layout, not a page banner)" is vague after "§6.2's own" was dropped.
- Neutral, borderline (not counted): #34 and #41, as round 5; #37: "the last '@' ... is redacted"
  is imprecise, as round 5 (the userinfo is redacted). #62 drops scan.ts move history, as round 5.
  #63: "old" dropped from "the old Math.max(1, ...) floor forced". It is not wrong, because the
  past tense stays and the code below reads `Math.max(0, ...)`. #65 lost what the declaration is
  ("given a voice"). #107: dead provenance "`.cm-line`'s own padding used to give each row" stays.
  #112 loses the two-app usage, as round 5.
- Unchanged 15 (#9, 13, 14, 26, 33, 38, 46, 59, 60, 70, 82, 90, 91, 101, 117): all neutral, none
  hides a label, listed hedge or change marker.
- Kept #40 (`grew`): the draft turned backticked `\` into `\\` (an escape slip on clean text). The
  gate rejected it; final is the input. Neutral.
- Fixed from round 5: #45 keeps "previously" (prompt fix held); #53 keeps `editor.openAllChanges`;
  #61 keeps "used to be hard-coded"; #76 drops "today's"; #102 no trailing blank line; #44 drops "no
  longer unbounded" on the first pass.

## Round-5 prompt fixes

| round-5 id | fix | round 6 |
|---|---|---|
| #45 | "previously" whose clause is false without it stays | held (first pass) |
| #63 | code not capitalised | held: `numeric(p,p)` |
| #118 | code not capitalised | held: `project/state/tree.ts` |
| #81 | "own" pointing at label dropped | held |
| #116 | label residue | partial: "own" gone; `(Axe ...)` lead residue stays |
| #87 | no phrase whose referent was dropped | held: lang-sql clause kept |
| #96 | no fragment | held (first pass) |
| length | reflow allowance | held: #7, #10, #24, #29, #42 reflows accepted |

Over-generalisation of the "own" rule: the first pass dropped `own` that pointed at no label
(#48, #114, #118). The second pass on #107 did the same as "trivia". Meaning is intact, but the prompt
says to keep every unlisted word.

## Regressions against round 5

None at meaning level. #77 moves from good to missed-trivia (kept:width). #64 is unchanged
(kept:width), so both 100-col leftovers remain. The model does not reflow an over-width line that
no drop touches, though the prompt allows it.

## Round-5 pre-check skips

Arm A, 17 units: 14 come back verbatim. #40 draft altered clean text (escape slip), gate kept the
input. #76 drops time-bound "today's" (good; round-5 borderline). #79 drops the closing sentence
"Called from `disposeGitTransport`'s own cleanup there." as a restatement of the opening clause
(good). "used\n * to outlive it" stays. No clean text was damaged.

Arm B, 35 units: all verbatim.

## Arm A second pass

102 re-fed, 93 unchanged, 8 changed, 1 kept (`grew`).

| id | change | verdict | why the prompt let it change |
|---|---|---|---|
| 6 | drops `actually` in "this function actually wrote" | benign polish (first-pass leftover) | listed hedge; first pass missed it |
| 45 | drops "which TrackerFor's own Add (previously issued with no lock held, after unlocking mu) could not guarantee against a concurrent Drain" | oscillation, not harmful | history rule is a judgment call; the first pass kept the clause (fix #4), the second called it history. The WaitGroup rule and "Add runs under the same lock" still give the why |
| 55 | rewrites "which every consumer used to walk assuming nothing ... filtered out — under ... that silently swept up" into present "walking it silently sweeps up" | oscillation, not harmful | "used to" read as a change marker on the re-feed; the rewording breaks "words you keep stay as written". The hazard is preserved |
| 61 | drops "The column list used to be hard-coded `"${c}"` ..., a *string literal* in a column position on MySQL/MariaDB (without ANSI_QUOTES) and ClickHouse — ... unusable on 3 of 5 engines." | **harmful, bad-lost-why** | the clause is "the bug a guard prevents", which the prompt says to keep. Only the reason dialect-driven `quoteIdent` matters is lost. "used to" pulled the model into the history bucket |
| 69 | drops ": a regression against the whole-document formatDialect call, which preserved every ';' it was given" | benign polish | the first pass left a dangling comparison to a removed call after dropping "P13's" |
| 85 | drops "This wrapper keeps runChunkedScan's call site (and its SearchQuery shape) unchanged." and "Still" | oscillation, borderline lost-why | "unchanged" and "Still" read as change markers. The sentence is also the wrapper's purpose, which the prompt says to keep ("what the current code gains") |
| 96 | drops "Hoisted from ... OperationsPanel.vue —", the byte-for-byte markup sentence, and the `columns` replacement sentence | oscillation, not harmful | moved-from notes are listed history. The first pass kept them as a cross-reference. OperationsPanel.vue now wraps OpLogPanel (source), so the parity sentence is move history |
| 107 | drops `own` in "`.cm-line`'s own padding" as trivia | benign polish, rule breach | over-generalised label-residue "own" rule; `own` is not a listed hedge |

Kept #89: the second draft added a trailing space after `->`. `grew` rejected it, and nothing was
shipped. That is a ninth non-verbatim model answer (9/102 = 8.8% at model level).

Harmful 1 (#61; 2 if #85 counts). Common cause: the history rule asks the model to decide whether a
past-tense clause is a current reason. "A text you cleaned before comes back unchanged" cannot
anchor that decision, because the model cannot see that it cleaned the text. Once labels are gone,
a re-fed text's remaining "used to", "unchanged" and "still" clauses draw the model's attention, and
it re-decides them.

## Arm B

First pass: 10 rewritten, 40 unchanged, 0 kept. All 10 good, 0 meaning loss:
- Hedges: #0 (`really`, `simply`), #4 (`actually` plus reflow), #8 (`just` as hedge), #20 (`just`
  plus reflow), #33 (`actually`), #41 note (`really`).
- Reflow of over-width lines only: #26, #31 (spec steps keep every word), #34, #39.

Second pass: 10 re-fed, 10 unchanged. Harmful 0, churn 0%.

Round-4 losses stay gone: #18 unchanged (keeps "not just on"). #42 note keeps "Previously ..." and
"which is why it went unnoticed for months". Notes #43-#49 (standup, release notes, design notes)
reached the model this round and all came back verbatim. #32 keeps a 104-col URL line; a URL
cannot be split, so this is not counted.

## Proposed prompt fix

Generic wording for `memory.rewrite.system` only. Not applied. No repo literal, no ledger, no
"shorter" rule.

1. History bullet: replace the sentences from "History narration: ..." through "... it is a current
   reason, as written." with:

   > History narration, only these: who changed it, when, in which version; a moved-from or
   > renamed-from note; a change-marker word ("now", "no longer", "used to", "previously", "old",
   > "new", "still", "unchanged") whose clause stays true without it (drop the word, keep the
   > clause). Every other past-tense sentence or clause stays as written, including how earlier
   > code failed, what the current code replaced, and why: it is the reason for the current code.
   > When unsure whether a clause is history or reason, keep it.

   This turns a per-clause judgment into a closed list, so a re-fed text has nothing new to decide
   (#45, #55, #61, #85). It also keeps #94's clause.

2. Label bullet: replace "Drop words that only pointed at the label, such as a possessive \"own\";"
   with:

   > Drop a word only when it pointed at the dropped label (a possessive "own" whose owner was the
   > label); elsewhere "own" and every other word stay.

   (#107, #48, #114, #118.)

3. Capitalisation: append to the label bullet:

   > Capitalise only the first word of a sentence, never a word inside brackets or quotes; a
   > bracket left at the start by a dropped label goes with the label or stays lowercase.

   (#116.)

4. Width, in Form: replace "Reflow only code comment lines a drop touched, or lines over the
   width." with:

   > Reflow only code comment lines a drop touched, and every line over the width, also in a text
   > with nothing to drop; a single unbreakable token (URL, path) may exceed it.

   (#64, #77.)

5. Copy fidelity, in Form: append:

   > Kept text is copied character for character: no added escape characters, no trailing spaces.

   (#40, #89.)

6. Already clean: replace "A text you cleaned before comes back unchanged." with:

   > Judge only by the lists above: a text whose remaining sentences match none of them comes back
   > verbatim, however it reads.

A rerun of both arms costs about 4.0 USD (this round's figure), which is above what is left in the
25.00 cap. The owner decides.

## Cost

| | USD | per call |
|---|---|---|
| arm A first pass (120) | 1.9356 | **0.0161 per comment** |
| arm A second pass (102) | 1.4197 | 0.0139 |
| arm B first pass (50) | 0.5512 | 0.0110 per unit |
| arm B second pass (10) | 0.1205 | 0.0120 |
| round 6 total | 4.027 | within 4.70 |

Pilot spend about 24.3 of 25.00 USD.
