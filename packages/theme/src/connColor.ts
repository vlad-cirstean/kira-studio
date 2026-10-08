// 'none' is a real, storable ConnectionColor (D18's default) — not merely a falsy value — so
// every call site that decides whether to paint a mark must exclude it explicitly rather
// than just checking truthiness. Marks go through `colorMarkClass`; this stays for the few
// sites that need the raw CSS value. Typed as
// `string` rather than `ConnectionColor` since a couple of call sites (ContextMenu.vue's generic
// MenuItem.swatch, TabStrip's loosely-typed colorFor()) only carry the plain string.
//
// P42 D36: a colour can be storable without being offered — CONNECTION_COLOR_CHOICES
// (shared/domain/connection.ts) is the picker's own trimmed subset, and this function knows
// nothing about it: it resolves whatever name it is given, offered or retired alike.
export function connColorVar(color: string | null | undefined): string | undefined {
  return color && color !== 'none' ? `var(--kira-conn-${color})` : undefined;
}

// Tailwind emits only scanned literals, so each class is spelled in full.
const CONN_BG: Record<string, string> = {
  red: 'bg-conn-red',
  orange: 'bg-conn-orange',
  amber: 'bg-conn-amber',
  olive: 'bg-conn-olive',
  green: 'bg-conn-green',
  teal: 'bg-conn-teal',
  cyan: 'bg-conn-cyan',
  blue: 'bg-conn-blue',
  indigo: 'bg-conn-indigo',
  violet: 'bg-conn-violet',
  magenta: 'bg-conn-magenta',
  grey: 'bg-conn-grey',
};

const CONN_TEXT: Record<string, string> = {
  red: 'text-conn-red',
  orange: 'text-conn-orange',
  amber: 'text-conn-amber',
  olive: 'text-conn-olive',
  green: 'text-conn-green',
  teal: 'text-conn-teal',
  cyan: 'text-conn-cyan',
  blue: 'text-conn-blue',
  indigo: 'text-conn-indigo',
  violet: 'text-conn-violet',
  magenta: 'text-conn-magenta',
  grey: 'text-conn-grey',
};

export function connBgClass(color: string | null | undefined): string | undefined {
  return color ? CONN_BG[color] : undefined;
}

export function connTextClass(color: string | null | undefined): string | undefined {
  return color ? CONN_TEXT[color] : undefined;
}

export type ColorMark = 'rail' | 'bar' | 'dot' | 'band';

// Tailwind emits only scanned literals, so each shape is spelled in full.
const MARK_SHAPE: Record<ColorMark, string> = {
  rail: 'absolute inset-y-0 left-0 w-0.5',
  bar: 'w-0.5 h-3.5 rounded-xs shrink-0',
  dot: 'size-1.25 rounded-full shrink-0',
  band: 'h-0.5 shrink-0',
};

/** Every palette colour mark in both apps. No colour: an empty slot, or an empty ring for a dot. */
export function colorMarkClass(mark: ColorMark, color: string | null | undefined): string {
  const paint = connBgClass(color);
  if (paint) return `${MARK_SHAPE[mark]} ${paint}`;
  return mark === 'dot' ? `${MARK_SHAPE.dot} bg-none border border-disabled` : MARK_SHAPE[mark];
}
