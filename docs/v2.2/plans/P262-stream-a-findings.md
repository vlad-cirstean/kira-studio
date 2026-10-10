# P262 Stream A findings

Deviations and open items.

- Edited foundation file `packages/theme/src/components/SecondaryTabs.vue` (A1): tooltip wrap only when an item has a tooltip, via `<span class="inline-flex">`; fixed data-state clobber. Stream B may conflict on rebase.
- PagerControls lost borderless-at-rest style; width w-12 to w-14.
- biome `--unsafe` strips `autofocus`, so SearchField focus uses ref + `onMounted`.
- SearchField Escape clears non-empty value first. Find bars override with `@keydown.escape.stop="close"`.
- Find bars dropped search-icon error colouring.
- `Label`/`Field` used where FieldLabel would fit; ConnectionDialog field divs not converted to Field. Both unguarded.
- Toggle-style buttons with `:class="{ 'bg-field text-fg': x }"` left alone.
- Template indentation untidy after scripted edits (cosmetic).
- ConnectionDialog now xl fixed-height (intended visual change). Docker list rows use `useRowHeight` double row (44px comfortable).
- Specs asserting `is-active` or Tabs active/inactive now assert `data-state` on/off.
- Space settings-appearance baseline re-recorded (row height segmented control, same change as Studio).
