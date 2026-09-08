<script setup lang="ts">
/**
 * `docs/plans/P6.md` W13: §6.2's `[branch ▾]` toolbar slot. One dropdown, three sections
 * (Branches / Remote branches / Tags — judgment call 5); `refListModel.ts` owns the filter, sort
 * and cap, this file only renders. `TagList.vue` renders the third section as a real component
 * (its own doc comment says why), reusing the same filter text this file's own input owns rather
 * than a second box (§13's "one filter box, matching across all three sections").
 *
 * Every row also carries `RowContextMenu.vue`'s ref-scoped menu (W14: "every row also carries the
 * context menu W14 builds, which is where the destructive actions live") — a kebab button (mouse
 * *and* keyboard reachable) plus a plain right-click, both opening the same menu.
 */
import type { RefRow, StashEntry } from '@kira/git-ipc';
import { KuiButton, KuiPopoverPanel, KuiSearchInput } from '@kira/kira-ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { STATE_ICONS } from '../icons/index.ts';
import type { OpsState } from '../state/ops.ts';
import type { RefsState } from '../state/refs.ts';
import type { StashState } from '../state/stash.ts';
import RowContextMenu from './RowContextMenu.vue';
import {
  buildRefListSections,
  formatTrack,
  remoteCheckoutLabel,
  remoteCheckoutTarget,
} from './refListModel.ts';
import { buildRefMenu, remoteNamesFrom } from './rowMenuModel.ts';
import StashList from './StashList.vue';
import TagList from './TagList.vue';

const props = defineProps<{ refs: RefsState; ops: OpsState; stash: StashState }>();

/** OQ3: bubbled straight through from `StashList.vue`'s own emit — see that component's own doc
 *  comment on why the branch-mode dialog itself is owned by `App.vue`, not here. */
const emit = defineEmits<(e: 'branchFromStash', entry: StashEntry) => void>();

const isOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const filter = ref('');

const triggerLabel = computed(() => {
  const head = props.refs.head.value;
  if (!head) return '…';
  if (head.kind === 'branch') return head.name;
  if (head.kind === 'unborn') return `${head.name} (unborn)`;
  return head.sha.slice(0, 7);
});

const sections = computed(() =>
  buildRefListSections(
    {
      branches: props.refs.branches.value,
      remoteBranches: props.refs.remoteBranches.value,
      tags: props.refs.tags.value,
    },
    filter.value,
  ),
);

const knownRemotes = computed(() =>
  remoteNamesFrom(props.refs.remoteBranches.value.map((row) => row.shortName)),
);

function close(): void {
  isOpen.value = false;
  refMenu.value = undefined;
  renaming.value = undefined;
  forceDeleteCandidate.value = undefined;
}

function toggle(): void {
  isOpen.value = !isOpen.value;
  if (!isOpen.value) close();
}

// G10 D17: forwarded so App.vue's palette dispatcher can open this panel exactly the way clicking
// its own trigger does — the picker is the only place the UI names a ref to act on, so every
// ref-scoped palette command (checkout, delete/rename branch, delete tag, delete remote branch)
// reaches the same `openBranchPicker` action.
function open(): void {
  isOpen.value = true;
}
defineExpose({ open });

/** W20: `close()` unmounts the whole panel, including whatever row button the click just
 *  focused — by the time `runCheckout` might open `CheckoutDialog.vue`, that button is gone and
 *  `useModalFocus`'s own invoker capture would land on nothing (the browser's own fallback,
 *  `<body>`). Moving focus to the trigger *first* — a stable control that survives the panel's
 *  own close — gives that capture something real to return to, the same "make sure a persisting
 *  anchor holds focus before the invoking control disappears" fix `RowContextMenu.vue`'s own W20
 *  change makes for the row menu. */
function closeForCheckout(): void {
  triggerEl.value?.focus();
  close();
}

async function checkoutBranch(row: RefRow): Promise<void> {
  closeForCheckout();
  await props.ops.runCheckout(row.shortName, 'switch');
}

