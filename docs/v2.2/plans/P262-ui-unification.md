# P262 plan: one UI language across both apps and every module

Ask (user): dialogs all look different (alignment, spacing, buttons, inputs). Tabs: the main tab
bar seems unified; secondary tabs are all over the place. Go over all UI, use the same elements
everywhere, align sizes, proportions, spacing. Decide the unified design first, then apply it in
chunks on 2 streams. Every look decision below is final (user: decide, no sign-off list).
Amendment (user, after foundation): left panels have different functionality, but much of the
visuals can be unified (§1.6, §2.7, §3.1).

Base: `v2.0` at `f046f9a12`. Extends the Studio design language P258 measured
(`plans/P258-git-ui-studio-language.md` §3) and the token layer in `packages/theme/src/tokens.css`
(P16/P22/P104/P123). No new dependency.

Steps, strictly in order:

1. **Foundation** (one sequential Sonnet implementer, `v2.0` checkout): shared primitives, base
   class changes, lint guard with per-stream allowlists, reference migrations, baselines (§3).
   Landed (see "Foundation result").
2. **Foundation addendum: side panels** (one sequential Sonnet implementer, `v2.0` checkout, after
   step 1, before any worktree exists): row/bar primitives, guards U18-U21, allowlists (§3.1).
3. **Stream A** and **Stream B** (two Sonnet implementers, two worktrees off the addendum tip,
   concurrent): per-site migration, chunk after chunk (§4).
4. **Close-out** (one sequential Sonnet implementer after both land): remove legacy paths,
   empty allowlists, docs, result (§5.4).

Method: CodeGraph (`codegraph_explore` on the dialog, tabs, toggle, button, input/field, toolbar,
row and prompt primitives and their callers) plus a tag-level parse of every `.vue` file under
`apps/kira-studio/frontend/src`, `apps/kira-space/frontend/{src,mobile}`, `packages/{workbench,
git-ui,docker-ui,kira-ui}/src` (excludes `packages/theme/src/components/ui`). Counts are tags,
not files, unless stated.

## 1. Inventory

### 1.1 Dialogs: 46 `DialogContent` sites in 46 files, plus 2 non-Dialog overlays

Per root: Studio 14, Space 6 (+2 mobile), workbench 8, git-ui 15 (14 in `components/dialogs/` +
`WorktreeList.vue`), docker-ui 1. Non-Dialog: `packages/workbench/src/prompt/TextPromptDialog.vue`
(raw `role="dialog"`, non-portaled by requirement P107 T2-19), `CommandDialog` (Studio
`CommandPalette.vue`, theme-owned). No `AlertDialog`, no `Sheet` exists.

- **Width: 15 distinct values.** `w-100` 2, `w-105` 1, `w-110` 2, `w-120` 20, `w-130` 1, `w-135` 1,
  `w-140` 3, `w-150` 4, `w-155` 1, `w-170` 3, `w-180` 2, `w-190` 1, `w-225` 1, `w-[34rem]` 1,
  none 3 (`SettingsShell` uses inline `style` width 640px; mobile 2). Height: fixed `h-138`
  (`ConnectionDialog.vue:635`), `h-140` (`DataGripImportDialog.vue:141`, `ReposDialog.vue:108`),
  `h-160` (`ResponseDiffDialog.vue:230`); caps `max-h-4/5`, `max-h-[82vh]`, `max-h-[85vh]`,
  `max-h-[80vh]`.
- **Content box: 2 models.** Theme base `grid gap-4 p-4` (10 sites: `ConfirmDialog`,
  `UpdateDialog`, `AdeConfirmDialog`, `AdeRunDialog`, `CredentialsUpdateDialog`, mobile 2, Studio
  `DynamicValuesDialog` etc.) vs `flex flex-col p-0 gap-0` override (36 sites, 23 distinct strings;
  most used `flex flex-col p-0 gap-0 w-120 max-w-[90vw] max-h-4/5` ×15, git-ui).
- **Header: 5 layouts** over one base (`DialogHeader` `flex-row items-center gap-1.5 border-b
  px-3 py-2`): title + ghost `icon-sm` close `ml-auto` ×31; leading `size-4` icon + title + close
  ×4 (`ConnectionDialog`, `FiltersDialog`, `DataGripImportDialog`, `SettingsShell`); +description
  ×1 (`ReposDialog`); title only ×8 (`AdeConfirmDialog`, `AdeClaudeDialog`, `AdeRunDialog`,
  `UpdateDialog`, `ConfirmDialog`, `CredentialsUpdateDialog`, ...); description in header ×3
  (`RecreateConfirmDialog`, mobile 2). **Close: 4 mechanisms**: header ghost button ×35,
  DialogContent's built-in absolute close ×1 (`RecreateConfirmDialog.vue:15`), hand-placed
  absolute close ×1 (`packages/workbench/src/components/ConfirmDialog.vue:65`), none ×8.
- **Body: 14 distinct wrappers.** `flex min-h-0 flex-col gap-3 overflow-auto p-3` ×15
  (git-ui, P256/P258); `overflow-auto` with inner padding ×9 (Studio api/workbench);
  `flex flex-col gap-1.5 px-3 py-2` (`UploadObjectDialog.vue:121`); `gap-1 px-3 py-2`
  (`GitCredentialDialog.vue:58`); `gap-2 px-3 py-2` (`AdeConfirmDialog.vue:54`); `gap-3 px-3 py-2`
  (`AdeRunDialog.vue:125`, `AdeClaudeDialog.vue:132`); `gap-2 p-3` (`AddMemoryDialog.vue:88`,
  `ImportConfirmDialog.vue:55`, `SchemaDialog.vue:140`); bare `<p>` in the grid
  (`ConfirmDialog.vue:43`, `UpdateDialog.vue:53`); tabs as body (`ScriptDialog.vue:221`); split
  panes (`ReposDialog.vue:124`, `SettingsShell.vue:214`).
- **Footer: 4 alignments.** Default footer + `<span class="flex items-center gap-1 ml-auto">`
  wrapper ×16 (Studio; `gap-1` ×9, `gap-1.5` ×7); `class="justify-end"` ×18 (git-ui, workbench);
  no alignment, buttons left ×7 (`AdeConfirmDialog.vue:61`, `AdeClaudeDialog.vue:267`,
  `AdeRunDialog.vue:195`, `RecreateConfirmDialog.vue:57`, `ReposDialog.vue:268`, mobile 2);
  shadcn stacked `flex-col-reverse sm:flex-row bg-field/50 -mx-4 -mb-4 p-4` ×2 (`ConfirmDialog`,
  `UpdateDialog`). Left-side extras handled 3 ways (`mr-auto` text, a leading Button before an
  `ml-auto` group, `ml-auto` on one button: `AddMemoryDialog.vue:138`, `ImportConfirmDialog.vue:82`).
- **Footer buttons** (already close to unified): `dialog/kira-lg` ×125, `dialog-primary/kira-lg`
  ×69, `dialog-danger/kira-lg` ×3; order Cancel then primary at 43 of 45 sites. Outliers:
  `ResponseDiffDialog.vue:354` `size="kira"`; mobile `size` default; `AdeClaudeDialog.vue`
  `dialog-danger/sm`; `AddMemoryDialog.vue:138` primary first.
- **Inputs inside dialogs: 3 heights.** `kira-lg` 26px (git-ui, `KeyValuePane`), shadcn default
  32px (`SaveRequestDialog`, `UploadObjectDialog`, `GenerateDataDialog`, `ScriptDialog`,
  `GitCredentialDialog`, `AdeRunDialog`, `FiltersDialog`, docker edit sections), and a
  hand-rolled override `h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2
  font-data` ×14 (`ConnectionDialog`) / `h-control ...` ×5.

### 1.2 Tabs: 1 primary chip recipe, 5 secondary implementations

- **Primary / document tabs** (`tabChipVariants`, `packages/theme/src/components/ui/tabs/index.ts:11`,
  `h-control-lg rounded-kira-sm border`, active `bg-elevated border-border-strong text-fg`):
  `TabStrip.vue:219,257` (in `WorkbenchShell` `h-tabbar border-b bg-chrome`), `ModeSwitcher.vue:34`,
  `AdeShell.vue:84-125` (but framed `nav h-tabbar rounded-kira border bg-bg gap-2`, a 2nd bar
  look), `ConsoleView.vue:936` result tabs, `ExecView.vue:60` sessions, `AdeSessionStrip.vue:25`.
  Unified except the AdeShell frame.
- **Secondary (a fixed set of views of one thing)**, 5 looks:
  1. Chip via reka `Tabs`/`TabsTrigger` + `tabChipVariants`: `ConnectionDialog.vue:737-743`
     (`TabsList w-full border-b pb-1.5`), `ScriptDialog.vue:223` (`px-3 pb-1.5`),
     `ContainerEditView.vue:183` (`pb-1.5`), `AdePanelFrame.vue:19` (`px-1.5 py-1`),
     `AdeAddPopover.vue:135` (`p-1`, size wide). 4 different TabsList paddings.
  2. Chip on raw `<button role="tab">`: `ContainerDetail.vue:149-160` (`px-1.5 py-1`).
  3. `ToggleGroup` default variant (fill `bg-field` when on, chips 2px apart), `size="kira"`
     22px: 21 sites, e.g. `HttpRequestView.vue:628`, `GrpcRequestView.vue:423`,
     `ResponsePane.vue:290,315`, `DefinitionView.vue:262`, `DockerPanel.vue:114`,
     `GitPanel.vue:377`, `OpLogPanel.vue:172`, `RunsSection.vue:56`, `RepoFileView.vue:276`; and
     `kira-lg` ×4 (`ConnectionDialog.vue:1095,1115,1135`, `AdeClaudeDialog.vue:201`).
  4. `ToggleGroup variant="outline"` (connected segments): 11 sites (`ReviewView.vue:902,943`,
     `ReviewFilesPane.vue:136,166`, `FileTree.vue:550`, `BranchPicker.vue:609`,
     `RowDensityField.vue:36`, `ConnectionDialog.vue:786`, `AdeWorkflowEditor.vue:33`).
  5. Buttons toggled by variant: `AdeAllSessions.vue:73,76` (`dialog` vs `ghost`),
     `AdeEstimateField.vue:108,117`.
  Plus the Settings section nav (`SettingsShell.vue:216`, vertical list, `h-5.5 px-1.5`).
  Containers: inside `ViewToolbar` (Studio), `border-b px-1.5 py-1` div (Docker, Runs),
  `h-bar` header (GitPanel), `TabsList` (4 paddings). Heights 22px vs 26px with no rule.
  Every ToggleGroup site repeats `@update:model-value="(v) => v && set(v)"`.

### 1.3 Form controls

- `Input` 137: size default (32px, shadcn) 80, `kira` 30, `kira-lg` 27. `NativeSelect` 40:
  default (`kira` 22px) 24, `kira-lg` 14, `kira` 2. `Textarea` 25 (`px-2.5 py-2`, `rounded-kira`).
  `InputGroup` 36, all default variant (`h-8 rounded-kira`); its `kira` variant
  (`h-control rounded-kira-sm bg-field`) is unused.
- Radius split: `Input`/`Textarea`/`InputGroup` default `rounded-kira` (6px), `NativeSelect`,
  `Button` dialog/toolbar, `Toggle` `rounded-kira-sm` (4px). Fill split: `Input`
  `bg-transparent dark:bg-border-strong/30`, `NativeSelect` bordered and `InputGroup` kira
  `bg-field`.
- Override strings on inputs: 30+ distinct (`h-control-lg w-full rounded-kira-sm ... bg-field`
  ×14, `h-control ...` ×5, `max-h-90 resize-y rounded-none border-0`, ...).
- Labels: `Field` 119 (vertical 83, horizontal 36), `FieldLabel` 63, bare `Label` 111, raw
  `<label>` 63 in 34 files (all settings panes, ADE, `ConnectionDialog`, `DockerPanel`).
  Raw `<input>` 32 in 16 files, raw `<select>` 8 files, raw `<textarea>` 5 files.
  `FieldGroup` base `gap-4` vs dialog body `gap-3`.

### 1.4 Buttons: 492 `<Button>`, 32 variant/size combos

Standard combos: `dialog/kira-lg` 125, `dialog-primary/kira-lg` 69, `toolbar/kira` 69,
`ghost/icon-sm` 43, `toolbar/kira-icon` 17 (+`TooltipIconButton` default `kira-icon`),
`toolbar-primary/kira` 9, `dialog-danger/kira-lg` 3. Off-system: `secondary/kira` 18 (docker-ui),
`dialog/kira` 18 (ADE, git-ui banners), shadcn `default` variant 26 (`AdeBranchPanel`,
`AdeStageBlock`, `LogsView`, ...), `xs`/`sm`/default sizes 45 (`ImportJobDetail` `outline/xs` ×6,
`AdeReviewSync` `dialog/xs`, `ExecView` `ghost/xs`, `CopyAsCurlDialog` default/default), `link`
at 4 sizes. Raw `<button>` 90 in 58 files (rows, chips, nav).

