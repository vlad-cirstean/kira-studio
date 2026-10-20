# P315 pilot round 5: judge

Final prompt and gates: worktree `agent-ac4cde99980feb237`, commits `2ef15f6` (prompt), `af1f3f8`
(prose gate, narrow pre-check), `23ebc32` (prompt iteration). Data: `round-5/it2` (arm A, 120 repo
comments, first pass plus plain re-feed of the 99 rewrites) and `round-5/b2` (arm B, 40
third-party comments plus 10 prose notes). No ledger. Superseded first round-5 prompt
(`round-5/`, `round-5/b`) ignored. Every unit judged from before/after text; implementer labels not
used. Sources read for #41, #62. Rubric as rounds 1-4: unchanged is neutral or missed-trivia, never
bad.

## Result: PASS

| metric | bar | round 5 | round 4 |
|---|---|---|---|
| meaning-level bad (A) | <= 3/120 | 2 (#45, #94) pass | 2 |
| missed-trivia (A) | <= 12/120 | 4 (5 with #76) pass | 5 |
| harmful second-pass changes | 0 | 0 pass | 1 |
| second-pass churn | <= 5% | 3/99 = 3.0% pass | 10.4% |
| arm B meaning-level bad | 0 | 0 pass | 2 |

Counts A: good 83, neutral 25, missed-trivia 4, bad-lost-why 1, bad-wrong 1, bad-style 6.

## Arm A first pass

- #45 bad-wrong: "previously" dropped from "Add (previously issued with no lock held ...) could not
  guarantee", and "now" dropped from "Add now runs under the same lock". Text now says Add is
  issued with no lock held, then that Add runs under the lock. "previously" did not only mark a
  change: the parenthetical is false without it.
- #94 bad-lost-why: same as round 4. "the grid was the one view whose header carried no facts ...
  every sibling view says more" is why the badges exist; dropped as history. Also "(§7 forbids
  computing one automatically)" became "(forbids computing one automatically)", no subject.
- Missed-trivia 4: kept #64 (width; inherited 101-col line; P2 R1/P99 left), #102 (form; draft
  added a trailing blank line; P83/P91/P110 left), #118 (tokens; capitalisation turned path
  `project/state/tree.ts` into `Project/...`; C13-6d left), and leftover `actually` in #6 (prompt
  says remove every occurrence; second pass fixed it).
- bad-style 6 (not graded): #63 capitalised SQL type `numeric(p,p)` to `Numeric(p,p)`; #81 "(own
  component-local strip, ...)" and #116 "(own layout, ...)" plus `<!-- (axe ...)` lead, residue of
  a dropped label's possessive; #87 "no such implicit fallback" and "that keyword/type source" lost
  their antecedent with the dropped lang-sql clause; #96 "`columns` — the shape is data, not a
  class." fragment; #113 lowercase lead `"repository with no commits" state`.
- Neutral, borderline (current fact lost with a history clause; not counted): #34 old literal id
  "test" no longer stated, later "both used the key "test"" still reads; #37 "the last '@' ... is
  redacted" imprecise (the userinfo is); #41 "an environment's colour draws from the same palette"
  lost with the rename; #53 caller `editor.openAllChanges` lost; #61 "used to be hard-coded"
  reworded to "is not hard-coded"; #62 scan.ts origin dropped, but scan.ts now imports this file
  (`compileSearchPattern`), so "verbatim" was move history and "the scanner reaching down here"
  keeps the sharing; #112 two-app usage lost.
- Fixed from round 4: #35 keeps "ports planParsers/sqlite.ts"; #22 keeps the `readTopic` lead;
  #69 keeps the source-terminator invariant; #44/#56 no lowercase mid-paragraph; #73 rewritten (was
  kept:width).

## Arm A second pass

99 rewrites re-fed. Pre-check skipped 67; 32 model calls; 3 changed, 0 kept.

| id | change | verdict |
|---|---|---|
| 6 | drops `actually` in "this function actually wrote" | legitimate; first-pass leftover |
| 44 | drops ", no longer unbounded" | legitimate; "The same fixed upper bound as Connect's own failed-probe cleanup" already states the bound |
| 107 | drops "`.cm-line`'s own padding used to give each row" | legitimate; dead provenance (CodeMirror class, app on Monaco); "breathing room" purpose stays |

