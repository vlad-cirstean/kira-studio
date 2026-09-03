<script setup lang="ts">
/**
 * `docs/plans/P4.md` W11: the real shell. P0 sketched two empty regions and P3 hung a live-data
 * strip on them "replaced by P4's real list and toolbar" (that comment's own words) — this file
 * is that replacement. `AppToolbar.vue`/`CommitGrid.vue`/`LoadMoreButton.vue` (W6-W10) are wired
 * together here for the first time; everything above this file in the dependency order was
 * deliberately dead code in the production bundle until now.
 *
 * The live-data strip and its `data-testid`s are deleted, not hidden, except one: `chunk-source`
 * stays on the list region, because it is a real field of the stream chunk (§5.4) with no other
 * visible surface — everything else the strip showed now has a real UI equivalent (the repo
 * picker's own label, the rendered rows themselves).
 */
import type { HostKind, Transport } from "@kira-version/ipc";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { BridgeClient } from "./bridge/client.ts";
import AppToolbar from "./components/AppToolbar.vue";
import CommitGrid from "./components/CommitGrid.vue";
import EmptyRepositoryPanel from "./components/EmptyRepositoryPanel.vue";
import GitBlockedPanel from "./components/GitBlockedPanel.vue";
import LoadMoreButton from "./components/LoadMoreButton.vue";
import NoRepositoryPanel from "./components/NoRepositoryPanel.vue";
import { GraphViewState } from "./state/graphView.ts";
import { RepoState } from "./state/repo.ts";
import { SelectionState } from "./state/selection.ts";
import { SettingsState } from "./state/settings.ts";
import {
  type ColumnWidths,
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_DETAIL_WIDTH,
  type DateFormat,
  type PersistedViewState,
  type ViewStateStore,
} from "./state/viewState.ts";

const props = defineProps<{
  transport: Transport;
  viewState: ViewStateStore;
  host: HostKind;
}>();

const bridge = new BridgeClient(props.transport);
const connectionState = bridge.connectionState;
const graphView = new GraphViewState(bridge);
// A fresh CommitStore for the life of this component (graphView is never swapped out from under
// it — a repo switch resets the same GraphViewState instance rather than replacing it, matching
// CommitGrid.vue's own documented assumption), so this can be constructed once, directly.
const selection = new SelectionState(graphView.store);

const repoState = shallowRef<RepoState | undefined>(undefined);
const settingsState = shallowRef<SettingsState | undefined>(undefined);

const detailOpen = ref(true);
const columnWidths = ref<ColumnWidths>(DEFAULT_COLUMN_WIDTHS);
const dateFormat = ref<DateFormat>("relative");
const detailWidth = ref(DEFAULT_DETAIL_WIDTH);
const scrollRow = ref(0);
/** First-mount-only rehydration target for `CommitGrid.vue`'s own `initialScrollRow` prop (see
 *  that component's doc comment on why it is one-shot) — `undefined` until `bootstrap()` reads a
 *  persisted value, so a first-ever mount (nothing persisted yet) passes nothing and scrolls
 *  nowhere in particular, which is correct: there is no prior position to restore. */
const initialScrollRow = ref<number | undefined>(undefined);

// `@kira-version/core`'s `defaultSettings()` is deliberately not imported here for this one
// fallback: its settings schema module carries host-specific literals (`hosts: ["electron"]`,
// used to filter VS Code's contributed configuration) that `scripts/build.ts`'s own bundle-
// content check forbids in the shared UI bundle, on the same reasoning as its "no electron/
// vscode references" rule for the other two bundles. `settingsState` is always populated by the
// time this is actually read in practice (`bootstrap()` sets it synchronously, well before any
// repo-dependent UI — including this value's only consumer, `LoadMoreButton.vue` — can mount),
// so this mirrors `SETTINGS["kiraVersion.graph.pageSize"].default` (`packages/core/src/settings/
// schema.ts`) as a literal rather than importing it.
const FALLBACK_PAGE_SIZE = 5000;

const pageSize = computed(
  () => settingsState.value?.settings.value["kiraVersion.graph.pageSize"] ?? FALLBACK_PAGE_SIZE,
);

const commitGridRef = ref<InstanceType<typeof CommitGrid> | null>(null);
const toolbarRef = ref<InstanceType<typeof AppToolbar> | null>(null);

function triggerRefresh(): void {
  toolbarRef.value?.refresh();
}