### 1.5 Menus, popovers, panels, empty states, typography, icons

- `PopoverContent` 23 sites, 18 distinct class strings, widths `w-52 w-56 w-64 w-70 w-72 w-80
  w-95 w-96 w-105 w-115 w-120 w-auto`. `DropdownMenuContent` 10, 7 widths.
- Panel title bars: `PanelHeader.vue:7` exists, used by 6 files; the identical string is
  hand-rolled in `ProjectPanel.vue:37`, `CollectionsPanel.vue:127`, `MemoryPanel.vue:51`,
  `AutomationsPanel.vue:332`, `DockerPanel.vue:80`; `GitPanel.vue:374` drops the label style.
  `ViewToolbar` used by 27 files; `h-bar ... gap-1 px-2` hand-rolled 8 times
  (`RequestBodyPane.vue:166`, `ResponseHistoryList.vue:119`, both `ResponsePane.vue`,
  `SchemaBrowser.vue:109`, `CallHistoryList.vue:97`, `ConsoleView.vue:925`,
  `ReviewCommentsPane.vue:76`).
- Section headings: 12 uppercase strings in 31 files (`RefSectionHeader.vue:13`
  `h-control-sm px-1.5 text-kira-sm text-subtle uppercase tracking-wider` ×5 equivalents; others
  `text-muted-foreground`, `font-semibold`, `py-0.5`, `mb-1.5 mt-4`).
- Empty states: `Empty` 72 (padding none 34, `p-4` 8, `p-6` 6+6, `py-10` 3, `h-full` 3);
  `EmptyMedia variant="icon"` 7 (P258 says default); `EmptyTitle` overrides 3; `Alert` faking an
  empty state (`border-0 bg-transparent`) 6.
- Weights: `font-semibold` 91 (Space ADE 58, docker 12, workbench 10, mobile 6, Studio 5),
  `font-bold` 25 (ADE 21). Studio and git-ui speak 400/500 (P258).
- Icon sizes (`CodiconIcon :size`): 13 ×244, 24 ×67, 12 ×52, 10 ×40, 16 ×13, 14 ×12, 15 ×4,
  20 ×2, 32 ×2.
- Heights used for rows/controls: `h-control` 30, `h-control-lg` 24, `h-control-sm` 14, `h-row`
  12, plus raw `h-5 h-6 h-7 h-8 h-9 h-10 h-12` 40 (mobile `h-11` ×17 is touch).

Divergence summary: 15 dialog widths, 14 body wrappers, 4 footer alignments, 4 close
mechanisms, 5 secondary-tab looks with 2 heights, 3 input heights × 2 radii × 2 fills, 32 button
combos, 18 popover strings, 9 icon sizes, 2 bold weights where the system has none.

### 1.6 Left and side panels: 6 module panels, 45 files

Method: `codegraph_explore` on `WorkbenchShell`, `PanelHeader`, `usePanelHeaderSearch`, both apps'
`MODES`, `rowVariants`, `TreeTwisty`, the ADE side panes; then a class-level grep of the files below.
Paths use the §4.2 prefixes. Mobile has none (bottom `TabBar`, full-width screens); `kira-ui` has
none (`KuiColumnResizeHandle` is a grid column handle, P263).

- **Module left panels** (`ModeDef.panel`, mounted in `WorkbenchShell` `#panel`), 6 files: Studio
  `S/workbench/panels/ProjectPanel.vue` (Connections), `S/api/CollectionsPanel.vue`,
  `p/docker-ui/src/components/DockerPanel.vue` (Studio wrapper `S/docker/DockerPanel.vue` has no
  markup); shared `p/workbench/src/automations/AutomationsPanel.vue` (both apps),
  `p/workbench/src/memory/MemoryPanel.vue` (Space); Space `K/repo/GitPanel.vue`. ADE is
  `layout: 'full'`, no left panel.
- **Panel bodies**, 20 files: Studio trees `S/project/{ProjectTree,TreeRow}.vue`,
  `S/api/{CollectionsTree,CollectionRow}.vue`; Docker lists
  `p/docker-ui/src/components/{ContainerList,ImageList,VolumeList,NetworkList,VirtualList,ListState}.vue`;
  Space repo `K/repo/{RepoFileTree,RepoTreeRow,RepoSearchView,RepoSearchRow,RepoReviewView}.vue`;
  git review sidebar `p/git-ui/src/components/review/{ReviewView,ReviewCommitRow,ReviewFilesPane,ReviewCommentsPane}.vue`,
  `p/git-ui/src/components/FileTree.vue`.
- **Other side panes**, 15 files: ADE review window `K/ade/v2/review/{AdeReviewWindow,AdeReviewFiles,AdeReviewAgentPanel}.vue`;
  Plan detail pane `K/ade/v2/panel/{AdePanel,AdePanelFrame,AdePanelResizeHandle,AdeTaskPanel,AdeBranchPanel,AdeArchivedPanel}.vue`;
  backlog aside `K/ade/v2/backlog/{AdeBacklogPage,AdeBacklogPanel,AdeBacklogRow}.vue`; stopped
  sessions `K/ade/v2/sessions/{AdeStoppedList,AdeStoppedRow}.vue`; in-dialog nav `K/repo/ReposDialog.vue`.
- **Shared chrome**, 4 files: `p/workbench/src/components/{WorkbenchShell,PanelHeader,TreeTwisty,SettingsShell}.vue`.

Total 45 (A 15, B 26, foundation 4). Divergence, counted across them:

- **Header: 0 of 6 module panels use `PanelHeader`.** 5 hand-roll its exact string (Project,
  Collections, Docker, Automations, Memory); `GitPanel` puts a tab row in a title-less `h-bar`.
  Toggled search button: `:data-active` (Project) vs `bg-field text-fg` class (Collections).
- **Sub-bars below the header: 3 wrappers.** Search row `shrink-0 border-b border-border px-1.5 py-1`
  ×5 (Project, Docker, Automations, Git, Memory), bare `InputGroup` (Collections), `py-1 px-2`
  toolbar (`RepoSearchView.vue:104`); section-tab row `px-1.5 py-1` (Docker) vs `h-row` (Git files);
  filter row `h-control` (Docker "Show stopped").
- **Rows: 6 height mechanisms.** `h-row` 8, `min-h-row` 1 (git `rowVariants` tree), `h-5.5` 2
  (`ReposDialog`), `min-h-9` 1 (`AdeBacklogRow`), padded `py-1`/`py-1.5` rows (Automations,
  Memory, `AdeStoppedRow`), fixed JS heights (`VirtualList` 28, `ContainerList` 28/44, ignoring density). The density
  formula `rowDensity === 'compact' ? 22 : 28` is copied in 4 side-panel trees.
- **Row state: 3 recipes.** `bg-select` selected + `hover:bg-hover` (trees, Docker, git), `bg-hover`
  as selected (`MemoryPanel.vue:109`), `border-l-3` amber bar + `bg-select` (`AdeBacklogRow.vue:55`);
  `opacity-70` for historical memories; text-fg vs muted for open/closed repos. Focus: outline
  (Docker), `group-focus-within:focus-ring` (git `FileTree`), none (Automations, Memory).
- **Indent: 2 schemes.** `8 + depth × 14` px ×5 (`TreeRow`, `CollectionRow`, `RepoTreeRow`,
  `FileTree` ×2); hand `pl-5`/`pl-6` ×9 (Automations group children, Git worktrees). Flat rows
  `px-1.5` (6px), so depth-0 tree text sits 2px right of flat-list and header text.
- **Section headings: 3 hand-rolled** (`CollectionsPanel` Button `h-control ... uppercase`,
  `ReviewView` `pt-1 pb-0.5 ... uppercase` ×2). Automations collection groups are `font-semibold`
  rows.
- **Counts: 3 looks.** `text-kira-sm text-muted-foreground` (Docker section counts, Automations
  groups), `Badge` pills (Memory), `font-semibold` tone numbers (`AdeBacklogPanel`).
- **Empty: 3 mechanisms.** `Empty` with padding overrides (`p-4`, `p-6`; Collections, Git, Memory,
  Docker `variant="icon"`), hand-rolled `.side-empty` div (Project, Automations, Git), `Alert`
  faking an empty state (Automations, Git).
- **Containers: framed 3, unframed 1.** Framed pane on chrome `rounded-kira border border-border bg-bg`
  with `gap-0.5`: shell panel, `AdePanel`, backlog aside; `AdeReviewWindow` sections sit flat with
  `border-l` handles. In-dialog navs: `SettingsShell` `w-44`, `ReposDialog` `w-52`.
- **Resize: 2 handles, 3 bound sets.** Shell `ResizableHandle` 2px transparent, hover/drag
  `bg-focus`, 180-480px default 260; `AdePanelResizeHandle` 6px `bg-chrome border-l` with a grip,
  review left 220-560 default 320, review right 280-720, `AdePanel` 340 to row minus plan.
- **Scroll: native only** (`overflow-y-auto` or a virtualizer scroller); 0 `ScrollArea`.
- **Icons** in these files: 13 ×41, 12 ×9, 16 ×4, 24 ×6, 14 ×1.

## 2. Decisions (final)

### 2.1 Scale (existing tokens; nothing new)

| Role | Value | Why |
|---|---|---|
| Toolbar density | `h-control` 22px: toolbar buttons, toolbar inputs/selects, secondary tabs, menu rows | P22 role layer, most used |
| Dialog/form density | `h-control-lg` 26px: every control inside a dialog, form, inspector or settings pane | P22 role layer; git-ui D9 |
| Chip density | `h-control-sm` 18px: badges, counts, section headings | existing role |
| List/tree row | `h-row` (28px comfortable / 22px compact) | TreeRow, follows Appearance density |
| Bars | `h-bar` 34px toolbars and panel headers; `h-tabbar` primary tab strip | tokens.css:95-97 |
| Text | `text-kira-sm` 11 meta/labels/help, `text-kira-md` 12 body/controls, `text-kira-lg` 13 dialog and view titles, `text-kira-xl` 20 big numbers/empty headings | P123 four-value scale |
| Weight | 400 body; 500 (`font-medium`) buttons, labels already medium, view/detail titles, stat numbers; `font-semibold` only in `PanelHeader`; `font-bold` never (ANSI bold in `LogsView.vue` is data) | Studio/P258 speak 400/500; one emphasis step reads calmer |
| Spacing | `gap-1` inside a control cluster; `gap-1.5` toolbars, button rows, header items; `gap-3` between fields/sections; `p-3` dialog body, panel content, inspectors; `px-3 py-2` dialog header/footer and panel head blocks; `px-2` toolbars; `px-1.5` panel headers, list rows, section headings | the most-used value per role today |
| Radius | controls `rounded-kira-sm` 4px (button, input, select, textarea, toggle, chip); dialogs `rounded-kira-pill` (DialogContent base); popovers/menus keep theme base | P121 control tier; one radius per tier |
| Icons | 13 in controls, rows, toolbars, headers, tabs; 12 inside 18px chips and chip close buttons; 16 mode-switch tabs only; 24 `EmptyMedia`; 10 retired (to 12), 14/15 to 13, 20/32 to 24 | 13 is 63% of uses; P22 D6 for 16 |
| Fill | inputs, selects, textareas, input groups `bg-field border-border-strong` | matches NativeSelect bordered, InputGroup kira and ConnectionDialog, the most polished form |

### 2.2 Dialog

One structure, shadcn parts extended in `packages/theme/src/components/ui/dialog/`:

