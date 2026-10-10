# P262 Stream B findings

Fixed in close-out on landed `v2.0`.

- `SecondaryTabs`: no per-item `aria-label`. Icon-only items use an `sr-only` span in the `item` slot. `repo-review-interaction.spec.ts` selector `[aria-label^="Files"]` changed to `[data-testid="review-pane-files"]`.
- `InputGroup` default `kira-lg` carries `font-data`. Check number steppers.
- `AdeClaudeDialog` target chips lose the Claude-tone "on" styling (plain segmented per plan).
- `SearchField` autofocus prop trips biome `noAutofocus`. Callers use ref + `focus()`.
- `Label` base adds `flex gap-2 text-kira-md font-medium`. Migrated labels add `font-normal` to keep prior look.
- `AdePanelResizeHandle` renders the foundation `ResizableHandle` look (`w-1`, inset border line); plan text says `w-0.5`. Foundation handle is 4px.
- Permanent U9: `AdeBacklogRow` inline edit input (transparent until focus), mobile `BacklogScreen` and `TerminalScreen` (`h-11` touch height).
- Permanent U17: git-ui `SearchBox` (two-stage Escape).
- Foundation bug, `SecondaryTabs`: `TooltipTrigger as-child` wraps every `ToggleGroupItem` (also with no `tooltip`), so the trigger's `data-state="closed"` overwrites the toggle's `on`/`off`. `data-[state=on]:` active styling (`bg-field text-fg`) never applies. `aria-pressed` and `data-active` stay correct. Fix: render `Tooltip` only for items with a `tooltip`. Specs now assert `aria-pressed`.
- `SecondaryTabs` item text carries template whitespace (`" Files "`). Specs trim `allTextContents()`.
