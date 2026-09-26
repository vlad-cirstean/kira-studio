# P123 — Font-size site list (appendix to `P123-font-size-normalization.md`)

Every font-size-bearing site in both apps' frontend trees at `907c8204`, grouped by file. 1033 sites,
215 files. Scanned roots: `SF/`, `KF/`, `PT/`, `WB/`, `GU/`, `KU/` (prefixes as in the plan).
Excluded: `node_modules`, `dist`, tests. Comment-only lines are excluded, except continuation
lines inside a comment block (marked `reword`).

Sources scanned: every `text-<size>` utility (any variant chain, `kv:` included, stock and
arbitrary sizes), every CSS `font-size:` declaration, every `<CodiconIcon size>` and every
`.style.fontSize` assignment.

Columns. Line numbers are at `907c8204`; re-find by content if an earlier edit shifted them.
After:

- `keep`: token unchanged.
- a token: replace Before with it.
- `delete`: remove the token, because the primitive's base supplies the size.
- `reword`: comment edit only (plan §3.7).
- `dot`: plan §3.5.
- `untouched (data view)`: plan §2.3; must stay byte-identical.

Role names the plan §1 rule that decided the row.

### `GU/App.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 1735 | `kv:text-base` | keep | on scale |
| 1998 | `kv:text-xs` | `kv:text-base` | hover popover body |

### `GU/components/AppToolbar.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 320 | `kv:text-sm` | keep | toolbar status chip |
| 418 | `kv:text-sm` | keep | secondary |
| 458 | `kv:text-sm` | keep | toolbar status chip |
| 481 | `kv:text-sm` | keep | toolbar status chip |

### `GU/components/BranchPicker.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 681 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 686 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 696 | `kv:text-xs` | `kv:text-base` | hover popover body |
| 703 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 721 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 729 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/CommitGrid.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 1258 | `kv:text-base` | untouched (data view) | commit graph (graph font size setting) |
| 1535 | `font-size:var(--kv-t-md)` | untouched (data view) | commit graph (graph font size setting) |
| 1587 | `font-size:var(--kv-t-md)` | untouched (data view) | commit graph (graph font size setting) |
| 1624 | `font-size:var(--kv-t-sm)` | untouched (data view) | commit graph (graph font size setting) |
| 1698 | `font-size:var(--kv-t-xs)` | untouched (data view) | commit graph (graph font size setting) |

### `GU/components/CommitMeta.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 314 | `kv:text-base` | `kv:text-lg` | commit subject heading |
| 325 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 362 | `kv:text-base` | keep | on scale |
| 369 | `kv:text-sm` | keep | secondary |
| 372 | `kv:text-sm` | keep | secondary |
| 374 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 378 | `kv:text-sm` | keep | secondary |
| 390 | `kv:text-sm` | keep | metadata grid (secondary, pairs 378) |

Icons, untouched: `kv:text-lg` x1.

### `GU/components/ConflictBanner.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 104 | `kv:text-sm` | keep | secondary |
| 145 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 155 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 161 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 167 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/ConnectionBanner.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 94 | `kv:text-sm` | keep | secondary |

### `GU/components/EmptyRepositoryPanel.vue`

Icons, untouched: `kv:text-[24px]` x1.

### `GU/components/FileTree.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 495 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 555 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 599 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 613 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 621 | `kv:text-[0.5em]` | dot | glyph becomes kv:size-1 kv:rounded-full kv:bg-diff-modified |
| 679 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 720 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 726 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 740 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 748 | `kv:text-[0.5em]` | dot | glyph becomes kv:size-1 kv:rounded-full kv:bg-diff-modified |

Icons, untouched: `kv:text-codicon` x2.

### `GU/components/GitBlockedPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 32 | `kv:text-lg` | keep | on scale |

Icons, untouched: `kv:text-[32px]` x1.

### `GU/components/NoRepositoryPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 64 | `kv:text-lg` | keep | on scale |

Icons, untouched: `kv:text-[32px]` x1.

### `GU/components/RefSectionHeader.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/SearchBox.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 263 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 273 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 283 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 293 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 300 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 314 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/SearchResults.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 95 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 102 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 130 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 138 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 139 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 142 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 149 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 154 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 159 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 164 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 167 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 172 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/ShowMoreButton.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 17 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/StackList.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 114 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 141 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 142 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 180 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 198 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/StashDetailPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 64 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/StashRows.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 108 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 114 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 119 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 120 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 121 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 129 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/TagList.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 124 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 127 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 132 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 140 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/UncommittedChangesStrip.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 159 | `kv:text-sm` | keep | secondary |

### `GU/components/UndoButton.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 48 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 54 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/WorktreeList.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 139 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 140 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 141 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 144 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 148 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 179 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/dialogs/CheckoutDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 85 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 93 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |

### `GU/components/dialogs/CherryPickDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 92 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 98 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 104 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |

### `GU/components/dialogs/PreflightPrediction.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 32 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |

### `GU/components/dialogs/RepoSettingsDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 192 | `kv:text-sm` | `kv:text-lg` | dialog section heading |
| 206 | `kv:text-sm` | `kv:text-lg` | dialog section heading |
| 229 | `kv:text-sm` | `kv:text-lg` | dialog section heading |
| 242 | `kv:text-sm` | `kv:text-lg` | dialog section heading |
| 254 | `kv:text-sm` | `kv:text-lg` | dialog section heading |
| 266 | `kv:text-sm` | `kv:text-lg` | dialog section heading |
| 274 | `kv:text-sm` | `kv:text-lg` | dialog section heading |
| 291 | `kv:text-sm` | `kv:text-lg` | dialog section heading |

### `GU/components/dialogs/ResetDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 93 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 156 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |

### `GU/components/dialogs/StackDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 150 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 166 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |

### `GU/components/dialogs/StashDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 347 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 357 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 379 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |

### `GU/components/dialogs/WorktreeDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 371 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 381 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/review/BaseSelector.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 126 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 144 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 152 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 157 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/components/review/ReviewCommentsPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 73 | `kv:text-sm` | keep | secondary |
| 96 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |
| 134 | `kv:text-sm` | keep | secondary |
| 151 | `kv:text-sm` | `kv:text-base` | default (control/row/body) |

### `GU/components/review/ReviewCommitRow.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 230 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

Icons, untouched: `kv:text-codicon` x1.

### `GU/components/review/ReviewFilesPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 106 | `kv:text-sm` | keep | secondary |

### `GU/components/review/ReviewView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 793 | `kv:text-base` | keep | on scale |
| 829 | `kv:text-lg` | keep | on scale |
| 839 | `kv:text-lg` | keep | on scale |
| 851 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 868 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |
| 930 | `kv:text-xs` | `kv:text-sm` | xs retired: secondary |

### `GU/theme/app-shell.css`

Icons, untouched: `font-size:11px` x1.

### `GU/theme/readTokens.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 72 | `style.fontSize=`var(${token})`` | untouched (data view) | token probe for canvas graph |

### `KF/repo/GitPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 335 | `text-kira-sm` | keep | secondary |
| 439 | `text-kira-sm` | keep | secondary |
| 471 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 496 | `text-kira-sm` | keep | secondary |
| 523 | `text-kira-sm` | keep | secondary |
| 530 | `text-kira-sm` | keep | secondary |
| 534 | `text-kira-sm` | keep | secondary |
| 605 | `text-kira-md` | keep | on scale |
| 617 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=12` x4, `size=13` x1, `size=14` x1, `size=16` x1, `size=24` x2.

### `KF/repo/GitStart.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 31 | `text-kira-md` | keep | on scale |
| 37 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x1, `size=24` x1.

### `KF/repo/RepoSearchRow.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 81 | `text-kira-md` | keep | on scale |
| 115 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 120 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 129 | `text-kira-md` | keep | on scale |
| 144 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `KF/repo/RepoTreeRow.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 95 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=16` x1.

### `KF/views/repo/RepoDiffView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 135 | `text-kira-md` | keep | on scale |
| 142 | `text-kira-md` | keep | on scale |
| 149 | `text-kira-md` | keep | on scale |
| 156 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x1, `size=24` x4.

### `KF/views/repo/RepoFileView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 303 | `text-kira-md` | untouched (data view) | markdown reading view root |
| 315 | `text-kira-md` | keep | on scale |
| 322 | `text-kira-md` | keep | on scale |
| 329 | `text-kira-md` | keep | on scale |
| 336 | `text-kira-md` | keep | on scale |
| 372 | `text-[1.6em]` | untouched (data view) | markdown reading view content styles |
| 375 | `text-[1.4em]` | untouched (data view) | markdown reading view content styles |
| 378 | `text-[1.2em]` | untouched (data view) | markdown reading view content styles |
| 381 | `text-[1.05em]` | untouched (data view) | markdown reading view content styles |
| 385 | `text-[1em]` | untouched (data view) | markdown reading view content styles |
| 407 | `text-kira-sm` | untouched (data view) | markdown reading view content styles |
| 417 | `text-kira-md` | untouched (data view) | markdown reading view content styles |

Icons, untouched: `size=24` x4.

### `KF/views/repo/RepoGraphView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 115 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=24` x1.

### `KF/views/repo/RepoMultiDiffView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 123 | `text-kira-md` | keep | on scale |
| 136 | `text-kira-sm` | keep | secondary |
| 160 | `text-kira-md` | keep | on scale |
| 167 | `text-kira-md` | keep | on scale |
| 174 | `text-kira-md` | keep | on scale |
| 181 | `text-kira-md` | keep | on scale |
| 190 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x1, `size=24` x6.

### `KF/views/repo/ReviewThread.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 60 | `text-xs` | `text-kira-md` | review thread body (view-zone chrome) |

Icons, untouched: `size=13` x3.

### `KF/workbench/GitCredentialDialog.vue`

Icons, untouched: `size=13` x1.

### `KF/workbench/GitPairingDialog.vue`

Icons, untouched: `size=13` x1.

### `KF/workbench/SettingsDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 90 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 93 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `KF/workbench/StatusBar.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 74 | `text-kira-sm` | keep | comment, still accurate (blame button inherits status-bar sm) |

Icons, untouched: `size=13` x1.

### `KF/workbench/WorkbenchShell.vue`

Icons, untouched: `size=13` x1.

### `KF/workbench/settings/AppearancePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 59 | `text-kira-sm` | delete | Label base supplies md |

Icons, untouched: `size=10` x1.

### `KF/workbench/settings/ConnectedEditorsPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 64 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 69 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 94 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 102 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 118 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `KF/workbench/settings/DateFormatField.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 35 | `text-kira-sm` | delete | Label base supplies md |

### `KF/workbench/settings/GitPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 86 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 92 | `text-kira-sm` | delete | Label base supplies md |
| 117 | `text-kira-sm` | delete | Label base supplies md |
| 150 | `text-kira-sm` | delete | Label base supplies md |
| 175 | `text-kira-sm` | delete | Label base supplies md |

### `KU/KuiButton.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 38 | `kv:text-kui-sm` | `kv:text-kui-base` | default (control/row/body) |
| 102 | `kv:text-[0.75em]` | `kv:text-kui-sm` | count badge |

### `KU/KuiDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 83 | `kv:text-lg` | keep | on scale |

### `KU/KuiIconBox.vue`

Icons, untouched: `kv:text-kui-icon` x1.

### `KU/KuiMenuList.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 138 | `kv:text-kui-xs` | `kv:text-kui-sm` | xs retired: secondary |
| 170 | `kv:text-kui-xs` | `kv:text-kui-sm` | xs retired: secondary |

