import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ReviewWindowTarget } from '../wire';

// This window's review state: its target (set once at boot; a window with a target is a review
// window) and the right pane's tab pick.
export const useAdeReviewWindowStore = defineStore('adeReviewWindow', () => {
  const target = ref<ReviewWindowTarget | null>(null);

  /** The right pane's tab the user picked; null until then (the pane then picks by the review step). */
  const rightTab = ref<'workflow' | 'ask' | null>(null);

  return { target, rightTab };
});
