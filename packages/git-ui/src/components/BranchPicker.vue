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
// `KuiButton` is a plain (not `import type`) import even though this file's own script only ever
// reads it through `InstanceType<typeof KuiButton>` (the trigger's own ref type) — that is still a
// genuine *value* read (`typeof` on an identifier requires the runtime binding in scope), and the
// template's own `<KuiButton>` tags instantiate it as a component; biome's own static analysis
// sees neither use and would otherwise "fix" this to `import type`, silently erasing the import
// (AppToolbar.vue's own `useImportType` biome-ignore precedent, for the same reason).
// biome-ignore lint/style/useImportType: see above
import { KuiButton, KuiPopoverPanel, KuiSearchInput, KuiTextInput } from '@kira/kira-ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { STATE_ICONS } from '../icons/index.ts';
import type { OpsState } from '../state/ops.ts';
import type { PrState } from '../state/pr.ts';
import type { RefsState } from '../state/refs.ts';
import type { StackState } from '../state/stack.ts';
import type { StashState } from '../state/stash.ts';
import type { WorktreeState } from '../state/worktrees.ts';
import GlobalStashList from './GlobalStashList.vue';
import RowContextMenu from './RowContextMenu.vue';
import {
  buildRefListSections,
  formatTrack,
  remoteCheckoutLabel,
  remoteCheckoutTarget,
} from './refListModel.ts';
import { buildRefMenu, remoteNamesFrom } from './rowMenuModel.ts';
import StackList from './StackList.vue';
import StashList from './StashList.vue';
import { childOf, parentOf } from './stackListModel.ts';
import TagList from './TagList.vue';
import WorktreeList from './WorktreeList.vue';

const props = defineProps<{
  refs: RefsState;
  ops: OpsState;
  stash: StashState;
  worktrees: WorktreeState;
  /** G26 D3 — see `StackList.vue`'s own doc comment. */
  stack: StackState;
  /** G25 D6/D14 — see `WorktreeList.vue`'s own doc comment. */
  openWorktreeWindowCapability: boolean;
  /** G24 D9's own branch-tip badge — optional so a caller with nothing to show yet gets a plain,
   *  badge-free picker (mirrors `CommitGrid.vue`'s own `pr` prop). */
  pr?: PrState;
}>();

const PR_STATE_LABEL: Readonly<Record<string, string>> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

/** The one PR record known for a branch's own short name, or `undefined` — same "render nothing"
 *  rule every other G24 surface follows. */
function prFor(
  shortName: string,
): { number: number; url: string; title: string; state: string } | undefined {
  return props.pr?.byBranch.value.get(shortName);
}

function prTooltip(shortName: string): string {
  const pr = prFor(shortName);
  if (!pr) return '';
  return `${pr.title} — ${PR_STATE_LABEL[pr.state] ?? pr.state}`;
}

/** OQ3: bubbled straight through from `StashList.vue`'s own emit — see that component's own doc
 *  comment on why the branch-mode dialog itself is owned by `App.vue`, not here. */
const emit = defineEmits<{
  (e: 'branchFromStash', entry: StashEntry): void;
  /** G28 D13: bubbled to `App.vue`, which owns `StashDialog.vue`'s save-to-global-stash mode —
   *  same "this component has nowhere of its own to render a dialog into" shape
   *  `branchFromStash` already follows. */
  (e: 'saveGlobalStash'): void;
  /** G28 D13: the same save mode, opened with THIS entry pre-selected as its source
   *  (`StashList.vue`'s own "Save to global stash…" row action). */
  (e: 'saveEntryToGlobalStash', entry: StashEntry): void;
  (e: 'switchWorktree', path: string): void;
  (e: 'openWorktreeWindow', path: string): void;
  (e: 'createWorktree'): void;
  (e: 'openRestackDialog', branch: string): void;
  (e: 'openSetStackParentDialog', branch: string): void;
}>();

const isOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
// G34 D5/D14: `KuiButton` now exposes `focus()` (the same escape hatch `KuiSearchInput` already
// has), so the trigger is a real `KuiButton` instead of the raw `<button>` this used to need.
const triggerEl = ref<InstanceType<typeof KuiButton> | null>(null);
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
  // G26 D-4.14: the stack section is present only for a local branch row — a tag/remoteBranch is
  // never a stack member (buildRefMenu itself already returns before reading `stack` for those
  // two kinds, but computing it only for `branch` here keeps `parentOf`/`childOf` from ever
  // running against a row that could not possibly answer anything).
  const stackResult = { stacks: props.stack.stacks.value, orphans: props.stack.orphans.value };
  return buildRefMenu({
    kind: entry.row.kind,
    shortName: entry.row.shortName,
    isHead: entry.row.isHead,
    knownRemotes: entry.row.kind === 'tag' ? knownRemotes.value : [],
    inProgress: props.ops.statusSummary.value?.inProgress ?? null,
    stack:
      entry.row.kind === 'branch'
        ? {
            hasParent: parentOf(stackResult, entry.row.shortName) !== undefined,
            hasChild: childOf(stackResult, entry.row.shortName) !== undefined,
          }
        : undefined,
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
    return;
  }
  // G26 D-4.14: the stack section's own five items — 'stackSetParent'/'stackRestack' emit intents
  // (BranchPicker owns no dialog of its own, mirroring 'createWorktree'); 'stackRemove' is a
  // direct, undoable write (StackList.vue's own row action makes the identical call); the two
  // navigation items resolve a target via stackListModel and call the existing checkout op,
  // exactly the shape 'checkoutStackParent'/'checkoutStackChild' establish for the palette too.
  const stackResult = { stacks: props.stack.stacks.value, orphans: props.stack.orphans.value };
  if (id === 'stackSetParent') {
    emit('openSetStackParentDialog', row.shortName);
    return;
  }
  if (id === 'stackRemove') {
    await props.ops.runStackSet(row.shortName, undefined);
    return;
  }
  if (id === 'stackRestack') {
    emit('openRestackDialog', row.shortName);
    return;
  }
  if (id === 'stackGoToParent') {
    const parent = parentOf(stackResult, row.shortName);
    if (parent !== undefined) {
      closeForCheckout();
      await props.ops.runCheckout(parent, 'switch');
    }
    return;
  }
  if (id === 'stackGoToChild') {
    const child = childOf(stackResult, row.shortName);
    if (child !== undefined) {
      closeForCheckout();
      await props.ops.runCheckout(child, 'switch');
    }
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

// G24 D7 point 4: opening the picker is one of the few user acts allowed to touch the network at
// all — warms every visible branch's own PR record in one go (the server answers each from its
// already-cached snapshot, D6, at no additional GitHub cost).
watch(isOpen, (open) => {
  if (!open || !props.pr) return;
  const names = [
    ...props.refs.branches.value.map((r) => r.shortName),
    ...props.refs.remoteBranches.value.map((r) => r.shortName),
  ];
  void props.pr.ensureSnapshot(names);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
});
</script>

<template>
  <div ref="rootEl" class="kv-branch-picker" @keydown.escape="close">
    <!-- G34 D5/D14: a real `KuiButton` — `closeForCheckout()`'s own W20 fix below calls real
         `.focus()` on `triggerEl` before a dialog opens, and `KuiButton` now exposes that. -->
    <KuiButton
      ref="triggerEl"
      class="kv-branch-trigger"
      aria-haspopup="true"
      :aria-expanded="isOpen"
      v-kui-tooltip="refs.head.value?.kind === 'detached' ? refs.head.value.sha : triggerLabel"
      @click="toggle"
    >
      <span class="codicon codicon-git-branch" aria-hidden="true"></span>
      <span class="kv-branch-trigger-label">{{ triggerLabel }}</span>
      <span class="codicon" :class="STATE_ICONS.chevronDown" aria-hidden="true"></span>
    </KuiButton>

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
              <KuiTextInput
                class="kv-branch-rename-input"
                v-model="renaming.value"
                autofocus
                ariaLabel="Rename branch"
                @keydown.enter="submitRename"
                @keydown.escape="renaming = undefined"
              />
              <KuiButton variant="icon" @click="submitRename">
                <span class="codicon codicon-check" aria-hidden="true"></span>
              </KuiButton>
            </template>
            <template v-else>
              <KuiButton class="kui-row kv-branch-row-main" @click="checkoutBranch(row)">
                <span
                  class="kv-branch-current-dot"
                  :role="row.isHead ? 'img' : undefined"
                  :aria-label="row.isHead ? 'current branch' : undefined"
                  :aria-hidden="!row.isHead"
                  >{{ row.isHead ? "●" : "" }}</span
                >
                <span class="kv-branch-row-name">{{ row.shortName }}</span>
                <a
                  v-if="prFor(row.shortName)"
                  :href="prFor(row.shortName)!.url"
                  class="kv-badge kv-badge-pill kv-badge-pr"
                  :class="`kv-badge-pr--${prFor(row.shortName)!.state}`"
                  v-kui-tooltip="prTooltip(row.shortName)"
                  @click.stop
                  >#{{ prFor(row.shortName)!.number }}</a
                >
                <span v-if="row.checkedOutIn" class="kv-branch-badge" v-kui-tooltip="`Checked out in ${row.checkedOutIn}`">
                  worktree
                </span>
                <span v-if="formatTrack(row.track)" class="kv-branch-track">{{ formatTrack(row.track) }}</span>
              </KuiButton>
              <KuiButton
                variant="icon"
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
            <KuiButton class="kui-row kv-branch-row-main" icon="codicon-cloud" @click="checkoutRemote(row)">
              <span class="kv-branch-row-name">{{ row.shortName }}</span>
              <span class="kv-branch-remote-action">{{ remoteCheckoutLabel(row, refs.branches.value) }}</span>
            </KuiButton>
            <KuiButton
              variant="icon"
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
          :current-branch="refs.currentBranchName.value ?? null"
          @branch-from-stash="(entry) => emit('branchFromStash', entry)"
          @save-entry-to-global-stash="(entry) => emit('saveEntryToGlobalStash', entry)"
        />

        <GlobalStashList
          :stash="stash"
          :ops="ops"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          :current-branch="refs.currentBranchName.value ?? null"
          @branch-from-stash="(entry) => emit('branchFromStash', entry)"
          @save-global-stash="emit('saveGlobalStash')"
        />

        <WorktreeList
          :worktrees="worktrees"
          :ops="ops"
          :open-worktree-window-capability="openWorktreeWindowCapability"
          @switch-worktree="(path) => emit('switchWorktree', path)"
          @open-worktree-window="(path) => emit('openWorktreeWindow', path)"
          @create-worktree="emit('createWorktree')"
        />

        <StackList
          :stack="stack"
          :ops="ops"
          :pr="pr"
          @open-restack-dialog="(branch) => emit('openRestackDialog', branch)"
          @open-set-parent-dialog="(branch) => emit('openSetStackParentDialog', branch)"
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

/* G34 D14: everything but `max-width` is gone — the default `KuiButton` box is now this exact
   shape (the raw `<button>` this class used to style became a real `KuiButton`, D5). */
.kv-branch-trigger {
  max-width: 200px;
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
  margin: var(--kv-s-2);
}

.kv-branch-panel-scroll {
  overflow-y: auto;
  min-height: 0;
}

/* G34 D14: takes `.kui-menu-heading`'s own treatment (kira-ui/theme/controls.css) — the same
   section-label look every menu in the app now uses. */
.kv-branch-section-title {
  display: flex;
  align-items: center;
  height: var(--kv-control-h-sm);
  padding: 0 var(--kv-s-4);
  font-size: var(--kv-t-xs);
  font-weight: 600;
  color: var(--kv-description-fg);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.kv-branch-row {
  display: flex;
  align-items: center;
  gap: var(--kv-s-1);
  padding: 0 var(--kv-s-2);
}

.kv-branch-row--current {
  font-weight: 600;
}

/* G34 D7: geometry now comes from `.kui-row` (composed in the template, `.kui-button.kui-row`'s
   own `height: auto` override in kira-ui/theme/controls.css cancels `.kui-button`'s fixed height
   so `.kui-row`'s `min-height` actually governs) — this class keeps only what's specific to this
   row inside `.kv-branch-row`'s own flex layout. */
.kv-branch-row-main {
  flex: 1;
  min-width: 0;
  text-align: left;
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
  padding: 0 var(--kv-s-1);
  border: 1px dashed var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
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

/* G34 D14: `.kv-icon-button` (this component's own global rule, also consumed by seven other
   components) is gone — `variant="icon"` is now the shared shape every one of those adopts. */

/* G34 D14: only the growable width survives — `.kui-text-input`'s own chrome (background/border/
   padding/radius) replaces the rest now that this is a real `KuiTextInput`. */
.kv-branch-rename-input {
  flex: 1;
}

.kv-branch-more,
.kv-branch-empty {
  padding: var(--kv-s-1) var(--kv-s-4);
  color: var(--kv-description-fg);
  font-size: 0.85em;
}

.kv-branch-force-delete {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  padding: var(--kv-s-2) var(--kv-s-4);
  background: var(--kv-overlay-bg);
  font-size: 0.85em;
}
</style>
