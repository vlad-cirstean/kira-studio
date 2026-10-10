import type { Transport, UiActionKind } from '@kira/git-ipc';
import { createApp, shallowRef, type App as VueApp } from 'vue';
import AppRoot from './App.vue';
import ReviewView from './components/review/ReviewView.vue';
import { GRAPH_VISIBLE_KEY } from './graphVisibility.ts';
import MountRoot from './MountRoot.vue';
import type { ReviewTarget } from './state/review.ts';
import type { DateFormat, ViewStateStore } from './state/viewState.ts';
// P110 A1: the prefixed Tailwind build (theme + utilities under `kv:`). Imported first so its
// `@theme inline reference` mappings are available to every utility class generated below.
import './theme/tailwind.css';
import './icons/codicon.css';
import './theme/vscode-tokens.css';
import './theme/density.css';
// G34 D1: colourless structural tokens — hoisted to :root, the app's one scale for both roots.
import './theme/kira-structure.css';

export interface MountHandle {
  unmount(): void;
  /** P79 review fix (Performance, LOW): `false` while backgrounded (a KeepAlive deactivate) lets
   *  `CommitGrid.vue`'s own generation-triggered rebuild defer to a single catch-up on the next
   *  `true`, instead of paying that cost once per missed bump against a grid nobody can see. Only
   *  meaningful for `view: "graph"` — a no-op call for a `"review"` mount, which has no
   *  `CommitGrid.vue` at all. Optional so every existing caller (this
   *  package's own tests) that never calls it keeps today's always-visible behavior exactly. See
   *  `graphVisibility.ts`. */
  setVisible?(visible: boolean): void;
}

export interface MountOptions {
  readonly transport: Transport;
  readonly viewState: ViewStateStore;
  /** `docs/plans/P7.md` W9: which root to mount — `AppRoot` (the panel, P0-P6) or `ReviewView`
   *  (the sidebar, §6.8). Defaults to `"graph"` so every pre-P7 call site (and every test that
   *  constructs `MountOptions` without this field) keeps mounting exactly what it always did. */
  readonly view?: 'graph' | 'review';
  /** Only meaningful when `view === "review"` — the cold-bootstrap arm of D40's "how the view
   *  learns which branch to review" (see `ReviewView.vue`'s own doc comment). `undefined`/`null`
   *  is the "no branch yet" state; ignored entirely for `view: "graph"`. */
  readonly target?: ReviewTarget | null;
  /** Only meaningful when `view === "review"`: `needsReview` lists just the files that changed since
   *  their last review behind a `Needs review | All` toggle; absent shows the plain list. */
  readonly reviewFilter?: 'all' | 'needsReview';
  /** Only meaningful when `view === "review"`: called with the path after each file-list mark. */
  readonly onReviewMarked?: (path: string) => void;
  /** G10 D19: only meaningful when `view === "graph"` — the exact mirror of `target` above, for a
   *  palette command that fired while the graph webview was cold (`panelView.ts`'s own
   *  `#pendingUiAction`/bootstrap-island arm). `undefined`/`null` means no action is pending. G14
   *  D10: renamed from `pendingAction` and grown an optional `target`, mirroring `ui.action`'s own
   *  shape. */
  readonly pendingUiAction?: {
    action: UiActionKind;
    target?: { repoId: string; sha: string };
  } | null;
  /** P72 §9.1: only meaningful when `view === "graph"` — Kira Space's own app-wide
   *  `appearance.dateFormat` (`packages/shared/domain/settings.ts`), read once at mount time and
   *  preferred over `PersistedViewState.dateFormat` when present (`App.vue`'s own `bootstrap()`).
   *  `undefined`/absent keeps today's behaviour: `PersistedViewState`'s own stored value, or its
   *  `'relative'` default — the shape every pre-P72 call site (and every test that constructs
   *  `MountOptions` without this field) already gets for free. Not reactive: this is the value as
   *  of this webview's cold mount, not a live prop — a later change to the app-wide setting reaches an already-mounted graph on its next
   *  remount (a closed tab, or a KeepAlive `:max` eviction, `RepoGraphView.vue`), not while it
   *  stays cached. */
  readonly dateFormat?: DateFormat;
  /** P173: only meaningful when `view === "graph"` — opens the host's Operations log. Absent where
   *  the host has none; the failure banner then names it in text instead. */
  readonly onShowOperations?: () => void;
}