```vue
<Dialog :open @update:open>
  <DialogContent size="md" data-testid="x-dialog">       <!-- sm|md|lg|xl|2xl, optional fixed-height -->
    <DialogHeader icon="git-branch" closable close-testid="x-close">
      <DialogTitle>Create branch</DialogTitle>
      <DialogDescription class="sr-only">…</DialogDescription>  <!-- only when nothing visible says it -->
    </DialogHeader>
    <DialogBody> …fields… </DialogBody>                    <!-- flush for tabs/split panes/tables -->
    <DialogFooter>
      <template #start>…test/status/note…</template>
      <Button variant="dialog" size="kira-lg">Cancel</Button>
      <Button variant="dialog-primary" size="kira-lg">Create</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

| Part | Spec |
|---|---|
| `DialogContent` `size` | `sm` `w-100` 400px (confirm, prompt, one field); `md` `w-120` 480px (2-6 fields; all git dialogs); `lg` `w-150` 600px (multi-section forms, tabs, approval/run dialogs); `xl` `w-180` 720px (editors, pickers, settings); `2xl` `w-225` 900px (diff/compare viewers). Every size adds `flex flex-col gap-0 p-0 max-w-[90vw] max-h-4/5 overflow-hidden`. Why: 5 steps cover all 15 widths within ±70px; `w-120` (20 sites) and `w-150` stay exact |
| `fixed-height` (boolean) | `h-140 max-h-[85vh]` (`2xl`: `h-160`) for dialogs whose content switches (tabs, steps, pickers) so the box never jumps. Why: the 3 existing fixed heights are 552/560/640px |
| Close | built-in absolute close removed from the sized path; `DialogHeader closable` renders `DialogClose as-child` > `Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close"` > `CodiconIcon close 13`, `close-testid` prop keeps existing testids. Every dialog is closable except while a blocking op runs (`UpdateDialog` installing: `:closable="false"`). Why: 35 of 46 already do exactly this; the close equals Esc, which every one of these dialogs already handles |
| Header | base unchanged (`flex-row items-center gap-1.5 border-b border-border px-3 py-2`); optional `icon` prop renders `span.size-4 flex items-center justify-center shrink-0 text-muted-foreground` + `CodiconIcon :size="13"`; title `text-kira-lg` 400 (base); extra header items (search, toggles) go between title and close. Description never in the header visually |
| Description | visible explanatory text = first child of `DialogBody`, `DialogDescription` (`text-kira-sm text-muted-foreground`); otherwise `sr-only` in the header for a11y |
| `DialogBody` (new) | `flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3`; `flush` → `p-0 gap-0` for tabs, split panes, full-bleed tables/editors. Why: the git-ui/P258 recipe, 15 sites |
| Footer | base `flex items-center justify-end gap-1.5 border-t border-border px-3 py-2`; `#start` slot renders `mr-auto flex min-w-0 items-center gap-1.5` for a non-dismissing secondary action (Test connection), status text (`text-kira-sm text-muted-foreground`), or an error (`FieldError`). Button order left→right: dismiss (`dialog`, "Cancel" when it discards input, "Close" when nothing to discard), other alternatives (`dialog`), primary last (`dialog-primary`, or `dialog-danger` for a destructive primary). One primary at most; all `size="kira-lg"`. Why: right-aligned Cancel→primary is 43/45 sites today |
| Form inside | stacked `Field` per §2.5, fields directly in `DialogBody` (gap-3), never an extra wrapper div with its own gap; two short related fields side by side only as `grid grid-cols-2 gap-3` |
| Confirm (= AlertDialog role) | `size="sm"`, `DialogHeader closable` + `DialogTitle` (the question or "Confirm"), body `DialogBody` with the message `p.m-0 whitespace-pre-wrap`, footer Cancel + confirm (`dialog-primary` or `dialog-danger`). No reka `AlertDialog`: it blocks outside-click dismissal, a behaviour change |
| Sheet / side panel | none exist; mobile `ReplySheet` is a sized Dialog. Side panels (`AdePanelFrame`, detail panes) use `PanelHeader` + head block `flex flex-col gap-1.5 border-b border-border px-3 py-2` + optional `SecondaryTabs` row + content `p-3 gap-3` |
| Non-portaled prompt | `TextPromptDialog.vue` keeps its own scrim (real requirement) but renders the `sm` look: `w-100 rounded-kira-pill bg-elevated ring-1 ring-fg/10`, header/body/footer with the exact `DialogHeader`/`DialogBody`/`DialogFooter` classes (imported as plain class constants exported from `dialog/index.ts`: `dialogHeaderClass`, `dialogBodyClass`, `dialogFooterClass`), input `kira-lg` |

Size per existing dialog (implementers apply exactly this):
- `sm`: `ConfirmDialog` (wb), `UpdateDialog` (wb), `PairingRequestDialog` (105), `AdeConfirmDialog`
  (110), `GitCredentialDialog` (110), `CredentialsUpdateDialog`, mobile `ConfirmDialog`, mobile
  `ReplySheet`.
- `md`: `DynamicValuesDialog`, `SaveRequestDialog`, `UploadObjectDialog`, `ImportConfirmDialog`,
  `WorktreeList` dialog, all 14 git-ui `components/dialogs/*`.
- `lg`: `DbMcpApprovalDialog` (130), `AdeRunDialog` (135), `AdeClaudeDialog` (140),
  `ImportCurlDialog` (140), `FiltersDialog` (140), `ScriptDialog`, `RunScriptDialog`,
  `ScheduleConfirmDialog`, `AddMemoryDialog`, `RecreateConfirmDialog` (34rem).
- `xl`: `ConnectionDialog` (155, fixed), `CopyAsCurlDialog` (170), `EditRawRequestDialog` (170),
  `GenerateDataDialog` (170), `SchemaDialog` (180), `DataGripImportDialog` (180, fixed),
  `ReposDialog` (190, fixed), `SettingsShell` (640px, fixed; `width`/`height` props removed).
- `2xl`: `ResponseDiffDialog` (225, fixed).
- Exempt: `CommandDialog` (command surface, theme-owned, `w-105`).

### 2.3 Tabs

| Kind | Element | Spec |
|---|---|---|
| Primary / document tabs (open instances: editor tabs, console result sets, terminal/exec sessions, ADE sessions; module mode switch) | `tabChipVariants` (unchanged) on `button`/reka `TabsTrigger` | bar container `h-tabbar shrink-0 flex items-center gap-0.5 border-b border-border bg-chrome px-1` (WorkbenchShell). `AdeShell` nav moves onto this container (drops `rounded-kira border bg-bg gap-2`); its counts render as `Badge variant="count"` |
| Secondary tabs (a fixed set of views of one object: request panes, response panes, detail tabs, dialog sections, panel sections) | new `SecondaryTabs` (`variant="tabs"`) | ToggleGroup default variant: chips `gap-0.5`, active `bg-field text-fg`, inactive `text-muted-foreground hover:bg-field`, `text-kira-md font-medium`, icon 13, count `text-kira-sm text-muted-foreground`. Height `kira` 22px everywhere it sits in a bar; `kira-lg` 26px only beside dialog-density controls (none of the tab rows; option pickers in forms). Why: 21 sites already, and P260 the user asked section tabs to look like the git module's (this one) |
| Row placement | — | always alone on, or leading, a `ViewToolbar` row (`h-bar gap-1.5 px-2 border-b`); in dialogs and side panels that row uses `px-3`; trailing actions `ml-auto` in the same row. Never inside `DialogHeader`, never a `TabsList` with its own padding |
| Segmented option picker (choose a value/mode/filter: tree/flat, TLS mode, page size, timestamp zone, density, MCP permission level, unit h/d, running/stopped) | `SecondaryTabs variant="segmented"` | ToggleGroup outline variant, connected, `border-border-strong`, same height as neighbouring controls (`kira` in toolbars, `kira-lg` in forms). Why: 11 sites already outline; separates "pick a value" from "show a view" |
| Vertical nav (Settings sections) | `SettingsShell` nav, unchanged structure | items `h-control-lg px-2 rounded-kira-sm text-kira-md`, active `bg-select text-fg` (from `h-5.5 px-1.5`). Why: dialog density inside a dialog |
| Content panels | reka `Tabs` root + `TabsContent` stay where content must stay mounted (`ScriptDialog` force-mount, `ConnectionDialog`); header is `SecondaryTabs` bound to the same `v-model`; `TabsList`/`TabsTrigger` only in `AdeShell.vue` (primary nav) | |

Site classification (secondary vs segmented) for the ToggleGroup sites: tabs = `HttpRequestView`
request pane, `ResponsePane` (http ×2: view + pane), `GrpcRequestView` request pane, grpc
`ResponsePane`, `DefinitionView`, `RepoFileView`, `GitPanel:377`, `DockerPanel`, `OpLogPanel`,
`RunsSection`, `BranchPicker` branch-tabs, `ReviewView:902`, `AdeWorkflowEditor` graph/yaml,
`ConnectionDialog` detail tabs, `ScriptDialog`, `ContainerEditView`, `ContainerDetail`,
`AdePanelFrame`, `AdeAddPopover`; segmented = `KeyValuePane`/`DataToolbar`/`StreamView`/
`DocumentView` page size, `TimestampPane` zone, `RequestBodyPane` body mode, `GrpcRequestView:368`
TLS, `SchemaBrowser` source, `ConnectionDialog` fields/uri and MCP read/write/ddl,
`AdeStepInspector` mode, `AdeClaudeDialog:201`, `GitPanel:617`, `RowDensityField`, `FileTree`
tree/flat, `ReviewFilesPane` ×2, `ReviewView:943`, `AdeAllSessions` running/stopped,
`AdeEstimateField` h/d. A site not named here: content switch → tabs, value → segmented.

`SecondaryTabs` emits only non-empty values (absorbs every `(v) => v && set(v)`).
`ContainerEditView` tabs' `data-state` becomes `on`/`off` (spec `docker-edit.spec.ts:169-170`
updated by Stream A); `role="tab"`/`aria-selected` on `ContainerDetail` become ToggleGroup's
radio semantics; testids unchanged.

### 2.4 Buttons

| Use | Variant / size |
|---|---|
| Dialog, form, inspector, empty-state action | `dialog` / `dialog-primary` / `dialog-danger`, `kira-lg` |
| Toolbar labelled | `toolbar` (or `toolbar-primary`), `kira` |
| Toolbar or row icon-only | `TooltipIconButton` (`toolbar` `kira-icon`, icon 13) |
| Dialog header close | `ghost` `icon-sm` (only there) |
| Inline text action | `link`, `kira` |
| Destructive row/toolbar action | `danger`, `kira` |
| Title bar | `title` / `title-labelled` (TitleBar only) |
| Mobile | same variants; `class="h-11"` touch height (44px, platform minimum) |

Retired outside `packages/theme/src/components/ui`: variants `default`, `secondary`, `outline`,
`destructive` (use `dialog-primary`/`toolbar-primary`, `dialog`/`toolbar`, `dialog-danger`/
`danger`); sizes `default` (incl. omitted `size`), `xs`, `sm`, `lg`, `icon`, `icon-xs`,
`icon-lg`. Button-as-toggle (`AdeAllSessions`, `AdeEstimateField`) → segmented. Raw `<button>`
stays only for rows, chips and tab chips that render through a cva (`rowVariants`,
`tabChipVariants`, tree rows).

### 2.5 Form field

| Element | Spec |
|---|---|
| Stacked field (default everywhere) | `Field` (vertical, `flex-col gap-1`) > `FieldLabel` > control > `FieldDescription` (help, `text-kira-sm text-subtle`) > `FieldError` (`text-kira-sm text-error`) |
| Inline field | `Field orientation="horizontal"` (`gap-1.5`) only for Checkbox/Switch (control first, then `FieldLabel`) and for a control inside a toolbar row |
| Groups | `FieldGroup` base `gap-3` (from `gap-4`); `FieldSet` + `FieldLegend` for titled sections (settings panes, docker edit sections) |
| Read-only key/value | `grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1`, keys `text-muted-foreground` |
| Labels | `FieldLabel` (or `Label` inside a `Field`); raw `<label>` retired |
| Input / NativeSelect / InputGroup / Textarea | default size `kira-lg` (26px) for Input and NativeSelect; `size="kira"` (22px) in toolbars, filter/search bars, table cells, inline rename; InputGroup default `kira-lg`, `kira` in toolbars; Textarea `px-2 py-1.5 min-h-16`; all `rounded-kira-sm bg-field border-border-strong`; data values `font-data` on the control is the only allowed class besides width/flex/resize/min-h |
| Search / filter text box | `SearchField` (theme): `InputGroup` (`kira` 22px toolbars, filters, trees, popovers; `kira-lg` in dialog forms), 13px `search` icon at start, ghost icon clear button (12px) when non-empty, Esc clears a non-empty value (stops propagation) and bubbles when empty, `autofocus` prop, exposed `focus()`, attrs (testid, `@keydown`) on the `<input>`. Why: 33 files hand-roll icon + `InputGroupInput` + clear with different sizes, clear buttons and Esc handling. Match-count/option toggles (`SearchBox`, `ResponseFindBar`) stay beside it in their own row, never inside the field. `CommandInput` (cmdk list filter) is exempt |
| Placeholder, disabled, invalid | theme bases unchanged |

### 2.6 Bars, sections, rows, menus, empty states

