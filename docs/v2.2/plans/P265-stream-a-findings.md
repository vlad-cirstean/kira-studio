# P265 Stream A findings

Needs from files Stream A does not own. Test-and-fix agent applies each, then deletes this file.

## Specs owned by another stream

- `apps/kira-studio/tests/ui/automations-module.spec.ts:406` (Stream C): collection delete confirm message is now `“Backend” and everything inside it will be deleted. This can’t be undone.` under title `Delete collection?`.

## Foundation gaps

- `scripts/copy/catalogRules.ts` C6 treats the word after ` — `, `: ` and `. ` as a sentence start, so a lowercase word there fails. Messages were reworded to sentences. `AI`, `SSO`, `PII`, `CDATA`, `DOCTYPE` are not in `PROPER_NOUNS`; messages avoid them or take them as placeholders.

## Stream A result

Branch `p265-a`. Typecheck and lint ran per commit under the normal hook. No UI, visual, e2e or unit suite ran.

### Commits

| Chunk | Commit |
|---|---|
| A1 | `2c856487e` |
| A2 | `68b1962e3` |
| A3 | `f643e6969` |
| A4 | `50353e362` |
| A5 | `416393557` |
| A6 stream and views | `3f03f76e6` |
| A6 workbench | `c2262bc07` |
| A7 sweep (helpers and `.ts` files `check-copy` misses) | `d27b5b816` |
| Specs | `2dc641bc9` |

### Files done

Every file under `apps/kira-studio/frontend/src/` that renders text. `studio` namespace of `en.json` holds the messages. Shared keys reused from `common` where text matched.

### Allowlist remaining

`scripts/copy-allowlist/stream-a.txt` holds 4 permanent lines: `fonts.ts`, `views/console/completion.ts`, `views/grpcrequest/GrpcMetadataTable.vue`, `views/shared/document/ejson.ts`.

### Deviations and leftovers

- Colour names show as raw palette ids.
- Engine plan-node labels, SQL keywords and code samples stay as-is.
- `bodyBadgeLabel` in api-core is unused.
- `nodeKindLabel` reuses `backend.menu.view.label` from the Stream B namespace.
- `automations-module.spec.ts:406` belongs to Stream C.
- `timestamp.ts` `MONTH_ABBR` stays: data formatting.
- KeyValuePane data-type strings (`s3 object field`, `redis <type>`) stay.
- `beautify.ts` is worker-bound; workers cannot import `t`.
- Shared `SettingsShell` prints section ids `Api` and `Database MCP` raw. A shared label prop is needed; coverage spec allows both.
- `Kira Studio` app-name args in `appUpdate.ts` and `main.ts` stay: module top-level `t` is banned by U70.
- `studio.api.curl.dynamicValues.hint` dropped the `{{$…}}` sample.
- Font group `On this Mac` is now `Installed`. Mode label `Api` is now `API`; the visual settings spec section `Api` is a section id and is unchanged.
- Stream C already committed `copy-wording-docker-automations.spec.ts` and `copy-coverage-docker-automations.spec.ts` under `apps/kira-studio/tests/ui/`. Stream A did not write them: a second copy would conflict on rebase.
- Coverage spec skips surfaces needing heavy fixtures: saved queries menu, explain result, definition view, documents toolbar, key-value view, stream view, gRPC request view.
- Collections panel menu is not covered; only the empty state is.

### Specs written, not run

- `apps/kira-studio/tests/ui/copy-wording.spec.ts`
- `apps/kira-studio/tests/ui/copy-coverage.spec.ts`
- Helper `apps/kira-studio/tests/ui/support/copyScenarios.ts`

Both typecheck and lint clean. Expect tuning on first run: `allow` patterns for fixture data, QueryState trigger via Docker `Containers` error, context-menu label extraction via `.flex-1`.
