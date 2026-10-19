# v2.8

First phase `P306` (highest in `docs/HISTORY.md` is `P305`). Branch `v2.8`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P306 | Fix failing Release workflow. Run 39153063833 (tag v0.2.7): `db-compat (Linux, min)` fails `TestRedis_Console_SlowCommandTimesOutWithoutResend` (`err = <nil>, want E_TIMEOUT`, redis:7.0); `db-compat (Linux, max)` fails `TestKafka_Read_MidBrowseCancellation` (`want an error`, cp-kafka:8.3.0); `ci-gate` fails because PR CI failed. Root-cause both tests, fix in code. No `.github/workflows` push from here; see `docs/DEV_ENVIRONMENT.md`. | Done |
| P307 Part 1 | Operations panel shows a DB's preconnect scripts. Preconnect script run has a visible timer. Fix the race between "connecting" and the script itself. | Done |
| P307 Part 2 | Per-connection preconnect delay setting (seconds, between starting the preconnect script and the first connect attempt). Covers non-loopback targets that the Part 1 readiness probe skips. Runs after P312 lands (migration number and generated bindings overlap). | Todo |
| P308 | Drag-and-drop reorder of DBs, scripts, repos in the left panel. Colored bars in the panel get thicker. | Todo |
| P309 | SQL cell editor: date editor has a large min height and scrolls out of view. Footer controls stay fixed; only the text editor scrolls. | Done |
| P310 | SQL column tooltip: explanation and comment read as one run. Rearrange and format them. | Todo |
| P311 | Docker container list in the left panel scrolls sluggishly. Find the cause, fix (likely virtualization or per-row cost). | Todo |
| P312 | Panel sizes are shared across modules today; they must be per module (resize in studio, api stays unchanged). Re-key per module, migrate current values. | Todo |
| P313 | Code review per `CLAUDE.md` (one Opus round, three dimensions), then fixer. Base: P305 close-out. | Todo |
| P314 | Comment cleanup across Go/TS/Vue. Build a comment-extraction tool (see Notes), rewrite via distill plumbing to shorter atomic comments in one consistent format per the `CLAUDE.md` comment rule. Must prove the rewrite is better: drop trivia and restated-code comments, keep every non-obvious why/constraint/workaround, never touch directives. Needs a quality gate: rule-based checks plus a sampled before/after report reviewed by an Opus judge; failures redo. Opus plan decides the format and gate. | Todo |
| P315 | Close chapter v2.8 (fold per `CLAUDE.md`). Hold until user says to close. | Todo |

## Results

Filled per phase.

**P306.** Both tests used workload speed as a clock; production code was correct. Redis: fixed 250M-iteration Lua loop finished under the 1s read timeout on a fast CPU. Now calibrated at runtime to a 3s target. Kafka: 20 000-record browse finished before the 50ms cancel; the producer compressed the repetitive pad into one fetch. Now incompressible pads plus a 64 KiB/s consumer quota on client-id `kira-studio` (removed in cleanup) and a 500ms cancel delay; elapsed to error ~501ms. Verified: default images `-count=5`, redis 7.0/8.10, cp-kafka 8.3.0/7.4.0 via `db-compat.sh`, full redis+kafka packages. `ci-gate` goes green once PR CI is green on the new commit; not provable here.

**P307 Part 1.** Preconnect script is an operation (kind `preconnect`, cancellable, no re-run) with a live elapsed timer in `OpLogPanel`. Race fixed: for a loopback host:port target, `Supervisor.Start` dials every 100ms while the script runs and connects only once the port accepts (60s timeout); other targets keep the 2s settle window (Known open item in `docs/ARCHITECTURE.md`, per-DB delay setting is the follow-up). Backend flow test `TestSQLitePreconnectOp` and a matching `contract:` UI spec. Full `test:ui:studio` not run; Studio `operations.spec.ts` and Space `operations`/`list-keyboard` specs pass.

**P309.** Timestamp pane now `shrink-0` at natural height; only the encoded Monaco flexes (`basis-0`). Editor body clips with `overflow-hidden`; decoded-empty alert scrolls. UI test `timestamp controls stay in view at small dock height` fails on the old classes, passes now. At the 120px drag minimum with find open, 34 + 34 + 20 + 72 exceeds the dock, so the find-open check runs at default height.

## Notes

P314 feasibility: `scripts/docshistory` distills markdown chapters and standing docs only (units are doc sections, output rewrites `docs/HISTORY.md` and the two standing docs). It cannot read or write source comments. Reusable: the `ingest_files` distill call, resumable run ledger, `--max-usd` cap. New: comment extraction (go/ast for Go; a TS/Vue parser for the rest), a rewrite prompt, safe write-back.
