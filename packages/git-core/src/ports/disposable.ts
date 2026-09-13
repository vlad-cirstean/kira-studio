/**
 * The one non-throwing "stop this" shape every port hands back for a live subscription: a
 * `FileWatcher.watch()`, `WorkspaceRoots.onChanged()`, `Theme.onChanged()`. The concept first
 * appeared in `packages/git/src/driver.ts` (P1); this is a structural copy, not an import —
 * `packages/core` depends on nothing (§3.1, B3), and `driver.ts` is `packages/git`. Kept
 * trivial on purpose: one method, no return value, idempotent by convention (a second
 * `dispose()` is a no-op).
 */
export interface Disposable {
  dispose(): void;
}
