import type { ComputedRef, InjectionKey } from 'vue';
import { inject } from 'vue';
import type { MenuItem } from './state/contextMenu';
import type { TabKindRegistry, TabViewMap } from './tabs/types';

// P103 Part 2 (§5.4): the seam MainView/TabStrip/WorkbenchShell/TitleBar/StatusBar share instead
// of importing an app's own `state/tabs`/`state/tabKinds`/`state/mode`(`workspace`) directly — a
// `provide`/`inject` host object (Vue's own mechanism, no dependency) each app builds once, in its
// own `App.vue`, from its real stores/registries.
//
// Two distinct string unions are in play, and keeping them as two type parameters (rather than
// reusing one `K` for both, tried first and rejected once `TabKindRegistry`'s own invariance in its
// kind parameter surfaced a real type error) matters: `WK`, the *workspace* key
// (`AppMode`/`WorkspaceKey` — what `activeWorkspace`/`tabsForWorkspace` scope by) and the tab
// *kind* union, which is never named separately here at all — it's read off `R['kind']` directly,
// since every real `TabRecord` union already carries it as its own discriminant.
export interface TabLike {
  id: string;
  kind: string;
  state: unknown;
  active: boolean;
}

/** The one axis every generic component actually calls on the tabs store — `activeWorkspace`
 *  scoped, kind-registry aware. Deliberately narrower than `createTabsStore`'s full
 *  `TabsStoreActions<K, R>` (this package's own state factory): a structural subset, so a host
 *  built from either app's real Pinia store instance satisfies it by shape with no adapter. */
export interface WorkbenchTabsHost<WK extends string, R extends TabLike> {
  readonly tabs: readonly R[];
  readonly activeIdByWorkspace: Record<WK, string | null>;
  isPreview(id: string): boolean;
  tabsForWorkspace(key: WK): R[];
  activateTab(id: string): void;
  closeTab(id: string): void;
  closeOthers(id: string): void;
  closeToTheRight(id: string): void;
  closeAll(key: WK): void;
  duplicateTab(id: string): unknown;
  moveTab(fromId: string, toId: string): void;
  promoteTab(id: string): void;
}

/** A tab's icon, resolved into the one shape `TabStrip.vue` actually renders — Kira Studio's own
 *  `TabIcon` (`string`, a codicon name) always resolves to `{ codicon }`; Kira Space's
 *  (`string | { filePath }`) resolves either branch, `{ fileStyle }` mirroring
 *  `RepoTreeRow.vue`'s own seti-icon `mask-image` style object for a `repo-file` tab. */
export type TabIconRender = { codicon: string } | { fileStyle: Record<string, string> };

export interface WorkbenchHost<WK extends string, R extends TabLike> {
  readonly activeWorkspace: ComputedRef<WK>;
  readonly tabs: WorkbenchTabsHost<WK, R>;
  readonly kinds: TabKindRegistry<R['kind'], R, unknown, unknown, MenuItem>;
  readonly views: TabViewMap<R['kind']>;
  iconFor(tab: R): TabIconRender;
  railColorFor(tab: R): string | undefined;
  /** Appended after the six generic context-menu items and the tab kind's own `menuExtras` —
   *  neither app populates this today (their per-kind extras, incognito toggle included, already
   *  flow through `kinds[tab.kind].menuExtras`); the hook exists so a future extra doesn't need a
   *  third context-menu seam invented later. */
  extraTabMenu?(tab: R): MenuItem[];
  /** A trailing mark after the tab title — Kira Studio's kind-supplied `badge()` member
   *  (`TAB_KINDS[tab.kind].badge`); Kira Space wires none, since no kind of its own declares one. */
  tabBadge?(tab: R): { icon: string; tooltip: string } | null;
  /** `.is-attention`'s own boolean — Kira Studio's Claude Code "waiting for you" dot
   *  (`!tab.active && tab.kind === 'terminal' && …agentActivityFor(tab.id)?.phase === 'attention'`).
   *  Kira Space wires none. */
  tabAttention?(tab: R): boolean;
  /** A leading mark before the tab title, the one per-tab extra neither `iconFor` (the tab's own
   *  icon) nor `tabBadge` (a trailing, kind-supplied mark) covers — Kira Studio's own incognito eye
   *  glyph, uniform across every kind rather than supplied by one kind's own registry entry. Found
   *  reading `TabStrip.vue` side by side with Kira Space's, the same way P103 Part 2 §5.2 found
   *  `createTabsStore`'s hook surface needed more than the plan's own two-hook sketch — not named
   *  in the plan's own condensed `WorkbenchHost` table, but load-bearing for pixel parity. */
  tabIndicator?(tab: R): { icon: string; tooltip: string } | null;
}

// An InjectionKey carries one concrete type; each app's real WK/R instantiation is narrowed back
// at useWorkbenchHost's own call site below, the same "cast at the provide/inject boundary" shape
// Vue's own generic-provide docs use — there is no way to spell "any instantiation of a generic
// interface" as the key's own type parameter.
// biome-ignore lint/suspicious/noExplicitAny: see above.
type AnyWorkbenchHost = WorkbenchHost<any, any>;

export const workbenchHostKey = Symbol('workbenchHost') as InjectionKey<AnyWorkbenchHost>;

export function useWorkbenchHost<
  WK extends string = string,
  R extends TabLike = TabLike,
>(): WorkbenchHost<WK, R> {
  const host = inject(workbenchHostKey);
  if (!host) {
    throw new Error('useWorkbenchHost() called with no WorkbenchHost provided (App.vue)');
  }
  return host as WorkbenchHost<WK, R>;
}
