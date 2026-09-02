# P17 — Settings panel apply-on-save, with revert-to-defaults

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P17 row): *"Rework the settings panel
> so changes are staged locally and only take effect when the user clicks Save, rather than applying
> live as each control changes — today's behavior, reported as confusing — and add a 'Revert to
> Defaults' button that resets every setting back to its default value."* Why: *"A reported UX defect
> in a surface that's existed since early in the app's life and has never had a dedicated pass."*
>
> **The headline, in one line: every control in the Settings dialog calls `patchSettings()` from its
> own `@change` handler, and `patchSettings()` writes to the app-wide store, the SQLite `settings`
> table and an app-wide `Emit` broadcast in one go — so there is no draft anywhere to stage into, and
> the whole phase is one component.** `SettingsDialog.vue` is the **only** caller of `patchSettings`
> in the entire tree (`grep -rn "patchSettings" apps/kira-studio/frontend/src` — nine call sites, all
> in that one file, plus the definition in `state/settings.ts:50`). Nothing else in the app writes a
> setting. So "stage locally, commit on Save" is a rewrite of one `<script setup>` block, not a
> cross-cutting refactor.
>
> **Today's dialog is already inconsistent about discarding, in a way this phase deletes rather than
> preserves.** *Cancel* (`SettingsDialog.vue:33-36`) issues a **second full IPC write** patching every
> section back to its open-time snapshot — and therefore a second app-wide broadcast — while Escape,
> the ✕ button and the backdrop (`DialogFrame.vue:38-42`, `:66`, `:82-90`, reaching
> `SettingsDialog.vue:128`'s `@close="emit('close')"`) keep the changes. Three ways out of one dialog,
> two different meanings. After this phase all four discard, and only *Save* writes.
>
> **There are exactly seven settings leaves, in four sections, and P9's `appearance.rowColoring` is
> the newest** (`packages/shared/domain/settings.ts:6-18`, `:28-41`): `appearance.{fontFamily,
> fontSize, rowDensity, wordWrap, rowColoring}`, `data.defaultPageSize`, `cache.l2BudgetMb`,
> `advanced.opLogRetentionDays`. That is eight leaves; seven of them are user-editable controls and
> all eight are covered by `defaultSettings` / `model.DefaultSettings()`, which is what
> *Revert to Defaults* reads. **The staging design is written generically over the section objects,
> so P18's own settings (P18's SPEC row wants a configurable "expensive query" threshold) and every
> leaf after it need no edit here at all.**
>
> **Multi-window is already safe by construction and this phase keeps it that way.** The broadcast
> that reaches other windows is emitted by `SettingsService.Set` and nowhere else
> (`internal/bridge/settings.go:38`). A draft that never calls `Set` cannot reach window B — and that
> is directly provable in `tests/ui/` by asserting `control.log()` holds zero `settingsSet` entries
> while the draft is dirty, the exact pattern P14's `credential-reveal.spec.ts:83` already uses.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `0989e04` (`docs(agents): record P16's staged CI workflow in Known open items`),
branch `claude/feature-v1-1-p5-onwards-2isfzt`. P1-P16 have landed.

**P9 landed its toggle three commits' worth of work ago, deliberately on today's apply-immediately
pattern** (`eb1f5f4`, `5173281`, `69377dd`; `docs/v1.1/plans/P9-row-coloring-settings.md` §0.3 and
D7: *"P9 lands its toggle using today's apply-immediately pattern … a fourth Appearance checkbox
written in the established shape is one more control to stage, not a new mechanism to unwind"*).
That prediction holds exactly: `rowColoring` needs no special handling here, only inclusion in the
draft like every other leaf — see F2 and D2 for why the generic draft makes that automatic rather
than a checklist item.

**P14 (credential reveal) did not touch settings at all.** It is confined to `ConnectionDialog.vue`,
`state/connections.ts`, `internal/secrets` and `internal/bridge/connections.go`; `grep -n -i settings
apps/kira-studio/tests/ui/credential-reveal.spec.ts` returns nothing. What P17 *borrows* from P14 is
its test technique, not its code (§6.1).

**P8 (multi-window) is the phase whose invariant P17 must not break**, and F6 shows it does not.

### 0.2 Scope

1. `SettingsDialog.vue` binds every control to a **local draft**, never to `settingsState`. Nothing
   the user changes touches the app, the database or any other window until *Save*.
2. A **Save** button that commits the draft through the existing `patchSettings()` →
   `SettingsService.Set` path, as **one** per-leaf patch containing only what actually changed.
3. **Cancel / Escape / ✕ / backdrop** all discard the draft silently and close — one meaning for
   every way out (D5).
4. A **Revert to Defaults** button that stages `defaultSettings` into the draft for *every* section;
   *Save* still commits it (D4).
5. Numeric fields that are out of range now **block Save with a visible error** instead of silently
   dropping the keystroke, which is what today's handlers do (F4, D6).
6. One new `tests/ui/` spec, and the one existing settings-driving spec (`row-coloring.spec.ts`)
   updated for the new button semantics.

### 0.3 Not in this phase

- **A new setting, a new section, or a change to any leaf's meaning, default or storage.** The Zod
  schema, `model.Settings`, `SettingsRepo` and the `settings` table are untouched (F3). No migration,
  no `schema_version` bump, no bindings regeneration.
- **A confirmation prompt on closing with unsaved changes.** D5 decides against it, with the app's
  own precedent as the reason — not as an omission.
- **A live preview of row colouring inside the dialog** (P9's OQ-2, answered in D9).
- **Per-window settings.** Settings stay app-wide, exactly where `docs/ARCHITECTURE.md:809` puts
  them.
- **Anything about *Clear caches***. It is an action, not a setting (`SettingsDialog.vue:116-118`
  calls `data.clearCaches()` directly); it stays immediate, and D8 says why.
- **Backend work of any kind.** `internal/bridge/settings.go`, `internal/storage/repos/settings.go`
  and `internal/storage/model/settings.go` are read here and changed nowhere.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every claim below is **[verified in source]** against this
  tree at the cited `file:line`, or **[verified here]** where it was executed in this sandbox.
- **No new dependency and no new store.** The draft lives in the component's own `setup` scope,
  because the component is already destroyed and recreated on every open (`StatusBar.vue:142`'s
  `v-if="settingsOpen"`), which is precisely the lifetime a draft wants (D1).
- **No unit test.** Per `AGENTS.md`'s bar: a per-leaf object diff and a clone are plumbing, not
  "genuinely hard to get right" logic. D10 states what guards them instead, and D2 explains the one
  design choice that removes the bug class a diff test would have been guarding against.
- **This phase is a net deletion in the component.** `fontFamilyDraft`, `onFontFamilyChange`,
  `onWordWrapChange`, `onRowColoringChange`, `setRowDensity` and the revert-on-cancel round-trip all
  collapse into plain draft writes. If the rewritten `<script setup>` is longer than today's,
  something has been over-built.

---

## 1. What the code does today

### 1.1 The complete settings model — four sections, eight leaves

**[verified in source]** `packages/shared/domain/settings.ts` is the single source of shape, and
`model/settings.go` mirrors it verbatim by its own stated contract (`:32` — *"DefaultSettings mirrors
packages/shared/domain/settings.ts's defaultSettings verbatim"*):

| Leaf | Type / bounds | Default | Schema | Go model | Repo leaf | Control in the dialog |
|---|---|---|---|---|---|---|
| `appearance.fontFamily` | `z.string()` (no bound) | `Menlo, monospace` | `settings.ts:7` | `:6` | `repos:54` | text + datalist, `:153-182` |
| `appearance.fontSize` | `z.number()` (UI: 9-24) | `12` | `settings.ts:8` | `:7` | `repos:55` | number, `:184-197` |
| `appearance.rowDensity` | `'compact' \| 'comfortable'` | `comfortable` | `settings.ts:9` | `:8` | `repos:56` | segmented, `:199-235` |
| `appearance.wordWrap` | `z.boolean().default(true)` | `true` | `settings.ts:14` | `:9` | `repos:57` | checkbox, `:237-249` |
| `appearance.rowColoring` | `z.boolean().default(true)` | `true` | `settings.ts:17` | `:10` | `repos:58` | checkbox, `:251-263` (**P9**) |
| `data.defaultPageSize` | `10 \| 100 \| 1000 \| 10000` | `100` | `settings.ts:29` | `:14` | `repos:59` | select, `:269-277` |
| `cache.l2BudgetMb` | `int, 8..1024` | `64` | `settings.ts:34` | `:18` | `repos:60` | number, `:283-291` |
| `advanced.opLogRetentionDays` | `int, 1..365` | `30` | `settings.ts:39` | `:22` | `repos:61` | number, `:314-322` |

Two things in that table are read-only chrome rather than settings and must not be swept into the
draft: the Cache section's *Current usage* and *Hit rate* fields (`SettingsDialog.vue:293-300`), which
render `cacheStatsState` through disabled `TextField`s, and the *Clear caches* button (`:301-308`).

`model.SettingsPatch.Validate()` (`model/settings.go:108-124`) enforces `rowDensity`,
`defaultPageSize`, `l2BudgetMb` and `opLogRetentionDays`; `fontFamily` and `fontSize` are
deliberately unbounded there (its own comment, `:105-107`) because the TS schema does not bound them
either.

### 1.2 The panel's component tree

**[verified in source]**

```
StatusBar.vue:129-136   button[data-testid="open-settings"]  -> settingsOpen = true
StatusBar.vue:142       <Teleport to="body"> <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false"/>
  SettingsDialog.vue:122-129  <DialogFrame title="Settings" :height="560" test-id="settings-dialog" @close="emit('close')">
    #header                    gear icon + "Settings"
    .dialog-body-inner:135
      nav.section-list:136-148     four buttons, data-testid="settings-section-<Name>" -> activeSection
      section.section-pane:150     v-if/v-else-if on activeSection — one <template> per section,
                                   every control inline; there are no per-section child components
    #footer:329-342              helper text ":330" + Cancel ":332" + Done ":333-340"
