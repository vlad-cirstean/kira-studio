// T1-15: this file used to carry its own copy of @kira/kira-ui's floatingPosition.ts, identical
// but for the CSS custom-property prefix (`--kira-float-max-*` here, a kui-prefixed one there).
// @kira/kira-ui's own computeFloatPosition now REQUIRES that prefix (P131 Part 3 §6.2: its sole
// other consumer is gone, so it no longer defaults to a kui-prefixed name), so this file's own
// FloatOptions omits it — every call below always supplies workbench's own prefix — and
// re-exports the rest.
import {
  autoUpdate,
  type FloatOptions as KuiFloatOptions,
  computeFloatPosition as kuiComputeFloatPosition,
  pointReference,
  type ReferenceElement,
} from '@kira/kira-ui';

export type FloatOptions = Omit<KuiFloatOptions, 'maxVarPrefix'>;
export type { ReferenceElement };
export { autoUpdate, pointReference };

// P23: this file replaces the previous anchoredPosition.ts (P49 D12's own consolidation of three
// hand-rolled flip/clamp implementations into one pure-arithmetic function, two named
// "strategies") and ContextMenu.vue's still-separate hand-rolled clamp (menu) plus its entirely
// unhandled submenu placement (`left: 100%; top: -4px`, no flip, no clamp — a live offscreen bug
// near the right/bottom edge). `@kira/kira-ui`'s own offset→flip→shift→size middleware chain
// (docs/v1.1/plans/P23-library-adoption.md) replaces all of them; `strategy: 'fixed'` matches
// every consumer's own CSS (`position: fixed`) and works cleanly with `Teleport to="body"`, which
// none of these five renders anywhere else.
export async function computeFloatPosition(
  reference: ReferenceElement,
  floatingEl: HTMLElement,
  opts: FloatOptions = {},
): Promise<{ left: number; top: number }> {
  return kuiComputeFloatPosition(reference, floatingEl, {
    ...opts,
    maxVarPrefix: '--kira-float-max-',
  });
}
