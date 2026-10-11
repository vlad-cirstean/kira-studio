# P263 Stream A findings

Cross-ownership items for close-out.

- `packages/workbench/src/settings/fields/WordWrapField.vue` uses `Checkbox` for a live setting. Rule: Switch in settings panes. Shared by Studio and Space `AppearancePane`. Change it to `Switch`, then re-record `settings-appearance-visual-linux.png` (Studio) and the Space equivalent.
- Theme `RadioGroupItem` has an `after:-inset-x-3 after:-inset-y-2` hit area that overlaps an adjacent control. Worked around in `EnvironmentsView` with `after:inset-0`. Any other radio next to a drag grip or button needs the same.
