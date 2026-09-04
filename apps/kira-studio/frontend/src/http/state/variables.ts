import type { HttpEnvironment, HttpVariable, VariableScope } from '@shared/domain/variables';
import { computed, reactive } from 'vue';
import { control } from '../../bridge/control';
import { confirmDialog } from '../../state/confirmDialog';

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

export async function createEnvironment(name: string): Promise<HttpEnvironment> {
  const env = await control.variablesCreateEnvironment(name);
  await loadEnvironments();
  return env;
}

export async function renameEnvironment(id: string, name: string): Promise<void> {
  await control.variablesRenameEnvironment(id, name);
  await loadEnvironments();
}

/** Deleting the active environment leaves none active (D3) — there is nothing to reassign. */
export async function deleteEnvironment(id: string): Promise<void> {
  await control.variablesDeleteEnvironment(id);
  await loadEnvironments();
}

// ---- the environments dialog (D3/D11) — create/rename/delete/set-active ----

export const environmentsDialogState = reactive({ open: false });

export function openEnvironmentsDialog(): void {
  environmentsDialogState.open = true;
  void loadEnvironments();
}

export function closeEnvironmentsDialog(): void {
  environmentsDialogState.open = false;
}

// ---- the variables dialog (D11/D12) — one scope's variable list ----

interface VariablesDialogState {
  open: boolean;
  scope: VariableScope | null;
  ownerId: string;
  /** "Variables — <collection name>" or "Environment — <environment name>" (D11). */
  title: string;
  rows: HttpVariable[];
  /** A reveal failure's message (D10) — shown in the dialog's own MessageStrip. */
  error: string | null;
}

export const variablesDialogState = reactive<VariablesDialogState>({
  open: false,
  scope: null,
  ownerId: '',
  title: '',
  rows: [],
  error: null,
});

export async function openVariablesDialog(
  scope: VariableScope,
  ownerId: string,
  title: string,
): Promise<void> {
  variablesDialogState.scope = scope;
  variablesDialogState.ownerId = ownerId;
  variablesDialogState.title = title;
  variablesDialogState.open = true;
  variablesDialogState.error = null;
  await reloadVariablesDialog();
}

export function closeVariablesDialog(): void {
  variablesDialogState.open = false;
  // D5: a revealed value lives only in this transient map, never in tab state or a persisted
  // column — dropped on close, the same honest "not scrubbed, just dropped" limit P14 §0.3 states
  // for its own reveal map (JS offers no way to zero a string in memory).
  for (const id of Object.keys(revealedValues)) delete revealedValues[id];
}

async function reloadVariablesDialog(): Promise<void> {
  const { scope, ownerId } = variablesDialogState;
  if (!scope) return;
  variablesDialogState.rows = await control.variablesList(scope, ownerId);
}

/** id: '' creates a new row (D19). Re-lists afterward — the same "one call, always correct"
 *  discipline http/state/collections.ts's own mutations use. */
export async function upsertVariable(args: {
  id: string;
  name: string;
  value: string;
  isSecret: boolean;
}): Promise<void> {
  const { scope, ownerId } = variablesDialogState;
  if (!scope) return;
  await control.variablesUpsert({ scope, ownerId, ...args });
  await reloadVariablesDialog();
}

export async function deleteVariable(id: string): Promise<void> {
  await control.variablesDelete(id);
  await reloadVariablesDialog();
}

/** D12: a duplicate name within one scope is allowed by the schema and resolved first-wins by
 *  sort_order — this is the dialog's own "which rows are the later, shadowed duplicates" check,
 *  over the already-sort_order-ordered list List returns. */
export function isDuplicateName(rows: HttpVariable[], index: number): boolean {
  const name = rows[index]?.name.trim();
  if (!name) return false;
  return rows.slice(0, index).some((r) => r.name.trim() === name);
}

// ---- the gated reveal (D5/D8/D9) ----

/** A revealed variable's plaintext, keyed by variable id — transient, cleared on dialog close
 *  (never written to tab state, never to a collection row). Not reactive-persisted anywhere else:
 *  this is the one place a secret's plaintext exists in the renderer at all. */
export const revealedValues = reactive<Record<string, string>>({});

/** D8: the same recurse-once shape ConnectionDialog.vue's own requestReveal uses — the pattern is
 *  copied, not imported (there is nothing importable to reuse, §1.4/OQ-2). Every outcome but
 *  confirmation-required is terminal. */
export async function revealVariable(id: string, confirmed: boolean): Promise<void> {
  const result = await control.variablesReveal(id, confirmed);
  switch (result.outcome) {
    case 'revealed':
      if (result.value !== null) revealedValues[id] = result.value;
      return;
    case 'cancelled':
      // D11 (inherited via P14): cancelled on purpose — nothing to show for it.
      return;
    case 'confirmation-required': {
      const ok = await confirmDialog(
        'Show this variable’s value? It will be displayed in plain text.',
        { danger: false },
      );
      if (ok) await revealVariable(id, true);
      return;
    }
    default:
      variablesDialogState.error = result.error ?? 'Could not reveal the value.';
  }
}