async function checkoutRemote(row: RefRow): Promise<void> {
  closeForCheckout();
  await props.ops.runCheckout(remoteCheckoutTarget(row, props.refs.branches.value), 'switch');
}

// ---------------------------------------------------------------------------------------
// The ref-scoped context menu (W14) — one instance, shared by every branch/remote row (TagList
// opens its own for tag rows, since its rows are not in this file's own DOM).
// ---------------------------------------------------------------------------------------
const refMenu = ref<{ row: RefRow; x: number; y: number } | undefined>(undefined);
const renaming = ref<{ name: string; value: string } | undefined>(undefined);
const forceDeleteCandidate = ref<string | undefined>(undefined);

function openRefMenu(row: RefRow, event: MouseEvent): void {
  event.preventDefault();
  refMenu.value = { row, x: event.clientX, y: event.clientY };
}

function openRefMenuFromButton(row: RefRow, event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  refMenu.value = { row, x: rect.left, y: rect.bottom };
}

const refMenuSections = computed(() => {
  const entry = refMenu.value;
  if (!entry) return [];
  return buildRefMenu({
    kind: entry.row.kind,
    shortName: entry.row.shortName,
    isHead: entry.row.isHead,
    knownRemotes: entry.row.kind === 'tag' ? knownRemotes.value : [],
    inProgress: props.ops.statusSummary.value?.inProgress ?? null,
  });
});

async function onRefMenuSelect(id: string): Promise<void> {
  const entry = refMenu.value;
  refMenu.value = undefined;
  if (!entry) return;
  const { row } = entry;
  if (id === 'checkoutRef') {
    await (row.kind === 'remoteBranch' ? checkoutRemote(row) : checkoutBranch(row));
    return;
  }
  if (id === 'renameRef') {
    renaming.value = { name: row.shortName, value: row.shortName };
    return;
  }
  if (id === 'reviewBranch') {
    closeForCheckout();
    await props.ops.openReview(row.shortName);
    return;
  }
  if (id === 'deleteRef') {
    if (row.kind === 'tag') {
      await props.ops.tagDelete(row.shortName);
      return;
    }
    const result = await props.ops.branchDelete(row.shortName, false);
    if (!result.ok && result.error?.kind === 'NotFullyMerged') {
      forceDeleteCandidate.value = row.shortName;
    }
    return;
  }
  if (id.startsWith('pushRef:')) {
    await props.ops.tagPush(id.slice('pushRef:'.length), [row.shortName]);
    return;
  }
  if (id.startsWith('deleteRemoteRef:')) {
    await props.ops.tagDeleteRemote(id.slice('deleteRemoteRef:'.length), row.shortName);
  }
}

async function confirmForceDelete(): Promise<void> {
  const name = forceDeleteCandidate.value;
  forceDeleteCandidate.value = undefined;
  if (name !== undefined) await props.ops.branchDelete(name, true);
}

async function submitRename(): Promise<void> {
  const pending = renaming.value;
  renaming.value = undefined;
  if (!pending) return;
  const to = pending.value.trim();
  if (to === '' || to === pending.name) return;
  await props.ops.branchRename(pending.name, to);
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return;
  if (rootEl.value && event.target instanceof Node && rootEl.value.contains(event.target)) return;
  close();
}

watch(isOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onDocumentPointerDown);
  else document.removeEventListener('pointerdown', onDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
});
</script>

