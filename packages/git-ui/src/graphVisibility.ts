// Lets a kept-mounted host (Kira Space's `RepoGraphView.vue`, hidden with v-show via its `active` prop) tell this mount's own `CommitGrid.vue`
// it has been backgrounded, so a `repo.changed`-
// driven generation bump (`graphView.generation`/`search.searchGeneration`/`pr.generation`/
// `stack.generation`, CommitGrid.vue's own four-watcher pattern) defers its full rebuild
// (layout-worker output plus a SlickGrid column/row rebuild) until the grid is visible again,
// instead of paying that cost against a grid nobody can see. Provided at the `createApp` level in
// `main.ts`'s own `mount()` — scoped per mount, since more than one repo workspace's graph can be
// open (and independently backgrounded) at once. Not provided at all (every other `mount()` caller
// — `ReviewView`, this package's own tests) means always visible,
// unchanged from before this fix.
import { type InjectionKey, inject, type ShallowRef, shallowRef } from 'vue';

export const GRAPH_VISIBLE_KEY: InjectionKey<ShallowRef<boolean>> = Symbol('kira-graph-visible');

/** `CommitGrid.vue`'s own read side — always visible when nothing provided it (see header
 *  comment), so every existing caller/test keeps today's behavior exactly. */
export function useGraphVisible(): ShallowRef<boolean> {
  return inject(GRAPH_VISIBLE_KEY, () => shallowRef(true), true);
}
