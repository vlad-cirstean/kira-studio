import { columns, data } from 'cheetah-grid';

// cheetah-grid 2.2.0's `main.d.mts` references `columns_d_exports`, `headers_d_exports` and
// `data_d_exports` without declaring them, so `columns`, `headers` and `data` resolve to `any`.
// These are the minimal shapes this prototype relies on, checked at runtime by the specs.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface CellContext {
  readonly col: number;
  readonly row: number;
  getContext(): CanvasRenderingContext2D;
  getRect(): Rect;
}

export interface DrawCellInfo {
  getRecord(): unknown;
  drawCellBase(arg?: { bgColor?: string }): void;
  drawCellBg(arg?: { bgColor?: string }): void;
  drawCellBorder(): void;
}

export interface CellDrawer {
  clone(): CellDrawer;
  drawInternal(
    value: unknown,
    context: CellContext,
    style: unknown,
    helper: unknown,
    grid: unknown,
    info: DrawCellInfo,
  ): void;
}

export interface RecordSource<T> {
  length: number;
  get(index: number): T;
}

export interface CheetahDataSource {
  length: number;
  dispose(): void;
}

export const ColumnBase: new () => CellDrawer = columns.type.Column;
export const DataSource: new (source: RecordSource<unknown>) => CheetahDataSource = data.DataSource;
