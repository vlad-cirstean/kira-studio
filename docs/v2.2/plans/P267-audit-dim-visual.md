Input to P267 plan. Audit at tip 36eb6b80d; re-verify counts against the current tree.

# Visual-dimension audit (15 dimensions)

Base: branch v2.0, tip `36eb6b80d` (worktree HEAD `1bf09cec7`; other agent's uncommitted edits are tests/contract only, ignored).
Scope: `apps/kira-studio/frontend/src`, `apps/kira-space/frontend/{src,mobile}`, `packages/{workbench,git-ui,docker-ui,theme}/src` (+ `api-core`, `git-core`, `shared` for formatting/sort).
Discovery: `codegraph_explore` per dimension (SectionHeading/FieldDescription/InlineState, rowVariants cursor, Dialog parts, TruncatedText/AttributeTooltip/Tooltip*, behaviour/format.ts, docker lib/format + TimelinePane + ScriptProgress, shortSha/useCopy, Badge/StatusDot/Kbd, compareNatural/sort helpers, QueryState/Skeleton/Spinner/EmptyState, ContainerList/pickerModel order, TooltipDisabledTrigger/disabled reasons, CommitMeta/AdeSessionId/docker shortId). Counts: grep/python over the scope, `spec`/`tests`/`testing` excluded.
Prior reports not repeated: `audit-ui-leftovers.md` (items cited as "UL#n"), `audit-exemptions.md`. Where a dimension overlaps, only new evidence and the final decision are given.

Verdicts: ALREADY UNIFIED, JUSTIFIED DIFFERENCE, GAP.

---

## 1. Grey / secondary text tokens: GAP

Tokens (`packages/theme/src/tokens.css:8-13`): `--kira-fg-muted` #9d9d9d (`text-muted-foreground`), `--kira-fg-subtle` #8a8a8a (`text-subtle`, comment: "tertiary, non-interactive: separators, captions, row numbers, NULL markers, empty-state copy"), `--kira-fg-disabled` #6e6e6e (`text-disabled`, 3 uses, NULL markers).

Counts (muted / subtle): Studio 136/130, Space 146/79, mobile 14/13, workbench 80/6, git-ui 62/25, docker 79/0, theme 29/11. Files: 195 use muted, 100 subtle, 59 both.
The split follows module, not role (docker never uses subtle, workbench almost never).

Same role, both tokens:
- Empty-text lines (`…empty`/`emptyHint` keys): muted 28, subtle 21. Example: `PropertiesSection.vue:29` muted vs `ExplainResultView.vue:156` subtle, same "nothing here" line in the same Definition/Console area.
- Hint paragraphs: `<p>` muted 39, subtle 26 (`AdeReviewAgentPanel.vue:118` muted hint, `AdvancedPane.vue:91` subtle hint).
- Timestamps: muted 3, subtle 2. Row meta `ml-auto`: muted 13, subtle 4 (`StudioStart.vue:128`, `AdeBasePicker.vue:136`, `NeedsScreen.vue:105`, `ReviewView.vue:931` subtle; P262 §2.7 says muted).
- Primitives: subtle in `SectionHeading`, `FieldLegend`, `FieldDescription`, `InlineState`; muted in `DialogDescription`, `TableHead`, `Kbd`, Badge default, row meta, KV keys (`<dt>` 15/15 muted, consistent).
- Icons: `CodiconIcon class` muted 21, subtle 4.

Decision (final): two tiers by role.
- `text-muted-foreground`: secondary content. Row meta, KV keys, secondary labels and values, timestamps, counts, icons, `DialogDescription`, status text in footers and bars.
- `text-subtle`: tertiary chrome captions. Section headings and legends, help text (`FieldDescription`), empty and inline-state lines, placeholders and NULL markers, separators, row numbers.
- `text-disabled`: absence markers only (unchanged).
- Hand-written hint `<p class="text-kira-sm text-…">` becomes `FieldDescription`; hand-written empty lines become `InlineState kind="empty"` (removes most of the drift by construction).

Size: about 60 files (28 muted empty lines, about 39 muted hint `<p>`, 4 subtle row-meta sites, 4 subtle icons).
Guard: `text-muted-foreground` on an element whose text is a `.empty'`/`.emptyHint'` key; `<p … text-kira-sm text-(muted-foreground|subtle)` (use FieldDescription). Record the rule in ARCHITECTURE "Element families".

## 2. Cursor rules: GAP

Counts: `cursor-pointer` 72 (about 50 files), `cursor-default` 40, `cursor-grab` 7, `cursor-ew/ns-resize` 4 (resize cva only, U31 guarded), `cursor-text` 1 (InputGroup), `cursor-help` 1 (`ColumnsSection.vue:97`), `cursor-copy` 1 (`UndoButton.vue:52`), `cursor-not-allowed` 0 (U35 guarded).

Primitives disagree with each other:
- pointer: `Switch.vue:23`, `ui/tabs/index.ts:12` (`tabChipVariants`), `ui/native-select/index.ts:22`, `rowVariants` `menu` (`rowVariants.ts:9`), `TreeTwisty`.
- default (explicit or browser default): `Button` cva (no cursor, about 500 buttons), `Checkbox`, every `DropdownMenu*Item` (`cursor-default`), `rowVariants` `tree`/`double`, `SectionHeading collapsible`.
- So a picker row (`menu`) shows a hand, the identical-looking dropdown item next to it shows an arrow.

Bug: `ReviewCommitRow.vue:217` puts `cursor-pointer` on a plain-text sha span with no click handler (the comment above it says the copy affordance was removed).
`ConnectionDialog.vue` alone has 8 `cursor-pointer`.

Decision (final): desktop convention. Arrow (`cursor-default`) on every control and row: buttons, toggles, switches, checkboxes, tabs, selects, menu and tree rows, disclosures.
- Pointer only for hyperlinks: `Button variant="link"`, `linkify.ts` anchors, PR badge as link (`badgeClass.ts:20`).
- `grab` only on drag handles (keep, 7 sites). `text` in text fields. Drop `help` and `copy`.
- `disabled:cursor-default` stays (P263 §2.12).

Size: 4 theme primitives (`Switch`, `tabs/index.ts`, `native-select/index.ts`, `rowVariants.ts`) plus about 45 app files deleting `cursor-pointer`.
Guard: `cursor-pointer` outside `button/index.ts` link variant, `linkify.ts`, `badgeClass.ts`; `cursor-(help|copy)` anywhere.

## 3. Elevation: z-index ladder and shadow per tier: GAP

z-index (UL#9 has the ladder conflict). New counts:
- Floating tiers: 9 shadcn primitives hard-code `z-50` (Dialog, DialogOverlay, CommandDialog, Popover, DropdownMenu ×2, Tooltip ×3 including arrow). 6 hand-rolled layers use the token ladder (`AutocompleteField` ×2 350, `TextPromptDialog` 200 + scrim `z-30`, `ErrorPopover` 300, `MonacoHost` ×2 400).
- In-pane stacking (`z-0..3`, `z-[1]`): 19 sites (sticky headers, column handles, virtual pins, `TableHeader z-1`). JUSTIFIED: local stacking contexts, not tiers.
- Drift: `AdePlanView.vue:327` z-10, `ReviewCommentsPane.vue:161` z-10, git `App.vue:1859` z-20 drawer, `ToggleGroupItem.vue:38` z-10 (focus lift, justified).

Shadows: P263 §2.10 decided `shadow-kira` on every floating surface, cards flat. Actual:
- `shadow-kira`: DropdownMenuContent, DropdownMenuSubContent, native-select picker, `AdeTaskCard` (board exemption).
- `shadow-md` (stock Tailwind, not a token): `PopoverContent.vue:46`. Not guarded by `check-theme-classes.sh`.
- `shadow-kira-dialog`: hand-rolled only (`ErrorPopover:43`, git `App.vue:1863`, `AutocompleteField:633,668`).
- None: DialogContent, CommandDialog, TooltipContent (inverse `bg-fg`, acceptable).

Decision (final):
- z: primitives use the ladder: Popover `z-(--kira-z-popover)` 100, Dialog + overlay + CommandDialog `z-(--kira-z-dialog)` 200, DropdownMenu `z-(--kira-z-menu)` 300, autocomplete 350, Tooltip `z-(--kira-z-tooltip)` 400. In-pane layers stay `z-1..3`. Floating hand-rolled layers use the ladder rung of their tier (`AdePlanView`, `ReviewCommentsPane`, git drawer move to their rung or to `z-3` if in-pane).
- Shadow: menu, popover, select picker, autocomplete, error popover = `shadow-kira`; dialog, command palette, drawer = `shadow-kira-dialog`; tooltip none; cards none.

Size: 9 theme primitive files plus 5 app files.
Guard: bare `z-(\d{2,}|\[)` outside `components/ui` (theme `ui/` included once wired); `shadow-(sm|md|lg|xl|2xl)` stock scale in `check-theme-classes.sh`.

## 4. Section and sub-section title recipes: GAP (extends UL#1, UL#22)

Already unified: `SectionHeading` 13 uses in 10 files; `FieldLegend` 17 uses in 12 files; `DetailSection`/Card section 21 uses. View/detail title `text-kira-lg font-medium` holds in ADE panels (`AdeTaskPanel:146`, `AdeBacklogPanel:64`, `AdeArchivedPanel:33`, `AdeBranchPanel:281`), mobile `AppShell:44`, `TerminalScreen:151`, docker `EngineOverview:162`.

New drift (not in UL):
- Settings pane section titles: Studio panes use `FieldSet`/`FieldLegend` (`AppearancePane`, `DatabaseMcpPane`); Space uses `h3 text-kira-lg` (`GitPane.vue:92,172`) and `h3 text-kira-md font-medium` (`MobileAccessPane.vue:183,239,292`), with a hand-written `<p class="text-subtle text-kira-sm">` description.
- Form section titles: `RepoConfigForm.vue:201,267,333,354` `h3 m-0 text-kira-lg` (400 weight).
- Empty lines styled as titles: `AdeBacklogPage.vue:128` (`text-kira-lg text-subtle`), `AdeNeedsPage.vue:46` (`text-kira-lg text-tone-green`), `AdeAllSessions.vue:120` (`text-kira-lg text-muted-foreground`).
- `CookiesPane.vue:220,244` `h3 … text-muted-foreground text-kira-sm` (sentence case, no uppercase): a third sub-heading look.
- 23 `uppercase` hits outside `SectionHeading` remain (U21 scans side panels only).

Decision (final): three title levels only.
- View/detail title: `text-kira-lg font-medium text-fg` (`truncate` in bars, `line-clamp-2` in detail heads).
- Section in a pane, panel, list or picker: `SectionHeading`; in a form or settings pane: `FieldSet` + `FieldLegend` + `FieldDescription`.
- No other heading recipe. Empty lines use `InlineState`/`EmptyState`, never title sizes.

Size: 7 files (GitPane, MobileAccessPane, RepoConfigForm, CookiesPane, AdeBacklogPage, AdeNeedsPage, AdeAllSessions) on top of UL#1's 14.
Guard: `<h[1-6]\b` outside an allow-list of view-title files; U21 kind `s` to `v` (UL).

## 5. Dialog header icons and anatomy: mostly ALREADY UNIFIED, small GAP

Unified (evidence):
- 44 `DialogContent`, every one with `size` (U1): md 20, lg 10, xl 8, sm 4, 2xl 1; `fixed-height` 5.
- 43 `DialogFooter`: 39 follow dismiss, alternatives, primary-last; all `kira-lg` except mobile `ReplySheet.vue:71` (`kira`, touch sheet).
- Header/body/footer order and classes come from `dialogHeaderClass`/`dialogBodyClass`/`dialogFooterClass` (`ui/dialog/index.ts:16-20`), shared by `TextPromptDialog`.
- Visible `DialogDescription` sits in `DialogBody` in 12 git-ui sites (allowed by P262 §2.2).

Gaps:
- Header icon on 5 of 44 (`DataGripImportDialog:180`, `FiltersDialog:190`, `ConnectionDialog:696`, `ReposDialog:170`, `SettingsShell:194`). UL#28 recommends dropping them. Decision (final): no header icon; remove the `icon` prop from `DialogHeader`.
- Visible description inside the header: `RecreateConfirmDialog.vue:28-30`, mobile `ReplySheet.vue:55-57` (UL#28). Move to `DialogBody`.
- Two emphasised actions: `CheckoutDialog.vue:136-146` renders `dialog-primary` (stash and check out) and `dialog-danger` (discard) together. Decision: one emphasised button; when both apply, the stash path is `dialog-primary`, discard becomes `dialog` (danger stays in its label and confirm).
- Width outside the scale: UL#26.

Size: 8 files. Guard: `<DialogHeader[^>]*\sicon=`; two of `dialog-(primary|danger)` without `v-if`/`v-else` pairing in one footer (lint script, optional).

## 6. Truncation, wrapping, overflow tooltips: GAP (P264 decision not applied)

Counts: `truncate` 173, manual `overflow-hidden text-ellipsis whitespace-nowrap` 67 hits in 38 files, `line-clamp-*` 5, `break-all` 16, `break-words` 19, `whitespace-pre-wrap` 42, `data-kira-tip` 49 in 12 files.

`TruncatedText` (`packages/theme/src/components/TruncatedText.vue`, P264 §2.19 "one primitive") has 0 importers. The 7 sites P264 named still use always-on reveal tooltips (`ReposDialog.vue:282,364`, `RepoConfigForm.vue:245,254`, `AdeReviewSync.vue:202,218`, `ImportFileRow.vue:44`, `RepoMultiDiffView.vue:151`, `EditField`, `EditInPlaceSection`).
Total always-on reveal pattern (`<TooltipTrigger>` wrapping a `truncate` element): 32 sites in 23 files. Examples: `TreeRow.vue`, `CollectionRow.vue`, `GitPanel.vue`, `OpLogPanel.vue`, `CommitMeta.vue`, `KeyValuePane.vue`, `AdeSessionId.vue:15-21`.
Paths truncate at the end everywhere (no start/middle ellipsis), so a long path loses its file name; only `RepoMultiDiffView.vue:151` splits dir and name.

Decision (final):
- Single-line overflow is `truncate` (never the three-class spelling).
- A truncated value that the user may need in full renders `TruncatedText` (tooltip only while cut off). Virtual rows keep `AttributeTooltip` (DOM-cheap).
- Paths render dir and name separately (name `shrink-0`, dir `truncate`), as `RepoMultiDiffView` does; extract that as a `PathText` variant of `TruncatedText` (`split="path"`).
- Multi-line clamp only for titles (`line-clamp-2`); data values wrap with `break-all`, prose with `break-words`.

Size: 23 files for TruncatedText, 38 files for the `truncate` spelling (mechanical), about 10 path sites.
Guard: `overflow-hidden text-ellipsis whitespace-nowrap` (use `truncate`); `<TooltipTrigger[^>]*>\s*<(span|div)[^>]*\btruncate\b` (use TruncatedText).

## 7. Hover, focus, active, disabled, readonly; disabled explanations: GAP

Unified: focus ring (`focus-ring`, U35), disabled look `opacity-50` + `pointer-events-none`/`cursor-default` (U35), row hover/selected via `rowVariants` (U18/U37), active press `active:not-aria-[haspopup]:translate-y-px` in the Button cva only (the one `active:` rule).

Gaps:
- Hover missing on two button variants: `dialog` and `dialog-primary` have no hover state (`button/index.ts`), while `toolbar`, `toolbar-primary` (`hover:bg-primary/80`), `danger`, `dialog-danger` (`hover:bg-error/20`) and `ghost` do. Every dialog footer button is therefore hover-dead. `ghost` also carries a `dark:hover:bg-field/50` shadcn leftover.
- Hover colour overrides on icon buttons: `ContainerList.vue:264,271,331,339`, `ContainerTable.vue:151,159` (`text-ok hover:text-ok`), `ResponsePane.vue:302,409,513`, `BrowseView.vue:447`, `CommitMeta.vue:424`, `ConstraintsSection.vue:97` (`hover:text-primary`): 13 sites.
- Opacity as "muted" (P262 §2.7 says no `opacity-*`): `opacity-60` ×6 (`TimelinePane:294,306,371`, `AdeWorkflowGraph:334`, `AdeStageGroupNode:39`, `AdeStageBlock:191`), `opacity-70` ×4 (`MemoryPanel:157`, `MemoryStart:83`, `LogsView:225,253`).
- Readonly: no readonly look at all. `CopyAsCurlDialog.vue:79` and `SchemaBrowser.vue:138` readonly Textareas look editable (`bg-field`, strong border).
- Disabled explanation: icon buttons are good (88 disabled `TooltipIconButton`, 73 with `disabled-trigger`). Labelled buttons: 144 disabled, 15 wrapped in `TooltipDisabledTrigger`; many of the rest are pending (item 8) or explained by a `FieldError` beside them. `writeDisabledReason` is copy-pasted (`KeyValuePane.vue:257`, `DocumentView.vue:122`). Menus split (UL#11).

Decision (final):
- Every button variant has a hover: `dialog` `hover:bg-hover`, `dialog-primary` `hover:bg-primary/80` (same as `toolbar-primary`). Drop `dark:` from `ghost`.
- Tone on icon buttons via a `tone` prop on `TooltipIconButton` (`ok`, `error`), not paired `text-x hover:text-x`.
- Muted items use `text-muted-foreground` (or `rowVariants muted`), never opacity; opacity only for disabled (50) and drag ghost.
- Readonly control: `read-only:bg-transparent read-only:border-border` in the Input/Textarea cva (looks like a code box, still selectable).
- A disabled control that the user could enable explains why: icon button `disabled-trigger` + reason label; labelled button `TooltipDisabledTrigger` + reason; pending uses `Button pending` (no tooltip). Move `writeDisabledReason` to `views/shared/writeGate.ts`.

Size: `button/index.ts`, `input`/`textarea` cva, `TooltipIconButton` (+ 6 callers), 10 opacity sites, 2 writeDisabledReason files.
Guard: `hover:text-(ok|error|warn|primary)` in app code; `opacity-(40|60|70|75|80)` outside drag/disabled; `function writeDisabledReason` once.

## 8. Loading placeholders and delays: GAP

Unified: `Spinner` one motion (23 files), `QueryState` 20 files, `Skeleton` only in docker known-layout forms (2 files, JUSTIFIED by P263 §2.6), `InlineState kind="loading"` for list lines (11 sites), copy "Loading…" (P265).

Gaps:
- Delay: `TIMING.spinnerDelay` (300ms) applies only inside `QueryState`. The 7 hand-rolled pane spinners (`KeyValuePane:1190`, `BrowseView:466`, `StreamView:1247`, `DocumentView:1144`, `StashDetailPane:113`, `ReviewView:836`, `DetailPane:108`) and every `InlineState kind="loading"` (`GitPanel:736`, `ReviewFilesPane:210`, `ReviewCommentsPane:179`, `GenerateDataDialog:361`, `ResponseDiffDialog:259`, `ColumnsMenu:147`, `PreviewCommandPanel:82`, `StreamView:1059`, `ReviewCommitRow:270`, …) flash immediately.
- Mobile text-only loading overrides `QueryState`'s slot: `NeedsScreen.vue:70-72`, `PlanScreen.vue:18-20`, `BacklogScreen.vue:108-110` (`<p class="m-0 p-4 text-muted-foreground">Loading…</p>`), against P263 §2.15 (Spinner/Empty).
- Button pending (P264 §2.22): `Button pending` has 1 user; 49 buttons in 40 files bind `:disabled` to a pending flag instead; hand spinners inside buttons remain in `ContainerEditView.vue`, `UnavailableState.vue`, `RefreshButton.vue` (4 sites).
- Pane loading text: "Loading…" vs "Loading <noun>…" both used (`AdePlanView:324`, `MemoryPanel:126`, `ReviewView:835` noun forms); allowed by P265.

Decision (final):
- One delay for every loading placeholder: `InlineState kind="loading"` and a new `EmptyState` `loading` prop (spinner media + title) both wait `TIMING.spinnerDelay`; `QueryState` uses them.
- Mobile uses `QueryState` defaults (no text-only override).
- Async buttons use `pending` only; `:disabled` never carries the pending flag.

Size: `InlineState`, `EmptyState` (theme), 7 pane sites, 3 mobile screens, 40 files for `pending`.
Guard: `<Button\b[^>]*:disabled="[^"]*(pending|isPending|busy|saving)` (use `pending`); `<Spinner` inside `<Button>`; `#loading` slot containing text without `Spinner`.

## 9. Formatting call sites bypassing shared formatters: GAP (small)

Unified: U52 guards `toLocale*`/`Intl.*`/`useTimeAgo`; `behaviour/format.ts` adoption: `formatBytes` 29 files, `formatCount` 13, `formatDuration` 11, `useRelativeTime` 11, `formatRelative` 9, `displayValue` 9, `formatAgeCompact` 8, `formatDateTime` 7, `formatAbsoluteUtc` 6, `formatPercent` 4. Named exemptions hold (`timestamp.ts`, `scheduleText.ts`).

Bypasses that U52 does not see (no `Intl`/`toLocale` token):
- `AppMetricsItem.vue:24-25` restates `formatPercent` byte for byte (`toFixed(1)%` / `Math.round%`).
- `AdeTaskCard.vue:194` `{{ p.percent }}%`, `PlanTaskCard` mobile progress: inline percent.
- Duration, 4 local formatters: `RunState.vue:32-35` (ms or `x.x s`, never minutes: 125 s shows "125.0 s"), `ScriptProgress.vue:34-42` (compact "5s"/"2m"/"2m 5s"), `KeyValuePane.vue:214-219` `ttlText` (ceil compact), `TimelinePane.vue:56` `formatHopMs` (sub-ms two decimals, JUSTIFIED as an extension, should live in format.ts).
- `runText.ts:20` `costText` `${usd.toFixed(2)} USD` (no currency formatter, unit not localised).
- `pendingDecision.ts:56` and `common.expiresIn.status` "Expires in {seconds}s": countdown, fine (unit in catalog).
- Theme cannot import workbench, so `RunState` and `ScriptProgress` (theme) re-implement durations. Root cause: formatters live in workbench.
- Go: `apps/kira-studio/internal/adapters/s3/read.go:20` `formatBytes` always one decimal; TS `formatBytes` drops the decimal from 100. Same object shows "123.0 KB" (S3 metadata row) and "123 KB" elsewhere.

Decision (final): move the pure formatters (`formatBytes`, `formatPercent`, `formatDuration`, `formatElapsed`, `formatCompactDuration`, `formatCurrency`) down to `packages/theme/src/format.ts` (theme already owns `formatCount`); `behaviour/format.ts` re-exports and keeps the reactive ones. Add `formatCompactDuration` (ScriptProgress/ttl form) and `formatCurrency(usd)` (`Intl.NumberFormat` currency). Sub-ms branch goes into `formatDuration`. Go `formatBytes` matches TS (no decimal at 100+).

Size: 8 files plus 1 Go file.
Guard: `toFixed\(` in `.vue` and in `/theme/src/` outside `format.ts`; `\}\}%` in templates.

## 10. Identifier display (SHA, branch, path, id): GAP (small)

Unified: `shortSha` (`git-core/src/lib/sha.ts`, 7 chars) with 34 callers; U82 guards `.slice(0,7|8)`; full sha copy in `CommitMeta` (`copySha`, announces).
Short-id lengths: sha 7, docker 12 (`docker-ui/src/lib/format.ts:3`, Docker CLI convention), ADE record 4 (`ade/v2/activity.ts:27`, label "claude 9ab0"). JUSTIFIED: each matches its ecosystem's own convention.

Gaps:
- Font: identifiers rendered in UI font: sha `AdeRunOutcome.vue:222`, `StashDetailPane.vue:80`, `CommitMeta.vue:432-441` (`Badge` without `data`); branch 9 of 22 sites (`TagList:101`, `BranchPicker:676,751`, `SearchResults:105`, `StackList:89`, `BaseSelector:175`; some inherit `text-graph` from `rowVariants data`, so recheck per site); path 11 of 33 (`StudioStart:127`, `KeyValuePane:799`, `BrowseView:331`, `DataView:210`, `StreamView:794`, `DocumentView:805`).
- Copy affordance: three mechanisms: click-the-badge (`CommitMeta` sha), trailing copy icon (`AdeSessionId.vue:22`, docker `ContainerDetail.vue:193`, docker env), menu item only (`ContainerList` "Copy ID", git row menu "Copy SHA"). No identifier component.
- Badge `data` prop: 48 of 125 Badges set it.

Decision (final): one `Identifier` component in theme: `font-data`, `TruncatedText` (path split for paths), optional `copyable` → trailing `TooltipIconButton copy` with `useCopy` check swap; `short` prop takes the formatter (`shortSha`, docker `shortId`). Menus keep their "Copy …" items as well. Ids, shas, branches, refs and paths always `font-data` (P263 LAW 08).

Size: new component + about 20 sites.
Guard: `shortSha\(|shortId\(` inside an element without `font-data`/`Identifier` (lint script).

## 11. Default sort order and tie-breaks: mostly ALREADY UNIFIED, small GAP

Unified: `compareNatural` (one `Intl.Collator`, numeric, base sensitivity) has 28 callers; name lists sort natural (docker lists, refs, file trees with dirs first, Space repo file tree, completions, filter tree); recency lists break ties by name (`pickerModel.ts:117` `byRecencyThenName`, git `App.vue:360-372`, `PromptHost.vue:25` createdAt then id); user-ordered lists keep `sort_order` (`collections.ts:186`, `NextSortOrder` Go helper).

Gaps:
- Worktrees have two orders: Space `repo/state/worktrees.ts:55` (main first, then server order) vs git-ui `pickerModel.ts:152` (current, main, then path).
- Code-unit `.sort()` on user-visible names: `rowMenuModel.ts:432` (remote names in a menu), `documents/page.ts:85` (field names).
- No tie-break: `runsQueries.ts:16` (createdAt), `sessionView.ts:110` `byRecent` and `:105` `byRunningOrder` (lastActiveAt), `AdeAllSessions.vue:56,58` (rank only), docker `queries.ts:163`, git `pickerModel.ts:147` global stash timestamp.

Decision (final): every list comparator ends with a stable key: names `compareNatural(name)` then id; recency `desc time` then `compareNatural(name)` then id. Worktrees: current, main, then `compareNatural(path)` in both modules (move `orderWorktrees` to a shared helper). No bare `.sort()` on display strings.

Size: 8 files. Guard: `\.sort\(\)` on strings in `.vue`/`.ts` app code (exempt numeric arrays by name), lint-level only.

## 12. Abbreviations, units, pluralisation wording: mostly ALREADY UNIFIED, small GAP

Unified: P265 catalog (3,890 keys) with style rules; 140 plural messages (`a | b`), 0 `(s)` plurals, 0 `...`, sentence case; abbreviations consistent: "ID" 13 (0 "Id"), "SHA" 11, "repository" 68 vs "repo" only in example paths and `{repo}` placeholders, "folder" 50 vs "directory" 0, "environment" 15.

Gaps:
- Number grouping only for `count`: `t()` (`i18n/index.ts:20-27`) runs `formatCount` only on the `count` param. 67 messages carry other numbers (`{total}`, `{shown}`, `{remaining}`, `{done}`, `{pageSize}`): `git.fileTree.capped.announce` "Showing {shown} of {total} files" prints 12345 ungrouped next to a grouped count.
- Duration unit spacing inside one formatter: "240 ms", "3.4 s" (space) vs "2m 5s", "1h 2m", "5m ago", "<1m" (no space) (`format.duration.*`, `format.relative.*`).
- Byte unit labels: `formatBytes` prints KB/MB/GB (1024 base); docker edit options print MiB/GiB (`docker.unit.mib.option`, `docker.unit.gib.option`) for the same 1024 base.
- Count with parentheses vs separate: HTTP pane tabs "Headers ({count})" ×5 (`studio.http.pane.*Count.label`), git `SearchResults.vue:89` "(n)", vs `SecondaryTabs` `count` (plain meta) elsewhere.

Decision (final):
- `t()` formats every numeric param with `formatCount` (plural branch still selected by `count`). One-file change.
- Durations and ages: no space, compact symbols (`240ms`, `3.4s`, `2m 5s`); sizes and percents keep a space before the unit (`1.2 KB`, `12%` no space for percent). Edit `format.duration.ms`/`seconds` only.
- Bytes: KB/MB/GB labels on the 1024 base everywhere, docker edit included.
- Counts beside a label render through `SecondaryTabs` `count` (item 14), never "(n)" in the label text.

Size: 1 i18n file, 4 catalog keys, 2 docker keys, 5 HTTP pane keys + `SearchResults.vue`.
Guard: catalog check (P265 checker): a `{name}` placeholder ending in `Count|total|shown|remaining` in a label key; `\(\{count\}\)`.

## 13. Icon sizes and stroke/colour per context: mostly ALREADY UNIFIED, small GAP

Unified: P262 scale 12/13/16/24 (U12). `CodiconIcon :size`: 13 ×151, 12 ×66, 24 ×7, 16 ×5, bound ×6. Lucide only inside shadcn `ui/` (U72). Spinner sizes 12/13/24. Icon box `size-4` in rows and dialog header.

Gaps (all outside U12's scan or expressed another way):
- `packages/theme/src` is not in `check-ui-primitives.sh` DIRS: `NumberStepperInput.vue:67,82` `:size="9"`, `VarText.vue:20` `:size="11"`.
- `TooltipIconButton :icon-size` bypasses U12: `WorkbenchTitleBar.vue:52,62,72` (15), `TitleBarWindowActions.vue:35` (16), `ExecView.vue:76` (12).
- No size (codicon default 16): `HttpRequestView.vue:608`, `CommitMeta.vue:332`, `SearchResults.vue:104`, `FileTree.vue:591,688`.
- Raw `codicon codicon-*` spans outside `CodiconIcon`: `TagList.vue:97`, `ReviewCommentsPane.vue:153`, `ScriptProgress.vue:65,68` (U73 forbids only the string literal form).
- Colour: icons in rows `text-muted-foreground` 21 vs `text-subtle` 4; tone colours on status icons (`text-error` 6, `text-ok` 2, `text-warn` 1) fine.

Decision (final): sizes 12 (chips, stepper chevrons), 13 (default), 16 (mode tabs, title-bar window and action icons: title bar is the VS Code 16 context), 24 (empty media). `CodiconIcon` `size` becomes required with type `12 | 13 | 16 | 24`; `TooltipIconButton iconSize` same type. Decorative icon colour `text-muted-foreground`; tone colour only when the icon carries status.

Size: 10 files. Guard: make the prop types literal unions (typecheck enforces it, no regex); add `packages/theme/src` (minus `components/ui`) to DIRS (also asked by UL guard list).

## 14. Badge, chip, count, pill styling: mostly ALREADY UNIFIED, GAP on counts

Unified: one `badgeVariants` shape (`h-control-sm rounded-kira-sm px-1 text-kira-sm`, tone `/16`); 125 `Badge` uses (default 46, warn 21, dynamic 20, chip 18, info 12, count 4+5, error 3, ok 1); only 3 shape overrides (`CollectionRow.vue:129,137` fixed-width method chip, `AdeRepoChip.vue:45` `h-control-lg` picker chip); git ref badges reuse `badgeVariants` via `refBadgeClass`; `StatusDot` 24 callers; U27 guards hand-rolled pills.

Gaps (counts):
- P262 §2.7: `Badge variant="count"` only for attention counts. Plain counts render as count pills in docker `NetworkList.vue:63`, `ImageList.vue:78`, `VolumeList.vue:63` (containers using), `EngineOverview.vue:266`, `TreeRow.vue:206`.
- Tab counts have three looks: `SecondaryTabs` `count` (plain meta), count pill (`BranchPicker.vue:621`, `ReviewView.vue:950`), parentheses in the label (HTTP panes, item 12).
- `tabular-nums` on counts: 2 uses in the whole scope (P262 §2.7 says meta counts are `tabular-nums`); 14 count spans without it (e.g. `ContainerList.vue:258` `running/total`).
- `CollectionRow.vue:129,137` method chip `tracking-wide` (second letter-spacing recipe beside `SectionHeading tracking-wider`).

Decision (final): counts in a tab, section or row = plain meta `text-kira-sm text-muted-foreground tabular-nums` (via `SecondaryTabs count`, `SectionHeading count`, row meta slot). `Badge count` only for attention (needs you, unread, conflicts). Method chip: `Badge chip` with a fixed width class only, no tracking.

Size: 8 files. Guard: `variant="count"` allow-list (AdeShell, TabBar, TreeRow if attention); `tabular-nums` folded into the row meta class constant.

## 15. Tooltip delay, placement, content style: ALREADY UNIFIED

Evidence: theme `TooltipProvider` owns delay 400 / skip 300 / non-hoverable (`TooltipProvider.vue:5-9`), U29 forbids props and content classes; 0 `side`/`align`/`side-offset` overrides across 170 `TooltipContent`; native `title` retired (U22); shortcuts via `Kbd` (U33, `TooltipIconButton kbd`); mobile has 0 tooltips (P263 §2.15); `AttributeTooltip` for DOM-built rows (12 files, JUSTIFIED: virtual rows and SlickGrid); 294 tooltip keys, 0 with a trailing period (P265 rule 3); structured content only in 2 sites (`FilterHistoryMenu.vue:153`, `ClaudeUsageItem.vue:108`).

Minor notes (no action needed unless touched):
- `AttributeTooltip.vue` title uses `font-semibold` (theme not scanned by U11); align to `font-medium`.
- 17 multi-sentence tooltips without a final period read half-punctuated (`git.toolbar.pullLast.tooltip`, `git.undo.tooltip*`). P265 rule 3 permits it; rewrite as one clause if touched.
- `TooltipArrow` uses stock `rounded-xs`.
- Overflow tooltips: item 6.

---

## Gaps ranked (value against size)

1. Truncation (6): `TruncatedText` has 0 users; 32 always-on reveal tooltips in 23 files; 67 three-class truncate spellings. P264 §2.19 decided, not applied. Medium, mechanical.
2. Async button pending (8): `Button pending` 1 user vs 49 disabled-by-pending in 40 files, 4 hand spinners. P264 §2.22 decided, not applied. Medium, mechanical.
3. Grey text roles (1): 59 files mix both greys; empty lines 28 muted vs 21 subtle. Needs the written rule; about 60 files.
4. Elevation (3): primitives on `z-50` beside a token ladder; `PopoverContent` stock `shadow-md`; dialogs shadowless against P263 §2.10. 9 theme files + 5 app files; fixes a real stacking bug (UL#9).
5. Button hover and state looks (7): `dialog`/`dialog-primary` have no hover; 13 hover-colour overrides; 10 opacity-as-muted sites; no readonly look. 1 cva + about 25 files.
6. Cursor (2): primitives disagree (menu row hand vs dropdown item arrow); 72 pointer; one pointer on a dead span. 4 primitives + about 45 files.
7. Loading delay (8): only `QueryState` delays; 7 pane spinners and 11 inline loading lines flash; 3 mobile screens text-only. 2 theme files + 10 sites.
8. Counts (14, 12): three tab-count looks, count pills on plain counts, `tabular-nums` 2 uses, `t()` groups only `count`. 1 i18n file + 8 files + catalog keys.
9. Formatting (9): theme duplicates durations because formatters live in workbench; `AppMetricsItem` restates `formatPercent`; Go S3 `formatBytes` differs. Move pure formatters to theme; 9 files.
10. Titles (4): Space settings panes and `RepoConfigForm` hand-roll section titles; ADE empty lines at title size. 7 files beyond UL#1.
11. Identifiers (10): no shared display; UI font on some shas, branches, paths; three copy mechanisms. New component + about 20 sites.
12. Icons (13): theme files unscanned; `iconSize` bypass; 5 unsized icons. Make size a literal-union prop; 10 files.
13. Sort (11): two worktree orders, 2 code-unit sorts, 6 comparators without a tie-break. 8 files.
14. Dialog (5): 5 header icons, 2 header descriptions, 1 double-emphasis footer. 8 files.
15. Tooltips (15): unified; 3 cosmetic notes.

## Guard additions (consolidated, beyond UL's list)

- `overflow-hidden text-ellipsis whitespace-nowrap`; `<TooltipTrigger…>` wrapping a `truncate` element.
- `<Button … :disabled="…pending|busy|saving…"`; `<Spinner` inside `<Button>`.
- `cursor-pointer` outside link variant, `linkify.ts`, `badgeClass.ts`; `cursor-(help|copy)`.
- Stock `shadow-(sm|md|lg|xl|2xl)` in `check-theme-classes.sh`; bare `z-\d{2,}` once primitives use the ladder.
- `hover:text-(ok|error|warn|primary)`; `opacity-(40|60|70|75|80)` outside disabled/drag.
- `toFixed\(` in `.vue` and theme non-format files; `\}\}%`.
- `<DialogHeader … icon=`; `<h[1-6]` outside view-title files.
- `CodiconIcon size` and `TooltipIconButton iconSize` typed `12 | 13 | 16 | 24` (typecheck, no regex).
- `t()` numeric params: catalog checker flags `({count})` in labels.
