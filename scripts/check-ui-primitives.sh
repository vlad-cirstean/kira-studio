#!/bin/sh
# P262/P263: one UI language. Guards the element rules of docs/v2.2/plans/P262-ui-unification.md §2
# (U1-U21: dialog structure, secondary tabs, buttons, form controls, weights, icon sizes, bars,
# popovers) and docs/v2.2/plans/P263-ui-unification-2.md §2 (U22-U38: titles, spinners, alerts, tones,
# dots, toggles, tooltips, menus, resize handles, scrollbars, kbd, colours, focus, cards, tables, scale).
# Scans app/package sources, never packages/theme/src/components/ui (the primitives themselves).
#
# Named exemptions (PERMANENT below) cover a real requirement a primitive cannot meet. One that no
# longer exempts anything fails the run, so the list only shrinks.
#
# P263 allowlists (scripts/ui-primitives-allowlist/stream-*.txt): a bare `path` line exempts that file
# from U22 and later while it is unmigrated; `permanent U<n> path # reason` exempts one guard for
# good. An entry that exempts nothing fails the run, so each list only shrinks.
# Needs GNU grep -P like check-theme-classes.sh.
set -e

cd "$(dirname "$0")/.."

GNU_GREP=""
for candidate in ggrep grep; do
  if command -v "$candidate" >/dev/null 2>&1 && echo x | "$candidate" -qP 'x' 2>/dev/null; then
    GNU_GREP=$candidate
    break
  fi
done
if [ -z "$GNU_GREP" ]; then
  echo "check-ui-primitives: GNU grep with -P is required (macOS: brew install grep, provides ggrep)." >&2
  exit 1
fi

DIRS="apps/kira-studio/frontend/src apps/kira-space/frontend/src apps/kira-space/frontend/mobile packages/workbench/src packages/git-ui/src packages/docker-ui/src packages/kira-ui/src"

ALLOW_DIR=scripts/ui-primitives-allowlist

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Guard kind `s` scans only these side-panel files (the P262 section 1.6 inventory).
cat >"$TMP/side_panels" <<'PANELS'
apps/kira-studio/frontend/src/workbench/panels/ProjectPanel.vue
apps/kira-studio/frontend/src/api/CollectionsPanel.vue
packages/docker-ui/src/components/DockerPanel.vue
packages/workbench/src/automations/AutomationsPanel.vue
packages/workbench/src/memory/MemoryPanel.vue
apps/kira-space/frontend/src/repo/GitPanel.vue
apps/kira-studio/frontend/src/project/ProjectTree.vue
apps/kira-studio/frontend/src/project/TreeRow.vue
apps/kira-studio/frontend/src/api/CollectionsTree.vue
apps/kira-studio/frontend/src/api/CollectionRow.vue
packages/docker-ui/src/components/ContainerList.vue
packages/docker-ui/src/components/ImageList.vue
packages/docker-ui/src/components/VolumeList.vue
packages/docker-ui/src/components/NetworkList.vue
packages/docker-ui/src/components/VirtualList.vue
packages/docker-ui/src/components/ListState.vue
apps/kira-space/frontend/src/repo/RepoFileTree.vue
apps/kira-space/frontend/src/repo/RepoTreeRow.vue
apps/kira-space/frontend/src/repo/RepoSearchView.vue
apps/kira-space/frontend/src/repo/RepoSearchRow.vue
apps/kira-space/frontend/src/repo/RepoReviewView.vue
packages/git-ui/src/components/review/ReviewView.vue
packages/git-ui/src/components/review/ReviewCommitRow.vue
packages/git-ui/src/components/review/ReviewFilesPane.vue
packages/git-ui/src/components/review/ReviewCommentsPane.vue
packages/git-ui/src/components/FileTree.vue
apps/kira-space/frontend/src/ade/v2/review/AdeReviewWindow.vue
apps/kira-space/frontend/src/ade/v2/review/AdeReviewFiles.vue
apps/kira-space/frontend/src/ade/v2/review/AdeReviewAgentPanel.vue
apps/kira-space/frontend/src/ade/v2/panel/AdePanel.vue
apps/kira-space/frontend/src/ade/v2/panel/AdePanelFrame.vue
apps/kira-space/frontend/src/ade/v2/panel/AdePanelResizeHandle.vue
apps/kira-space/frontend/src/ade/v2/panel/AdeTaskPanel.vue
apps/kira-space/frontend/src/ade/v2/panel/AdeBranchPanel.vue
apps/kira-space/frontend/src/ade/v2/panel/AdeArchivedPanel.vue
apps/kira-space/frontend/src/ade/v2/backlog/AdeBacklogPage.vue
apps/kira-space/frontend/src/ade/v2/backlog/AdeBacklogPanel.vue
apps/kira-space/frontend/src/ade/v2/backlog/AdeBacklogRow.vue
apps/kira-space/frontend/src/ade/v2/sessions/AdeStoppedList.vue
apps/kira-space/frontend/src/ade/v2/sessions/AdeStoppedRow.vue
apps/kira-space/frontend/src/repo/ReposDialog.vue
packages/workbench/src/components/WorkbenchShell.vue
packages/workbench/src/components/PanelHeader.vue
packages/workbench/src/components/TreeTwisty.vue
packages/workbench/src/components/SettingsShell.vue
PANELS