```

Two other paths open the same dialog: the menu signal (`App.vue:34-36`,
`bridge/events.go:13`'s `kira:open-settings`, delivered `EmitFocused`) and the command palette
(`shortcuts/state.ts:20`). Both just set `settingsOpen`, so all three entry points get the new
behaviour for free.

**The dialog is a flat component with no children of its own** other than the shared primitives
(`DialogFrame`, `TextField`, `AppButton`, `CodiconIcon`). That is what makes a single draft object in
one `setup` scope sufficient — there is no child that owns part of the form.

### 1.3 "Apply immediately", exactly as it works

**[verified in source]** Every control is `:value`/`:model-value`-bound to `settingsState` and fires
a handler on `@change` (`@input` in one case), and every handler calls `patchSettings`:

| Control | Handler | Line | Fires on |
|---|---|---|---|
| Data font | `onFontFamilyChange` | `:55-59` | `@change` (blur/Enter). `@input` → `onFontFamilyInput` (`:51-53`) only updates the local `fontFamilyDraft` used by the preview |
| Data font size | `onFontSizeChange` | `:61-65` | `@change` |
| Row height | `setRowDensity` | `:67-69` | `@click` on either segment |
| Word wrap | `onWordWrapChange` | `:71-73` | `@change` |
| Row colouring | `onRowColoringChange` | `:75-77` | `@change` (**P9**) |
| Default page size | `onDefaultPageSizeChange` | `:83-88` | `@change` |
| Cache budget | `onCacheBudgetChange` | `:90-94` | `@change` |
| Op log retention | `onOpLogRetentionChange` | `:96-100` | `@change` |

And `patchSettings` (`state/settings.ts:50-62`) does all of this, per call:

1. `Object.assign`s the patch into the app-wide `settingsState` **optimistically**, before any IPC;
2. calls `applyAppearance()` (`:19-28`) — writes `--kira-font-family`, `--kira-font-size`,
   `--kira-row-height` onto `document.documentElement` and bumps `appearanceVersion`;
3. `await control.settingsSet(patch)` → `SettingsService.Set` → `SettingsRepo.Set` writes the
   patched leaves in one transaction (`repos/settings.go:67-127`), re-pushes the cache budget when
   `cache.l2BudgetMb` was in the patch (`bridge/settings.go:35-37`), and **`Emit`s
   `kira:settings:changed` to every window** (`:38`);
4. re-assigns `settingsState` from the returned merged settings and calls `applyAppearance()` again.

So **one checkbox click = one SQLite transaction + one app-wide broadcast**, and the consumers
(`DataGrid.vue:66`/`:111`, `CodeMirrorHost.vue:80`/`:263`, `ProjectTree.vue:54`,
`KeyValueView.vue:138`, `StreamView.vue:127`, `ConsoleResultGrid.vue:68`, `tabs.ts:260`-`:334`)
repaint on the spot. That is the behaviour the SPEC row calls confusing.

### 1.4 What "Cancel" means today

**[verified in source]** `SettingsDialog.vue:18-31` clones the four sections at open into
`initialSettings` (a JSON round-trip, with its own comment on why not `structuredClone` — the source
is a Vue reactive proxy), and `onCancel` (`:33-36`) *patches that clone back*. It is an undo built
out of a second forward write: another full-section `settingsSet`, another transaction, another
app-wide broadcast — unconditionally, even when the user changed nothing.

`DialogFrame`'s three other exits do **not** route through it: `@close` from Escape (`:38-42`), the
backdrop (`:66`, `@click.self`) and the ✕ (`:82-90`) all land on `SettingsDialog.vue:128`'s
`@close="emit('close')"`, which closes and keeps the changes. So does *Done* (`:333-340`).

### 1.5 The house pattern for a staged dialog, and for unsaved-changes-on-close

**[verified in source]** `ConnectionDialog.vue` is the app's one other big form, and it is already
exactly the shape P17 wants:

- The form binds to a **draft** (`connectionsState.dialog.draft`, `ConnectionDialog.vue:67`), never
  to the live connection record.
- **Save** validates and commits once: `onSave` (`:266-289`) `safeParse`s the draft, writes
  `fieldErrors` and returns on failure, otherwise `await saveDialog()` inside a `try/catch` that
  parks the message in `connectionsState.dialog.error`.
- The primary button is disabled while invalid: `:disabled="!isValid"` (`:657`, with `isValid` at
  `:291-293`).
- **Cancel discards silently.** `@click="closeDialog"` (`:624`, `:652`) and `DialogFrame`'s own
  `@close` (`:344`) both reach `state/connections.ts:128-131`, which is two assignments — no
  confirmation, no diff check, no prompt. A half-typed connection with a password in it is discarded
  on Escape without a word.

**[verified in source]** `confirmDialog()` (`state/confirmDialog.ts:23-30`) has eight call sites in
the tree, and **every one of them guards a destructive, irreversible action**: delete an object
(`views/browse/menu.ts:134`), delete a document (`views/documents/menu.ts:88`,
`DocumentView.vue:471`), delete a key (`KeyValueView.vue:355`), delete a stream message
(`StreamView.vue:429`), delete or disconnect a connection (`project/menus.ts:213`, `:232`), and
P14's credential reveal (`ConnectionDialog.vue:229`). Nothing in this app uses it to protect
in-progress form state.

---

## 2. Findings

### F1 — `SettingsDialog.vue` is the only writer of settings in the whole tree
**[verified here]** `grep -rn "patchSettings\|settingsSet(" apps/kira-studio/frontend/src` returns
nine call sites in `SettingsDialog.vue`, the definition and one comment in `state/settings.ts`, and
nothing else. No view, no store, no command and no keyboard shortcut writes a setting. **The blast
radius of this phase is one file plus, optionally, one exported helper in `state/settings.ts`.**

### F2 — Every leaf reads back through one reactive object, so the draft can be built generically
**[verified in source]** `settingsState` is a single `reactive<Settings>` of four plain nested
objects (`state/settings.ts:9`), and `applySettings` (`:32-38`) already treats them as four
uniformly-assignable sections. A draft is therefore `{appearance, data, cache, advanced}` cloned
wholesale — with no per-leaf list anywhere — and so is the diff (D2). **This is what makes P9's brand
new `rowColoring` leaf need zero P17-specific work, and it is what will make P18's future settings
need none either.**

### F3 — Nothing outside the frontend changes, and there is no persistence question to answer
**[verified in source]** The commit path P17 uses is the one that exists: `patchSettings` →
`control.settingsSet` (`bridge/control.ts:103`) → `SettingsService.Set` → `SettingsRepo.Set`, which
already writes **only the leaves actually present in the patch**, in one transaction
(`repos/settings.go:67-127`, its own comment at `:65-66` — *"writes only the leaves the caller
actually patched … a full rewrite would touch eleven unrelated rows"*). A batched Save is exactly the
shape that path was built for: one `Set` call carrying several leaves is cheaper than today's one
call per control, not a new capability. Cache-budget re-push still fires correctly, because
`bridge/settings.go:35` keys off the presence of `Cache.L2BudgetMb` in the patch, not off the call
count.

### F4 — Three numeric handlers silently drop an out-of-range value today, and staging makes that untenable
**[verified in source]** `onFontSizeChange` (`:61-65`) returns on `NaN`; `onCacheBudgetChange`
(`:90-94`) returns unless `8 ≤ v ≤ 1024`; `onOpLogRetentionChange` (`:96-100`) returns unless
`1 ≤ v ≤ 365`. The input keeps displaying the rejected value while the store keeps the old one, and
nothing tells the user. Under apply-immediately that is merely confusing. Under apply-on-save it
becomes a trap: the user types `5000`, presses Save, and either nothing happens or the Go side
rejects the whole patch (`model/settings.go:115-117`). D6 fixes it the way `ConnectionDialog` already
does.

### F5 — A failing `patchSettings` is unhandled today
**[verified in source]** Eight of the nine call sites are `void patchSettings(...)` — a rejected
promise with no `catch`. `SettingsRepo.Set` returns an error on a failed validation or a SQLite
failure, `SettingsService.Set` wraps it as `ipcerr.Internal` (`bridge/settings.go:33`), and
`bridge/control.ts`'s `unwrap` rethrows it. Nothing catches it, so the failure surfaces only as an
unhandled rejection in the console. With one Save button there is exactly one place to handle it, and
`tests/ui/fixtures.ts:69-71`'s `consoleErrors` fixture means a stray unhandled rejection is a test
failure anyway. D7.

### F6 — Multi-window is safe by construction, and provable without a second window
**[verified in source]** The only emitter of `kira:settings:changed` in the tree is
`SettingsService.Set` (`internal/bridge/settings.go:38`, `s.Deps.Events.Emit(ChannelSettingsChanged,
merged)`). `grep -rn "ChannelSettingsChanged" apps/kira-studio/internal` returns that line, the
constant's declaration (`bridge/events.go:31`), and one **dead helper**: `Events.SettingsChanged`
(`events.go:125-129`) wraps the same `Emit` but has zero callers anywhere in the repo, tests included
(`grep -rn "\.SettingsChanged(" apps/kira-studio --include=*.go` → nothing). It does not change the
conclusion and it is **not** this phase's to delete — recorded here so a later reader does not mistake
it for a second broadcast path. Window B's subscription is `state/settings.ts:47`'s
`control.onSettingsChanged(applySettings)`. Therefore: **no `Set` call, no broadcast, no leak** — a
draft that lives in window A's component scope is invisible to window B by construction, not by
policy. `settingsOpen` is a module-level `ref` per renderer (`state/settings.ts:10`) and each window
is its own JS realm, so two windows can hold two independent dirty drafts at once with no shared
state between them at all.

`tests/ui/` cannot hold two live pages — `relaunch()` closes the previous one
(`tests/ui/fixtures.ts:67`) — but it does not need to: asserting **zero `settingsSet` calls** while
the draft is dirty proves the property upstream of the broadcast (§6.1, scenario 1).

### F7 — Exactly one existing test drives the settings dialog, and it is P9's
**[verified here]** `grep -rn 'open-settings\|settings-close\|settings-cancel\|settings-word-wrap\|
settings-row-coloring\|settings-cache-budget\|settings-oplog-retention\|settings-default-page-size'
apps/kira-studio/tests/` matches only `row-coloring.spec.ts:140-143` (plus the channel constant in
`support/ipcChannels.ts:18`). `workbench.spec.ts:3-12` explains that the five scenarios which used to
cover settings persistence were dropped in P57's port and never replaced — an acknowledged coverage
gap this phase's own spec partly closes. **No test anywhere asserts that a settings change applies
immediately**, so the only test to update is P9's scenario 3 (§6.2).

### F8 — `tests/ui`'s mock answers a settings write with the *defaults* unless a spec says otherwise
**[verified in source]** `support/mockRuntime.ts:154` lists `settingsSet` in `WILDCARD_DEFAULTS`
answering `JSON.stringify(defaultSettings)`. Because `patchSettings` re-assigns `settingsState` from
the response (`state/settings.ts:57-61`), a spec that saves a non-default value without supplying its
own snapshot sees the value flip and then flip straight back. This is P9's own F7, unchanged and
still load-bearing — the single-snapshot shortcut (`mockRuntime.ts:345`, `list.length === 1 ?
list[0]`) means one entry answers regardless of the exact patch args, which is what keeps §6.1's
scenarios from having to predict a patch shape byte for byte.

### F9 — `bootSnapshots` lets a spec boot with any settings it likes
**[verified in source]** `support/bootSnapshots.ts:31` answers `settingsGetAll` with
`defaultSettings`, and `mergeBootSnapshots` (`:42-46`) lets a spec replace that channel's snapshot
outright. That is how §6.1's Revert scenario boots with *non*-default settings so that reverting has
something to change (P9's F8, reused).

### F10 — The design system's own footer has a third button in this slot, and it says "Reset section"
**[verified in source]** `docs/design/kira-design-system/parts/bodies/SettingsDialog.html:88-89`:
the helper line *"Stored in ~/.kira-studio/kira.sqlite · changes apply immediately"* (which the
implementation copies verbatim to `SettingsDialog.vue:330`) followed by
`<button class="p-dlgbtn">Reset section</button><button class="p-dlgbtn primary">Done</button>`. So
the mockup always intended a reset affordance in the footer's secondary slot — the implementation
just shipped *Cancel* there instead. P17 restores the slot with the SPEC's own scope (**every**
setting, not the active section — D4) and the helper line stops being true, so it changes too (D3).

---

## 3. Checked, and not fired

- **Another component holding settings form state.** The section panes are inline `<template>`s in
  one file (`SettingsDialog.vue:151-325`); there is no child component that would need a draft of its
  own or a `v-model` contract.
- **A settings write hiding behind a keyboard shortcut or the command palette.**
  `shortcuts/state.ts:20` only opens the dialog; `shortcuts/commands.ts` has no settings command.
- **A backend caller of `SettingsRepo.Set` other than the bridge.** `grep -rn "Settings.Set\|
  Repos.Settings" apps/kira-studio/internal` reaches only `bridge/settings.go`.
