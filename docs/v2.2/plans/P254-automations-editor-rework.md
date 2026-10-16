# P254 plan: Automations script editor rework

Ask (user, SPEC row P254): remove duplicate create entries from the Recurring menu (New script /
New smart script exist once); schedule enabled only inside the script editor. Editor dialog:
Collection right after Name; three tabs: Script (name, collection, script or prompt body and the
rest), Parameters, Schedule. Variable autocomplete in the script/prompt body: declared parameters
and interpolated variables suggested while typing. Previews keep the `VarText` resolved-variable
rule.

Base: `v2.0` at `50e97c1b4` (P253 landed). One sequential Sonnet implementer (section 7).
No backend change.

Method: `codegraph_explore` on the main checkout (same commit; worktree has no index), then grep/
Read for files the index summarised with gaps.

## 1. Findings

Create entries. `packages/workbench/src/automations/AutomationsPanel.vue` `newScriptItems()`
returns New script, New smart script, plus submenu `new-recurring` ("New recurring script") with
`new-recurring-script` / `new-recurring-smart-script`. Same list feeds header `+`
(`automations-add`), collection row menu and list-background menu. Recurring items set
`editor.schedule = true`, passed as `ScriptDialog` prop `schedule` (starts with `newSchedule()`).
No separate Recurring section or list exists: scheduled rows sit in the normal list with
`ScriptScheduleLine`. Row menu of a scheduled script adds Run now and Turn schedule on/off
(`scriptActions.ts toggleSchedule`, only caller is the panel).

Dialog. `ScriptDialog.vue` (shared by both apps) is one scrolling column: Name, Command/Prompt
(`Textarea`, `script-dialog-command`), "Uses:" line (smart only, `VarText` chips with value =
name, i.e. not resolved), smart fields (`SmartSettingsFields` model/budget/timeout, `ToolsField`,
`McpToolsField`), `ParamsEditor`, Working directory, ADE worktree switch (Space), Run on a
schedule switch + `ScheduleFields`, Collection + colour row, error. `canSave` checks name,
command, fixed folder, cron non-empty and `ScheduleFields` `valid` emit. Server error is one
string (`FieldError script-dialog-error`).

Interpolation (Go, `internal/scripts/smart.go`, `internal/scriptruns/{preview,ade}.go`):
- Smart prompt: `{name}` (`varRE \{([A-Za-z_][A-Za-z0-9_]*)\}`), substituted by `Compose`.
  Non-secret params only; a secret param named in the prompt is refused (`validParams`).
- Normal script: no text substitution. Params reach env as `KIRA_PARAM_<NAME>` (`EnvName`),
  secrets included.
- Built-ins `task jira repo branch base worktree` (`BuiltinVars`, reserved as param names in both
  apps): only with ADE (Space). Prompt gets `{task}` etc.; env gets `KIRA_<NAME>` (`BuiltinEnv`).
  Studio leaves them literal (`planADE` with nil ADE).
- Param names: `^[a-z][a-z0-9_]{0,31}$`.

Existing variable completion (what to reuse). Studio's `{{var}}` fields use
`apps/kira-studio/frontend/src/views/shared/AutocompleteField.vue`: a real `<input>`/`<textarea>`
(keeps Playwright `.fill()` working), reka-ui `AutocompleteRoot`/`ComboboxContent` popup (library,
not hand-rolled), pluggable `tokenAt` (`templateToken`), function `candidates`, Monaco-painted
`rangeHighlights` overlay (`.kira-ed-var*` classes, `editor/edDecorations.css`), `hoverAt` panel.
Helpers: `theme/completion.ts` (`Completion`, `tokenAt`, `templateToken`, `rankCandidates`,
`MAX_VISIBLE`), `editor/ranges.ts`, `editor/paintSpans.ts`, `editor/monacoLanguages.ts`. All
Studio-only; their deps are already shared (`@workbench/editor/monaco`,
`@workbench/util/floatingPosition`, `@theme/*`, reka-ui, VueUse) except the dead `sqlDialect`
prop type. Monaco bodies use `MonacoHost.vue` (Studio-only, coupled to Studio settings store,
SQL lint, chunked fill) with `EditorCompletionSource`.

