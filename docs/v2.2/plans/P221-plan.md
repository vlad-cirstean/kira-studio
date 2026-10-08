# P221 plan: memory setup moves to Settings

Base: `776abcbc3` (P219-P222 user fixes), branch `v22-fix-C`.

## Ask

User, verbatim: "for the memory module, move the semantic search download to setting and also the
connect claude code."

Orchestrator scope: both actions become a Kira Space Settings section. The Memory module keeps no
setup actions; it only points to Settings when something is not set up. Dictation model download
(P216) moves too, for consistency (Deferred decision D1).

## What exists today (verified on disk)

- `packages/workbench/src/memory/SemanticStatus.vue`: rendered in `MemoryPanel.vue:94`. States `off`
  (hidden), `notInstalled` (Download model (35 MB) button, error alert), `downloading` (progress,
  Cancel), `indexing` (progress), `unavailable` (alert, Retry), `ready` ("Semantic search on").
  Holds its `AbortController` in a component-local `let`: closing the Memory mode mid-download loses
  Cancel today.
- `packages/workbench/src/memory/ConnectClaudeDialog.vue`: opened from `MemoryPanel.vue:69-74` plug
  button via `useMemoryUiStore().connectOpen` (`store.ts`), mounted at `MemoryPanel.vue:132`.
  Command text, Copy (VueUse `useClipboard`), Register (`useInstallMemoryMcp`), outcome message.
- `packages/workbench/src/memory/dictation/MicButton.vue`: popover for `notInstalled` (size text
  "182 MB download, about 340 MB RAM", Download/Retry download), `downloading` (progress, Cancel),
  `unavailable` (reason, Retry). Same component-local `AbortController`. Used by `MemoryPanel.vue`
  (search box) and `AddMemoryDialog.vue`.
- `packages/workbench/src/memory/queries.ts`: TanStack Query hooks `useMemoryMcpStatus`,
  `useInstallMemoryMcp`, `useMemorySemanticStatus`, `useInstallSemanticModel`, `useRetrySemantic`,
  `useDictationStatus`, `useInstallDictationModel`, `useRetryDictation`. Shared `queryClient`. No
  change needed to any of them.
- `MemoryModuleContext` (`module.ts`) is `{ control }`, provided once in
  `apps/kira-space/frontend/src/App.vue:33`. `SettingsDialog` mounts under `TitleBar` under `App`, so
  `useMemoryModule()` and every memory query already work inside a settings pane. Kira Studio
  provides no memory module.
- Wails cancel: `apps/kira-space/frontend/src/bridge/memoryControl.ts` aborts via
  `signal -> call.cancel()` for both installs.
- `MemoryMcpStatus` (`packages/shared/domain/memory.ts:83`) has `command`, `executable`,
  `claudeAvailable`, `probed`. No "registered" flag; `internal/mcpinstall` has no read of current
  registrations. So the module cannot tell whether Claude Code is connected (D3).
- Kira Space settings: `apps/kira-space/frontend/src/state/settings.ts` `sections`
  (`Appearance, Git, Connected editors, Mobile access, Claude Code, Advanced`);
  `workbench/SettingsDialog.vue` renders one pane per section; panes take `SettingsPaneProps`
  (`workbench/settings/types.ts`), root `<div class="contents" v-show="active">`.
  `ConnectedEditorsPane.vue` and `MobileAccessPane.vue` bypass draft/Save (actions, not leaves).
  `createSettingsStore` exposes `openSettingsAt(section)`.
- UI specs: `apps/kira-space/tests/ui/memory-module.spec.ts` (Connect test, line 214),
  `memory-dictation.spec.ts` (notInstalled / downloading / unavailable popover tests, lines 46-97).
  No semantic spec exists. Mock defaults (`support/mockRuntime.ts:278-285`) set dictation and
  semantic `off`.

## Design

### Settings section "Memory"

New section `'Memory'`, inserted after `'Claude Code'`, before `'Advanced'`. One pane,
`apps/kira-space/frontend/src/workbench/settings/MemoryPane.vue`, bypasses draft/Save like
`ConnectedEditorsPane` (comment says so in one line). It composes three section components that live
in the shared memory package, because they need `useMemoryModule()`:

1. `ClaudeCodeMcpSection.vue`: "Connect Claude Code". Body of `ConnectClaudeDialog.vue` without
   the dialog chrome: description, command block (`memory-mcp-command`), app-move note, outcome
   (`memory-mcp-install-outcome`), buttons Copy command (`memory-mcp-copy`) and Register with Claude
   Code (`memory-mcp-install`, `variant="dialog-primary" size="kira-lg"`). Same disabled rules.
2. `SemanticModelSection.vue`: "Semantic search". From `SemanticStatus.vue`, every state. Hidden
   (`v-if`) when state is `off`. `ready` shows "On" plus the model id (`data.model`). Keeps testids
   `memory-semantic`, `memory-semantic-download`, `memory-semantic-cancel`, `memory-semantic-error`,
   `memory-semantic-retry`.
3. `DictationModelSection.vue`: "Dictation". From MicButton's popover, every state. Hidden when
   `off`. `ready` shows "Speech model installed". Keeps testids `dictation-download`,
   `dictation-error`, `dictation-progress-label`, `dictation-cancel-download`,
   `dictation-unavailable`, `dictation-retry`. Size text moves here verbatim (see P218 note).

Layout: each section a `FieldSet` with `FieldLegend` plus `FieldDescription`, Tailwind utilities
only, shadcn-vue `Button`/`Progress`/`Alert`. No `<style>` block. Order in the pane: Claude Code,
Semantic search, Dictation.

### Download cancel survives unmount: Pinia store

New `packages/workbench/src/memory/settings/modelDownloads.ts`, `useModelDownloadsStore` (one
concern: in-flight model download handles). Holds one `AbortController | null` per kind
(`'semantic' | 'dictation'`), kept non-reactive (`markRaw` or plain object inside the setup store,
exposing only methods). API: `begin(kind): AbortSignal` (aborts nothing; replaces any finished
handle), `cancel(kind)`, `end(kind)`. Sections call `install.mutate(store.begin(kind), { onSettled:
() => store.end(kind) })`. Why a store: the settings dialog unmounts on close, and the download
continues server-side; reopening must still offer a working Cancel. Server status (`downloading`
done/total) already survives through TanStack Query.

Accepted limit: a download error shown by the mutation (`install.isError`) is per component
instance; closing Settings mid-download and reopening after a failure shows `notInstalled` again
without the message. Not worth `useMutationState` plumbing; state it in the pane comment only if the
implementer finds it non-obvious.

### Pointer to Settings from the module

`MemoryModuleContext` gains a required `openSettings(): void` (the host opens its own settings at
the memory section; the shared package cannot import an app store). Kira Space
`workbench/memoryModule.ts` implements it as `() => useSettingsStore().openSettingsAt('Memory')`,
store resolved inside the closure (Pinia is active by then; keep it lazy anyway).

New `packages/workbench/src/memory/MemorySetupHint.vue`: one muted line plus a `variant="link"`
Button "Open Settings" calling `openSettings()`. No other actions. Used in two places:

- `MemoryPanel.vue`, replacing `<SemanticStatus />`: shown when semantic state is `notInstalled` or
  `unavailable` ("Semantic search is off." / "Semantic search unavailable."). testid
  `memory-setup-hint-semantic`, link testid `memory-open-settings`. Nothing shown for `off`,
  `downloading`, `indexing`, `ready`.
- `MemoryPanel.vue` empty state (`memory-empty`, query empty only): "Connect Claude Code in Settings
  to let it store memories." with the same link (testid `memory-setup-hint-claude`). Replaces the
  current "Add one, or let Claude Code store them." for the no-query case; the search-miss text
  stays.

`MicButton.vue`: keeps the mic visible for every non-`off` state (discoverability). Click when
`ready` toggles recording, unchanged. Other states open the popover, now text plus link only:
`notInstalled` "Dictation needs a local speech model.", `downloading` "Downloading the speech model:
X / Y MB" (read-only, no Progress needed), `unavailable` "Dictation unavailable: <message>". Link
`dictation-open-settings` closes the popover, then calls `openSettings()`. Remove
`useInstallDictationModel`, `useRetryDictation`, `abort`, `download`, `cancelDownload`, `Progress`,
`MB`/`percent` only if no longer used.

Nested dialog check: MicButton also sits inside `AddMemoryDialog`. Opening Settings from there stacks
a second reka-ui modal over the first. The UI spec must prove the Settings dialog is interactive in
that case (click a Memory-pane button). If it is not, the link inside AddMemoryDialog renders as
plain text "Set it up in Settings > Memory" (MicButton prop `settingsLink?: boolean`, default true,
AddMemoryDialog passes false). Do not close AddMemoryDialog: it may hold unsent text.