async function handleRepoOpened(repoId: string): Promise<void> {
  // §6.2: switching repos resets GraphViewState, clears selection, and (via the persistence
  // watch below) writes the new repoId — a genuinely different repo has no sha/scroll position
  // worth re-resolving, unlike a refresh's re-walk of the *same* history.
  pendingSelectionSha.value = null;
  selection.clear();
  graphView.reset();
  await graphView.openStream(repoId);
}

// ---------------------------------------------------------------------------------------
// §6.2 / W5: re-resolving selection by sha once a reset's rows are loaded again — shared by
// both the boot-time rehydration path (bootstrap(), below) and every later refresh
// (GraphViewState.generation bumps on every re-walk reset, §6.2's own doc comment on `refresh`).
// A *speculative* SelectionState.selectBySha on every partial chunk would be wrong: on a miss it
// clears selection immediately (by design — see SelectionState's own doc comment), so calling it
// before the target's row has actually streamed back in would discard a selection that was
// really still pending, not actually gone. `CommitStore.rowOfSha` is checked first, non-
// destructively, and the real (clearing-on-miss) call only happens once the row is either found
// or the stream is exhausted, at which point a miss is a real answer.
// ---------------------------------------------------------------------------------------
const pendingSelectionSha = ref<string | null>(null);

watch(graphView.generation, () => {
  const sha = selection.sha.value;
  pendingSelectionSha.value = sha;
});

watch(graphView.loadedRows, () => {
  const sha = pendingSelectionSha.value;
  if (sha === null) return;
  const found = graphView.store.rowOfSha(sha) !== -1;
  if (!found && !graphView.exhausted.value) return;
  pendingSelectionSha.value = null;
  if (selection.selectBySha(sha)) commitGridRef.value?.scrollToRow(selection.row.value);
});

onMounted(() => {
  // requestAnimationFrame so the mark lands after the browser has actually painted this
  // frame, not merely after Vue's synchronous mount work.
  requestAnimationFrame(() => {
    performance.mark("kira:first-paint");
    performance.measure("kira:first-paint", undefined, "kira:first-paint");
    performance.mark("kira:layout-complete");
    performance.measure("kira:layout-complete", undefined, "kira:layout-complete");
  });

  void bootstrap();
});

let lastPersisted: PersistedViewState = {
  version: 2,
  repoId: null,
  loadedRows: 0,
  detailOpen: true,
  scrollRow: 0,
  selectedSha: null,
  columnWidths: DEFAULT_COLUMN_WIDTHS,
  dateFormat: "relative",
  detailWidth: DEFAULT_DETAIL_WIDTH,
};

async function bootstrap(): Promise<void> {
  const init = await bridge.init();
  settingsState.value = new SettingsState(bridge, init.settings);
  const repo = new RepoState(bridge, init.git);
  repoState.value = repo;

  const persisted = props.viewState.read();
  if (persisted) {
    lastPersisted = persisted;
    detailOpen.value = persisted.detailOpen;
    columnWidths.value = persisted.columnWidths;
    dateFormat.value = persisted.dateFormat;
    detailWidth.value = persisted.detailWidth;
    initialScrollRow.value = persisted.scrollRow;

    // §6.3's "collapsed by default" below `wide`: a persisted `detailOpen: true` from an earlier,
    // wider session must not reopen the pane/drawer over a mount that starts narrower — without
    // this, the line above would silently clobber the collapse the mount-time `breakpoint` watch
    // (below) already applied moments earlier, since that watch runs synchronously during mount
    // while this restore only lands later, after `bridge.init()`'s own await. Not gated on
    // `breakpoint`'s *previous* value the way that watch is (there is no real "previous" at boot,
    // only that watch's own initial-ref placeholder) — mounting directly into a narrow layout is
    // exactly the case §6.3 describes, not merely a special case of resizing into one. A real
    // selection still reopens it once `pendingSelectionSha` resolves, via the selection watch
    // below — nothing here treats a boot with a pending selection any differently.
    collapseIfNarrowWithNoSelection();

    if (persisted.repoId) {
      const outcome = await repo.open(persisted.repoId);
      if (outcome.kind === "ok") {
        if (persisted.selectedSha) pendingSelectionSha.value = persisted.selectedSha;
        // §5.4: a freshly (re)mounted GraphViewState's own `loadedRows` starts at 0, so the
        // default `resumeThroughRow` asks the host to replay every row it still has cached —
        // that single round trip is the whole of "rehydrates without re-running git".
        await graphView.openStream(outcome.repo.repoId);
      }
    }
  }

  watch(
    [
      () => repoState.value?.activeRepo.value?.repoId ?? null,
      graphView.loadedRows,
      detailOpen,
      scrollRow,
      () => selection.sha.value,
      columnWidths,
      dateFormat,
      detailWidth,
    ],
    ([repoId, loadedRows, isDetailOpen, row, selectedSha, widths, format, dWidth]) => {
      lastPersisted = {
        ...lastPersisted,
        repoId,
        loadedRows,
        detailOpen: isDetailOpen,
        scrollRow: row,
        selectedSha,
        columnWidths: widths,
        dateFormat: format,
        detailWidth: dWidth,
      };
      props.viewState.write(lastPersisted);
    },
  );
}

