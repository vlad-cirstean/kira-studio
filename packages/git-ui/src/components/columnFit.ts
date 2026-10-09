import type { ColumnWidths } from '../state/viewState.ts';

export const MAX_COLUMN_WIDTH = 600;

export interface ColumnFitInput {
  /** User preference, persisted; fitting never rewrites it. */
  readonly stored: ColumnWidths;
  readonly available: number;
  /** Narrowest the graph column may render: the lane floor, at least the drag minimum. */
  readonly graphFloor: number;
  /** Graph column tracks its floor instead of the stored width. */
  readonly graphAuto: boolean;
  readonly minAuthor: number;
  readonly minDate: number;
  readonly minMessage: number;
  /** Detail pane open: author and date are not rendered. */
  readonly compact: boolean;
}

export interface ColumnFit {
  readonly graph: number;
  readonly author: number;
  readonly date: number;
  readonly message: number;
}

function effectiveGraphWidth(stored: number, floor: number, auto: boolean): number {
  return auto ? floor : Math.max(floor, stored);
}

/** Effective widths: graph never shrinks; author, then date, give way so the message column keeps
 *  `minMessage`. Only a viewport narrower than graph + both minimums still overflows. */
export function fitColumns(input: ColumnFitInput): ColumnFit {
  const { stored, available, minAuthor, minDate, minMessage } = input;
  const graph = effectiveGraphWidth(stored.graph, input.graphFloor, input.graphAuto);
  if (input.compact) {
    return {
      graph,
      author: stored.author,
      date: stored.date,
      message: Math.max(0, available - graph),
    };
  }
  let excess = graph + stored.author + stored.date + minMessage - available;
  const fromAuthor = Math.max(0, Math.min(excess, stored.author - minAuthor));
  excess -= fromAuthor;
  const fromDate = Math.max(0, Math.min(excess, stored.date - minDate));
  const author = stored.author - fromAuthor;
  const date = stored.date - fromDate;
  return { graph, author, date, message: Math.max(0, available - graph - author - date) };
}

/** Widest `column` may be dragged: the message column keeps `minMessage`. */
export function maxDragWidth(
  column: keyof ColumnWidths,
  fit: ColumnFit,
  input: ColumnFitInput,
): number {
  const others =
    (column === 'graph' ? 0 : fit.graph) +
    (input.compact
      ? 0
      : (column === 'author' ? 0 : fit.author) + (column === 'date' ? 0 : fit.date));
  const floor =
    column === 'graph' ? input.graphFloor : column === 'author' ? input.minAuthor : input.minDate;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(floor, input.available - input.minMessage - others));
}
