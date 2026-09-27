# P133 — Custom scripts configured only from the terminal module; Settings' Scripts pane removed: plan

Plan for `docs/v2.0/SPEC.md`'s P133 row. Planned against `v1.9` at `bcf7be70`, with P129 Part 4
and P132's planner in flight in the same working tree (§8).

Symbols, call graphs and blast radius read via `codegraph_explore`: `TerminalPanel.vue`,
`TerminalScriptsSeam`/`TerminalModuleContext` (`module.ts`), both apps' `createTerminalModule`,
`ScriptsPane.vue`, `useCustomScriptsStore`, `customScriptSchema`, both `SettingsDialog.vue`s, both
`state/settings.ts`, `SettingsShell.vue`, `createSettingsStore`/`openSettingsAt`,
`model.CustomScriptFields.Validate`, `CustomScriptsRepo.Update`. Literal strings (`'Scripts'`,
test ids, stale copy) and test files came from `rg`.

---

## 0. What the SPEC row left open, and how each is resolved

| Open point | Resolution |
|---|---|
| Row's file/line refs predate P128 | Stale. Panel is now `packages/workbench/src/terminal/TerminalPanel.vue` (shared). The "+" is `TerminalNewTab.vue`, not Studio's `WorkbenchShell.vue`. Current lines in §1. |
| Seam shape | Row says "list/create/remove". Real seam is `records()`/`create`/`remove`/`openEditor()` (`module.ts:14-19`). Grows `update`; `openEditor` is deleted (§2.1). |
| One-script edit form, or all-scripts manager? | One `QuickCommandsDialog.vue` listing every script as an editable row plus an add row (ScriptsPane's layout, relocated). "Manage…" opens it. "Edit…" opens it focused on that row. Why: §2.2. |
| Where dialog state lives | `TerminalPanel.vue` local ref. No Pinia store: one component reads it, nothing shared (§2.4). |
| Rejected edit: silent revert, or revert plus message? | Revert (kept) plus the backend message in the dialog's `FieldError`. §2.3 rule 3. |
| Colour and remove failures | ScriptsPane let both reject unhandled. The dialog catches and shows them (§2.3 rules 4-5). |
| Kira Space | Unchanged. Its `terminalModule.ts` injects no `scripts`, so no Quick commands section and no dialog. |
| Test and baseline moves | §5. Every Studio settings baseline re-records, since the nav loses a row. |
| Overlap with P129 Part 4 / P132 | No shared file. One real cross-stream collision: P129 Part 4's closing audit (§8). |

## 1. Confirmed current state

- **Seam** (`packages/workbench/src/terminal/module.ts:14-26`): `TerminalScriptsSeam{records(), create(fields), remove(id), openEditor()}`, optional `scripts?` on `TerminalModuleContext`.
- **Studio injects it** (`apps/kira-studio/frontend/src/workbench/terminalModule.ts:32-37`). `openEditor: () => settingsStore.openSettingsAt('Scripts')` is the only link from the terminal module to Settings. **Space** (`apps/kira-space/frontend/src/workbench/terminalModule.ts`) injects no `scripts`.
- **Store** (`apps/kira-studio/frontend/src/state/customScripts.ts`) already has `updateCustomScript(id, fields)`. Only `ScriptsPane.vue` calls it today. Bound `CustomScriptsService.Update` and IPC `kira:customScripts:update` exist. No Go change needed.
- **Panel** (`packages/workbench/src/terminal/TerminalPanel.vue`):
  - Inline add, name + command only, `workingDir: ''`, `color: 'none'` (`onAdd`, 77-91).
  - Run (96-101): `'script'` launch kind at 99.
  - Remove with confirm (104-111). Copy at 103/107 still names "the tab strip".
  - Context menu (113-134): `Edit…` calls `scripts.value?.openEditor()` (121).
  - Header gear `Manage scripts…` (156-162, `data-testid="quick-commands-manage"`) calls `scripts.openEditor()`.
  - Header comment 21-27 states P91 §11.3's width reason for the Settings detour.
- **ScriptsPane** (`apps/kira-studio/frontend/src/workbench/settings/ScriptsPane.vue`, 274 lines). The only UI that:
  - sets working directory or colour on an existing script;
  - creates a script with working directory and colour;
  - shows a create validation error (`custom-script-error`).

  Rules, verbatim:
  1. **Drafts per row** (`scriptDrafts`, 29-45). Re-synced wholesale by `watch(records, …, {immediate})`.
  2. **Blur-commit** name/command/workingDir (`onScriptFieldBlur`, 50-82):
     - trims name/command;
     - **empty name or command reverts** all three drafts, no call;
     - no-op when unchanged;
     - otherwise `updateCustomScript` with the row's current colour;
     - **rejected edit reverts** all three drafts (catch, silent).
  3. **Immediate colour** (`onScriptColorChange`, 87-94): swatch `@change` updates at once with the stored name/command/workingDir. No catch.
  4. Remove with confirm (96-104). No catch.
  5. Add (106-136): `canAddScript` needs trimmed name and command. Fields are all trimmed, workingDir included. Colour is chosen via swatches. Error shown in `FieldError`. Inputs reset on success.
- **Settings wiring (Studio only)**:
  - `SettingsDialog.vue`: import at 15, mount at 89-95, "eight panes" comment at 18.
  - `state/settings.ts`: `'Scripts'` at 17, header comment 6-11.
  - `workbench/settings/types.ts`: "eight settings panes" at 4-5.
  - `openSettingsAt` has two other callers: `CookiesPane.vue:80` and `RequestSettingsPane.vue:88` (`'Api'`). It stays.
- **Space Settings** has no Scripts section (`sections` = Appearance/Git/Connected editors/Advanced). One comment names Studio's `'Scripts'` section: `ConnectedEditorsPane.vue:15`.
- **Stale comments naming the pane, the Settings section or a scripts dropdown:**
  - `packages/workbench/src/components/SettingsShell.vue:63` and `:131-132`;
  - `packages/workbench/src/state/createSettingsStore.ts:71`;
  - `apps/kira-studio/internal/storage/model/customscript.go:10`;
  - `apps/kira-studio/internal/bridge/customscripts.go:13` and `:72`;
  - `apps/kira-studio/frontend/src/state/customScripts.ts:6-8` and `:18`;
  - `packages/theme/src/SwatchRadio.vue:3` and `packages/theme/src/tailwind-core.css:130`, both naming `ScriptsPane`;
  - `docs/ARCHITECTURE.md:1247-1260`, whose terminal-module paragraph also misnames `TerminalStart.vue` as the quick-commands panel.
- **Tests**:
  - `apps/kira-studio/tests/ui/settings-scripts.spec.ts` (3 tests): add with trimmed fields plus workingDir; Add disabled on empty name/command; non-absolute workingDir error. None covers editing.
  - `tests/ui/terminal-module.spec.ts` (4 tests): covers the inline add.
  - `tests/visual/settings.spec.ts:13` lists `'Scripts'`, with baseline `settings-scripts-visual-linux.png`. The shell's nav (`SettingsShell.vue`, `v-for="section in sections"`) sits inside every settings screenshot. Removing a section changes all 7 remaining Studio baselines.

## 2. Design

### 2.1 Seam

```ts
export interface TerminalScriptsSeam {
  records(): readonly CustomScript[];
  create(fields: CustomScriptFields): Promise<unknown>;
  update(id: string, fields: CustomScriptFields): Promise<unknown>;
  remove(id: string): Promise<void>;
}
```

- `openEditor()` is deleted. The editor now lives in the shared module, so no host detour is left.
- Rewrite the doc comment: Studio's store, and Space injects none. Drop the "P85 panel" framing.
- Studio `terminalModule.ts` adds `update: (id, fields) => customScriptsStore.updateCustomScript(id, fields)` and removes `openEditor`. `settingsStore` stays, since `appearance` uses it. Update the header comment.
- Space `terminalModule.ts` is untouched. Its "minus `scripts`" comment stays true.

### 2.2 `packages/workbench/src/terminal/QuickCommandsDialog.vue` (new)

**Why one manager dialog, not a single-script form.** A per-script form gives the "Manage…" gear nothing to open. Settings' create path would also be lost: all four fields at create, with the error shown. That path is the only place `custom-script-error` coverage lives. A manager dialog with a focus target serves both launch points with one component and one copy of each rule. It answers P91 §11.3's width concern too: the dialog sets its own width, not the panel's 180-480px.

- `<script setup lang="ts">`. Props: `{ scripts: TerminalScriptsSeam; focusId: string | null }`. Emits: `close`.
  - Seam as a prop, not `useTerminalModule()`: the panel mounts the dialog only inside its `v-if="scripts"` branch, so the type is non-optional and needs no runtime throw. This matches `UpdateDialog.vue`'s store-as-prop pattern.
- Mount pattern follows `UpdateDialog.vue`/`SettingsShell.vue`: the parent owns the `v-if`. The component exists only while open, so draft lifetime equals dialog lifetime.
- shadcn primitives: `Dialog :open="true" @update:open="(v) => !v && emit('close')"`, `DialogContent :show-close-button="false" data-testid="quick-commands-dialog" class="flex flex-col p-0 gap-0 w-150 max-h-4/5"`.
- `DialogHeader` holds `DialogTitle` "Quick commands" and a `DialogClose` ghost icon button (`data-testid="quick-commands-dialog-close"`). Same as `CopyAsCurlDialog.vue`.
- Body: `overflow-auto`, `flex flex-col gap-2 p-3`, Tailwind only, no `<style>`.
- Body content is ScriptsPane's template moved with these changes:
  - **Intro `FieldDescription`** loses the tab-strip clause: "Each quick command opens a new terminal tab running its command. An empty working directory uses the Terminal module's default directory."
  - **Empty state**: "No quick commands yet."
  - **Per-row inputs** keep ScriptsPane's testids (`custom-script-name`/`-command`/`-workingdir`/`-remove`, row `custom-script-${id}`, list `custom-script-list`). Moved tests then change only their dialog locator.
  - Rows also get `data-script-id` for focus.
  - **Add row** keeps `custom-script-add*` ids.
  - **`FieldError data-testid="custom-script-error"`** is shared by add and edit errors.
  - **`aria-label`** on every `Input`: "Name", "Command", "Working directory". ScriptsPane relied on placeholders alone.
  - **Working directory placeholder** becomes "Default directory". The shared module does not assume `$HOME`. The default is whatever `ctx.defaultCwd()` resolves per app.
- Swatches: `SwatchRadio` plus `Tooltip`/`TooltipTrigger`/`TooltipContent` over `PALETTE_COLOR_CHOICES`, as ScriptsPane did.
  - `packages/workbench` already imports `@shared/*` and `@theme/*`.
  - Portaled `DialogContent` keeps Vue's provide chain, so the app-root `TooltipProvider` still applies. `SettingsShell`'s dialog already relies on this.
- **Focus on "Edit…"**: handle `DialogContent`'s `@open-auto-focus`.
  - `focusId` set: `preventDefault()`, then find `[data-script-id="<id>"] [data-testid="custom-script-name"]` under a `useTemplateRef` body element, `scrollIntoView({ block: 'nearest' })` it and `focus()` it.
  - `focusId` null: default reka auto-focus.
  - Unknown id (removed in another window): fall back to default focus. Never throw.

### 2.3 Field rules carried into the dialog (behaviour contract)

1. **Blur-commit** name/command/workingDir. Body is `onScriptFieldBlur` verbatim, calling `props.scripts.update`.
2. **Empty reverts.** Empty trimmed name or command resets all three drafts from the stored record, with no call.
3. **Rejected edit reverts.** On catch, reset all three drafts, then set `error` to the message (`err instanceof Error ? err.message : String(err)`).
   - Why the message is new: the dialog is now the only place to set a working directory on a quick command added inline. A silent revert would give no reason.
   - `error` clears at the start of every commit, colour change, remove or add.
4. **Immediate colour.** Swatch `@change` calls `update` at once with the stored name/command/workingDir.
   - On failure, show the message and re-sync the radio group. The native radio stays checked on the rejected swatch while the `checked` prop never changed, so a second click fires no `change`.
   - Re-sync by bumping a per-row counter in the fieldset's `:key`. No DOM poking.
5. **Remove.** Confirm, then `remove`. On failure, show the message. The confirm lives in one helper (§2.5).
6. **Add** is ScriptsPane's `onAddScript` verbatim, calling `props.scripts.create`: all four fields, trimmed, colour chosen, error shown, inputs reset on success.
7. **Drafts sync.** Keep `watch(() => props.scripts.records(), syncDrafts, { immediate: true })`. The store replaces `records` wholesale on each broadcast, so the watch fires per change, same as today.

### 2.4 `TerminalPanel.vue`

- `const editor = ref<{ focusId: string | null } | null>(null)`.
- Mount `<QuickCommandsDialog v-if="editor" :scripts="scripts" :focus-id="editor.focusId" @close="editor = null" />` inside the `v-if="scripts"` root. Dialog visibility is one component's local state, so there is no Pinia store. CLAUDE.md's Pinia rule is for *shared* client state.
- Gear button:
  - label becomes `Manage quick commands…`, aria `Manage quick commands`;
  - keep `data-testid="quick-commands-manage"` and icon `settings-gear`;
  - `@click="editor = { focusId: null }"`.
- Context menu `Edit…`: `run: () => { editor.value = { focusId: script.id }; }`.
- `onRemove` delegates to the shared helper (§2.5).
- Comments:
  - Header 21-27: rewrite to say full editing is `QuickCommandsDialog.vue`. Drop the Settings detour and the width rationale it answered.
  - `onAdd` 73-76: "until the user sets one in Settings" becomes "in the Quick commands dialog".
  - Line 103: drop "tab strip".

### 2.5 `packages/workbench/src/terminal/scriptActions.ts` (new)

```ts
export function useRemoveScript(): (scripts: TerminalScriptsSeam, script: CustomScript) => Promise<boolean>
```

- Wraps `useConfirmDialogStore().confirmDialog(...)` with the copy `Remove "<name>"? It will no longer appear in Quick commands.`, `{ danger: true }`. Then awaits `scripts.remove(script.id)`.
- Returns whether it removed. Rejections propagate: the dialog catches them (rule 5); the panel keeps today's behaviour.
- One copy of the confirm string instead of two.

### 2.6 Settings removal (Studio)

- Delete `workbench/settings/ScriptsPane.vue`.
- `SettingsDialog.vue`: drop the import (15) and mount (89-95). Change "eight panes" to "seven panes" (18). The "six of Settings' sections" line counts schema sections, not panes: untouched.
- `state/settings.ts`: drop `'Scripts'`. Rewrite header 6-11. `sections` now exists so `openSettingsAt` can deep-link (Api panes). 'Database MCP' and 'Claude Code' bypass draft/Save. The scripts history goes.
- `workbench/settings/types.ts:4-5`: "eight" becomes "seven".
- `openSettingsAt` stays. Its doc comment (`createSettingsStore.ts:71`) is re-pointed at the Api panes' deep link.
- `SettingsShell.vue:63`: drop the "Scripts" example; the MCP query example stands. `:131-132`: example becomes an Api pane's deep link.
- `SettingsShell.vue:21` and `createSettingsStore.ts:95` "eight (Kira Studio)" count `Settings` *schema* sections. Scripts were never a schema section, so both are untouched.

### 2.7 Other stale-copy prunes (comment-only)

- `customscript.go:10`: "shown in the tab strip's "+" dropdown" becomes "listed in the Terminal module's Quick commands".
- `bridge/customscripts.go:13`: "dropdown" becomes "Quick commands list". `:72`: "Settings' own confirm-first UI" becomes "the Terminal module's confirm-first UI".
- `state/customScripts.ts:6-8`: readers are now `workbench/terminalModule.ts`. `:18`: "dropdown" becomes "Quick commands list".
- `SwatchRadio.vue:3` and `tailwind-core.css:130`: `ScriptsPane` becomes `QuickCommandsDialog`. The count is unchanged: two swatch groups, row and add.
- `ConnectedEditorsPane.vue:15` (Space): drop `'Scripts'/`, keeping `'Database MCP'`.
- `docs/ARCHITECTURE.md` terminal-module paragraph (1247-1260):
  - the seam is `{records, create, update, remove}`;
  - scripts are configured only in the module's `QuickCommandsDialog.vue`, and Settings has no Scripts section;
  - correct `TerminalStart.vue` to `TerminalPanel.vue` as the quick-commands panel;
  - the file list gains the dialog.

## 3. Out of scope

- Kira Space script storage (row: "not asked").
- Reordering scripts; `sort_order` has no UI today.
- `'script'` launch kind and `tabKinds.ts`: unchanged.
- Go storage and bridge: comment-only.

## 4. Steps and commits

Implement all, then test once (CLAUDE.md). Fast checks per commit: `bun run typecheck`, `bun run lint`, plus `go build ./apps/kira-studio/...` for step 5.

1. `feat(terminal): quick commands dialog in the shared terminal module`
   - Files: `module.ts` (seam), `scriptActions.ts`, `QuickCommandsDialog.vue`, `TerminalPanel.vue`, Studio `workbench/terminalModule.ts`.
   - One commit: removing `openEditor` breaks Studio's context until both land.
2. `refactor(settings)!: remove Settings' Scripts pane`
   - Files: delete `ScriptsPane.vue`; `SettingsDialog.vue`, `state/settings.ts`, `settings/types.ts`, `createSettingsStore.ts:71`, `SettingsShell.vue:63,131-132`.
   - Footer: `BREAKING CHANGE: Settings > Scripts removed; edit quick commands from the Terminal module.`
3. `test(terminal): move scripts UI coverage into terminal-module.spec.ts`: §5.1, and delete `settings-scripts.spec.ts`.
4. `test(visual): drop the Scripts settings baseline; add the quick commands dialog`: §5.2 spec edits, delete `settings-scripts-visual-linux.png`, add the new spec. Baselines are recorded in step 6.
5. `refactor: prune stale scripts-in-Settings comments`: §2.7 code files.
6. `test(visual): re-record settings baselines without the Scripts nav entry`, after §6's untouched-baseline check.
7. `docs: ARCHITECTURE records terminal-module script configuration (P133)`.
8. Result section in `docs/v2.0/SPEC.md` (`docs(v2.0): P133 result`).

### 4.1 File inventory

| File | Change |
|---|---|
| `packages/workbench/src/terminal/module.ts` | seam: `+update`, `-openEditor`, comment |
| `packages/workbench/src/terminal/QuickCommandsDialog.vue` | new |
| `packages/workbench/src/terminal/scriptActions.ts` | new |
| `packages/workbench/src/terminal/TerminalPanel.vue` | dialog mount, gear, Edit…, remove helper, comments |
| `apps/kira-studio/frontend/src/workbench/terminalModule.ts` | `update`, `-openEditor` |
| `apps/kira-studio/frontend/src/workbench/settings/ScriptsPane.vue` | deleted |
| `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` | import, mount, comment |
| `apps/kira-studio/frontend/src/state/settings.ts` | `'Scripts'`, header |
| `apps/kira-studio/frontend/src/workbench/settings/types.ts` | comment |
| `apps/kira-studio/frontend/src/state/customScripts.ts` | comments |
| `packages/workbench/src/state/createSettingsStore.ts` | comment |
| `packages/workbench/src/components/SettingsShell.vue` | comments |
| `apps/kira-studio/internal/storage/model/customscript.go` | comment |
| `apps/kira-studio/internal/bridge/customscripts.go` | comments |
| `packages/theme/src/SwatchRadio.vue`, `packages/theme/src/tailwind-core.css` | comment |
| `apps/kira-space/frontend/src/workbench/settings/ConnectedEditorsPane.vue` | comment |
| `apps/kira-studio/tests/ui/settings-scripts.spec.ts` | deleted |
| `apps/kira-studio/tests/ui/terminal-module.spec.ts` | tests added, header comment |
| `apps/kira-studio/tests/visual/settings.spec.ts` (+ `-snapshots/`) | `'Scripts'` out, png deleted, 7 re-recorded |
| `apps/kira-studio/tests/visual/terminal-module.spec.ts` (+ snapshot) | new |
| `docs/ARCHITECTURE.md` | terminal-module paragraph |

## 5. Tests

These are UI tests only. No unit test: nothing here meets CLAUDE.md's complexity bar.

### 5.1 `tests/ui/terminal-module.spec.ts`

Reuse the file's `SCRIPT` fixture. Its header comment stops citing `settings-scripts.spec.ts`. Add a `dialog(page)` locator on `quick-commands-dialog`.

1. **Manage opens the dialog; add sends trimmed fields.** Moved from settings-scripts tests 1 and 2, merged the way the inline-add test already merges them.
   - Empty list shows "No quick commands yet.".
   - Add is disabled with name only, and with command only.
   - Fill padded name/command plus workingDir, and pick `color-green` in the add fieldset.
   - Assert `customScriptsCreate` args `{fields:{name, command, workingDir, color:'green'}}`.
2. **Non-absolute working directory surfaces the backend error on add.** Moved from test 3. Asserts `custom-script-error` text.
3. **Edit… opens focused; blur commits; colour applies immediately.**
   - Setup: `customScriptsList: [SCRIPT]`.
   - Right-click the row, click `menu-item-edit`. The row's name input `toBeFocused()`.
   - Change the name to padded text and blur. Assert `customScriptsUpdate` `{id, fields:{name trimmed, command, workingDir, color:'green'}}`.
   - Click a swatch. Assert a second update carrying the new colour and the stored name. The mock has no broadcast, so the stored name is still `SCRIPT.name`.
4. **Empty reverts; rejected edit reverts and shows the error.**
   - Clear the command and blur: the input value returns to `SCRIPT.command`, and no update is logged.
   - With `customScriptsUpdate` mocked as the working-directory error: set workingDir to `relative/dir` and blur. The input returns to `SCRIPT.workingDir` and `custom-script-error` shows the message.

### 5.2 Visual

- `tests/visual/settings.spec.ts`: drop `'Scripts'` (line 13) and delete `settings-scripts-visual-linux.png`.
- New `tests/visual/terminal-module.spec.ts`: one baseline, `quick-commands-dialog.png`. Open the terminal module, click `quick-commands-manage`, snapshot `quick-commands-dialog` in the empty state. This is the moved successor of the dropped Scripts-pane baseline. Use the `kira` fixture, as `settings.spec.ts` does.

## 6. Verification (once, near phase end)

- `bun run typecheck`, `bun run lint`, `bun run lint:dead`. `openEditor`'s removal must leave no dead export. `lint:dead` has 7 known pre-existing findings; any new one gets fixed.
- `go build ./...`, `bun run lint:go`.
- `bun run build:studio`, `bun run build:space`.
- `bun run test:unit`: count unchanged.
- `bun run test:ui:studio`: baseline minus `settings-scripts.spec.ts`'s 3, plus §5.1's 4. `bun run test:ui:space`: unchanged.
- `bun run test:visual:studio`:
  1. First, on an untouched checkout of this phase's start commit (throwaway worktree), confirm the sandbox matches the checked-in baselines (P127's precedent).
  2. Then re-record the 7 settings baselines plus the new dialog baseline.
  3. Inspect each diff: only the nav column may change.
