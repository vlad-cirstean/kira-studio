// C12-3: @kira/git-ui's `mount` was statically imported by both views/repo/RepoGraphView.vue and
// repo/RepoReviewView.vue, and both are reachable from workbench/modes.ts and workbench/
// tabViews.ts at app boot — pulling git-ui itself (~426 KB gzip) plus its own git-core/git-ipc/
// fuzzysort/kira-ui dependents and seti-icons' whole inlined icon set into the app's eager launch
// chunk, even for a session that never opens a repo workspace. Mirrors views/repo/monaco.ts's own
// memoized dynamic import, for the identical reason: only the first repo graph/review mount ever
// pays this cost, and every subsequent mount (or a session that never opens either) reuses or never
// pays it.
export type GitUiModule = typeof import('@kira/git-ui');

let gitUiModule: Promise<GitUiModule> | undefined;

/** Loads `@kira/git-ui`'s chunk exactly once — every subsequent call reuses the same resolved
 *  module. */
export function loadGitUi(): Promise<GitUiModule> {
  if (!gitUiModule) {
    gitUiModule = import('@kira/git-ui');
  }
  return gitUiModule;
}
