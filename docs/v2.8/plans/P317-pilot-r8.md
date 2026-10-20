# P317 pilot round 8: judge

Prompt: worktree `agent-ab443aca99ca379ac`, commit `104579b` (round-7 proposed fixes 1-5 applied
to `memory.rewrite.system`). Data: scratchpad `p315-pilot/round-8` (arm A, 120 repo comments) and
`round-8/b` (arm B, 40 third-party comments plus 10 prose notes), same units as rounds 5-7. Every
record has `calls.rewrite >= 1`. Judged from before/after text only; implementer labels not used.
Rubric as round 7. 63 of 120 arm-A finals are byte-identical to round 7 and keep their round-7
verdict; the other 57 were judged fresh. Verdicts follow rounds 6-7 precedent for borderline drops
(#41, #96 below).

Implementer numbers recomputed from `results.jsonl`/`idem.jsonl`; all match: arm A rewritten 102,
unchanged 16, kept 2 (`grew` #40, `width` #64); second pass fed 102, changed 9, kept 0; arm B
rewritten 9, unchanged 41, second pass 9 fed, 0 changed. Cost 4.2910 USD. Final lines over 100
columns: arm A #64 only (`kept:width`, input shipped). Arm B over-width ids are the #32 URL line
and prose notes #40-#49, as round 7.

## Result: FAIL (churn only)

| metric | bar | round 8 | round 7 |
|---|---|---|---|
| meaning-level bad (A) | <= 3/120 | 1 (#45) pass | 1 |
| missed-trivia (A) | <= 12/120 | 4 pass | 6 |
| harmful second-pass changes (A+B) | 0 | 0 pass | 1 (#87) |
| second-pass churn (A) | <= 5% | 9/102 = 8.8% **fail** | 7/100 = 7.0% |
| arm B meaning-level bad | 0 | 0 pass | 0 |
| arm B churn (not gated) | - | 0/9 | 0/9 |

Counts A: good 86, neutral 28, missed-trivia 4, bad-lost-why 0, bad-wrong 1, bad-style 1.

## Arm A first pass

- #45 bad-wrong, third round running: "(previously issued with no lock held, after unlocking mu)"
  loses "previously". The model's reason calls it a marker "whose clause stays true without it".
  The next sentence says Add runs under the lock, so the clause is false. The round-7 remove-and-
  reread test did not catch it: the model rereads the clause alone, not against the next sentence.
- Missed-trivia 4:
  - #5 leftover `actually`, as rounds 6-7 (byte-identical final); second pass fixed it.
  - #77 leftover `actually`. `dropped` no longer lists it (consistent, still missed); second pass
    fixed it.
  - #64 kept:width, fourth round. The draft never touches the inherited 101-column line, so
    labels P2 R1 and P99 §9.3 ship. The new measure-every-line sentence did not reach it.
  - #32 partial label drop: only "(v1.3)" goes; the quote "SPEC's own "a byte-boundary post-check
    ..." (docs/HISTORY.md)" stays. Round 7 dropped it; second pass dropped it.
- bad-style 1 (not graded): #31 drops `just` in "it is genuinely just this one Version var".
  There `just` means "only", which the prompt keeps.
- Neutral, borderline (not counted):
  - #41 drops "renamed from connectionColors now that an environment's colour (this phase) draws
    from the same palette —" whole. The rename is listed history; "an environment's colour draws
    from the same palette" is why the set is a palette and why the alias exists. Round 7 kept it;
    round 6 judged the same drop neutral.
  - #96 drops "`columns` replaces its hard-coded `grid-cols-[...]` value (the shape is data, not a
    class)", what the current prop replaced. Round 7 kept it; round 6 judged the same drop
    (second pass) not harmful. Both regress against the "what the current code replaced" rule.
  - #44 drops `just` in "just no longer unbounded" (merely; meaning holds). #69 drops `still` twice
    in "a document that ended in ';' still does, one that did not still does not"; reads elliptical.
    #27 drops unlisted `already`. #50 keeps "ONE new member here (exactly one new `OpErrorKind`)",
    a phase-budget remnant. #16, #62, #107, #109, #112 as round 7.
- Unchanged 16 (#9, 13, 14, 26, 33, 38, 46, 59, 60, 70, 76, 82, 90, 91, 101, 117): all neutral.
  Kept #40 (`grew`): same escape slip as rounds 6-7; neutral, input shipped.
- Fixed from round 7: #24 and #73 reflow within width (were kept:width); #103 drops `actually`;
  #113 and #116 keep the quote/bracket lead as written; #27, #48, #61 get "the" for a dropped
  possessive label (also #65, #68, #75, #81, #109, #116); #87 first pass keeps the "used to rely
  on" clause; #37 keeps "used to be"; #55 keeps "used to walk"; #79 keeps "used to outlive";
  #100 keeps "previously staged".

## Round-7 prompt fixes

| round-7 fix | target | round 8 |
|---|---|---|
| 1 change-marker test | #87, #37, #44, #67, #45; churn | partial. #87 and #37 now stable both passes; first pass keeps "used to" clauses (#37, #55, #79, #87, #100). #45 still wrong. #44, #67 still oscillate in second pass |
| 2 possessive label becomes "the" | #27, #48, #61 | held, 13 units |
| 3 dropped list matches text | #77, #103 | partial: #103 fixed; #77 list now honest but hedge still kept; #5 unchanged |
| 4 width, also untouched lines | #24, #64, #73 | partial: #24, #73 fixed; #64 still fails. Side effect: arm B #34 splits an over-width line at the last space without joining the rest ("suitable for usage" alone on a line); style only |
| 5 quoted lead | #113, #116 | held |

## Arm A second pass

102 re-fed, 93 unchanged, 9 changed, 0 kept. Harmful 0.

| id | change | verdict | class |
|---|---|---|---|
| 5 | drops `actually` | harmless | first-pass leftover (hedge) |
| 77 | drops `actually` | harmless | first-pass leftover (hedge) |
| 32 | drops the SPEC quote and (docs/HISTORY.md) | harmless | first-pass leftover (label) |
| 24 | drops `now` in "(conns now has it" | harmless | first-pass leftover (change marker, clause stays true) |
| 50 | drops "ONE new member here (exactly one new `OpErrorKind`)" | harmless | first-pass leftover (phase budget) |
| 62 | drops moved-from sentence "It lived in scan.ts ... until the find bar needed ..." | harmless | noise: listed history; first pass kept it. "Hoisted here ... a find bar reaching up into the grid's scanner" still carries the why |
| 66 | drops `still` in "matching/highlighting still works" | harmless | noise: listed marker, clause true without it |
| 44 | drops ", no longer unbounded" | rule-breaking-no-loss | noise, as round 7: "unbounded" alone is false, so the test says keep. The bound is stated earlier ("same fixed upper bound") |
| 67 | drops "so the CodeMirror-only glue ... `buildHoverSource` existed for has no equivalent to keep" | rule-breaking-no-loss | noise, third round: what the current code replaced |

5 of 9 complete a first-pass miss; 4 of 9 are second-guessing a defensible first-pass keep.

## Is the 5% churn bar attainable

Comparable rounds (every re-fed text reaches the model): round 6 8/102 = 7.8%, round 7 7/100 =
7.0%, round 8 9/102 = 8.8%. Round 5 is not comparable (pre-check skipped most re-feeds; 9.4% per
model call). Split by class:

| round | first-pass leftover | noise (judgment-call flip) | harmful |
|---|---|---|---|
| 6 | 2 (#6, #69) | 5 (#45, #55, #85, #96, #107) | 1 (#61) |
| 7 | 2 (#5, #103) | 4 (#37, #44, #67, #85) | 1 (#87) |
| 8 | 5 (#5, #24, #32, #50, #77) | 4 (#44, #62, #66, #67) | 0 |

Noise holds at 4-5 per 100 every round, whatever the prompt fix. Its sources are the same two
judgment calls: change-marker words (#24, #44, #45, #66, #85) and history-versus-reason clauses
(#37, #55, #62, #67, #96). Each recurring flipper (#44, #67, #85) sits on one of them. Leftovers
(2-5) track first-pass completeness and are wanted changes, not instability.

Realistic floor with the current rule set: about 4% noise plus 2-5% leftovers, so 6-9%. 5% is
reachable only if the change-marker rule goes (proposed fix 1) and hedges are made deterministic
(fix 3). Recomputed on round 8 with both: #5, #77 never reach the second pass and #24, #44, #66
have nothing to flip; 4/102 = 3.9%. Without those, the owner should either gate on noise churn
only (changes that are not completing a first-pass miss; round 8: 4/102 = 3.9%) or raise the
bar to 10%. Harmful 0 stays the real stability bar; it held this round for the first time.

## Arm B

First pass: 9 rewritten, 41 unchanged, 0 kept. All 9 keep every non-hedge word, 0 meaning loss:
hedges #0 (`really`, `simply`), #4 (`actually` plus reflow), #8 (`just` as hedge), #20 (`just`
plus reflow), #41 note (`really`, line structure kept); reflow only #26, #31, #34, #39. #34
reflow is ragged (see fix 4 row); style only. Second pass: 9 re-fed, 9 unchanged, churn 0%.
Unchanged units as round 7 (#33 keeps `actually` inside a quoted behaviour name; notes verbatim).

## Proposed prompt fix

Generic wording for `memory.rewrite.system` only, plus one code-side option. Not applied. No repo
literal, no ledger, no "shorter" rule.

1. Change markers (#45 bad-wrong; churn #24, #44, #66; neutral #69). Replace the change-marker
   item and the remove-and-reread test with keeping them:

   > History narration, only these: who changed it, when, in which version; a moved-from or
   > renamed-from note. Change-marker words ("now", "no longer", "used to", "previously", "still")
   > stay as written.

   Cost: a few leftover markers ship ("now" in #24, #102). They are not listed trivia once the
   rule goes, so missed-trivia does not rise. Three rounds of test wording have not fixed #45.

2. Reason attached to a history note (#41, #96, #67, #62). Append to the history bullet:

   > When a moved-from or renamed-from note carries a reason ("now that X", "because X", "until
   > X"), drop the note and keep X as a plain sentence. A sentence naming what current code
   > replaces ("X replaces Y") stays.

3. Hedges (missed #5, #77; churn #5, #77). Code side, generic: after the model call, if the final
   text still contains "really", "basically", "actually" or "simply" outside quotes and code
   spans, re-call once or strip the word mechanically (the list is closed; `just` stays with the
   model). Prompt wording has not removed #5 in three rounds.

4. `just` meaning only (#31, #44). Replace the `just` clause in the filler bullet with:

   > "just" stays before a noun phrase, number or comparison ("just this one", "just two", "just no
   > longer"); drop it only before a verb ("would just be", "we'll just return").

5. Plan citations (#32). Append to the label bullet:

   > A quote from or citation of a plan, spec or history document goes with its reference.

6. Width (#64; arm B #34). Code side: mechanically reflow any final line over the width before
   the gate, instead of `kept:width`. Prompt side, append to the width sentence: "Reflowing a line
   joins the cut words to the start of the next line of the same paragraph." Four rounds show the
   model never touches an inherited over-width line it does not otherwise edit.

Fixes 1 and 3 target the failing bar. Fixes 2, 4, 5 and 6 address passing-bar noise and
borderline drops. A rerun of both arms costs about 4.3 USD (this round's figure). The owner
decides, including whether to redefine the churn bar instead (see above).

## Cost

| | USD | per call |
|---|---|---|
| arm A first pass (120) | 1.9983 | **0.0167 per comment** |
| arm A second pass (102) | 1.6116 | 0.0158 |
| arm B first pass (50) | 0.5667 | 0.0113 per unit |
| arm B second pass (9) | 0.1144 | 0.0127 |
| round 8 total | 4.2910 | |

Per-comment cost is down 4% on round 7 (0.0174). Pilot spend about 32.8 USD against the 25.00 cap
stated in round 6.
