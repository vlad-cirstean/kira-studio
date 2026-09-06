import type { MutationRowOp } from '@shared/domain/mutations';
import type { MutateResponse } from '@shared/protocol/data-ops';
import { reactive } from 'vue';
import { data } from '../../bridge/data';
import { cell, getPage } from './page';

// Renderer-only, in-memory, per tab (D3) — never persisted (not tabs.state_json, not settings,
// not a new SQLite table). Closing a tab or reloading its page silently discards uncommitted
// edits, exactly like closing a spreadsheet you never saved.

export interface PendingEdit {
  row: number; // page-relative row index (matches DataGrid.vue's `r`), never the gutter number
  changes: Record<string, string | null>;
}

export interface PendingInsert {
  id: string; // local identity for Vue :key and discard — never sent to the server
  values: Record<string, string | null>;
}

export interface TabPending {
  edits: Map<number, PendingEdit>;
  deletes: Set<number>;
  inserts: PendingInsert[];
}

const pendingState = reactive({} as Record<string, TabPending>);

function ensure(tabId: string): TabPending {
  if (!pendingState[tabId]) {
    pendingState[tabId] = { edits: new Map(), deletes: new Set(), inserts: [] };
  }
  return pendingState[tabId];
}

export function pendingFor(tabId: string): TabPending | undefined {
  return pendingState[tabId];
}

export function hasPending(tabId: string): boolean {
  const p = pendingState[tabId];
  return !!p && (p.edits.size > 0 || p.deletes.size > 0 || p.inserts.length > 0);
}

export function clearPending(tabId: string): void {
  delete pendingState[tabId];
}

// P21 round 2 functional finding 2: state.ts (which already imports clearPending from here, so
// importing state.ts's own `runtime` back would be a cycle) registers an accessor for a tab's
// *full* primary-key column list (rt.meta.primaryKey, loaded once per tab via treeDescribe) —
// the same registry-inversion shape state/viewCommands.ts already uses to avoid the identical
// project/ <-> views/ cycle. null until state.ts has run (before any tab exists to stage a
// change against) or while a tab's meta hasn't loaded yet — primaryKeyOf falls back to its old,
// zero-columns-only check in that case, exactly as before this fix.
let fullPrimaryKeyOf: ((tabId: string) => string[] | null) | null = null;
export function registerFullPrimaryKeyAccessor(fn: (tabId: string) => string[] | null): void {
  fullPrimaryKeyOf = fn;
}

interface PrimaryKeyResult {
  key: Record<string, string | null>;
  // Non-empty when the current projection has *some* but not all of the object's PK columns —
  // e.g. Hide column applied to one column of a composite key (legitimate, round 1's own bace7a2
  // revert). AssertKeyIsPrimaryKey on the server refuses a key that isn't exactly the primary
  // key with an opaque, table-agnostic error; buildPlan below turns this into round 1's own
  // UnaddressableRowError instead, naming the hidden column(s).
  missingColumns: string[];
}

// Row identity for staging (D5): every column in the current page with `isPrimaryKey === true`.
// `null` means the page has no primary key at all — the caller must not build an update/delete
// op for this row (the server would reject it with E_UNSUPPORTED anyway; this just avoids
// sending an op that can never succeed).
function primaryKeyOf(tabId: string, row: number): PrimaryKeyResult | null {
  const page = getPage(tabId);
  if (!page) return null;
  const key: Record<string, string | null> = {};
  for (let col = 0; col < page.columns.length; col++) {
    const descriptor = page.columns[col];
    if (!descriptor.isPrimaryKey) continue;
    const view = cell(tabId, row, col);
    key[descriptor.name] = view.isNull ? null : view.text;
  }
  if (Object.keys(key).length === 0) return null;
  const fullKey = fullPrimaryKeyOf?.(tabId) ?? null;
  const missingColumns = fullKey?.filter((name) => !(name in key)) ?? [];
  return { key, missingColumns };
}

export function isPendingDelete(tabId: string, row: number): boolean {
  return pendingState[tabId]?.deletes.has(row) ?? false;
}

export function stagedValue(tabId: string, row: number, column: string): string | null | undefined {
  return pendingState[tabId]?.edits.get(row)?.changes[column];
}