### Removals

- `packages/workbench/src/memory/ConnectClaudeDialog.vue`: delete (`git mv` to
  `settings/ClaudeCodeMcpSection.vue` then rewrite, so history follows).
- `packages/workbench/src/memory/SemanticStatus.vue`: `git mv` to `settings/SemanticModelSection.vue`.
- `MemoryPanel.vue`: plug button (`memory-connect`), `ConnectClaudeDialog` import and mount,
  `connectOpen` destructure.
- `store.ts`: `connectOpen`.

## File-by-file

| File | Change |
|---|---|
| `packages/workbench/src/memory/module.ts` | add `openSettings(): void` to `MemoryModuleContext`, one-line doc |
| `packages/workbench/src/memory/settings/modelDownloads.ts` | new Pinia store |
| `packages/workbench/src/memory/settings/ClaudeCodeMcpSection.vue` | from ConnectClaudeDialog |
| `packages/workbench/src/memory/settings/SemanticModelSection.vue` | from SemanticStatus, uses store |
| `packages/workbench/src/memory/settings/DictationModelSection.vue` | new, from MicButton popover, uses store |
| `packages/workbench/src/memory/MemorySetupHint.vue` | new pointer component |
| `packages/workbench/src/memory/MemoryPanel.vue` | removals above; hint in place of SemanticStatus and in empty state |
| `packages/workbench/src/memory/dictation/MicButton.vue` | popover becomes pointer only |
| `packages/workbench/src/memory/store.ts` | drop `connectOpen` |
| `apps/kira-space/frontend/src/workbench/memoryModule.ts` | implement `openSettings` |
| `apps/kira-space/frontend/src/state/settings.ts` | add `'Memory'` to `sections` after `'Claude Code'` |
| `apps/kira-space/frontend/src/workbench/settings/MemoryPane.vue` | new pane composing the three sections |
| `apps/kira-space/frontend/src/workbench/SettingsDialog.vue` | import and render `MemoryPane` (`activeSection === 'Memory'`); file comment pane count stays accurate |
| `apps/kira-space/tests/ui/memory-module.spec.ts` | see Specs |
| `apps/kira-space/tests/ui/memory-dictation.spec.ts` | see Specs |
| `apps/kira-space/tests/ui/settings-memory.spec.ts` | new, see Specs |
| `docs/ARCHITECTURE.md` | see Docs |

No Go change. No new dependency. `types.ts` (`SettingsSections`) unchanged: the pane edits no leaf.

## Specs (Playwright, `apps/kira-space/tests/ui`)

Open Settings the way `settings-claude-code.spec.ts` does: `emitWailsEvent(page, IPC.openSettings,
undefined)`, then click `settings-section-Memory`.

- `settings-memory.spec.ts` (new):
  1. Connect: moved from `memory-module.spec.ts` "Connect Claude Code shows the registration
     command", same mocks, same assertions, reached through Settings.
  2. Semantic `notInstalled`: pane shows `memory-semantic-download` with "35 MB"; click logs
     `IPC.memorySemanticInstall`. Semantic `unavailable`: reason plus `memory-semantic-retry` logs
     `IPC.memorySemanticRetry`.
  3. Dictation: the three tests from `memory-dictation.spec.ts` lines 46-97 (notInstalled with
     failed download and Retry download, downloading progress with Cancel, unavailable with Retry),
     same mocks and testids, asserted in the pane.
- `memory-module.spec.ts`: remove the Connect test. Add one test: no `memory-connect` button;
  with semantic `notInstalled` and empty recent list, `memory-setup-hint-semantic` and
  `memory-setup-hint-claude` show; clicking `memory-open-settings` opens Settings with the Memory
  pane visible (`memory-semantic` present).
- `memory-dictation.spec.ts`: replace the three moved tests with one: `notInstalled`, click
  `dictation-mic-memory-search`, popover has `dictation-open-settings` and no `dictation-download`;
  click it, Settings opens on Memory (`dictation-download` visible in the pane). Plus the nested
  check: same from `dictation-mic-add-memory` inside AddMemoryDialog, then click
  `dictation-download` in the pane and assert `IPC.dictationInstall` logged (proves the stacked
  dialog is interactive). If the fallback (plain text) is taken, assert the text instead and drop the
  click.