### `KU/KuiSearchInput.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 97 | `kv:text-kui-sm` | `kv:text-kui-base` | default (control/row/body) |

Icons, untouched: `kv:text-kui-icon` x1.

### `KU/KuiSegmented.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 26 | `kv:text-kui-sm` | `kv:text-kui-base` | default (control/row/body) |
| 72 | `kv:text-kui-xs` | `kv:text-kui-sm` | xs retired: secondary |

### `KU/KuiSelect.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 35 | `kv:text-kui-sm` | `kv:text-kui-base` | default (control/row/body) |

Icons, untouched: `kv:text-kui-icon` x1.

### `KU/KuiTextInput.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 21 | `kv:text-kui-sm` | `kv:text-kui-base` | default (control/row/body) |

### `KU/KuiTooltip.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 57 | `kv:text-kui-sm` | `kv:text-kui-base` | default (control/row/body) |

### `KU/rowVariants.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 19 | `kv:text-kui-base` | keep | on scale |

### `PT/NumberStepperInput.vue`

Icons, untouched: `size=9` x2.

### `PT/RunState.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 41 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `PT/base.css`

| Line | Before | After | Role |
|---|---|---|---|
| 167 | `text-kira-md` | keep | on scale |
| 212 | `font-size:var(--kira-font-size)` | `var(--kira-t-md)` | body default (same value) |

### `PT/components/TooltipIconButton.vue`

Icons, untouched: `size=iconSize` x2.

### `PT/components/ui/alert/AlertDescription.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `text-sm` | `text-kira-md` | alert body |

### `PT/components/ui/alert/index.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 10 | `text-sm` | `text-kira-md` | alert body |

### `PT/components/ui/badge/index.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 12 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `PT/components/ui/button/index.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 7 | `text-sm` | `text-kira-md` | base |
| 44 | `text-xs` | delete | size variant; base supplies md |
| 45 | `text-[0.8rem]` | delete | size variant; base supplies md |
| 56 | `text-kira-sm` | delete | size variant; base supplies md |
| 58 | `text-kira-sm` | delete | size variant; base supplies md |
| 62 | `text-kira-sm` | delete | size variant; base supplies md |

### `PT/components/ui/command/CommandEmpty.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 24 | `text-sm` | `text-kira-md` | full-list empty |

### `PT/components/ui/command/CommandGroup.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 37 | `**:[[cmdk-group-heading]]:text-xs` | `**:[[cmdk-group-heading]]:text-kira-sm` | group heading |

### `PT/components/ui/command/CommandInput.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 37 | `text-sm` | `text-kira-md` | input |

### `PT/components/ui/command/CommandItem.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 70 | `text-sm` | `text-kira-md` | menu row |

### `PT/components/ui/command/CommandShortcut.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `text-xs` | `text-kira-sm` | shortcut |

### `PT/components/ui/dialog/DialogContent.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 36 | `text-sm` | `text-kira-md` | dialog body |

### `PT/components/ui/dialog/DialogDescription.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 19 | `text-sm` | `text-kira-sm` | dialog description |

### `PT/components/ui/dialog/DialogTitle.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 19 | `text-kira-lg` | keep | on scale |
| 24 | `text-kira-lg` | keep | on scale |
| 25 | `text-base` | reword | comment names retired token |
| 26 | `text-base` | reword | comment names retired token |
| 26 | `text-kira-lg` | reword | comment names retired token |
| 27 | `text-kira-lg` | keep | on scale |

### `PT/components/ui/dropdown-menu/DropdownMenuCheckboxItem.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 26 | `text-sm` | `text-kira-md` | menu row |

### `PT/components/ui/dropdown-menu/DropdownMenuItem.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 27 | `text-sm` | `text-kira-md` | menu row |

### `PT/components/ui/dropdown-menu/DropdownMenuLabel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 19 | `text-xs` | `text-kira-sm` | menu group label |

### `PT/components/ui/dropdown-menu/DropdownMenuRadioItem.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 27 | `text-sm` | `text-kira-md` | menu row |

### `PT/components/ui/dropdown-menu/DropdownMenuShortcut.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `text-xs` | `text-kira-sm` | shortcut |

### `PT/components/ui/dropdown-menu/DropdownMenuSubTrigger.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 24 | `text-sm` | `text-kira-md` | menu row |

### `PT/components/ui/empty/EmptyContent.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 14 | `text-sm` | `text-kira-md` | empty body |

### `PT/components/ui/empty/EmptyDescription.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 14 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `PT/components/ui/empty/EmptyTitle.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `text-kira-md` | keep | on scale |

### `PT/components/ui/field/FieldDescription.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `PT/components/ui/field/FieldError.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 39 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `PT/components/ui/field/FieldLegend.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `text-kira-sm` | keep | secondary |

### `PT/components/ui/field/FieldSeparator.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 16 | `text-sm` | `text-kira-sm` | separator caption |

### `PT/components/ui/field/FieldTitle.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 14 | `text-sm` | `text-kira-md` | field title (label role) |

### `PT/components/ui/field/index.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 6 | `text-kira-sm` | `text-kira-md` | field root |

### `PT/components/ui/input-group/InputGroupText.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `text-sm` | `text-kira-md` | addon text |

### `PT/components/ui/input-group/index.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 14 | `text-sm` | `text-kira-md` | addon text |
| 50 | `text-kira-sm` | `text-kira-md` | kira filter box (control text) |
| 60 | `text-sm` | `text-kira-md` | button text |

### `PT/components/ui/input/index.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 12 | `file:text-sm` | `file:text-kira-md` | file-button text; base also gains text-kira-md |
| 16 | `text-base` | delete | size variant; base supplies md |
| 16 | `md:text-sm` | delete | size variant; base supplies md |
| 17 | `text-kira-sm` | delete | size variant; base supplies md |
| 18 | `text-kira-sm` | delete | size variant; base supplies md |