// A plain <input> can't distinguish "clear to NULL" from "clear to empty string" — every inline
// edit stages the typed text verbatim, `''` included. An explicit NULL affordance is not built
// in this phase (P6+ nicety); a NULL value's own cell must be retyped, not blanked.
export function stageEdit(tabId: string, row: number, column: string, value: string): void {
  const p = ensure(tabId);
  if (p.deletes.has(row)) return; // a row marked for delete is not independently editable
  const existing = p.edits.get(row);
  p.edits.set(row, { row, changes: { ...(existing?.changes ?? {}), [column]: value } });
}

// The cell editor's Revert action (CellEditorView.vue's resetBuffer, via SelectedCell.onRevert) —
// un-stages just this one column's edit rather than the whole row's (discardPending) or an
// insert's (discardInsertRow). Deleting the row entry outright once its last column reverts, not
// leaving behind an empty `changes: {}`, is what stops the row from still reading as "edited"
// (hasPending/the pending-count badge, and DataGrid's own yellow row highlight) after its only
// edit is undone.
export function discardCellEdit(tabId: string, row: number, column: string): void {
  const p = pendingState[tabId];
  const existing = p?.edits.get(row);
  if (!existing || !(column in existing.changes)) return;
  const { [column]: _discarded, ...rest } = existing.changes;
  if (Object.keys(rest).length === 0) p?.edits.delete(row);
  else p?.edits.set(row, { row, changes: rest });
}

// The row menu's "Revert row(s)" — un-stages a whole row's pending edit and/or pending delete in
// one go, sibling to discardCellEdit (one column) and discardPending (the whole tab). A row that
// was never staged is a silent no-op, so callers can run this over an arbitrary selection without
// first checking which of those rows actually have something to revert.
export function discardRowChange(tabId: string, row: number): void {
  const p = pendingState[tabId];
  if (!p) return;
  p.edits.delete(row);
  p.deletes.delete(row);
}

// D4: the cell menu's "Set NULL" — sibling to stageEdit, skipping the inline <input> (which can
// only ever produce a string) to stage an actual SQL NULL directly.
export function stageNull(tabId: string, row: number, column: string): void {
  const p = ensure(tabId);
  if (p.deletes.has(row)) return;
  const existing = p.edits.get(row);
  p.edits.set(row, { row, changes: { ...(existing?.changes ?? {}), [column]: null } });
}

// D6: "Duplicate row" — one addInsertRow + stageInsertValue per non-primary-key column, copied
// from the row's current *effective* value (staged edit if present, else the page's own cell).
// Primary-key columns are left blank (null, addInsertRow's own default) for the user to fill in
// — duplicating a PK verbatim would only ever produce a guaranteed-collision insert on commit.
// P36 D28: a generated column is skipped the same way — the server computes it, so copying its
// displayed value forward would only ever be rejected on commit (F18).
export function duplicateAsInsert(tabId: string, row: number): string | null {
  const page = getPage(tabId);
  if (!page) return null;
  const columns = page.columns.filter((c) => !c.isPrimaryKey && !c.generated).map((c) => c.name);
  const id = addInsertRow(tabId, columns);
  for (let col = 0; col < page.columns.length; col++) {
    const descriptor = page.columns[col];
    if (descriptor.isPrimaryKey || descriptor.generated) continue;
    const staged = stagedValue(tabId, row, descriptor.name);
    if (staged !== undefined) {
      if (staged !== null) stageInsertValue(tabId, id, descriptor.name, staged);
      continue;
    }
    const view = cell(tabId, row, col);
    // F2/P21 round 1: a truncated cell's `.text` is only the 64 KiB prefix the engine sent, the
    // same reason P24 D27 makes such a cell non-editable ("committing the buffer verbatim would
    // write the truncated text over the real value"). Duplicating it staged that prefix as a real
    // insert value, silently corrupting the copy on Commit. Left unset (null, addInsertRow's own
    // default) instead — the same "not carried over" treatment an unresolved value already gets —
    // rather than ever staging a value known to be wrong.
    if (!view.isNull && !view.truncated) stageInsertValue(tabId, id, descriptor.name, view.text);
  }
  return id;
}

