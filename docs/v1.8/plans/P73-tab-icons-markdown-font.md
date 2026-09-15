# P73 — Tab-strip seti icons and markdown reading-view font

`docs/v1.8/SPEC.md`'s P73 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `ac71b423`, P72 landed); line numbers are from that
tree — `TabStrip.vue` in particular was re-read *after* P72 §7 split the pinned tab out of the
scrolling strip, not from pre-P72 context.

Two items, unrelated, both Kira Studio only. Neither touches `packages/git-ui/`, so the VS Code
extension is unaffected by this phase in either half — `TabStrip.vue` and `RepoFileView.vue` are
both `apps/kira-studio/frontend/`, and the one shared module either item reads
(`packages/git-ui/src/icons/setiFileIcon.ts`) is read, never edited.

**A. Tab-strip icons.** Make a file-backed tab's icon the same seti icon its tree row already shows.

**B. Markdown reading-view font.** Make the reading view's type match the code editor's.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Does `TabStrip.vue` already know a tab's file path, or must one be threaded through? | **It already does, for the two kinds that have one.** `repo-file` and `repo-diff` carry a plain repository-relative `path` on the tab record. Nothing is threaded; the registry hands the strip that path | §1.2, §2.1 |
| Where the wiring goes | `TabKindDef.icon()`'s return type widens from `string` to `string \| { filePath }`. Exactly one kind's entry changes. The strip keeps knowing nothing about which kind is file-backed (P1 D4) | §2.2 |
| Which tab kinds are in scope | **One: `repo-file`.** `repo-diff` is considered and declined with a stated reason; the other twelve kinds are not file-backed at all | §3 |
| What the change orphans | `repoFileIcon()` and `tabKinds.ts`'s `monacoLanguageFor` import. Verified by grep, **not** by `find_references` — see §14 | §2.3 |
| Is the reading view's default mode still correct? | Yes, and it is *Source*, not Reading: `markdownReading` is opt-in and persisted per tab (P67c D12). This phase does not change it | §5.1 |
| Why the preview renders smaller | **Not a hardcoded px and not a stale token.** Body prose already resolves to the editor's exact font size. Two real defects sit either side of it: fenced code is pinned one step *below* the editor (`--kira-t-sm`), and every heading is collapsed *onto* body size by Tailwind preflight, which `.md-reading` never restores | §6 |
| Whether the fix adds a setting or a token | **No.** Both halves put existing elements onto the `--kira-font-size` chain that already exists, exactly as P72 §8.1 did for the graph's ref badges | §7 |
| Tests | No new unit test, no new spec file. Two assertions added to two existing Playwright specs | §12 |
| One Sonnet pass or a split | One, with a clean seam between Part A and Part B (zero shared files) | §13.2 |

---

# Part A — tab-strip icons

## 1. Confirmed current state

### 1.1 How a tab icon resolves today

`TabStrip.vue:35`-`37` is the whole of it:

```ts
function iconFor(tab: TabRecord): string {
  return TAB_KINDS[tab.kind].icon(tab);
}
```

— a codicon *name*, rendered by `<CodiconIcon :name="iconFor(tab)" :size="13" class="tab-icon" />`
at two sites since P72 §7 split the strip: the pinned leading slot (`:214`) and the scrolling loop
(`:248`). `TAB_KINDS[...].icon` has exactly one consumer in the app — this function
(grep over `apps/` and `packages/`), so widening it touches no other surface.

The registry's own comment at `tabKinds.ts:83`-`88` states the constraint this item must not break:
*"TabStrip.vue's old iconFor body"* moved into the registry precisely so the strip *"no longer knows
what a 'data' tab's icon is"*. The strip must stay ignorant of which kinds are file-backed.

`repo-file`'s entry is the only kind that derives its icon from the path today —
`repoFileIcon()` (`tabKinds.ts:191`-`197`) maps `monacoLanguageFor(tab.path)` down to three
codicons (`json` / `markdown` / `file` / `file-code`), and its own comment calls that a
*"coarse-bucket"* of the same idea `RepoTreeRow.vue` uses. That comment is now stale: the tree
stopped using an extension map at P67b and uses the seti set.