<template>
  <div ref="rootEl" class="kv-branch-picker" @keydown.escape="close">
    <!-- G21 D2: kept as a raw <button>, not <KuiButton> — `closeForCheckout()`'s own W20 fix below
         calls real `.focus()` on `triggerEl` before a dialog opens, and a `<script setup>`
         component's template ref does not forward to its root DOM node without exposing it, which
         `KuiButton` does not do. -->
    <button
      ref="triggerEl"
      type="button"
      class="kv-branch-trigger"
      aria-haspopup="true"
      :aria-expanded="isOpen"
      v-kui-tooltip="refs.head.value?.kind === 'detached' ? refs.head.value.sha : triggerLabel"
      @click="toggle"
    >
      <span class="codicon codicon-git-branch" aria-hidden="true"></span>
      <span class="kv-branch-trigger-label">{{ triggerLabel }}</span>
      <span class="codicon" :class="STATE_ICONS.chevronDown" aria-hidden="true"></span>
    </button>

    <KuiPopoverPanel v-if="isOpen" anchor="left" :width="320" @close="close">
    <div class="kv-branch-panel" role="dialog" aria-label="Branches and tags">
      <KuiSearchInput
        class="kv-branch-filter"
        v-model="filter"
        placeholder="Filter branches and tags"
        ariaLabel="Filter branches and tags"
      />

      <div class="kv-branch-panel-scroll">
        <div class="kv-branch-section" aria-label="Branches">
          <div class="kv-branch-section-title">Branches</div>
          <div
            v-for="row in sections.branches.visible"
            :key="row.refname"
            class="kv-branch-row"
            :class="{ 'kv-branch-row--current': row.isHead }"
          >
            <template v-if="renaming?.name === row.shortName">
              <input
                type="text"
                class="kv-branch-rename-input"
                v-model="renaming.value"
                autofocus
                @keydown.enter="submitRename"
                @keydown.escape="renaming = undefined"
              />
              <KuiButton class="kv-icon-button" @click="submitRename">
                <span class="codicon codicon-check" aria-hidden="true"></span>
              </KuiButton>
            </template>
            <template v-else>
              <KuiButton class="kv-branch-row-main" @click="checkoutBranch(row)">
                <span
                  class="kv-branch-current-dot"
                  :role="row.isHead ? 'img' : undefined"
                  :aria-label="row.isHead ? 'current branch' : undefined"
                  :aria-hidden="!row.isHead"
                  >{{ row.isHead ? "●" : "" }}</span
                >
                <span class="kv-branch-row-name">{{ row.shortName }}</span>
                <span v-if="row.checkedOutIn" class="kv-branch-badge" v-kui-tooltip="`Checked out in ${row.checkedOutIn}`">
                  worktree
                </span>
                <span v-if="formatTrack(row.track)" class="kv-branch-track">{{ formatTrack(row.track) }}</span>
              </KuiButton>
              <KuiButton
                class="kv-icon-button"
                v-kui-tooltip="'More actions'"
                aria-label="More actions"
                @click="openRefMenuFromButton(row, $event)"
                @contextmenu="openRefMenu(row, $event)"
              >
                <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
              </KuiButton>
            </template>
          </div>
          <div v-if="forceDeleteCandidate" class="kv-branch-force-delete">
            <span>“{{ forceDeleteCandidate }}” is not fully merged.</span>
            <KuiButton variant="danger" @click="confirmForceDelete">Force delete</KuiButton>
            <KuiButton @click="forceDeleteCandidate = undefined">Cancel</KuiButton>
          </div>
          <div v-if="sections.branches.hiddenCount > 0" class="kv-branch-more">
            {{ sections.branches.hiddenCount }} more — refine your filter
          </div>
          <div v-if="sections.branches.visible.length === 0" class="kv-branch-empty">No branches</div>
        </div>

        <div class="kv-branch-section" aria-label="Remote branches">
          <div class="kv-branch-section-title">Remote branches</div>
          <div v-for="row in sections.remoteBranches.visible" :key="row.refname" class="kv-branch-row">
            <KuiButton class="kv-branch-row-main" icon="codicon-cloud" @click="checkoutRemote(row)">
              <span class="kv-branch-row-name">{{ row.shortName }}</span>
              <span class="kv-branch-remote-action">{{ remoteCheckoutLabel(row, refs.branches.value) }}</span>
            </KuiButton>
            <KuiButton
              class="kv-icon-button"
              v-kui-tooltip="'More actions'"
              aria-label="More actions"
              @click="openRefMenuFromButton(row, $event)"
              @contextmenu="openRefMenu(row, $event)"
            >
              <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
            </KuiButton>
          </div>
          <div v-if="sections.remoteBranches.hiddenCount > 0" class="kv-branch-more">
            {{ sections.remoteBranches.hiddenCount }} more — refine your filter
          </div>
          <div v-if="sections.remoteBranches.visible.length === 0" class="kv-branch-empty">
            No remote branches
          </div>
        </div>

        <TagList
          :section="sections.tags"
          :ops="ops"
          :known-remotes="knownRemotes"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          @checked-out="close"
        />

        <StashList
          :stash="stash"
          :ops="ops"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          @branch-from-stash="(entry) => emit('branchFromStash', entry)"
        />
      </div>
    </div>
    </KuiPopoverPanel>

    <RowContextMenu
      v-if="refMenu"
      :sections="refMenuSections"
      :x="refMenu.x"
      :y="refMenu.y"
      :label="`${refMenu.row.shortName} actions`"
      @select="onRefMenuSelect"
      @close="refMenu = undefined"
    />
  </div>
