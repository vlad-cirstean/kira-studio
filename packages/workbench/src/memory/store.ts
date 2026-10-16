import {
  type MemoryOrigin,
  type MemoryScope,
  memoryOriginSchema,
  memoryScopeSchema,
} from '@shared/domain/memory';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { usePersistedState } from '../behaviour/persisted';

// P201: Memory module UI state that must survive a mode switch. P275: the search filters persist
// per viewer; an empty scope or origin list means all.
export const useMemoryUiStore = defineStore('memoryUi', () => {
  const query = ref('');
  const includeHistory = ref(false);
  const selectedId = ref<string | null>(null);
  const addOpen = ref(false);
  // Main-area view; 'distill' (P285 Part 4) joins 'memory' and 'imports'.
  const view = ref<'memory' | 'imports' | 'distill'>('memory');
  const scopes = usePersistedState<MemoryScope[]>('kira.memory.searchScopes', [], {
    schema: memoryScopeSchema.array(),
  });
  const origins = usePersistedState<MemoryOrigin[]>('kira.memory.searchOrigins', [], {
    schema: memoryOriginSchema.array(),
  });
  const project = usePersistedState('kira.memory.boostProject', '');
  return { query, includeHistory, selectedId, addOpen, view, scopes, origins, project };
});