- `bun run test:visual:space`: unchanged.
- Live run: not possible without a display. State that plainly in the result.

## 7. Closing audit

| Check | Command | Pass |
|---|---|---|
| No Settings reference to scripts (Studio) | `rg -n -i 'script' apps/kira-studio/frontend/src/workbench/SettingsDialog.vue apps/kira-studio/frontend/src/workbench/settings apps/kira-studio/frontend/src/state/settings.ts` | Empty |
| No Settings reference to scripts (Space) | `rg -n -i 'script' apps/kira-space/frontend/src/workbench/SettingsDialog.vue apps/kira-space/frontend/src/workbench/settings apps/kira-space/frontend/src/state/settings.ts` | Empty |
| Section gone | `rg -n "'Scripts'\|settings-section-Scripts\|ScriptsPane" apps packages` | Empty |
| No Settings detour | `rg -n 'openEditor\|openSettingsAt' packages/workbench/src/terminal apps/*/frontend/src/workbench/terminalModule.ts` | Empty |
| Update seam used | `rg -n 'scripts\.update\|\.update(' packages/workbench/src/terminal/QuickCommandsDialog.vue` | Real calls in blur and colour handlers |
| shadcn Dialog used | `rg -n "ui/dialog" packages/workbench/src/terminal` | `QuickCommandsDialog.vue` |
| Stale tab-strip copy | `rg -n -i "tab strip.*(script\|dropdown)\|dropdown" apps/kira-studio/internal/storage/model/customscript.go apps/kira-studio/internal/bridge/customscripts.go apps/kira-studio/frontend/src/state/customScripts.ts packages/workbench/src/terminal` | Empty |
| SFC form | `rg -L '<script setup lang="ts">' packages/workbench/src/terminal/*.vue`; `rg -n '<style' packages/workbench/src/terminal` | Both empty |
| Space untouched in behaviour | `git diff --stat $P133_START -- apps/kira-space` | `ConnectedEditorsPane.vue` comment only |
| Go comment-only | `git diff $P133_START -- '*.go' \| rg '^[+-][^+-]' \| rg -v '^[+-]\s*//'` | Empty |
| Rules present | Read `QuickCommandsDialog.vue` against §2.3 rules 1-7 | Each present |

