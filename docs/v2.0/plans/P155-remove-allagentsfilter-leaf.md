# P155 Remove the dead `ade.allAgentsFilter` settings leaf

Base: `v2.0` at `335c2e8f`. Source: SPEC row P155, `plans/P149-audit.md` F1.

## 1. Inventory

Method: `codegraph_explore` over `AllAgentsFilter`/`SettingsRepo`/`readAde`/`upsertAde`/`AdePatch`,
then `git ls-files | xargs grep -l 'allAgentsFilter\|AllAgentsFilter'` plus `rg` over ignored output.
Re-run both at implementation start; the lists below must still match.

Live references (all in Kira Space):

- `apps/kira-space/internal/storage/model/settings.go`: `AdeSettings.AllAgentsFilter` (:61), default
  `"active"` in `DefaultAdeSettings` (:96), `AdePatch.AllAgentsFilter` (:154), `ValidAdeAllAgentsFilter`
  plus its comment (:228-231), check in `validateAdeSection` (:273-275).
- `apps/kira-space/internal/storage/repos/settings.go`: `readAde` `LeafValid` line (:79), `upsertAde`
  `UpsertOptional` block (:99-101).
- `apps/kira-space/frontend/src/state/settingsDomain.ts`: zod `allAgentsFilter` enum (:98), section
  default (:140), `defaultSettings.ade` (:182).
- `apps/kira-space/tests/unit/ade-v2-timeline.spec.ts:15`, `apps/kira-space/tests/unit/ade-v2-board-parity.spec.ts:39`:
  `SETTINGS` fixtures typed as `Settings['ade']` input to `buildTimeline`.
- `docs/ARCHITECTURE.md:4271`: Known open item.

Generated, gitignored, not edited by hand: `apps/kira-space/frontend/bindings/.../storage/model/models.ts`
(Wails bindings), `apps/kira-space/frontend/dist/assets/*.js`.

No reference anywhere else: no Go test, no `tests/ui` spec, `mockRuntime.ts` and `bootSnapshots.ts` use
`defaultSettings` (follows the zod change), no `tests/fixtures/ade-v2/*.json`, no Kira Studio code.
Only consumer of the whole `ade` object besides the store: `usePlanModel.ts:263` spreads
`settingsStore.ade` into `buildTimeline`; it reads named leaves only.

Confirmed dead: `AdeAllSessions.vue:14` keeps `ref<'running' | 'stopped'>`; nothing reads
`settingsStore.ade.allAgentsFilter` or patches it.

Historical records left as written (they describe what shipped then): `docs/v2.0/SPEC.md` :673, :867,
:2818, :2848, :2892, :3852; `docs/v2.0/design/SPEC.md:319` (`UiPrefs`, superseded by R19, accepted in
P149); `plans/P129-part2/3/7-*.md`; `plans/P149-*.md`.

## 2. Decisions

- **D1 Wire contract untouched, no step 0.** The leaf travels on `SettingsService.GetAll/Set`, not on
  `bridge/adewire`. `AdeTaskService` stays 53 methods; `tests/fixtures/ade-v2/` (28 fixtures) has no
  settings payload. The "wire change" P149 named is the `SettingsService` model shape and its
  regenerated bindings, done inside this phase.
- **D2 Delete the stored row in a migration, not leave it orphaned.** Reader already ignores unknown
  keys (`readAde` reads named leaves only, `ScanLeafRows` keeps the rest unread), so an orphan is
  harmless. Deleting it anyway follows the latest precedent for removed leaves: Kira Studio
  `0025_p97` (`codeIntel.mcpServerEnabled`), `0028_p120`, `0029_p127` (`claudeCode.hooks*`). The older
  "deliberate orphan" choice (`advanced.engineMemoryCapMb`, ARCHITECTURE "A known, deliberate orphan")
  cited migration-ordering risk; here that risk is nil, since P156 has no plan or code yet. Rows exist
  on real installs: v1 `AdeAllAgentsView.vue` (P129 Part 7) wrote it. This replaces the SPEC row's
  "migration-free reader" wording; the row is rewritten in §5.
- **D3 Migration numbers.** P155 takes `0013`; P156 moves to `0014`. Only reference to update: SPEC
  row P156 ("migration `0012` or later, check P150 first"). No P156 plan exists.
- **D4 No new test.** One `DELETE` and a removed field fail the unit-test bar (CLAUDE.md). Existing
  suites open real migrated DBs (`go test ./apps/kira-space/...`), which applies `0013` to a fresh DB.
- **D5 One sequential implementer.** About 8 files, three small commits, order-dependent docs. No split.

## 3. Changes

### 3.1 Go (commit 1)

