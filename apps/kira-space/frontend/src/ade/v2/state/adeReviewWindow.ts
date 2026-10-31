import { usePersistedState } from '@workbench/behaviour/persisted';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ReviewWindowTarget } from '../wire';

// This window's review state: its target (set once at boot; a window with a target is a review
// window), the right pane's tab pick and whether the agent panel shows.
export const useAdeReviewWindowStore = defineStore('adeReviewWindow', () => {
  const target = ref<ReviewWindowTarget | null>(null);

  /** The right pane's tab the user picked; null until then (the pane then picks by the review step). */
  const rightTab = ref<'workflow' | 'ask' | null>(null);

  // Off until the user opens it. Per device, like the pane widths: review windows are not restored.
  const agentPanelVisible = usePersistedState('kira.ade.review.agentPanel', false);
  function toggleAgentPanel(): void {
    agentPanelVisible.value = !agentPanelVisible.value;
  }

  return { target, rightTab, agentPanelVisible, toggleAgentPanel };
});
