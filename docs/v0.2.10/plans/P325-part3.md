# P325 Part 3: Stream, Definition and Console results keep data on drop

Base: Part 1 landed. Part 2 landed too: it adds `createImmediateMutator`'s `isStale` option,
which this part makes required. One sequential Sonnet implementer. Frontend only.

Read Part 1's "Shared audit facts" and "Design" first.

## Audit (CodeGraph)

**Stream** (`views/stream/`, Kafka/SQS):
- Page store dropped on disconnect. Gate at `StreamView.vue:128`.
- `useStreamGate.ts`: `canInsert`/`canDelete` (`:42-43`). They drive:
  - `StreamToolbar` compose (Send/Produce popover, `:283-292`, `produceKafkaMessage`/`sendSqsMessage`);
  - Delete message (`:309`, `onDeleteMessage` `:130`, `deleteSqsMessage` on the selected row's
    key).
- All three writes go through `createImmediateMutator` (`stream/mutations.ts`).
- SQS Poll (`ReceiveMessage`) is a read that hides messages server-side. It reads fresh data
  rather than acting on the shown page, so it stays as is: against a dead connection it fails
  as disconnected.
- Row menu (`stream/menu.ts`) is copy-only.

**Definition** (`views/definition/`):
- `noDrop`, so `rt.definition`/`rt.meta`/`rt.source` survive. Gate at `DefinitionView.vue:364`.
- No write path: DDL view, structure tables, copy.
- `load` failure does not unhydrate (`state.ts:66-74`). The connection state event covers it.

**Console results** (`views/console/`):
- Result pages dropped on disconnect (`dropConsoleResultPagesForTab`). `rt.results` metadata
  stays, so result tabs survive but point at freed pages.
- No reconnect gate. Run, Run all and Explain reconnect first (`useConsoleRun.ts:31-39`).
- The result grids are viewers: `ConsoleResultGrid.vue` publishes cells with no `onEdit`, and the
  dock mounts read-only. No write path reads the shown results.
- A new Run writes nothing derived from stale data: it executes the editor text after a
  reconnect.

## Design

- **Stamps.**
  - Stream `load` apply: `stamp(tabId, connectionId)`.
  - Definition `load` success: `stamp(tabId, connectionId)`.
  - Console: `stamp(tabId, connectionId)` when a run produces results.
- **Keep pages.** Add `'stream'` and `'console'` to `KEEPS_DATA_ON_DROP`. Definition needs no
  entry.
- **Banner.**
  - Stream and Definition: `StaleDataStrip` while stale, with the content kept. The
    `EmptyState` gate shows only with nothing loaded:
    - Stream: `needsReconnect && !page`.
    - Definition: `needsReconnect && !rt?.definition`.
  - Console: `StaleDataStrip v-if="stale && hasResults"` above the result strip. Its reconnect
    calls `onReconnectAndLoad` (already wired to `console-refresh`).
- **Lockout.**
  - Stream: `canInsert`/`canDelete` get `&& !stale`. Compose Send and Delete re-check after
    their popover or confirm. The mutator's `isStale` is the backstop.
  - Definition and Console: nothing to lock (audit above). Stating this keeps the banner the
    only change.
- **Mutator option becomes required.** All three callers now pass a real `isStale`.
- **SQS batch.** A batch tab never auto-loads. The strip's reconnect for a batch tab only
  reconnects. `onReconnectAndLoad`'s `onLoad` already skips `load` for batch (`StreamView.vue:38-43`).
  The strip stays until the next Poll stamps. That is correct: the shown messages are from
  before the drop.

## Changes

1. **`views/stream/state.ts`**: stamp in `load` apply. Add `isStale(tabId)`.
2. **`views/stream/useStreamGate.ts`**: add a `stale` computed. `canInsert`/`canDelete` get
   `&& !stale`. Return `stale`.
