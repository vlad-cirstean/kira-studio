# P264 Stream C findings

Foundation changes needed (not made; worked around in stream C):

- `packages/workbench/src/behaviour`: `useTimeoutFn` (VueUse 10.11.1) never starts without `window` (bun tests); `useDebounceFn` has no cancel. Stream C added `packages/git-ui/src/state/cancellableTimer.ts` (debounce plus generation guard). Candidate foundation primitive.
- `scripts/check-ui-primitives.sh` hardcodes `packages/docker-ui/src/components/ListState.vue` in its side-panel list. File kept, now the empty block.
- `useShortcut` matches the platform chord only; WebKit UA is Mac, so specs press Meta/Control by `navigator.userAgent`.
- Context menu store: reka menu closes on Escape without stopping propagation. git-ui `App.vue` records open state in a capture-phase listener so the same Escape does not close the detail pane. Foundation could stop propagation in `ContextMenu.vue`.
- git-ui is a separate Vue app via `mount()` and uses the host's active Pinia and `<ContextMenu />`. Installing its own Pinia breaks it.
