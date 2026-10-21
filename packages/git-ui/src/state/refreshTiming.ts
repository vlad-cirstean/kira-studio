/** G-UX item 2: the graph is the last piece of client state that did not follow the
 *  `repo.changed`/`refsChanged` watcher pipeline every other state class already subscribes to
 *  (`RefsState`/`StashState`/`WorktreeState`/`StackState`/`ChangeRequestState`/`SearchState`/`OpsState`/
 *  `ReviewSessionState`/`ReviewCommentsState` — see this chapter's own ux-fixes plan, F3/D10).
 *  `RefreshButton.vue`'s pending-change dot stays — as the *backup* for the cases below that
 *  deliberately do not auto-refresh, not as the primary mechanism any more. */
export const AUTO_REFRESH_COALESCE_MS = 250; // on top of the server's own 200ms leading-window debounce
export const AUTO_REFRESH_MIN_GAP_MS = 1000; // a `git fetch --prune` storm must not re-walk continuously
