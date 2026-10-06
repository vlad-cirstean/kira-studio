import { defineStore } from 'pinia';
import { ref } from 'vue';

// Repos page state, in memory only.
export const useAdeReposUiStore = defineStore('adeReposUi', () => {
  /** Selected repo (`null` = first listed). */
  const repoId = ref<string | null>(null);
  return { repoId };
});
