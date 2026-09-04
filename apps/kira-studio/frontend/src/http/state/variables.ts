import type { HttpEnvironment } from '@shared/domain/variables';
import { computed, reactive } from 'vue';
import { control } from '../../bridge/control';

// P5 D3/D11: the environment list and the app-global active selection — read-only at this point
// (list and switch); editing, secrets, history and reordering land in later commits on this same
// store. Mirrors http/state/collections.ts's own shape: one reactive object, re-listed after every
// mutation rather than patched locally, since the list is small and this keeps the store
// impossible to get out of step with what Go actually stored.

interface VariablesState {
  environments: HttpEnvironment[];
  loaded: boolean;
}

export const variablesState = reactive<VariablesState>({
  environments: [],
  loaded: false,
});

/** D3: the app-global selection, or null when none is active ("No environment"). */
export const activeEnvironment = computed<HttpEnvironment | null>(
  () => variablesState.environments.find((e) => e.isActive) ?? null,
);

/** '' when no environment is active — the same convention SetActiveEnvironment's own id arg
 *  uses, and what control.httpSend's environmentId will carry at send time. */
export const activeEnvironmentId = computed(() => activeEnvironment.value?.id ?? '');

export async function loadEnvironments(): Promise<void> {
  variablesState.environments = await control.variablesListEnvironments();
  variablesState.loaded = true;
}

export function initVariables(): void {
  if (variablesState.loaded) return;
  void loadEnvironments();
}

/** id: '' selects "No environment" (D3). */
export async function setActiveEnvironment(id: string): Promise<void> {
  await control.variablesSetActiveEnvironment(id);
  await loadEnvironments();
}