# "U<n> path # reason": one guard exempt for one file.
cat >"$TMP/perm" <<'PERMANENT'
U3 apps/kira-studio/frontend/src/shortcuts/CommandPalette.vue # CommandDialog is the command surface, theme-owned (P262 section 2.2 exempt)
U11 packages/docker-ui/src/components/LogsView.vue # ANSI bold is log data, not UI chrome
U9 apps/kira-space/frontend/src/ade/v2/backlog/AdeBacklogRow.vue # inline edit input blends into the row until focused
U17 packages/git-ui/src/components/SearchBox.vue # combobox owns two-stage Escape (dismiss dropdown keeps query); SearchField clears on first Esc
U9 apps/kira-space/frontend/mobile/screens/BacklogScreen.vue # h-11 is the 44px touch height
U9 apps/kira-space/frontend/mobile/screens/TerminalScreen.vue # h-11 is the 44px touch height
U27 packages/workbench/src/components/ContextMenu.vue # 10px colour swatch marks a Color submenu choice, it is not a status dot
U31 packages/workbench/src/components/WorkbenchShell.vue # row-resize cursor held shell-wide while the dock drag runs, the pointer leaves the 2px handle
PERMANENT

# `(?&t)` = the inside of one tag, quote-aware so `=>` or `a > b` inside an attribute value does not
# end the tag early.
PRE='(?(DEFINE)(?<t>(?:"[^"]*"|'"'"'[^'"'"']*'"'"'|[^>"'"'"'])*))'
TOK='(?<![\w-])'