### `PT/components/ui/label/Label.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 19 | `text-sm` | `text-kira-md` | label |

### `PT/components/ui/native-select/index.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 22 | `text-kira-sm` | `text-kira-md` | control text |

### `PT/components/ui/popover/PopoverContent.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 37 | `text-sm` | `text-kira-md` | popover body |

### `PT/components/ui/popover/PopoverHeader.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 13 | `text-sm` | `text-kira-md` | popover header |

### `PT/components/ui/textarea/Textarea.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 24 | `text-base` | `text-kira-md` | control text |
| 24 | `md:text-sm` | delete | responsive override dropped |

### `PT/components/ui/toggle/index.ts`

| Line | Before | After | Role |
|---|---|---|---|
| 7 | `text-sm` | `text-kira-md` | base |
| 17 | `text-[0.8rem]` | delete | size variant; base supplies md |
| 22 | `text-kira-sm` | delete | size variant; base supplies md |

### `PT/components/ui/tooltip/TooltipContent.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 27 | `text-xs` | `text-kira-md` | tooltip body (12px, same px) |

### `PT/review-decorations.css`

| Line | Before | After | Role |
|---|---|---|---|
| 50 | `font-size:12px` | `var(--kira-t-md)` | load-error banner (chrome) |
| 58 | `font-size:12px` | `var(--kira-t-md)` | load-error retry button (chrome) |

### `SF/api/ApiStart.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 36 | `text-kira-xl` | keep | on scale |
| 37 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x4, `size=32` x1.

### `SF/api/BulkVariablesEditor.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 140 | `text-kira-sm` | keep | secondary |

### `SF/api/CollectionRow.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 129 | `text-kira-md` | keep | on scale |
| 158 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 167 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x1.

### `SF/api/CollectionsPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 126 | `text-kira-sm` | keep | secondary |
| 186 | `text-kira-sm` | keep | uppercase section toggle |

Icons, untouched: `size=13` x3, `size=24` x1.

### `SF/api/CopyAsCurlDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 120 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=13` x1.

### `SF/api/DynamicValuesDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 111 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x3, `size=24` x1.

### `SF/api/EditRawRequestDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 93 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=13` x1.

### `SF/api/EnvironmentSelect.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 100 | `text-kira-md` | keep | on scale |
| 115 | `text-kira-md` | keep | on scale |
| 134 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=12` x1, `size=13` x2.

### `SF/api/EnvironmentsView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 235 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x6, `size=24` x2.

### `SF/api/ImportCurlDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 86 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=13` x1.

### `SF/api/MethodSelect.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 58 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=12` x1, `size=13` x1.

### `SF/api/SaveRequestDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 98 | `text-kira-sm` | delete | Label base supplies md |
| 101 | `text-kira-sm` | delete | Label base supplies md |

Icons, untouched: `size=13` x1.

### `SF/api/VariableHistoryMenu.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 51 | `text-kira-sm` | keep | secondary |
| 53 | `text-sm` | reword | comment names retired token |

Icons, untouched: `size=24` x1.

### `SF/api/VariableRow.vue`

Icons, untouched: `size=10` x1, `size=13` x2.

### `SF/api/VariableSetView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 477 | `text-kira-md` | keep | on scale |
| 550 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 560 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 608 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=13` x3, `size=24` x1.

### `SF/api/VariablesOverviewPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 167 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 177 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 187 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |

Icons, untouched: `size=13` x2, `size=24` x2.

### `SF/editor/MonacoHost.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 627 | `text-kira-md` | untouched (data view) | editor fallback pre |
| 672 | `text-kira-xs` | `text-kira-md` | hover-widget prose (chrome) |

### `SF/project/ConnectionDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 695 | `text-kira-lg` | `text-kira-md` | row text beside tabs, not a title |
| 708 | `text-kira-sm` | `text-kira-md` | tab |
| 719 | `text-kira-sm` | `text-kira-md` | tab |
| 730 | `text-kira-sm` | `text-kira-md` | tab |
| 741 | `text-kira-sm` | `text-kira-md` | tab |
| 752 | `text-kira-sm` | `text-kira-md` | tab |
| 765 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 766 | `text-kira-sm` | delete | Label base supplies md |
| 769 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 770 | `text-kira-sm` | delete | Label base supplies md |
| 790 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 792 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 796 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 797 | `text-kira-sm` | delete | Label base supplies md |
| 815 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 816 | `text-kira-sm` | delete | Label base supplies md |
| 831 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 835 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 836 | `text-kira-sm` | delete | Label base supplies md |
| 844 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 845 | `text-kira-sm` | delete | Label base supplies md |
| 853 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 855 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 856 | `text-kira-sm` | delete | Label base supplies md |
| 864 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 865 | `text-kira-sm` | delete | Label base supplies md |
| 875 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 876 | `text-kira-sm` | delete | Label base supplies md |
| 885 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 886 | `text-kira-sm` | delete | Label base supplies md |
| 894 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 895 | `text-kira-sm` | delete | Label base supplies md |
| 918 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 919 | `text-kira-sm` | delete | Label base supplies md |
| 928 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 933 | `text-kira-sm` | delete | Label base supplies md |
| 943 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 946 | `text-kira-sm` | delete | Label base supplies md |
| 956 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 964 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 965 | `text-kira-sm` | delete | Label base supplies md |
| 977 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 980 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 988 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 989 | `text-kira-sm` | delete | Label base supplies md |
| 998 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1001 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1006 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1008 | `text-kira-sm` | delete | Label base supplies md |
| 1018 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1028 | `text-kira-sm` | delete | Label base supplies md |
| 1038 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1044 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 1046 | `text-kira-sm` | delete | Label base supplies md |
| 1059 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1062 | `text-kira-sm` | delete | Label base supplies md |
| 1073 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1078 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 1079 | `text-kira-sm` | delete | Label base supplies md |
| 1097 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 1098 | `text-kira-sm` | delete | Label base supplies md |
| 1116 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 1117 | `text-kira-sm` | delete | Label base supplies md |
| 1135 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1143 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1149 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1170 | `text-kira-sm` | delete | Label base supplies md |
| 1181 | `text-kira-sm` | delete | Label base supplies md |
| 1203 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1218 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1219 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1243 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1257 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=10` x7, `size=13` x8.

### `SF/project/DataGripImportDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 182 | `text-kira-md` | keep | on scale |
| 205 | `text-kira-sm` | keep | secondary |
| 208 | `text-kira-sm` | keep | secondary |
| 227 | `text-kira-sm` | keep | secondary |
| 259 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=10` x1, `size=12` x1, `size=13` x2, `size=15` x2.

### `SF/project/ErrorPopover.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 79 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 95 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x1.

