import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';

// P129 Part 3 §0.9/§2.5: the `ade` module's own runtime UI state — active repo tab and the
// per-repo Refresh note (§0.16's "the note persists, runtime, per repo, until the next Refresh").
// Selection (`selectedByRepo`) lands with Part 5's timeline click, `historyOpen` with the same
// part, dialog state with Part 4 — none of those exist yet, so this store carries only what Part 3
// writes (a field nobody writes is scaffolding, per the working agreement's Pinia rule: one store,
// one concern, no unused members).
export type AdeRefreshNote =
  | { kind: 'ok'; refsChanged: number; newlyMerged: string[] }
  | { kind: 'error'; message: string };

export const useAdeUiStore = defineStore('adeUi', () => {
  const state = reactive({
    /** Runtime only, never persisted (§0.15) — defaults to the first imported repo at the call
     *  site (`AdeView.vue`), not here, so this store stays ignorant of `codeReposStore`. */
    activeRepoId: '' as string,
    refreshNote: {} as Record<string, AdeRefreshNote>,
  });

  function setActiveRepo(id: string): void {
    state.activeRepoId = id;
  }

  function recordRefresh(codeRepoId: string, note: AdeRefreshNote): void {
    state.refreshNote = { ...state.refreshNote, [codeRepoId]: note };
  }

  return { ...toRefs(state), setActiveRepo, recordRefresh };
});
