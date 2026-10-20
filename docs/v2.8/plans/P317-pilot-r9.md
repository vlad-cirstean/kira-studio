# P317 pilot round 9: judge

Prompt and code: worktree `agent-a2566b7cf2d795256`, commit `2ca08b3`. Applied from round 8: fix 1
(change-marker words stay verbatim, remove-and-reread test gone) in `memory.rewrite.system`, and
fix 3 as a code-side retry (`hedgeLeft` in `rewrite_gate.go`, `rewriteTwice` in `rewrite.go`).
Fixes 2, 4, 5, 6 not applied. Data: scratchpad `p315-pilot/round-9` (arm A, 120 repo comments)
and `round-9/b` (arm B, 40 third-party comments plus 10 prose notes), same units as rounds 5-8.
Every record has `calls.rewrite >= 1`. Judged from before/after text only; implementer labels
not used. Rubric as round 8. 76 of 120 arm-A finals are byte-identical to round 8 and keep their
round-8 verdict; the other 44 were judged fresh.

Implementer numbers recomputed from `results.jsonl`/`idem.jsonl`; all match: arm A rewritten 97,
unchanged 18, kept 5 (`hedge` #5, #6; `grew` #40; `width` #64; `form` #102); second pass fed 97,
changed 3 (#12, #37, #119), kept 0; arm B rewritten 11, unchanged 39, kept 0, second pass 11 fed,
0 changed. Cost 4.2936 USD. Hedge retry fired on 6 arm-A units (#5, #6, #30, #73, #103, #109),
0 arm-B units. Final lines over 100 columns: arm A #64 only (`kept:width`, input shipped); arm B
as round 8.

## Result: FAIL (arm B only, one unit)

| metric | bar | round 9 | round 8 |
|---|---|---|---|
| meaning-level bad (A) | <= 3/120 | 0 pass | 1 (#45) |
| missed-trivia (A) | <= 12/120 | 5 pass | 4 |
| harmful second-pass changes (A+B) | 0 | 0 pass | 0 |
| second-pass churn (A) | <= 5% | 3/97 = 3.1% pass | 9/102 = 8.8% |
| arm B meaning-level bad | 0 | 1 (#37) **fail** | 0 |
| arm B churn (not gated) | - | 0/11 | 0/9 |

Counts A: good 90, neutral 24, missed-trivia 5, bad-lost-why 0, bad-wrong 0, bad-style 1.

The arm-B failure is an `@author` line dropped from third-party code (see Arm B). If the owner
classes authorship as droppable history, every bar passes.

## Arm A first pass

- #45 fixed: "(previously issued with no lock held, after unlocking mu)" and "Add now runs" both
  stay. The change-marker rule now holds across rounds: "now", "still", "old", "used to",
  "already" stay in #37, #44, #53, #61, #63, #69, #85, #87, #95, #109, #111.
- Missed-trivia 5:
  - #5 `kept:hedge`. Both drafts keep "the compat run actually asked for"; input ships with label
    (P16 D4) and the hedge.
  - #6 `kept:hedge`. Both drafts keep "the text this function actually wrote"; input ships with
    labels P6's, P17 D6/D9, D8. Round 8 shipped this unit clean.
  - #64 `kept:width`, fifth round. Labels P2 R1 and P99 §9.3 ship.
  - #102 `kept:form`. The draft adds a trailing newline the input lacks; the gate is right.
    Labels P83 §9.1/P91 §8 and P110 B13 ship. Round 8 shipped this unit clean.
  - #119 keeps "unchanged from before this phase": a phase reference inside a change-marker
    clause, now kept verbatim by fix 1. Round 8 dropped it; second pass drops it.
- bad-style 1 (not graded): #68 drops "P74 §3:" at the start of a JSDoc continuation line and
  leaves "never a real `<a href>`" lowercase. Round 8 capitalised it.
- Neutral 24: unchanged 18 (#9, 13, 14, 16, 26, 33, 38, 46, 59, 60, 70, 76, 79, 82, 90, 91, 101,
  117), kept #40 (`grew`, same escape slip as rounds 6-8), and #50, #62, #96, #107, #112.
  - #16 and #79 are newly unchanged. #16 keeps "the same single defer conn.Close() this replaces
    used to cover every later failure", correct under the replaced-code rule.
  - #50 keeps "the ONE new member here (exactly one new `OpErrorKind`)", a phase-budget remnant,
    as round 8.
  - #62 drops "It lived in scan.ts ... until the find bar needed the identical three options"
    (listed moved-from note); "a find bar reaching up into the grid's scanner" still carries why.
  - #96 drops "Markup, virtual-list wiring, keyboard handling and every data-testid below are
    that file's own, byte-for-byte". Its referent is the dropped hoisted-from file.
- Fixed from round 8 without a targeted fix: #31 and #44 keep `just` meaning "only"; #41 keeps
  "Renamed from connectionColors now that an environment's colour draws from the same palette";
  #96 keeps "`columns` replaces the old hard-coded ..."; #32 drops the SPEC quote with its
  reference; #77 drops `actually`. #30, #73, #103, #109 ship clean through the hedge retry.

## Arm A second pass

97 re-fed, 94 unchanged, 3 changed, 0 kept. Harmful 0.

| id | change | verdict | class |
|---|---|---|---|
| 119 | drops ", unchanged from before this phase" | harmless | first-pass leftover (phase reference) |
| 12 | reflows a line the model counts as 101 columns; it is exactly 100 | harmless | noise: width miscount, no text change |
| 37 | drops "— a query-string password (?user=u&password=secret) was never masked at all before this fix, regardless of userinfo" | rule-breaking-no-loss | noise: how earlier code failed, which the prompt keeps. Sentence 1 still says query parameters that look like credentials are masked. Same history-versus-reason flip as round 8 #67 |

Leftover 1, noise 2. Noise fell from 4 per 100 (rounds 6-8) to 2 per 97: the change-marker
flippers (#24, #44, #66 in round 8) are gone. The history-versus-reason source (#37) remains.

## Hedge gate

- Effect: 6 retries in 120 units, 4 rescued clean (#30, #73, #103, #109), 2 kept (#5, #6). Arm B
  never retried. Retry cost about 0.10 USD this round.
- Value lost on `kept:hedge`: yes. Both kept drafts were otherwise complete label drops. Keeping
  the input ships 5 labels and 2 hedges where accepting the draft would ship 2 hedges. A hedge
  leftover is trivia; a label is trivia too, but the input carries more of it. In both units the
  model keeps "actually" in an actual-versus-assumed contrast, twice in a row; the retry does not
  move it.
- False rejects in this data: none by the prompt's rule. #5 and #6 use "actually" for contrast,
  but dropping it loses nothing ("the image the compat run asked for, instead of a version baked
  in"), so the prompt's every-occurrence rule applies.
- Latent false rejects in the code (not hit this round):
  - `quotedSpan` masks only double-quoted spans of 1-80 characters on one line. A quote wrapped
    across comment lines, a longer quote, a single-quoted or typographic-quoted span is not
    masked. Arm B #33 has exactly this shape: "only re-render on\n * properties you actually read"
    spans a line break. Round 8 kept that word (correct); had round 9 kept it, the gate would
    have retried and then kept the input.
  - The check runs before the `draft == input` test, so an input whose only hedge sits in such a
    quote comes back `kept:hedge` instead of `unchanged`, after a wasted retry. Output is still
    the input; the label and the UI message are wrong.
- Owner rule (code only accepts or rejects): no conflict. The gate never edits text; the retry is
  a second model call, as the existing `output` retry is. A mechanical strip (round-8 fix 3's
  other option) would conflict, and was not taken.
- Code review:
  - Correct as written: case-insensitive whole-word match, backtick spans masked first, retry
    only after attempt 0, last usable draft returned, `CostUSD` charged per call, schema/i18n/UI
    map updated, ARCHITECTURE line updated.
  - `rewriteTwice`: a non-`ErrOutput` error on the retry fails the whole request, although a
    usable first draft exists. Before this change only an `ErrOutput`-then-error sequence did
    that. Minor: return the first draft as `kept:hedge` on a retry error instead.
  - ARCHITECTURE says gates "run in order and stop at the first failure" and lists `hedge`
    after the others; in code `hedge` runs first. Wording only.

## Arm B

First pass: 11 rewritten, 39 unchanged, 0 kept. Second pass: 11 re-fed, 0 changed.

- Hedges only, no other word lost: #0 (`really`, `simply`), #4 (`actually` plus reflow), #8
  (`just`), #20 (`just` plus reflow), #41 note (`really`, line structure kept).
- Reflow only: #26, #31, #34 (ragged as round 8), #39.
- #37 **bad (content lost)**: drops the JSDoc line "@author strarsis <strarsis@gmail.com>" and the
  blank comment line before it, as `history`. An `@author` tag is authorship metadata that doc
  tools render and that third-party licence attribution may rely on; it is not narration. Round 8
  left #37 unchanged under the same "who changed it" wording, so this is variance on an ambiguous
  rule. The tokens gate passed it because the dropped list names it.
- #33 (not graded as meaning loss): drops `actually` inside the quoted behaviour name "only
  re-render on properties you actually read". Meaning holds, but a quoted phrase is altered.
  Round 8 kept it. Variance; the hedge gate would have pushed the other way (see Hedge gate).

## Round-8 fixes

| round-8 fix | target | round 9 |
|---|---|---|
| 1 change markers stay | #45; churn #24, #44, #66; #69 | held. #45 fixed; #24, #44, #66 stable; #69 keeps both `still`. Side effect: #119 phase reference kept inside a change-marker clause |
| 2 reason on a history note | #41, #96, #67, #62 | not applied; #41, #96 improved by variance; #37 second pass is this class |
| 3 hedges, code side | #5, #77 | applied as retry. #77, #30, #73, #103, #109 clean; #5, #6 now `kept:hedge` with labels shipped |
| 4 `just` meaning only | #31, #44 | not applied; both held by variance |
| 5 plan citations | #32 | not applied; #32 fixed by variance |
| 6 width | #64 | not applied; #64 fails a fifth round |

## Root causes and proposed fixes

Generic wording or code only. Not applied. No repo literal, no ledger, no "shorter" rule.

1. Authorship and doc tags (arm B #37, the failing bar). Root cause: "who changed it" reads as
   covering an `@author` line. Append to the history bullet:

   > Doc tags (@author, @since, @see, @deprecated and the like), licence and copyright lines
   > stay as written.

2. `kept:hedge` loses the draft's other drops (#5, #6). Root cause: a second hedge-holding draft
   rejects the whole draft. Code side: after the retry, send the draft through the other gates
   instead of keeping the input; a hedge leftover is trivia. This still only accepts or rejects.
   Recomputed on round 9: #5 and #6 leave missed-trivia as leftover hedges (still counted), but 5
   labels go.

3. Quoted spans in the hedge check (latent; arm B #33 shape). Code side: mask quotes across line
   breaks after stripping comment markers, drop the 80-character cap, and run the check only on
   a changed draft (an unchanged draft already returns the input).

4. Phase reference inside a change-marker clause (#119). Append to the change-marker sentence:

   > A phase, plan or version reference inside such a clause is a label; drop it, and drop the
   > clause if nothing true remains.

5. One retry on any gate rejection (#102 `form`, maybe #40 `grew`). Code side, generic: extend
   the existing retry from `output` and `hedge` to every gate. Accept/reject still holds. Cost: a
   few calls per 100.

6. Still open from round 8: fix 2 (reason on a history note, now the only noise source, #37
   second pass), fix 6 (width, #64).

Fix 1 targets the failing bar. Fixes 2-5 address passing-bar trivia and latent gate risk. A rerun
of both arms costs about 4.3 USD.

## Cost

| | USD | per call |
|---|---|---|
| arm A first pass (120) | 2.0436 | **0.0170 per comment** |
| arm A second pass (97) | 1.5362 | 0.0158 |
| arm B first pass (50) | 0.5765 | 0.0115 per unit |
| arm B second pass (11) | 0.1373 | 0.0125 |
| round 9 total | 4.2936 | |

Per-comment cost is up 2% on round 8 (0.0167), the hedge retries. Pilot spend about 37.1 USD
against the 25.00 cap stated in round 6.