### `SF/project/FiltersDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 171 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 178 | `text-kira-sm` | `text-kira-lg` | dialog section heading |
| 180 | `text-kira-xs` | `text-kira-md` | list-toolbar link button |
| 181 | `text-kira-xs` | `text-kira-md` | list-toolbar link button |
| 199 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 200 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 202 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 208 | `text-kira-sm` | `text-kira-lg` | dialog section heading |
| 210 | `text-kira-xs` | `text-kira-md` | list-toolbar link button |
| 211 | `text-kira-xs` | `text-kira-md` | list-toolbar link button |
| 255 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 260 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 262 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 263 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 278 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 285 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=10` x2, `size=12` x1, `size=13` x3.

### `SF/project/SchemaDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 143 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 167 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 177 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 180 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x1.

### `SF/project/TreeRow.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 128 | `text-kira-md` | keep | on scale |
| 216 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=13` x3.

### `SF/terminal/TerminalPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 142 | `text-kira-sm` | keep | secondary |
| 206 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 231 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 244 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=12` x1, `size=13` x2, `size=24` x1.

### `SF/terminal/TerminalStart.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 30 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x1, `size=24` x1.

### `SF/views/browse/BrowseView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 296 | `text-kira-md` | keep | on scale |
| 413 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 426 | `text-kira-sm` | keep | secondary |
| 429 | `text-kira-sm` | `text-kira-md` | full-pane loading |
| 430 | `text-kira-sm` | `text-kira-md` | full-pane empty |
| 435 | `text-kira-sm` | `text-kira-md` | full-pane error |
| 493 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 515 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x4, `size=24` x1.

### `SF/views/console/ConsoleResultGrid.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 325 | `text-kira-md` | untouched (data view) | console result grid |
| 329 | `text-kira-sm` | untouched (data view) | console result grid |
| 332 | `text-kira-sm` | untouched (data view) | console result grid |

### `SF/views/console/ConsoleSavedMenu.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 111 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x1.

### `SF/views/console/ConsoleView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 641 | `text-kira-md` | keep | on scale |
| 830 | `text-[length:inherit]` | delete | preflight button font:inherit already inherits |
| 884 | `text-kira-xs` | `text-kira-md` | result tab |
| 918 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=11` x1, `size=13` x7.

### `SF/views/console/ExplainResultView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 97 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 111 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 116 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 151 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 154 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 155 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 156 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 169 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 175 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=12` x2, `size=14` x1.

### `SF/views/definition/ColumnsSection.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 19 | `text-kira-sm` | keep | secondary |
| 21 | `text-kira-sm` | keep | secondary |
| 48 | `text-kira-sm` | keep | secondary |
| 51 | `text-kira-md` | keep | on scale |
| 80 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 81 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x2.

### `SF/views/definition/ConstraintsSection.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 46 | `text-kira-sm` | keep | secondary |
| 48 | `text-kira-sm` | keep | secondary |
| 55 | `text-kira-sm` | keep | secondary |
| 58 | `text-kira-md` | keep | on scale |
| 76 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 77 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `SF/views/definition/DefinitionView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 230 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x7.

### `SF/views/definition/IndexesSection.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 12 | `text-kira-sm` | keep | secondary |
| 14 | `text-kira-sm` | keep | secondary |
| 21 | `text-kira-sm` | keep | secondary |
| 24 | `text-kira-md` | keep | on scale |

### `SF/views/definition/PropertiesSection.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 22 | `text-kira-sm` | keep | secondary |
| 28 | `text-kira-md` | keep | on scale |
| 33 | `text-kira-sm` | keep | secondary |

### `SF/views/definition/ValidationSection.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 30 | `text-kira-sm` | keep | secondary |
| 43 | `text-kira-md` | keep | on scale |

### `SF/views/documents/DocumentView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 658 | `text-kira-md` | keep | on scale |
| 960 | `text-kira-md` | keep | on scale |
| 970 | `text-kira-md` | keep | on scale |
| 1057 | `text-kira-sm` | untouched (data view) | document search-hit snippet |

Icons, untouched: `size=13` x3, `size=24` x2.

### `SF/views/documents/ProjectionMenu.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 88 | `text-kira-sm` | keep | secondary |
| 92 | `text-kira-md` | keep | on scale |
| 105 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=10` x1.

### `SF/views/grid/ColumnsMenu.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 109 | `text-kira-sm` | keep | secondary |
| 116 | `text-kira-md` | keep | on scale |
| 149 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=10` x2, `size=13` x1.

### `SF/views/grid/DataToolbar.vue`

Icons, untouched: `size=13` x2.

### `SF/views/grid/DataView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 199 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x1, `size=16` x4.

### `SF/views/grid/FkPreviewPopover.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 168 | `text-kira-sm` | `text-kira-md` | popover body table |

Icons, untouched: `size=13` x1, `size=14` x1.