`AutocompleteField` `grow` mode blocks newlines ("No newline is ever inserted under grow") and
syncs only horizontal overlay scroll; `autoClosePairsOnType` auto-closes brackets/quotes; popup
opens only when the token word is non-empty.

## 2. Decisions

- D1 Remove submenu `new-recurring` from `newScriptItems()` (all three menus). Remove
  `editor.schedule`, `ScriptDialog` prop `schedule`. No Recurring filtered section: no section
  exists today, scheduled rows already show `ScriptScheduleLine` in the one list, and a second
  list of the same rows is the duplication the user removed.
- D2 Existing recurring scripts: untouched (no migration). They keep schedule, line and Run now.
- D3 Row menu "Turn schedule on/off" replaced by "Edit schedule…" (`menu-item-edit-schedule`),
  which opens the editor on the Schedule tab. Literal reading of "a schedule is enabled only
  inside the script editor": turning one on from a menu is enabling it outside. Pause/resume
  stays one click inside (Schedule tab `schedule-enabled`). Delete `toggleSchedule`.
  Run now stays (runs once, enables nothing).
- D4 Body field = hoisted `AutocompleteField` with a new `multiline` mode, not Monaco.
  Rejected Monaco: no shared Monaco host exists (`MonacoHost` is Studio-coupled), so it means a
  second host; suggest widget reparents to a body-level container outside the modal
  `DialogContent` (reka dismiss/pointer-events risk); breaks `.fill()`/`toHaveValue` on
  `script-dialog-command` at 14 call sites in 8 specs, 5 of them also edited by in-flight P250. `AutocompleteField` is the app's existing
  variable-completion field (user brief: reuse it) and its popup is reka-ui.
- D5 Hoist, no behaviour change, into `packages/workbench/src/`:
  `components/AutocompleteField.vue`, `editor/fieldCompletion.ts` (was `theme/completion.ts`),
  `editor/ranges.ts`, `editor/paintSpans.ts`, `editor/monacoLanguages.ts`,
  `editor/edDecorations.css` (`@import`ed from `workbench.css`, drop Studio `main.ts` import).
  Delete the Studio originals; update every importer (list in section 5). Drop
  `AutocompleteField`'s dead `sqlDialect` prop and its bindings (its own comment: unused by
  Monaco, kept only for call-site compatibility). No re-export shims.
- D6 `multiline` prop (default false, every existing call site unchanged): Enter inserts a
  newline unless a suggestion was arrowed onto (existing `hasNavigated` rule); `rows` prop sets
  min height, textarea `resize-y`, no auto-grow cap; overlay syncs `scrollTop` as well as
  `scrollLeft`; Cmd/Ctrl+Enter is left to bubble (dialog saves). Plus `autoClose` prop (default
  true; body passes false: auto-closing `'` in prose and `"` in shell gets in the way) and
  `openOnEmptyToken` (default false; when the tokenizer returns a non-null empty word, list all
  candidates capped at `MAX_VISIBLE`, so typing `{` or `$` opens the list at once).
- D7 Tokenizers, in `editor/fieldCompletion.ts` beside `templateToken`:
  `braceToken`: nearest `{` before caret on the same line with only `[A-Za-z0-9_]` between it
  and caret; null otherwise. `envToken`: `$` (optionally `${`) followed by `[A-Za-z0-9_]*` up to
  caret; token starts after `$`/`${`.
- D8 Candidates (`packages/workbench/src/automations/scriptVars.ts`, pure):
  smart: each non-secret param (`label` = name, `detail` = param label or default, icon
  `symbol-variable`), then built-ins only when `ade` (detail "from the task"). Insert `name}`
  unless the char after caret is `}`, then `name`. Secret params never offered.
  script: `KIRA_PARAM_<NAME>` per param (secrets included, detail "secret"), then
  `KIRA_<BUILTIN>` when `ade`. Insert closes `}` only after `${`.
- D9 Highlights (`rangeHighlights`): known var `kira-ed-var`; secret param in a prompt and
  unknown `$KIRA_PARAM_X` / `${KIRA_PARAM_X}` `kira-ed-var-unknown` (Go refuses the first, the
  second is a typo); unknown `{word}` in a prompt left unpainted (literal braces are legal text).
  `hoverAt`: param → `Parameter <name>`, label, `Default: <value>`; built-in → "Set from the ADE
  task at run time".
