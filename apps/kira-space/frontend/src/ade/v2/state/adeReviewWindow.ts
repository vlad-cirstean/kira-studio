import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ReviewWindowTarget } from '../wire';

/** A line range of a file in the diff on screen; `end` equals `start` for a single line. */
export interface ReviewSelection {
  path: string;
  start: number;
  end: number;
}

// This window's review state: its target (set once at boot; a window with a target is a review
// window), the question draft, and the code reference the next question carries.
export const useAdeReviewWindowStore = defineStore('adeReviewWindow', () => {
  const target = ref<ReviewWindowTarget | null>(null);
  const draft = ref('');
  /** The selection in the diff on screen, tracked by the diff view. */
  const selection = ref<ReviewSelection | null>(null);
  /** A selection `Ask review agent` pinned; wins over `selection` until sent or cleared. */
  const asked = ref<ReviewSelection | null>(null);
  /** Bumped by `Ask review agent` so the compose box takes focus. */
  const askNonce = ref(0);

  const reference = computed(() => asked.value ?? selection.value);

  function ask(sel: ReviewSelection): void {
    asked.value = sel;
    askNonce.value++;
  }

  function sent(): void {
    draft.value = '';
    asked.value = null;
  }

  return { target, draft, selection, asked, askNonce, reference, ask, sent };
});
