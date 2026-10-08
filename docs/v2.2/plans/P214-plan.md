# P214 plan: Memory manual add, free text

SPEC row: Add memory dialog gets one free-text box, no per-row fact/reason. Reason auto-filled as
manual. Submits through unchanged store path; gate splits, challenges, reconciles; stores only
when every step passes. No dependency on P211.

Base: `b17beb29c` (branch `v2.1-stream-C`). Small UI change. No Go change.

## Discovery (verified via `codegraph_explore` and source reads)

- `internal/memory/gate.go` `gatePrompt` step 1 already splits each item into atomic facts, attaches
  the item's reason, adds keywords. It challenges ambiguous referents, missing/circular/unsupporting
  reasons, questions/tasks, self-contradiction, conflicts with related memories, secrets.
  `validateGate` enforces every index answered once, each output fact 1 to `MaxFactLen`.
- `Service.Store` (`internal/memory/service.go:148`): validate, gate, any challenge stores nothing
  (`status: "challenged"`), else reconcile then commit per fact. Multi-fact output is already
  native: one item can yield many `Outcomes`.
- `validateRequest`: 1 to 20 items; each fact 1 to `MaxFactLen` = 1000 runes; reason at most
  `MaxReasonLen` = 2000; at most 10 clarifications of at most 1000 runes each.
- Author/source for UI adds are already fixed server-side: `bridge.MemoryService.Store`
  (`apps/kira-space/internal/bridge/memory.go:203`) sets `Author: memory.AuthorUser`,
  `Source: memory.SourceUI`. No "manual" source exists, and none is needed: `ui` already means
  added by hand in the module. Nothing to add to the model.
- `AddMemoryDialog.vue` today: `rows` of `{fact, reason}` (max 20), add/remove row, per-row
  challenge questions with answer textareas, `asked` clarifications carried across resubmits,
  outcomes list with `actionLabel` and click-to-select, cancel via `AbortController`. Calls
  `useStoreMemory` (`queries.ts`) -> `control.memoryStore` -> `MemoryService.Store`.
- Reason is optional in the dialog today; an empty reason makes the gate challenge "reason is
  missing". So an auto-filled reason is needed, else every free-text add gets challenged.
- P210 embedding/hybrid path: `commit` -> `vectorFor`, `kickBackfill`, `Search` hybrid. P214 sends
  through `Service.Store` unchanged, so it stays untouched.
- Playwright: `apps/kira-space/tests/ui/memory-module.spec.ts:135` covers challenge, resubmit,
  outcomes using `add-memory-fact`/`add-memory-reason` test ids. Mock channel `IPC.memoryStore`
  matches on exact `args`. No visual spec covers the dialog.

## Decisions

1. **Replace rows UI, no toggle.** SPEC row says "single free-text box (no per-row fact/reason)".
   Structured multi-item input stays available to agents through MCP `store_memory`.
2. **One item per submit.** Send `items: [{ fact: text.trim(), reason: MANUAL_REASON }]`. No
   client-side splitting: splitting on paragraphs would cut a pronoun off its referent, and the
   gate would then challenge it. Atomic splitting is the gate's job.
3. **Size cap: 1000 characters** (`MaxFactLen`). `maxlength="1000"` on the textarea plus a
   `n / 1000` counter. `maxlength` counts UTF-16 units, at least the rune count Go checks, so the
   client cap never exceeds the server's. Gate prompt budget is no concern: 1000 chars plus 10
   related memories. Longer documents belong to P211 bulk import.
4. **Auto reason:** `const MANUAL_REASON = 'Stated by the user, added manually in the Memory module.'`
   in the dialog. Client-side, not in the bridge, so the store path stays unchanged and MCP
   behaviour cannot shift. The gate may still challenge an item whose claim this reason cannot
   support (for example a third-party technical claim); that is the requested challenge step,
   answered through the existing clarification UX.
5. **Challenge UX unchanged:** one challenge block under the textarea, questions plus answer
   textareas keyed `0:q`; text stays editable before resubmit; `asked` carries prior answers.
6. **Outcomes list unchanged:** already renders one row per stored fact, so multi-fact output just
   shows several rows.

## Files touched

- `packages/workbench/src/memory/AddMemoryDialog.vue` (rewrite of `rows` state and template body).
- `apps/kira-space/tests/ui/memory-module.spec.ts` (update the one Add memory test only).
- `docs/ARCHITECTURE.md` (one added bullet in "Memory MCP server and module").
- `docs/v2.2/SPEC.md` (status cell and `## P214 result` section).

