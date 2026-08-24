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

export const pendingState = reactive({} as Record<string, TabPending>);

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

// Row identity for staging (D5): every column in the current page with `isPrimaryKey === true`.
// `null` means the page has no primary key at all — the caller must not build an update/delete
// op for this row (the server would reject it with E_UNSUPPORTED anyway; this just avoids
// sending an op that can never succeed).
function primaryKeyOf(tabId: string, row: number): Record<string, string | null> | null {
  const page = getPage(tabId);
  if (!page) return null;
  const key: Record<string, string | null> = {};
  for (let col = 0; col < page.columns.length; col++) {
    const descriptor = page.columns[col];
    if (!descriptor.isPrimaryKey) continue;
    const view = cell(tabId, row, col);
    key[descriptor.name] = view.isNull ? null : view.text;
  }
  return Object.keys(key).length > 0 ? key : null;
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
export function duplicateAsInsert(tabId: string, row: number): string | null {
  const page = getPage(tabId);
  if (!page) return null;
  const columns = page.columns.filter((c) => !c.isPrimaryKey).map((c) => c.name);
  const id = addInsertRow(tabId, columns);
  for (let col = 0; col < page.columns.length; col++) {
    const descriptor = page.columns[col];
    if (descriptor.isPrimaryKey) continue;
    const staged = stagedValue(tabId, row, descriptor.name);
    if (staged !== undefined) {
      if (staged !== null) stageInsertValue(tabId, id, descriptor.name, staged);
      continue;
    }
    const view = cell(tabId, row, col);
    if (!view.isNull) stageInsertValue(tabId, id, descriptor.name, view.text);
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

// D8: delete, then update, then insert — mirrors the adapter's own execution order so the
// *Preview command* panel shows exactly what mutate() will run.
export function buildPlan(tabId: string): MutationRowOp[] | null {
  const p = pendingState[tabId];
  if (!p) return null;
  const ops: MutationRowOp[] = [];
  for (const row of p.deletes) {
    const key = primaryKeyOf(tabId, row);
    if (key) ops.push({ kind: 'delete', key });
  }
  for (const edit of p.edits.values()) {
    const key = primaryKeyOf(tabId, edit.row);
    if (key) ops.push({ kind: 'update', key, changes: edit.changes });
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