Keep the remaining dictation tests (listening, caret, errors, search refetch, event refresh) as is.

Run once at phase end: `bun run test:ui:space -- memory settings-memory settings-claude-code`
(file filters), then the full `bun run test:ui:space` once.

## Docs (`docs/ARCHITECTURE.md`, "Memory MCP server and module")

- Semantic bullet: "download on an explicit click in the Memory module" becomes "in Settings >
  Memory".
- MCP server bullet: "from the Connect dialog" becomes "from Settings > Memory".
- Space bullet: "search panel, detail with version trail, Add memory and Connect dialogs" drops
  Connect; add: setup lives in Kira Space Settings > Memory (`MemoryPane.vue` composing
  `packages/workbench/src/memory/settings/*`); the module only links there via
  `MemoryModuleContext.openSettings`; `useModelDownloadsStore` keeps Cancel working across dialog
  close.
- Replace the `SemanticStatus.vue` bullet accordingly.
- Speech bullet: "Download on click in the mic popover" becomes "in Settings > Memory; the mic
  popover only points there".

Terse style per CLAUDE.md.

## Commits (Conventional Commits, each passing the pre-commit hook)

1. `feat(memory): settings sections for model downloads and Claude Code` (store, three sections,
   `git mv`s, `module.ts` `openSettings`, Kira Space `memoryModule.ts`, `MemoryPane`, `sections`,
   `SettingsDialog`).
2. `refactor(memory): module points to Settings instead of hosting setup` (MemoryPanel, MicButton,
   MemorySetupHint, store.ts, deletions).
3. `test(memory): setup specs move to Settings` (three spec files).
4. `docs: memory setup lives in Settings` (ARCHITECTURE).

Commits 1 and 2 may merge if the hook cannot pass between them (e.g. knip flags an orphan).

## Verification (orchestrator runs these)

- `rg -n "ConnectClaudeDialog|SemanticStatus|connectOpen" packages apps -g '!**/node_modules/**'`:
  no hits.
- `rg -n "memory-connect" apps/kira-space/tests`: only a `toHaveCount(0)` assertion.
- `rg -n "useInstallSemanticModel|useInstallDictationModel|useInstallMemoryMcp|useRetrySemantic|useRetryDictation" packages/workbench/src`:
  callers only under `packages/workbench/src/memory/settings/` (plus `queries.ts` definitions).
- `rg -n "openSettings" packages/workbench/src/memory apps/kira-space/frontend/src/workbench/memoryModule.ts`:
  definition, Kira Space implementation, callers in `MemorySetupHint.vue` and `MicButton.vue`.
- `rg -n "useModelDownloadsStore" packages/workbench/src`: used by both model sections.
- `rg -n "<style" packages/workbench/src/memory apps/kira-space/frontend/src/workbench/settings/MemoryPane.vue`: no hits.
- `rg -n "'Memory'" apps/kira-space/frontend/src/state/settings.ts apps/kira-space/frontend/src/workbench/SettingsDialog.vue`: both hit.
- `bun run typecheck`, `bun run lint`, `bun run lint:dead`, `bun run build:space` clean.
- UI specs above green.

## Deferred decisions (defaults applied; user may override)

- D1 Dictation model download moves to Settings with the semantic model. Default: yes. Reason: both
  are optional local model downloads with the same status vocabulary; leaving one in a mic popover
  keeps a setup action in the module, which the ask removes.
- D2 Placement: one new "Memory" section rather than folding Connect into the existing "Claude Code"
  section. Default: "Memory", so all memory setup is in one place; "Claude Code" stays the keep-awake
  leaf.
- D3 No "registered with Claude Code" detection. Status has no such field and reading it means
  spawning `claude mcp get` per status read. Default: the module points to Settings for Claude Code
  only from the empty state. Adding real detection is a separate phase if wanted.
- D4 Mic stays visible while the speech model is not installed, as a pointer. Alternative: hide it
  until `ready`. Default: visible.

## P218 overlap

P218 (row above, not started) step 2 changes the speech engine and the "182 MB / 340 MB RAM" text in
`MicButton.vue:80`. This plan moves that text to `DictationModelSection.vue`. Whichever phase lands
second updates the text in its new home; nothing else in P218's file list overlaps.
