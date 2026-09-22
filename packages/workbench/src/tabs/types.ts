import type { TabScope } from '@shared/domain/tabs';
import type { Component } from 'vue';

// P103 Part 2 (§5.1): the generic contract both apps' own `state/tabKinds.ts` instantiate once,
// each with its own kind union `K`, record union `R`, and the three type parameters that
// genuinely differ between them — Kira Studio's `TabIcon` is `string`, Kira Space's is
// `string | { readonly filePath: string }`; Kira Studio's rail colour is `ConnectionColor`, Kira
// Space's is `PaletteColor`; both use the same `MenuItem` shape today but it stays a parameter
// rather than a hard import, so this package never depends on either app's context-menu module
// beyond the generic shape it needs.
export interface TabKindDef<
  K extends string,
  R extends { kind: string; state: unknown },
  Icon,
  Color,
  Menu,
> {
  mode: TabScope;
  title(tab: R): string;
  icon(tab: R): Icon;
  railColor(tab: R): Color | undefined;
  /** A brand-new tab of this kind, opened with nothing to inherit. */
  defaultState(): Extract<R, { kind: K }>['state'];
  /** A restored record's raw `state`, normalized through this kind's own schema — the one place
   *  every per-kind `*TabStateSchema`'s `.default()` actually fires. `null` means "not
   *  parseable", and the caller (hydrateTabs) keeps what was stored, merge-only, never resetting
   *  to defaultState(). */
  parseState(raw: unknown): Extract<R, { kind: K }>['state'] | null;
  /** "Same target, fresh default state" for most kinds — some keep one field from the source. */
  duplicateState(tab: Extract<R, { kind: K }>): Extract<R, { kind: K }>['state'];
  /** Frees whichever page store this kind populated (a no-op miss for a kind with none). */
  dropResources(tabId: string): void;
  /** Appended to the tab strip's own generic context-menu items. */
  menuExtras(tab: R): Menu[];
  /** A small state mark after the tab's title — undefined for a kind with nothing to flag. */
  badge?(tab: R): { icon: string; tooltip: string } | null;
  /** True for exactly one kind per app (Kira Space's `repo-graph`) — tabsForWorkspace's own
   *  stable partition puts every pinned tab of a workspace first, and closeTab/closeOthers/
   *  closeToTheRight/closeAll/duplicateTab/moveTab all guard against it. Absent (not `false`) for
   *  every other kind, so this costs those kinds no line. */
  pinned?: true;
}

export type TabKindRegistry<
  K extends string,
  R extends { kind: string; state: unknown },
  Icon,
  Color,
  Menu,
> = {
  readonly [P in K]: TabKindDef<P, R, Icon, Color, Menu>;
};

export type TabViewMap<K extends string> = Record<K, Component>;

// P3 D3: every parseState is a one-liner over the schema its own kind already imports — this is
// the shared shape (safeParse, `.data` on success, `null` on failure) so each registry entry
// states only which schema, not the pattern.
export function parseStateWith<S>(schema: {
  safeParse(raw: unknown): { success: true; data: S } | { success: false };
}): (raw: unknown) => S | null {
  return (raw) => {
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
  };
}