// ---------------------------------------------------------------------------------------
// §6.3's breakpoints — measured on the webview's own width via ResizeObserver on the root, not
// `window.matchMedia` (which reports the *window's* width and would be wrong the moment the
// panel is docked to the side or split with another editor group).
// ---------------------------------------------------------------------------------------
type Breakpoint = "wide" | "narrow" | "overlay";

function breakpointFor(width: number): Breakpoint {
  if (width >= 900) return "wide";
  if (width >= 600) return "narrow";
  return "overlay";
}

const rootEl = ref<HTMLDivElement | null>(null);
const breakpoint = ref<Breakpoint>("wide");
let breakpointObserver: ResizeObserver | undefined;
let breakpointRaf = 0;

/** §6.3's "collapsed by default" below `wide`, with nothing selected — shared by the mount-time
 *  restore in `bootstrap()` (see its own call site's comment) and the live-resize watch just
 *  below, so both a fresh mount into a narrow layout and a later resize into one agree. */
function collapseIfNarrowWithNoSelection(): void {
  if (breakpoint.value !== "wide" && selection.row.value < 0) detailOpen.value = false;
}

// Entering a narrower breakpoint with nothing selected collapses the pane (§6.3's "collapsed by
// default"); entering it *with* a selection, or widening back past 900px, leaves `detailOpen` as
// it is — there is nothing in §6.3 asking a widen to force it back open, and forcing it closed
// on every narrow-to-wide crossing would fight a user who just opened it deliberately.
watch(breakpoint, (kind, previous) => {
  if (kind !== "wide" && previous === "wide") collapseIfNarrowWithNoSelection();
});

// §6.3: "collapsed by default, opens on selection" for both sub-900px bands — at the wide
// breakpoint, selecting a row does not by itself open the pane (only CommitGrid.vue's own
// toggle/close events do, §6.4's second-click/Enter/Esc model), so this only applies below it.
watch(
  () => selection.row.value,
  (row) => {
    if (row >= 0 && breakpoint.value !== "wide") detailOpen.value = true;
  },
);

function toggleDetail(): void {
  detailOpen.value = !detailOpen.value;
}

/** §6.6's Esc ordering: the diff view (P5) first, then the detail pane/drawer. P4 has no diff
 *  view yet, so this is the whole chain today — a later phase inserts a step above this one
 *  rather than reimplementing the tail. Kept as the one handler both `CommitGrid.vue`'s own
 *  `closeDetail` emit (when the grid has focus) and this file's own document-level listener
 *  (when focus is inside the detail pane/drawer itself, which is outside the grid's host and so
 *  outside its own keydown listener's reach) call — "the ordering lives in one handler in
 *  App.vue" (§6.6's own words), not duplicated per input source. */
function closeDetail(): void {
  detailOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && detailOpen.value) closeDetail();
}

function onDocumentPointerDown(event: PointerEvent): void {
  // The overlay drawer's own "dismissible... on a click outside" (§6.3) — only listened for
  // while the drawer is actually showing, and only at the overlay breakpoint (the docked pane at
  // wide/narrow has no such behaviour; clicking the grid to select a different row is normal use
  // there, not a dismissal).
  if (breakpoint.value !== "overlay" || !detailOpen.value) return;
  const drawer = document.querySelector('[data-testid="detail-region"]');
  if (drawer && event.target instanceof Node && drawer.contains(event.target)) return;
  closeDetail();
}

