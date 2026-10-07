# Stream A notes (P185-P188)

## P185 resize stays attached

Repro (webkit, Studio and Space): `panel-resize.spec.ts` in each app. Before the fix the project
handle failed on "drag and release over the page", "drag out of the viewport and release" and a
swallowed release: after `mouseup` the handle was `data-state="inactive"`, `main-panel` kept
`pointer-events: none`, moving the mouse resized.

Cause: plan candidate H2, confirmed with a `data-state` mutation probe. The handle went `drag` then
`inactive` mid-drag (before `mouseup`). reka 2.10.5 re-registers a handle when its `hitAreaMargins`
prop changes identity; `WorkbenchShell.vue` passes a literal object, rebuilt on each render. The
re-registration drops the handle's `data` from the registry while `intersectingHandles` still holds
the old one, so `mouseup` reaches no active handle and `stopDragging()` never runs. H1 (lost
`mouseup`) is real but secondary; H3 not seen. Dock and ade handles (VueUse `useDraggable`,
15.0.0) never failed; it already ends on `pointercancel`, so no `lostpointercapture` listener added.
`KuiColumnResizeHandle.vue` untouched (probe never failed).

Fix: `ResizableHandle.vue` keeps `hitAreaMargins` in a `shallowRef` rebuilt only when
coarse/fine change. New `useDragReleaseFallback.ts` (same dir) replays a release on `window` while a
drag is live: reka mode `mouseup` (`pointerup`/`pointercancel`/`blur`/`pointermove` buttons=0),
`pointerup` mode for `DockResizeHandle.vue` and `AdePanelResizeHandle.vue`. `WorkbenchShell.vue`
unchanged.

Deviation: plan said reka sets `pointer-events: none` on panels; true (`utils/style.js`), confirmed.
Plan step 4 (`lostpointercapture`) skipped as above.

## P186

Header shows one `add` button (`quick-commands-manage`) opening the dialog with the add form
focused; empty-state button opens the same dialog. Inline add row and gear removed. Command fields
are `Textarea` (theme's `field-sizing-content`, so a one-line command looks single-line, `rows` 2 is
the minimum only where field-sizing is unsupported); Cmd/Ctrl+Enter adds. Panel row shows first line
plus `…`, full text in `title`. Visual snapshot updated.

## P187

Migration 0031 (`collection` column), Go model/repo (`collection ASC, sort_order ASC, name ASC`,
trim, 64-rune cap), zod `collection`. Dialog field with `<datalist>`. Panel: ungrouped first, then
collections by name, `TreeTwisty` header + count, collapsed names in
`useLocalStorage('kira.quickCommands.collapsed')`; search expands every matching group. Rows
`text-left`. Group header toggle is a `<button>` beside the twisty (biome a11y forbids a clickable
div). Collections have no rename/delete UI: edit each command's field.

## P188

Studio: `ClaudeCodePane`, `claudeCode` section (Go/zod), `SetAgentAware`, agent count/recompute,
`Registry.OnChange` hook (it fed only keep-awake), `StartKeepAwake`, mock channels, spec removed.
Migration 0032 deletes `claudeCode.keepAwakeWithAgents`. Title-bar toggle kept.

Space: `claudeCode.keepAwakeWithAgents` leaf (Go model/repo, zod), Claude Code pane in the
Settings draft/Save flow, `SettingsService.OnChanged`.

Deviation: the recompute is package-level `bridge.KeepAwakeRecompute(svc)`, not a `Recompute()`
method (Wails binds every exported method; Studio's own precedent). It emits `ChannelKeepAwake`
only when the agent reason flips (status carries no agent field). Agent count = terminal-registry
agent sessions + `AdeSessions.ListTask()` rows running in `headless` mode. Triggers: terminal
`Registry.OnChange`, ade board `OnSessions` (broadcast kept), `SettingsService.OnChanged`, boot.
`wireAdeTask` gained a `keepAwake` parameter.

## Proposed ARCHITECTURE.md edits (for the orchestrator)

- Splitter: reka 2.10.5 ends a drag only on a `window` `mouseup` and re-registers on any
  `hitAreaMargins` identity change; `ResizableHandle` stabilises the margins and replays a lost
  release.
- Keep-awake: Studio has the manual toggle only; Space adds the agent reason
  (`claudeCode.keepAwakeWithAgents`).
- Quick commands have a `collection` (migration 0031); settings migration 0032.

## Verification

See final report.

### Results (full suites, this container)

- `go test ./apps/... ./internal/...`: all pass. `bun run test:unit`: 1800 pass (after regenerating
  Studio's gitignored bindings, `wails3 task common:generate:bindings`; `SetAgentAware` was stale).
- `test:ui:space`: 184 pass. `test:ui:studio`: 328 pass; `sql-schema` "stages until Save" and
  `tooltips` edge failed under full-suite load, pass on rerun (flaky, unrelated).
- Visual: `terminal-module` snapshot regenerated (passes). Studio `tests/visual/settings.spec.ts`
  lost its 'Claude Code' entry and snapshot (P188; file not in the ownership table, edit is the
  direct consequence).
- Open, not fixed: 12 other Studio visual baselines and 4 Space `settings` baselines fail on whole-text
  anti-aliasing drift (diff images show every glyph, including areas no stream touched; e.g.
  `workbench shell at rest`, `connection dialog`). Environment font drift, not a stream change.
  Regenerating them here would rewrite binaries other streams also touch, so left for the
  orchestrator to regenerate once, after landing, on the baseline environment. Space also gained a
  Claude Code settings nav item, so its settings baselines need that regeneration regardless.
