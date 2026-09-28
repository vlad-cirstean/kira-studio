/**
 * G19 D3b: promoted verbatim (moved, not rewritten) from `packages/git-ui/src/components/
 * RowContextMenu.vue`'s own `<script setup>` — the ARIA-menu keyboard-roving-focus logic was
 * already correct there (F3), so this module is the same neighbour-skipping algorithm, made
 * framework-agnostic and testable on its own, plus the `MenuItem`/`MenuSection` shape every
 * `packages/git-ui` menu-building function (`rowMenuModel.ts`) already produced — now generalised
 * with two new optional fields (`icon`, `danger`) so a `MenuItem` built before this phase existed
 * (any G17-authored menu, in particular) still satisfies this type unchanged and renders exactly
 * as it always has, just without an icon-box.
 */

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  /** An accessible description for a disabled item — wired to `aria-describedby`, not only a
   *  hover-only `title` (kept from `RowContextMenu.vue`'s own precedent). */
  readonly disabledReason: string | undefined;
  /** A codicon class name (e.g. `'codicon-git-branch'`), rendered inside a `KuiIconBox`. Optional
   *  so every pre-existing `MenuItem` producer keeps typechecking unchanged. */
  readonly icon?: string;
  /** Renders the item in the danger (destructive) visual treatment — matching the toolbar's own
   *  existing `.kv-push-menu-item` danger-colour precedent. Optional, defaults to `false`. */
  readonly danger?: boolean;
  /** G34 D8: a secondary line under the label — muted, one type step down. `PullStrategyPicker`'s
   *  own "Merge — from pull.rebase in your repository config" is the only producer today; it is a
   *  second LINE rather than Kira's right-aligned `.shortcut` slot because the string is a
   *  sentence, not a key chord, and right-aligning it in a 260px panel would truncate it away. */
  readonly detail?: string;
}

export interface MenuSection {
  readonly items: readonly MenuItem[];
}

/** Every enabled item across every section, in DOM order — the flat list keyboard navigation
 *  actually steps through (a separator between sections is not a stop). */
export function flattenItems(sections: readonly MenuSection[]): MenuItem[] {
  return sections.flatMap((section) => section.items);
}

/**
 * The neighbour-skipping step at the heart of `ArrowUp`/`ArrowDown`/`Home`/`End`: from `fromId`
 * (or "no selection yet" when `undefined`), walk `direction` steps at a time, wrapping around the
 * flat item list, until an enabled item is found. Returns `undefined` only when no item in the
 * whole menu is enabled.
 */
export function enabledNeighbour(
  items: readonly MenuItem[],
  fromId: string | undefined,
  direction: 1 | -1,
): string | undefined {
  if (items.length === 0) return undefined;
  const startIndex = fromId === undefined ? -1 : items.findIndex((item) => item.id === fromId);
  for (let step = 1; step <= items.length; step++) {
    const index = (((startIndex + direction * step) % items.length) + items.length) % items.length;
    const candidate = items[index];
    if (candidate && !candidate.disabled) return candidate.id;
  }
  return undefined;
}

/** The first enabled item overall — what a freshly-opened menu focuses. */
export function firstEnabled(items: readonly MenuItem[]): string | undefined {
  return items.find((item) => !item.disabled)?.id;
}
