import type { ProtoCellView, ProtoData, ProtoParams } from './data';
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
  /** Page row under the pointer, or -1. */
  hoverRow: number;
  /** First page row's number minus one, as the gutter shows it. */
  rowNumberBase: number;
  /** Display view of a cell. The edit layer wraps it to fold staged values in. */
  viewAt(pageRow: number, col: number): ProtoCellView;
}

export function createState(data: ProtoData, params: ProtoParams, palette: Palette): ProtoState {
  return {
    data,
    params,
    palette,
    rowOrder: null,
    hoverRow: -1,
    rowNumberBase: 0,
    viewAt: (pageRow, col) => data.viewAt(pageRow, col),
  };
}

export function pageRowOf(state: ProtoState, recordIndex: number): number {
  return state.rowOrder ? (state.rowOrder[recordIndex] as number) : recordIndex;
}
