import { usePersistedState } from '@workbench/behaviour/persisted';
import type { Ref } from 'vue';
import { z } from 'zod';

export type DiffLayout = 'sideBySide' | 'inline';

const schema = z.enum(['sideBySide', 'inline']);

/** The one per-device layout choice every repo diff editor follows. */
export function useDiffLayout(): Ref<DiffLayout> {
  return usePersistedState<DiffLayout>('kira.repo.diffLayout', 'sideBySide', { schema });
}