### 1.2 What a tab record already carries

| Kind | `path` | File-backed? |
|---|---|---|
| `repo-file` | plain repository-relative path (`src/main.go`) — `repoFileTitle`'s own comment, `tabKinds.ts:164`-`170` | **Yes** |
| `repo-diff` | same shape (`repoDiffTitle` delegates to `repoFileTitle`, `:177`-`185`) | Yes, but see §3.2 |
| `data`, `document`, `console`, `definition`, `browse`, `stream`, `keyvalue` | an **encoded NodePath** of database nodes (`kind:name` segments, `pathTail`, `shared/domain/tree.ts:77`-`86`) | No |
| `http-request`, `grpc-request`, `variable-set`, `environments` | a collection-item path, or a fixed literal | No |
| `repo-graph` | none meaningful (pinned placeholder) | No |

So no path needs threading anywhere. The two kinds that have one already have it on the record the
strip is already iterating.

### 1.3 The icon module, read end to end

- `packages/git-ui/src/icons/setiFileIcon.ts:115`-`120` — `setiIconFor(path)` takes a full path,
  slices the basename itself, returns `{ maskUrl, color }`. A CSS mask plus a colour, never inline
  SVG.
- `packages/git-ui/src/components/FileTree.vue:352`-`354` + `:502`-`506` + `:666`-`676` — git-ui's
  consumer: a `<span class="kv-file-tree-icon" :style="fileIconStyle(path)">`, 16px box,
  `mask-size: contain`.
- `apps/kira-studio/frontend/src/repo/fileIcon.ts:12`-`15` — the app-side mirror, a two-line
  `fileIconStyle(path)` over `@kira/git-ui/icons`. Its own doc comment already states why it is
  shared rather than copied per consumer: so *"a file explorer and a search result list agree on one
  icon per language"*. Consumers today: `RepoTreeRow.vue:73`, `RepoSearchRow.vue:68`.

**This item adds a third consumer to that module. It writes no new icon code.**

One dependency worth stating rather than discovering: `setiFileIcon.ts:32` resolves seti's `white`
(the default/unknown icon) to `var(--kv-description-fg)`, a git-ui token defined on `:root` by
`packages/git-ui/src/theme/vscode-tokens.css:149` — which is loaded by git-ui's own lazy chunk
(`packages/git-ui/src/main.ts:12`). A `repo-file` tab can only exist inside a repo workspace, whose
pinned graph tab mounts that chunk, so the token is present by the time this icon renders. That is
the same condition `RepoTreeRow.vue` already relies on; nothing new is introduced here.

## 2. The wiring

### 2.1 Where the decision lives

In the registry, not the strip. `TabKindDef.icon`'s return type widens:

```ts
/** A codicon name, or a file path whose icon comes from the shared seti set
 *  (`repo/fileIcon.ts`) — the same rule the repo file tree and the diff tree already use. */
export type TabIcon = string | { readonly filePath: string };
```

`TabKindDef.icon(tab: TabRecord): TabIcon` (`tabKinds.ts:92`). Every kind whose icon is a codicon is
**unchanged** — `icon: () => 'globe'` still type-checks against the union, so this is a one-line
type edit plus one entry, not fifteen.

Why the union rather than a second optional member (`filePath?(tab)`, the shape `badge?` and
`pinned?` already use at `:112`/`:117`): with a second member, a file-backed kind's required
`icon()` becomes unreachable — a member that exists only to satisfy the interface and never
renders. `CLAUDE.md`'s no-stubs rule rules that out. The union says the true thing: a tab's icon is
*either* a codicon *or* a file's own icon, never both.

### 2.2 The strip

`pinnedTabs` / `scrollingTabs` (`TabStrip.vue:136`-`137`, added by P72 §7) each gain the tab's
resolved icon, so the template narrows the union once per render instead of calling a helper twice
per branch:

