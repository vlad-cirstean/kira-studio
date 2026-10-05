import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ReviewWindowTarget } from '../wire';

// This window's review target. Set once at boot: a window with a target is a review window.
export const useAdeReviewWindowStore = defineStore('adeReviewWindow', () => {
  const target = ref<ReviewWindowTarget | null>(null);
  return { target };
});