| Element | Spec |
|---|---|
| View/pane toolbar | `ViewToolbar` (`h-bar gap-1.5 px-2 border-b`); the 8 hand-rolled bars migrate |
| Panel title bar | `PanelHeader` (unchanged; the one semibold); the 6 hand-rolled copies migrate (`GitPanel`: §2.7, its tabs in the `#start` slot) |
| Section heading in a panel, picker or list | new `SectionHeading` (theme) = `RefSectionHeader`'s string `flex items-center justify-between h-control-sm px-1.5 text-kira-sm text-subtle uppercase tracking-wider`, default slot for a trailing action; `RefSectionHeader` deleted. Settings/forms use `FieldLegend` |
| View/detail title | `text-kira-lg font-medium text-fg truncate` in a `ViewToolbar` or head block |
| List/tree row | `h-row gap-1 px-1.5 text-kira-md`, hover `bg-hover`, selected `bg-select`, secondary text `ml-auto text-kira-sm text-muted-foreground` |
| Menu/picker row | `rowVariants` `menu` (`h-control gap-1 px-1.5 rounded-kira-sm`) |
| Popover (list/picker) | `PopoverContent class="w-80 gap-0 p-0"` (`w-56` small menus, `w-96` wide pickers) |
| Popover (form) | `PopoverContent class="w-80 gap-3 p-3"` (`w-120` for multi-field forms like `AdeAddPopover`) |
| Dropdown/context menu | `DropdownMenuContent class="min-w-45"`, content-sized (P258) |
| Empty state (pane) | `Empty class="h-full"` > `EmptyHeader` > `EmptyMedia` (default variant) with `CodiconIcon :size="24"` > `EmptyTitle` > `EmptyDescription`; action `Button dialog kira-lg` in `EmptyContent`. No padding overrides, no `variant="icon"`, no Alert-as-empty |
| Empty line (inside a list/popover) | `px-1.5 py-1 text-kira-sm text-subtle` |
| Alerts | `Alert destructive` operation failures, `warn` blockers/data loss, `note` informational banners; explanatory text in forms is `FieldDescription` |
| Badges | `Badge` variants unchanged; no ad-hoc pill spans (`AdeShell` count, `TONE_TAG_CLASS` pills keep their tone classes but `rounded-kira-sm px-1 h-control-sm text-kira-sm`, weight 400) |
| Mobile (`apps/kira-space/frontend/mobile`) | same primitives, structure, typography and weights; touch heights `h-11` kept for buttons, inputs and tab bar (platform minimum) |

### 2.7 Left and side panels

Functionality stays per panel; the frame, bars, rows and states below are one look. Primitives
marked (new) land in the addendum (§3.1).

```vue
<div ref="rootEl" class="flex h-full min-h-0 flex-col">          <!-- panel root -->
  <PanelHeader>Connections                                       <!-- or #start for tabs (Git) -->
    <template #actions><TooltipIconButton icon="search" :pressed="showSearch" …/> …</template>
  </PanelHeader>
  <PanelBar v-if="showSearch"><SearchField v-model="search" data-testid="tree-search" /></PanelBar>
  <div class="min-h-0 flex-1 overflow-y-auto">                    <!-- or a virtualizer scroller -->
    <SectionHeading label="Containers" collapsible :expanded @toggle />
    <div :class="rowVariants({ layout: 'tree', selected })" :style="rowIndent(depth)">
      <TreeTwisty …/> <CodiconIcon :size="13" …/> <span class="min-w-0 truncate">name</span>
      <span class="ml-auto …">meta / hover actions</span>
    </div>
  </div>
  <Empty v-if="empty" class="h-full">…</Empty>
</div>
```

| Element | Spec | Why |
|---|---|---|
| Container | Beside a main area: framed pane `flex min-h-0 flex-col overflow-hidden rounded-kira border border-border bg-bg` on `bg-chrome`, panes `gap-0.5`, outer `px-1.5 pb-0.5` (the `WorkbenchShell` geometry). `AdeReviewWindow` adopts it; shell, `AdePanel`, backlog aside already match. In a dialog: nav column `w-44 shrink-0 border-r border-border px-1 py-1.5 flex flex-col gap-px` (SettingsShell); `ReposDialog` `w-52` → `w-44` | 3 of 4 panes already framed; SettingsShell nav already landed at `w-44` |
| Panel root | `flex h-full min-h-0 flex-col`; header, bars `shrink-0`; one body `min-h-0 flex-1` | the 6 module panels' own root, minus drift |
| Header | `PanelHeader` on every module left panel, title = the panel's noun (Connections, Collections, Automations, Docker, Memory); `GitPanel` has no title: its view tabs go in the new `#start` slot (normal case, not uppercase). Detail side panes keep §2.2's head block | 5 hand-rolled copies of the exact `PanelHeader` string |
| Header actions | `TooltipIconButton` (toolbar `kira-icon`, 13) in `#actions`, order: search toggle (when the panel has one), create, other actions, refresh last; a toggled button passes `pressed` (new prop: `aria-pressed` + `bg-field text-fg`) | search first matches all 4 panels that have one; one toggled-state mechanism instead of 2 |
| Sub-bars | new `PanelBar` (workbench): `flex shrink-0 flex-col gap-1 border-b border-border px-1.5 py-1`, default slot. One per concern under the header, in order: search (`SearchField` `kira`), view tabs (`SecondaryTabs`, counts via `item.count`), filter row (`flex items-center gap-1.5`, a horizontal `Field` with Checkbox + `FieldLabel`, summary `ml-auto text-kira-sm text-muted-foreground`) | the search row string already ×5; replaces 3 wrappers and 2 tab-row paddings |
| Search | toggled from the header with type-to-search (`usePanelHeaderSearch`, testid `tree-search`) on every tree/list panel; `MemoryPanel` keeps it always visible (search is its main function), `RepoSearchView` keeps its own query toolbar but as a `PanelBar` | same behaviour already in 4 panels; only the chrome unifies |
| Section heading | `SectionHeading` (`h-control-sm px-1.5 text-kira-sm text-subtle uppercase tracking-wider`); new props `collapsible`, `expanded`, `count` and emit `toggle`: collapsible renders a full-width button with a 12px chevron before the label, `count` renders trailing `text-kira-sm tabular-nums` | the §2.6 heading, so panels and pickers read alike; replaces 3 hand-rolled headings |
| Row | theme `rowVariants` (new, moved up from git-ui) `layout: 'tree'`: `relative flex items-center gap-1 min-h-row pr-1.5 text-kira-md whitespace-nowrap select-none cursor-default outline-none focus-visible:focus-ring`; height `h-row` (28px comfortable, 22px compact) through the virtualizer or `min-h-row` | 8 of the single-line rows already `h-row`; follows Appearance density |
| Two-line row | `layout: 'double'`: same, `items-start py-1`, second line `text-kira-sm text-muted-foreground truncate`; virtualized height `useRowHeight().double` = single + 16 (44 / 38px) | Docker containers, Automations scripts and Memory facts need a second line; 44px is Docker's height today |
| Indent | `rowIndent(depth)` = `paddingLeft` `6 + depth × 14` px; a tree row always renders the `TreeTwisty` slot (invisible on leaves), a flat list row none; children of a twisty row (Git worktrees, Automations group scripts) are `depth + 1` | depth 0 lines up with `PanelHeader`/`SectionHeading` `px-1.5`; one scheme instead of 2 |
| Chevron | `TreeTwisty` (unchanged: `size-3.5` slot, 13px chevron, `text-muted-foreground`) on every expandable row; never a hand-rolled chevron | already shared by 5 consumers |
| Icon | 13px glyph in a `size-4 flex items-center justify-center shrink-0` box, `text-muted-foreground` (status/kind colour where the icon carries meaning); 12px only in 18px chips; rail `colorMarkClass('rail', …)` first child where a colour exists (P16) | §2.1 icon rule; `TreeRow`'s box |
| Label / meta | label `min-w-0 truncate`; meta (counts, sizes, branch, ports) `ml-auto shrink-0 text-kira-sm text-muted-foreground tabular-nums` | §2.6 row rule |
| Hover / selected / muted | hover `bg-hover`; selected (the item the main area shows) `bg-select text-fg`, from `selected: true`; `muted: true` → `text-muted-foreground` for closed/stopped/historical items (no `opacity-*`); `danger`, `disabled` as git-ui's variants; no `border-l` bars | 16 `bg-select` sites already; P260 dropped the blue selected bar |
| Data font | `data: true` → `text-graph-md` for git rows (Settings > Git graph font reaches them, P229) | keeps P229's rule, now a variant |
| Counts | a count of rows inside a group/section/tab is plain meta (`text-kira-sm text-muted-foreground tabular-nums`); `Badge variant="count"` only for an attention count (needs you, unread); `Badge` tones stay for row status (Memory author/historical) | plain counts are the majority; pills on every row read as noise |
| Inline actions | row `group/row`; trailing `ml-auto flex items-center gap-0.5`; `TooltipIconButton` actions `invisible group-hover/row:visible group-focus-within/row:visible` (always visible on the selected row); meta in the same slot `group-hover/row:hidden` | Docker `ContainerList` already swaps meta for actions; `invisible` keeps row width stable |
| Empty | `Empty class="h-full"` per §2.6 (`EmptyMedia` default, 24px icon, `EmptyTitle`, `EmptyDescription`, optional action `dialog kira-lg` in `EmptyContent`); in-list empty/loading/error line `px-1.5 py-1 text-kira-sm text-subtle` (error `text-error`); no `.side-empty`, no padding override, no `Alert`-as-empty | the §2.6 rule; replaces 3 mechanisms |
| Scroll | native `overflow-y-auto` on the one body element, or the virtualizer's scroller; no `ScrollArea` | `@tanstack/vue-virtual` and the sticky band need a native scroll element; 0 uses today |
| Row height source | `useRowHeight()` (new, workbench) reads `--kira-row-height` via VueUse `useCssVar` (set by `createSettingsStore`) → `{ single, double }`; every side-panel virtualizer uses it, never the density formula or a fixed 28 | 4 copies of the formula plus Docker's fixed 28/44 that ignores density |
| Resize handle | shell `ResizableHandle` look everywhere: 2px (`w-0.5`), transparent, `bg-focus` on hover/drag, hit area 4px fine / 8px coarse. `AdePanelResizeHandle` keeps its pointer/px/persist mechanics but renders that look (no grip, no `border-l`, no `bg-chrome`) | one divider look; swapping its mechanics to reka would change width persistence (§5.1) |
| Width bounds | left list panes 180-480px, default 260 (shell, `defaultLayout`); `AdeReviewWindow` left 220-560/320 → 180-480/260. Right detail panes keep content-driven bounds (`AdePanel` 340 to row minus plan; review agent 280-720) | lists share one range; detail panes size to their content |
| Detail side panes | `AdePanelFrame`, `AdeBacklogPanel`, `AdeReviewAgentPanel` follow §2.2's side-panel row (`PanelHeader` or head block `flex flex-col gap-1.5 border-b border-border px-3 py-2`, `SecondaryTabs` in a `px-3` row, content `p-3 gap-3`), title `text-kira-lg font-medium` (no `font-bold`), lists inside them use the rows above | §2.2 already decided it; this names the files |

Not in scope here (P263): tables/grids, menus, tooltips, scrollbar styling, badge/pill colours,
focus-ring and disabled tokens.

## 3. Foundation (step 1, sequential, lands before streams)

