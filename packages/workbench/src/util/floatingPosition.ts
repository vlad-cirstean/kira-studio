// T1-15: this file used to carry its own copy of @kira/kira-ui's floatingPosition.ts, identical
// but for the CSS custom-property prefix (`--kira-float-max-*` here, `--kui-float-max-*` there).
// @kira/kira-ui's own computeFloatPosition takes that prefix as an option (FloatOptions.
// maxVarPrefix) now, so this file only pins it to workbench's own prefix and re-exports the rest.
import {
  autoUpdate,
  type FloatOptions as KuiFloatOptions,
  computeFloatPosition as kuiComputeFloatPosition,
  pointReference,
  type ReferenceElement,
} from '@kira/kira-ui';

export type FloatOptions = KuiFloatOptions;
export type { ReferenceElement };
export { autoUpdate, pointReference };

/** P28 D17(a): the CSS custom properties `computeFloatPosition` writes onto the floating element
 *  — a consumer opts in by reading them (`max-height: var(--kira-float-max-h)`); a surface that
 *  already fits is unaffected, since these are only ever a maximum. */
export const FLOAT_MAX_WIDTH_VAR = '--kira-float-max-w';
export const FLOAT_MAX_HEIGHT_VAR = '--kira-float-max-h';

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