1. `model/settings.go`: drop `AllAgentsFilter` from `AdeSettings`, `DefaultAdeSettings`, `AdePatch`;
   delete `ValidAdeAllAgentsFilter` and its comment; delete the check in `validateAdeSection`. gofmt
   realigns struct tags.
2. `repos/settings.go`: drop the `readAde` line and the `upsertAde` block.
3. New `apps/kira-space/internal/storage/migrations/0013_p155_drop_all_agents_filter.sql`:

   ```sql
   -- P155: ade.allAgentsFilter left the settings model (R19); its row is orphaned.
   DELETE FROM settings WHERE key = 'ade.allAgentsFilter';
   ```

4. `migrations/embed.go`: append
   `{Version: 13, Name: "p155_drop_all_agents_filter", File: "0013_p155_drop_all_agents_filter.sql"},`.

Message: `refactor(ade)!: remove dead ade.allAgentsFilter settings leaf` with footer
`BREAKING CHANGE: SettingsService ade section drops allAgentsFilter; migration 0013 deletes its row.`

### 3.2 Frontend (commit 2)

1. `settingsDomain.ts`: delete the zod `allAgentsFilter` line and both `allAgentsFilter: 'active'`
   default lines.
2. Both unit specs: delete the `allAgentsFilter` line from `SETTINGS`.
3. Regenerate bindings: `wails3 task common:generate:bindings` from `apps/kira-space` (gitignored;
   DEV_ENVIRONMENT.md). Then `rg allAgentsFilter apps/kira-space/frontend/bindings` returns nothing.

Message: `refactor(ade): drop allAgentsFilter from settings schema and fixtures`.

### 3.3 Docs (commit 3, with §7)

1. `docs/ARCHITECTURE.md`: delete the Known open item at :4271. In Kira Space `### Storage` after the
   `0012` line add: `` `0013`: deletes the dead `ade.allAgentsFilter` settings row. ``
2. `docs/v2.0/SPEC.md`: P155 row per §7; P156 row: replace "migration `0012` or later, check P150
   first" with "migration `0014` (`0013` is P155's)".
3. This plan: fill `## Result`.

Message: `docs: P155 result, migration 0014 for P156`.

## 4. Ownership

Single implementer owns every file in §3. Touch nothing in `/home/user/kira-studio-c2`.

## 5. End checks

Run once after commit 2, fix anything red in place (pre-existing included, CLAUDE.md):

- `go build ./... && go test ./apps/kira-space/... ./internal/...`
- `bun run lint:all` (biome, golangci-lint, knip)
- `bun run typecheck`
- `bun run test:unit`
- `bun run test:ui:space` (settings dialog and ADE panel boot on `defaultSettings`)
- `git ls-files | xargs grep -n 'allAgentsFilter\|AllAgentsFilter'`: only the §1 historical records
  plus this plan.

Migration spot check (one shot, nothing committed): copy a v12 Kira Space DB (or create one by
checking out `335c2e8f`, launching the server build once with a temp `KIRA_SPACE_HOME`, then
`sqlite3 <db> "INSERT INTO settings VALUES ('ade.allAgentsFilter','\"older\"')"`), relaunch on the new
build, confirm the row is gone and `SELECT version FROM schema_version` reads 13. Skip
if no server build runs in the sandbox, and say so in Result.

## 6. Acceptance

- No live code, schema, default, fixture or binding names `allAgentsFilter`.
- `SettingsService.Set` with `{ade:{allAgentsFilter:'older'}}` is no longer a known leaf: Go JSON
  decoding drops the unknown field, nothing is written.
- `0013` registered in `embed.go`, applies cleanly on fresh and v12 DBs.
- ARCHITECTURE Known open item gone, `0013` listed; P156 row says `0014`.
- All §5 checks green on non-bypassed commits.

## 7. SPEC row update

P155 row status becomes:
`**Done.** Leaf removed from Go model, repo, validation, zod schema, defaults, bindings and two unit
fixtures. Migration `0013` deletes the stored row (precedent `0025`/`0028`/`0029`); P156 moves to
`0014`. Wire contract (`adewire`, 53 methods) untouched. Plan [P155](plans/P155-remove-allagentsfilter-leaf.md).`

## Result

Commits: `41730398` Go + migration `0013`, `bbc57241` frontend schema, fixtures, bindings; docs commit follows.

Checks, all green: go build/vet/test; `lint:all` exit 0; `typecheck` exit 0; `test:unit` 1765 pass, 0 fail; `test:ui:space` 161 passed. Grep for `allAgentsFilter`: only §1 historical records plus this plan. Bindings regenerated, no match.

Migration spot check: throwaway Go test (deleted) migrated a temp DB to v12, inserted `ade.allAgentsFilter`, applied all migrations: rows=0, version=13.

Deviations: none.
