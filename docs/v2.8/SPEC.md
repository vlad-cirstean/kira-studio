# v2.8

First phase `P306` (highest in `docs/HISTORY.md` is `P305`). Branch `v2.8`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P306 | Fix failing Release workflow. Run 39153063833 (tag v0.2.7): `db-compat (Linux, min)` fails `TestRedis_Console_SlowCommandTimesOutWithoutResend` (`err = <nil>, want E_TIMEOUT`, redis:7.0); `db-compat (Linux, max)` fails `TestKafka_Read_MidBrowseCancellation` (`want an error`, cp-kafka:8.3.0); `ci-gate` fails because PR CI failed. Root-cause both tests, fix in code. No `.github/workflows` push from here; see `docs/DEV_ENVIRONMENT.md`. | Todo |
| P307 | Operations panel shows a DB's preconnect scripts. Preconnect script run has a visible timer. Fix the race between "connecting" and the script itself. | Todo |
| P308 | Drag-and-drop reorder of DBs, scripts, repos in the left panel. Colored bars in the panel get thicker. | Todo |
| P309 | SQL cell editor: date editor has a large min height and scrolls out of view. Footer controls stay fixed; only the text editor scrolls. | Todo |
| P310 | SQL column tooltip: explanation and comment read as one run. Rearrange and format them. | Todo |
| P311 | Docker container list in the left panel scrolls sluggishly. Find the cause, fix (likely virtualization or per-row cost). | Todo |
| P312 | Panel sizes are per module (resize in studio, api stays unchanged). Share one panel size across modules. | Todo |
| P313 | Code review per `CLAUDE.md` (one Opus round, three dimensions), then fixer. Base: P305 close-out. | Todo |
| P314 | Comment cleanup: shorter atomic comments, aligned to the `CLAUDE.md` comment rule, across Go/TS/Vue. Needs a new comment-aware tool (see Notes); Opus plan decides scope and approach. | Todo |
| P315 | Close chapter v2.8 (fold per `CLAUDE.md`). Hold until user says to close. | Todo |

## Results

Filled per phase.

## Notes

P314 feasibility: `scripts/docshistory` distills markdown chapters and standing docs only (units are doc sections, output rewrites `docs/HISTORY.md` and the two standing docs). It cannot read or write source comments. Reusable: the `ingest_files` distill call, resumable run ledger, `--max-usd` cap. New: comment extraction (go/ast for Go; a TS/Vue parser for the rest), a rewrite prompt, safe write-back.