```ts
const pinnedTabs = computed(() =>
  tabs.value.filter(isPinned).map((tab) => ({ tab, icon: TAB_KINDS[tab.kind].icon(tab) })),
);
```

…and the same for `scrollingTabs`. `v-for="{ tab, icon } in …"`, then in **both** render sites:

```vue
<span
  v-if="typeof icon !== 'string'"
  class="tab-icon tab-file-icon"
  :style="fileIconStyle(icon.filePath)"
  aria-hidden="true"
/>
<CodiconIcon v-else :name="icon" :size="13" class="tab-icon" />
```

Both sites, not just the scrolling one. No pinned kind is file-backed today (`repo-graph` is the
only one), but special-casing that costs a comment and a silent gap the day one is; two identical
branches cost four template lines and cannot go wrong.

`import { fileIconStyle } from '../../repo/fileIcon';` — `workbench/` has no
`noRestrictedImports` block in `biome.json` and already imports `project/` and `views/` this way, so
this is in-pattern.

### 2.3 CSS and sizing

One new scoped rule beside `.tab-icon` (`TabStrip.vue:349`-`351`):

```css
.tab-file-icon {
  width: var(--kira-control-inline-h);
  height: var(--kira-control-inline-h);
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}
```

(`flex-shrink: 0` comes from `.tab-icon`, which the span also carries.)

**14px, not the tree's 16px, and no literal.** Seti art fills its own `viewBox="0 0 32 32"`
edge to edge (confirmed against the bundled `icons.json`), whereas a codicon glyph carries padding
inside its em box — so a 16px seti box renders visibly heavier than the 13px codicon on the tab
beside it, while 14px lands within a pixel of it. `--kira-control-inline-h` is the token whose
documented role is exactly this (`tokens.css:170`: *"drawn inside a control or a bar"*). If it reads
small in the live app, step it to `var(--kira-icon-box)` (`:155`, 16px, what the tree uses) — never
to a new literal.

Two consequences, stated rather than found later:

- **A file tab's icon is coloured per language and does not dim when the tab is inactive.**
  `.p-tab` sets `color: var(--kira-fg-muted)` and `.p-tab.is-active` sets `--kira-fg`
  (`primitives.css:540`-`558`); a mask painted with `background-color` ignores both. That matches the
  tree row (which is also undimmed) and matches VS Code's own tab icons. Deliberate.
- The tab's accessible name is unchanged — the icon is `aria-hidden`, and the title span still
  carries the name, as with every other tab.

### 2.4 Dead code this creates

| Symbol | Fate |
|---|---|
| `repoFileIcon()` (`tabKinds.ts:191`-`197`) | Deleted — `:431` was its only consumer |
| `import { monacoLanguageFor } from '../views/repo/language'` (`tabKinds.ts:74`) | Deleted — `repoFileIcon` was its only use in this file |

`monacoLanguageFor` itself stays; it has many other consumers (`RepoFileView.vue:58`/`:154` among
them). **Both rows were verified by grep.** `find_references {"symbol":"repoFileIcon"}` answers
*"no references found"* — see §14.

## 3. Scope: which kinds get a seti icon

### 3.1 In scope

**`repo-file` only.** Its entry becomes `icon: (tab) => ({ filePath: tab.path })`. This is the kind
the SPEC row names: a file opened from the repo file tree, whose tab should carry the icon that tree
row already shows.

### 3.2 `repo-diff` — considered, declined

A diff tab *is* file-backed and `repo-diff` would be a two-word change. It stays on `git-compare`
anyway, for one concrete reason: **the icon is the only glance-level signal that a tab is a diff and
not the file itself.** The title carries that signal too — `(Working Tree)` or `(abc1234 ↔ def5678)`
(`repoDiffTitle`, `tabKinds.ts:177`-`185`) — but it is a *suffix*, and `.tab-title`
(`TabStrip.vue:353`-`358`) truncates with `text-overflow: ellipsis` inside a 210px
`max-width` tab (`primitives.css:551`), so the suffix is the first thing to disappear. P74 is about
to open *every* changed file of a commit as diff tabs, filling the strip with tabs whose titles all
truncate to the same basename; giving them the same icon as the plain file tabs beside them trades
one inconsistency for a worse one.