- **A settings-shaped assumption in the tab/page stores.** `state/tabs.ts:260`, `:302`, `:318`,
  `:334` read `settingsState.data.defaultPageSize` at **tab-creation** time only — they take a
  snapshot into the new tab's state, they do not watch it. Staging changes nothing for them: a new
  page size still applies to the next tab opened after it is saved, exactly as today.
- **`appearanceVersion` consumers breaking under a batched commit.** `applyAppearance()` bumps it
  once per `patchSettings` call (`state/settings.ts:27`); one Save carrying three appearance leaves
  bumps it once instead of three times, which is strictly better for the memoized measuring context
  that depends on it (`views/shared/page/columns.ts`).
- **A `tests/ipc/` or `tests/e2e-real/` scenario that would notice.** `grep -rn -i settings
  apps/kira-studio/tests/e2e-real` returns one unrelated comment (`sqlite-real.spec.ts:14`, about
  word wrap in the grid); the only `tests/ipc/` match is a ClickHouse fixture containing a table
  called `settings`.
- **A schema or storage change.** None: the wire shape (`SettingsPatch`) already supports a
  multi-section patch, and one is what Save sends.

---

## 4. Decisions

### D1 — The draft is component-local state, cloned at open, destroyed at close
`StatusBar.vue:142` mounts the dialog under `v-if="settingsOpen"`, so the component is created on
open and destroyed on close. That lifetime *is* the draft's lifetime, which means the draft needs no
store, no reset logic and no teardown:

```ts
// Everything the user touches lives here until Save — settingsState (and therefore every other
// window, the database, and the app's own rendering) sees nothing until then.
// JSON round-trip rather than structuredClone(): the source is a Vue reactive proxy, which
// structuredClone's algorithm throws on rather than cloning the plain data underneath.
const cloneSections = (s: Settings): Settings =>
  JSON.parse(JSON.stringify({ appearance: s.appearance, data: s.data, cache: s.cache, advanced: s.advanced }));

const baseline = Object.freeze(cloneSections(settingsState));
const draft = reactive<Settings>(cloneSections(settingsState));
```

`baseline` is the second clone the diff compares against (D2). The existing `initialSettings` clone
(`:24-31`) and its comment are what this replaces — the JSON-vs-`structuredClone` reasoning carries
over verbatim, minus its now-stale Electron reference.

**Rejected: a draft in `state/settings.ts`.** It would make the draft app-wide inside one renderer —
the opposite of what this phase is for — and would need explicit lifecycle management that `v-if`
gives for free.

### D2 — Save sends a per-leaf diff against the open-time baseline, computed generically
**A generic diff, not a per-leaf list.** One function walks the four section keys and, within each,
the section's own keys, collecting only leaves whose value differs from `baseline`; a section appears
in the patch only if it has at least one changed leaf, and the patch is empty when nothing changed.