## 8. Overlap with parallel work

Running concurrently with P129 Part 4 and P132 is a user-authorized exception to CLAUDE.md's one-phase-at-a-time rule, for this run only.

**P129 Part 4.** Its files are:
- `apps/kira-space/frontend/src/ade/*`, `internal/ade/*`, `internal/bridge/ade.go`;
- Space `frontend/src/bridge/index.ts`;
- `tests/unit/ade-*` and `tests/ui/ade-dialogs.spec.ts`;
- new `packages/theme/src/components/ui/switch/*`.

No P133 file is in that set. P133's only Space file is a comment in `ConnectedEditorsPane.vue`. P133's only `packages/theme` edits are comments in `SwatchRadio.vue` and `tailwind-core.css`; Part 4 adds only a new directory. Since P128, the only commit touching any P133 file is `18fb8709`, which created `tailwind-core.css` (P131 Part 1, landed). Line refs here are against it.

**Real collision: P129 Part 4's closing audit.** Its plan §7 row "Studio unchanged" expects `git diff --stat $P129P4_START -- apps/kira-studio` to be empty. P133 commits land in the shared tree, so that check fails for a reason unrelated to Part 4. The orchestrator should tell Part 4's verifier to read it as: no Part 4 commit touches `apps/kira-studio`. For example, `git log --format='%h %s' $P129P4_START..HEAD -- apps/kira-studio` lists only P133 commits. Part 4's "Switch real usage" check is safe: P133 uses no `Switch`.