Reversible: if P74's own planning pass finds a better distinction (a badge, a rail, a shorter
title), flipping `repo-diff` onto `{ filePath }` is that same two-word change.

### 3.3 Out of scope, and why

- **`keyvalue` with an S3 `object` tail** — the one near miss. Its name has an extension, but its
  `path` is an encoded NodePath, not a file path, and its own tree (`project/TreeRow.vue`) renders
  codicons via `theme/icons.ts`'s `nodeIcon`, never seti. Wiring it here would make the tab disagree
  with its tree — the exact inconsistency this row exists to remove, one surface over.
- **`data` / `document` / `console` / `definition` / `browse` / `stream`** — database objects. No
  file, no extension, no tree row with a seti icon to match.
- **`http-request` / `grpc-request` / `variable-set` / `environments`** — not file-backed. An HTTP
  request's `path` addresses a collection item; its icon is its protocol, which is the right
  information for that tab.
- **`repo-graph`** — the pinned tab; not a file.

That is one kind in, twelve out. Each keeps the icon it has today.

---

# Part B — the markdown reading view's font

## 4. Where it lives

`apps/kira-studio/frontend/src/views/repo/RepoFileView.vue` — one component, both the Monaco mount
and the reading pane. The render pipeline is `views/repo/markdownReading.ts` (markdown-it,
`html: false`, heading slugs, `title`-on-link); it emits plain HTML and no styling, so **it is not
touched by this item at all**. The entire type surface is the scoped `.md-reading` block,
`RepoFileView.vue:344`-`434`.

## 5. Confirming what SPEC says is already correct

### 5.1 The default-mode logic, read rather than assumed

- `isMarkdown` (`:58`) is `monacoLanguageFor(path) === 'markdown'` — only a markdown file grows the
  Source/Reading toolbar at all.
- `view` (`:59`) is `props.tab.state.markdownReading ? 'reading' : 'source'`, and `onViewChange`
  (`:83`-`94`) persists the choice per tab. **A fresh markdown tab opens on Source**, which P67c D12
  records as deliberate (*"opens on Source, like every other file type — a reading view is opt-in"*).
- The reading pane itself (`:297`-`304`) renders cached HTML through `v-html`, with `v-show` (never
  `v-if`) on the Monaco host beside it so toggling never disposes the editor; `ensureMarkdownRendered`
  (`:71`-`81`) caches per tab id *and* per content.
- `apps/kira-studio/tests/ui/markdown-reading.spec.ts` covers all three (opens on Source, toggling
  preserves editor scroll, raw HTML escaped, links neutralised) and passes today.

**Verdict: unchanged by this phase.** The reading view works as the request says it does, and the
opt-in default is not a bug to fix — flipping it would be scope this row never asked for.

### 5.2 The comparison the request makes

The editor's own size is `settingsState.appearance.fontSize`, passed straight into Monaco at
`RepoFileView.vue:181` (`fontFamily` at `:180`). That setting is the app-wide Appearance control
(`SettingsDialog.vue:664`, `shared/domain/settings.ts:26`, default 12).

## 6. Root cause

### 6.1 The base size is not the bug — say so before fixing the wrong thing

`.md-reading` is `font-size: var(--kira-t-md)` (`:350`). Following that through:

`--kira-t-md: var(--kira-font-size)` (`tokens.css:140`) → `--kira-font-size` is written at runtime
by `applyAppearance()` as `${settingsState.appearance.fontSize}px`
(`state/settings.ts:19`-`27`) → **the same number Monaco is given at `:181`.**

Grep confirms nothing redefines either token anywhere in `apps/` or `packages/` (two matches total,
both in `tokens.css`). So the SPEC row's own candidate causes — a hardcoded px, a stale token, a
different CSS scope — are all **false for the pane's body prose**. An implementer who "fixes" the
base size is changing a value that already matches and will make it wrong in the other direction.

