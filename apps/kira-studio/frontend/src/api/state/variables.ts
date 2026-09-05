import type {
  ApiEnvironment,
  ApiVariable,
  ApiVariableHistoryEntry,
  VariableScope,
} from '@shared/domain/variables';
import { computed, reactive } from 'vue';
import { control } from '../../bridge/control';
import { runReveal } from '../reveal';

// P5 D3/D11: the environment list and the app-global active selection — read-only at this point
// (list and switch); editing, secrets, history and reordering land in later commits on this same
// store. Mirrors http/state/collections.ts's own shape: one reactive object, re-listed after every
// mutation rather than patched locally, since the list is small and this keeps the store
// impossible to get out of step with what Go actually stored.

interface VariablesState {
  environments: ApiEnvironment[];
  loaded: boolean;
}

export const variablesState = reactive<VariablesState>({
  environments: [],
  loaded: false,
});

/** D3: the app-global selection, or null when none is active ("No environment"). */
const activeEnvironment = computed<ApiEnvironment | null>(
  () => variablesState.environments.find((e) => e.isActive) ?? null,
);

/** '' when no environment is active — the same convention SetActiveEnvironment's own id arg
 *  uses, and what control.httpSend's environmentId will carry at send time. */
export const activeEnvironmentId = computed(() => activeEnvironment.value?.id ?? '');

