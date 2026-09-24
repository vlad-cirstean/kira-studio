<script setup lang="ts">
/**
 * `docs/plans/P7.md` W13 — one commit in the review list. Collapsed: a disclosure triangle,
 * subject, short sha (`§6.4`'s "clicking a sha copies it"), author, relative date. Expanded:
 * `FileTree.vue` over this row's own `DetailState` (`ReviewSessionState.expand` fetches
 * `commit.detail` on first expansion and keeps it for the session — this component never fetches
 * anything itself). `→`/`←`/`Enter` toggle expansion (§6.8 step 2); the row's own context menu is
 * copy-sha/copy-message only (`rowMenuModel.ts`'s `buildReviewRowMenu`, not `buildRowMenu` — this
 * row offers no checkout/branch/tag/revert).
 *
 * G12 D12: opening a file no longer renders an in-webview diff overlay at all — `FileTree`'s
 * selection calls `actions.openInEditor` directly (D11 fixed the URI it produces), the same
 * request `DetailPane.vue`'s own tree already uses. D13: `list-mode`/`filter` are props from
 * `ReviewView.vue`'s one panel-level toolbar, not this row's own `DetailState` fields — every
 * row's `FileTree` renders no toolbar of its own (`show-toolbar="false"`).
 */
import type { CommitStore } from '@kira/git-core';
import { TransportError } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import { useEventListener } from '@vueuse/core';
import { computed, ref, useTemplateRef } from 'vue';
import type { FileListMode } from '../../state/detail.ts';
import type { DetailActions } from '../../state/detailActions.ts';
import type { ReviewExpansion } from '../../state/review.ts';
import { formatRelativeDate } from '../dateFormat.ts';
import FileTree from '../FileTree.vue';
import RowContextMenu from '../RowContextMenu.vue';
import { buildReviewRowMenu } from '../rowMenuModel.ts';

const props = defineProps<{
  sha: string;
  store: CommitStore;
  expanded: boolean;
  expansion: ReviewExpansion | undefined;
  /** P75 §1.2: the session-level row-action bundle (`ReviewSessionState.rowActions`) — reachable
   *  on a collapsed row exactly like an expanded one, unlike `expansion?.actions` (`undefined`
   *  until this row has been expanded at least once). */
  actions: DetailActions;
  /** Roving-tabindex cursor (§6.8's tree/treeitem pattern, `FileTree.vue`'s own precedent) —
   *  `ReviewView.vue` owns which row is the cursor across the whole list. */
  focused: boolean;
  /** G12 D13: `ReviewView.vue`'s one panel-level toolbar state, forwarded to this row's own
   *  `FileTree` (which renders no toolbar of its own). */
  listMode: FileListMode;
  filter: string;
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'focus-row'): void;
}>();

const row = computed(() => props.store.rowOfSha(props.sha));
const commit = computed(() => (row.value === -1 ? undefined : props.store.commitAt(row.value)));
const shortSha = computed(() => props.sha.slice(0, 7));
const dateText = computed(() =>
  commit.value ? formatRelativeDate(commit.value.committer.timestamp) : '',
);

/** G-UX D5 (item 5): the row-action cluster (Open all changes, Open in graph) sits inside this
 *  header; a click on it is not a request to expand the row. Guarded here rather than stopped at
 *  each action. P75 §2.3: "Open in graph" is a plain `KuiButton` now (no more `command:` anchor
 *  VS Code's own bubble-phase link interceptor needed to see), but the guard stays — it is still
 *  correct for keeping either action's click from also toggling the row. */
function onRowClick(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest('.kv-review-row-actions')) return;
  emit('focus-row');
  emit('toggle');
}

// P105 §5.2(c): the row's own `role="treeitem"` + `@keydown` already own keyboard access — this
// header is a click sub-region of it, not its own interactive element, so the listener attaches
// off-template rather than adding a second, redundant tab stop.
const headerEl = useTemplateRef<HTMLElement>('headerEl');
useEventListener(headerEl, 'click', onRowClick);

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowRight':
      if (!props.expanded) {
        event.preventDefault();
        emit('toggle');
      }
      break;
    case 'ArrowLeft':
      if (props.expanded) {
        event.preventDefault();
        emit('toggle');
      }
      break;
    case 'Enter':
      event.preventDefault();
      emit('toggle');
      break;
    default:
      break;
  }
}

const menuState = ref<{ x: number; y: number } | undefined>(undefined);

function onContextMenu(event: MouseEvent): void {
  emit('focus-row');
  event.preventDefault();
  menuState.value = { x: event.clientX, y: event.clientY };
}

