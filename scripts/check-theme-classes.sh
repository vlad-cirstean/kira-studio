#!/bin/sh
# P110 B5/C1: guards every legacy/retired class name this CSS-to-Tailwind migration renames or
# deletes from ever coming back. Each check greps for one retired name, anchored the same way
# check-tokens.sh anchors --kira-* references: the name must be preceded by whitespace, a quote,
# a backtick, a brace or a colon (i.e. a real class-name token, possibly with a variant chain like
# `hover:`), and not immediately followed by another identifier character or hyphen -- so
# `text-muted` never matches `text-muted-foreground`, and `bg-input` never matches a
# `--kira-bg-input` custom-property reference.
#
# Excludes packages/theme/src/components/ui/ -- shadcn-vue's own registry-authored components
# speak shadcn's own vocabulary (bg-input/30, text-muted-foreground, border-input, ...), which is
# never a "retired name" hit here even where a retired name is a substring of it.
#
# Every commit that retires a class name appends its own `check_class` call here, in the same
# commit that does the rename/deletion (P110 plan §5.12). Never a batch add at the end.
set -e

cd "$(dirname "$0")/.."

FRONTEND_SRC=apps/kira-studio/frontend/src
SPACE_SRC=apps/kira-space/frontend/src
THEME_SRC=packages/theme/src
WORKBENCH_SRC=packages/workbench/src
GIT_UI_SRC=packages/git-ui/src
KIRA_UI_SRC=packages/kira-ui/src

SCAN_DIRS="$FRONTEND_SRC $SPACE_SRC $THEME_SRC $WORKBENCH_SRC"

STATUS=0