/**
 * Mounts the app shell into `container`, wired to `transport` and `viewState`, Hosts and the harness call this rather than each owning their
 * own bootstrap — the UI is mounted unchanged everywhere (§8.4), only these pieces differ.
 * `viewState` is what P3 W9 adds: without it, the panel would have to keep
 * `retainContextWhenHidden` on to avoid losing scroll/selection/loaded-row state every time a
 * VS Code webview is hidden and recreated (§2.1). `view` is what P7 W9 adds: one build, one
 * entry (§6.8/D41) — the host's own injected initial state says which root this call mounts,
 * never a second bundle. Both are breaking changes to the one function every host and the
 * harness calls, and both were made the same way: every call site moves in the same commit.
 */
export function mount(container: Element, opts: MountOptions): MountHandle {
  // §5.1 perf budgets are measured from navigation start (the implicit start of a
  // timeOrigin-relative measure); this marks the point the app's own bundle has parsed
  // and begun mounting. App.vue/ReviewView.vue each mark first-paint once mounted (W18 needs it
  // from both roots).
  performance.mark('kira:page-parsed');
  performance.measure('kira:page-parsed', undefined, 'kira:page-parsed');

  const {
    view = 'graph',
    target,
    reviewFilter,
    onReviewMarked,
    pendingUiAction,
    dateFormat,
    onShowOperations,
    ...rest
  } = opts;
  // P131 Part 2 §3.5: MountRoot wraps whichever root this mounts in the one TooltipProvider every
  // Tooltip/TooltipTrigger/TooltipContent trio in this package needs — git-ui is its own Vue app,
  // so neither host's own <App.vue> TooltipProvider reaches it.
  const app: VueApp =
    view === 'review'
      ? createApp(MountRoot, {
          root: ReviewView,
          rootProps: { ...rest, target, reviewFilter, onReviewMarked },
        })
      : createApp(MountRoot, {
          root: AppRoot,
          rootProps: { ...rest, pendingUiAction, dateFormat, showOperations: onShowOperations },
        });
  // P79 review fix: scoped to this one app instance, not module-level — several repo workspaces'
  // graphs can be mounted (and independently backgrounded) at once. A no-op provide for a
  // `"review"` mount (no CommitGrid.vue there to read it) is harmless.
  const graphVisible = shallowRef(true);
  app.provide(GRAPH_VISIBLE_KEY, graphVisible);
  // G16 D1/D2 (P110 A19): the document-level height chain, as classes applied here rather than
  // an `html, body` selector. `mount()` owns this chain (this file's own original doc comment:
  // "a document-owning bootstrap, not a widget factory"). Never removed on unmount: `html`/`body`
  // are the document's own elements, not scoped to any one mount.
  document.documentElement.classList.add('kv:h-full', 'kv:m-0', 'kv:p-0', 'kv:overflow-hidden');
  document.body.classList.add('kv:h-full', 'kv:m-0', 'kv:p-0', 'kv:overflow-hidden');
  // The other half of the chain — the class and the rule are useless apart, and they live in two
  // places because the class must follow whatever container the host hands us, not a naming
  // convention two packages have to agree on.
  container.classList.add('kv:h-full', 'kv:w-full', 'kv:overflow-hidden');
  app.mount(container);
  return {
    unmount(): void {
      app.unmount();
      container.classList.remove('kv:h-full', 'kv:w-full', 'kv:overflow-hidden');
    },
    setVisible(visible: boolean): void {
      graphVisible.value = visible;
    },
  };
}
