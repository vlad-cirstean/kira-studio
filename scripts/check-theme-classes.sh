#!/bin/sh
# P110 B5/C1: guards every legacy/retired class name this CSS-to-Tailwind migration renames or
# deletes from ever coming back. Each check greps for one retired name, anchored the same way
# check-tokens.sh anchors --kira-* references: the name must be preceded by whitespace, a quote,
# a backtick, a brace or a colon (i.e. a real class-name token, possibly with a variant chain like
# `hover:`), and not immediately followed by another identifier character or hyphen -- so
# `text-muted` never matches `text-muted-foreground`, and `bg-input` never matches a
# `--kira-bg-input` custom-property reference.
#
# Excludes packages/theme/src/components/ui/ for check_class/check_class_in_attrs/their _all
# forms -- shadcn-vue's own registry-authored components used to speak shadcn's own vocabulary
# (bg-input/30, text-muted-foreground, border-input, ...), which was never a "retired name" hit
# there even where a retired name was a substring of it. P110 I2-37/I2-38's check_alias below is
# the deliberate exception: every shadcn colour/radius alias that duplicated a kira name was
# renamed away inside components/ui too (one name per value, repo-wide), so those checks scan it
# on purpose -- a re-pulled registry file that still says bg-card must fail lint, same as any
# other file.
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

# _gu_ku_hits <retired-name>
# P110 I2-31: the shared GU/KU pass every *_all function below adds on top of its own SCAN_DIRS
# behaviour -- names retired in the PT root were never guarded against reappearing in GU/KU, since
# the two roots evolved separately (§3.8's own audit gap). `.vue`: attribute values only
# (`class="..."`/`:class="..."`), the same way check_kui_class already works, so a `:class="{...}"`
# object key is covered too. `.ts`: full lines, excluding comment-continuation lines and
# `KU/cn.ts` -- that file's own strings are tailwind-merge group/token names (`'kui-1'`, `'row'`,
# ...), never class names, and would false-positive on a bare common word.
_gu_ku_hits() {
  name="$1"
  vue_hits=$(grep -rnP --include='*.vue' \
    -- '(?::?class)="[^"]*"' "$GIT_UI_SRC" "$KIRA_UI_SRC" 2>/dev/null |
    grep -vP '^[^:]+:[0-9]+:\s*(\*|//|/\*)' |
    grep -P "(?<![-\\w])${name}(?![-\\w])" || true)
  ts_hits=$(grep -rnP --include='*.ts' "$GIT_UI_SRC" "$KIRA_UI_SRC" 2>/dev/null |
    grep -v "^${KIRA_UI_SRC}/cn.ts:" |
    grep -vP '^[^:]+:[0-9]+:\s*(\*|//|/\*)' |
    grep -P "(?<![-\\w])${name}(?![-\\w])" || true)
  printf '%s\n%s\n' "$vue_hits" "$ts_hits" | grep -v '^$' || true
}