function scheduleBreakpointUpdate(): void {
  if (breakpointRaf !== 0) return;
  breakpointRaf = requestAnimationFrame(() => {
    breakpointRaf = 0;
    if (rootEl.value) breakpoint.value = breakpointFor(rootEl.value.clientWidth);
  });
}

// ---------------------------------------------------------------------------------------
// The detail pane's own resize handle (≥900px only, §6.3's table) — the same drag-and-clamp
// shape `CommitGrid.vue`'s column handles use, kept here rather than factored out: this is the
// only other resizable edge in the app, and the two call sites differ enough (this one persists
// through `viewState` directly, that one round-trips through a prop/emit pair) that a shared
// helper would mostly be parameter-passing.
// ---------------------------------------------------------------------------------------
const MIN_DETAIL_WIDTH = 240;
const MAX_DETAIL_WIDTH = 640;

function setDetailWidth(next: number): void {
  detailWidth.value = Math.max(MIN_DETAIL_WIDTH, Math.min(MAX_DETAIL_WIDTH, Math.round(next)));
}

function startDetailResize(event: MouseEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = detailWidth.value;
  const onMove = (moveEvent: MouseEvent): void => {
    // Dragging the left edge left (negative movementX) widens a right-docked pane.
    setDetailWidth(startWidth - (moveEvent.clientX - startX));
  };
  const onUp = (): void => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

const DETAIL_HANDLE_KEY_STEP = 16;

function handleDetailHandleKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    setDetailWidth(detailWidth.value + DETAIL_HANDLE_KEY_STEP);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    setDetailWidth(detailWidth.value - DETAIL_HANDLE_KEY_STEP);
  }
}

const detailWidthPx = computed(() => `${detailWidth.value}px`);

// `exactOptionalPropertyTypes` (tsconfig.base.json) treats an explicit `undefined` differently
// from an omitted prop — `CommitGrid.vue`'s `initialScrollRow?: number` wants the latter on a
// first-ever mount (nothing persisted to restore), so this only spreads the prop in once
// `bootstrap()` has actually set one, rather than always binding a possibly-`undefined` value.
const initialScrollRowProp = computed(() =>
  initialScrollRow.value === undefined ? {} : { initialScrollRow: initialScrollRow.value },
);

const hasSelection = computed(() => selection.row.value >= 0);
const selectedSubject = computed(() =>
  hasSelection.value ? graphView.store.subjectAt(selection.row.value) : "",
);
const selectedShortSha = computed(() =>
  hasSelection.value ? graphView.store.shortShaAt(selection.row.value) : "",
);

onMounted(() => {
  document.addEventListener("keydown", onDocumentKeydown);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  if (rootEl.value) {
    breakpoint.value = breakpointFor(rootEl.value.clientWidth);
    breakpointObserver = new ResizeObserver(scheduleBreakpointUpdate);
    breakpointObserver.observe(rootEl.value);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onDocumentKeydown);
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  breakpointObserver?.disconnect();
  if (breakpointRaf !== 0) cancelAnimationFrame(breakpointRaf);
  graphView.dispose();
  repoState.value?.dispose();
  settingsState.value?.dispose();
  bridge.dispose();
});
</script>

