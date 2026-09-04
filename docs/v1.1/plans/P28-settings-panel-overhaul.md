# P28 — settings panel overhaul: real font dropdown, per-setting resets, connection-dialog tabs, and per-connection command throttling

> **What this phase is.** Five user-directed changes to two dialogs, four of them contained
> UI work and one a new backend capability. The user's own words, verbatim:
>
> 1. *"Fonts should be a dropdown showing the actual options."*
> 2. *"Per-setting reset icons, not a general 'reset all' button."*
> 3. *"Remove the 'changes apply when you save' text."*
> 4. *"An 'Advanced' tab for checkbox-style settings, and a separate tab for the pre-connect script as a multiline textarea."*
> 5. *"Configurable throttling for commands run over a connection."*
>
> **Two dialogs, not one.** Items 1-3 are `workbench/SettingsDialog.vue`. Items 4-5 are
> `project/ConnectionDialog.vue` — established below (§4.1) by reading where the checkboxes and the
> pre-connect field actually live, not assumed from the word "settings".
>
> **Every claim below was re-verified against this phase's base commit** (`6286be2`,
> `fix(scripts): verify-packaging.sh's S7 checks the whole …`, branch
> `claude/feature-v1-1-p5-onwards-2isfzt`). File:line citations point at that commit's content.
>
> **P17 is the phase this builds directly on** (`docs/v1.1/plans/P17-settings-apply-on-save.md`).
> Its draft/Save/diff machinery (`SettingsDialog.vue:27-77`) is *kept unchanged*; items 2 and 3 change
> only what the draft is reset from and what the footer says about it.

---

## 0. Scope and non-scope

**In scope.**

| File | Items |
|---|---|
| `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` | 1, 2, 3 |
| `apps/kira-studio/frontend/src/fonts.ts` | 1 (new export, existing probe reused) |
| `apps/kira-studio/frontend/src/project/ConnectionDialog.vue` | 4, 5 |
| `apps/kira-studio/frontend/src/theme/primitives.css` | 4 (`.p-textarea`) |
| `apps/kira-studio/frontend/src/views/stream/StreamComposeMessage.vue` | 4 (de-duplicate onto `.p-textarea`) |
| `packages/shared/domain/connection.ts` | 5 |
| `apps/kira-studio/frontend/src/state/connections.ts` | 5 |
| `apps/kira-studio/internal/storage/migrations/{0005_p28_throttle.sql,embed.go}` | 5 |
| `apps/kira-studio/internal/storage/model/connection.go` | 5 |
| `apps/kira-studio/internal/storage/repos/connections.go` | 5 |
| `apps/kira-studio/internal/connections/{input.go,service.go}` | 5 |
| `apps/kira-studio/internal/adapterhost/{throttle.go,host.go,router.go}` | 5 |
| `apps/kira-studio/frontend/bindings/**` | 5 (regenerated, never hand-edited) |
| `go.mod` / `go.sum` | 5 (`golang.org/x/time`) |
| `docs/ARCHITECTURE.md` | 2, 5 |
| `apps/kira-studio/tests/ui/*` | all |

**Out of scope, explicitly.**

- **Changing P17's apply-on-save model.** §3 establishes the hint text is *accurate*, so removing it
  is a copy change, not a behaviour change. The Save button, the draft, `diffSection`, the dirty
  marker and the Cancel/Escape/✕/backdrop discard semantics are untouched.
- **New settings-dialog *sections*.** `Appearance | Data | Cache | Advanced`
  (`SettingsDialog.vue:79`) stays a four-item list. Item 4's "Advanced tab" is the *connection*
  dialog's (§4.1).
- **A global throttle setting.** §5.2 decides per-connection with reasons; the `settings` table and
  `model.Settings` are untouched by this phase.
- **Bundling a font.** §1.2: no font file ships today (the only font asset in the tree is the
  Codicon icon font, `frontend/dist/assets/codicon-*.ttf`) and this phase ships none.
- **Throttling anything that isn't an adapter op** — no throttling of IPC, of the stream session's
  write queue (`adapterhost/session.go`), or of cache-served reads (§5.5).

---

## 1. Item 1 — the data-font control becomes a real dropdown

### 1.1 Current implementation

`SettingsDialog.vue:259-287` renders the *Data font* field as a **free-text `TextField`** with a
`<datalist>` attached:

```html
<TextField type="text" size="md" list="kira-font-families" :invalid="fontFamilyUnavailable"
           :model-value="draft.appearance.fontFamily" @input="onFontFamilyInput" />
<datalist id="kira-font-families">
  <option value="Menlo, monospace" />
  <option value="'SF Mono', Menlo, monospace" />
  <option value="Monaco, monospace" />
  <option value="ui-monospace, Menlo, monospace" />
</datalist>
```

Four problems, each verified rather than assumed:

- A `<datalist>` on a text input is an *autocomplete hint*, not a picker: nothing is shown until the
  user types, and any string at all is still accepted (`onFontFamilyInput`, `:86-88`, writes the raw
  value straight into the draft).
- The four suggestions are **raw CSS font-family stacks**, exactly what the user's brief calls out —
  `'SF Mono', Menlo, monospace` is plumbing, not a name a person picks.
- The list has four entries. A code-heavy client on macOS has a dozen realistic monospace choices
  (§1.2).