### `SF/views/grid/PreviewCommandPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 60 | `text-kira-sm` | keep | panel header |
| 71 | `text-kira-sm` | keep | secondary |
| 74 | `text-kira-sm` | keep | secondary |
| 79 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=13` x1.

### `SF/views/grid/SlickGridHost.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 1060 | `style.fontSize='13px'` | untouched (data view) | SQL/result grid host |
| 2648 | `text-kira-md` | untouched (data view) | SQL/result grid host |
| 2656 | `text-kira-md` | untouched (data view) | SQL/result grid host |

Icons, untouched: `size=24` x2.

### `SF/views/grpcrequest/CallHistoryList.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 96 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 163 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 166 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 180 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x3, `size=24` x2.

### `SF/views/grpcrequest/GrpcRequestView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 288 | `text-kira-md` | keep | on scale |
| 294 | `text-kira-lg` | keep | on scale |

Icons, untouched: `size=13` x5.

### `SF/views/grpcrequest/ResponsePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 302 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 303 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 338 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 396 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 397 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 401 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 404 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 405 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 409 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 434 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 435 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 447 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 471 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |

Icons, untouched: `size=12` x1, `size=24` x1.

### `SF/views/grpcrequest/SchemaBrowser.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 162 | `text-kira-sm` | keep | secondary |
| 166 | `text-kira-md` | keep | on scale |
| 169 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 180 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 220 | `text-kira-sm` | keep | secondary |
| 228 | `text-kira-md` | keep | on scale |
| 233 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |

Icons, untouched: `size=13` x3, `size=24` x2.

### `SF/views/httprequest/BinaryBodyPicker.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 45 | `text-kira-sm` | keep | secondary |

### `SF/views/httprequest/CookiesPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 97 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 127 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 133 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 137 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 151 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 160 | `text-kira-sm` | keep | secondary |
| 162 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 166 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 176 | `text-kira-sm` | keep | secondary |
| 178 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 182 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x2, `size=24` x4.

### `SF/views/httprequest/FormDataTable.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 140 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `SF/views/httprequest/HttpRequestView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 502 | `text-kira-md` | keep | on scale |
| 509 | `text-kira-lg` | keep | on scale |

Icons, untouched: `size=13` x5.

### `SF/views/httprequest/RawExchangePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 240 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=24` x2.

### `SF/views/httprequest/RequestBodyPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 192 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

### `SF/views/httprequest/RequestSettingsPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 93 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 110 | `text-kira-sm` | delete | Label base supplies md |
| 139 | `text-kira-sm` | delete | Label base supplies md |
| 169 | `text-kira-sm` | delete | Label base supplies md |
| 208 | `text-kira-sm` | delete | Label base supplies md |
| 234 | `text-kira-sm` | delete | Label base supplies md |
| 251 | `text-kira-sm` | delete | Label base supplies md |
| 291 | `text-kira-sm` | delete | Label base supplies md |
| 306 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |

Icons, untouched: `size=10` x10.

### `SF/views/httprequest/ResponseDiffDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 251 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 258 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 271 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 272 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 279 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 292 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 293 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 302 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 311 | `text-kira-xs` | `text-kira-md` | summary toggle text |
| 314 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 321 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 328 | `text-kira-xs` | `text-kira-md` | summary toggle text |
| 331 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 345 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 348 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `before:text-kira-lg` x1, `size=13` x1.

### `SF/views/httprequest/ResponseHistoryList.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 120 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 208 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 219 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 220 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 221 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 230 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 235 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=10` x1, `size=13` x3, `size=24` x2.

### `SF/views/httprequest/ResponsePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 326 | `text-kira-xs` | `text-kira-md` | button |
| 335 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 430 | `text-kira-xs` | `text-kira-md` | button |
| 458 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 464 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 488 | `text-kira-sm` | keep | secondary |
| 508 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |

Icons, untouched: `size=13` x2, `size=24` x2.

### `SF/views/httprequest/TimelinePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 217 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 220 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 237 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 264 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 280 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 286 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 290 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 300 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 304 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `before:text-kira-lg` x2, `size=24` x3.

### `SF/views/shared/AutocompleteField.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 554 | `text-kira-sm` | `text-kira-md` | input overlay must match input |
| 560 | `text-kira-sm` | reword | comment names old token |
| 571 | `text-kira-sm` | `text-kira-md` | input |
| 582 | `text-kira-sm` | `text-kira-md` | input |
| 607 | `text-kira-sm` | `text-kira-md` | completion item |
| 614 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 622 | `text-kira-sm` | `text-kira-md` | variable hover panel body |

Icons, untouched: `size=13` x1.

### `SF/views/shared/DateTimePicker.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 252 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 272 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 279 | `text-kira-md` | keep | on scale |
| 304 | `text-kira-md` | keep | on scale |
| 318 | `text-kira-md` | keep | on scale |

### `SF/views/shared/FilterHistoryMenu.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 170 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x1.

### `SF/views/shared/ResponseFindBar.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 168 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=13` x1.

### `SF/views/shared/SavedListMenu.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 65 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 66 | `text-kira-sm` | keep | secondary |
| 71 | `text-kira-md` | keep | on scale |
| 105 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 106 | `text-kira-sm` | keep | secondary |
| 111 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x1.

### `SF/views/shared/celleditor/CellEditorView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 527 | `text-kira-md` | keep | on scale |
| 607 | `text-kira-md` | keep | on scale |
| 683 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 710 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=12` x1, `size=13` x5.

### `SF/views/shared/celleditor/TimestampPane.vue`

Icons, untouched: `size=13` x1.

### `SF/views/shared/document/DocumentRow.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 62 | `text-kira-md` | untouched (data view) | document/JSON viewer |

Icons, untouched: `size=13` x1.

### `SF/views/shared/document/DocumentTree.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 46 | `text-kira-sm` | untouched (data view) | document/JSON viewer |

Icons, untouched: `size=12` x1.

### `SF/views/shared/fields/FieldRowsTable.vue`

Icons, untouched: `size=10` x1.