3. **`views/stream/StreamView.vue`**: the gate becomes `needsReconnect && !page`. Add
   `<StaleDataStrip v-if="gate.stale.value" testid="stream-stale" …/>` above the existing
   alerts.
4. **`views/stream/StreamToolbar.vue`**:
   - Compose and Delete are currently `v-if` on `canInsert`/`canDelete`. They would vanish
     while stale. Keep them visible and disabled while stale, with the connection-lost tooltip:
     the condition becomes `v-if="caps-allowed"` plus `:disabled="stale"`. Expose
     caps-allowed from the gate as `canInsertCaps`/`canDeleteCaps`, the existing caps and
     read-only expression without stale.
   - `onDeleteMessage` re-checks `gate.stale` after confirm. The compose submit returns early
     when stale.
5. **`views/stream/StreamRowsTable.vue`**: publish `stale` on `SelectedCell` if it publishes to
   the dock, so the chip names the reason.
6. **`views/stream/mutations.ts`**: `isStale: (id) => useStreamViewStore(pinia).isStale(id)`.
7. **`views/shared/immediateMutation.ts`**: make `isStale` required.
8. **`views/definition/state.ts`**: stamp in `load` success. Add `isStale(tabId)`.
9. **`views/definition/DefinitionView.vue`**: the gate becomes `needsReconnect && !rt?.definition`.
   Add `<StaleDataStrip v-if="stale" testid="definition-stale" …/>` at the top of the content.
10. **`views/console/state.ts`**: stamp when a run's results apply. Add `isStale(tabId)`.
11. **`views/console/ConsoleView.vue`**: add `stale` and `hasResults` computeds, where
    `hasResults` means `rt.results.length > 0`. Add
    `<StaleDataStrip v-if="stale && hasResults" testid="console-stale" :reconnecting="starting" @reconnect="onReconnectAndLoad" />`
    above the result strip.
12. **`state/tabs.ts`**: add `'stream'` and `'console'` to `KEEPS_DATA_ON_DROP`.
13. **`docs/ARCHITECTURE.md`**: finish the line. All seven views are covered. List the
    writeless ones (Definition, Console results), and say that SQS Poll is a fresh read, not a
    stale-data action.

## Tests

- **Backend flow test: none.**
- **Unit test: none.**
- **UI spec** `apps/kira-studio/tests/ui/view-connection-drop.spec.ts`, disconnecting through the
  tree menu. Three tests:
  1. **Stream (Kafka, `engineFixture`/`mockStream` as used by existing stream specs):** load
     messages and disconnect.
     - `stream-stale` visible, rows still render.
     - Compose and Delete are disabled. No `mutate`.
     - Reconnect: enabled.
  2. **Definition (postgres fixture):** open a definition and disconnect.
     - `definition-stale` visible, the DDL still shown.
     - Reconnect clears the strip.
  3. **Console (postgres):** run a SELECT and disconnect.
     - `console-stale` visible, the result grid still shows rows, a cell still selects.
     - Run reconnects first, and a new result clears the strip.
  For SQS, one assertion inside test 1's file if the `sqsFixture` makes it cheap: Delete is
  disabled while stale. Otherwise skip it; the predicate is shared.

## Verification

1. `bun run typecheck` and `bun run lint` pass.
2. `bun run test:ui:studio -- view-connection-drop immediate-write-connection-drop grid-connection-drop sqs-poll-visibility console definition copy-coverage`
   passes. Fix any spec that assumed the page drops.
3. Grep checks for the orchestrator:
   - `stamp(` appears in `stream/state.ts`, `definition/state.ts` and `console/state.ts`.
   - `StaleDataStrip` appears in seven views: `DataView`, `DocumentView`, `KeyValuePane`,
     `BrowseView`, `StreamView`, `DefinitionView`, `ConsoleView`.
   - `isStale` is no longer optional in `immediateMutation.ts`.
   - `KEEPS_DATA_ON_DROP` holds `data`, `document`, `keyvalue`, `stream` and `console`.

## Result

(Implementer fills in.)
