// 'none' is a real, storable ConnectionColor (D18's default) — not merely a falsy value — so
// every call site that decides whether to paint a rail/dot must exclude it explicitly rather
// than just checking truthiness. Centralized here once instead of repeating `c && c !== 'none'`
// at every one of the dozen sites that resolve a connection's colour to a CSS value. Typed as
// `string` rather than `ConnectionColor` since a couple of call sites (ContextMenu.vue's generic
// MenuItem.swatch, TabStrip's loosely-typed colorFor()) only carry the plain string.
export function connColorVar(color: string | null | undefined): string | undefined {
  return color && color !== 'none' ? `var(--kira-conn-${color})` : undefined;
}