**P132.** Its row names these files:
- Studio `workbench/panels/OperationsPanel.vue`, `state/ops.ts`, `state/layout.ts`, `workbench/TitleBar.vue`, `App.vue`;
- `packages/shared/domain/ops.ts`, `packages/shared/domain/shortcuts.ts`;
- `packages/workbench/src/components/WorkbenchShell.vue`, `createLayoutStore`;
- Space `state/layout.ts`, `workbench/TitleBar.vue`, `workbench/WorkbenchShell.vue`;
- `tests/ui/operations.spec.ts`, `tests/unit/ops-*`.

Checked name by name, these are distinct files from P133's:
- `packages/workbench/src/components/SettingsShell.vue` is not `WorkbenchShell.vue`, in the same directory;
- Studio `workbench/SettingsDialog.vue` is not `workbench/TitleBar.vue`.

No overlap. Both phases append to `docs/v2.0/SPEC.md` and edit different paragraphs of `docs/ARCHITECTURE.md`; a trivial rebase covers both. Visual baselines differ: P133 re-records `settings.spec.ts-snapshots/*`; P132's dock move can touch `workbench.spec.ts-snapshots/*` only.

**Shared-tree hazard.** The pre-commit hook lints and typechecks the whole tree. Another stream's half-done edits can fail this phase's commits, and the reverse. CLAUDE.md's stream rule is a worktree per stream, so run the P133 implementer in its own git worktree off the chapter branch, then rebase onto `v1.9`. If that is refused, a hook failure caused by another stream's uncommitted file must not be bypassed with `--no-verify`. Wait for that stream's commit, then retry.