</template>

<style>
.kv-branch-picker {
  position: relative;
}

.kv-branch-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--kv-space-2);
  height: 22px;
  padding: 0 var(--kv-space-2);
  border: none;
  border-radius: var(--kv-radius);
  background: transparent;
  color: var(--kv-app-fg);
  font-family: inherit;
  font-size: inherit;
  max-width: 200px;
  cursor: pointer;
}

.kv-branch-trigger:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-branch-trigger:focus-visible {
  outline: 1px solid var(--kv-focus-border);
  outline-offset: -1px;
}

.kv-branch-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* G20 D5: positioning (absolute/z-index/width) and chrome (background/border/shadow) move onto
   KuiPopoverPanel's own `.kui-popover` — this is now just the content's own internal layout. */
.kv-branch-panel {
  max-height: 420px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.kv-branch-filter {
  margin: var(--kv-space-2);
}

.kv-branch-panel-scroll {
  overflow-y: auto;
  min-height: 0;
}

.kv-branch-section-title {
  padding: var(--kv-space-1) var(--kv-space-3);
  font-size: 0.85em;
  font-weight: 600;
  color: var(--kv-description-fg);
}

.kv-branch-row {
  display: flex;
  align-items: center;
  gap: var(--kv-space-1);
  padding: 0 var(--kv-space-2);
}

.kv-branch-row--current {
  font-weight: 600;
}

.kv-branch-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--kv-space-2);
  padding: var(--kv-space-1) var(--kv-space-1);
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.kv-branch-row-main:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-branch-current-dot {
  width: 0.9em;
  color: var(--kv-focus-border);
}

.kv-branch-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-branch-badge {
  font-size: 0.8em;
  padding: 0 var(--kv-space-1);
  border: 1px dashed var(--kv-panel-border);
  border-radius: var(--kv-radius);
  color: var(--kv-description-fg);
}

.kv-branch-track {
  font-size: 0.85em;
  color: var(--kv-description-fg);
}

.kv-branch-remote-action {
  font-size: 0.85em;
  color: var(--kv-description-fg);
}

.kv-icon-button {
  background: transparent;
  border: none;
  color: var(--kv-app-fg);
  cursor: pointer;
  padding: var(--kv-space-1);
}

.kv-icon-button:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-branch-rename-input {
  flex: 1;
  padding: var(--kv-space-1);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-focus-border);
}

.kv-branch-more,
.kv-branch-empty {
  padding: var(--kv-space-1) var(--kv-space-3);
  color: var(--kv-description-fg);
  font-size: 0.85em;
}

.kv-branch-force-delete {
  display: flex;
  align-items: center;
  gap: var(--kv-space-2);
  padding: var(--kv-space-2) var(--kv-space-3);
  background: var(--kv-overlay-bg);
  font-size: 0.85em;
}
</style>