async function loadEnvironments(): Promise<void> {
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

export async function createEnvironment(name: string, description = ''): Promise<ApiEnvironment> {
  const env = await control.variablesCreateEnvironment(name, description);
  await loadEnvironments();
  return env;
}

/** P17 D14: replaces renameEnvironment — renaming and describing are one row update. */
export async function updateEnvironment(
  id: string,
  name: string,
  description: string,
): Promise<void> {
  await control.variablesUpdateEnvironment(id, name, description);
  await loadEnvironments();
}

/** Deleting the active environment leaves none active (D3) — there is nothing to reassign. */
export async function deleteEnvironment(id: string): Promise<void> {
  await control.variablesDeleteEnvironment(id);
  await loadEnvironments();
}

/** P17 D17/item 4: a raw-ciphertext duplicate — no history copied, never active. */
export async function duplicateEnvironment(id: string): Promise<ApiEnvironment> {
  const env = await control.variablesDuplicateEnvironment(id);
  await loadEnvironments();
  return env;
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
  rows: ApiVariable[];
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
  clearRevealed();
}

async function reloadVariablesDialog(): Promise<void> {
  const { scope, ownerId } = variablesDialogState;
  if (!scope) return;
  variablesDialogState.rows = await control.variablesList(scope, ownerId);
  listCache[cacheKey(scope, ownerId)] = variablesDialogState.rows;
}

// ---- the send-time value cache (D6/D7) ----
//
// send() needs each scope's non-secret values (and which names are secret, to defer them) without
// a fresh round trip on every keystroke of a live "unresolved reference" preview — this is that
// cache, kept in step with VariablesDialog's own edits above (the one place these rows change).

function cacheKey(scope: VariableScope, ownerId: string): string {
  return `${scope}:${ownerId}`;
}

const listCache = reactive<Record<string, ApiVariable[]>>({});

/** Populates the cache for one scope if it is not already loaded — safe to call on every render;
 *  a no-op for '' (a scratch tab's collection, or no active environment). */
export async function ensureVariablesLoaded(scope: VariableScope, ownerId: string): Promise<void> {
  if (!ownerId || listCache[cacheKey(scope, ownerId)]) return;
  listCache[cacheKey(scope, ownerId)] = await control.variablesList(scope, ownerId);
}

export function cachedVariables(scope: VariableScope, ownerId: string): ApiVariable[] {
  if (!ownerId) return [];
  return listCache[cacheKey(scope, ownerId)] ?? [];
}

/** id: '' creates a new row (D19). Re-lists afterward — the same "one call, always correct"
 *  discipline http/state/collections.ts's own mutations use. */
export async function upsertVariable(args: {
  id: string;
  name: string;
  value: string;
  isSecret: boolean;
  description?: string;
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

/** D14: the full new order, in full — ConnectionsService.Reorder's own shape. */
export async function reorderVariables(ids: string[]): Promise<void> {
  const { scope, ownerId } = variablesDialogState;
  if (!scope) return;
  await control.variablesReorder(scope, ownerId, ids);
  await reloadVariablesDialog();
}

export async function reorderEnvironmentsList(ids: string[]): Promise<void> {
  await control.variablesReorderEnvironments(ids);
  await loadEnvironments();
}

/** D12: a duplicate name within one scope is allowed by the schema and resolved first-wins by
 *  sort_order — this is the dialog's own "which rows are the later, shadowed duplicates" check,
 *  over the already-sort_order-ordered list List returns. */
export function isDuplicateName(rows: ApiVariable[], index: number): boolean {
  const name = rows[index]?.name.trim();
  if (!name) return false;
  return rows.slice(0, index).some((r) => r.name.trim() === name);
}

// ---- the merged value/secret cache, shared by both protocols (P12 D9/F10) ----
//
// mergedValuesAndSecrets used to be hand-copied into views/grpcrequest/state.ts, which said so in
// so many words ("the coupling P12 would have to unpick") — both views already import this module
// for cachedVariables, so the fix is a move, not an abstraction.

/** D12: a duplicate name within one scope resolves first-wins by sort_order — cachedVariables
 *  already returns each scope's rows in that order, so the first row claiming a name is the one
 *  that wins; a later same-named row is skipped rather than overwriting it. */
function firstWinsByName(rows: ApiVariable[]): Map<string, { value: string; isSecret: boolean }> {
  const out = new Map<string, { value: string; isSecret: boolean }>();
  for (const v of rows) {
    if (!out.has(v.name)) out.set(v.name, { value: v.value, isSecret: v.isSecret });
  }
  return out;
}

/** D2's precedence (environment over collection), read from the cache this module keeps in step
 *  with its own dialog edits — a fresh IPC round trip on every keystroke of a live
 *  "unresolved reference" preview would be needless. Correction (round-2 review): neither send()
 *  nor call() calls ensureVariablesLoaded themselves — HttpRequestView.vue/GrpcRequestView.vue
 *  each fire it, unawaited, on mount and on collection/environment change, well before this ever
 *  runs for the same tab in the ordinary case. This function does not itself guarantee the cache
 *  is loaded; a scope this call site has genuinely never seen simply reads as empty here (§0's own
 *  "an honest unresolved reference is fine" posture), same as before any load ever ran. */
export function mergedValuesAndSecrets(
  collectionId: string,
  environmentId: string,
): { values: Record<string, string>; secretNames: string[] } {
  const merged = firstWinsByName(cachedVariables('collection', collectionId));
  for (const [name, entry] of firstWinsByName(cachedVariables('environment', environmentId))) {
    merged.set(name, entry); // environment wins over collection (D2), regardless of within-scope order
  }
  const values: Record<string, string> = {};
  const secretNames: string[] = [];
  for (const [name, entry] of merged) {
    if (entry.isSecret) secretNames.push(name);
    else values[name] = entry.value;
  }
  return { values, secretNames };
}

// ---- the gated reveal (D5/D8/D9) ----

/** A revealed variable's plaintext, keyed by variable id — transient, cleared on dialog close
 *  (never written to tab state, never to a collection row). Not reactive-persisted anywhere else:
 *  this is the one place a secret's plaintext exists in the renderer at all. Shared with
 *  state/curl.ts's own reveal loop (revealSecretValues calls the same revealVariable below), so
 *  clearRevealed is exported rather than kept private — every dialog that can populate this map
 *  must also be able to clear it (finding 5: a stale entry left behind by one dialog must never
 *  let a *different*, later-opened dialog trust it in place of its own re-auth gate). */
export const revealedValues = reactive<Record<string, string>>({});

/** Drops every revealed secret's plaintext from memory — called by every dialog/popover close
 *  path that can populate revealedValues (closeVariablesDialog here, closeCopyAsCurlDialog in
 *  curl.ts), the same honest "not scrubbed, just dropped" limit P14 §0.3 states for its own reveal
 *  map (JS offers no way to zero a string in memory). */
export function clearRevealed(): void {
  for (const id of Object.keys(revealedValues)) delete revealedValues[id];
}

/** P12 D13: runs over http/reveal.ts's shared recurse-once switch — the pattern used to be
 *  hand-copied from ConnectionDialog.vue's own requestReveal (there was nothing importable to
 *  reuse, §1.4/OQ-2); now it is the module's own shared loop, used here and by
 *  revealHistoryEntry below.
 *
 *  P7 D10: `onError`, when supplied, receives an error/unavailable outcome's message instead of it
 *  going into `variablesDialogState.error` — the *Copy as curl* reveal loop (http/state/curl.ts)
 *  is not the variables dialog and has its own error sink to write into. Every existing caller
 *  omits it and keeps today's behaviour exactly. */
export async function revealVariable(
  id: string,
  onError?: (message: string) => void,
): Promise<string | undefined> {
  return runReveal(
    (confirmed) => control.variablesReveal(id, confirmed),
    (value) => {
      revealedValues[id] = value;
    },
    (message) => {
      if (onError) onError(message);
      else variablesDialogState.error = message;
    },
    'Show this variable’s value? It will be displayed in plain text.',
  );
}

// ---- the per-variable history popover (D13) ----

interface HistoryMenuState {
  open: boolean;
  variableId: string | null;
  entries: ApiVariableHistoryEntry[];
}

export const historyMenuState = reactive<HistoryMenuState>({
  open: false,
  variableId: null,
  entries: [],
});

/** A revealed history entry's plaintext, keyed by history entry id — the same transient-map
 *  discipline revealedValues follows, cleared when the popover closes. */
export const revealedHistoryValues = reactive<Record<string, string>>({});

function clearRevealedHistory(): void {
  for (const id of Object.keys(revealedHistoryValues)) delete revealedHistoryValues[id];
}

/** Finding 5: VariableRow.vue's popover is `v-if`-gated on `historyMenuState.variableId ===
 *  row.id`, so switching from one row's history button to another's unmounts the first popover
 *  without ever firing its own `@close` — closeHistoryMenu below would never run for it. Clearing
 *  here too, before the new popover's own state lands, closes that gap regardless of whether the
 *  previous popover ever closes "cleanly". */
export async function openHistoryMenu(variableId: string): Promise<void> {
  clearRevealedHistory();
  historyMenuState.variableId = variableId;
  historyMenuState.open = true;
  historyMenuState.entries = await control.variablesHistory(variableId);
}

export function closeHistoryMenu(): void {
  historyMenuState.open = false;
  historyMenuState.variableId = null;
  historyMenuState.entries = [];
  clearRevealedHistory();
}

/** P12 D13: runReveal's own second instantiation, over api_variable_history instead of
 *  api_variables. */
export async function revealHistoryEntry(historyId: string): Promise<string | undefined> {
  return runReveal(
    (confirmed) => control.variablesRevealHistory(historyId, confirmed),
    (value) => {
      revealedHistoryValues[historyId] = value;
    },
    (message) => {
      variablesDialogState.error = message;
    },
    'Show this prior value? It will be displayed in plain text.',
  );
}

/** D13: restoring writes the prior value through the ordinary Upsert path, so the restore is
 *  itself recorded in history and is therefore undoable. A secret entry is revealed first if it
 *  has not been already — restoring is no less a reveal than the eye button is. */
export async function restoreHistoryEntry(entry: ApiVariableHistoryEntry): Promise<void> {
  const row = variablesDialogState.rows.find((r) => r.id === entry.variableId);
  if (!row) return;
  let value = entry.value;
  if (entry.isSecret) {
    if (revealedHistoryValues[entry.id] === undefined) {
      await revealHistoryEntry(entry.id);
    }
    const revealed = revealedHistoryValues[entry.id];
    if (revealed === undefined) return; // cancelled, unavailable, or errored
    value = revealed;
  }
  await upsertVariable({
    id: row.id,
    name: row.name,
    value,
    isSecret: entry.isSecret,
    description: row.description,
  });
  await openHistoryMenu(entry.variableId);
}
