import type { ProtoCellView, ProtoData, ProtoParams } from './data';
import { EMPTY, type SelectionState } from './selection';
import type { Palette } from './theme';

export const HEADER_ROWS = 1;

/** Mutable render state shared by the draw path, the host and the debug hook. Deliberately not
 *  reactive (a ref here would proxy every read inside the per-cell draw loop). */
export interface ProtoState {
  data: ProtoData;
  params: ProtoParams;
  palette: Palette;
  /** Record index to page row. Null while the record order is the page order. */
  rowOrder: Uint32Array | null;
  /** Display column to page column index (hide and reorder rebuild it). */
  order: number[];
  selection: SelectionState;
  /** Page row under the pointer, or -1. */
  hoverRow: number;
  /** First page row's number minus one, as the gutter shows it. */
  rowNumberBase: number;
  /** Display view of a cell. The edit layer wraps it to fold staged values in. */
  viewAt(pageRow: number, col: number): ProtoCellView;
  /** Records on display: the page, or what sort and hide left of it. */
  rowCount(): number;
}

export function createState(data: ProtoData, params: ProtoParams, palette: Palette): ProtoState {
  const state: ProtoState = {
    data,
    params,
    palette,
    rowOrder: null,
    order: data.columns.map((_, index) => index),
    selection: EMPTY,
    hoverRow: -1,
    rowNumberBase: 0,
    viewAt: (pageRow, col) => data.viewAt(pageRow, col),
    rowCount: () => state.rowOrder?.length ?? data.rowCount,
  };
  return state;
}

export function pageRowOf(state: ProtoState, recordIndex: number): number {
  return state.rowOrder ? (state.rowOrder[recordIndex] as number) : recordIndex;
}