Stream A (P211, `/home/user/kira-v21-F`) touches `module.ts`, `memoryControl.ts`,
`shared/domain/memory.ts`, `events.ts`, `internal/memory/*` and new `import/` files; none of the
above code files. Shared docs: `docs/ARCHITECTURE.md` and `docs/v2.2/SPEC.md`. Keep those edits
additive: append a new bullet, append a new result section, change only the P214 status cell.
Do not edit `queries.ts`, `module.ts`, `MemoryPanel.vue`, `shared/domain/memory.ts` or any Go file.

## Commits (in order)

1. `feat(memory): free-text Add memory dialog`
   - Replace `rows`/`MAX_ROWS`/`addRow`/`removeRow` with `text = ref('')`, `MAX_TEXT = 1000`,
     `MANUAL_REASON`.
   - `canSubmit`: not busy and `text.trim() !== ''`.
   - `submit`: items `[{ fact: text.value.trim(), reason: MANUAL_REASON }]`; clarification
     collection unchanged.
   - Template: one `Label` "What should be remembered?" plus `Textarea` (`data-testid="add-memory-text"`,
     `maxlength`, placeholder like "Facts in your own words; Claude splits and checks them"), a
     counter `<span data-testid="add-memory-count">`, then the challenge block filtered to
     `index === 0`. Drop the trash button, "Add another" button, `TooltipIconButton` and
     `CodiconIcon` imports if unused afterwards (knip and biome flag leftovers).
   - Update the P201 header comment to one line naming P214 free text. Tailwind utilities only.
2. `test(memory): free-text Add memory flow`
   - In the existing test: fill `add-memory-text` with a two-claim text containing an ambiguous
     referent, e.g. `'it uses port 8080 and deploys on Fridays'`. Mock `args.items` is
     `[{ fact: text, reason: MANUAL_REASON }]` (literal string in the spec; spec cannot import the
     component constant cleanly, keep the two in sync by hand). Stored response returns two
     outcomes (`add`, `noop`); assert `add-memory-outcome-0` "Added", `add-memory-outcome-1`
     "Already known". Keep the clarification and two-call assertions. Rename the test title to
     mention free text.
3. `docs(memory): P214 free-text manual add`
   - `docs/ARCHITECTURE.md`: append a bullet after the "Memory UI adds `SemanticStatus.vue`" bullet:
     Add memory is one free-text box (cap 1000 = `MaxFactLen`), sent as one item with a fixed
     manual reason; the gate splits it into atomic facts; author `user`, source `ui`.
   - `docs/v2.2/SPEC.md`: P214 status `Done`, append `## P214 result` (short: what changed, checks
     run).

Each commit passes the pre-commit hook normally. Never `--no-verify`.

## Verification (implementer, once at end)

- `bun run typecheck`, `bun run lint`, `bun run lint:dead`.
- `bun run test:ui:space -- memory-module` (full spec file).
- No Go change, so no Go tests needed; confirm with `git diff --stat b17beb29c -- '*.go'` empty.

## Orchestrator verification greps

- `grep -n "rows\|addRow\|removeRow\|add-memory-reason\|add-memory-fact" packages/workbench/src/memory/AddMemoryDialog.vue`
  returns nothing.
- `grep -n "MANUAL_REASON\|maxlength\|add-memory-text" packages/workbench/src/memory/AddMemoryDialog.vue`
  hits all three.
- `grep -n "add-memory-text\|Already known" apps/kira-space/tests/ui/memory-module.spec.ts` hits.
- `git diff --stat b17beb29c -- internal apps/kira-space/internal packages/shared packages/workbench/src/memory/queries.ts`
  is empty (store path, model, P210 path untouched).
- `git diff b17beb29c -- docs/ARCHITECTURE.md docs/v2.2/SPEC.md` shows additions plus the P214
  status cell only.

## Deferred decisions (defaults applied)

- Reason wording: default `MANUAL_REASON` above. If real use shows the gate challenging most
  manual adds for reason alone, a follow-up row tunes `gatePrompt` (Go, shared with MCP).
- Text above 1000 characters: hard cap, no splitting. Revisit only if users hit it; P211 import
  covers documents.
- Separate `manual` source value: not added; `ui` already identifies it. A new enum value would
  collide with P211's `SourceImport` edits in `model.go`/`validateRequest`/`shared/domain/memory.ts`.
- Unit tests: none; no non-trivial logic added.