- `appearanceSettingsSchema.fontFamily` is `z.string()` with no constraint
  (`packages/shared/domain/settings.ts:20`), and `model.SettingsPatch.Validate` deliberately doesn't
  bound it either (`internal/storage/model/settings.go:111-113`, *"fontFamily and fontSize have no
  bounds in the TS schema either, so they are accepted as-is"*). So the stored value is genuinely
  free-form and any redesign must keep an already-stored, unlisted value working.

Supporting machinery that already exists and is **kept, not replaced**:

- `fonts.ts:47-54` `fontStackAvailable(stack)` — a canvas-measurement probe of the *primary* family
  against a guaranteed-nonexistent name. P31 D9/F11's own comment records that
  `document.fonts.check()` is useless here (it returns true for a nonexistent family), so this is
  the honest test and the phase reuses it verbatim.
- `fonts.ts:33-41` `resolveFontFallback(stack)` — which CSS generic an unavailable stack lands on,
  for the "falls back to ___" message.
- `SettingsDialog.vue:275-280` — the live preview line, `:style="{ fontFamily: draft.appearance.fontFamily }"`.
- `state/settings.ts:19-28` `applyAppearance()` writes `--kira-font-family`, which
  `theme/base.css:57` applies to `body` and `theme/tokens.css:51` defaults to `Menlo, monospace`.

### 1.2 Design decision — a `<select>` of named stacks, grouped by what this machine actually has

**The control becomes `<select class="p-select bordered">`**, matching the *Default page size* field
(`SettingsDialog.vue:379-387`), which is this dialog's own existing precedent for a
fixed-choice control. Not a custom popup, not a `<datalist>`.

**The options carry human names, and each option is rendered in its own font.** The app's select
styling already uses `appearance: base-select` with real, CSS-reachable `<option>` children
(`theme/primitives.css:247-284` — `.p-select option`, `option:hover`, `option:checked`), so a
per-option `:style="{ fontFamily: f.stack }"` genuinely previews each face inside the popup where
the engine supports the Customizable Select API. **Where it doesn't**, every `base-select`/`::picker`
declaration is dropped as invalid (that file's own comment at `:240-246` records this fallback
contract) and the popup renders in the native font — which is why the **always-visible preview line
below the control stays and is load-bearing**, not decoration: it is what guarantees a real preview
on every engine. This is stated as a known, accepted degradation rather than discovered later.

**The list — 15 stacks, macOS-first.** Nothing here is bundled; every entry is either a
system face, a widely installed developer font, or a CSS generic. Kept in a new
`FONT_CHOICES` export in `frontend/src/fonts.ts` (beside the probe that grades them), not in the
component, so a test and the dialog read one list:

| Label | Stack | Why |
|---|---|---|
| System monospace | `ui-monospace, Menlo, monospace` | The CSS generic that resolves to SF Mono on macOS without needing the family registered |
| Menlo | `Menlo, monospace` | macOS system face; **today's default** (`settings.ts:92`, `model/settings.go:39`) |
| SF Mono | `'SF Mono', Menlo, monospace` | Apple's developer face (Terminal/Xcode) |
| Monaco | `Monaco, monospace` | Ships with every macOS |
| Andale Mono | `'Andale Mono', Menlo, monospace` | Ships with macOS |
| PT Mono | `'PT Mono', Menlo, monospace` | Ships with macOS |
| Courier New | `'Courier New', Courier, monospace` | Universal fallback |
| JetBrains Mono | `'JetBrains Mono', Menlo, monospace` | Common developer install |
| Fira Code | `'Fira Code', Menlo, monospace` | Common developer install |
| Source Code Pro | `'Source Code Pro', Menlo, monospace` | Common developer install |
| IBM Plex Mono | `'IBM Plex Mono', Menlo, monospace` | Common developer install |
| Cascadia Code | `'Cascadia Code', Menlo, monospace` | Common developer install |
| Hack | `Hack, Menlo, monospace` | Common developer install |
| Inconsolata | `Inconsolata, Menlo, monospace` | Common developer install |
| Roboto Mono | `'Roboto Mono', Menlo, monospace` | Common developer install |

Every stack ends in `monospace` (or `Menlo, monospace`) deliberately: `--kira-font-family` also
drives `body` (`base.css:57`), so a stack that resolves to nothing must still land on a monospace
face, not the browser's proportional default.

**Two `<optgroup>`s, computed once on dialog open** by running `fontStackAvailable()` over the 15
primaries: *"On this Mac"* and *"Not installed"*. Unavailable entries stay **selectable, not
disabled** — the canvas probe is a measurement heuristic, and a user who knows better must not be
locked out of their own font. The existing `fontFamilyUnavailable` error line
(`SettingsDialog.vue:281-285`) is unchanged and still fires for whatever is selected.

**An already-stored value outside the list is preserved**, not silently rewritten: if
`draft.appearance.fontFamily` matches no `FONT_CHOICES.stack`, one extra option carrying that raw
stack as both value and label is prepended, in its own *"Current"* optgroup. This is the whole
reason the free-text input can be removed without a data-loss path — stated explicitly because
"replace the text field with a dropdown" otherwise silently discards any custom font a user already
saved.

**`onFontFamilyInput` (`:86-88`) is deleted**, replaced by a `@change` handler that only ever writes
a value present in the rendered option set — which is what turns `fontFamily` from
"whatever was typed" into a real choice, without touching the permissive schema (§1.1's last bullet:
the schema must stay permissive so old rows hydrate).

### 1.3 Steps

- **S1.1** `fonts.ts`: add `export interface FontChoice { label: string; stack: string }` and
  `export const FONT_CHOICES: readonly FontChoice[]` (the 15 above). No behaviour change yet.
- **S1.2** `SettingsDialog.vue`: replace `:259-287` with the `<select>` + optgroups + preview +
  unavailable/helper lines; add `availableStacks` (a `computed` running `fontStackAvailable` over
  `FONT_CHOICES`, memoized for the component's lifetime — the dialog is created on open and
  destroyed on close, `SettingsDialog.vue:28-30`, so no invalidation is needed); delete
  `onFontFamilyInput`; keep `fontFamilyUnavailable`/`fontFamilyFallback`. Add
  `data-testid="settings-font-family"` (the field has none today, which is why no spec references
  it).
- **S1.3** Remove the now-unused `<datalist>` and the `list` prop pass-through if nothing else uses
  it (grep `list="` across `frontend/src` first — `TextField` takes it purely by attribute
  fallthrough, `TextField.vue:9` `inheritAttrs: false`, so nothing else breaks).

---

## 2. Item 2 — per-setting reset icons, replacing the single Revert to Defaults

### 2.1 Current implementation

One footer button, `SettingsDialog.vue:473-476`:

```html
<AppButton kind="dialog" data-testid="settings-revert-defaults" @click="onRevertDefaults">
  Revert to Defaults
</AppButton>
```

whose handler (`:191-198`) is all-or-nothing across all four sections:

```ts
function onRevertDefaults(): void {
  Object.assign(draft.appearance, defaultSettings.appearance);
  Object.assign(draft.data, defaultSettings.data);
  Object.assign(draft.cache, defaultSettings.cache);
  Object.assign(draft.advanced, defaultSettings.advanced);
}
```

Its own P17 comment names the intent (*"Every section, not just the active one (the SPEC row asks
for 'every setting')"*) — which is exactly what the user now reports as wrong: reverting one field
costs every other customization.

### 2.2 Design decision — a disabled-when-at-default `IconButton` per leaf, and the footer button removed

**Nine leaves get a reset**, one per user-editable setting:

| Section | Leaves | Lines today |
|---|---|---|
| Appearance | `fontFamily`, `fontSize`, `rowDensity`, `wordWrap`, `rowColoring` | `:259-287`, `:289-307`, `:309-345`, `:347-359`, `:361-373` |
| Data | `defaultPageSize` | `:377-387` |
| Cache | `l2BudgetMb` | `:391-406` |
| Advanced | `opLogRetentionDays`, `expensiveQueryRows` | `:426-441`, `:444-468` |

Deliberately **not** given one: *Current usage* and *Hit rate* (`:407-414`) are read-only stat
displays bound to `cacheStatsState`, not settings; *Clear caches* (`:415-422`) is an action that
calls `data.clearCaches()` directly and, per P17 D8, is not a setting at all.

**The affordance is `IconButton icon="discard"`, always rendered, `:disabled` when the leaf already
equals its default.** `discard` is already this app's revert glyph
(`views/shared/EditBufferActions.vue:74-80`, `views/grid/DataView.vue:226`, `views/grid/menu.ts:324`),
and `EditBufferActions.vue:77`'s `:disabled="!buffer.isDirty.value"` is the exact precedent for
"present but inert when there's nothing to revert" — chosen over `v-if` so the control doesn't
appear and disappear under the cursor and stays discoverable.

**Two generic helpers, not nine hand-written handlers** — the same discipline P17 D2 applied to
`diffSection` (`:52-62`), and for the same stated reason: a future leaf must be picked up with no
edit here.

```ts
function isAtDefault<S extends keyof Settings, K extends keyof Settings[S]>(s: S, k: K): boolean {
  return draft[s][k] === defaultSettings[s][k];
}
function resetLeaf<S extends keyof Settings, K extends keyof Settings[S]>(s: S, k: K): void {
  draft[s][k] = defaultSettings[s][k];
}
```

Reset stages into the draft only — **Save still commits**, exactly as P17 D4 already specified for
the button being removed. Nothing about the commit path changes.

**One real markup hazard to fix while doing this.** `wordWrap` and `rowColoring` are
`<label class="field checkbox">` wrappers (`:347-359`, `:361-373`). A `<button>` placed *inside* a
`<label>` that labels a checkbox has its click re-dispatched to that checkbox — so a reset icon
there would toggle the very setting it resets. Those two rows are restructured to
`<div class="field checkbox-row"><label class="field checkbox">…</label><IconButton class="p-push" …/></div>`,
with the button outside the label. The seven non-checkbox fields keep their `<label class="field">`
wrapper (a button inside a label for a text input only moves focus, which is harmless).

**The footer button is deleted** — the user asked for per-setting resets *instead of* a general one,
and keeping both would leave the "discards everything" trap in place.

### 2.3 Steps

- **S2.1** Add `isAtDefault`/`resetLeaf`; delete `onRevertDefaults`.
- **S2.2** Add a `.field-head` row (label + reset `IconButton`) to the seven non-checkbox fields;
  restructure the two checkbox fields per §2.2. Test ids: `settings-reset-<section>-<leaf>`, e.g.
  `settings-reset-appearance-fontSize`. Tooltip: `Reset to default`.
- **S2.3** Delete the footer `AppButton` at `:473-476`.
- **S2.4** Rewrite `tests/ui/settings-apply-on-save.spec.ts:96-127` (*"Revert to Defaults stages
  every section; Save is what commits it"*) as *"a per-setting reset stages only that leaf"*: with
  `nonDefault` hydrated, click `settings-reset-appearance-rowDensity`, assert the density button
  flips, assert `settings-word-wrap` is **still unchecked**, assert zero `settingsSet` calls, then
  Save and assert the patch is `{ appearance: { rowDensity: 'comfortable' } }` and nothing else.
  This is the test that proves the whole point of the change.

---

## 3. Item 3 — delete the "changes apply when you save" hint

### 3.1 Current implementation, and what the text actually is

`SettingsDialog.vue:477-483`:

```html
<span v-else class="helper-text" data-testid="settings-footer-status"
  >Stored in <span class="mono">~/.kira-studio/kira.sqlite</span> ·
  {{ isDirty ? 'Unsaved changes' : 'changes apply when you save' }}</span
>
```

It is the *not-dirty* half of a ternary; the dirty half is `Unsaved changes`. Grepped across
`apps/` and `packages/`: this literal appears exactly once, in this file, and no test asserts on it
(`settings-apply-on-save.spec.ts` references `settings-footer-status`' siblings, never this string).

### 3.2 Design decision — pure copy deletion; the text was correct, just redundant

The task brief asks whether removing it implies a behaviour change. **It does not**, and the reason
is worth recording rather than assuming either way:

- P17 landed genuine apply-on-save. `state/settings.ts:50-62`'s own comment: *"P17 moved to
  stage-until-Save, and SettingsDialog.vue's onSave is now the only caller"* — and `patchSettings`
  applies to `settingsState` only after `await control.settingsSet` resolves.
- `SettingsDialog.vue:27-46` builds a `draft` cloned from `settingsState`; every control binds to the
  draft; `pendingPatch` (`:64-75`) diffs it; `onSave` (`:210-224`) is the sole `patchSettings` caller.
- `docs/ARCHITECTURE.md:644-650` records the same.

So the sentence is **accurate, not stale** — which means the honest reading of the request is the one
the brief itself suggests: it is *clutter*. It restates what the Save button next to it already says,
in lowercase mid-sentence, in the one slot that could instead say nothing. Removing it is
independent of whether a Save button exists, and the Save button **stays**.

Result:

```html
<span v-else class="helper-text" data-testid="settings-footer-status"
  >Stored in <span class="mono">~/.kira-studio/kira.sqlite</span><template v-if="isDirty">
  · Unsaved changes</template></span
>
```

`isDirty` is retained (it is the dirty marker, and is genuinely informative); only the not-dirty
branch's prose goes. The `settings-footer-status` test id is retained so the storage-location line
stays assertable.

### 3.3 Steps

- **S3.1** Edit `SettingsDialog.vue:477-483` as above. One commit, no other file.

---

## 4. Item 4 — connection-dialog tabs: General / Advanced / Pre-connect

### 4.1 Current implementation — and why this is the *connection* dialog

Searched both dialogs before deciding:

- **Pre-connect script UI exists in exactly one place**: `ConnectionDialog.vue:599-609`. It is a
  **single-line `<TextField>`**, `data-testid="connection-preconnect"`, bound through the `'' ↔ null`
  computed at `:330-335`. There is no pre-connect UI in `SettingsDialog.vue` at all.
- **Checkbox-style settings in the connection dialog**: `readOnly` (`:582-586`), `autoExplain`
  (`:588-597`, gated on `isSqlKind`), `preconnectSidecar` (`:612-625`, gated on a non-empty
  preconnect). Three checkboxes, interleaved with the connection fields.
- **The connection dialog has no tabs.** Step 2 (`:420-661`) is a single
  `.dialog-body-inner` column: Name/Color, min-version note, Mode segmented control, the
  file/AWS/network field block, the three checkboxes, the pre-connect field, the save error, and the
  credential note — everything at once, scrolling inside `max-height: 80vh` (`:349`).
- **The settings dialog already has an Advanced section** (`SettingsDialog.vue:79`,
  `['Appearance','Data','Cache','Advanced']`), so "add an Advanced tab" cannot be about it.

Conclusion: item 4 is `ConnectionDialog.vue`. This is stated because guessing "settings panel" from
the phase title would have produced the wrong diff.

Backing schema, for what may move where:
`packages/shared/domain/connection.ts:90-120` (`connectionFieldsSchema`) —
`preconnect: z.string().trim().min(1).max(2000).nullable().default(null)` at `:106`,
`preconnectSidecar` at `:113`, `autoExplain` at `:119`, `readOnly` at `:95`. Go mirror:
`internal/storage/model/connection.go:7-24`; validation `internal/connections/input.go:43-48`
(`preconnect must be 1-2000 characters`).

### 4.2 Design decision — three tabs, using the existing `.p-tab` primitive

**Tabs, on step 2 only** (the engine picker, step 1, `:384-419`, is untouched):

| Tab | Contents |
|---|---|
| **General** | Name + Color, min-version note, Mode segmented control, and the whole file/AWS/network/URI field block (`:422-580`) |
| **Advanced** | `Read-only` (`:582-586`), `Auto-explain SELECT queries` (`:588-597`), and **the new throttle field** (§5) |
| **Pre-connect** | The pre-connect command as a **multiline `<textarea>`**, its warning strip, and the `preconnectSidecar` checkbox (`:599-625`) |

**The tab strip reuses `.p-tab` / `.p-tab.is-active`** (`theme/primitives.css:341-360`), the app's
existing tab look, rather than a fourth ad-hoc segmented control — the dialog already spends its
`.segmented` class on the Fields/URI mode switch (`:438-458`, styles `:798-823`), and reusing it for
tabs would make two unrelated controls look identical stacked one above the other.

**Dialog-level content stays outside the panes**, always visible regardless of tab: the save error
(`:627-632`) and the credential/keychain note (`:639-659`). Both describe the connection as a whole,
and hiding a save error behind a tab the user isn't on would be a real bug.

**A failed save switches to the offending tab.** `onSave` (`:267-290`) collects per-field errors from
`connectionInputSchema.safeParse` keyed by `issue.path[0]`. Today every field is on screen so the
error is always visible; with tabs it might not be. So `onSave` gains, right after
`fieldErrors.value = errors`:

```ts
const TAB_FOR_FIELD: Record<string, DetailTab> = {
  name: 'General', host: 'General', port: 'General', database: 'General', uri: 'General',
  preconnect: 'Pre-connect', throttlePerSec: 'Advanced',
};
```

and switches `activeTab` to the first offending field's tab. Called out explicitly because it is the
one behaviour that silently regresses if tabs are added naively.

`activeTab` resets to `'General'` whenever step 2 is (re-)entered, so "Change engine → back" never
lands on a stale tab.

**A minimum pane height** (`.tab-pane { min-height: 240px }`) so switching between the three tabs
doesn't resize the dialog under the cursor — the same concern `DialogFrame.vue:9-12` records for
SettingsDialog's fixed `height`.

### 4.3 Design decision — a plain `<textarea>` for the pre-connect script, and why not CodeMirror

The user said *"multiline textarea"*; this plan takes that literally, and the code supports it:

- **This app already has a multiline-plain-text pattern**: `views/stream/StreamComposeMessage.vue:81-100`,
  two `<textarea class="p-input-styled" rows="…" @keydown="wrapSelectionOnType">`. That's the
  precedent to follow.
- **CodeMirror has no shell grammar here.** `editor/languages.ts:10` declares exactly six ids:
  `'json' | 'xml' | 'sql' | 'mongo' | 'redis' | 'plain'`. A pre-connect command is a shell line, so
  `CodeMirrorHost` would give it a line-number gutter, an undo stack and word wrap — and **zero
  highlighting**. Getting highlighting means adding `@codemirror/legacy-modes` (a new dependency) for
  a field whose realistic content is one to four lines.
- `CodeMirrorHost` is also built to fill its container and emit `update:doc` (`CodeMirrorHost.vue:28-66`);
  wiring it into a 4-row dialog field needs a sizing wrapper and a `'' ↔ null` adapter around the
  existing `preconnectText` computed.
- Per `AGENTS.md`'s library-first rule, the requirement is named rather than waved at: **a `<textarea>`
  is not a hand-rolled editor, it is the platform control**, and the library that *is* already here
  brings nothing this field can use. If shell highlighting is ever wanted, that is a separate
  decision with a separate dependency, not a side effect of adding a tab.

**`.p-input-styled` is promoted to a real primitive.** It is currently a *scoped* class defined only
inside `StreamComposeMessage.vue:154-165` — copying it into `ConnectionDialog.vue` would be the
second copy of a design-system control living outside `primitives.css`. So this phase adds
`.p-textarea` to `theme/primitives.css` (same declarations: full width, `--kira-border`,
`--kira-radius`, `--kira-bg-input`, `--kira-font-family`, `--kira-t-sm`, `--kira-s-2` padding,
`resize: vertical`, `box-sizing: border-box`) and migrates `StreamComposeMessage.vue`'s two textareas
onto it, deleting the scoped copy. Small, safe, and it stops the divergence at one.

The new field:

```html
<textarea v-model="preconnectText" class="p-textarea mono" rows="4" maxlength="2000"
          data-testid="connection-preconnect" @keydown="wrapSelectionOnType" />
```

`maxlength="2000"` mirrors the schema bound (`connection.ts:106`, `input.go:45`) so the field cannot
produce a value that silently blocks Save. `preconnectText` (`:330-335`) already does the `'' ↔ null`
bridging and works unchanged with `v-model` on a textarea. Playwright's `fill()` and `toHaveValue()`
both work on `<textarea>`, so `preconnect.spec.ts`'s existing assertions survive the element swap —
only tab navigation has to be added (§4.4).

### 4.4 The six specs that need a tab click added

Adding tabs hides controls that today are always on screen. Every affected assertion, enumerated:

| Spec | Line | Control | Needs |
|---|---|---|---|
| `tests/ui/mutations.spec.ts` | 350 | `connection-readonly` | click `connection-tab-advanced` first |
| `tests/ui/fake-data.spec.ts` | 287 | `connection-readonly` | same |
| `tests/ui/tooltips.spec.ts` | 174 | `connection-readonly` | same |
| `tests/ui/cell-editor.spec.ts` | 272 | `connection-readonly` | same |
| `tests/ui/console-explain.spec.ts` | 178 | `connection-auto-explain` | same |
| `tests/ui/preconnect.spec.ts` | 145-183 | `connection-preconnect`, `-warning` | click `connection-tab-preconnect` first (six sites) |

`preconnect.spec.ts:144-149` additionally asserts the field is visible in *both* Fields and URI mode
— which still holds, since the Pre-connect tab is mode-independent; only the click to reach it is new.

### 4.5 Steps

- **S4.1** `theme/primitives.css`: add `.p-textarea`. `StreamComposeMessage.vue`: swap
  `p-input-styled` → `p-textarea` on both textareas, delete the scoped rule. No behaviour change.
- **S4.2** `ConnectionDialog.vue`: add `activeTab` + the `.p-tab` strip + three panes, moving the
  existing markup blocks into them unchanged. Keep the save error and credential note outside the
  panes. Add `TAB_FOR_FIELD` + the switch-on-invalid-save in `onSave`.
- **S4.3** `ConnectionDialog.vue`: replace the pre-connect `TextField` (`:601`) with the
  `<textarea class="p-textarea mono">`.
- **S4.4** Update the six specs in §4.4.

---

## 5. Item 5 — configurable per-connection command throttling

### 5.1 Current implementation — there is none; here is the dispatch path it must sit on

Nothing in the tree rate-limits adapter work today (grepped `throttle|ratelimit|rate limit` across
`apps/` and `packages/`: only `enginecache/cache.go:69-79`'s 1 Hz *stats-emit* throttle and
`SlickGridHost.vue:1852`'s scroll coalescing — neither related).

The dispatch path, read end to end:

- **`adapterhost.Host.RunOp`** (`internal/adapterhost/host.go:115-165`) is the **single funnel every
  operation passes through**. It mints/accepts an op id, refuses a duplicate, derives a cancellable
  context, registers the op in `h.running`, emits `op:start`, runs `fn` behind `safeRun`'s
  `recover()`, and emits `op:end` with status/duration/rows/command/error.
- **Every caller**: `router.go` — `Connect` (`:68`), `Test` (`:94`), `Disconnect` (`:112`),
  `Children` (`:133`), `Describe` (`:163`), `Definition` (`:189`); `data.go` — `Read` (`:68`),
  `Count` (`:108`), `Mutate` (`:162`), `ObjectDownload` (`:186`), `Execute` (`:210`).
- **Two dispatcher methods deliberately never call `RunOp`**: `Preview` (`data.go:129-143`, *"never
  an op, never touches the server"* — it renders literal SQL text) and `Invalidate`
  (`data.go:232-238`, pure cache bookkeeping). Both correctly stay unthrottled.
- **A cache hit returns before `RunOp` is ever reached** (`data.go:48-56`, whose own comment says *"A
  cache hit is not a database operation and must not appear in the op log"*). This is load-bearing
  for the design: a user scrolling back over already-fetched pages is never throttled.
- Op kinds are a closed set of eleven (`internal/storage/model/ops.go:35-39`).
- `Session` (`adapterhost/session.go`) already bounds *frames* and *in-flight ops per renderer
  session* (`sessionMaxInFlightOps = 64`, `:45`) — concurrency, not rate. Complementary, untouched.

Per-connection config storage, read end to end:
`migrations/0001_init.sql` + `0004_p18_auto_explain.sql` (the closest precedent — a plain non-`REFERENCES`
column with a non-NULL default, no rebuild-and-swap needed); `migrations/embed.go:36-41` (the ordered
`names` list); `repos/connections.go:12-15` (`connectionSelectColumns`), `:30-90` (`scanConnectionRow`),
`:147-216` (`Insert`/`Update`); `model/connection.go:7-24` (`ConnectionFields`);
`connections/input.go:26-77` (`Validate`); `connections/resolve.go:20-50`;
`packages/shared/domain/connection.ts:90-120`; `state/connections.ts:71-88` (`defaultDraft`).

### 5.2 Design decision (a) — the setting is **per connection**, on the new Advanced tab

Justified, not assumed:

- **A rate limit is a property of the endpoint, not the app.** A local SQLite file
  (`modernc.org/sqlite`, no server at all) and a metered AWS SQS/S3 account cannot share one number.
  A global setting would be either useless or actively harmful for half of a user's connections.
- **This app already established the pattern, with a reason recorded in the schema itself.** Every
  per-endpoint behaviour switch is a **first-class connection column**, never an `options_json` key:
  `preconnect` (`connection.ts:104-106`), `preconnect_sidecar`, `auto_explain`. The migration comment
  (`0004_p18_auto_explain.sql`) states why: *"`options` round-trips through the connection URI and
  the Copy URI menu item, and a behaviour that issues an extra EXPLAIN per run must not be switchable
  on by pasting a URI."* That argument is **stronger** for a throttle, which is a *safety limit* — an
  `options_json` throttle could be **removed** by pasting a URI.
- **Item 4 builds exactly the tab it belongs on.** This is why item 5 is sequenced after item 4 and
  not merged into it.
- The settings dialog's Advanced section stays what it is (app-wide op-log retention, expensive-query
  threshold) — `docs/ARCHITECTURE.md`'s own per-window/app-wide split puts app-wide preferences there
  and per-endpoint behaviour on the connection.

### 5.3 Design decision (b) — the unit is **commands per second**, as a token bucket

- **`throttlePerSec: number`, `0` = unlimited (the default).** Zero behaviour change for every
  existing connection and every new one; the feature is strictly opt-in.
- **Commands per second, not a minimum interval.** Every rate limit a user will be reacting to —
  AWS request rates, ClickHouse quotas, a DBA's "keep it under N/s" — is expressed per second, and it
  maps 1:1 onto `rate.Limit`. A min-interval field would make the user do the division.
- **Fractional values allowed** (`0.5` = one command every two seconds) for genuinely restricted
  endpoints. Range: `0`, or `0.01 … 1000`, exported as `CONNECTION_THROTTLE_RANGE` beside
  `DEFAULT_PORT` in `packages/shared/domain/connection.ts`, mirroring `settings.ts`'s own
  `*_RANGE` convention (`settings.ts:9-17`) so schema, input `min`/`max` and the Go validator read
  one number each.
- **Token bucket, burst = `max(1, min(10, round(perSec)))`.** A strict burst of 1 would delay the
  first click after an idle period, making a correctly-configured app feel broken. A small burst lets
  interactive use through immediately and paces only *sustained* traffic, which is what a server-side
  limit actually cares about.

**Library: `golang.org/x/time/rate`.** Per `AGENTS.md`'s library-first rule, checked first:
`golang.org/x/time` is **not** in the module graph today (`go.mod:110-114` has only
`crypto`, `mod`, `sync`, `sys`, `text`; zero `go.sum` entries), so it is a new **direct** dependency —
`go get golang.org/x/time@latest`. It is BSD-3-Clause, maintained by the Go team, has no dual license,
no community edition and no gated tier, satisfying the open-source-only rule at both package and
feature level. `rate.Limiter` provides exactly the needed primitive — `WaitN(ctx, 1)` blocks for a
token, honours context cancellation, and **returns immediately with an error when the context's
deadline cannot accommodate the wait** rather than sleeping and then failing, which is what makes the
bounded-wait design (§5.4) cheap. Hand-rolling a token bucket here would be hand-rolling exactly the
"retry/backoff-shaped infrastructure" that rule names.

### 5.4 Design decision (c) — throttled commands **queue and wait**, bounded at 30 s

- **Queue, don't reject.** Rejecting would turn ordinary scrolling, tree expansion and console runs
  into a wall of errors the moment a user sets a limit — the feature exists to *pace* the app, not
  to fail it. Every call site already tolerates a slow op (they are all `await`ed IPC round trips
  with no client-side timeout by design — `session.go:142-149` records that cancellation is meant to
  be the only escape hatch).
- **Bounded at 30 s per op** (`throttleMaxWait`). A pathological misconfiguration (`0.1`/s with 50
  queued reads) must not look like a hung app forever. The wait uses a context derived from the op's
  own cancellable context with that deadline; on expiry the op fails with
  `adapters.CodeTimeout` (`E_TIMEOUT`) and a message naming the configured rate.
- **No new error code.** `adapters/errors.go:9-24` is an explicitly closed set whose comment warns
  that *"Nothing is ever added here without a matching renderer change"*. `E_TIMEOUT` is
  semantically exact, and `viewOp.ts:21` (`DISCONNECTED_CODES = {'E_ENGINE_DOWN','E_CONNECT'}`)
  classifies it as an ordinary `'error'` — the message is shown, no spurious "Reconnect & load"
  gate. Verified by reading `classifyLoadError` (`viewOp.ts:29-35`), not assumed.
- **Cancellation unblocks the wait immediately.** `Host.CancelOp` (`host.go:197-212`) cancels the
  op's derived context; `WaitN` returns, and the op fails `E_CANCELLED`. The Operations panel's stop
  button therefore works on a queued op exactly as on a running one.

### 5.5 Design decision (d) — the gate sits inside `RunOp`, before `op:start`, and skips lifecycle kinds

**Where.** Inside `Host.RunOp`, because it is the one funnel (§5.1). One insertion point, zero
per-adapter work, and any op kind added later is covered automatically.

**Which kinds.** Everything **except `connect`, `disconnect`, `test`**:

- A throttle must never be able to lock a user out of connecting to — or disconnecting from — the
  connection whose throttle is misconfigured. That would make a bad setting unrecoverable from
  inside the app.
- `test` runs against a throwaway adapter that was never registered live (`router.go:86-102`) and has
  `ConnectionID == nil`, so it is out on both counts.
- Everything else (`read`, `count`, `mutate`, `execute`, `transfer`, `children`, `describe`,
  `definition`) is real server work issued on the user's behalf, and is throttled.

**Ordering inside `RunOp`.** Register in `h.running` → **wait for the token** → emit `op:start` →
run `fn`:

- Registering first is what makes a *queued* op cancellable.
- Waiting **before** `op:start` keeps `startedAt` and `DurationMs` the adapter's own numbers. If the
  wait were counted, P18's expensive-query surface and the Operations panel's duration column would
  start reporting client-side queue time as server time — a silent corruption of the one record this
  app keeps of how slow a database actually is.
- An op cancelled or timed out **while queued emits neither `op:start` nor `op:end`**. It never
  touched the database, so it is not a database operation, and the op log is defined as a record of
  those. This also avoids relying on `oplog/wire.go:174-185`'s stray-`op:end` fallback (which invents
  a `"test"`-kind record for an end with no matching start) — never producing the stray is cleaner
  than depending on how it is absorbed.
- **The accepted trade-off, stated:** a queued op is briefly invisible in the Operations panel. The
  tab's own loading state still shows the user something is in flight, and honest durations are worth
  more than an extra "queued" row. Recorded here so a future reader sees it was a choice.

**Lifetime of a limiter.** Installed when the connection connects, replaced live when the user edits
the setting, removed when it disconnects — the same lifetime as the live adapter
(`adapters.SetLiveAdapter`/`DeleteLiveAdapter`, `router.go:79`/`:119`).

**Plumbing — one new `connections.Backend` method, and *not* a new field on
`ResolvedConnectionConfig`.** `ResolvedConnectionConfig` is the one shape that carries a password
(`model/resolvedconnection.go:8-9`) and exists for adapters; a UI pacing knob does not belong in it.
Instead `connections.Backend` (`service.go:32-42`) gains a fourth method:

```go
// SetThrottle installs (perSec > 0) or clears (perSec == 0) this connection's command rate limit.
SetThrottle(connectionID string, perSec float64)
```

called from:
- `Service.attemptConnect` (`service.go:533-573`), just before `Backend.Connect`, from the summary
  it already has in hand.
- `Service.Update` (`service.go:267-311`), after `Conns.Update` succeeds and only when
  `s.StateOf(id).Status == "connected"` — **so an edit applies live.** This is deliberate: the whole
  point of the setting is tuning it *while* hitting a rate limit, and "disconnect and reconnect to
  try 5/s instead of 10/s" is exactly the friction the feature removes. The `.helper-text` under the
  field says so.
- `Router.Disconnect` (`router.go:106-123`) clears it alongside `DeleteLiveAdapter` and
  `cache.DropConnection`, covering every disconnect path (including `Remove` and `onPreconnectExit`)
  without a second call site in the service.

**One easily-missed correctness detail.** `destinationUnchanged` (`connections/service.go:404-421`)
is a **deny-list**: it compares every `ConnectionFields` member *except* the cosmetically-safe ones
(`Name`, `Color`, `ReadOnly`, `AutoExplain`). Its own comment records why (*"a field left out of an
allowlist defaults to 'leaked' instead of 'gated'"*). `ThrottlePerSec` is not destination-affecting,
so it **must be added to the exception list** — otherwise "edit the throttle → Test connection"
stops injecting the stored password and the test fails for no visible reason.

### 5.6 The Advanced-tab control

On the connection dialog's new Advanced tab (§4.2), below Auto-explain:

```
Throttle commands       [   0   ] per second
0 disables the limit. Reads served from cache are never throttled, and connecting is never
throttled. Applies immediately to a connected connection.
```

A `TextField type="number"` with `:min="0"` `:max="CONNECTION_THROTTLE_RANGE.max"` `step="0.5"`,
`data-testid="connection-throttle"`, invalid-state wired to a `computed` error exactly as
`SettingsDialog.vue:129-171` does for its four numeric fields. Shown for **every** connection kind —
unlike `autoExplain` (`ConnectionDialog.vue:311`, SQL-only) there is nothing kind-specific about
pacing requests.

### 5.7 Steps

- **S5.1 (schema + model, no behaviour)** `migrations/0005_p28_throttle.sql`:
  `ALTER TABLE connections ADD COLUMN throttle_per_sec REAL NOT NULL DEFAULT 0;` with a comment
  mirroring `0004`'s (why a first-class column, not `options_json`). `migrations/embed.go`: append
  `{5, "p28_throttle", "0005_p28_throttle.sql"}`. `model/connection.go`: add
  `ThrottlePerSec float64 \`json:"throttlePerSec"\`` to `ConnectionFields`.
  `repos/connections.go`: `connectionSelectColumns`, `scanConnectionRow`'s `Scan` list, `Insert`,
  `Update`.
- **S5.2 (validation + shared schema)** `connections/input.go` `Validate()`: reject NaN/Inf and
  anything outside `{0} ∪ [0.01, 1000]`. `packages/shared/domain/connection.ts`: add
  `CONNECTION_THROTTLE_RANGE` and `throttlePerSec: z.number().min(0).max(1000).default(0)` to
  `connectionFieldsSchema` (`.default(0)` load-bearing for the same reason `preconnect`'s and
  `autoExplain`'s are — an older row has no such key). `state/connections.ts:71-88` `defaultDraft()`:
  `throttlePerSec: 0`.
- **S5.3 (bindings)** `wails3 task common:generate:bindings` (via `scripts/setup.sh`) — required
  because `bindings/.../internal/storage/model/models.ts` and `.../internal/connections/models.ts`
  both carry `ConnectionFields`. Never hand-edited; `-names` is load-bearing (`AGENTS.md`).
- **S5.4 (dependency)** `go get golang.org/x/time` — moves it from absent to a direct require.
- **S5.5 (the limiter)** New `internal/adapterhost/throttle.go`: a `throttleRegistry`
  (`sync.RWMutex` + `map[string]*rate.Limiter`) with `set(id, perSec)` (deleting on `0`) and
  `limiterFor(id)`. A **dedicated mutex**, not `Host.mu`, so the hot `running` map never contends
  with config writes. Plus `throttledKinds` (the eight non-lifecycle kinds) and `throttleMaxWait`.
- **S5.6 (the gate)** `host.go`: `Host` gains a `throttles` field and `SetThrottle`; `RunOp` gains
  the wait between registration and `op:start`, returning `E_CANCELLED`/`E_TIMEOUT` without emitting
  either event. This is the only edit to `RunOp`'s body.
- **S5.7 (wiring)** `router.go`: `func (r *Router) SetThrottle(id string, perSec float64)` delegating
  to `r.host`, plus the clear in `Disconnect`. `connections/service.go`: the new `Backend` method,
  the `attemptConnect` and `Update` call sites, and `ThrottlePerSec` added to
  `destinationUnchanged`'s exception list (§5.5).
- **S5.8 (UI)** `ConnectionDialog.vue`: the Advanced-tab field per §5.6, plus `throttlePerSec` in
  `TAB_FOR_FIELD`.

---

## 6. Implementation order

Independent and low-risk first; the backend-touching feature last, exactly as the brief asks.

| # | Commit | Touches | Risk |
|---|---|---|---|
| M1 | `feat(settings): pick the data font from a real dropdown` (§1) | `fonts.ts`, `SettingsDialog.vue` | low, frontend only |
| M2 | `feat(settings): per-setting reset, replacing Revert to Defaults` (§2) | `SettingsDialog.vue`, one spec | low |
| M3 | `docs(settings): drop the redundant apply-on-save hint` (§3) | `SettingsDialog.vue` | trivial |
| M4 | `refactor(theme): promote the textarea style to .p-textarea` (§4.3) | `primitives.css`, `StreamComposeMessage.vue` | trivial, no behaviour |
| M5 | `feat(connections): tab the connection dialog; pre-connect gets a textarea` (§4) | `ConnectionDialog.vue`, six specs | medium — six specs move |
| M6 | `feat(connections): store a per-connection command throttle` (§5, S5.1-S5.4) | migration, model, repo, input, shared zod, state, bindings, go.mod | medium — schema + bindings |
| M7 | `feat(adapterhost): pace commands through a per-connection token bucket` (§5, S5.5-S5.7) | `throttle.go`, `host.go`, `router.go`, `connections/service.go` | **highest** — the one edit on the op hot path |
| M8 | `feat(connections): throttle field on the Advanced tab` (§5.8) | `ConnectionDialog.vue` | low |
| M9 | `test(p28): …` + `docs(architecture): …` (§7) | new/updated specs, `docs/ARCHITECTURE.md` | low |

M1-M4 are mutually independent and could be reordered freely. M5 must precede M8 (the tab must exist
before the field goes on it). M6 must precede M7 (the limiter needs a value to read) and M8.

Per `AGENTS.md`, fast checks (`bun run lint`, `bun run typecheck`, `bun run build`,
`go build ./apps/kira-studio/internal/...`) run per commit; the expensive suites run once at the end
(§7).

---

## 7. Verification plan

**Go, once M7 lands.**

- `go test ./apps/kira-studio/internal/adapterhost/...` — new `throttle_test.go`. This test **earns
  its keep** under `AGENTS.md`'s own bar, which names *"concurrency (ordering, backpressure,
  cancellation, races)"* as one of the few categories that does; it is not a CRUD round-trip. Five
  cases:
  1. burst-then-pace — rate 50/s, burst 1, five sequential ops: total elapsed ≥ ~80 ms and all five
     succeed. High rate deliberately, so the test costs milliseconds and cannot flake on a slow
     machine the way a 1/s test would.
  2. unset (`0`) — no measurable delay, and no registry entry.
  3. `connect`/`disconnect`/`test` bypass the gate even under a `0.1`/s limiter.
  4. cancelled while queued — `E_CANCELLED`, and **zero events** observed on a `Subscribe()` channel
     (this is the assertion that proves §5.5's no-half-row property).
  5. `SetThrottle(id, 0)` removes the limiter (the `Disconnect` path).
- `go test ./apps/kira-studio/internal/connections/...` — extend the existing fake `Backend` with
  `SetThrottle`; assert `Update` on a connected connection pushes the new rate, and that
  `destinationUnchanged` still holds across a throttle-only edit (so `Test` keeps injecting the
  stored secret — §5.5's easily-missed detail, guarded).
- `go test ./apps/kira-studio/internal/storage/...` — the migration applies on a fresh DB and the
  round trip carries `throttle_per_sec`.

**Frontend, per commit.** `bun run lint`, `bun run typecheck`, `bun run build`.

**`tests/ui/`, once at the end** (`AGENTS.md`'s implement-then-test cadence):

- Updated: `settings-apply-on-save.spec.ts` (§2.3), and the six specs in §4.4.
- New `tests/ui/connection-dialog-tabs.spec.ts`:
  1. all three tabs switch, and General is the tab a freshly-opened details step lands on;
  2. the pre-connect textarea round-trips a **multi-line** value through save → reopen (the thing the
     old single-line field could not do);
  3. the throttle field's out-of-range value blocks Save and shows its error;
  4. a valid throttle reaches `connectionsCreate`'s args as `throttlePerSec`;
  5. a save that fails validation on a Pre-connect-tab field **switches to that tab** (§4.2).
- Then a full `--project=ui` run to catch anything unanticipated.

**Docs, in M9.**

- `docs/ARCHITECTURE.md:449-453` — add `throttle_per_sec` to the `connections(...)` schema block.
- `docs/ARCHITECTURE.md:644-650` — the settings paragraph still says *"plus a **Revert to Defaults**
  action that writes `model.DefaultSettings()`"*. Rewrite for the per-leaf reset (the
  `model.DefaultSettings()`-is-the-shared-source point still holds and is worth keeping).
- Add a short paragraph on the per-connection throttle beside the existing auto-explain one.
- No `NOTICES.md` entry: that file covers bundled *icon assets* only, and `golang.org/x/time` is a Go
  module, not a shipped asset.
- No `AGENTS.md` change: nothing here is a standing process rule.

---

## 8. What this phase deliberately does not do

- **Does not change P17's apply-on-save behaviour** (§3.2): the draft, `diffSection`, Save, and the
  four discard paths are untouched; only the footer's prose and the reset affordance change.
- **Does not keep a "reset everything" button** anywhere — the user asked for per-setting resets
  *instead of*, and keeping both preserves the exact trap being reported (§2.2).
- **Does not constrain `appearance.fontFamily` in the schema** (§1.2): the dropdown constrains what
  can be *chosen*, while an already-stored custom stack still hydrates, still renders, and is still
  offered back as the selected option.
- **Does not bundle a font** — no font file ships today except the Codicon icon face, and none is
  added.
- **Does not move the pre-connect field to CodeMirror** (§4.3), with the requirement named: no shell
  grammar exists in `editor/languages.ts`, so the library brings a gutter and no highlighting, and
  adding one means a new dependency for a four-line field.
- **Does not add a settings-dialog section, nor a global throttle setting** (§5.2) — a rate limit is
  a property of the endpoint.
- **Does not put the throttle in `options_json`** — it would then be settable, and worse *removable*,
  by pasting a connection URI (§5.2).
- **Does not add a ninth `adapters.ErrorCode`** — `errors.go:9-12`'s closed set is honoured;
  `E_TIMEOUT` and `E_CANCELLED` already mean exactly the right things (§5.4).
- **Does not throttle `connect`/`disconnect`/`test`**, so a misconfigured throttle can always be
  reached and fixed (§5.5).
- **Does not throttle cache hits** — they return before `RunOp` (`data.go:48-56`) and are not
  database operations (§5.5).
- **Does not touch `adapterhost/session.go`'s queue or `sessionMaxInFlightOps`** — those bound
  concurrency and frame bytes, a different axis from rate, and both keep working unchanged.
- **Does not hand-roll a token bucket** — `golang.org/x/time/rate` is adopted per the library-first
  rule, with its license checked at package and feature level (§5.3).

---

## 9. Sources

**Reproduced here** (shared checkout `/home/user/kira-studio`, branch
`claude/feature-v1-1-p5-onwards-2isfzt`, base commit `6286be2`, 2026-09-04): every file:line citation
above was read against that commit before being cited.

**In-repo, read in full**: `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue`,
`project/ConnectionDialog.vue`, `project/ColorPicker.vue`, `state/settings.ts`, `state/connections.ts`,
`fonts.ts`, `theme/primitives.css`, `theme/tokens.css`, `theme/base.css`,
`theme/primitives/{TextField,IconButton,DialogFrame,SegmentedControl}.vue`,
`views/stream/StreamComposeMessage.vue`, `views/shared/{viewOp.ts,EditBufferActions.vue}`,
`editor/{CodeMirrorHost.vue,languages.ts}`; `packages/shared/domain/{settings.ts,connection.ts}`;
`apps/kira-studio/internal/adapterhost/{host.go,router.go,data.go,session.go}`,
`internal/connections/{service.go,input.go,resolve.go}`, `internal/adapters/errors.go`,
`internal/oplog/wire.go`, `internal/storage/{migrate.go,migrations/embed.go,migrations/0004_p18_auto_explain.sql}`,
`internal/storage/model/{settings.go,connection.go,resolvedconnection.go,ops.go}`,
`internal/storage/repos/connections.go`, `internal/bridge/{settings.go,connections.go}`; `go.mod`;
`apps/kira-studio/tests/ui/{settings-apply-on-save,preconnect,mutations,fake-data,tooltips,console-explain,cell-editor}.spec.ts`;
`apps/kira-studio/frontend/bindings/.../{connections,storage/model}/models.ts`.

**Prior plans consulted**: `docs/v1.1/plans/P17-settings-apply-on-save.md` (the draft/Save
architecture items 2-3 build on), `P27-active-filter-indicator-color.md` (format and citation
discipline), `P24`/`P29` (section structure). `docs/v1.1/SPEC.md` has no P28 row — its phasing table
ends at P22, and P23-P30 are user-directed phases carried by their plan docs alone; this doc quotes
the user's own words in place of a SPEC row. `AGENTS.md`'s library-first, open-source-only,
measure-with-purpose, unit-test-bar and implement-then-test-at-the-end rules drive §5.3, §7 and §6.