### 6.2 What is actually smaller: fenced code

`.md-reading :deep(code)` is `font-size: var(--kira-t-sm)` (`:401`) — `calc(var(--kira-font-size) -
1px)` (`tokens.css:139`). `:deep(pre code)` (`:414`-`417`) resets only `background` and `padding`,
so a **fenced code block inherits that step-down**.

That is the one place in the app where the same text is rendered twice for direct comparison: a
fenced block in Reading and the same lines in Source are the same characters in the same family
(`--kira-font-data` is `--kira-font-family`, `tokens.css:123` — literally Monaco's `fontFamily`) at
**different sizes**, one pixel apart. On a document made largely of code fences — which is what a
README or anything in `docs/` is — that reads exactly as "the preview is smaller than the editor".

### 6.3 What is also smaller: every heading

Tailwind v4 preflight (`node_modules/tailwindcss/preflight.css:75`-`85`) is explicit:

```css
/* Remove the default font size and weight for headings. */
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
```

`.md-reading :deep(h1…h6)` (`:358`-`367`) restores `margin`, `font-weight: 600` and `line-height`.
It never restores `font-size`. So **every heading in the reading view renders at body size** — an
`<h1>` differs from a paragraph by weight alone.

This is a miss with a traceable origin, not a mystery: P67c's own plan
(`docs/v1.6/plans/P67c-monaco-theming-checkbox-markdown.md:654`-`656`) enumerated what preflight
zeroes as *"`margin`/`padding` on `*` and `list-style` on lists"* and listed the elements that must
restate them. Font size on headings is not in that list, and the implementation followed the list.
The same block's own comment at `RepoFileView.vue:341`-`343` repeats the incomplete enumeration.

A document whose headings are indistinguishable from its body is uniformly small and flat — which is
the second half of the reported symptom, and the half no token change to the base would fix.

### 6.4 The residual difference, which is not a defect

Prose renders in `--kira-font-ui` (fixed, proportional) and the editor in `--kira-font-data`
(`tokens.css:123`-`127`). At equal px a proportional face occupies less width per character than
Menlo, so the two panes will never look pixel-identical. That split is P26 D3 / LAW 08 and is
deliberate: *"Mono is for data … If the app wrote it, it is UI."* **Do not close the gap by putting
the reading pane on the data font** — prose is prose. §9 is the decision rule if the residual still
reads wrong after §7.

## 7. The fix

Two rules in the same scoped block, both landing existing elements on the `--kira-font-size` chain
the rest of the app already uses — the same shape as P72 §6.3's badge fix, and adding no setting,
no token and no literal px.

**(a) Fenced code matches the editor exactly.** Add to `:deep(pre code)` (`:414`-`417`):

```css
font-size: var(--kira-t-md);
```

More specific than the `:deep(code)` rule, so it wins without touching it.

**Inline `code` deliberately stays at `--kira-t-sm`.** It sits inside a line of proportional prose,
where a same-px monospace run visibly outsizes its neighbours — the reason the step-down exists —
and inline code is not the surface the request compares against the editor. One rule moves, not
both, and the difference is stated here rather than left as an inconsistency.

**(b) Headings get their scale back.** Add `font-size` to the existing `h1`-`h6` rules, in `em` so
the scale tracks `--kira-font-size` with no new token and no literal px:

| Element | `font-size` |
|---|---|
| `h1` | `1.6em` |
| `h2` | `1.4em` |
| `h3` | `1.2em` |
| `h4` | `1.05em` |
| `h5`, `h6` | `1em` (already differentiated by `font-weight: 600`) |

`em` resolves against `.md-reading`'s own base, so headings follow the Appearance setting for free;
headings do not nest, so nothing compounds.

**Do not use `--kira-t-xl` for `h1`.** `tokens.css:135`-`137` records that it is deliberately a
`20px` literal that does *not* track Appearance — using it would reintroduce exactly the
"ignores the font-size setting" defect this item exists to remove.

## 8. Verification

Concrete and cheap, in the live app on a markdown file with a fenced block: `getComputedStyle` on
`.md-reading pre code` and on one of Monaco's `.view-line` elements must report the **same**
`font-size` string. Then change Appearance's font size and confirm both move together. No trace, no
measurement apparatus — `CLAUDE.md`'s rule is to measure only when a concrete question is at stake,
and this one is settled by reading two computed values.

## 9. If it still reads small — the decision rule

Land §7 first and look at it. If the pane still reads noticeably smaller than the editor, the cause
is §6.4's family metrics, and there is exactly one legitimate lever:

- **Do not** add a reading-view font-size setting, a literal px, or a new token.
- **Do not** switch the pane to `--kira-font-data` (§6.4).
- The only defensible change is basing prose on `--kira-t-lg` (`--kira-font-size + 1px`,
  `tokens.css:141`) — a deliberate one-step compensation for the proportional/mono difference. Its
  cost is that the pane's body then no longer matches the editor *numerically*, which is what the
  row asked for; so take it only if the rendered result is plainly better, and record which was
  chosen and why in the commit message.

## 10. Deliberately out of scope

- **Changing the reading view's opt-in default** (§5.1). P67c D12 decided it; the request says the
  view works.
- **`repo-diff`'s icon** (§3.2) — declined with a reason, revisitable in P74.
- **The `keyvalue`/S3 near miss** (§3.3) — wiring it would create a tab-vs-tree mismatch.
- **Syntax highlighting inside fenced blocks.** P67c §5.5 ruled it out explicitly; a font-size fix
  is not the place to reopen it.
- **`packages/git-ui/`.** Neither item edits it. `setiFileIcon.ts` is imported, never changed, so its
  existing test stays valid and the VS Code extension's behaviour is untouched.
- **A shared `.md-reading` stylesheet or a markdown design token set.** There is exactly one markdown
  surface in the app (`renderMarkdownReading` has one consumer, `RepoFileView.vue:78`); hoisting for
  a second one that does not exist is inventing scope.

## 11. Files

Modified:

| File | Change |
|---|---|
| `apps/kira-studio/frontend/src/state/tabKinds.ts` | `TabIcon` union on `TabKindDef.icon`; `repo-file`'s `icon` returns `{ filePath }`; `repoFileIcon()` and the `monacoLanguageFor` import deleted (§2.1, §2.4, §3.1) |
| `apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue` | `pinnedTabs`/`scrollingTabs` carry the resolved icon; both render sites branch on the union; `fileIconStyle` import; `.tab-file-icon` rule (§2.2, §2.3) |
| `apps/kira-studio/frontend/src/views/repo/RepoFileView.vue` | `:deep(pre code)` font size; `h1`-`h6` font sizes; the stale preflight comment at `:341`-`343` corrected to name font-size too (§7) |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` | One assertion added to the existing per-language-icon test (§12) |
| `apps/kira-studio/tests/ui/markdown-reading.spec.ts` | One assertion added to the existing Source/Reading test (§12) |

Nothing added, nothing deleted. No IPC change, no schema change, no new dependency —
`markdown-it` and `seti-icons` are both already dependencies, each already used by the exact
module this phase reuses.

## 12. Tests

`CLAUDE.md`'s default is no dedicated unit test, and **this phase needs none.** Measured against the
bar rather than skipped: Part A is a type widening plus one registry entry plus a template branch;
Part B is five CSS declarations. No parser, no boundary arithmetic, no cache invalidation, no
concurrency, no decision structure too large to hold in your head. The one piece of genuinely
rule-shaped logic either item touches — seti's filename→icon resolution — already has its test
(`packages/git-ui/src/icons/setiFileIcon.test.ts`) and is not modified here.

**Two assertions added to existing UI specs**, no new file, because both are the phase's own stated
deliverables and neither is checkable without a real render:

1. `repo-workspace.spec.ts`, inside the existing *"file-tree rows carry per-language icons"* test
   (`:524`+, which already opens a repo with `main.go`/`app.ts`): click the `main.go` row and assert
   the resulting `[data-testid="tab"][data-tab-kind="repo-file"] .tab-file-icon` carries the same
   `mask-image` as the tree row's `.node-icon`. That is the row's literal ask — tab icon matches
   tree icon — in one locator and one expect.
2. `markdown-reading.spec.ts`, inside the existing Source/Reading test: after switching to Reading,
   assert the computed `font-size` of a rendered `pre code` equals the computed `font-size` of a
   Monaco `.view-line`. That is §8's verification, frozen.

**Selector fallout: none.** Grep over `apps/kira-studio/tests/` finds no spec asserting any tab icon
(`tab-icon`, `codicon-file-code`, `codicon-markdown`, `codicon-json`, `codicon-git-compare` — zero
matches), and no spec asserts a `.md-reading` font size. `font-roles.spec.ts` asserts font
*families*, not sizes, and neither item changes a family.

Fast checks per commit: `bun run typecheck` (the `TabIcon` widening is a compile-time change and
`vue-tsc` checks the template branch), `bun run lint`, `bun run build`. No Go is touched.

## 13. Order and sizing

### 13.1 Implementation order

1. **Part A** — `tabKinds.ts`'s union + `repo-file` entry + the two deletions, then `TabStrip.vue`'s
   two render branches and CSS, in one commit: a half-applied widening leaves the strip rendering a
   `[object Object]` name.
   → `feat(workbench): give file tabs their seti file icon`
2. **Part B** — the two CSS rules in `RepoFileView.vue`, plus the corrected preflight comment.
   → `fix(repo): size the markdown reading view off the editor's own type scale`
3. **Spec assertions** — one per item, added to the two existing specs after both changes are in
   (§12).
   → `test(ui): assert tab file icons and reading-view type match their sources`

Steps 1 and 2 are independent and may land in either order; step 3 needs both.

### 13.2 One pass, one seam

One Sonnet pass. **The seam is between step 1 and step 2**: Part A touches `tabKinds.ts` and
`TabStrip.vue`, Part B touches `RepoFileView.vue` — zero shared files, zero shared reasoning. They
are only in one phase because both are small, per this chapter's own bundling precedent.

Never split *inside* step 1 (§13.1's reason). Step 2 is five declarations in one CSS block and has
no internal seam.

Size: 3 source files, 2 spec files, no additions, no deletions. Roughly 40 changed lines total. The
only line that carries real thought is `TabKindDef.icon`'s return type.

## 14. Dogfooding note

The repo-map MCP server was built and started per `CLAUDE.md`'s headless steps and called over curl
(the native tool surface does not appear in an agent-harness session). It did real work:
`find_references` on `setiIconFor` returned all 14 call sites across `packages/git-ui/`,
`apps/kira-studio/frontend/` and a `.vue` file in one call, which is what settled §1.3's consumer
list; `find_references` on `renderMarkdownReading` returned its single consumer
(`RepoFileView.vue:78`) and settled §10's "one markdown surface" claim; `search_symbols` on
`TabKindDef` located `tabKinds.ts:89` without opening the file.

**One non-trivial finding is logged in `docs/v1.8/mcp-repo-map-issues.md`**, and it narrows P72's own
still-open entry rather than adding an unrelated one: `find_references {"symbol":"repoFileIcon"}`
answers `no references found` for a **function** that is genuinely referenced — as a value, at
`tabKinds.ts:431` (`icon: repoFileIcon`). P72 logged this failure as specific to a `const` object;
it is not. It is specific to a **non-call read**, whatever the symbol's kind. The same session
resolved every `call`-kind reference to the same class of symbol correctly.

**Consequence for whoever implements §2.4: that dead-code table was verified by grep, not by the MCP
server.** Do not re-derive it from `find_references`, and do not extend the deletion set on the
strength of a "no references found" answer. Per the log's own rule, nothing about the server is
fixed in this phase.