Harmful 0. Churn 3.0%. All three changes are first-pass leftovers, not new drops of clean text.
Implementer's three ids and labels match this read.

## Pre-check skips

Arm A, 17 skips: #9, 13, 14, 26, 33, 38, 40, 46, 59, 60, 70, 76, 79, 82, 90, 91, 101. 16 hold no
removable trivia. #76 is borderline: "exactly today's OperationsPanel.vue (184-216)" has a
time-bound "today's" and a line range; counted as missed-trivia in the conservative figure (5).
None clearly hides a label, hedge or change-marking clause.

Arm B, 35 skips: none holds a label, listed hedge or history narration. "probably" (#1), "Of
course" (#16), "In practice" (#13) are not listed hedges. #29's PR URL is a cross-reference.

Pre-check defect, harmless this round: multi-word history phrases do not match across a line break.
#79 "used\n * to outlive it" skipped; its text is a bug explanation and stays anyway. A real
change-marking "used to" split over two lines would be skipped.

## Arm B

Changed 8, all good, 0 meaning loss:
- #0 (`really`, `simply`), #8 (`just` as hedge in "simpler to just extend"), #41 note (`really`).
- #4, #20 (`actually`, `just` plus reflow), #26, #31, #39 (reflow of over-width lines only; #31
  spec steps keep every word).

Kept 1: #34 `grew`. Draft is reflow only and still left a line over 100, so allowance 0; no meaning
loss in the draft; keeping the input is right.

Round-4 losses gone: #18 called, unchanged, keeps "See issue #64947 for more detail, but" and "not
just on" (just meaning only). #42 called, unchanged, keeps "Previously ..." and "which is why it
went unnoticed for months".

Prose gate: notes reach the model only on a pre-check hit. #41 hedge-only draft accepted by
`proseKept`; #42 model returned it verbatim. The round-4 destructive drafts (#44 standup, #45
release notes) now never reach the model (no history word, no label shape, no width rule for
prose). Any such draft would fail `proseKept` by construction (only listed hedge tokens may go,
same line count, same indent). Gate behaviour is right; real-draft coverage this round is one
accepted case, plus the unit test's rejected case.

## Prompts and gates

- `memory.rewrite.system` and `memory.rewrite.check.system`: no repo literal (no P/D/F/G tags,
  `§` examples, plan paths, app names). Categories stated generically.
- `rewrite_precheck.go`: generic regexes only. `historyWord` narrowed to unambiguous narration as
  round 4 rec 2 asked. `rewrite_gate.go`: standard tool directives and licence headers only.
- No "shorter than original" rule. The prompt says "Never longer than the input"; the gate's `grew`
  rejects only `draft > input` (plus reflow allowance for comments), strict, so equal text always
  passes. Read: safety net, allowed.
- Inconsistency, minor: "Never longer than the input" contradicts reflowing an over-width line,
  which adds markers (#24 accepted longer via allowance).
- `gofmt -l` clean on `internal/llmprompts` and `internal/memory/importer` (round 4 rec 9 done).

## Recommendations (generic, optional, no rerun needed)

1. Prompt, capitalisation: never capitalise a word that is code (identifier, path, type,
   literal); leave the sentence lowercase instead. Covers #63, #118.
2. Prompt, history: a "previously" or "used to" whose clause becomes false without it is not a
   change marker; keep it or restate the clause as past. Covers #45.
3. Prompt, labels: when a dropped label held a possessive ("X's own"), drop "own" with it or name
   what it referred to. Covers #81, #116.
4. Prompt length rule: "Never longer than the input, except markers and indentation a reflow
   adds."
5. Pre-check: match history phrases on text with line breaks and comment markers collapsed to one
   space (same join `tokensKept` uses).

None blocks merge. Pilot spend about 20.3 of 21.00 USD; no further rounds without the owner's say.

## Cost

Arm A main 1.7480 USD (0.0146 per unit), second pass 0.4951, arm B 0.2274.
