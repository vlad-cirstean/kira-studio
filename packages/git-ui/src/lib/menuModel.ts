/**
 * `MenuItem`/`MenuSection`, the shape every menu-building function (`rowMenuModel.ts`) produces,
 * plus the roving-focus helpers (`enabledNeighbour`, `firstEnabled`) for
 * `BranchPicker.vue`'s row list. Framework-agnostic so they test on their own.
 */

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  /** An accessible description for a disabled item — wired to `aria-describedby`, not only a
   *  hover-only `title` (kept from `RowContextMenu.vue`'s own precedent). */
  readonly disabledReason: string | undefined;
  /** A codicon class name (e.g. `'codicon-git-branch'`), rendered inside the row's own icon slot
   *  (`MenuSections.vue`). Optional so every pre-existing `MenuItem` producer keeps typechecking
   *  unchanged. */
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