// P108 F9: `props.actions` (the session-level `rowActions` bundle, see this component's own doc
// comment above) is reachable on a collapsed row exactly like an expanded one — `props.expansion`
// is `undefined` until the row has been expanded at least once, so building this menu from
// `expansion?.actions` left Copy SHA/Copy message disabled (or a no-op) on every never-expanded
// row, the same bug `openAllChanges` above was already fixed for.
const menuSections = computed(() =>
  buildReviewRowMenu(props.actions.capabilities.clipboard),
);

function onMenuSelect(id: string): void {
  menuState.value = undefined;
  const c = commit.value;
  if (!c) return;
  if (id === 'copySha') props.actions.copy(c.sha, 'full SHA');
  else if (id === 'copyMessage') props.actions.copy(c.subject, 'commit message');
}

// G14 D8 row action 1 / G21 D8c: "Open all changes" — one awaited `openAllChanges` call rather
// than N unawaited `openInEditor` calls. Item 8's own remaining problem (i): the old loop fired
// every request in the same tick with a bare `void` and no `.catch`, so a run where 1 of 14 opens
// succeeded and 13 rejected looked, to the user, exactly like "it only shows one file's diff" —
// no announcement, no error surface, no partial-success reporting. This awaits the single host
// round trip and announces the real outcome either way.
//
// P75 §1.2: no expansion precondition — `props.actions` is reachable on a collapsed row (the
// old `exp?.actions.announce(...)` optional-chained through the very binding that was undefined
// on a never-expanded row, so its "expand the commit first" announcement never actually ran).
// `parentIndex` is `undefined` until the row has been expanded (nothing picked yet); the host
// default (parent 0) is exactly what an unexpanded row would have shown anyway.
async function openAllChanges(): Promise<void> {
  // G-UX D5: stopPropagation() here is now redundant with (and removed in favour of) onRowClick's
  // own .kv-review-row-actions guard above -- one rule for the whole action cluster.
  try {
    const { opened, failed, mode } = await props.actions.openAllChanges({
      sha: props.sha,
      parentIndex: props.expansion?.detail.parentIndex.value,
    });
    props.actions.announce(
      failed === 0
        ? mode === 'multiDiff'
          ? `Opened all ${opened} changed files`
          : `Opened ${opened} files`
        : `Opened ${opened} of ${opened + failed} files — ${failed} couldn't be opened`,
    );
  } catch (err) {
    props.actions.announce(
      `Couldn't open the changes — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// G14 D8 row action 3 / D10, replaced P75 §2.3: was a `command:kiraSpace.openCommitInGraph`
// anchor (VS Code's own webview escape hatch) — inert in Kira Space, which mounts this same
// component in a Wails WebView with no `command:` handler at any layer. Now a real request both
// hosts answer locally.
async function revealInGraph(): Promise<void> {
  try {
    const { revealed } = await props.actions.revealInGraph({ sha: props.sha });
    if (!revealed) {
      props.actions.announce(
        "Couldn't reveal this commit — no graph is open for this repository.",
      );
    }
  } catch (err) {
    // P108 F10: a template handler — Vue's own async-error handling already stops this from
    // becoming a true unhandled rejection, but with no `app.config.errorHandler` set it never
    // reached the user either. `transport-closed` (this row's own host disconnecting mid-request)
    // is ignored outright — nothing left to announce it to once the row is gone.
    if (err instanceof TransportError && err.code === 'transport-closed') return;
    props.actions.announce(
      `Couldn't reveal this commit — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// G12 D12: opens VS Code's native diff directly — no in-webview diff mode to flip into. `sha`'s
// own parentIndex is this row's current merge-parent selection, exactly what commit.detail was
// fetched against. G21 D13: `pinned` comes straight from FileTree's own `openFile` emit — a
// click (or arrow-key move) is `false`, a double click/`Enter` is `true`.
function onOpenFile(index: number, pinned: boolean): void {
  const exp = props.expansion;
  const file = exp?.detail.detail.value?.files[index];
  if (!exp || !file) return;
  // P108 F10: was fire-and-forget with no `.catch` — a rejection here (transport drop, a bad
  // path on the host side) became a silent unhandled rejection.
  exp.actions
    .openInEditor({
      sha: props.sha,
      path: file.path,
      originalPath: file.originalPath,
      parentIndex: exp.detail.parentIndex.value,
      pinned,
    })
    .catch((err: unknown) => {
      if (err instanceof TransportError && err.code === 'transport-closed') return;
      props.actions.announce(
        `Couldn't open the file — ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
</script>

<template>
  <div
    v-if="commit"
    class="kv:flex kv:flex-col kv:border-b kv:border-panel-border kv:cursor-pointer kv:group kv:focus-visible:outline kv:focus-visible:outline-1 kv:focus-visible:outline-focus kv:focus-visible:-outline-offset-2"
    role="treeitem"
    :aria-expanded="expanded"
    :tabindex="focused ? 0 : -1"
    :data-testid="`review-row-${sha}`"
    @keydown="onKeydown"
    @contextmenu="onContextMenu"
  >
    <!-- G19 D10: the click-to-toggle listener moved here, off the whole row (F10's root cause —
         a click on any file row inside .kv-review-row-body used to bubble straight up and
         collapse the very commit it was clicked inside, since nothing along the way ever called
         stopPropagation()). Only the header itself toggles the row now. -->
    <!-- W17: hover tint scoped to the header, not the whole row — the expanded body's own
         diff-deleted-fg text drops below 4.5:1 contrast in vscode-dark against the hover tint
         (axe caught it); the header's own background (--kv-app-bg, unhovered) is what the body
         already sits on, and that combination passes. -->
    <div
      ref="headerEl"
      class="kv:flex kv:items-center kv:gap-1 kv:py-1 kv:px-1.5 kv:min-w-0 kv:font-ui kv:group-hover:bg-hover"
    >
      <span
        class="codicon kv:text-[12px] kv:w-3 kv:shrink-0"
        :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        aria-hidden="true"
      ></span>
      <!-- G14 D8 row 1: two lines — subject on its own, full-width line; author/date/sha, muted,
           below it. GitLens's own commit-node anatomy. -->
      <span class="kv:flex kv:flex-col kv:gap-0.5 kv:flex-1 kv:min-w-0">
        <span class="kv:truncate">{{ commit.subject }}</span>
        <span class="kv:flex kv:items-center kv:gap-0.5 kv:text-muted kv:text-xs kv:whitespace-nowrap kv:overflow-hidden">
          <span class="kv:overflow-hidden kv:text-ellipsis">{{ commit.author.name }}</span>
          <span class="kv:shrink-0" aria-hidden="true">·</span>
          <span class="kv:overflow-hidden kv:text-ellipsis">{{ dateText }}</span>
          <span class="kv:shrink-0" aria-hidden="true">·</span>
          <!-- G19 D7: the clickable-sha button and its own "Copy SHA" affordance are gone — the
               sha renders as plain text; the existing copySha context-menu item (buildReviewRowMenu)
               already covers this, and F7 found these two affordances genuinely redundant with it. -->
          <span class="kv:font-data kv:text-inherit kv:shrink-0 kv:bg-transparent kv:border-0 kv:cursor-pointer kv:p-0">{{ shortSha }}</span>
        </span>
      </span>
      <!-- G14 D8 row 2: inline icon actions, right-aligned — revealed on hover/focus-within
           (below) and always present for the roving-tabindex-focused row. GitLens's own
           row-action pattern. `kv-review-row-actions` is kept as a literal class — `onRowClick`'s
           own `.closest('.kv-review-row-actions')` guard below reads it as a script hook, not
           styling. -->
      <span
        :class="[
          'kv-review-row-actions kv:flex kv:items-center kv:gap-0.5 kv:shrink-0',
          focused ? 'kv:opacity-100' : 'kv:opacity-0 kv:group-hover:opacity-100 kv:group-focus-within:opacity-100',
        ]"
      >
        <KuiButton
          variant="icon"
          icon="codicon-diff-multiple"
          v-kui-tooltip="'Open all changes'"
          aria-label="Open all changes"
          @click="openAllChanges"
        />
        <!-- P75 §2.3: a real KuiButton now — no more command: anchor VS Code's own bubble-phase
             link interceptor needed to observe directly, since the reveal is a bridge request.
             onRowClick's own .kv-review-row-actions guard above still keeps this click from also
             toggling the row. -->
        <KuiButton
          variant="icon"
          icon="codicon-git-commit"
          v-kui-tooltip="'Open in graph'"
          aria-label="Open in graph"
          @click="revealInGraph"
        />
      </span>
    </div>

    <div v-if="expanded" class="kv:border-t kv:border-panel-border kv:min-h-30 kv:max-h-80 kv:flex kv:flex-col">
      <p v-if="expansion?.detail.error.value" class="kv:m-0 kv:p-2 kv:text-error">
        Couldn't load this commit — {{ expansion.detail.error.value }}
      </p>
      <FileTree
        v-else-if="expansion?.detail.detail.value"
        :files="expansion.detail.detail.value.files"
        :selected-file="expansion.detail.selectedFile.value"
        :list-mode="listMode"
        :filter="filter"
        :show-toolbar="false"
        :parents="expansion.detail.detail.value.parents"
        :parent-index="expansion.detail.parentIndex.value"
        :store="store"
        :actions="expansion.actions"
        @open-file="onOpenFile"
        @update:parent-index="expansion.detail.setParentIndex($event)"
      />
      <p v-else class="kv:m-0 kv:p-2 kv:text-muted">Loading…</p>
    </div>

    <RowContextMenu
      v-if="menuState"
      :sections="menuSections"
      :x="menuState.x"
      :y="menuState.y"
      label="Commit actions"
      @select="onMenuSelect"
      @close="menuState = undefined"
    />
  </div>
</template>

