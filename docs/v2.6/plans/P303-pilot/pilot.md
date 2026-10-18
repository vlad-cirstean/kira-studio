# P303 pilot: distill 9 standing-doc units

Planner run, 2026-10-18, tree `83e59846b` (worktree `kira-p303`). Real pipeline: `go build -tags server
./apps/kira-space` (placeholder `frontend/dist{,-mobile}/index.html`, gitignored), one `kira-space memory-mcp`
process per unit (temp `KIRA_MEMORY_HOME`, `KIRA_SPACE_HOME`), MCP `tools/call` `ingest_files`
`{distill: true, text}`, default (P298) prompts. Claude CLI 2.1.302. Driver: throwaway Bun script in the
planner's scratchpad, not committed (same as P299's pilot).

Unit text: `# <file>: <heading>`, a `Section: <heading>.` body paragraph (P299: title must be a body
paragraph), then the section body. Table rows flattened: first cell as a bold paragraph, every other cell as
`<header>: <cell>`. `units.jsonl` holds each unit's line range, input size, output lines and cost.

## Results

| unit | lines | in chars | out lines | out chars | USD | wall s |
|---|---|---|---|---|---|---|
| hcr (HUMAN_CODE_REVIEW.md, whole) | 1-44 | 2,235 | 9 | 1,911 | 0.079 | 21 |
| arch-invariants | 88-123 | 2,688 | 13 | 1,965 | 0.056 | 25 |
| arch-pg (PostgreSQL / MariaDB / MySQL) | 234-266 | 2,687 | 7 | 1,839 | 0.056 | 23 |
| arch-caching | 1214-1312 | 7,634 | 30 | 5,901 | 0.113 | 43 |
| arch-i18n (Copy and i18n) | 2371-2457 | 9,456 | 40 | 7,273 | 0.235 | 74 |
| arch-stack-ui (Stack rows, flattened) | 27-35 | 19,962 | 72 | 13,827 | 0.388 | 83 |
| arch-security (Renderer security surface) | 5331-5434 | 10,161 | 26 | 5,103 | 0.145 | 48 |
| pack-gaps (§6 Known gaps) | 305-353 | 4,426 | 14 | 2,253 | 0.073 | 28 |
| pack-build (§1 Building locally) | 15-83 | 4,198 | 18 | 2,773 | 0.081 | 31 |

Spend: 1.226 USD over 9 calls, 0 failures, 0 unresolved. Mean 0.136 USD per unit; least-squares fit
0.005 USD + 0.0185 USD per 1,000 chars (P299's SPEC units: about 0.010 per 1,000 at 25 KB). ARCHITECTURE is
denser: output/input 0.50 to 0.77 (weighted 0.68), against P299's 0.22 to 0.36 above 5 KB.

## Loss (internal/textloss)

`textloss.LostText` and `Recall` over `memfmt.StripMarkup(source)` vs `StripMarkup(lines)`: markup stripped
both sides, since distill output drops backticks and the backtick category would otherwise count every span.
"Hard" = numbers, identifiers (`identRe`), paths, double-quoted spans; unique tokens. Names are noisy
(sentence-initial capitals count) and negation counts fall with sentence count, so both are reported only.

| unit | hard lost / total | numbers | identifiers | paths | quoted | negation drops | names lost |
|---|---|---|---|---|---|---|---|
| hcr | 7/28 (25%) | 0/5 | 2/6 | 4/15 | 1/2 | 3 | 15 |
| arch-invariants | 12/18 (67%) | 5/9 | 2/3 | 3/4 | 2/2 | 3 | 20 |
| arch-pg | 13/35 (37%) | 2/4 | 3/11 | 8/18 | 0/2 | 1 | 12 |
| arch-caching | 27/90 (30%) | 6/21 | 7/43 | 13/25 | 1/1 | 3 | 37 |
| arch-i18n | 27/78 (35%) | 10/25 | 9/33 | 6/18 | 2/2 | 3 | 59 |
| arch-stack-ui | 83/309 (27%) | 16/78 | 16/99 | 46/126 | 5/6 | 5 | 49 |
| arch-security | 84/150 (56%) | 28/34 | 30/70 | 22/39 | 4/7 | 5 | 68 |
| pack-gaps | 23/54 (43%) | 9/20 | 5/17 | 7/15 | 2/2 | 4 | 18 |
| pack-build | 33/70 (47%) | 11/19 | 11/25 | 11/25 | 0/1 | 0 | 15 |

ARCHITECTURE units together: 246/680 hard tokens lost (36%).

## Read side by side

- arch-security: every decision and reason carried (no-subject vs no-analogue split, clipboard allowlist
  because `copyText` throws, navigation lock recorded as a loss, PR URL vs commit-body URL trust split, re-check
  after a Wails bump). Lost: line locators (`hostHandlers.ts:433`), file-name evidence lists, the Wails beta
  history (`beta.15`, `beta.16`), the opening "this section is shorter, that is the finding" framing.
- arch-stack-ui: flattened table rows survive as one or more lines per row; P110 escape-hatch ladder kept with
  its four rungs. Table flattening works for prose-cell tables.
- pack-build: commands kept as plain text (12 of 14 backticked commands verbatim, backticks dropped); the
  bundle-layout code block is gone; `setup.sh:64-71` locators lost.
- pack-gaps: lost the open-state entry "§4 items 1, 2, 3 and 10 passed ... items 4-9 are still unrun". A real
  loss of an open item: gap lists stay verbatim.
- hcr: faithful, 15% shorter, but drops the **WIP.** status, the three `##` headings and the
  `asFooTab`-style and "Zod schema + inferred type, no logic" examples; negations n't 2 to 0, no 4 to 2.
- No invented fact found in the 9 units. 0 `E_*` error codes in the pilot units (35 unique in ARCHITECTURE).