# check_class <retired-name> <replacement> [scan-dirs]
# Reports every hit outside packages/theme/src/components/ui/, as file:line:match, so the failure
# output tells the next author what to write instead.
check_class() {
  name="$1"
  replacement="$2"
  dirs="${3:-$SCAN_DIRS}"
  hits=$(grep -rnoP --include='*.vue' --include='*.ts' --include='*.css' \
    -- "(?<![-\\w])(?:[a-z0-9-]+:)*${name}(?![-\\w])" $dirs 2>/dev/null |
    grep -v "^${THEME_SRC}/components/ui/" || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: retired class '$name' still used -- replace with '$replacement':" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}

# check_class_in_attrs <retired-name> <replacement> [scan-dirs]
# Same as check_class, but the retired name is a common English word with real, legitimate prose
# uses in comments/docs (plan §5.11's own warning: "muted is a common word") -- a whole-file grep
# would false-positive on those. Scoped instead to `class="..."`/`:class="..."` attribute VALUES
# only, so a comment using the word never matches.
check_class_in_attrs() {
  name="$1"
  replacement="$2"
  dirs="${3:-$SCAN_DIRS}"
  hits=$(grep -rnoP --include='*.vue' --include='*.ts' \
    -- '(?::?class)="[^"]*"' $dirs 2>/dev/null |
    grep -P "(?<![-\\w])${name}(?![-\\w])" |
    grep -v "^${THEME_SRC}/components/ui/" || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: retired class '$name' still used in a class attribute -- replace with '$replacement':" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}

# check_kui_class <retired-name> <replacement>
# P110 C1: A3-A8 retired every `controls.css` selector in favour of `kv:` utilities/cva variants
# directly on the owning `Kui*` component (A8 deleted `controls.css` itself). Scoped to GU/KU
# (`kui-*` names only ever lived there) and, like check_class_in_attrs, to real `class="..."` /
# `:class="..."` attribute values only -- not check_class's broader scan. Two reasons, both real
# survivors verified by grep, not assumed:
#   1. A3-A8's own commits document the retired selectors inline as `class="kui-x"`-shaped prose in
#      JSDoc comments (KuiIconBox.vue, KuiMenuList.vue, KuiButton.vue, rowVariants.ts, ...) -- a
#      whole-file scan would fail on that documentation, not a regression. Comment lines (a `*`
#      continuation or `//`) are excluded.
#   2. Several retired names collide with real, ongoing non-class identifiers: `kui-icon-box` is
#      also a real `cn.ts` spacing-scale token name, `kui-tooltip`/`kui-segmented-badge` are also a
#      real directive name/`TOOLTIP_ID`/`data-testid`. None of those are `class="..."` attribute
#      values, so the attribute scope leaves them alone.
check_kui_class() {
  name="$1"
  replacement="$2"
  hits=$(grep -rnP --include='*.vue' --include='*.ts' \
    -- '(?::?class)="[^"]*"' "$GIT_UI_SRC" "$KIRA_UI_SRC" 2>/dev/null |
    grep -vP '^[^:]+:[0-9]+:\s*(\*|//|/\*)' |
    grep -P "(?<![-\\w])${name}(?![-\\w])" || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: retired kui-* class '$name' still used -- replace with '$replacement':" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}

# P110 B3/B4: base.css's @theme used to shadow shadcn-bridge.css's own --color-muted; app code's
# text-muted/text-fg-muted are both renamed to shadcn's own text-muted-foreground.
check_class 'text-muted' 'text-muted-foreground'
check_class 'text-fg-muted' 'text-muted-foreground'
# P110 B2: app code's own filled-control surface, renamed off shadcn's bg-input so the two never
# collide in meaning.
check_class 'bg-input' 'bg-field'
# P110 B7: dead primitive -- every consumer already carries the equivalent utilities directly, and
# the unlayered rule was winning over them (11px ring instead of 12px, an accidental box-shadow
# from Tailwind's own `ring` utility name colliding with the `.ring` hook class).
check_class 'p-run-state' 'data-testid="run-state"/"run-state-label" plus plain utilities'
# P110 B8
check_class 'p-panel-head' 'flex items-center shrink-0 h-control-lg (or h-bar) gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider'
# P110 B12: SettingsShell.vue's own panes' shared field-level vocabulary, deleted from
# packages/workbench/src/workbench.css. Guards only the four names with zero legitimate survivors
# repo-wide -- `field`/`field.checkbox`/`field-error`/`helper-text` are deliberately NOT guarded
# here: ConnectionDialog.vue, StreamComposeMessage.vue, SchemaDialog.vue and TerminalPanel.vue each
# keep their own scoped `<style>` redeclaration of those same names (the plan's own named leak
# sites, backfilled to stay self-sufficient after the shared rule's deletion), so those are a
# real, ongoing, local pattern, not a retired one.
check_class 'field-head' 'flex items-center justify-between gap-1'
check_class 'checkbox-row' 'FieldGroup (packages/theme/src/components/ui/field)'
check_class 'sec-label' 'FieldLegend (packages/theme/src/components/ui/field)'
check_class 'settings-pane' 'class="contents" (a SettingsShell.vue pane) or plain utility classes (a standalone panel, e.g. RequestSettingsPane.vue)'
# P110 B13: TitleBar.vue's own action row and WorkbenchShell.vue's own "new tab" button, deleted
# from workbench.css. Guards only the names with zero legitimate survivors repo-wide --
# `tab-strip-actions` is deliberately NOT guarded here: both apps' WorkbenchShell.vue keep
# `data-testid="tab-strip-actions"`, the same string now published as a test id, not a class, so
# it's a real ongoing use, not a retired one. `is-on` is also NOT guarded: AutocompleteField.vue's
# own unrelated `:class="{ 'is-on': ... }"` and primitives.css's own `.p-status.is-on`/
# `.p-completion-row.is-on` (a later B-item's own job) are real, unrelated survivors.
check_class 'title-action' 'Button variant="title" size="title" (packages/theme/src/components/ui/button)'
check_class 'title-action--labelled' 'Button variant="title" size="title-labelled"'
check_class 'title-bar-actions' 'flex items-center gap-0.5 ml-auto wails-no-drag'
check_class 'tab-new' 'inline utility classes on the new-tab button (see WorkbenchShell.vue)'
# P110 B14: audit §3.6's alias classes, deleted from primitives.css one at a time. `mono` is a
# common word outside class contexts too (tokens.css's own LAW 08 prose, a stray doc comment) --
# both were reworded to drop the bare word rather than excluding a path, so this plain check_class
# call has zero legitimate survivors left to false-positive against.
check_class 'mono' 'font-data'
# P110 B15: `muted` is common prose too (design-idiom comments, docs) -- uses the attribute-scoped
# variant above instead of reworking every legitimate comment.
check_class_in_attrs 'muted' 'text-muted-foreground'
# P110 B16: `dim` is common prose too (api-ui-consistency.spec.ts's own test name/comment describe
# it conceptually, no actual `.locator('.dim')` call exists there to move to a data-testid).
check_class_in_attrs 'dim' 'text-subtle'
# P110 B17: `p-sm` is not common prose, so the plain check_class call is enough.
check_class 'p-sm' 'text-kira-sm'
# P110 B18: same reasoning as B17 -- `p-xs` is not common prose.
check_class 'p-xs' 'text-kira-xs'
# P110 B19: `p-push` is not common prose.
check_class 'p-push' 'ml-auto'
# P110 B20: `icon-box` is not common prose.
check_class 'icon-box' 'size-4 flex items-center justify-center shrink-0'
# P110 B22: the badge/chip/count trio, folded into one Badge component
# (packages/theme/src/components/ui/badge). None of the three read as prose.
check_class 'p-badge' 'Badge (packages/theme/src/components/ui/badge)'
check_class 'p-chip' 'Badge variant="chip"/"warn"/"err"/"ok"/"info"'
check_class 'p-count' 'Badge variant="count"'
# P110 B23: the raw error/warn/note strip primitive, folded into the Alert component's own
# warn/note/err variants (packages/theme/src/components/ui/alert) -- along with every scoped
# per-file `.strip-warn/-note/-err` (+ `-text`) duplicate of those same tones. None read as prose.
check_class 'p-strip' 'Alert variant="warn"/"note"/"err" (packages/theme/src/components/ui/alert)'
check_class 'strip-warn' 'Alert variant="warn"'
check_class 'strip-warn-text' 'the warn variant'"'"'s own built-in AlertDescription/svg colour targeting'
check_class 'strip-note' 'Alert variant="note"'
check_class 'strip-note-text' 'the note variant'"'"'s own built-in AlertDescription/svg colour targeting'
check_class 'strip-err' 'Alert variant="err"'
check_class 'strip-err-text' 'the err variant'"'"'s own built-in AlertDescription/svg colour targeting'
# P110 B24: the native <select> primitive, folded into the NativeSelect component
# (packages/theme/src/components/ui/native-select) -- a real <select> consumer uses the component
# directly, and the two app-drawn menu-trigger buttons (MethodSelect.vue, EnvironmentSelect.vue)
# apply its exported nativeSelectVariants() as a class function instead. Not common prose.
check_class 'p-select' 'NativeSelect (packages/theme/src/components/ui/native-select) or nativeSelectVariants() for an app-drawn trigger button'
# P110 B26: the two hand-rolled button primitives, folded into Button's own existing
# toolbar/toolbar-primary/dialog/dialog-primary variants (packages/theme/src/components/ui/button).
check_class 'p-btn' 'Button variant="toolbar"/"toolbar-primary"'
check_class 'p-dlgbtn' 'Button variant="dialog"/"dialog-primary"'
# P110 B27: the dialog body wrapper and footer-actions row, both folded into plain utilities
# (flex flex-col gap-2 p-3 / flex flex-col gap-0.5 p-1 for .list; flex items-center gap-1.5 /
# justify-end w-full for .end). DialogFooter's own per-call-site override also picked up
# `bg-transparent` here, cancelling the shadcn registry default's `bg-muted/50` fill (the plan's
# own named target: "not bg-muted/50: today's actions have no fill").
check_class 'p-dialog-body' 'flex flex-col gap-2 p-3 (or gap-0.5 p-1 for the .list variant)'
check_class 'p-dialog-actions' 'flex items-center gap-1.5 (plus justify-end w-full for .end)'
# P110 B28: the toolbar/view-header/floating-surface/panel family, folded into plain utilities.
check_class 'p-toolbar' 'h-bar shrink-0 flex items-center gap-1.5 px-2 (+ border-b border-border unless .last)'
check_class 'p-toolbar-rail' 'h-0.5 shrink-0 bg-(--kira-rail)'
check_class 'p-view-head' 'h-bar shrink-0 flex items-center gap-1.5 px-2 border-b border-border'
check_class 'p-view-target' 'text-kira-md text-fg truncate (plus text-subtle for .path)'
check_class 'p-float' 'bg-elevated border border-border-strong rounded-kira shadow-kira-dialog overflow-hidden'
check_class 'p-panel' 'border border-border rounded-kira bg-bg overflow-hidden flex flex-col min-h-0'
# P110 B29: the list/table family, folded into plain utilities (and, for method colour, a small
# literal-class-map helper -- a template literal can never resolve at scan time). Not common prose.
check_class 'p-tab' 'h-control-lg inline-flex items-center gap-1 px-1.5 rounded-kira-sm border cursor-pointer max-w-52 shrink-0 text-kira-sm (plus a local tab-chip hook class where a scoped selector needs one)'
check_class 'p-row' 'h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md cursor-pointer (plus hover:bg-hover or a selection ternary)'
check_class 'p-method' 'methodTextClass() (packages/theme/src/methodColor.ts)'
check_class 'p-conn-dot' 'size-1.25 rounded-full shrink-0 (plus bg-(--kira-rail) or bg-none border border-disabled)'
check_class 'p-tab-rail' 'w-0.5 h-3.5 rounded-xs shrink-0 bg-(--kira-rail)'
check_class 'p-tree-rail' 'absolute inset-y-0 left-0 w-0.5 bg-(--kira-rail)'
check_class 'p-thead' 'h-control-lg shrink-0 flex bg-elevated border-b border-border-strong'
check_class 'p-th' 'flex items-center gap-1 px-2 border-r border-border text-kira-sm text-muted-foreground overflow-hidden whitespace-nowrap'
check_class 'p-td' 'flex items-center px-2 border-r border-b border-border font-data text-kira-md text-fg truncate (plus the gutter variant)'
check_class 'p-statusbar' 'h-statusbar shrink-0 flex items-center justify-between px-1.5'
check_class 'p-status' 'h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover'
# P110 B30: the rest -- empty state, menu label, AutocompleteField's completion popup, the
# <details> disclosure marker and the shared kv-row/definition-table families.
check_class 'p-empty' 'flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-subtle'
check_class 'p-menu-label' 'h-control-sm flex items-center px-1.5 text-kira-xs text-subtle uppercase tracking-wider'
check_class 'p-completion' 'font-data p-0.5 min-w-50 max-w-completion-max-w max-h-60 overflow-x-hidden overflow-y-auto'
check_class 'p-completion-row' 'flex items-center gap-1 py-1 px-1.5 rounded-kira-sm text-kira-sm cursor-pointer whitespace-nowrap (plus bg-select text-fg via a ternary for the active row)'
check_class 'p-completion-icon' 'shrink-0 text-muted-foreground'
check_class 'p-completion-label' 'overflow-hidden text-ellipsis'
check_class 'p-completion-detail' 'ml-auto pl-1.5 text-muted-foreground text-kira-xs shrink-0'
check_class 'p-disclosure' 'a `group` marker on <details>, with the codicon before: escape (allowlisted) moved onto <summary> itself'
check_class 'p-kv-row' 'flex gap-1.5 text-kira-xs'
check_class 'p-kv-name' 'text-muted-foreground shrink-0 min-w-40'
check_class 'p-kv-value' 'wrap-anywhere'
check_class 'def-section' 'flex flex-col gap-1.5'
check_class 'def-section-head' 'flex items-center gap-1.5'
check_class 'def-section-title' 'text-kira-sm text-muted-foreground uppercase tracking-wider'
check_class 'def-empty' 'text-muted-foreground m-0'
check_class 'def-table' 'w-full border-collapse text-kira-md'
check_class 'def-head-row' 'per-th px-1.5 py-1 bg-elevated border-b border-border-strong text-muted-foreground text-kira-sm whitespace-nowrap (plus border-r border-border except the last column)'
check_class 'def-row' 'border-b border-border hover:bg-hover'

# P110 A3: KuiButton/KuiIconBox onto cva variants + kv: utilities.
check_kui_class 'kui-button' 'kuiButtonVariants({ variant, active }) (packages/kira-ui/src/KuiButton.vue)'
check_kui_class 'kui-button-count' 'the count span'"'"'s own kv: utilities on KuiButton.vue'
check_kui_class 'kui-icon-box' 'KuiIconBox (packages/kira-ui/src/KuiIconBox.vue)'
# P110 A4: KuiTextInput/KuiSearchInput/KuiSelect onto kv: utilities.
check_kui_class 'kui-search-input' 'kv: utilities on KuiSearchInput.vue'
check_kui_class 'kui-search-input-icon' 'kv: utilities on KuiSearchInput.vue'
check_kui_class 'kui-search-input-field' 'kv: utilities on KuiSearchInput.vue'
check_kui_class 'kui-search-input-clear' 'kv: utilities on KuiSearchInput.vue'
check_kui_class 'kui-select' 'kv: utilities on KuiSelect.vue'
check_kui_class 'kui-select-field' 'kv: utilities on KuiSelect.vue'
check_kui_class 'kui-select-chevron' 'kv: utilities on KuiSelect.vue'
# P110 A5: KuiMenuList/KuiContextMenu onto cva, exported kuiRowVariants.
check_kui_class 'kui-row' 'kuiRowVariants() (packages/kira-ui/src/rowVariants.ts)'
check_kui_class 'kui-menu-list' 'kv: utilities on KuiMenuList.vue'
check_kui_class 'kui-menu-item' 'kuiRowVariants() (packages/kira-ui/src/rowVariants.ts)'
check_kui_class 'kui-menu-item-label' 'kv: utilities on KuiMenuList.vue'
check_kui_class 'kui-menu-item-detail' 'kv: utilities on KuiMenuList.vue'
check_kui_class 'kui-menu-heading' 'kv: utilities on KuiMenuList.vue'
check_kui_class 'kui-menu-separator' 'kv: utilities on KuiMenuList.vue'
check_kui_class 'kui-menu-root' 'kv: utilities on KuiContextMenu.vue'
check_kui_class 'kui-visually-hidden' 'kv: utilities on KuiMenuList.vue'
# P110 A6: KuiTooltip/KuiPopoverPanel/KuiDialog onto kv: utilities.
check_kui_class 'kui-tooltip' 'kv: utilities on KuiTooltip.vue'
check_kui_class 'kui-popover-backdrop' 'kv: utilities on KuiPopoverPanel.vue'
check_kui_class 'kui-popover' 'kv: utilities on KuiPopoverPanel.vue'
check_kui_class 'kui-modal-backdrop' 'kv: utilities on KuiDialog.vue'
check_kui_class 'kui-modal' 'kv: utilities on KuiDialog.vue'
check_kui_class 'kui-modal-title' 'kv: utilities on KuiDialog.vue'
check_kui_class 'kui-modal-body' 'kv: utilities on KuiDialog.vue'
check_kui_class 'kui-modal-actions' 'kv: utilities on KuiDialog.vue'
# P110 A7: KuiSegmented onto cva/kv: utilities.
check_kui_class 'kui-segmented' 'kv: utilities on KuiSegmented.vue'
check_kui_class 'kui-segmented-button' 'kuiSegmentedButtonVariants() (packages/kira-ui/src/KuiSegmented.vue)'
check_kui_class 'kui-segmented-badge' 'kv: utilities on KuiSegmented.vue'

# P110 I2-35: one spinner speed, Tailwind's own default `animate-spin` (1s) -- retires the app's
# own 0.7s `--animate-kira-spin` token and codicon's own 1.5s stepped `codicon-modifier-spin`.
# Attribute-scoped for the codicon check: codicon.css's own header comment names the class as
# prose (see that file's own top-of-file doc comment).
check_class 'animate-kira-spin' 'animate-spin'
check_class_in_attrs 'codicon-modifier-spin' 'kv:inline-block kv:animate-spin' "$GIT_UI_SRC $KIRA_UI_SRC"

# P110 I2-10/11: the "nothing here yet" panel, folded into the shared Empty/EmptyMedia/EmptyTitle/
# EmptyDescription components (packages/theme/src/components/ui/empty/, a shadcn-vue registry
# fetch). `empty-state` itself is attribute-scoped: several files carry a legitimate prose comment
# naming the retired class for history (KeyValuePane.vue, BrowseView.vue,
# api-ui-consistency.spec.ts, scroll-trace.spec.ts) -- a whole-file check_class would false-positive
# on those. `-icon`/`-title` have zero such survivors, so a plain check_class is enough for them.
check_class_in_attrs 'empty-state' 'Empty (packages/theme/src/components/ui/empty)'
check_class 'empty-state-icon' 'EmptyMedia'
check_class 'empty-state-title' 'EmptyTitle'

# P110 I2-12: ColumnsMenu.vue/ProjectionMenu.vue's shared popover shell, inlined as plain utilities
# at both call sites (below the 4+-component extraction bar). Attribute-scoped: `columns-menu-footer`
# also survives as a real `data-testid` value on both files, which a whole-file check_class would
# false-positive against.
check_class_in_attrs 'columns-menu-inner' 'max-h-80 flex flex-col'
check_class_in_attrs 'columns-menu-header' 'flex border-b border-border gap-1 p-1'
check_class_in_attrs 'columns-menu-loading' 'p-2'
check_class_in_attrs 'columns-menu-list' 'overflow-y-auto p-0.5'
check_class_in_attrs 'columns-menu-footer' 'px-1.5 pb-1.5'

# P110 I2-13: the tree-row disclosure-triangle button, folded into the shared TreeTwisty component
# (packages/workbench/src/components/TreeTwisty.vue). Attribute-scoped: "twisty" is also plain
# English prose used throughout tree-row/search-row comments and docs (e.g. "the twisty always
# expands/collapses") -- a whole-file check_class would false-positive on every one of those.
# `twisty-btn` (FiltersDialog.vue, a separate, unrelated control) never collides: the lookahead
# that excludes trailing identifier/hyphen characters already keeps it out.
check_class_in_attrs 'twisty' 'TreeTwisty (packages/workbench/src/components/TreeTwisty.vue)'

# P110 I2-14: the shared tree-row shell, folded into each consumer's own `cn()`-built root class
# (a `stateClass` computed replacing the hover/selected `<style scoped>` block). Both names are
# heavy, ordinary prose throughout this codebase's own comments ("tree-row refresh", "the twisty
# always expands/collapses", TreeRow.vue's own `spin ->` migration comments) -- attribute-scoped
# so none of that false-positives. `data-testid="tree-row"`/`data-testid="tree-row-spinner"` are
# real, ongoing test-id values, never `class`/`:class` attribute values, so the attribute scope
# leaves them alone.
check_class_in_attrs 'tree-row' 'the shared literal utility string via cn() (see base.css)'
check_class_in_attrs 'spin' 'animate-spin plus data-testid="tree-row-spinner"'

# P110 I2-15: the 9(+3) file `.virtual-row`/`.sticky-row` scoped-copy duplicate, replaced by
# VIRTUAL_ROW_CLASS/STICKY_ROW_CLASS (packages/workbench/src/util/virtualRows.ts) bound directly
# as each row's own class. Attribute-scoped: both names are heavy prose in this migration's own
# comments (this file's own replacement messages above included) and `sticky-row` is also a
# substring of real, ongoing `data-testid` values (`tree-sticky-row`, `collection-sticky-row`,
# `repo-tree-sticky-row`) -- never `class`/`:class` attribute values, so the attribute scope
# leaves them alone.
check_class_in_attrs 'virtual-row' 'VIRTUAL_ROW_CLASS (packages/workbench/src/util/virtualRows.ts)'
check_class_in_attrs 'sticky-row' 'STICKY_ROW_CLASS (packages/workbench/src/util/virtualRows.ts)'

# P110 I2-16: the definition-table `<table>` marker, only ever used to anchor its own scoped
# `.definition-table td`/`td:last-child` column-divider rule, now folded into each file's own
# DEF_TD constant (`border-r border-border last:border-r-0`) -- the marker class itself is dead.
check_class_in_attrs 'definition-table' 'border-r border-border last:border-r-0 on DEF_TD'

if [ "$STATUS" -ne 0 ]; then
  echo "check-theme-classes: one or more retired class names are still in use. See P110 plan (docs/v1.9/plans/P110-css-tailwind-migration.md) §5.12." >&2
else
  echo "check-theme-classes: no retired class names found."
fi

exit $STATUS
