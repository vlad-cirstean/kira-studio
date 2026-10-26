/**
 * Cross-file review navigation. The git-ui review list owns file order and selection; the centre
 * diff tabs ask it for the adjacent file. The two sit in separate app boundaries, so the list
 * registers here (keyed by code repo id) and a tab that runs out of changes reads it.
 */
import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';

export interface ReviewNavigator {
  adjacentFile(path: string, dir: 'next' | 'previous'): string | null;
  selectFile(path: string): void;
}

export interface ReviewArrival {
  repoId: string;
  path: string;
  at: 'first' | 'last';
}

export const useReviewNavigationStore = defineStore('reviewNavigation', () => {
  const navigators = new Map<string, ReviewNavigator>();
  const arrival = ref<ReviewArrival | null>(null);

  /** Returns the unregister function; a later registration for the same repo is not removed by it. */
  function register(repoId: string, navigator: ReviewNavigator): () => void {
    const raw = markRaw(navigator);
    navigators.set(repoId, raw);
    return () => {
      if (navigators.get(repoId) === raw) navigators.delete(repoId);
    };
  }

  function navigatorFor(repoId: string): ReviewNavigator | undefined {
    return navigators.get(repoId);
  }

  function requestArrival(next: ReviewArrival): void {
    arrival.value = next;
  }

  /** The pending landing for this file, consumed once. */
  function takeArrival(repoId: string, path: string): 'first' | 'last' | null {
    const pending = arrival.value;
    if (!pending || pending.repoId !== repoId || pending.path !== path) return null;
    arrival.value = null;
    return pending.at;
  }

  return { register, navigatorFor, requestArrival, takeArrival };
});