### `SF/views/shared/keyvalue/KeyValuePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 729 | `text-kira-md` | keep | on scale |
| 809 | `text-kira-sm` | keep | secondary |
| 872 | `text-kira-sm` | keep | secondary |
| 883 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 915 | `text-kira-sm` | keep | secondary |
| 924 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1027 | `text-kira-sm` | untouched (data view) | key/value result grid (header + rows) |
| 1028 | `text-kira-sm` | untouched (data view) | key/value result grid (header + rows) |
| 1033 | `text-kira-sm` | untouched (data view) | key/value result grid (header + rows) |
| 1085 | `text-kira-xs` | untouched (data view) | key/value result grid (header + rows) |
| 1089 | `text-kira-md` | untouched (data view) | key/value result grid (header + rows) |
| 1110 | `text-kira-md` | untouched (data view) | key/value result grid (header + rows) |

Icons, untouched: `size=13` x2, `size=24` x2.

### `SF/views/shared/page/PagerControls.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 83 | `text-kira-sm` | keep | secondary |

### `SF/views/shared/page/SearchToolbar.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 313 | `text-kira-sm` | keep | secondary |
| 326 | `text-kira-sm` | keep | secondary |
| 356 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 366 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x1.

### `SF/views/shared/slick/slickTheme.css`

| Line | Before | After | Role |
|---|---|---|---|
| 15 | `font-size:var(--kira-t-md)` | untouched (data view) | SQL/result grid theme |
| 147 | `font-size:var(--kira-t-sm)` | untouched (data view) | SQL/result grid theme |
| 302 | `font-size:var(--kira-t-xs)` | untouched (data view) | SQL/result grid theme |
| 621 | `font-size:13px` | untouched (data view) | SQL/result grid theme |
| 639 | `font-size:7px` | untouched (data view) | SQL/result grid theme |
| 644 | `font-size:7px` | untouched (data view) | SQL/result grid theme |
| 661 | `font-size:13px` | untouched (data view) | SQL/result grid theme |
| 690 | `font-size:var(--kira-t-xs)` | untouched (data view) | SQL/result grid theme |
| 718 | `font-size:var(--kira-t-xs)` | untouched (data view) | SQL/result grid theme |

### `SF/views/stream/StreamComposeMessage.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 61 | `text-kira-sm` | keep | panel header |
| 73 | `text-kira-sm` | delete | Label base supplies md |
| 74 | `text-kira-sm` | `text-kira-md` | field label text |
| 84 | `text-kira-sm` | delete | Label base supplies md |
| 85 | `text-kira-sm` | `text-kira-md` | field label text |
| 96 | `text-kira-sm` | delete | Label base supplies md |
| 97 | `text-kira-sm` | `text-kira-md` | field label text |
| 108 | `text-kira-sm` | keep | secondary |

Icons, untouched: `size=13` x1.

### `SF/views/stream/StreamSearchToolbar.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 119 | `text-kira-sm` | keep | secondary |
| 151 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x1.

### `SF/views/stream/StreamView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 643 | `text-kira-md` | keep | on scale |
| 706 | `text-kira-sm` | keep | secondary |
| 827 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 865 | `text-kira-sm` | keep | secondary |
| 870 | `text-kira-sm` | keep | secondary |
| 906 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 945 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 1011 | `text-kira-md` | keep | on scale |
| 1018 | `text-kira-md` | keep | on scale |
| 1028 | `text-kira-md` | keep | on scale |
| 1042 | `text-kira-sm` | untouched (data view) | stream message grid (header + rows) |
| 1043 | `text-kira-sm` | untouched (data view) | stream message grid (header + rows) |
| 1058 | `text-kira-sm` | untouched (data view) | stream message grid (header + rows) |
| 1073 | `text-kira-sm` | untouched (data view) | stream message grid (header + rows) |
| 1088 | `text-kira-sm` | untouched (data view) | stream message grid (header + rows) |
| 1103 | `text-kira-sm` | untouched (data view) | stream message grid (header + rows) |
| 1124 | `text-kira-xs` | untouched (data view) | stream message grid (header + rows) |
| 1134 | `text-kira-md` | untouched (data view) | stream message grid (header + rows) |
| 1147 | `text-kira-md` | untouched (data view) | stream message grid (header + rows) |
| 1159 | `text-kira-md` | untouched (data view) | stream message grid (header + rows) |
| 1171 | `text-kira-md` | untouched (data view) | stream message grid (header + rows) |
| 1183 | `text-kira-sm` | untouched (data view) | stream message grid (header + rows) |
| 1194 | `text-kira-xs` | untouched (data view) | stream message grid (header + rows) |

Icons, untouched: `size=10` x1, `size=13` x7, `size=24` x3.

### `SF/views/terminal/TerminalView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 66 | `text-kira-sm` | keep | secondary |

### `SF/workbench/DbMcpApprovalDialog.vue`

Icons, untouched: `size=13` x1.

### `SF/workbench/GenerateDataDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 236 | `text-kira-sm` | delete | Label base supplies md |
| 244 | `text-kira-sm` | delete | Label base supplies md |
| 252 | `text-kira-sm` | keep | secondary |
| 260 | `text-kira-sm` | keep | secondary |
| 335 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 343 | `text-kira-sm` | keep | secondary |
| 344 | `text-kira-sm` | keep | inline error |
| 370 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x1, `size=14` x4.

### `SF/workbench/StatusBar.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 85 | `text-kira-sm` | keep | status-bar item |
| 95 | `text-kira-sm` | keep | status-bar item |
| 104 | `text-kira-sm` | keep | status-bar item |

Icons, untouched: `size=13` x3.

### `SF/workbench/TitleBar.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 65 | `text-kira-sm` | `text-kira-md` | title-bar item |

Icons, untouched: `size=16` x1.