Two reasons this shape, and not "send the whole draft":

1. **It is what keeps two windows from clobbering each other.** If window B saves `wordWrap` while
   window A's dialog is open, A's Save writes only the leaves A itself changed, so B's change
   survives. Sending the full draft would silently roll B's change back to whatever A's stale copy
   holds. `SettingsRepo.Set` is already per-leaf for the same reason (`repos/settings.go:65-66`).
2. **It makes "Save with nothing changed" a genuine no-op** — no transaction, no broadcast, no
   `appearanceVersion` bump. Today's *Cancel* does the opposite (F/§1.4).

**It also removes the bug class a diff unit test would have guarded.** Writing the diff over
`Object.keys(section)` rather than a hand-maintained leaf list means a future leaf — P18's threshold,
anything after it — is picked up with no edit here, so there is no "forgot to add the new leaf" case
to test for. That is the reasoning behind D10's "no unit test", and it is a design decision, not an
omission.

**Accepted consequence, stated plainly:** the diff is against the *open-time* baseline, so if window
B changes a leaf to a non-default value while A's dialog is open and A then presses *Revert to
Defaults*, A's Save will not rewrite that particular leaf (A's baseline already read the default, so
the draft's default is not a change). Two windows with the settings dialog open simultaneously, one
of them reverting, is the only way to reach it, and the outcome is a stale value rather than a lost
one. The fix if it ever matters — rebase `baseline` (and any untouched draft leaf) from an incoming
`settingsChanged` while the dialog is open — is recorded in §8 rather than built now.

### D3 — The footer is **Revert to Defaults** (left) · **Cancel** · **Save** (primary)
Replacing today's helper-text + Cancel + Done (`:329-342`). Concretely:

- `Revert to Defaults`, `data-testid="settings-revert-defaults"`, in the secondary slot the design
  system already reserves for a reset button (F10).
- `Cancel`, `data-testid="settings-cancel"` — unchanged id, new meaning (D5).
- `Save`, primary, `data-testid="settings-save"`, `:disabled="!isValid"`.
- The helper line's *"changes apply immediately"* is now false and becomes
  *"changes apply when you save"*; when the draft is dirty it reads
  **"Unsaved changes"** instead, which is the phase's one visible dirty indicator (D5).

**The primary button's test id changes** from `settings-close` to `settings-save`, because it no
longer means "close" — it means "commit". `row-coloring.spec.ts:142-143` is the only user and is
updated in the same commit (§6.2). Renaming rather than reusing keeps a stale spec failing loudly
instead of silently asserting the wrong thing.

