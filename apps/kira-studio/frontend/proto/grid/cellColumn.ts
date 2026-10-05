import { categoryForTypeClass } from '../../src/theme/icons';
import { alignmentFor } from '../../src/views/shared/page/columns';
import { type CellContext, ColumnBase, type DrawCellInfo } from './cheetahTypes';
import type { ProtoCellView } from './data';
import type { ProtoState } from './state';
import type { Palette } from './theme';

// Draw geometry, in CSS px. NAV_RESERVE is the left strip a FK/PK glyph owns (C11 T9 asserts the
// button sits within 24 px of the cell's left edge).
const PAD_X = 8;
const NAV_RESERVE = 24;
const ELLIPSIS = '…';

export type NavKind = 'fk' | 'pk';

type CategoryColor = 'number' | 'keyword' | 'control' | null;

const CATEGORY_COLOR: Partial<Record<ReturnType<typeof categoryForTypeClass>, CategoryColor>> = {
  numeric: 'number',
  boolean: 'keyword',
  datetime: 'control',
  string: null,
  other: null,
};

function categoryColor(p: Palette, kind: CategoryColor): string {
  if (kind === 'number') return p.number;
  if (kind === 'keyword') return p.keyword;
  if (kind === 'control') return p.control;
  return p.fg;
}

/** Body cell: plain text, NULL, empty, truncated and masked markers, type colour, right-align,
 *  FK/PK glyph. Backgrounds (selection, search, hover) come from the theme's `cellBg`. */
export class CellColumn extends ColumnBase {
  private readonly colorKind: CategoryColor;
  private readonly right: boolean;

  constructor(
    private readonly state: ProtoState,
    readonly colIndex: number,
    readonly nav: NavKind | null,
  ) {
    super();
    const descriptor = state.data.columns[colIndex];
    if (!descriptor) throw new Error(`no column ${colIndex}`);
    this.colorKind = CATEGORY_COLOR[categoryForTypeClass(descriptor.typeClass)] ?? null;
    this.right = alignmentFor(descriptor) === 'right';
  }

  clone(): CellColumn {
    return new CellColumn(this.state, this.colIndex, this.nav);
  }

  drawInternal(
    value: unknown,
    context: CellContext,
    _style: unknown,
    _helper: unknown,
    _grid: unknown,
    info: DrawCellInfo,
  ): void {
    const state = this.state;
    const p = state.palette;
    const view = value as ProtoCellView;
    info.drawCellBase();

    let text = view.text;
    let font = p.font;
    let color = categoryColor(p, this.colorKind);
    if (view.isNull) {
      text = 'NULL';
      font = p.fontItalic;
      color = p.fgSubtle;
    } else if (view.masked) {
      color = p.fgMuted;
    }

    const rect = context.getRect();
    const ctx = context.getContext();
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
    ctx.font = font;
    ctx.textBaseline = 'middle';
    const midY = rect.top + rect.height / 2;
    const navPad = this.nav && !view.isNull ? NAV_RESERVE : 0;
    ctx.fillStyle = color;
    if (this.right) {
      ctx.textAlign = 'right';
      ctx.fillText(text, rect.right - PAD_X, midY);
    } else {
      ctx.textAlign = 'left';
      const x = rect.left + PAD_X + navPad;
      ctx.fillText(text, x, midY);
      if (view.truncated) {
        ctx.fillStyle = p.fgMuted;
        ctx.fillText(ELLIPSIS, x + ctx.measureText(text).width + 4, midY);
      }
    }
    if (navPad > 0) drawNavGlyph(ctx, rect.left + 6, midY, this.nav as NavKind, p.fgMuted);
    ctx.restore();
  }
}

function drawNavGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: NavKind,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  if (kind === 'fk') {
    ctx.moveTo(x, y);
    ctx.lineTo(x + 9, y);
    ctx.moveTo(x + 6, y - 3);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x + 6, y + 3);
  } else {
    ctx.moveTo(x + 9, y);
    ctx.lineTo(x, y);
    ctx.moveTo(x + 3, y - 3);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 3, y + 3);
  }
  ctx.stroke();
}

/** Row-number gutter cell. */
export class GutterColumn extends ColumnBase {
  constructor(private readonly state: ProtoState) {
    super();
  }

  clone(): GutterColumn {
    return new GutterColumn(this.state);
  }

  drawInternal(
    value: unknown,
    context: CellContext,
    _style: unknown,
    _helper: unknown,
    _grid: unknown,
    info: DrawCellInfo,
  ): void {
    const p = this.state.palette;
    info.drawCellBg({ bgColor: p.bgChrome });
    info.drawCellBorder();
    const rect = context.getRect();
    const ctx = context.getContext();
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
    ctx.font = p.font;
    ctx.fillStyle = p.fgSubtle;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), rect.right - PAD_X, rect.top + rect.height / 2);
    ctx.restore();
  }
}
