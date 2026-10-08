import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type DictationPhase = 'idle' | 'starting' | 'listening' | 'finishing' | 'error';

// P216: the one dictation session the window may run. `target` names the input it belongs to, so
// every other mic button disables and only that input shows the status line.
export const useDictationStore = defineStore('dictation', () => {
  const target = ref<string | null>(null);
  const phase = ref<DictationPhase>('idle');
  const level = ref(0);
  const error = ref('');

  const active = computed(() => ['starting', 'listening', 'finishing'].includes(phase.value));

  function begin(id: string): void {
    target.value = id;
    phase.value = 'starting';
    level.value = 0;
    error.value = '';
  }
  function setPhase(next: 'starting' | 'listening' | 'finishing', nextLevel: number): void {
    phase.value = next;
    level.value = nextLevel;
  }
  function fail(message: string): void {
    phase.value = 'error';
    level.value = 0;
    error.value = message;
  }
  function end(): void {
    if (phase.value !== 'error') phase.value = 'idle';
    level.value = 0;
  }

  return { target, phase, level, error, active, begin, setPhase, fail, end };
});