### D4 — Revert to Defaults stages the defaults into the draft; **Save still commits them**
This is the SPEC row read consistently with its own first half. The row asks for two things in one
sentence — *"only take effect when the user clicks Save"* and *"a Revert to Defaults button that
resets every setting"* — and a Revert that wrote straight through would be the single control in the
panel that still applies live, which is the exact behaviour the phase exists to remove. It would also
be the *most* damaging one to apply live, since it changes every setting at once with no undo.
So:

```ts
function onRevertDefaults(): void {
  Object.assign(draft.appearance, defaultSettings.appearance);
  Object.assign(draft.data, defaultSettings.data);
  Object.assign(draft.cache, defaultSettings.cache);
  Object.assign(draft.advanced, defaultSettings.advanced);
}
```

Consequences that fall out for free and are the point: the controls visibly snap to their defaults,
the footer says *Unsaved changes*, *Cancel* still abandons the whole revert, and *Save* commits it as
one patch containing exactly the leaves that were not already default (D2).

**Scope is every setting, not the active section** — the SPEC says *"every setting back to its
default value"*, which supersedes the mockup's narrower *"Reset section"* (F10). One button, all four
sections, whichever section is on screen.

### D5 — Cancel, Escape, ✕ and the backdrop all discard silently; no confirmation prompt
All four route to the same handler, which emits `close` and nothing else — the draft dies with the
component (D1). No IPC call, in contrast with today's Cancel (§1.4).

**No unsaved-changes confirmation**, for three reasons, in order of weight:

1. **The app's own precedent says so.** `ConnectionDialog` — a longer form, with typed hosts,
   ports and credentials in it — discards its draft on Cancel *and* on Escape with no prompt
   (`state/connections.ts:128-131`, §1.5). A settings dialog prompting where the connection editor
   does not would be the inconsistency, not the safeguard.
2. **`confirmDialog()` means "this is destructive and irreversible" in this app.** All eight of its
   call sites are deletes or a credential reveal (§1.5). Abandoning a staged toggle destroys nothing
   that existed before the dialog was opened; borrowing the delete-confirmation modal for it would
   dilute a signal the app currently uses precisely.
3. **The dirty state is already visible without a prompt.** The footer says *Unsaved changes* and the
   Save button is the primary action sitting next to Cancel. A user who reaches Escape has the
   information in front of them.

Recorded as considered-and-rejected rather than unexamined: a `confirmDialog('Discard unsaved
settings changes?')` gated on `isDirty` is a three-line addition if the user later disagrees, and
`state/confirmDialog.ts` needs no change to support it.

### D6 — An out-of-range numeric field shows an inline error and disables Save
Replacing F4's silent drop. The draft accepts whatever is typed (`@input`, so the field never fights
the user mid-keystroke); validity is derived, not enforced at write time:

- `appearance.fontSize` — 9-24, the bound the input already declares (`:189-190`) and the helper
  text already promises (`:196`).
- `cache.l2BudgetMb` — 8-1024 (`settings.ts:34`, `model/settings.go:101`).
- `advanced.opLogRetentionDays` — 1-365 (`settings.ts:39`, `model/settings.go:102`).
- `NaN` (an emptied or non-numeric field) is invalid, with its own message.

Each offending field renders a message in the existing `.field-error` span the dialog already styles
and uses for the unavailable-font case (`:176-180`, CSS at `:470-474`), and `isValid` gates
`:disabled` on Save exactly as `ConnectionDialog.vue:657` does. `rowDensity`, `defaultPageSize`,
`wordWrap` and `rowColoring` cannot be invalid — a segmented control, a `<select>` over `PAGE_SIZES`
and two checkboxes have no invalid state to reach — so they need no check, matching
`model.SettingsPatch.Validate`'s own reasoning about `bool`s.

**The three bounds move to `packages/shared/domain/settings.ts` as exported constants** consumed by
the Zod schema, the input `min`/`max` attributes and the validity check, replacing today's three
hard-coded copies in the component (`:92`, `:98`) and two in the template. `fontSize`'s 9-24 goes
there too, explicitly marked as a **UI** bound that the schema deliberately does *not* enforce — an
already-stored row outside that range must keep hydrating, the same discipline `settings.ts:10-13`
and `:43-44` already state for `.default(...)`. Go's own mirrored constants
(`model/settings.go:100-103`) stay as they are; the file's existing "mirrors settings.ts" contract
already covers them.

### D7 — A failed Save keeps the dialog open and shows the error
`onSave` awaits `patchSettings` in a `try/catch`, parks the message in a local `saveError` ref
rendered in the footer, and only emits `close` on success — `ConnectionDialog.vue:266-289`'s shape,
cleared at the start of every attempt so a retry never shows a stale failure. This closes F5: there
is no `void patchSettings(...)` left in the file when the phase is done.

### D8 — *Clear caches* stays immediate, and so do the two live cache readouts
`onClearCaches` (`:116-118`) calls `data.clearCaches()` — an action against the running cache, not a
stored preference; there is nothing to stage and nothing for Save to commit. *Current usage* and
*Hit rate* read `cacheStatsState` and are disabled inputs. All three keep reading live state, and
none of them enters the draft.

### D9 — The dialog's previews read the **draft**, and row colouring gets no new preview
The row-density preview strip (`:218-234`) and its `rowPreviewHeight` (`:79-81`) currently read
`settingsState`; under staging they must read `draft.appearance.rowDensity` or they would preview a
value the user did not choose. Same for the font preview: `fontFamilyDraft` (`:47-53`) — P31 D9/D10's
purpose-built local draft, which existed precisely because the commit was immediate — is **deleted**,
and the preview binds to `draft.appearance.fontFamily` directly. P31's stated worry (per-keystroke
commits repainting the whole app's font) evaporates: a draft write repaints nothing.

