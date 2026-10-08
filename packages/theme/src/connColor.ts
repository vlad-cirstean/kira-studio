// 'none' is a real, storable ConnectionColor (D18's default) — not merely a falsy value — so
// every call site that decides whether to paint a rail/dot must exclude it explicitly rather
// than just checking truthiness. Centralized here once instead of repeating `c && c !== 'none'`
// at every one of the dozen sites that resolve a connection's colour to a CSS value. Typed as
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