# check_class_all <retired-name> <replacement> [scan-dirs]
# check_class, plus the GU/KU pass above -- for a name with no legitimate prose survivor anywhere
# (the same bar check_class itself applies to SCAN_DIRS). The GU/KU pass only runs when [scan-dirs]
# is omitted (a real repo-wide retired name): a caller that already narrows dirs to specific
# PT-root files (I2-25's own `row`/`text-prompt-title` calls) is deliberately scoping away from a
# repo-wide guard -- GU/KU has its own, unrelated legitimate uses of a name that common
# (`row.shortName` etc. throughout git-ui, confirmed by a real run of this script before this
# guard excluded it), so extending those specific calls' scope would be a new false positive, not a
# closed gap.
check_class_all() {
  name="$1"
  replacement="$2"
  dirs="${3:-$SCAN_DIRS}"
  base_hits=$(grep -rnoP --include='*.vue' --include='*.ts' --include='*.css' \
    -- "(?<![-\\w])(?:[a-z0-9-]+:)*${name}(?![-\\w])" $dirs 2>/dev/null |
    grep -v "^${THEME_SRC}/components/ui/" || true)
  if [ -z "$3" ]; then
    gu_ku_hits=$(_gu_ku_hits "$name")
  else
    gu_ku_hits=""
  fi
  hits=$(printf '%s\n%s\n' "$base_hits" "$gu_ku_hits" | grep -v '^$' || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: retired class '$name' still used -- replace with '$replacement':" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}

# check_class_in_attrs_all <retired-name> <replacement> [scan-dirs]
# check_class_in_attrs, plus the GU/KU pass above (same [scan-dirs]-omitted condition as
# check_class_all, and for the same reason) -- for a common-word name, attribute-scoped in both
# roots so real prose (SCAN_DIRS comments/docs, and GU/KU's own JSDoc, excluded by _gu_ku_hits's
# own comment-line filter) never false-positives.
check_class_in_attrs_all() {
  name="$1"
  replacement="$2"
  dirs="${3:-$SCAN_DIRS}"
  base_hits=$(grep -rnoP --include='*.vue' --include='*.ts' \
    -- '(?::?class)="[^"]*"' $dirs 2>/dev/null |
    grep -P "(?<![-\\w])${name}(?![-\\w])" |
    grep -v "^${THEME_SRC}/components/ui/" || true)
  if [ -z "$3" ]; then
    gu_ku_hits=$(_gu_ku_hits "$name")
  else
    gu_ku_hits=""
  fi
  hits=$(printf '%s\n%s\n' "$base_hits" "$gu_ku_hits" | grep -v '^$' || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: retired class '$name' still used in a class attribute -- replace with '$replacement':" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}

# check_alias <retired-name-regex> <replacement>
# P110 I2-37/I2-38: check_class WITHOUT the components/ui exclusion -- one name per value, repo-
# wide (§3.11.3), so a shadcn alias colour/radius name is retired everywhere PT reaches, including
# its own registry-authored components. PT-root only: SCAN_DIRS never includes GU/KU, and this
# function takes no [scan-dirs] override -- the kv root defines none of these shadcn names for
# colours, and defines its OWN --radius-sm/--radius-lg with different, legitimate meanings, so it
# must never be extended there.
check_alias() {
  name="$1"
  replacement="$2"
  hits=$(grep -rnoP --include='*.vue' --include='*.ts' --include='*.css' \
    -- "(?<![-\\w])(?:[a-z0-9-]+:)*${name}(?![-\\w])" $SCAN_DIRS 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: retired alias '$name' still used -- replace with '$replacement':" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}

# check_focus_width <pattern>
# P122: guards every focus ring against the retired shadcn 3px/50%-alpha halo (ring-N/ring-focus/
# ring-error) or a >1px coloured outline -- both replaced by the shared `focus-ring` utility
# (packages/theme/src/base.css). Modelled on check_alias: SCAN_DIRS *including* components/ui (no
# shadcn-registry survivor for either shape any more, P122 plan §3.3), plus the GU/KU pass via
# _gu_ku_hits (kv: roots keep their own 1px --kv-focus-border recipe, a different shape by design).
# `peer-focus-visible:outline-2` (SwatchRadio.vue, P122 plan §3.5's own named exception) matches
# neither pattern -- `peer-` sits outside both alternations.
check_focus_width() {
  pattern="$1"
  hits=$(grep -rnoP --include='*.vue' --include='*.ts' --include='*.css' \
    -- "$pattern" $SCAN_DIRS 2>/dev/null || true)
  gu_ku_hits=$(_gu_ku_hits "$pattern")
  hits=$(printf '%s\n%s\n' "$hits" "$gu_ku_hits" | grep -v '^$' || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: focus ring wider/coloured than focus-ring (packages/theme/src/base.css):" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}

# P110 B3/B4: base.css's @theme used to shadow shadcn-bridge.css's own --color-muted; app code's
# text-muted/text-fg-muted are both renamed to shadcn's own text-muted-foreground.
check_class_all 'text-muted' 'text-muted-foreground'
check_class_all 'text-fg-muted' 'text-muted-foreground'
# P110 B2: app code's own filled-control surface, renamed off shadcn's bg-input so the two never
# collide in meaning.
check_class_all 'bg-input' 'bg-field'
# P110 B7: dead primitive -- every consumer already carries the equivalent utilities directly, and
# the unlayered rule was winning over them (11px ring instead of 12px, an accidental box-shadow
# from Tailwind's own `ring` utility name colliding with the `.ring` hook class).
check_class_all 'p-run-state' 'data-testid="run-state"/"run-state-label" plus plain utilities'
# P110 B8
check_class_all 'p-panel-head' 'flex items-center shrink-0 h-control-lg (or h-bar) gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider'
# P110 B12: SettingsShell.vue's own panes' shared field-level vocabulary, deleted from
# packages/workbench/src/workbench.css. Guards only the four names with zero legitimate survivors
# repo-wide -- `field`/`field.checkbox`/`field-error`/`helper-text` are deliberately NOT guarded
# here: ConnectionDialog.vue, StreamComposeMessage.vue, SchemaDialog.vue and TerminalPanel.vue each
# keep their own scoped `<style>` redeclaration of those same names (the plan's own named leak
# sites, backfilled to stay self-sufficient after the shared rule's deletion), so those are a
# real, ongoing, local pattern, not a retired one.
check_class_all 'field-head' 'flex items-center justify-between gap-1'
check_class_all 'checkbox-row' 'FieldGroup (packages/theme/src/components/ui/field)'
check_class_all 'sec-label' 'FieldLegend (packages/theme/src/components/ui/field)'
check_class_all 'settings-pane' 'class="contents" (a SettingsShell.vue pane) or plain utility classes (a standalone panel, e.g. RequestSettingsPane.vue)'
# P110 B13: TitleBar.vue's own action row and WorkbenchShell.vue's own "new tab" button, deleted
# from workbench.css. Guards only the names with zero legitimate survivors repo-wide --
# `tab-strip-actions` is deliberately NOT guarded here: both apps' WorkbenchShell.vue keep
# `data-testid="tab-strip-actions"`, the same string now published as a test id, not a class, so
# it's a real ongoing use, not a retired one. `is-on` is also NOT guarded: AutocompleteField.vue's
# own unrelated `:class="{ 'is-on': ... }"` and primitives.css's own `.p-status.is-on`/
# `.p-completion-row.is-on` (a later B-item's own job) are real, unrelated survivors.
check_class_all 'title-action' 'Button variant="title" size="title" (packages/theme/src/components/ui/button)'
check_class_all 'title-action--labelled' 'Button variant="title" size="title-labelled"'
check_class_all 'title-bar-actions' 'flex items-center gap-0.5 ml-auto wails-no-drag'
check_class_all 'tab-new' 'inline utility classes on the new-tab button (see WorkbenchShell.vue)'
# P110 B14: audit §3.6's alias classes, deleted from primitives.css one at a time. `mono` is a
# common word outside class contexts too (tokens.css's own LAW 08 prose, a stray doc comment) --
# both were reworded to drop the bare word rather than excluding a path, so this plain check_class
# call has zero legitimate survivors left to false-positive against.
check_class_all 'mono' 'font-data'
# P110 B15: `muted` is common prose too (design-idiom comments, docs) -- uses the attribute-scoped
# variant above instead of reworking every legitimate comment.
check_class_in_attrs_all 'muted' 'text-muted-foreground'
# P110 B16: `dim` is common prose too (api-ui-consistency.spec.ts's own test name/comment describe
# it conceptually, no actual `.locator('.dim')` call exists there to move to a data-testid).
check_class_in_attrs_all 'dim' 'text-subtle'
# P110 B17: `p-sm` is not common prose, so the plain check_class call is enough.
check_class_all 'p-sm' 'text-kira-sm'
# P110 B18: same reasoning as B17 -- `p-xs` is not common prose.
check_class_all 'p-xs' 'text-kira-xs'
# P110 B19: `p-push` is not common prose.
check_class_all 'p-push' 'ml-auto'
# P110 B20: `icon-box` is not common prose.
check_class_all 'icon-box' 'size-4 flex items-center justify-center shrink-0'
# P110 B22: the badge/chip/count trio, folded into one Badge component
# (packages/theme/src/components/ui/badge). None of the three read as prose.
check_class_all 'p-badge' 'Badge (packages/theme/src/components/ui/badge)'
check_class_all 'p-chip' 'Badge variant="chip"/"warn"/"err"/"ok"/"info"'
check_class_all 'p-count' 'Badge variant="count"'
# P110 B23: the raw error/warn/note strip primitive, folded into the Alert component's own
# warn/note/err variants (packages/theme/src/components/ui/alert) -- along with every scoped
# per-file `.strip-warn/-note/-err` (+ `-text`) duplicate of those same tones. None read as prose.
check_class_all 'p-strip' 'Alert variant="warn"/"note"/"err" (packages/theme/src/components/ui/alert)'
check_class_all 'strip-warn' 'Alert variant="warn"'
check_class_all 'strip-warn-text' 'the warn variant'"'"'s own built-in AlertDescription/svg colour targeting'
check_class_all 'strip-note' 'Alert variant="note"'
check_class_all 'strip-note-text' 'the note variant'"'"'s own built-in AlertDescription/svg colour targeting'
check_class_all 'strip-err' 'Alert variant="err"'
check_class_all 'strip-err-text' 'the err variant'"'"'s own built-in AlertDescription/svg colour targeting'
# P110 B24: the native <select> primitive, folded into the NativeSelect component
# (packages/theme/src/components/ui/native-select) -- a real <select> consumer uses the component
# directly, and the two app-drawn menu-trigger buttons (MethodSelect.vue, EnvironmentSelect.vue)
# apply its exported nativeSelectVariants() as a class function instead. Not common prose.
check_class_all 'p-select' 'NativeSelect (packages/theme/src/components/ui/native-select) or nativeSelectVariants() for an app-drawn trigger button'
# P110 B26: the two hand-rolled button primitives, folded into Button's own existing
# toolbar/toolbar-primary/dialog/dialog-primary variants (packages/theme/src/components/ui/button).
check_class_all 'p-btn' 'Button variant="toolbar"/"toolbar-primary"'
check_class_all 'p-dlgbtn' 'Button variant="dialog"/"dialog-primary"'
# P110 B27: the dialog body wrapper and footer-actions row, both folded into plain utilities
# (flex flex-col gap-2 p-3 / flex flex-col gap-0.5 p-1 for .list; flex items-center gap-1.5 /
# justify-end w-full for .end). DialogFooter's own per-call-site override also picked up
# `bg-transparent` here, cancelling the shadcn registry default's `bg-muted/50` fill (the plan's
# own named target: "not bg-muted/50: today's actions have no fill").
check_class_all 'p-dialog-body' 'flex flex-col gap-2 p-3 (or gap-0.5 p-1 for the .list variant)'
check_class_all 'p-dialog-actions' 'flex items-center gap-1.5 (plus justify-end w-full for .end)'
# P110 B28: the toolbar/view-header/floating-surface/panel family, folded into plain utilities.
check_class_all 'p-toolbar' 'h-bar shrink-0 flex items-center gap-1.5 px-2 (+ border-b border-border unless .last)'
check_class_all 'p-toolbar-rail' 'h-0.5 shrink-0 bg-(--kira-rail)'
check_class_all 'p-view-head' 'h-bar shrink-0 flex items-center gap-1.5 px-2 border-b border-border'
check_class_all 'p-view-target' 'text-kira-md text-fg truncate (plus text-subtle for .path)'
check_class_all 'p-float' 'bg-elevated border border-border-strong rounded-kira shadow-kira-dialog overflow-hidden'
check_class_all 'p-panel' 'border border-border rounded-kira bg-bg overflow-hidden flex flex-col min-h-0'
# P110 B29: the list/table family, folded into plain utilities (and, for method colour, a small
# literal-class-map helper -- a template literal can never resolve at scan time). Not common prose.
check_class_all 'p-tab' 'h-control-lg inline-flex items-center gap-1 px-1.5 rounded-kira-sm border cursor-pointer max-w-52 shrink-0 text-kira-sm (plus a local tab-chip hook class where a scoped selector needs one)'
check_class_all 'p-row' 'h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-md cursor-pointer (plus hover:bg-hover or a selection ternary)'
check_class_all 'p-method' 'methodTextClass() (packages/theme/src/methodColor.ts)'
check_class_all 'p-conn-dot' 'size-1.25 rounded-full shrink-0 (plus bg-(--kira-rail) or bg-none border border-disabled)'
check_class_all 'p-tab-rail' 'w-0.5 h-3.5 rounded-xs shrink-0 bg-(--kira-rail)'
check_class_all 'p-tree-rail' 'absolute inset-y-0 left-0 w-0.5 bg-(--kira-rail)'
check_class_all 'p-thead' 'h-control-lg shrink-0 flex bg-elevated border-b border-border-strong'
check_class_all 'p-th' 'flex items-center gap-1 px-2 border-r border-border text-kira-sm text-muted-foreground overflow-hidden whitespace-nowrap'
check_class_all 'p-td' 'flex items-center px-2 border-r border-b border-border font-data text-kira-md text-fg truncate (plus the gutter variant)'
check_class_all 'p-statusbar' 'h-statusbar shrink-0 flex items-center justify-between px-1.5'
check_class_all 'p-status' 'h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover'
# P110 B30: the rest -- empty state, menu label, AutocompleteField's completion popup, the
# <details> disclosure marker and the shared kv-row/definition-table families.
check_class_all 'p-empty' 'flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-subtle'
check_class_all 'p-menu-label' 'h-control-sm flex items-center px-1.5 text-kira-xs text-subtle uppercase tracking-wider'
check_class_all 'p-completion' 'font-data p-0.5 min-w-50 max-w-completion-max-w max-h-60 overflow-x-hidden overflow-y-auto'
check_class_all 'p-completion-row' 'flex items-center gap-1 py-1 px-1.5 rounded-kira-sm text-kira-sm cursor-pointer whitespace-nowrap (plus bg-select text-fg via a ternary for the active row)'
check_class_all 'p-completion-icon' 'shrink-0 text-muted-foreground'
check_class_all 'p-completion-label' 'overflow-hidden text-ellipsis'
check_class_all 'p-completion-detail' 'ml-auto pl-1.5 text-muted-foreground text-kira-xs shrink-0'
check_class_all 'p-disclosure' 'a `group` marker on <details>, with the codicon before: escape (allowlisted) moved onto <summary> itself'
check_class_all 'p-kv-row' 'flex gap-1.5 text-kira-xs'
check_class_all 'p-kv-name' 'text-muted-foreground shrink-0 min-w-40'
check_class_all 'p-kv-value' 'wrap-anywhere'
check_class_all 'def-section' 'flex flex-col gap-1.5'
check_class_all 'def-section-head' 'flex items-center gap-1.5'
check_class_all 'def-section-title' 'text-kira-sm text-muted-foreground uppercase tracking-wider'
check_class_all 'def-empty' 'text-muted-foreground m-0'
check_class_all 'def-table' 'w-full border-collapse text-kira-md'
check_class_all 'def-head-row' 'per-th px-1.5 py-1 bg-elevated border-b border-border-strong text-muted-foreground text-kira-sm whitespace-nowrap (plus border-r border-border except the last column)'
check_class_all 'def-row' 'border-b border-border hover:bg-hover'

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
check_class_all 'animate-kira-spin' 'animate-spin'
check_class_in_attrs_all 'codicon-modifier-spin' 'kv:inline-block kv:animate-spin' "$GIT_UI_SRC $KIRA_UI_SRC"

# P110 I2-10/11: the "nothing here yet" panel, folded into the shared Empty/EmptyMedia/EmptyTitle/
# EmptyDescription components (packages/theme/src/components/ui/empty/, a shadcn-vue registry
# fetch). `empty-state` itself is attribute-scoped: several files carry a legitimate prose comment
# naming the retired class for history (KeyValuePane.vue, BrowseView.vue,
# api-ui-consistency.spec.ts, scroll-trace.spec.ts) -- a whole-file check_class would false-positive
# on those. `-icon`/`-title` have zero such survivors, so a plain check_class is enough for them.
check_class_in_attrs_all 'empty-state' 'Empty (packages/theme/src/components/ui/empty)'
check_class_all 'empty-state-icon' 'EmptyMedia'
check_class_all 'empty-state-title' 'EmptyTitle'

# P110 I2-12: ColumnsMenu.vue/ProjectionMenu.vue's shared popover shell, inlined as plain utilities
# at both call sites (below the 4+-component extraction bar). Attribute-scoped: `columns-menu-footer`
# also survives as a real `data-testid` value on both files, which a whole-file check_class would
# false-positive against.
check_class_in_attrs_all 'columns-menu-inner' 'max-h-80 flex flex-col'
check_class_in_attrs_all 'columns-menu-header' 'flex border-b border-border gap-1 p-1'
check_class_in_attrs_all 'columns-menu-loading' 'p-2'
check_class_in_attrs_all 'columns-menu-list' 'overflow-y-auto p-0.5'
check_class_in_attrs_all 'columns-menu-footer' 'px-1.5 pb-1.5'

# P110 I2-13: the tree-row disclosure-triangle button, folded into the shared TreeTwisty component
# (packages/workbench/src/components/TreeTwisty.vue). Attribute-scoped: "twisty" is also plain
# English prose used throughout tree-row/search-row comments and docs (e.g. "the twisty always
# expands/collapses") -- a whole-file check_class would false-positive on every one of those.
# `twisty-btn` (FiltersDialog.vue, a separate, unrelated control) never collides: the lookahead
# that excludes trailing identifier/hyphen characters already keeps it out.
check_class_in_attrs_all 'twisty' 'TreeTwisty (packages/workbench/src/components/TreeTwisty.vue)'

# P110 I2-14: the shared tree-row shell, folded into each consumer's own `cn()`-built root class
# (a `stateClass` computed replacing the hover/selected `<style scoped>` block). Both names are
# heavy, ordinary prose throughout this codebase's own comments ("tree-row refresh", "the twisty
# always expands/collapses", TreeRow.vue's own `spin ->` migration comments) -- attribute-scoped
# so none of that false-positives. `data-testid="tree-row"`/`data-testid="tree-row-spinner"` are
# real, ongoing test-id values, never `class`/`:class` attribute values, so the attribute scope
# leaves them alone.
check_class_in_attrs_all 'tree-row' 'the shared literal utility string via cn() (see base.css)'
check_class_in_attrs_all 'spin' 'animate-spin plus data-testid="tree-row-spinner"'

# P110 I2-15: the 9(+3) file `.virtual-row`/`.sticky-row` scoped-copy duplicate, replaced by
# VIRTUAL_ROW_CLASS/STICKY_ROW_CLASS (packages/workbench/src/util/virtualRows.ts) bound directly
# as each row's own class. Attribute-scoped: both names are heavy prose in this migration's own
# comments (this file's own replacement messages above included) and `sticky-row` is also a
# substring of real, ongoing `data-testid` values (`tree-sticky-row`, `collection-sticky-row`,
# `repo-tree-sticky-row`) -- never `class`/`:class` attribute values, so the attribute scope
# leaves them alone.
check_class_in_attrs_all 'virtual-row' 'VIRTUAL_ROW_CLASS (packages/workbench/src/util/virtualRows.ts)'
check_class_in_attrs_all 'sticky-row' 'STICKY_ROW_CLASS (packages/workbench/src/util/virtualRows.ts)'

# P110 I2-16: the definition-table `<table>` marker, only ever used to anchor its own scoped
# `.definition-table td`/`td:last-child` column-divider rule, now folded into each file's own
# DEF_TD constant (`border-r border-border last:border-r-0`) -- the marker class itself is dead.
check_class_in_attrs_all 'definition-table' 'border-r border-border last:border-r-0 on DEF_TD'

# P110 I2-22: the InputGroup+Tooltip+InputGroupButton number-stepper recipe (14 sites across 7
# files), replaced by the shared NumberStepperInput component (packages/theme/src/
# NumberStepperInput.vue), which drops the `step-btn` hook class entirely in favour of
# `data-testid="number-step-up"`/`"number-step-down"`.
check_class_all 'step-btn' 'data-testid="number-step-up"/"number-step-down" (packages/theme/src/NumberStepperInput.vue)'

# P110 I2-25: TextPromptDialog.vue's `text-prompt-title` was already orphaned as of I2-8 (no
# scoped style ever defined it, dropped from the template there) -- guarded here so it never
# comes back. MethodSelect.vue's and EnvironmentSelect.vue's stray `row` class was the same shape
# (the real styling already lived in the sibling utility string) -- dropped, guarded too. `row` is
# scoped to just these two known consumer files, not the whole source tree: it is also an
# ordinary loop-variable/property name inside other files' `:class` JS expressions (`row.status`,
# `row.method`, `row.shadowed`, ...), which a whole-tree attribute scan would false-positive on.
check_class_in_attrs_all 'text-prompt-title' 'dropped -- was already orphaned (I2-8)' "$WORKBENCH_SRC/prompt/TextPromptDialog.vue"
check_class_in_attrs_all 'row' 'the sibling utility string already carries all real styling' "$FRONTEND_SRC/api/MethodSelect.vue $FRONTEND_SRC/api/EnvironmentSelect.vue"

# P110 I2-26: GitPane.vue's (kira-space) two <h3> section headers carried `section-subhead`, dead
# with zero CSS backing it anywhere in the tree (confirmed by grep before removal) -- the current,
# already-recorded visual baseline is plain unstyled <h3>, not FieldLegend's uppercase/subtle
# treatment every other pane's own section header uses, so removing the dead hook (not swapping in
# FieldLegend) was the zero-diff fix. Guarded so it never comes back.
check_class_all 'section-subhead' 'dropped -- had zero CSS backing (see settings-git-visual-linux.png, a plain <h3> baseline)'

# P110 I2-31: pre-phase names never guarded until now (audit §6c/§3.8's own gap) -- every name
# below is a real selector from `git show 6f6853c1:packages/theme/src/primitives.css` and
# `…:packages/workbench/src/workbench.css` (or, for `p-seg`/`muted-note`/`footer-status`/`split`/
# `splitter`, named explicitly by this plan itself; a fresh grep of both files at that commit found
# no literal selector for those five -- likely folded away by an even earlier phase -- so they are
# guarded on the plan's own naming, not a ground-truth selector this pass could re-derive).
# `p-seg`/`section-pane`/`footer-status` use the attribute-scoped (`_in_attrs_all`) form, not the
# plan's own plain grouping: a real run of this script found each one has a genuine prose survivor
# (DataToolbar.vue's and SettingsShell.vue's own doc comments narrating pre-P110 history) that a
# whole-file scan false-positives on -- ground truth over the plan's own categorization, same
# discipline this migration has used throughout.
check_class_in_attrs_all 'p-seg' 'KuiSegmented (packages/kira-ui/src/KuiSegmented.vue)'
check_class_all 'has-stepper' 'NumberStepperInput (packages/theme/src/NumberStepperInput.vue)'
check_class_all 'ph-active' 'NumberStepperInput'"'"'s own placeholder-active styling'
# `sugg-*`: already folded into p-completion-row/-label/-detail well before 6f6853c1 (23f37c46) --
# only a prose comment naming the family survived to that commit. A regex name (not a literal),
# since no single concrete suffix exists to enumerate.
check_class_all 'sugg-[a-z]+' 'p-completion-row/p-completion-label/p-completion-detail'
check_class_all 'strip-action' 'the warn/note/err Alert variant'"'"'s own trailing-action slot'
check_class_all 'dialog-body-inner' 'flex flex-col gap-2 p-3 (or gap-0.5 p-1 for the .list variant)'
check_class_in_attrs_all 'section-pane' 'class="contents" (a SettingsShell.vue pane) or plain utility classes'
check_class_all 'muted-note' 'text-muted-foreground text-kira-xs'
check_class_in_attrs_all 'footer-status' 'plain utility classes on the status row'
# Common words, attribute-scoped (real prose survivors elsewhere in the tree).
check_class_in_attrs_all 'stepper' 'NumberStepperInput'
check_class_in_attrs_all 'ph' 'NumberStepperInput'"'"'s own placeholder-active styling'
check_class_in_attrs_all 'big' 'size-6 (or the local equivalent) on Empty/EmptyMedia'
check_class_in_attrs_all 'edited' 'a local per-cell edited-state class/data attribute'
check_class_in_attrs_all 'segmented' 'KuiSegmented (packages/kira-ui/src/KuiSegmented.vue)'
check_class_in_attrs_all 'split' 'a local split-pane class/data attribute'
check_class_in_attrs_all 'splitter' 'a local splitter-track class/data attribute'
# `bordered` excluded deliberately: a legitimate NativeSelect `variant` PROP VALUE
# (`variant="bordered"`), not a class -- never guarded here.

# P110 I2-31: deliberate omissions, consolidated. Each name below has a real, ongoing, unrelated
# survivor that would false-positive under any of the check_* forms above, so none is guarded --
# this block exists so the gap reads as a decision, not an oversight (§3.8 item 5):
#   - `field`, `field.checkbox`, `field-error`, `helper-text`: ConnectionDialog.vue,
#     StreamComposeMessage.vue, SchemaDialog.vue and TerminalPanel.vue each keep their own scoped
#     `<style>` redeclaration of these same names (B12's own named leak sites, backfilled to stay
#     self-sufficient after the shared workbench.css rule's deletion) -- a real, ongoing, local
#     pattern, not a retired one.
#   - `tab-strip-actions`: both apps' WorkbenchShell.vue keep `data-testid="tab-strip-actions"`,
#     the same string now published as a test id, not a class.
#   - `is-on`: AutocompleteField.vue's own unrelated `:class="{ 'is-on': ... }"` and primitives.css's
#     own `.p-status.is-on`/`.p-completion-row.is-on` (a later B-item's own job) are real, unrelated
#     survivors.

# P110 I2-36: the `err` Alert variant is retired (unified onto `destructive`) -- its own
# `text-error-text` (`--color-error-text`/`--kira-error-text`) had no other consumer, so both the
# class and its backing tokens are deleted together. `_all` form (I2-31's now-established pattern
# postdates the plan's own literal `check_class` wording for this item; no legitimate GU/KU or
# prose survivor exists for this name either).
check_class_all 'text-error-text' 'text-error'

# P110 I2-37: one colour name per value, repo-wide -- kira names win, including inside
# PT/components/ui (§3.11.3's own Finding 1/Choice). PT-root only (check_alias never takes a
# [scan-dirs] override); the kv root defines none of these shadcn names.
ALIAS_COLOR_PREFIX='(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|divide|from|via|to|shadow|caret|decoration|placeholder)'
check_alias "${ALIAS_COLOR_PREFIX}-background(?:/\\d+)?" 'the -bg equivalent (e.g. bg-background -> bg-bg)'
check_alias "${ALIAS_COLOR_PREFIX}-(?:foreground|card-foreground|popover-foreground|secondary-foreground|accent-foreground)(?:/\\d+)?" 'the -fg equivalent (e.g. text-foreground -> text-fg)'
check_alias "${ALIAS_COLOR_PREFIX}-(?:card|popover)(?:/\\d+)?" 'the -elevated equivalent (e.g. bg-card -> bg-elevated)'
check_alias "${ALIAS_COLOR_PREFIX}-(?:secondary|muted)(?:/\\d+)?" 'the -field equivalent (e.g. bg-muted -> bg-field)'
check_alias "${ALIAS_COLOR_PREFIX}-input(?:/\\d+)?" 'the -border-strong equivalent (e.g. border-input -> border-border-strong)'
check_alias "${ALIAS_COLOR_PREFIX}-ring(?:/\\d+)?" 'the -focus equivalent (e.g. ring-ring -> ring-focus)'
check_alias "${ALIAS_COLOR_PREFIX}-accent(?:/\\d+)?" 'the -hover equivalent (e.g. bg-accent -> bg-hover)'
check_alias "${ALIAS_COLOR_PREFIX}-destructive(?:/\\d+)?" 'the -error equivalent (e.g. text-destructive -> text-error), never the variant="destructive" prop value'

# P110 I2-38: one radius name per value, repo-wide -- kira names win (§3.11.3's radius half).
# PT-root only, never extended to GU/KU: the kv root defines its own --radius-sm/--radius-lg
# (packages/git-ui/src/theme/tailwind.css) with different, legitimate meanings.
ALIAS_ROUNDED_SIDE='(?:t|r|b|l|tl|tr|bl|br|ss|se|es|ee)'
check_alias "rounded(?:-${ALIAS_ROUNDED_SIDE})?-sm!?" 'the rounded-kira-xs equivalent (e.g. rounded-sm -> rounded-kira-xs)'
check_alias "rounded(?:-${ALIAS_ROUNDED_SIDE})?-md!?" 'the rounded-kira-sm equivalent (e.g. rounded-md -> rounded-kira-sm)'
check_alias "rounded(?:-${ALIAS_ROUNDED_SIDE})?-lg!?" 'the rounded-kira equivalent (e.g. rounded-lg -> rounded-kira)'
check_alias "rounded(?:-${ALIAS_ROUNDED_SIDE})?-xl!?" 'the rounded-kira-pill equivalent (e.g. rounded-xl -> rounded-kira-pill)'
check_alias 'var\(--radius(-sm|-md|-lg|-xl)?\)' 'var(--kira-radius) (or the matching --kira-radius-* step) -- shadcn-bridge.css no longer defines --radius'

# P122: the one focus ring is 1px solid --kira-focus, inset (base.css's `focus-ring` utility) --
# no component may bypass it with its own halo or a wider/coloured outline.
check_focus_width "(?<![-\\w])(?:focus-visible|focus-within|focus|has-\[[^\s\"']*focus-visible\]):ring-(?:[1-9][0-9]*|focus|error)"
check_focus_width '(?<![-\w])(?:focus-visible|focus-within|focus|group-focus-within):outline-[2-9]'

# check_toggle_orientation <pattern>
# P121: the ToggleGroup/ToggleGroupItem registry string targeted Base UI's
# data-horizontal/data-vertical attributes; reka-ui's ToggleGroupRoot never emits either (only
# data-orientation, when `orientation` is passed) -- every such selector is dead on arrival, same
# root cause as check_focus_width guards a different regression class. Modelled on check_focus_width:
# SCAN_DIRS including components/ui (no legitimate survivor for either shape), plus the GU/KU pass.
check_toggle_orientation() {
  pattern="$1"
  hits=$(grep -rnoP --include='*.vue' --include='*.ts' --include='*.css' \
    -- "$pattern" $SCAN_DIRS 2>/dev/null || true)
  gu_ku_hits=$(_gu_ku_hits "$pattern")
  hits=$(printf '%s\n%s\n' "$hits" "$gu_ku_hits" | grep -v '^$' || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: dead Base UI orientation selector -- reka-ui emits data-orientation, never data-horizontal/data-vertical. Replace with data-[orientation=...] / group-not-data-[orientation=vertical]/<name>:" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}
check_toggle_orientation '(?<![-\w])(?:[a-z0-9-]+:)*(?:group-)?data-(?:horizontal|vertical)(?:/[\w-]+)?:'

# P121: the hand-rolled tab-chip class-string prefix (TabStrip, ConnectionDialog's old detail-tab
# buttons, ConsoleView's result tabs, TitleBar's mode tabs each carried their own copy) -- folded
# into tabChipVariants (packages/theme/src/components/ui/tabs). Not a single utility-class name
# (check_class's own shape), so its own small function rather than a check_class call: no
# legitimate survivor anywhere, including components/ui itself (tabs/index.ts defines the string
# once, as a cva template literal, never as this exact prefix).
check_chip_copy() {
  hits=$(grep -rnoP --include='*.vue' \
    -- 'h-control-lg inline-flex items-center gap-1 px-' $SCAN_DIRS 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: hand-rolled tab-chip class string -- replace with tabChipVariants (packages/theme/src/components/ui/tabs):" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}
check_chip_copy

# P121: Toggle/ToggleGroup's own radius must stay at the control tier (rounded-kira-sm, same as
# Button/tab chips), never the panel tier (rounded-kira) the shadcn registry default used. Scoped to
# just these two primitives -- rounded-kira is legitimate everywhere else a panel actually renders.
check_toggle_radius() {
  hits=$(grep -rnoP --include='*.vue' --include='*.ts' \
    -- 'rounded-kira(?![-\w])' "$THEME_SRC/components/ui/toggle" "$THEME_SRC/components/ui/toggle-group" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "check-theme-classes: Toggle/ToggleGroup radius at the panel tier -- use rounded-kira-sm (the control tier):" >&2
    echo "$hits" >&2
    STATUS=1
  fi
}
check_toggle_radius

if [ "$STATUS" -ne 0 ]; then
  echo "check-theme-classes: one or more retired class names are still in use. See P110 plan (docs/v1.9/plans/P110-css-tailwind-migration.md) §5.12." >&2
else
  echo "check-theme-classes: no retired class names found."
fi

exit $STATUS