<template>
  <div ref="rootEl" class="kv-app" :data-connection-state="connectionState">
    <!-- Unconditional, present from first paint regardless of which of the four content states
         below is showing (or whether bootstrap() has resolved a repoState at all yet) — the old
         live-data strip carried this testid unconditionally too (inside its own always-rendered
         toolbar), and it is a genuine e2e wait/assert target across all three hosts' specs, not
         merely cosmetic duplicate of the root's own data-connection-state attribute above. -->
    <span class="kv-visually-hidden" data-testid="connection-state">{{ connectionState }}</span>
    <template v-if="repoState">
      <GitBlockedPanel v-if="repoState.git.value.kind !== 'ok'" :status="repoState.git.value" />

      <NoRepositoryPanel
        v-else-if="!repoState.activeRepo.value"
        :repo-state="repoState"
        @repo-opened="handleRepoOpened"
      />

      <template v-else-if="repoState.activeRepo.value.head.kind === 'unborn'">
        <AppToolbar
          ref="toolbarRef"
          :graph-view="graphView"
          :repo-state="repoState"
          @repo-opened="handleRepoOpened"
        />
        <EmptyRepositoryPanel :branch-name="repoState.activeRepo.value.head.name" />
      </template>

      <template v-else>
        <AppToolbar
          ref="toolbarRef"
          :graph-view="graphView"
          :repo-state="repoState"
          @repo-opened="handleRepoOpened"
        />
        <main class="kv-body">
          <section class="kv-graph-region" data-testid="graph-region" aria-label="Commit graph">
            <CommitGrid
              ref="commitGridRef"
              :graph-view="graphView"
              :selection="selection"
              :column-widths="columnWidths"
              :date-format="dateFormat"
              v-bind="initialScrollRowProp"
              @update:column-widths="columnWidths = $event"
              @update:date-format="dateFormat = $event"
              @scroll="scrollRow = $event"
              @toggle-detail="toggleDetail"
              @close-detail="closeDetail"
              @refresh="triggerRefresh"
            />
            <LoadMoreButton :graph-view="graphView" :page-size="pageSize" />
            <span class="kv-visually-hidden" data-testid="chunk-source">{{
              graphView.lastChunkSource.value ?? ""
            }}</span>
          </section>

          <aside
            v-if="detailOpen && breakpoint !== 'overlay'"
            class="kv-detail-region"
            data-testid="detail-region"
            aria-label="Commit detail"
          >
            <div
              v-if="breakpoint === 'wide'"
              class="kv-detail-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize detail pane"
              tabindex="0"
              @mousedown="startDetailResize"
              @keydown="handleDetailHandleKeydown"
            ></div>
            <div class="kv-detail-placeholder">
              <template v-if="hasSelection">
                <p class="kv-detail-subject">{{ selectedSubject }}</p>
                <p class="kv-detail-sha">{{ selectedShortSha }}</p>
              </template>
              <p v-else class="kv-detail-empty">Select a commit to see its details.</p>
              <p class="kv-detail-note">The detail view itself arrives in P5.</p>
            </div>
          </aside>
        </main>

        <div v-if="detailOpen && breakpoint === 'overlay'" class="kv-detail-drawer">
          <aside class="kv-detail-region" data-testid="detail-region" aria-label="Commit detail">
            <div class="kv-detail-placeholder">
              <template v-if="hasSelection">
                <p class="kv-detail-subject">{{ selectedSubject }}</p>
                <p class="kv-detail-sha">{{ selectedShortSha }}</p>
              </template>
              <p v-else class="kv-detail-empty">Select a commit to see its details.</p>
              <p class="kv-detail-note">The detail view itself arrives in P5.</p>
            </div>
          </aside>
        </div>
      </template>
    </template>
  </div>
</template>

<style>
.kv-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: var(--kv-app-bg);
  color: var(--kv-app-fg);
  font-family: var(--kv-font-family);
  font-size: var(--kv-font-size);
  overflow: hidden;
}

.kv-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.kv-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.kv-graph-region {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--kv-panel-bg);
}

.kv-graph-region .kv-commit-grid {
  flex: 1;
  min-height: 0;
}

.kv-detail-region {
  position: relative;
  width: v-bind(detailWidthPx);
  flex-shrink: 0;
  border-left: 1px solid var(--kv-panel-border);
  background-color: var(--kv-panel-bg);
  overflow: auto;
}

.kv-detail-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 5px;
  margin-left: -2px;
  cursor: col-resize;
  z-index: 2;
  background: transparent;
}

.kv-detail-resize-handle:hover,
.kv-detail-resize-handle:focus-visible {
  background-color: var(--kv-focus-border);
  outline: none;
}

.kv-detail-placeholder {
  padding: var(--kv-space-4);
}

.kv-detail-subject {
  margin: 0 0 var(--kv-space-2);
  font-weight: 600;
}

.kv-detail-sha {
  margin: 0 0 var(--kv-space-4);
  font-family: var(--kv-mono-font-family);
  font-size: var(--kv-mono-font-size);
  color: var(--kv-description-fg);
}

.kv-detail-empty {
  margin: 0 0 var(--kv-space-4);
  color: var(--kv-description-fg);
}

.kv-detail-note {
  margin: 0;
  font-style: italic;
  color: var(--kv-description-fg);
}

/* §6.3's <600px band: an overlay drawer over the graph rather than a docked pane. */
.kv-detail-drawer {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: flex-end;
  background-color: var(--kv-overlay-bg);
  z-index: 20;
}

.kv-detail-drawer .kv-detail-region {
  width: min(320px, 90vw);
  box-shadow: -2px 0 8px var(--kv-widget-shadow);
}
</style>