## 9. Risks

| Risk | Mitigation |
|---|---|
| `open-auto-focus` fires before the row renders | The dialog mounts with records already present (synchronous `v-for`). If the target is missing, fall back to default focus; §5.1 test 3 guards it |
| Drafts re-sync on a broadcast clobbers text being typed in another row | Pre-existing ScriptsPane behaviour, kept verbatim (rule 7); not this phase's to change |
| Nested dialogs: remove's `ConfirmDialog` opens over `QuickCommandsDialog` | `ConfirmDialog` renders `v-if` on open, and reka's `DialogPortal` appends each dialog to `body` at open time, so paint order follows open order (`ConfirmDialog.vue:26-32`). Opened second, it stacks on top. Nothing to add |
| Visual re-record hides a real regression | Untouched-baseline check first; each diff inspected to be nav-only |

## 10. Acceptance, mapped to the SPEC row

| Row wording | Where |
|---|---|
| "no Settings reference to scripts in either app" | §2.6, §2.7, §7 rows 1-3 |
| "every script field editable from the terminal module" | §2.2-§2.3; §5.1 tests 1-4 (name, command, workingDir, colour; create and edit) |
| shadcn Dialog from "Edit…" and a "Manage scripts…" replacement | §2.2, §2.4 |
| Field rules: blur-commit, empty-reverts, rejected-edit revert, immediate colour | §2.3 rules 1-4; §5.1 tests 3-4 |
| Seam grows update; Studio storage unchanged | §2.1; Go/store diff comment-only (§7) |
| Kira Space gains no script storage | §0, §7 "Space untouched" |
| Remove pane, mount, section, header comment; prune SettingsShell/createSettingsStore comments; `openSettingsAt` stays | §2.6 |
| `settings-scripts.spec.ts` coverage into `terminal-module.spec.ts`; `'Scripts'` out of `tests/visual/settings.spec.ts` | §5 |
| Kira Studio's suites pass | §6 |
