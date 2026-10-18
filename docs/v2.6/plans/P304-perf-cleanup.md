# P304 mini-plan: hand cleanup of docs/PERF.md

Base: `645a8ad2b` (last commit with the full file; repoint target for `git show`).
Before: 1826 lines, 143668 B.

## Citations (git grep, whole tree, minus eval fixtures and HISTORY.md prose)

- Code/tests: §2.1 (budgets.spec x5, perf.spec), §2.1a (budgets.spec, kiraSlickGrid, SlickGridHost, DEV_ENVIRONMENT),
  §2.1c (main.ts x3, columns.ts x3, kiraSlickGrid x4, slickTheme.css, slick-grid.spec x2), §2.2 (perf.spec x2),
  §2.3 (kira-studio README), §2.7 (frame.go x2, encode.go), §2.8 (dataframe.go x2, dataframe_test.go).
- Bare "PERF.md": columns scan.ts (wide fixture), console-format.spec, measure.ts (`:98-102` line ref, stale), viteAppConfig.ts,
  metrics calibration test ("belongs in docs/PERF.md"), README.md, ARCHITECTURE.md x4.
- ARCHITECTURE.md: §1, §2.2, §2.5, §2.6, §2.7, §2.13, §3, §5.
- PACKAGING.md §3. HISTORY.md (frozen, generated): §2.1, §2.13, §3, §4.
- `§7.4(b)` hits in slick-grid.spec are plan refs, not PERF.

## Verbatim

Header, §1, §2.1a, §2.1c, §2.13, §3, §5. Headings never change.

## Trim (lines before -> target)

| Section | Before | Target | Keep |
|---|---|---|---|
| 2.1 | 272 | 60 | headline table, tab-switch cause + 300 ms rationale, keystroke, p50-gate method note, P161 bounds, P57 M5 12/80 ms tier; drop P47/P161-docs/P163 tables, macOS rerun, L2-port prose |
| 2.1b | 39 | 10 | what it does, 1.90x/1.21x ratios, unmeasured caveat |
| 2.2 | 109 | 45 | structural finding 620-626 MB, L-A, lever verdicts one line each, L-D |
| 2.3 | 83 | 20 | verdict "not a G1 verdict", 689.5 vs 616.3 MB, why |
| 2.4 | 81 | 25 | Go verdict, 261.7 MB, 58%, AppProcessSet, Finder-launch note |
| 2.5 | 58 | 31 | wire table (10.872x), heap 40.9x one line, L2 note |
| 2.6 | 61 | 25 | table, 2.3-3.1x -> 1.00x, base64 1.33-1.36x |
| 2.7 | 122 | 40 | overhead + decode tables, encode regression cause |
| 2.8 | 46 | 25 | two fixes, result table, 1.06x |
| 2.9 | 112 | 12 | conclusions only |
| 2.10-2.12 | 78 | 14 | latest bundle sizes, Green Tea caveat |
| 2.14 | 38 | 8 | -3,943 B raw |
| 4 | 33 | 18 | three verdicts |

Target ~1030 lines.

## Repoint

Removed-subsection citations go to `git show 645a8ad2b:docs/PERF.md`: measure.ts `:98-102`, console-format.spec,
scan.ts wide fixture, others found by the resolve check.

## Verify

One-off grep: every `PERF.md §n` resolves to a heading. budgets.spec bounds vs §1. `check-docs`.

## Result

(filled at end)
