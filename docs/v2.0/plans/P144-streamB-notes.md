# P144 Stream B notes

Base `8dd60e10`. Branch `v2.0-p144-b`. Pure board logic in `apps/kira-space/frontend/src/ade/v2/board/`.

## Commits

1. `18c9a85c` refactor: calendar helpers move to `board/calendar.ts`; `useQueue.ts` imports them and re-exports `LATER`, `offsetToIso`, `isoToOffset` (importers outside Stream B untouched); `knip.json` entry `src/ade/v2/board/*.ts`.
2. `4150e946` feat: `timeline.ts`, `branchGraph.ts`, `ade-v2-timeline.spec.ts`, `support/adeV2Fixtures.ts` (builders).
3. `41f60030` feat: `progress.ts`, `status.ts`, `ade-v2-progress.spec.ts`.
4. `bbb7ee10` feat: `actions.ts`, `baseMarker.ts`, `labels.ts`.
5. `2e612fa9` feat: `needsYou.ts`.
6. `889d0807` test: `support/mockupV2Oracle.ts`, fixture loader, `ade-v2-board-parity.spec.ts`.
7. Follow-up: parity covers `labels.ts` (was unimported); this file.

## End checks (§4.6)

- `bun run test:unit`: `1887 pass, 0 fail` (before follow-up).
- `bun run typecheck`: clean. `bun run lint`: clean. `bun run lint:dead`: exit 0 (only pre-existing duplicate-export warnings and config hints).
- `bun run typecheck:space-web`, v1 `ade-*` specs: green after commit 1.
- Contract untouched: `git diff 8dd60e10 -- ade/v2/wire.ts tests/fixtures packages/shared` empty.

## Deviations

- Extra file `board/branchGraph.ts` (§4.1 lists none): parent/ancestor/conflict relations shared by timeline, actions, baseMarker, labels. Imported by all four.
- `needsYou.ts` takes no `Prs` input: no Needs-you kind uses PR data (D9 drops CI). Takes `progress` map and `sessions` instead.
- Needs-you order: kind rank as SPEC2 §11 lists, then oldest first (plan §4.1 wording). Mockup orders by tone (red, amber, grey) then age with synthetic ages, so `setup failed` sits above `question` there. Parity compares the item set, not the order; order is asserted against `NEEDS_RANK`.
- Parity input normalization (fixtures vs mockup default data), all in the spec header: running headless run with session waiting on input becomes `stuck`; `pairs` recomputed from branch file lists (conflict when one side is review); `now` = 3m 40s after setup start; `b_bill` impl todo 3/10 (fixture 4/10); session `tk01` dropped.
- Divergence kept explicit in `DIVERGENCE`: `b_deps` mockup `CI failing`, ours `✓ clean` (D9).
- `stuck` is read from `Run.state` only (backend fact), not derived from session activity as the mockup does.
- Branch tag extras beyond mockup: `✕ conflict` + Rebase from `conflictsIfRebased` (only when `conflictCheck === 'done'`), `checking…`, `conflict check failed`; fixed-expectation test, no oracle.
- `deploymentChips` adds a `▲env ?` chip for status `unknown` (script failed); mockup has none.
- Rebase target: `''` means the branch's own base ref (main by default), not strictly main.
- Task title rule follows plan (title, Jira key, PR title, branch name, `New task`), so titles are not parity-compared (mockup prefers Jira title).
- Complexity lint (max 30) forced rule-table / helper splits in `timeline.ts`, `actions.ts`, `needsYou.ts`.