**P9's OQ-2 is answered: no.** Row colouring gets no preview swatch. Its real feedback is the grid,
which is one *Save* away — exactly as it was one dialog-close away before this phase, since the modal
covered the grid either way (P9 §OQ-2's own observation). Adding a colour to the preview strip would
be a new widget the SPEC row did not ask for, and `AGENTS.md`'s "scope left out is left out entirely"
applies.

### D10 — One new `tests/ui/` spec; no unit test
`AGENTS.md`'s bar excludes a clone, a per-leaf object diff, and a form's dirty flag — none is a
parser, cursor arithmetic, a cache-eviction rule, crypto or concurrency, and D2's generic diff is
short enough to read in one screen. The `tests/ui/` spec in §6.1 exercises the whole mechanism
end-to-end against the real bundle, which is where the behaviour this phase is judged on actually
lives.

---

## 5. Implementation order

Three commits. C1 is the phase; C2 and C3 are its tests.

### C1 — `feat(settings): the settings panel stages changes until Save`

`apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` — the whole change, plus the bounds
constants:

- `packages/shared/domain/settings.ts`: export the three range constants and the UI-only `fontSize`
  range (D6); use them in `cacheSettingsSchema` and `advancedSettingsSchema` so the numbers exist
  once. No leaf, default, or shape change — `defaultSettings` is untouched.
- `SettingsDialog.vue` `<script setup>`:
  - `baseline` + `reactive` `draft` per D1, replacing `initialSettings`.
  - `pendingPatch` (the generic diff, D2) and `isDirty` derived from it.
  - `isValid` + the three field-error messages (D6).
  - `onSave` (commit + close, with `try/catch` and `saveError`, D7), `onRevertDefaults` (D4),
    `onDismiss` (close, nothing else, D5).
  - **Delete**: `onCancel`'s patch-back, `fontFamilyDraft`/`onFontFamilyInput`/`onFontFamilyChange`,
    `onFontSizeChange`, `setRowDensity`, `onWordWrapChange`, `onRowColoringChange`,
    `onDefaultPageSizeChange`, `onCacheBudgetChange`, `onOpLogRetentionChange` — each collapses into
    a direct draft write in the template or a two-line `@input` handler.
  - Keep: `hitRateLabel`, `cacheSizeLabel`, `onClearCaches`, `sections`/`activeSection`,
    `fontStackAvailable`/`resolveFontFallback` (now fed from the draft).
- `SettingsDialog.vue` `<template>`: every `:value`/`:model-value`/`:checked` re-pointed from
  `settingsState.*` to `draft.*`; `@change` → `@input` where a draft write on every keystroke is now
  free; `rowPreviewHeight` and the font preview read the draft (D9); `DialogFrame`'s `@close` →
  `onDismiss`; the new footer (D3) with `settings-revert-defaults`, `settings-cancel` and
  `settings-save`.
- **No** change to `state/settings.ts`, the Zod object shapes, any Go file, or the bindings.

### C2 — `test(ui): settings stage until Save, and revert to defaults`

New file, `apps/kira-studio/tests/ui/settings-apply-on-save.spec.ts` — the five scenarios in §6.1.

### C3 — `test(ui): P9's row-colouring toggle now applies on Save`

`row-coloring.spec.ts`'s third scenario (`:122-147`): click `settings-save` instead of
`settings-close`, and rename the test from *"flipping the toggle live repaints the open grid"* to
*"saving the toggle repaints the open grid"*. Its `settingsSet` snapshot and both assertions stand
unchanged — the flip is still observable after the dialog closes, it is just now caused by Save
rather than by the click. Its comment about F8's wildcard stays true and stays put.

**No `docs/ARCHITECTURE.md` change.** Its settings coverage is the storage-table line
(`:453`) and the app-wide/per-window split (`:809`), and P17 changes neither: settings are still
app-wide, still one row per leaf, still broadcast on commit. When a *commit* happens is a UI
behaviour, and the plan doc plus the commit log are its record (`AGENTS.md`).

---

## 6. Verification

### 6.1 The new `tests/ui/` spec

`tests/ui/` drives the real built bundle (real Vue, real `bridge/control.ts`) in headless WebKit with
both wire planes mocked, and this phase is entirely frontend — so every claim it makes is provable
here, with no Docker, no real backend and no second window. `control.log()`
(`support/mockRuntime.ts:215-217`) is the load-bearing tool, used exactly as
`credential-reveal.spec.ts:83`/`:112` uses it: **assert the call that must not happen, did not.**

A settings change is observable in the page without opening a grid, via the CSS custom properties
`applyAppearance()` writes (`state/settings.ts:19-28`):
`document.documentElement.style.getPropertyValue('--kira-row-height')` reads `28px` at the
`comfortable` default and `22px` for `compact`. That keeps the spec short and independent of any
connection fixture.

1. **Staged changes reach nothing.** Open Settings, click *Compact*, tick *Word wrap* off, tick *Row
   colouring* off. Assert `control.log().filter(e => e.channel === IPC.settingsSet)` is **empty**,
   and `--kira-row-height` is still `28px`. This is the multi-window claim (F6): no `Set`, no
   broadcast, no leak into any other window.
2. **Save commits, once.** Press `settings-save`. Assert the dialog closes, exactly **one**
   `settingsSet` entry exists, its args carry `appearance.rowDensity === 'compact'` **and**
   `wordWrap === false` in a single patch, and `--kira-row-height` is now `22px`. Supply a
   `settingsSet` snapshot returning the flipped `Settings` (F8) — one entry answers regardless of
   args (`mockRuntime.ts:345`).
3. **Cancel and Escape both discard.** Reopen, click *Compact*, press `settings-cancel`; assert zero
   new `settingsSet` entries and `--kira-row-height` unchanged. Reopen, click *Compact*, press
   `Escape`; assert the same. Reopen once more and assert the density control still shows the stored
   value — the draft did not survive.
4. **Revert to Defaults stages, and Save commits it.** `relaunch` with a `settingsGetAll` snapshot
   holding non-default values (F9: `rowDensity: 'compact'`, `wordWrap: false`,
   `l2BudgetMb: 512`, `opLogRetentionDays: 7`). Open Settings, press `settings-revert-defaults`.
   Assert the visible controls now read the defaults (the *Comfortable* segment is `.active`, the
   word-wrap checkbox is checked, the cache-budget input reads `64`) **and** that no `settingsSet`
   has been sent yet. Then press `settings-save` and assert one `settingsSet` whose args carry the
   default for each of those four leaves.
5. **An out-of-range value blocks Save.** Fill `settings-cache-budget` with `5000`. Assert
   `settings-save` is `disabled`, an error is visible in that field, and no `settingsSet` was sent.
   Correct it to `128`; assert Save is enabled again.

Scenario 5 is also the F4 guard: before this phase the same keystrokes silently left the stored value
at 64 with no feedback at all.

### 6.2 What must not regress

- **`row-coloring.spec.ts` (P9)** — scenarios 1 and 2 are boot-state assertions and are untouched;
  scenario 3 is updated by C3 and must pass with the same colour assertions.
- **Every other `tests/ui/` spec passes unchanged.** None opens the Settings dialog (F7), so a
  failure elsewhere means something other than settings moved.
- **The three menu/palette/status-bar entry points still open the dialog** (`App.vue:34-36`,
  `shortcuts/state.ts:20`, `StatusBar.vue:129-136`) — all three set `settingsOpen`, which C1 does not
  touch.
- **`Cancel` issues no IPC at all** — the inverse of today's behaviour (§1.4), covered by scenario 3.
- **A saved change still reaches every consumer**: the grid's row height and colouring
  (`DataGrid.vue:66`, `:111`), CodeMirror's wrap (`CodeMirrorHost.vue:263`), the tree/list row
  heights, and `tabs.ts`'s page-size snapshot at tab creation. Scenario 2 covers the CSS-var path;
  P9's spec covers the grid path.

### 6.3 Running it here

**[verified here]** This container has no Playwright browsers cached, so the implementer runs
`bunx playwright install webkit` plus the libraries its post-install warning names before the first
run — the procedure `apps/kira-studio/playwright.config.ts:12-16` already documents. Then:

```
bun run test:ui                 # builds the bundle first, then --project=ui
bun run lint && bun run typecheck && bun run build
go build ./apps/kira-studio/internal/... && go test ./apps/kira-studio/internal/...
```

The Go commands are a no-change guard, not a target: this phase edits no Go file, so a failure there
means something unrelated broke. No bindings regeneration is needed — the wire types are unchanged
(F3).

---

## 7. Acceptance checklist

1. No control in the Settings dialog is bound to `settingsState`; every one reads and writes `draft`.
2. Changing any control sends **no** IPC and changes nothing outside the dialog — no CSS custom
   property, no grid repaint, no `settings` row, no `kira:settings:changed` broadcast.
3. *Save* sends exactly one `settingsSet` carrying only the leaves that actually changed since the
   dialog opened, then closes. Saving with nothing changed sends nothing and closes.
4. A failed Save keeps the dialog open and shows the error; there is no `void patchSettings(...)`
   left in the file.
5. *Cancel*, Escape, the ✕ and the backdrop all discard the draft, close, and send no IPC.
6. *Revert to Defaults* sets every leaf in all four sections to its `defaultSettings` value **in the
   draft**; the dialog stays open, nothing is applied, and *Save* is what commits it.
7. The footer reads *"changes apply when you save"*, and *"Unsaved changes"* while the draft is
   dirty; *Save* is disabled while any numeric field is out of range, and that field shows why.
8. The row-density and font previews inside the dialog reflect the **draft**, not the stored value.
9. `tests/ui/settings-apply-on-save.spec.ts` covers all five scenarios in §6.1 and passes;
   `row-coloring.spec.ts` passes with C3's update; every other `tests/ui/` spec passes unchanged.
10. `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:ui`, and
    `go build`/`go test ./apps/kira-studio/internal/...` all clean.

---

## 8. Open questions, handed forward

- **OQ-1 — Should an open dialog rebase its baseline when another window saves?** D2's accepted
  consequence: a leaf changed by window B while window A's dialog is open is invisible to A, and A's
  *Revert to Defaults* will not rewrite it. The fix is a watcher on `settingsState` that, for each
  leaf where `draft === baseline` (i.e. the user has not touched it), advances both to the incoming
  value — which would also stop an open dialog from displaying stale values. Not built: it needs two
  settings dialogs open at once to observe, and the failure mode is a stale value rather than a lost
  one.
- **OQ-2 — Should Save be reachable from the keyboard?** ⌘S / Enter-to-save is the obvious next
  ergonomic step now that there is something to save, and `DialogFrame` already owns a keydown
  handler (`:38-55`) that would be the natural home. Left out because the SPEC row asks for a button
  and `DialogFrame` is shared with two other dialogs that would have to agree on the meaning.
- **OQ-3 — For P18.** P18's SPEC row adds a configurable "expensive query" threshold, which is the
  first settings leaf to land *after* this rework. D2's generic diff means it needs no P17-facing
  work: add the leaf to the schema, the Go model, the repo and one control bound to `draft`, and
  staging, dirty-tracking, Save and Revert all cover it automatically. If P18 instead puts that
  threshold on a *connection* rather than in settings (its auto-explain toggle is explicitly
  per-connection), it inherits `ConnectionDialog`'s own draft model, which already works this way.