# id@@files(v=.vue, vt=.vue+.ts, s=.vue+.ts in SIDE_PANELS only, vS=.vue under /settings/ only)@@built-in exempt paths (|; a name
# matches a file name, a /dir/ matches anywhere in the path)@@message@@regex
cat >"$TMP/guards" <<GUARDS
U1@@v@@@@<DialogContent without size=@@<DialogContent\b(?!(?&t)\bsize=)
U2@@v@@@@<DialogContent class sets width, height, padding or gap (size= owns them)@@<DialogContent\b(?&t)\bclass="[^"]*${TOK}(?:w|h|max-w|max-h|min-w|min-h|p|gap)-
U3@@v@@TextPromptDialog.vue@@role="dialog" outside TextPromptDialog.vue@@role="dialog"
U4@@v@@@@<ToggleGroup/<ToggleGroupItem outside SecondaryTabs (use <SecondaryTabs>)@@<ToggleGroup(?:Item)?\b
U5@@v@@AdeShell.vue@@<TabsList/<TabsTrigger outside AdeShell.vue (use <SecondaryTabs>)@@<Tabs(?:List|Trigger)\b
U6@@vt@@TabStrip.vue|ModeSwitcher.vue|AdeShell.vue|ConsoleView.vue|ExecView.vue|AdeSessionStrip.vue@@tabChipVariants( outside primary tab bars@@tabChipVariants\(
U7@@v@@@@<Button without variant, or retired variant default/secondary/outline/destructive@@<Button\b(?:(?!(?&t)\s:?variant=)|(?&t)\svariant="(?:default|secondary|outline|destructive)")
U8@@v@@@@<Button without size, or retired size default/xs/sm/lg/icon/icon-xs/icon-lg/icon-sm@@<Button\b(?:(?!(?&t)\s:?size=)|(?&t)\ssize="(?:default|xs|sm|lg|icon|icon-xs|icon-lg|icon-sm)")
U9@@v@@@@Input/NativeSelect/Textarea/InputGroup with size="default" or h-/rounded-/bg-/border-/px-/py- class@@<(?:Input|NativeSelect|Textarea|InputGroup)\b(?:(?&t)\ssize="default"|(?&t)\s:?class="[^"]*${TOK}(?:h|rounded|bg|border|px|py)-)
U10@@v@@@@raw <label>/<select> (use FieldLabel/Label, NativeSelect)@@<(?:label|select)\b
U11@@vt@@PanelHeader.vue@@font-bold, or font-semibold outside PanelHeader@@${TOK}font-(?:bold|semibold)(?![\w-])
U12@@v@@@@CodiconIcon :size outside 12/13/16/24@@<CodiconIcon\b(?&t)\s:size="(?!(?:12|13|16|24)")\d+"
U13@@v@@PanelHeader.vue@@hand-rolled panel header/toolbar bar (use PanelHeader/ViewToolbar)@@\bclass="(?=[^"]*${TOK}h-bar(?![\w-]))(?=[^"]*${TOK}gap-1(?![\w.-]))(?=[^"]*${TOK}border-b(?![\w-]))(?:(?=[^"]*${TOK}px-1\.5(?![\w-]))(?=[^"]*${TOK}text-kira-sm(?![\w-]))|(?=[^"]*${TOK}px-2(?![\w-]))(?=[^"]*${TOK}shrink-0(?![\w-])))
U14@@v@@@@EmptyMedia variant="icon", or Alert faking an empty state@@<EmptyMedia\b(?&t)\svariant="icon"|<Alert\b(?&t)\sclass="[^"]*${TOK}bg-transparent
U15@@v@@@@PopoverContent width outside w-56/w-80/w-96/w-120/w-auto@@<PopoverContent\b(?&t)\s:?class="[^"]*${TOK}w-(?!(?:56|80|96|120|auto)(?![\w.\[(-]))
U16@@v@@@@DialogClose wrapping an icon-sm Button (use DialogHeader closable)@@<DialogClose\b(?&t)>\s*<Button\b(?&t)\ssize="icon-sm"
U17@@v@@@@search/filter text box outside SearchField (use <SearchField>)@@<(?:Input|InputGroupInput|input)\\b(?&t)\\s:?placeholder="[^"]*(?:[Ss]earch|[Ff]ilter|[Ff]ind)|<InputGroupAddon\\b(?&t)>\\s*<CodiconIcon\\b(?&t)\\sname="search"
U18@@s@@@@hand-rolled row state (use rowVariants selected/muted)@@${TOK}(?:hover:)?bg-(?:select|hover)(?![\w-])
U19@@s@@@@hand-rolled indent or row height (use rowIndent, useRowHeight, rowVariants)@@depth\s*\*\s*\d+|rowDensity\s*===|(?:ROW_HEIGHT|rowHeight)\s*[:=]\s*\d+|${TOK}(?:h-5\.5|min-h-9)(?![\w-])
U20@@s@@@@hand-rolled panel chrome (use Empty class="h-full", PanelBar)@@side-empty|<Empty\b(?&t)\sclass="[^"]*${TOK}(?:p|px|py)-|shrink-0 border-b border-border px-1\.5 py-1
U21@@s@@PanelHeader.vue@@hand-rolled uppercase heading (use PanelHeader/SectionHeading)@@${TOK}uppercase(?![\w-])
U22@@v@@@@native title= on an HTML element (use Tooltip)@@<(?:span|div|button|i|li|dd|dt|a|label|Label|p|td|th|tr|img|code|small|section|header)\b(?&t)\s:?title=
U23@@vt@@@@animate-spin/animate-pulse/codicon-modifier-spin (use Spinner, Skeleton, StatusDot pulse)@@${TOK}animate-(?:spin|pulse)(?![\w-])|codicon-modifier-spin|~spin
U24@@v@@@@Alert class sets width/margin/fill/radius/border/padding, AlertDescription class, or variant="default"@@<Alert\b(?&t)\s:?class="[^"]*${TOK}(?:(?:w|m|mx|my|mt|mb|ml|mr|bg|p|px|py|pt|pb)-|(?:rounded|border)\b)|<AlertDescription\b(?&t)\s:?class="(?!whitespace-pre-wrap")|<Alert\b(?&t)\svariant="default"
U25@@v@@@@p/div with text-error (use FieldError or InlineState)@@<(?:p|div)\b(?&t)\s:?class="[^"]*${TOK}text-error(?![\w-])
U26@@vt@@@@retired tone variant err/destructive/note, or a tone alpha (use Badge, Alert, StatusDot)@@<(?:Badge|Alert|DropdownMenuItem)\b(?&t)\svariant="(?:err|destructive|note)"|${TOK}(?:text|bg|border)-(?:ok|warn|info|error)/\d+
U27@@v@@@@hand-rolled status dot or pill (use StatusDot, Badge)@@\bclass="(?=[^"]*${TOK}rounded-full(?![\w-]))(?:(?=[^"]*${TOK}size-(?:1\.5|2|2\.5)(?![\w.-]))|(?=[^"]*${TOK}w-2(?![\w.-]))(?=[^"]*${TOK}h-2(?![\w.-]))|(?=[^"]*${TOK}w-2\.5(?![\w.-]))(?=[^"]*${TOK}h-2\.5(?![\w.-])))|<span\b(?&t)\s:?class="(?=[^"]*${TOK}(?:rounded-full|rounded-kira-pill)(?![\w-]))(?=[^"]*${TOK}px-)
U28@@v@@SwatchRadio.vue@@raw checkbox/radio input (use Checkbox, RadioGroup)@@type="(?:checkbox|radio)"
U28@@vS@@@@Checkbox in a settings pane (a live boolean is a Switch)@@<Checkbox\b
U28@@v@@/settings/|MemoryPanel.vue|AdeTaskTab.vue|ReposDialog.vue@@Switch outside settings panes (a form option is a Checkbox)@@<Switch\b
U29@@v@@@@TooltipProvider with props (the theme owns the delays), or TooltipContent class other than whitespace-pre-wrap@@<TooltipProvider\b(?!\s*>)|<TooltipContent\b(?&t)\s:?class="(?!whitespace-pre-wrap")
U30@@v@@@@DropdownMenuContent width, or DropdownMenuItem height/padding/gap class@@<DropdownMenuContent\b(?&t)\s:?class="[^"]*${TOK}(?:w|min-w|max-w)-|<DropdownMenuItem\b(?&t)\s:?class="[^"]*${TOK}(?:h|py|px|gap)-
U31@@v@@@@hand-written resize cursor or handle look, or a separator without resizeHandleVariants@@${TOK}cursor-(?:col|row)-resize|<(?:ResizableHandle|KuiColumnResizeHandle)\b(?&t)\s:?class="[^"]*${TOK}(?:w-|h-|bg-|shadow|cursor|outline)|(?s)\A(?!.*resizeHandleVariants).*role="separator"
U32@@v@@@@scrollbar styling in a component (use scrollbar-none, base.css)@@\[scrollbar-|${TOK}scrollbar-(?!none(?![\w-]))[\w-]+|::-webkit-scrollbar
U33@@v@@@@keyboard hint text (use Kbd)@@Cmd/Ctrl|\(\{\{\s*formatShortcut
U34@@vt@@monacoTheme.ts|ansi.ts|/setiFileIcon|/ade/v2/palette.ts@@colour literal in app code (use tokens)@@(?:["'\`\[(]|:\s*)#(?:[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?|(?=[0-9]*[a-fA-F])[0-9a-fA-F]{3,4}|(?<d>\d)\k<d>\k<d>\k<d>?)\b|${TOK}(?:bg|text|border)-(?:black|white)(?![\w-])
U35@@v@@CommitGrid.vue|/git-ui/src/App.vue|AdeNotesEditor.vue|ReviewThread.vue|AutocompleteField.vue|InlineRenameInput.vue@@outline-none, border-focus, not-allowed cursor or odd disabled opacity (one focus and disabled recipe)@@${TOK}outline-(?:none|hidden|0)(?![\w-])|focus:outline|focus-visible:outline-|${TOK}focus(?:-visible|-within)?:border-focus|${TOK}cursor-not-allowed|${TOK}disabled:opacity-(?!50(?![\w-]))|data-\[off\]
U36@@v@@@@hand-rolled box (use Card)@@\bclass="(?=[^"]*${TOK}rounded-kira(?:-sm|-lg)?(?![\w-]))(?=[^"]*${TOK}border(?![\w-]))(?=[^"]*${TOK}(?:p|px|py)-)
U37@@vt@@createSettingsStore.ts@@raw table markup, density formula, or hand-rolled row state (use Table, useRowHeight, rowVariants)@@<(?:table|thead|tbody|tr|th|td)\b|rowDensity\s*===|${TOK}(?:hover:)?bg-(?:select|hover)(?![\w-])
U38@@v@@@@scale leftovers: text-kira-xs, stock text size/radius, text-[Npx], raw h-5..h-12@@${TOK}text-kira-xs(?![\w-])|${TOK}text-(?:xs|sm|base|lg|xl|2xl)(?![\w-])|${TOK}text-\[\d|${TOK}rounded(?:-md|-lg|-xl)?(?![\w-])|${TOK}h-(?:5|6|7|8|9|10|12)(?![\w.-])
GUARDS

# hits: "U<n> path"
: >"$TMP/hits"
while IFS= read -r line; do
  id=${line%%@@*}; rest=${line#*@@}
  kinds=${rest%%@@*}; rest=${rest#*@@}
  exempt=${rest%%@@*}; rest=${rest#*@@}
  rest=${rest#*@@}
  regex=$rest
  if [ "$kinds" = vt ]; then inc="--include=*.vue --include=*.ts"; else inc="--include=*.vue"; fi
  scan=$DIRS; flag=-r
  if [ "$kinds" = s ]; then
    inc=""; flag=""
    scan=$(cat "$TMP/side_panels")
  elif [ "$kinds" = vS ]; then
    inc=""; flag=""
    # shellcheck disable=SC2086
    scan=$(find $DIRS -path '*/settings/*' -name '*.vue')
  fi
  set +e
  # shellcheck disable=SC2086
  "$GNU_GREP" $flag -Pzl $inc -e "$PRE$regex" $scan >"$TMP/out" 2>"$TMP/err"
  rc=$?
  set -e
  if [ "$rc" -gt 1 ]; then
    echo "check-ui-primitives: grep failed for $id:" >&2
    cat "$TMP/err" >&2
    exit 2
  fi
  tr '\0' '\n' <"$TMP/out" | while IFS= read -r f; do
    if [ -z "$f" ]; then continue; fi
    skip=0
    if [ -n "$exempt" ]; then
      old_ifs=$IFS; IFS='|'
      for e in $exempt; do
        case "$e" in
          /*) case "$f" in *"$e"*) skip=1 ;; esac ;;
          *) case "$f" in */"$e") skip=1 ;; esac ;;
        esac
      done
      IFS=$old_ifs
    fi
    if [ "$skip" -eq 0 ]; then echo "$id $f"; fi
  done >>"$TMP/hits"
done <"$TMP/guards"
sort -u "$TMP/hits" -o "$TMP/hits"

sed 's/[[:space:]]*#.*$//' "$TMP/perm" | sort -u >"$TMP/perm_ids"
mv "$TMP/perm_ids" "$TMP/perm"

# allowlists: `path` (whole file, U22 and later) or `permanent U<n> path # reason`
: >"$TMP/whole"
if [ -d "$ALLOW_DIR" ]; then
  for list in "$ALLOW_DIR"/*.txt; do
    [ -f "$list" ] || continue
    while IFS= read -r raw; do
      entry=$(printf '%s' "$raw" | sed 's/[[:space:]]*#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//')
      if [ -z "$entry" ]; then continue; fi
      case "$entry" in
        permanent\ *)
          # shellcheck disable=SC2086
          set -- $entry
          echo "$2 $3" >>"$TMP/perm" ;;
        *) echo "$entry" >>"$TMP/whole" ;;
      esac
    done <"$list"
  done
fi
sort -u "$TMP/whole" -o "$TMP/whole"
sort -u "$TMP/perm" -o "$TMP/perm"

STATUS=0
: >"$TMP/used_perm"
: >"$TMP/used_whole"
while read -r id f; do
  num=${id#U}
  if grep -qxF "$id $f" "$TMP/perm"; then
    echo "$id $f" >>"$TMP/used_perm"
  elif [ "$num" -ge 22 ] && grep -qxF "$f" "$TMP/whole"; then
    echo "$f" >>"$TMP/used_whole"
  else
    msg=$(grep "^$id@@" "$TMP/guards" | head -1 | awk -F'@@' '{print $4}')
    echo "check-ui-primitives: $f: $id $msg" >&2
    STATUS=1
  fi
done <"$TMP/hits"

sort -u "$TMP/used_perm" -o "$TMP/used_perm"
sort -u "$TMP/used_whole" -o "$TMP/used_whole"
while read -r id f; do
  if ! grep -qxF "$id $f" "$TMP/used_perm"; then
    echo "check-ui-primitives: stale exemption: $id $f" >&2
    STATUS=1
  fi
done <"$TMP/perm"
while read -r f; do
  if ! grep -qxF "$f" "$TMP/used_whole"; then
    echo "check-ui-primitives: stale allowlist entry (file passes U22-U38 or is gone): $f" >&2
    STATUS=1
  fi
done <"$TMP/whole"

if [ "$STATUS" -ne 0 ]; then
  echo "check-ui-primitives: see docs/v2.2/plans/P262-ui-unification.md and P263-ui-unification-2.md §2." >&2
else
  echo "check-ui-primitives: every guarded element follows the P262 and P263 rules."
fi
exit $STATUS