### `SF/workbench/UploadObjectDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 127 | `text-kira-sm` | keep | secondary |
| 132 | `text-kira-sm` | delete | Label base supplies md |
| 135 | `text-kira-sm` | delete | Label base supplies md |

Icons, untouched: `size=13` x1.

### `SF/workbench/WorkbenchShell.vue`

Icons, untouched: `size=13` x1.

### `SF/workbench/panels/OperationsPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 223 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 256 | `text-kira-md` | keep | on scale |
| 407 | `text-kira-sm` | untouched (data view) | op-detail Monaco editor |

Icons, untouched: `size=13` x3, `size=24` x1.

### `SF/workbench/panels/ProjectPanel.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 34 | `text-kira-sm` | keep | secondary |
| 80 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=12` x1, `size=13` x1, `size=24` x1.

### `SF/workbench/panels/StudioStart.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 61 | `text-kira-xl` | keep | on scale |
| 62 | `text-kira-md` | keep | on scale |
| 98 | `text-kira-xl` | keep | on scale |
| 99 | `text-kira-lg` | `text-kira-md` | start-page list row |
| 102 | `text-kira-sm` | keep | secondary |
| 108 | `text-kira-md` | keep | on scale |
| 119 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x3, `size=32` x1.

### `SF/workbench/settings/AdvancedPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 56 | `text-kira-sm` | delete | Label base supplies md |
| 79 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 83 | `text-kira-sm` | delete | Label base supplies md |

### `SF/workbench/settings/ApiPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 90 | `text-kira-sm` | delete | Label base supplies md |
| 115 | `text-kira-sm` | delete | Label base supplies md |
| 145 | `text-kira-sm` | delete | Label base supplies md |
| 184 | `text-kira-sm` | delete | Label base supplies md |
| 214 | `text-kira-sm` | delete | Label base supplies md |
| 229 | `text-kira-sm` | delete | Label base supplies md |
| 272 | `text-kira-sm` | delete | Label base supplies md |

Icons, untouched: `size=10` x3.

### `SF/workbench/settings/AppearancePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 58 | `text-kira-sm` | delete | Label base supplies md |
| 102 | `text-kira-sm` | untouched (data view) | data-font preview sample |
| 136 | `text-kira-sm` | untouched (data view) | data-row preview sample |
| 140 | `text-kira-sm` | untouched (data view) | data-row preview sample |
| 145 | `text-kira-sm` | untouched (data view) | data-row preview sample |
| 151 | `text-kira-xs` | untouched (data view) | data-row preview sample |
| 154 | `text-kira-md` | untouched (data view) | data-row preview sample |
| 157 | `text-kira-md` | untouched (data view) | data-row preview sample |
| 162 | `text-kira-xs` | untouched (data view) | data-row preview sample |
| 165 | `text-kira-md` | untouched (data view) | data-row preview sample |
| 168 | `text-kira-md` | untouched (data view) | data-row preview sample |
| 194 | `text-kira-sm` | delete | Label base supplies md |

Icons, untouched: `size=10` x1.

### `SF/workbench/settings/CachePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 64 | `text-kira-sm` | delete | Label base supplies md |
| 88 | `text-kira-sm` | delete | Label base supplies md |
| 98 | `text-kira-sm` | delete | Label base supplies md |

### `SF/workbench/settings/ClaudeCodePane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 57 | `text-kira-sm` | delete | Label base supplies md |
| 69 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 76 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 98 | `text-kira-sm` | delete | Label base supplies md |

Icons, untouched: `size=10` x2.

### `SF/workbench/settings/DataPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 31 | `text-kira-sm` | delete | Label base supplies md |

### `SF/workbench/settings/DatabaseMcpPane.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 99 | `text-kira-sm` | delete | Label base supplies md |
| 109 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 119 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 137 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 169 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |
| 188 | `text-kira-sm` | `text-kira-md` | default (control/row/body) |
| 219 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=10` x2.

### `WB/components/AppMetricsItem.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 44 | `text-kira-sm` | keep | status-bar item |

Icons, untouched: `size=13` x1.

### `WB/components/BootFailure.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 22 | `text-kira-md` | keep | on scale |
| 23 | `text-kira-xs` | `text-kira-sm` | xs retired: secondary |

Icons, untouched: `size=13` x1, `size=24` x1.

### `WB/components/ConfirmDialog.vue`

Icons, untouched: `size=13` x1.

### `WB/components/ContextMenu.vue`

Icons, untouched: `size=13` x5.

### `WB/components/SettingsShell.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 222 | `text-kira-md` | keep | on scale |

Icons, untouched: `size=13` x2.

### `WB/components/StatusBar.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 18 | `text-kira-sm` | keep | status-bar item |

### `WB/components/TabStrip.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 232 | `text-kira-sm` | `text-kira-md` | tab |
| 273 | `text-kira-sm` | `text-kira-md` | tab |

Icons, untouched: `size=12` x2, `size=13` x3.

### `WB/components/TitleBarWindowActions.vue`

Icons, untouched: `size=15` x1.

### `WB/components/TreeTwisty.vue`

Icons, untouched: `size=13` x1.

### `WB/components/UpdateAvailableItem.vue`

Icons, untouched: `size=13` x1.

### `WB/prompt/TextPromptDialog.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 47 | `text-kira-sm` | `text-kira-md` | prompt text (dialog body) |

### `WB/settings/fields/FontSizeField.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 44 | `text-kira-sm` | delete | Label base supplies md |

### `WB/settings/fields/LogLevelField.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 37 | `text-kira-sm` | delete | Label base supplies md |

### `WB/settings/fields/WordWrapField.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 41 | `text-kira-sm` | delete | Label base supplies md |

Icons, untouched: `size=10` x1.

### `WB/terminal/TerminalHostView.vue`

| Line | Before | After | Role |
|---|---|---|---|
| 56 | `text-kira-sm` | keep | terminal caption strip |
