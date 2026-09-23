// P104 §6.4: the app's own document-level tooltip controller (directive, singleton floating
// element, hit-testing) is gone — every call site now uses the real Tooltip/TooltipTrigger/
// TooltipContent trio, with TooltipProvider (App.vue) owning delay/rearm. What survives is the
// shared shape a call site's script can still build a structured tip from, and the one place
// SlickGrid's own non-Vue header cells (AttributeTooltip.vue, `packages/workbench/src/
// components/`) still read a plain-text join off `data-kira-tip`.

/** P42 D19: the structured half of a tooltip — carried in a second attribute (`data-kira-tip-
 *  parts`, AttributeTooltip.vue's own `PARTS_ATTR`) so `data-kira-tip` itself stays the exact
 *  newline-joined plain text it always was (the a11y mirror, and every existing Playwright
 *  assertion). A plain string tooltip never sets this at all. */
export interface TooltipContent {
  title: string;
  meta?: string;
  /** The data-type badge's own colour (columnTypeColor, theme/icons.ts) — the only caller of
   *  `meta` today is a column-type hint, and the badge is what carries the colour visibly rather
   *  than the plain a11y text these get joined into (toPlainText below), so this never affects it. */
  metaColor?: string;
  body?: string;
}

export function toPlainText(value: TooltipContent): string {
  return [value.title, value.meta, value.body].filter((v): v is string => !!v).join('\n');
}