// Toggles delete for each row: already-pending rows are un-marked, others are marked (and any
// pending edit on them is dropped — moot once the row is gone).
export function toggleDelete(tabId: string, rows: number[]): void {
  const p = ensure(tabId);
  for (const row of rows) {
    if (p.deletes.has(row)) p.deletes.delete(row);
    else {
      p.deletes.add(row);
      p.edits.delete(row);
    }
  }
}

export function addInsertRow(tabId: string, columns: string[]): string {
  const p = ensure(tabId);
  const id = crypto.randomUUID();
  const values: Record<string, string | null> = {};
  for (const name of columns) values[name] = null;
  p.inserts.push({ id, values });
  return id;
}

export function stageInsertValue(
  tabId: string,
  insertId: string,
  column: string,
  value: string,
): void {
  const insert = pendingState[tabId]?.inserts.find((i) => i.id === insertId);
  if (insert) insert.values[column] = value;
}

export function discardInsertRow(tabId: string, insertId: string): void {
  const p = pendingState[tabId];
  if (!p) return;
  p.inserts = p.inserts.filter((i) => i.id !== insertId);
}

// F2/P21 round 1: buildPlan used to drop an update/delete outright whenever primaryKeyOf
// returned null (no PK column left in the current projection — e.g. Hide column applied to the
// PK, or a saved/restored tab whose projection happens to exclude it) — silently, with the row
// still staged and no op ever sent. commitPending then saw ops.length === 0, returned null, and
// the caller (which only distinguishes success from a thrown rejection) reported success: no
// error, the pending badge cleared, nothing changed on the server. Thrown instead, so a staged
// change that cannot be addressed fails loudly, the same way any other commit failure already does.
class UnaddressableRowError extends Error {}

// P21 round 2 functional finding 2: a *partial* key (some but not all of the object's PK columns
// missing from the current projection) is exactly as unaddressable as no key at all — a message
// naming the specific hidden column(s), where known, rather than the generic "it may be hidden"
// F2/P21 round 1 already covers for the total-loss case.
function unaddressableMessage(action: 'delete' | 'edit', result: PrimaryKeyResult | null): string {
  const missing = result?.missingColumns ?? [];
  if (missing.length > 0) {
    const plural = missing.length > 1;
    return (
      `A staged ${action} is missing the hidden primary-key column${plural ? 's' : ''} ` +
      `${missing.join(', ')} — show ${plural ? 'them' : 'it'} before ${action === 'delete' ? 'deleting' : 'editing'} this row.`
    );
  }
  return `A staged ${action} has no primary key in the current view (it may be hidden) — reload and try again.`;
}

// D8: delete, then update, then insert — mirrors the adapter's own execution order so the
// *Preview command* panel shows exactly what mutate() will run.
function buildPlan(tabId: string): MutationRowOp[] | null {
  const p = pendingState[tabId];
  if (!p) return null;
  const ops: MutationRowOp[] = [];
  for (const row of p.deletes) {
    const result = primaryKeyOf(tabId, row);
    if (!result || result.missingColumns.length > 0) {
      throw new UnaddressableRowError(unaddressableMessage('delete', result));
    }
    ops.push({ kind: 'delete', key: result.key });
  }
  for (const edit of p.edits.values()) {
    const result = primaryKeyOf(tabId, edit.row);
    if (!result || result.missingColumns.length > 0) {
      throw new UnaddressableRowError(unaddressableMessage('edit', result));
    }
    ops.push({ kind: 'update', key: result.key, changes: edit.changes });
  }
  for (const insert of p.inserts) {
    ops.push({ kind: 'insert', values: insert.values });
  }
  return ops.length > 0 ? ops : null;
}

export async function previewPending(
  connectionId: string,
  path: string,
  tabId: string,
): Promise<string[]> {
  const ops = buildPlan(tabId);
  if (!ops) return [];
  return (await data.preview({ connectionId, path, ops })).statements;
}

export async function commitPending(
  connectionId: string,
  path: string,
  tabId: string,
): Promise<MutateResponse | null> {
  const ops = buildPlan(tabId);
  if (!ops) return null;
  const result = await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId,
    path,
    ops,
  });
  clearPending(tabId);
  return result;
}

export function discardPending(tabId: string): void {
  clearPending(tabId);
}
