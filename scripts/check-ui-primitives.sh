#!/bin/sh
# P262: one UI language. Guards the element rules of docs/v2.2/plans/P262-ui-unification.md §2
# (dialog structure, secondary tabs, buttons, form controls, weights, icon sizes, bars, popovers).
# Scans app/package sources, never packages/theme/src/components/ui (the primitives themselves).
#
# Allowlists in scripts/ui-primitives-allowlist/*.txt, one entry per line, `#` comments:
#   path                                  whole file exempt while unmigrated (stream work in progress)
#   permanent U<n> path # reason          one guard exempt for a real requirement
# An entry that no longer exempts anything fails the run, so lists only shrink.
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

# `(?&t)` = the inside of one tag, quote-aware so `=>` or `a > b` inside an attribute value does not
# end the tag early.
PRE='(?(DEFINE)(?<t>(?:"[^"]*"|'"'"'[^'"'"']*'"'"'|[^>"'"'"'])*))'
TOK='(?<![\w-])'

# id@@files(v=.vue, vt=.vue+.ts)@@built-in exempt path substrings (|)@@message@@regex
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
  set +e
  # shellcheck disable=SC2086
  "$GNU_GREP" -rPzl $inc -e "$PRE$regex" $DIRS >"$TMP/out" 2>"$TMP/err"
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
        case "$f" in */"$e") skip=1 ;; esac
      done
      IFS=$old_ifs
    fi
    if [ "$skip" -eq 0 ]; then echo "$id $f"; fi
  done >>"$TMP/hits"
done <"$TMP/guards"
sort -u "$TMP/hits" -o "$TMP/hits"

# allowlist
: >"$TMP/whole"
: >"$TMP/perm"
if [ -d "$ALLOW_DIR" ]; then
  for list in "$ALLOW_DIR"/*.txt; do
    [ -f "$list" ] || continue
    while IFS= read -r raw; do
      entry=$(printf '%s' "$raw" | sed 's/[[:space:]]*#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//')
      if [ -z "$entry" ]; then continue; fi
      case "$entry" in
        permanent\ *)
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
: >"$TMP/used_whole"
: >"$TMP/used_perm"
while read -r id f; do
  if grep -qxF "$id $f" "$TMP/perm"; then
    echo "$id $f" >>"$TMP/used_perm"
  elif grep -qxF "$f" "$TMP/whole"; then
    echo "$f" >>"$TMP/used_whole"
  else
    msg=$(grep "^$id@@" "$TMP/guards" | head -1 | awk -F'@@' '{print $4}')
    echo "check-ui-primitives: $f: $id $msg" >&2
    STATUS=1
  fi
done <"$TMP/hits"

sort -u "$TMP/used_whole" -o "$TMP/used_whole"
sort -u "$TMP/used_perm" -o "$TMP/used_perm"
while read -r f; do
  if ! grep -qxF "$f" "$TMP/used_whole"; then
    echo "check-ui-primitives: stale allowlist entry (file passes every guard or is gone): $f" >&2
    STATUS=1
  fi
done <"$TMP/whole"
while read -r id f; do
  if ! grep -qxF "$id $f" "$TMP/used_perm"; then
    echo "check-ui-primitives: stale permanent entry: $id $f" >&2
    STATUS=1
  fi
done <"$TMP/perm"

if [ "$STATUS" -ne 0 ]; then
  echo "check-ui-primitives: see docs/v2.2/plans/P262-ui-unification.md §2." >&2
else
  echo "check-ui-primitives: every guarded element follows the P262 rules."
fi
exit $STATUS