- D10 Uses line (`script-dialog-uses`), both kinds: `VarText` chips, value resolved to what the
  run will get without input: param default (multiselect joined ", ", text as is), "asked at
  run" when no default, built-in "from the task". Smart reads `varsUsed`; script reads a new
  `envVarsUsed(command, params, ade)`. Empty: today's hint text. Run dialog preview unchanged.
- D11 Tabs: shadcn-vue `Tabs` (`@theme/components/ui/tabs`). Script: Name, Collection + colour
  row, body + Uses line, smart model/budget/timeout, Tools, MCP tools, Working directory, ADE
  worktree switch. Parameters: `ParamsEditor`. Schedule: Run on a schedule switch +
  `ScheduleFields`. Server error and footer outside tabs (visible on every tab). Default tab
  Script; new prop `initialTab` (`'script' | 'params' | 'schedule'`) for D3.
- D12 Every `TabsContent` force-mounted, hidden when inactive: `ScheduleFields` must stay mounted
  to keep emitting `valid`, and state/queries survive tab switches.
- D13 Per-tab errors (`packages/workbench/src/automations/scriptErrors.ts`, pure): Script: name
  empty, body empty, fixed folder unset (empty-field errors count only once that field was
  touched or a save attempted), smart budget not > 0. Parameters: name regex, reserved built-in,
  duplicate, select/multiselect with no options, secret param used in prompt (mirrors
  `validParams`/`validChoiceParam`; Go stays the authority). Schedule: cron empty, `scheduleOk`
  false. Each tab trigger shows a shadcn `Badge` with its error count
  (`script-dialog-tab-<id>-errors`). Errors render inline under their field (`FieldError`).
  `canSave` = no client errors (today's disabled-until-valid behaviour kept).
- D14 Testids: tabs `script-dialog-tab-script|params|schedule`; existing field testids kept.

## 3. Owned files

Edit:
- `packages/workbench/src/automations/AutomationsPanel.vue`
- `packages/workbench/src/automations/ScriptDialog.vue`
- `packages/workbench/src/automations/scriptActions.ts` (drop `toggleSchedule`)
- `packages/workbench/src/workbench.css` (import `edDecorations.css`)
- Studio importers of hoisted files (section 5)
- `docs/ARCHITECTURE.md` (Automations panel/ScriptDialog paragraph ~line 1396, Recurring scripts
  paragraph ~1417, `AutocompleteField` mention ~4711)
- `docs/v2.2/SPEC.md` (P254 row status + result pointer)

New:
- `packages/workbench/src/components/AutocompleteField.vue` (moved)
- `packages/workbench/src/editor/{fieldCompletion.ts,ranges.ts,paintSpans.ts,monacoLanguages.ts,edDecorations.css}` (moved)
- `packages/workbench/src/automations/scriptVars.ts`, `scriptErrors.ts`, `ScriptBodyField.vue`
  (body `AutocompleteField` wiring + Uses line, keeps `ScriptDialog` lean)
- `apps/kira-studio/internal/flows/termflow/editor_test.go`, `apps/kira-studio/tests/contract/script-editor.json`
- `apps/kira-space/internal/flows/termflow/editor_test.go`, `apps/kira-space/tests/contract/script-editor.json`
- `apps/kira-studio/tests/ui/automations-editor.spec.ts`, `apps/kira-space/tests/ui/automations-editor.spec.ts`
- `docs/v2.2/plans/P254-result.md`

Delete: `apps/kira-studio/frontend/src/{views/shared/AutocompleteField.vue,theme/completion.ts,editor/ranges.ts,editor/paintSpans.ts,editor/monacoLanguages.ts,editor/edDecorations.css}`.

Tests edited: section 6.

## 4. Steps and commits

1. `refactor(workbench): hoist AutocompleteField and its helpers` — D5. Pure move + import
   rewrite + `sqlDialect` prop removal. Typecheck, lint, build both apps. Run
   `apps/kira-studio/tests/ui/autocomplete.spec.ts` and `api-ui-consistency.spec.ts` once here:
   cheap proof the move changed nothing (they cover overlay paint and `.kira-ed-var` colour).
2. `feat(workbench): multiline AutocompleteField` — D6.
3. `feat(automations): script variable completion` — D7, D8, D9 (`fieldCompletion.ts` tokenizers,
   `scriptVars.ts`).
4. `feat(automations): tabbed script editor` — D10-D14, `ScriptBodyField.vue`, `scriptErrors.ts`,
   Collection after Name.
5. `feat(automations): schedule only from the editor` — D1-D3.
6. `test(automations): editor flow and UI specs` — section 6; contracts written with
   `KIRA_CONTRACT=write`.
7. `test(automations): update specs for tabs and removed recurring menu` — section 6 list,
   visual baseline re-record.
8. `docs: P254 editor rework` — ARCHITECTURE, SPEC row Done, `P254-result.md`.

Fast checks per commit; UI/visual/e2e-real suites once after step 7, fixes as follow-up commits.

## 5. Hoist importers (step 1)

`apps/kira-studio/frontend/src/`: `main.ts`, `api/state/variableCompletion.ts`,
`editor/MonacoHost.vue`, `views/documents/DocumentView.vue`, `views/grid/FilterToolbar.vue`,
`views/grid/filterCompletion.ts`, `views/grpcrequest/{GrpcMetadataTable,GrpcRequestView,ResponsePane}.vue`,
`views/httprequest/{FormDataTable,HttpRequestView,RawExchangePane,RequestBodyPane,ResponseDiffDialog,ResponsePane}.vue`,
`views/shared/fields/FieldRowsTable.vue`, `views/shared/mongoFieldSample.ts`.
Tests: `apps/kira-studio/tests/ui/{api-ui-consistency,autocomplete}.spec.ts`,
`apps/kira-studio/tests/unit/{autocomplete-tokenizers,paint-spans-merge}.spec.ts`.
Comment-only mentions in `packages/theme/src/{primitives,tailwind-core,tokens}.css` and
`packages/workbench/src/editor/monacoTheme.ts`: fix paths.
Re-grep `theme/completion'|editor/ranges'|editor/paintSpans'|editor/monacoLanguages'|AutocompleteField|edDecorations`
after the move; zero hits outside the new locations.

## 6. Tests

IPC split (CLAUDE.md), scenario "save a smart script from the three-tab editor, run preview
resolves its param":
- Backend, both apps: `termflow/editor_test.go` `TestScriptEditorSave`. Create a collection;
  `CustomScripts.Create` a smart script with collection, prompt `Look at {topic}`, param `topic`
  (text, default `auth`) and schedule (`0 9 * * 1-5`, `UTC`, enabled, confirm). Assert stored
  fields round-trip and `ScriptRuns.Preview` prompt parts carry `{var: topic, value: auth}`.
  Record contract `script-editor`: `args:CustomScriptsService.Create`,
  `CustomScriptsService.Create`, `ScriptRuns.Preview` (mask ids/time/hash as existing contracts
  do). New file, not `script_test.go`/`smart_test.go`/`schedule_test.go` (P250 edits those).
- Frontend, both apps: `tests/ui/automations-editor.spec.ts`, mocked bridge answering from the
  same contract. Open New smart script; Name; Collection select directly after Name (assert
  DOM order); Parameters tab add `topic` default `auth`; Script tab type `Look at {to` (keyboard,
  not `.fill`) → `.autocomplete-suggestions` lists `topic`, Tab inserts `topic}`; Uses line chip
  `data-var="topic"` shows `auth`; Schedule tab switch on, cron; Save; captured Create args equal
  contract `args:` entry; run dialog chip `topic` = contract preview value.
- Frontend-only autocomplete cases in the same spec: `{` opens full list; secret param absent
  from `{}` list; normal script `$KIRA_P` suggests `KIRA_PARAM_TOPIC` incl. secret; Space only:
  `{ta` suggests `task`, `$KIRA_T` suggests `KIRA_TASK`; Studio offers no built-ins. Enter
  without arrowing inserts a newline. Error badges: clear Name → Script badge; param `Bad` →
  Parameters badge; empty cron → Schedule badge; Save disabled. Menu: header `+` has exactly New
  script, New smart script; no `menu-item-new-recurring`. Row menu of scheduled script: Edit
  schedule… opens dialog on Schedule tab; no `menu-item-toggle-schedule`.
- Unit: extend `apps/kira-studio/tests/unit/autocomplete-tokenizers.spec.ts` with
  `braceToken`/`envToken` edge cases (closed brace before caret, newline between, `${`,
  non-identifier char). Interacting tokenizer rules: meets the unit-test bar. No other unit test.

Existing tests to update (exact):
- `apps/kira-studio/tests/ui/automations-recurring.spec.ts`: test at ~line 122 "New recurring
  script opens the editor with the schedule on" → New script + Schedule tab switch; ~181 save
  disabled check needs Schedule tab; ~225 `toggle-schedule` → `edit-schedule`.
- `apps/kira-space/tests/ui/automations-recurring.spec.ts`: same three, ~123/182/226.
- `apps/kira-studio/tests/ui/automations-smart.spec.ts`, `apps/kira-space/tests/ui/automations-smart.spec.ts`:
  ~213 `param-add` needs Parameters tab first; ~222 Uses chip now shows default value, not name.
- `apps/kira-studio/tests/ui/automations-module.spec.ts`: collection/command/colour stay on Script
  tab; any param/schedule interaction gets a tab click; check DOM-order assumptions.
- `apps/kira-space/tests/ui/automations-scripts.spec.ts`, `apps/kira-{studio,space}/tests/ui/automations-runs.spec.ts`:
  param/schedule interactions get a tab click.
- `apps/kira-{studio,space}/tests/e2e-real/prompts-two-windows-real.spec.ts`: lines 12-13 use
  `new-recurring` → New script + Schedule tab.
- `apps/kira-studio/tests/visual/automations-module.spec.ts` baseline
  `script-dialog-visual-linux.png`: re-record (tabs, field order).
- Studio hoist importers in section 5 (path only).

P250 overlap (running in `/home/user/kira-sW`, not yet on `v2.0`). P250 modifies these same
files: Studio `tests/ui/automations-{module,recurring,runs}.spec.ts`; Space
`tests/ui/automations-{recurring,runs,scripts,smart}.spec.ts` (its Space recurring spec adds a
new `menu-item-new-recurring` use, ~diff line 2074). Before step 7, rebase onto latest `v2.0`;
if P250 has landed, update its added tests too (every new `new-recurring`/`toggle-schedule`/
param/schedule interaction). If P250 has not landed, tell the orchestrator: whoever lands second
updates the other's lines. P250 flow files (`termflow/{script,schedule,automation,smart}_test.go`,
contracts `script-folders`, `schedule-overlap`, `script-collections`) are not edited here.