Owner of every file below for the whole phase; streams never edit them (findings go to the
stream's findings file, fixed in close-out).

| File | Change |
|---|---|
| `packages/theme/src/components/ui/dialog/index.ts` | `dialogContentSizeVariants` cva (`size`: sm/md/lg/xl/2xl, `fixedHeight`); export `DialogBody`; export `dialogHeaderClass`, `dialogBodyClass`, `dialogFooterClass` strings |
| `.../dialog/DialogContent.vue` | props `size?`, `fixedHeight?`; with `size` set: sized classes, no absolute close; without: legacy path unchanged (removed in close-out) |
| `.../dialog/DialogHeader.vue` | props `icon?: string`, `closable?: boolean` (default false until close-out flips it to true), `closeTestid?: string` |
| `.../dialog/DialogBody.vue` (new) | `<script setup lang="ts">`, props `flush?: boolean`, `class?` |
| `.../dialog/DialogFooter.vue` | base `justify-end gap-1.5`; `#start` slot |
| `packages/theme/src/components/ui/input/index.ts` | radius `rounded-kira-sm`, fill `bg-field border-border-strong` (drop `dark:bg-border-strong/30`), `defaultVariants.size: 'kira-lg'`; `default` size kept until close-out |
| `.../textarea/Textarea.vue` | `rounded-kira-sm bg-field px-2 py-1.5` |
| `.../native-select/index.ts` | `defaultVariants.size: 'kira-lg'` |
| `.../input-group/index.ts` | add `kira-lg` variant (`kira` with `h-control-lg`); default variant → `kira-lg` |
| `.../field/FieldGroup.vue` | `gap-3` |
| `packages/theme/src/components/SecondaryTabs.vue` (new) | props `modelValue: string`, `items: readonly { value: string; label: string; icon?: string; count?: number \| string; disabled?: boolean; testid?: string; tooltip?: string }[]`, `variant?: 'tabs' \| 'segmented'` (default tabs), `size?: 'kira' \| 'kira-lg'` (default kira), `ariaLabel?: string`; emits `update:modelValue` (non-empty only); slot `item` (`{ item, active }`) for custom content; root `data-slot="secondary-tabs"`; `$attrs` to root (testid). Built on `ToggleGroup`/`ToggleGroupItem` |
| `packages/theme/src/components/SearchField.vue` (new) | per §2.5 row; props `modelValue`, `placeholder` (default `Search`), `ariaLabel`, `size` (`kira` default), `autofocus`; emits `update:modelValue`; exposes `focus()` |
| `packages/theme/src/components/SectionHeading.vue` (new) | props `label: string`; default slot trailing |
| `packages/workbench/src/components/ConfirmDialog.vue`, `UpdateDialog.vue`, `SettingsShell.vue`, `prompt/TextPromptDialog.vue`, `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue`, `apps/kira-space/frontend/src/workbench/SettingsDialog.vue` | reference migrations to §2.2/§2.3 (SettingsShell `size="xl" fixed-height`, nav per §2.3, width/height props removed from both SettingsDialog callers) |
| `packages/workbench/src/components/PanelHeader.vue`, `ViewToolbar.vue` | frozen (no change expected); foundation-owned so neither stream edits them |
| `scripts/check-ui-primitives.sh` (new) + `package.json` `lint` | guards below, run after `check-theme-classes.sh` |
| `scripts/ui-primitives-allowlist/stream-a.txt`, `stream-b.txt` (new) | every file failing a guard at foundation tip, split by §4 ownership |
| baselines | re-record every Studio and Space `visual` PNG the base changes move (inputs 32→26px, radius, fill, footer alignment, FieldGroup gap, Settings) |
| `docs/ARCHITECTURE.md` "UI architecture" | one paragraph: the §2 element rules and the guard (close-out finalises) |

No unit tests: `SecondaryTabs`, `DialogBody`, `SectionHeading` are thin wrappers (CLAUDE.md test
bar). Coverage: existing UI specs (`docker-module`, `settings-*`, `http-request*`, `repo-*`) and
the visual project exercise the new parts through the reference migrations.

Guards (`check-ui-primitives.sh`, GNU grep `-P` like `check-theme-classes.sh`; scan
`apps/kira-studio/frontend/src`, `apps/kira-space/frontend/src`, `apps/kira-space/frontend/mobile`,
`packages/{workbench,git-ui,docker-ui,kira-ui}/src`; never `packages/theme/src/components/ui`):

- U1 `<DialogContent` without `size=`.
- U2 `<DialogContent` class containing `w-`, `h-`, `max-w-`, `max-h-`, `min-w-`, `p-`, `gap-`.
- U3 `role="dialog"` outside `TextPromptDialog.vue`.
- U4 `<ToggleGroup` / `<ToggleGroupItem` outside `SecondaryTabs.vue`.
- U5 `<TabsList` / `<TabsTrigger` outside `AdeShell.vue`.
- U6 `tabChipVariants(` outside `TabStrip.vue`, `ModeSwitcher.vue`, `AdeShell.vue`,
  `ConsoleView.vue`, `ExecView.vue`, `AdeSessionStrip.vue`.
- U7 `<Button` with no `variant=`/`:variant=`, or `variant="(default|secondary|outline|destructive)"`.
- U8 `<Button` with no `size=`/`:size=`, or `size="(default|xs|sm|lg|icon|icon-xs|icon-lg)"`;
  `icon-sm` only inside a `DialogHeader` block (checked by file: `icon-sm` outside theme only via
  `DialogHeader closable`, so any literal `size="icon-sm"` fails).
- U9 `<(Input|NativeSelect|Textarea|InputGroup)\b` with `size="default"` or a class token
  `h-*`, `rounded-*`, `bg-*`, `border-*`, `px-*`, `py-*`.
- U10 raw `<label\b` and raw `<select\b`.
- U11 `font-bold` anywhere; `font-semibold` outside `PanelHeader.vue` (data exemption
  `LogsView.vue`).
- U12 `CodiconIcon` `:size="N"` with N not in {12, 13, 16, 24}.
- U13 the hand-rolled panel-header string `h-bar gap-1 px-1.5 border-b border-border text-kira-sm`
  and `h-bar shrink-0 flex items-center gap-1 px-2 border-b` (use `PanelHeader` / `ViewToolbar`).
- U14 `EmptyMedia variant="icon"`; `<Alert` with `bg-transparent`.
- U15 `PopoverContent` class width outside {`w-56`, `w-80`, `w-96`, `w-120`, `w-auto`}.
- U16 `<DialogClose` wrapping a `size="icon-sm"` Button (header close is `closable`).
- U17 an `<Input|InputGroupInput|input` with a `placeholder` containing Search/Filter/Find, or an `InputGroupAddon` holding `CodiconIcon name="search"`, outside `SearchField.vue`.

Allowlist format, one per line: `path` (whole file exempt while unmigrated) or
`permanent U<n> path # reason` (a real requirement, e.g. a raw `<input>` grid cell editor). A
stream edits only its own list. Foundation commits lists that make `bun run lint` green at its
tip.

Foundation commits (Conventional Commits, each hook-green): (1) dialog parts + DialogBody;
(2) input/select/textarea/input-group/field bases; (3) SecondaryTabs + SectionHeading;
(4) shared dialog/settings reference migrations; (5) guard + allowlists + lint wiring;
(6) baselines. Verify: `bun run typecheck`, `bun run lint`, `bun run test:unit`,
`bun run test:ui:studio`, `bun run test:ui:space`, `bun run test:visual:studio`,
`bun run test:visual:space` (update, inspect each diff is a §2 base change, re-run clean).

### 3.1 Foundation addendum: side panels (step 2, sequential, before the streams branch)

One Sonnet implementer on `v2.0` (main checkout), after "Foundation result", before §4.4 creates
any worktree. Small: primitives, one reference migration, guards; no stream-owned file is edited.
Owner of every file below for the rest of the phase, same rule as §3 (streams never edit them;
findings go to the stream findings file).

| File | Change |
|---|---|
| `packages/theme/src/components/rowVariants.ts` (new) | `rowVariants` cva per §2.7: layouts `menu` (git-ui's string unchanged), `tree`, `double`, `nav` (`h-control-lg px-2 rounded-kira-sm text-kira-md`, selected `bg-select text-fg`, else `text-muted-foreground hover:bg-hover`: SettingsShell's current string, byte-equal), variants `selected`, `muted`, `disabled`, `danger`, `data`; `rowIndent(depth: number)` returning `{ paddingLeft: '<6 + depth × 14>px' }`; exported `RowVariants` type |
| `packages/workbench/src/util/rowHeight.ts` (new) | `useRowHeight()`: `useCssVar('--kira-row-height', document.documentElement, { observe: true })` parsed to px → computed `{ single, double: single + 16 }`; falls back to 28 when unset (tests) |
| `packages/workbench/src/components/PanelBar.vue` (new) | `<script setup lang="ts">`, props `class?`; root `data-slot="panel-bar"`, classes per §2.7, default slot |
| `packages/workbench/src/components/PanelHeader.vue` | `#start` slot before the title (`flex items-center gap-1 normal-case tracking-normal`); title span rendered only when the default slot has content; existing output byte-equal when `#start` is unused |
| `packages/theme/src/components/SectionHeading.vue` | props `collapsible?`, `expanded?`, `count?: number \| string`; emit `toggle`; collapsible root is a `button type="button"` (`w-full cursor-default`, `aria-expanded`), chevron `CodiconIcon` 12 (`chevron-down`/`chevron-right`); static output byte-equal |
| `packages/theme/src/components/TooltipIconButton.vue` | prop `pressed?: boolean` → `aria-pressed` and `bg-field text-fg` |
| `packages/workbench/src/components/SettingsShell.vue` | reference migration: nav items `rowVariants({ layout: 'nav', selected })`; no pixel change |
| `packages/workbench/src/components/TreeTwisty.vue`, `WorkbenchShell.vue` | frozen (no change expected); move to foundation ownership (`TreeTwisty` leaves A6) |
| `scripts/ui-primitives-side-panels.txt` (new) | the 45 §1.6 paths, one per line (foundation-owned; close-out folds it into the script) |
| `scripts/check-ui-primitives.sh` | guard kind `s` (`.vue` + `.ts`, only paths in the side-panel list); guards U18-U21 below |
| `scripts/ui-primitives-allowlist/stream-a.txt`, `stream-b.txt` | add every side-panel file that newly fails at addendum tip, by §4.1 ownership; foundation-owned ones must pass |
| `docs/ARCHITECTURE.md` "UI architecture" | one sentence: side panels use `PanelHeader`, `PanelBar`, `SectionHeading`, `rowVariants`/`rowIndent`, `useRowHeight` |

Guards (kind `s`, side-panel files only, so P263's grids and lists stay untouched):

- U18 hand-rolled row state: `(?<![\w-])(?:hover:)?bg-(?:select|hover)(?![\w-])` (use
  `rowVariants`).
- U19 hand-rolled indent or row height: `depth\s*\*\s*\d+`, `rowDensity\s*===`,
  `(?:ROW_HEIGHT|rowHeight)\s*[:=]\s*\d+`, `(?<![\w-])(?:h-5\.5|min-h-9)(?![\w-])` (use `rowIndent`,
  `useRowHeight`, `rowVariants`).
- U20 hand-rolled panel chrome: `side-empty`; `<Empty\b` with a `p-`/`px-`/`py-` class; the search
  row string `shrink-0 border-b border-border px-1.5 py-1` (use `Empty class="h-full"`, `PanelBar`).
- U21 hand-rolled heading: `(?<![\w-])uppercase(?![\w-])` outside `PanelHeader.vue` (built-in
  exempt; use `PanelHeader`/`SectionHeading`).

No unit tests: `rowVariants`, `PanelBar`, `useRowHeight`, the new props are thin (CLAUDE.md test
bar). Coverage: `settings-*` UI specs and the Settings visual baselines through the SettingsShell
migration; streams exercise the rest per chunk.

Commits (each hook-green): (1) `rowVariants` + `rowIndent` + `useRowHeight` + `PanelBar`;
(2) `PanelHeader` `#start`, `SectionHeading` collapsible/count, `TooltipIconButton` `pressed`,
SettingsShell nav migration; (3) side-panel list + guards U18-U21 + allowlists + ARCHITECTURE
sentence; (4) plan "Addendum result" section (what landed, allowlist counts, deviations).
Verify: `bun run typecheck`, `bun run lint`, `bun run test:unit`, both apps' `settings-*` UI specs
(§4.3 per-chunk command), `bun run test:visual:studio` and `test:visual:space` clean without update (the addendum moves no pixel;
a moved PNG is a bug to fix here, not to re-record).

## 4. Streams (step 3)

Two named streams, worktrees off the **addendum tip** (§3.1; same base commit for both):
`/home/user/kira-p262-a` on branch `p262-a`, `/home/user/kira-p262-b` on branch `p262-b`.
One Sonnet implementer per stream, chunk after chunk in the order below, one commit per chunk
(more if a chunk splits into logical groups), each hook-green. Each chunk also removes its files
from the stream's allowlist (or turns a line into `permanent ...` with a reason).

Per site the implementer applies §2 exactly: dialog parts and size from the §2.2 table, tabs from
the §2.3 classification, buttons §2.4, fields/inputs §2.5, bars/sections/rows/menus/empty §2.6,
typography/icons §2.1, side panels §2.7 (every file in `scripts/ui-primitives-side-panels.txt`). Files in a chunk whose only hits are already compliant need no edit.
Discovery inside a file (what a component renders, its callers) uses `codegraph_explore` first.

### 4.1 Ownership (zero overlap)

| Stream | Owns | Files to touch | Dialog sites | Tab sites | Form-control tags |
|---|---|---|---|---|---|
| Foundation (done before) | §3 and §3.1 tables | 18 source + guard files; addendum 14 | 3 + prompt | 1 (settings nav) | 1 |
| A: Kira Studio + Docker + shared workbench modules | `apps/kira-studio/frontend/src/**`, `packages/docker-ui/src/**`, `packages/workbench/src/**` (minus foundation files), `apps/kira-studio/tests/**` (ui, visual specs and PNGs), Space specs `apps/kira-space/tests/ui/{automations-*,memory-*,settings-memory}.spec.ts`, Space PNG `apps/kira-space/tests/visual/settings.spec.ts-snapshots/settings-memory-visual-linux.png`, `scripts/ui-primitives-allowlist/stream-a.txt`, `docs/v2.2/plans/P262-stream-a-findings.md` | 164 | 20 | 30 | 149 |
| B: Kira Space + mobile + git module | `apps/kira-space/frontend/src/**` and `apps/kira-space/frontend/mobile/**` (minus foundation files), `packages/git-ui/src/**`, `apps/kira-space/tests/**` except the A-owned files above, `scripts/ui-primitives-allowlist/stream-b.txt`, `docs/v2.2/plans/P262-stream-b-findings.md` | 153 | 23 | 18 | 88 |

Weighted by element hits A 1258, B 990; B carries most weight fixes (ADE 79 of 116
semibold/bold), so the effort is even. `packages/theme/**`, `scripts/check-ui-primitives.sh`,
`package.json`, `docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md` belong to foundation/close-out only.

**No ordering dependency between streams**: both consume only foundation primitives; no file,
spec, PNG or allowlist is shared; Studio never renders git-ui or Space code; the one Space
surface rendering A's code (Settings > Memory) has its PNG and spec in A. Any needed change in
the other stream's or foundation's files goes to the stream findings file and is fixed in
close-out.

#### Search sites (U17, migrate to `SearchField` inside the named chunk; no chunk grew past 25 files)

Stream A: A1 `S/project/ConnectionDialog.vue`, `S/project/FiltersDialog.vue`; A2 `S/api/CollectionsPanel.vue`, `S/api/DynamicValuesDialog.vue`, `S/api/EnvironmentsView.vue`, `S/api/VariableSetView.vue`, `S/api/VariablesOverviewPanel.vue`, `S/workbench/panels/ProjectPanel.vue`; A3 `S/views/grpcrequest/{CallHistoryList,GrpcRequestView,SchemaBrowser}.vue`, `S/views/httprequest/{CookiesPane,HttpRequestView,ResponseHistoryList,ResponsePane}.vue`; A4 `S/views/browse/BrowseView.vue`, `S/views/definition/DefinitionView.vue`; A5 `S/views/shared/ResponseFindBar.vue`, `S/views/shared/page/SearchToolbar.vue`, `S/views/stream/StreamSearchToolbar.vue`; A6 `p/workbench/src/components/OpLogPanel.vue`; A7 `p/docker-ui/src/components/{DockerPanel,LogsView}.vue`; A8 `p/workbench/src/automations/AutomationsPanel.vue`; A9 `p/workbench/src/memory/MemoryPanel.vue`.

Stream B: B2 `p/git-ui/src/components/{BranchPicker,FileTree}.vue`, `p/git-ui/src/components/review/{BaseSelector,ReviewView}.vue`; B3 `p/git-ui/src/components/SearchBox.vue`; B4 `K/repo/GitPanel.vue`, `K/repo/RepoSearchView.vue`; B5 `K/ade/v2/AdeAddPopover.vue`. Foundation owns no search site.

#### Side-panel sites (§2.7, U18-U21; migrate inside the named chunk; no chunk past 25 files)

Stream A (15): A1 `S/project/{ProjectTree,TreeRow}.vue`; A2 `S/workbench/panels/ProjectPanel.vue`,
`S/api/{CollectionsPanel,CollectionsTree,CollectionRow}.vue` (`CollectionsTree` added to A2); A7
`p/docker-ui/src/components/{DockerPanel,ContainerList,ImageList,VolumeList,NetworkList,ListState}.vue`;
A8 `p/workbench/src/automations/AutomationsPanel.vue`; A9 `p/workbench/src/memory/MemoryPanel.vue`;
A10 `p/docker-ui/src/components/VirtualList.vue` (new chunk, A7 is full). Plus `S/docker/DockerPanel.vue`
(no markup, no edit).

Stream B (26): B2 `p/git-ui/src/components/review/{ReviewView,ReviewCommitRow,ReviewFilesPane,ReviewCommentsPane}.vue`,
`p/git-ui/src/components/FileTree.vue` (`ReviewCommitRow` added to B2); B3 switches the last git-ui
`rowVariants` callers to the theme one and deletes `p/git-ui/src/lib/rowVariants.ts` (added to B3;
B2's callers switch first); B4 `K/repo/{GitPanel,RepoFileTree,RepoTreeRow,RepoSearchView,RepoSearchRow,RepoReviewView,ReposDialog}.vue`
(`RepoFileTree`, `RepoTreeRow`, `RepoSearchRow` added to B4); B6
`K/ade/v2/panel/{AdePanel,AdePanelFrame,AdePanelResizeHandle,AdeTaskPanel,AdeBranchPanel,AdeArchivedPanel}.vue`
(`AdePanel`, `AdePanelResizeHandle` added to B6); B8
`K/ade/v2/review/{AdeReviewWindow,AdeReviewFiles,AdeReviewAgentPanel}.vue`,
`K/ade/v2/backlog/{AdeBacklogPage,AdeBacklogPanel,AdeBacklogRow}.vue`,
`K/ade/v2/sessions/{AdeStoppedList,AdeStoppedRow}.vue` (`AdeReviewWindow`, `AdeStoppedList` added to B8).

Foundation (4): `p/workbench/src/components/{WorkbenchShell,PanelHeader,TreeTwisty,SettingsShell}.vue`
(`TreeTwisty` leaves A6).

A side-panel file that the addendum finds failing but is not named above is a plan gap: the
addendum implementer appends it to the owning stream's chunk with the nearest directory (A10/B10
when none fits) in this section, in the same commit as the allowlist.

Spec rules: testids never change (exception: none planned); a spec changes only for a
documented §2 effect (`data-state` `active`/`inactive` → `on`/`off` in `docker-edit.spec.ts:169-170`; a height or
position assertion). Baselines: a stream re-records only its own PNGs, after its last chunk.

### 4.2 Chunks

Paths: `S/` = `apps/kira-studio/frontend/src/`, `K/` = `apps/kira-space/frontend/src/`,
`M/` = `apps/kira-space/frontend/mobile/`, `p/` = `packages/`. Counts are files and element hits
(dialog parts, tabs, toggles, inputs, buttons, raw controls, weights, empty, popovers, fields,
uppercase, h-bar, alerts, badges).

Stream A order: A1 Studio dialogs, A2 API module, A3 HTTP/gRPC views, A4 data views, A5 shared
views, A6 settings + workbench chrome, A7 Docker, A8 Automations, A9 Memory, A10 side-panel sweep. Stream B order:
B1 git dialogs, B2-B3 git module, B4 Space repo/workbench/settings, B5 ADE dialogs + workflows,
B6 ADE panel/shell, B7 ADE plan/needs, B8 ADE rest, B9 mobile, B10 side-panel sweep.

Stream A chunks:

#### A1 (13 files, 219 element hits + side panels)
`S/project/ConnectionDialog.vue`, `S/project/CredentialsUpdateDialog.vue`, `S/project/DataGripImportDialog.vue`, `S/project/ErrorPopover.vue`, `S/project/FiltersDialog.vue`, `S/project/ProjectTree.vue`, `S/project/SchemaDialog.vue`, `S/project/TreeRow.vue`, `S/project/credentialPaste/CredentialPastePanel.vue`, `S/views/httprequest/ResponseDiffDialog.vue`, `S/workbench/DbMcpApprovalDialog.vue`, `S/workbench/GenerateDataDialog.vue`, `S/workbench/UploadObjectDialog.vue`

#### A2 (21 files, 145 element hits + side panels)
`S/api/ApiStart.vue`, `S/api/BulkVariablesEditor.vue`, `S/api/CollectionRow.vue`, `S/api/CollectionsPanel.vue`, `S/api/CollectionsTree.vue`, `S/api/CopyAsCurlDialog.vue`, `S/api/DynamicValuesDialog.vue`, `S/api/EditRawRequestDialog.vue`, `S/api/EnvironmentSelect.vue`, `S/api/EnvironmentsView.vue`, `S/api/ImportCurlDialog.vue`, `S/api/ImportReportStrip.vue`, `S/api/MethodSelect.vue`, `S/api/SaveRequestDialog.vue`, `S/api/VariableHistoryMenu.vue`, `S/api/VariableRow.vue`, `S/api/VariableSetView.vue`, `S/api/VariablesOverviewPanel.vue`, `S/editor/MonacoHost.vue`, `S/workbench/panels/ProjectPanel.vue`, `S/workbench/panels/StudioStart.vue`

#### A3 (14 files, 161 element hits)
`S/views/grpcrequest/CallHistoryList.vue`, `S/views/grpcrequest/GrpcRequestView.vue`, `S/views/grpcrequest/ResponsePane.vue`, `S/views/grpcrequest/SchemaBrowser.vue`, `S/views/httprequest/BinaryBodyPicker.vue`, `S/views/httprequest/CookiesPane.vue`, `S/views/httprequest/FormDataTable.vue`, `S/views/httprequest/HttpRequestView.vue`, `S/views/httprequest/RawExchangePane.vue`, `S/views/httprequest/RequestBodyPane.vue`, `S/views/httprequest/RequestSettingsPane.vue`, `S/views/httprequest/ResponseHistoryList.vue`, `S/views/httprequest/ResponsePane.vue`, `S/views/httprequest/TimelinePane.vue`

#### A4 (21 files, 120 element hits)
`S/views/browse/BrowseView.vue`, `S/views/console/ConsoleResultGrid.vue`, `S/views/console/ConsoleSavedMenu.vue`, `S/views/console/ConsoleView.vue`, `S/views/console/ExplainResultView.vue`, `S/views/definition/ColumnsSection.vue`, `S/views/definition/ConstraintsSection.vue`, `S/views/definition/DefinitionView.vue`, `S/views/definition/IndexesSection.vue`, `S/views/definition/PropertiesSection.vue`, `S/views/definition/ValidationSection.vue`, `S/views/documents/DocumentView.vue`, `S/views/documents/ProjectionMenu.vue`, `S/views/documents/RowActionButton.vue`, `S/views/grid/ColumnsMenu.vue`, `S/views/grid/DataToolbar.vue`, `S/views/grid/DataView.vue`, `S/views/grid/FilterToolbar.vue`, `S/views/grid/FkPreviewPopover.vue`, `S/views/grid/PreviewCommandPanel.vue`, `S/views/grid/SlickGridHost.vue`

#### A5 (16 files, 118 element hits)
`S/views/shared/DateTimePicker.vue`, `S/views/shared/EditBufferActions.vue`, `S/views/shared/FilterHistoryMenu.vue`, `S/views/shared/ResponseFindBar.vue`, `S/views/shared/SavedListMenu.vue`, `S/views/shared/celleditor/CellEditorView.vue`, `S/views/shared/celleditor/TimestampPane.vue`, `S/views/shared/document/DocumentRow.vue`, `S/views/shared/document/DocumentTree.vue`, `S/views/shared/fields/FieldRowsTable.vue`, `S/views/shared/keyvalue/KeyValuePane.vue`, `S/views/shared/page/PagerControls.vue`, `S/views/shared/page/SearchToolbar.vue`, `S/views/stream/StreamComposeMessage.vue`, `S/views/stream/StreamSearchToolbar.vue`, `S/views/stream/StreamView.vue`

#### A6 (24 files, 128 element hits; `TreeTwisty` moved to foundation)
`S/workbench/settings/AdvancedPane.vue`, `S/workbench/settings/ApiPane.vue`, `S/workbench/settings/AppearancePane.vue`, `S/workbench/settings/CachePane.vue`, `S/workbench/settings/DataPane.vue`, `S/workbench/settings/DatabaseMcpPane.vue`, `p/workbench/src/components/AutocompleteField.vue`, `p/workbench/src/components/BootFailure.vue`, `p/workbench/src/components/ContextMenu.vue`, `p/workbench/src/components/InlineRenameInput.vue`, `p/workbench/src/components/ModeSwitcher.vue`, `p/workbench/src/components/OpLogPanel.vue`, `p/workbench/src/components/TabStrip.vue`, `p/workbench/src/components/TabStripNewButton.vue`, `p/workbench/src/components/TitleBar.vue`, `p/workbench/src/components/TitleBarWindowActions.vue`, `p/workbench/src/components/UpdateAvailableItem.vue`, `p/workbench/src/memory/settings/ClaudeCodeMcpSection.vue`, `p/workbench/src/memory/settings/SemanticModelSection.vue`, `p/workbench/src/settings/fields/FontSizeField.vue`, `p/workbench/src/settings/fields/LogLevelField.vue`, `p/workbench/src/settings/fields/NotifyPromptsField.vue`, `p/workbench/src/settings/fields/RowDensityField.vue`, `p/workbench/src/settings/fields/WordWrapField.vue`

#### A7 (25 files, 129 element hits + side panels)
`p/docker-ui/src/components/ContainerDetail.vue`, `p/docker-ui/src/components/ContainerEditView.vue`, `p/docker-ui/src/components/ContainerList.vue`, `p/docker-ui/src/components/ContainerSizeSection.vue`, `p/docker-ui/src/components/ContainerTable.vue`, `p/docker-ui/src/components/DetailSection.vue`, `p/docker-ui/src/components/DockerPanel.vue`, `p/docker-ui/src/components/EditInPlaceSection.vue`, `p/docker-ui/src/components/EditPendingSummary.vue`, `p/docker-ui/src/components/EditRecreateSection.vue`, `p/docker-ui/src/components/EditRows.vue`, `p/docker-ui/src/components/EditSize.vue`, `p/docker-ui/src/components/EndpointChip.vue`, `p/docker-ui/src/components/EngineDiskSection.vue`, `p/docker-ui/src/components/EngineOverview.vue`, `p/docker-ui/src/components/ExecView.vue`, `p/docker-ui/src/components/ImageList.vue`, `p/docker-ui/src/components/ListState.vue`, `p/docker-ui/src/components/LogsView.vue`, `p/docker-ui/src/components/NetworkList.vue`, `p/docker-ui/src/components/RecreateConfirmDialog.vue`, `p/docker-ui/src/components/ResourceDetail.vue`, `p/docker-ui/src/components/StatsView.vue`, `p/docker-ui/src/components/UnavailableState.vue`, `p/docker-ui/src/components/VolumeList.vue`

#### A8 (19 files, 171 element hits + side panel)
`p/workbench/src/automations/AutomationsPanel.vue`, `p/workbench/src/automations/AutomationsStart.vue`, `p/workbench/src/automations/ParamsEditor.vue`, `p/workbench/src/automations/ScriptBodyField.vue`, `p/workbench/src/automations/ScriptDialog.vue`, `p/workbench/src/automations/run/AdeContextFields.vue`, `p/workbench/src/automations/run/ParamsForm.vue`, `p/workbench/src/automations/run/RunScriptDialog.vue`, `p/workbench/src/automations/runs/RunOutcomeBlock.vue`, `p/workbench/src/automations/runs/RunStatusBadge.vue`, `p/workbench/src/automations/runs/RunsSection.vue`, `p/workbench/src/automations/runs/RunsStatusItem.vue`, `p/workbench/src/automations/runs/ScriptRunView.vue`, `p/workbench/src/automations/schedule/ScheduleConfirmDialog.vue`, `p/workbench/src/automations/schedule/ScheduleFields.vue`, `p/workbench/src/automations/smart/McpServerTools.vue`, `p/workbench/src/automations/smart/McpToolsField.vue`, `p/workbench/src/automations/smart/SmartSettingsFields.vue`, `p/workbench/src/automations/smart/ToolsField.vue`

#### A9 (10 files, 67 element hits + side panel)
`p/workbench/src/memory/AddMemoryDialog.vue`, `p/workbench/src/memory/MemoryPanel.vue`, `p/workbench/src/memory/MemorySetupHint.vue`, `p/workbench/src/memory/MemoryStart.vue`, `p/workbench/src/memory/import/ImportConfirmDialog.vue`, `p/workbench/src/memory/import/ImportFileRow.vue`, `p/workbench/src/memory/import/ImportJobDetail.vue`, `p/workbench/src/memory/import/ImportMenu.vue`, `p/workbench/src/memory/import/ImportStatus.vue`, `p/workbench/src/memory/import/ImportView.vue`

#### A10 (1 file + sweep, side panels)
`p/docker-ui/src/components/VirtualList.vue` (`useRowHeight`, no fixed 28). Then a sweep, no new
files: screenshot the Studio panels (Connections, Collections, Automations, Docker) side by side in
both densities and fix any §2.7 drift in A's side-panel files (one commit). Stream A's side-panel
files then pass U18-U21 with no allowlist line.


Stream B chunks:

#### B1 (17 files, 304 element hits)
`p/git-ui/src/components/PullStrategyPicker.vue`, `p/git-ui/src/components/WorktreeList.vue`, `p/git-ui/src/components/dialogs/BranchDialog.vue`, `p/git-ui/src/components/dialogs/CheckoutDialog.vue`, `p/git-ui/src/components/dialogs/CherryPickDialog.vue`, `p/git-ui/src/components/dialogs/ForcePushDialog.vue`, `p/git-ui/src/components/dialogs/PostCheckoutPullDialog.vue`, `p/git-ui/src/components/dialogs/PreflightPrediction.vue`, `p/git-ui/src/components/dialogs/PullDialog.vue`, `p/git-ui/src/components/dialogs/RenameRefDialog.vue`, `p/git-ui/src/components/dialogs/RepoSettingsDialog.vue`, `p/git-ui/src/components/dialogs/ResetDialog.vue`, `p/git-ui/src/components/dialogs/RevertDialog.vue`, `p/git-ui/src/components/dialogs/StackDialog.vue`, `p/git-ui/src/components/dialogs/StashDialog.vue`, `p/git-ui/src/components/dialogs/TagDialog.vue`, `p/git-ui/src/components/dialogs/WorktreeDialog.vue`

#### B2 (17 files, 83 element hits + side panels)
`p/git-ui/src/App.vue`, `p/git-ui/src/components/AppToolbar.vue`, `p/git-ui/src/components/BranchPicker.vue`, `p/git-ui/src/components/CommitGrid.vue`, `p/git-ui/src/components/CommitMeta.vue`, `p/git-ui/src/components/ConflictBanner.vue`, `p/git-ui/src/components/DetailPane.vue`, `p/git-ui/src/components/EmptyRepositoryPanel.vue`, `p/git-ui/src/components/FailureBanner.vue`, `p/git-ui/src/components/FileTree.vue`, `p/git-ui/src/components/GitBlockedPanel.vue`, `p/git-ui/src/components/GitViewHead.vue`, `p/git-ui/src/components/review/BaseSelector.vue`, `p/git-ui/src/components/review/ReviewCommentsPane.vue`, `p/git-ui/src/components/review/ReviewCommitRow.vue`, `p/git-ui/src/components/review/ReviewFilesPane.vue`, `p/git-ui/src/components/review/ReviewView.vue`

#### B3 (15 files, 33 element hits + `rowVariants` move)
`p/git-ui/src/components/LoadMoreButton.vue`, `p/git-ui/src/components/NoRepositoryPanel.vue`, `p/git-ui/src/components/RefSectionHeader.vue`, `p/git-ui/src/components/RefreshButton.vue`, `p/git-ui/src/components/RowContextMenu.vue`, `p/git-ui/src/components/SearchBox.vue`, `p/git-ui/src/components/SearchResults.vue`, `p/git-ui/src/components/ShowMoreButton.vue`, `p/git-ui/src/components/StackList.vue`, `p/git-ui/src/components/StashDetailPane.vue`, `p/git-ui/src/components/StashRows.vue`, `p/git-ui/src/components/TagList.vue`, `p/git-ui/src/components/UncommittedChangesStrip.vue`, `p/git-ui/src/components/UndoButton.vue`, `p/git-ui/src/lib/rowVariants.ts` (deleted once no caller imports it)

#### B4 (24 files, 160 element hits + side panels)
`K/repo/GitPanel.vue`, `K/repo/GitStart.vue`, `K/repo/RepoConfigForm.vue`, `K/repo/RepoEnvRow.vue`, `K/repo/RepoFileTree.vue`, `K/repo/RepoReviewView.vue`, `K/repo/RepoSearchRow.vue`, `K/repo/RepoSearchView.vue`, `K/repo/RepoTreeRow.vue`, `K/repo/ReposDialog.vue`, `K/views/repo/RepoDiffView.vue`, `K/views/repo/RepoFileView.vue`, `K/views/repo/RepoGraphView.vue`, `K/views/repo/RepoMultiDiffView.vue`, `K/views/repo/ReviewThread.vue`, `K/workbench/GitCredentialDialog.vue`, `K/workbench/PairingRequestDialog.vue`, `K/workbench/StatusBar.vue`, `K/workbench/settings/AdvancedPane.vue`, `K/workbench/settings/AppearancePane.vue`, `K/workbench/settings/ClaudeCodePane.vue`, `K/workbench/settings/DateFormatField.vue`, `K/workbench/settings/GitPane.vue`, `K/workbench/settings/MobileAccessPane.vue`

#### B5 (21 files, 158 element hits)
`K/ade/AdeView.vue`, `K/ade/v2/AdeActivityIcon.vue`, `K/ade/v2/AdeAddPopover.vue`, `K/ade/v2/AdeBasePicker.vue`, `K/ade/v2/AdeCandidateRow.vue`, `K/ade/v2/AdeChip.vue`, `K/ade/v2/AdeConfirmDialog.vue`, `K/ade/v2/AdeRepoTag.vue`, `K/ade/v2/dialog/AdeClaudeDialog.vue`, `K/ade/v2/run/AdeRunDialog.vue`, `K/ade/v2/run/AdeTaskActionButton.vue`, `K/ade/v2/workflows/AdeStageGroupNode.vue`, `K/ade/v2/workflows/AdeStageInspector.vue`, `K/ade/v2/workflows/AdeStepInspector.vue`, `K/ade/v2/workflows/AdeStepNode.vue`, `K/ade/v2/workflows/AdeStepResults.vue`, `K/ade/v2/workflows/AdeWorkflowEditor.vue`, `K/ade/v2/workflows/AdeWorkflowGraph.vue`, `K/ade/v2/workflows/AdeWorkflowSaveBar.vue`, `K/ade/v2/workflows/AdeWorkflowYaml.vue`, `K/ade/v2/workflows/AdeWorkflowsPage.vue`

#### B6 (18 files, 91 element hits + side panels)
`K/ade/v2/automation/AdeAutomationChip.vue`, `K/ade/v2/automation/AdeAutomationsBlock.vue`, `K/ade/v2/panel/AdeArchivedPanel.vue`, `K/ade/v2/panel/AdeBranchPanel.vue`, `K/ade/v2/panel/AdeEstimateField.vue`, `K/ade/v2/panel/AdeLinkRow.vue`, `K/ade/v2/panel/AdePanel.vue`, `K/ade/v2/panel/AdePanelFrame.vue`, `K/ade/v2/panel/AdePanelResizeHandle.vue`, `K/ade/v2/panel/AdeRunOutcome.vue`, `K/ade/v2/panel/AdeSetupProgress.vue`, `K/ade/v2/panel/AdeStageBlock.vue`, `K/ade/v2/panel/AdeStageMover.vue`, `K/ade/v2/panel/AdeTaskPanel.vue`, `K/ade/v2/panel/AdeTaskTab.vue`, `K/ade/v2/panel/AdeWorkflowBlock.vue`, `K/ade/v2/shell/AdeCaptureBox.vue`, `K/ade/v2/shell/AdeShell.vue`

#### B7 (14 files, 54 element hits)
`K/ade/v2/needs/AdeAllSessionRow.vue`, `K/ade/v2/needs/AdeAllSessions.vue`, `K/ade/v2/needs/AdeNeedsPage.vue`, `K/ade/v2/needs/AdeNeedsRow.vue`, `K/ade/v2/plan/AdeActionCell.vue`, `K/ade/v2/plan/AdeAttention.vue`, `K/ade/v2/plan/AdeBranchRow.vue`, `K/ade/v2/plan/AdeDayBand.vue`, `K/ade/v2/plan/AdeDayControls.vue`, `K/ade/v2/plan/AdeHistoryBar.vue`, `K/ade/v2/plan/AdePlanHeader.vue`, `K/ade/v2/plan/AdePlanView.vue`, `K/ade/v2/plan/AdeRepoChip.vue`, `K/ade/v2/plan/AdeTaskCard.vue`

#### B8 (15 files, 45 element hits + side panels)
`K/ade/v2/backlog/AdeBacklogPage.vue`, `K/ade/v2/backlog/AdeBacklogPanel.vue`, `K/ade/v2/backlog/AdeBacklogRow.vue`, `K/ade/v2/notes/AdeNotesEditor.vue`, `K/ade/v2/review/AdeReviewAgentPanel.vue`, `K/ade/v2/review/AdeReviewCompose.vue`, `K/ade/v2/review/AdeReviewFiles.vue`, `K/ade/v2/review/AdeReviewHeader.vue`, `K/ade/v2/review/AdeReviewSync.vue`, `K/ade/v2/review/AdeReviewWindow.vue`, `K/ade/v2/sessions/AdeHeadlessPane.vue`, `K/ade/v2/sessions/AdeSessionStrip.vue`, `K/ade/v2/sessions/AdeStoppedList.vue`, `K/ade/v2/sessions/AdeStoppedRow.vue`, `K/ade/v2/sessions/AdeTuiPane.vue`

#### B9 (12 files, 62 element hits)
`M/AppShell.vue`, `M/TabBar.vue`, `M/components/ConfirmDialog.vue`, `M/components/PermissionHint.vue`, `M/components/ReplySheet.vue`, `M/screens/BacklogScreen.vue`, `M/screens/NeedsScreen.vue`, `M/screens/PairScreen.vue`, `M/screens/PlanScreen.vue`, `M/screens/PlanTaskCard.vue`, `M/screens/TerminalScreen.vue`, `M/terminal/KeyBar.vue`

#### B10 (sweep, side panels, no new files)
Screenshot the Space side panels (Git repos/files/review, Automations, Memory, ADE review window,
Plan detail pane, backlog aside) side by side in both densities and fix any §2.7 drift in B's
side-panel files (one commit). Stream B's side-panel files then pass U18-U21 with no allowlist line.


### 4.3 Verification per stream

- Per commit (pre-commit hook): `bun run typecheck`, `bun run lint` (includes
  `check-ui-primitives.sh` with the stream's allowlist).
- Per chunk: the UI specs covering the chunk's testids, found by grepping the changed files'
  `data-testid` values in `apps/<app>/tests/ui`: `bun run build:test:studio && npx playwright test
  --config=apps/kira-studio/playwright.config.ts --project=ui <specs>` (B: Space config, `build:test:space`).
  Unit: `bun run test:unit`.
- Stream end, once: full `ui` project for its app (A: `bun run test:ui:studio` plus the A-owned Space
  specs; B: `bun run test:ui:space` minus A-owned specs, and `bun run test:ui:space-mobile` after
  B9); then its visual PNGs: `test:visual:update:<app>` restricted with `--grep` to its own
  snapshots, inspect each diff against §2, re-run without update clean.
- A stream is done when its allowlist holds only `permanent` lines and every check above is green.

### 4.4 Disk (4.3 GB free at plan time)

Each worktree needs its own `node_modules` (~900 MB apparent; Bun hardlinks from its global cache
on Linux, so real use is lower), Wails bindings and `frontend/dist`. Never symlink `node_modules`
(DEV_ENVIRONMENT: a symlinked tree writes installs through to the other checkout).

1. Before creating worktrees: `git worktree list`; `/home/user/kira-v22-base` (`v2.2-fixes`, 116 MB)
   is not P262's; leave it unless the user removes it. `df -h /home/user`.
2. Create A: `git worktree add -b p262-a /home/user/kira-p262-a <addendum-tip>`, then in it
   `sh scripts/prepare-worktree.sh` (runs `scripts/setup.sh`: bun install, go mod download,
   bindings, dist) and `sh scripts/codegraph-setup.sh`. Check `df`; continue only with ≥1.5 GB free.
3. Create B the same way at `/home/user/kira-p262-b`.
4. Playwright browsers and Go build cache are shared (`~/.cache`), no extra cost.
5. Clean-up after landing: `git worktree remove /home/user/kira-p262-b`, then
   `/home/user/kira-p262-a`, `git worktree prune`, `git branch -d p262-a p262-b`.
6. A stopped stream resumes from its last commit in its worktree (survives a restart); never
   recreate it.

## 5. Risks, scope, guarantees, landing

### 5.1 Behaviour-neutral guarantee

No functional change: no store, query, IPC, bridge or Go edit. Event wiring stays identical
(`SecondaryTabs` emits the same values the old `v && set(v)` handlers set; `DialogHeader closable`
uses `DialogClose`, the same `update:open(false)` Esc already sends). Testids, accessible names
and labels stay; Go untouched (no Go test asserts a frontend label or testid moved by this plan).
The two accepted a11y-semantics shifts: `ContainerEditView`/`ContainerDetail` tab triggers become
ToggleGroup items (`data-state` `on`/`off`, radio roles). Accepted side-panel shifts (§2.7): the
`AdeReviewWindow` left pane's bounds/default (220-560/320 → 180-480/260; a stored width is clamped,
never reset), Docker rows following Appearance density (compact 22/38 instead of fixed 28/44), and
collapsible section headings becoming buttons with `aria-expanded`.

### 5.2 Risks

- Base changes in foundation (input 32→26px, radius, fill, footer `justify-end`) move every
  baseline at once: foundation re-records and inspects each, before streams start.
- Layout drift from the input height drop in dense forms (docker edit, ConnectionDialog): the
  per-chunk UI specs and stream-end visual run catch it; fix in the same chunk.
- `TabsContent` without `TabsTrigger` (ScriptDialog, ConnectionDialog): reka renders content from
  root `modelValue`; verified by `automations-module`/`connection-dialog` visual and UI specs.
- Width remaps change line wrapping inside dialogs (e.g. `ConnectionDialog` 620→720px,
  `ReposDialog` 760→720px): check each remapped dialog's spec and PNG.
- Concurrent edits to the same shared spec helper (`apps/*/tests/ui/support/**`): owned by the
  app's stream (Studio helpers A, Space helpers B); a helper the other stream needs → findings.
- A6 edits shared workbench chrome (`TabStrip`, `ModeSwitcher`, `OpLogPanel`, `TitleBar*`) that Space
  also renders. §2 needs no visual change there; if one moves a Space PNG, A records it in its
  findings file and close-out re-records it (B never re-records for A's change).
- Side panels (§2.7): tree indent 8 → 6px at depth 0 and the new paddings move every side-panel
  PNG in both apps; each stream re-records its own at stream end, after A10/B10. A6's shared
  chrome no longer includes `TreeTwisty` (frozen in foundation), so no side-panel primitive
  changes under a running stream.
- Rebase conflicts: none expected (zero overlap); a real conflict means the ownership table was
  wrong — stop and fix ownership, never merge PNGs (re-record after rebase).

### 5.3 Out of scope

P263's families (tables/grids and lists outside side panels, badges/pills, checkbox/switch/radio,
tooltips, toasts, loading states, alerts and validation, menus, scrollbars and split handles,
cards, kbd hints, colour/status tokens, focus/disabled states); colour palette, tokens and
Appearance settings; the git graph canvas, SlickGrid, Monaco,
terminal and xterm internals; workflow-graph node rendering (`AdeStepNode`, `AdeStageGroupNode`
content, P255 sizing); CommandDialog; data-view font exemptions (`text-graph-*`, P123 anchors);
new features, copy rewrites beyond dismiss-button wording; Go.

### 5.4 Close-out (step 4, sequential, after both streams land)

On the landed `v2.0`: fix every item in both findings files; `DialogContent` `size` required
(legacy path deleted), `DialogHeader` `closable` default true; `Input` `default` size deleted;
move `permanent` allowlist lines into `check-ui-primitives.sh` as named exemptions with reasons;
fold `scripts/ui-primitives-side-panels.txt` into the script as a `SIDE_PANELS` list and delete the
file;
delete `scripts/ui-primitives-allowlist/`; delete findings files once fixed; `docs/ARCHITECTURE.md`
UI paragraph final; SPEC P262 result section and row Done; full `typecheck`, `lint`, `test:unit`,
`test:ui:studio`, `test:ui:space`, `test:ui:space-mobile`, `test:visual:studio`,
`test:visual:space` green.

### 5.5 Landing

1. Foundation commits on `v2.0` (main checkout), hook-green, verified (§3). Plain push in the
   background (`git push origin v2.0`); no PR.
2. Addendum commits on `v2.0` (§3.1), hook-green, verified, "Addendum result" written; push.
3. Worktrees A and B off the addendum tip (§4.4); streams run concurrently.
4. Each stream done (§4.3) → in its worktree `git rebase v2.0` (B after A lands, or either order),
   re-run lint/typecheck and its own visual check, then in the main checkout
   `git merge --ff-only p262-a` (then `p262-b` after its rebase). Plain background push after each.
5. Close-out (§5.4) on `v2.0`, push, remove worktrees (§4.4 step 5).

## 6. Verification checklist (orchestrator greps, after close-out)

Scope `D="apps/kira-studio/frontend/src apps/kira-space/frontend/src apps/kira-space/frontend/mobile packages/workbench/src packages/git-ui/src packages/docker-ui/src packages/kira-ui/src"`.

- `sh scripts/check-ui-primitives.sh` exits 0 and `scripts/ui-primitives-allowlist/` is gone.
- `grep -rPzo '<DialogContent(?![^>]*\bsize=)[^>]*>' --include=*.vue $D | tr '\0' '\n' | grep -c DialogContent` → 0.
- `grep -rn '<ToggleGroup\b' --include=*.vue $D | grep -v SecondaryTabs` → 0 (only theme).
- `grep -rn '<TabsList\|<TabsTrigger' --include=*.vue $D | grep -v AdeShell.vue` → 0.
- `grep -rln 'tabChipVariants(' --include=*.vue $D` → exactly TabStrip, ModeSwitcher, AdeShell,
  ConsoleView, ExecView, AdeSessionStrip.
- `grep -rhoP 'size="(default|xs|sm|lg|icon|icon-xs|icon-lg)"' --include=*.vue $D | wc -l` → 0
  (Button and Input alike).
- `grep -rhoP '(?<![-\w])font-bold(?![-\w])' --include=*.vue $D | wc -l` → 2 (LogsView ANSI);
  `font-semibold` only in `PanelHeader.vue`.
- `grep -rn '<label\b\|<select\b' --include=*.vue $D` → only the script's named exemptions.
- `grep -rhoP '<CodiconIcon[^>]*:size="\K\d+' --include=*.vue $D | sort -u` ⊆ {12, 13, 16, 24}.
- `grep -rn 'variant="icon"' --include=*.vue $D | grep EmptyMedia` → 0.
- Real usage of the new primitives: `grep -rl "<SecondaryTabs" $D | wc -l` ≥ 35 files,
  `grep -rl '<DialogBody' $D | wc -l` ≥ 40, `grep -rl '<SectionHeading' $D | wc -l` ≥ 6.
- Side panels: `grep -rln 'rowVariants(' $D | wc -l` ≥ 20, `grep -rl '<PanelBar' $D | wc -l` ≥ 6,
  `grep -rl '<PanelHeader' $D | wc -l` ≥ 12 (6 module panels + the 6 earlier users),
  `grep -rl 'useRowHeight' $D | wc -l` ≥ 5; `packages/git-ui/src/lib/rowVariants.ts` gone;
  `grep -rn "rowDensity === 'compact'" $D` only in the P263 grid files (none in the side-panel list);
  `grep -rn 'side-empty' $D` → 0.
- `git diff --stat <foundation-base>..HEAD -- '*.go'` → empty.
- `docker-edit.spec.ts` asserts `on`/`off`; every `visual` project green on both apps.

## Foundation result

Landed on `v2.0` (not pushed). Commits: dialog parts + `DialogBody`; input/select/textarea/
input-group/field-group bases; `SecondaryTabs` + `SectionHeading`; reference migrations
(`ConfirmDialog`, `UpdateDialog`, `SettingsShell`, `TextPromptDialog`, both `SettingsDialog`);
`check-ui-primitives.sh` + allowlists + lint wiring + ARCHITECTURE paragraph; `SearchField` + U17;
search addendum; two on-the-spot fixes; baselines.

Allowlists: stream-a 104 files, stream-b 103 files, 2 `permanent` lines (U3 `CommandPalette.vue`,
U11 `LogsView.vue` ANSI bold). The guard fails on stale entries, so lists only shrink.

Verify: `typecheck`, `lint`, `test:unit` (1793), `test:ui:studio` (420 pass after fixes),
`test:ui:space` (456 pass after fix), both visual projects clean after re-record.

Deviations and findings:
- `NativeSelect` default flip to 26px broke 3 Studio specs: `MethodSelect`, `EnvironmentSelect`,
  `CellEditorView` select now pass `size: 'kira'`, `GenerateDataDialog` constant input uses
  `h-control-lg`. Stream-A files edited early; streams branch from this tip, no conflict.
- `repo-commit-meta.spec.ts` failed before this phase (commit `f046f9a12` moved the scroller to an
  inner div); spec updated. Stream-B owned file edited early.
- `InputGroup` default is now `kira-lg`, which carries `font-data` (the `kira` variant's string).
  Streams check number steppers and text groups that should stay UI font.
- Space `git-graph*` and `workflow-graph*` baselines moved; likely base input/fill changes plus
  `f046f9a12` layout drift. Not separable without a base re-record.
- Visual baselines for Studio/Space shared surfaces re-recorded here (Settings, connection,
  script, git dialogs); streams re-record only what their own chunks move.

## Foundation addendum result

Landed on `v2.0` (not pushed). Commits: `rowVariants`/`rowIndent`/`useRowHeight`/`PanelBar` plus
`PanelHeader` `#start`, `SectionHeading` collapsible/count, `TooltipIconButton` `pressed`,
SettingsShell nav migration (one commit, `f9d1da72d`; an earlier hook-failed attempt left the
second group staged, so the two groups merged); side-panel list + guards U18-U21 + allowlists +
ARCHITECTURE sentence (`7f9fe8e63`).

Allowlists: stream-a +8 (`CollectionRow`, `CollectionsTree`, `ProjectTree`, `TreeRow`,
`ImageList`, `NetworkList`, `VirtualList`, `VolumeList`), stream-b +4 (`RepoFileTree`,
`RepoSearchRow`, `RepoTreeRow`, `ReviewCommitRow`). All named in §4.1 chunks; no plan gap. The 4
foundation-owned files pass. `rowVariants` lives at `packages/theme/src/components/rowVariants.ts`;
git-ui's copy stays until B3.

Verify: `typecheck`, `lint`, `test:unit` (1793), `test:visual:studio` (13) and
`test:visual:space` (13) clean without re-recording, `test:ui:studio` 422 pass, `test:ui:space`
456 pass. Two failures in the full parallel runs (`data-view.spec.ts:1047`,
`repo-graph-widths.spec.ts:78`) pass in isolation: load flakes, no addendum file involved.

Deviations: `rowVariants` `menu` layout carries git-ui's base classes inline (no shared cva base)
so `nav`/`tree` avoid `text-fg` conflicts; `nav` selected-false adds `bg-transparent` (the old
inline string had it). No pixel moved.