P257 (`/home/user/kira-sG`): touches `apps/kira-space/internal/{gitclient,gitsession,ade,bridge/adewire}`,
`apps/kira-space/frontend/src/ade/v2/{panel/AdeChangesTab.vue,wire.ts}`, git flows and
`packages/git-ui`. Zero overlap with section 3 (checked against its working tree).

## 7. Split

One sequential implementer. Step 1 (hoist) and steps 2-5 are order-dependent (2-4 consume the
hoisted field); tests depend on all. No disjoint stream.

## 8. Deferred decisions (defaults applied unless the user says otherwise)

- D1 no Recurring filtered section. Alt: a "Scheduled" filter chip in the panel search.
- D3 "Edit schedule…" replaces "Turn schedule on/off". Alt: keep "Turn schedule off" only
  (pausing enables nothing).
- D4 `AutocompleteField` textarea, not Monaco (no shell syntax colouring in the body).
- D5-popup: list anchored under the field (existing behaviour), not at the caret. Caret
  anchoring needs a caret-measuring library (`textarea-caret`, MIT) and a virtual reference.
- D6 `autoClose` off in the body.
- D9 unknown `{word}` in a prompt stays unpainted.
- D10 Uses line value for a param with no default reads "asked at run".
- D13 empty-field errors wait for touch or save attempt; Save stays disabled while errors exist.
