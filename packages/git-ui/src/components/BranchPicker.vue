<script setup lang="ts">
/**
 * `docs/plans/P6.md` W13: §6.2's `[branch ▾]` toolbar slot. P77 redesigns it from seven stacked
 * sections in one scroll context into a five-tab structure — Branches (local + remote sub-group),
 * Tags, Stashes (stack + global-bucket sub-group), Worktrees, Stacks — over one `KuiSegmented`
 * strip (§3). `pickerModel.ts` owns the fold (filter/order/cap) for every tab; this file renders
 * the strip, the filter box and the active tab's body, and still owns every ref-scoped write this
 * file has always owned (checkout, rename, delete, the stack-navigation row-menu arms) — `TagList`/
 * `StashList`/`GlobalStashList`/`WorktreeList`/`StackList` render their own tab's rows from an
 * already filtered/ordered/capped prop, the same contract `TagList.vue` has had since P6.
 *
 * Every row also carries `RowContextMenu.vue`'s ref-scoped menu (W14: "every row also carries the
 * context menu W14 builds, which is where the destructive actions live") — a kebab button (mouse
 * *and* keyboard reachable) plus a plain right-click, both opening the same menu.
 */
import type { RefRow, StashEntry } from '@kira/git-ipc';
import type { KuiSegmentedOption } from '@kira/kira-ui';
// `KuiButton`/`KuiSegmented` are plain (not `import type`) imports even though this file's own
// script only ever reads `KuiButton` through `InstanceType<typeof KuiButton>` (the trigger's own
// ref type) — that is still a genuine *value* read (`typeof` on an identifier requires the runtime
// binding in scope), and the template's own `<KuiButton>`/`<KuiSegmented>` tags instantiate them as
// components; biome's own static analysis sees neither use and would otherwise "fix" this to
// `import type`, silently erasing the import (AppToolbar.vue's own `useImportType` biome-ignore
// precedent, for the same reason).
// biome-ignore lint/style/useImportType: see above
import {
  enabledNeighbour,
  firstEnabled,
  KuiButton,
  KuiPopoverPanel,
  KuiSearchInput,
  KuiSegmented,
  KuiTextInput,
  type MenuItem,
} from '@kira/kira-ui';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { PICKER_TAB_ICONS, STATE_ICONS } from '../icons/index.ts';
import type { OpsState } from '../state/ops.ts';
import type { PrState } from '../state/pr.ts';
import type { RefsState } from '../state/refs.ts';
import type { StackState } from '../state/stack.ts';
import type { StashState } from '../state/stash.ts';
import type { WorktreeCreateSeed, WorktreeState } from '../state/worktrees.ts';
import GlobalStashList from './GlobalStashList.vue';
import {
  buildPickerModel,
  type PickerInput,
  type PickerListKey,
  type PickerModel,
  type PickerTab,
} from './pickerModel.ts';
import RowContextMenu from './RowContextMenu.vue';
import {
  formatTrack,
  localNameForRemoteBranch,
  REF_LIST_SECTION_CAP,
  remoteCheckoutLabel,
  remoteCheckoutTarget,
} from './refListModel.ts';
import { buildReadOnlyRefMenu, buildRefMenu, remoteNamesFrom } from './rowMenuModel.ts';
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
  /** C10 §4.2/§4.3 (S6/S7): `false` under the native read-only graph — this picker's own ref menu
   *  falls back to `buildReadOnlyRefMenu`, and the flag threads on into every child tab
   *  (`TagList`/`StashList`/`GlobalStashList`/`WorktreeList`/`StackList`) that owns a write
   *  affordance of its own. */
  writeCapability: boolean;
  /** G24 D9's own branch-tip badge — optional so a caller with nothing to show yet gets a plain,
   *  badge-free picker (mirrors `CommitGrid.vue`'s own `pr` prop). */
  pr?: PrState;
  /** P74 §3.3: whether this host can open a URL in the external browser — gates this picker's own
   *  PR badge, and `StackList.vue`'s, on the same capability `CommitMeta.vue`'s PR row/icon gate
   *  on. `false` renders the number as plain, non-interactive text. */
  openExternalCapability: boolean;
  /** P74 §3.3: `AppToolbar.vue`'s own `openPullRequest` — threaded down rather than reimplemented
   *  here or in `StackList.vue`. */
  openPullRequest: (number: number) => void;
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
  /** P76 §9.3: widened to carry an optional seed — `undefined` from `WorktreeList.vue`'s own
   *  create button, a seed from this picker's own "Create worktree here…" row action. */
  (e: 'createWorktree', seed?: WorktreeCreateSeed): void;
  (e: 'openRestackDialog', branch: string): void;
  (e: 'openSetStackParentDialog', branch: string): void;
}>();

const TAB_LABELS: Readonly<Record<PickerTab, string>> = {
  branches: 'Branches',
  tags: 'Tags',
  stashes: 'Stashes',
  worktrees: 'Worktrees',
  stacks: 'Stacks',
};

const isOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
// G34 D5/D14: `KuiButton` now exposes `focus()` (the same escape hatch `KuiSearchInput` already
// has), so the trigger is a real `KuiButton` instead of the raw `<button>` this used to need.
const triggerEl = ref<InstanceType<typeof KuiButton> | null>(null);
const filterEl = ref<InstanceType<typeof KuiSearchInput> | null>(null);
const filter = ref('');
const activeTab = ref<PickerTab>('branches');
// P77 §7.3: the roving-tabindex list's own "current" row — `undefined` until the user presses an
// arrow key, at which point `activeRowId` below still resolves it (falls back to the first
// enabled row), so a fresh tab/query always has exactly one tabbable row.
const focusedRowId = ref<string | undefined>(undefined);
// P77 §6.3: one list's own step count for the current panel-open — reset on close and on a filter
// change (a new query is a new list, §6.3's own words), never persisted.
const capSteps = ref<Partial<Record<PickerListKey, number>>>({});

const triggerLabel = computed(() => {
  const head = props.refs.head.value;
  if (!head) return '…';
  if (head.kind === 'branch') return head.name;
  if (head.kind === 'unborn') return `${head.name} (unborn)`;
  return head.sha.slice(0, 7);
});

const pickerInput = computed<PickerInput>(() => ({
  branches: props.refs.branches.value,
  remoteBranches: props.refs.remoteBranches.value,
  tags: props.refs.tags.value,
  stashes: props.stash.entries.value,
  globalStashes: props.stash.globalEntries.value,
  worktrees: props.worktrees.entries.value,
  stacks: props.stack.stacks.value,
  orphans: props.stack.orphans.value,
}));

const model = computed(() =>
  buildPickerModel(pickerInput.value, filter.value, activeTab.value, capSteps.value),
);

/** P77 §6.3: "Show 50 more (150 remaining)" — raises one list's own cap by
 *  `REF_LIST_SECTION_CAP` for the current panel-open. Every tab-body button below calls this with
 *  its own `PickerListKey`; `StackList.vue`'s single button raises `'stacks'`, which
 *  `pickerModel.ts` already shares between its `stacks`/`orphans` lists. */
function showMore(key: PickerListKey): void {
  capSteps.value = {
    ...capSteps.value,
    [key]: (capSteps.value[key] ?? REF_LIST_SECTION_CAP) + REF_LIST_SECTION_CAP,
  };
}

watch(filter, () => {
  capSteps.value = {};
});

// ---------------------------------------------------------------------------------------
// §7.3: roving focus over the active tab's own rows, via `@kira/kira-ui`'s `enabledNeighbour`/
// `firstEnabled` — the same wrap-around neighbour walk `KuiMenuList` uses. Those take
// `MenuItem[]`; `model.rowIds` is the narrower `{id, disabled}[]` §9 already produces as a
// by-product, so `toMenuItems` pads it with the fields neither function actually reads.
// ---------------------------------------------------------------------------------------
function toMenuItems(rowIds: PickerModel['rowIds']): MenuItem[] {
  return rowIds.map((r) => ({
    id: r.id,
    label: '',
    disabled: r.disabled,
    disabledReason: undefined,
  }));
}

function lastEnabled(items: readonly MenuItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && !item.disabled) return item.id;
  }
  return undefined;
}

/** The row every tab's rows currently treat as "current" for `tabindex` purposes — resolves to
 *  the first enabled row whenever `focusedRowId` is unset or belongs to a row set the active tab/
 *  filter has since replaced (every row id is prefixed by kind, so a stale id from another tab can
 *  never collide with a real one in the new set — no explicit reset needed on tab/filter change). */
const activeRowId = computed<string | undefined>(() => {
  const items = toMenuItems(model.value.rowIds);
  if (focusedRowId.value !== undefined && items.some((item) => item.id === focusedRowId.value)) {
    return focusedRowId.value;
  }
  return firstEnabled(items);
});

async function focusRow(id: string | undefined): Promise<void> {
  if (id === undefined) return;
  await nextTick();
  rootEl.value?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)?.focus();
}

/** §7.2: `ArrowDown` from the filter box moves into the list — the same route
 *  `KuiSearchInput.vue`'s own forwarded `keydown` emit exists for. */
function onFilterKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown') return;
  const items = toMenuItems(model.value.rowIds);
  if (items.length === 0) return;
  event.preventDefault();
  focusedRowId.value = firstEnabled(items);
  void focusRow(focusedRowId.value);
}

/** §7.3: `ArrowDown`/`ArrowUp` step through the active tab's rows (`ArrowUp` from the first row
 *  returns to the filter); `Home`/`End` jump to the ends; `Enter` runs the focused row's own main
 *  action where it has one (`.kv-branch-row-main` is a `<button>` for branch/tag/stash rows and a
 *  plain, unclickable `<div>` for worktree/stack rows — one selector does both without a per-kind
 *  branch). `Tab` is left alone: it already reaches the row's own trailing buttons. */
function onRowsKeydown(event: KeyboardEvent): void {
  const rowEl = (event.target as HTMLElement).closest<HTMLElement>('.kv-branch-row[data-row-id]');
  if (rowEl === null) return;
  const items = toMenuItems(model.value.rowIds);
  const currentId = rowEl.dataset.rowId;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusedRowId.value = enabledNeighbour(items, currentId, 1);
      void focusRow(focusedRowId.value);
      return;
    case 'ArrowUp':
      event.preventDefault();
      if (currentId === firstEnabled(items)) {
        filterEl.value?.focus();
        return;
      }
      focusedRowId.value = enabledNeighbour(items, currentId, -1);
      void focusRow(focusedRowId.value);
      return;
    case 'Home':
      event.preventDefault();
      focusedRowId.value = firstEnabled(items);
      void focusRow(focusedRowId.value);
      return;
    case 'End':
      event.preventDefault();
      focusedRowId.value = lastEnabled(items);
      void focusRow(focusedRowId.value);
      return;
    case 'Enter':
      rowEl.querySelector<HTMLElement>('.kv-branch-row-main')?.click();
      return;
    default:
      return;
  }
}

const tabOptions = computed<readonly KuiSegmentedOption[]>(() => [
  {
    id: 'branches',
    icon: PICKER_TAB_ICONS.branches,
    label: 'Branches',
    badge: model.value.counts.branches,
  },
  { id: 'tags', icon: PICKER_TAB_ICONS.tags, label: 'Tags', badge: model.value.counts.tags },
  {
    id: 'stashes',
    icon: PICKER_TAB_ICONS.stashes,
    label: 'Stashes',
    badge: model.value.counts.stashes,
  },
  {
    id: 'worktrees',
    icon: PICKER_TAB_ICONS.worktrees,
    label: 'Worktrees',
    badge: model.value.counts.worktrees,
  },
  {
    id: 'stacks',
    icon: PICKER_TAB_ICONS.stacks,
    label: 'Stacks',
    badge: model.value.counts.stacks,
  },
]);

const knownRemotes = computed(() =>
  remoteNamesFrom(props.refs.remoteBranches.value.map((row) => row.shortName)),
);

function close(): void {
  isOpen.value = false;
  refMenu.value = undefined;
  renaming.value = undefined;
  forceDeleteCandidate.value = undefined;
  filter.value = '';
  capSteps.value = {};
}

function toggle(): void {
  isOpen.value = !isOpen.value;
  if (!isOpen.value) close();
}

// G10 D17/P77 §13: forwarded so App.vue's palette dispatcher can open this panel exactly the way
// clicking its own trigger does — the picker is the only place the UI names a ref/stash/worktree/
// stack to act on, so every such palette command reaches one of `openBranchPicker`/`openTagPicker`/
// `openStashPicker`/`openWorktreePicker`/`openStackPicker`. `tab` is optional so the click-trigger
// path (which always wants whatever tab was last open) is unchanged.
function open(tab?: PickerTab): void {
  if (tab !== undefined) activeTab.value = tab;
  isOpen.value = true;
  // §7.2: both entry points (this picker's own trigger click and `runUiAction`'s palette route,
  // §13) go through `open()`, so the filter is focused on the next tick either way.
  void nextTick(() => filterEl.value?.focus());
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

// C12-6: this is the row's own MAIN click handler, unlike every other write-capable affordance
// in this file (the ref-scoped context menu, gated by `refMenuSections` falling back to
// `buildReadOnlyRefMenu` above) — nothing upstream of this function stops it from running under
// `writeCapability: false`. Before this guard, clicking a branch row on the native read-only graph
// issued `preflight.checkout`, which `gitstream.go`'s allowlist correctly refuses with
// `E_READ_ONLY` — but `OpsState.runCheckout`'s own `try/finally` has no `catch`, so the rejection
// surfaced as an unhandled promise rejection and the row looked like a dead, broken click.
async function checkoutBranch(row: RefRow): Promise<void> {
  if (!props.writeCapability) return;
  closeForCheckout();
  await props.ops.runCheckout(row.shortName, 'switch');
}

async function checkoutRemote(row: RefRow): Promise<void> {
  if (!props.writeCapability) return;
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
  if (!props.writeCapability) return buildReadOnlyRefMenu();
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
  if (id === 'createWorktreeHere') {
    // P76 §9.1: same derivation as `checkoutRemote`'s own DWIM — a remote-tracking branch's local
    // name may not exist yet, so that arm creates it as a new branch rather than passing it as an
    // already-existing one.
    emit(
      'createWorktree',
      row.kind === 'remoteBranch'
        ? {
            mode: 'newBranch',
            branch: localNameForRemoteBranch(row.shortName),
            startPoint: row.shortName,
          }
        : { mode: 'existingBranch', branch: row.shortName },
    );
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
// all — warms every visible branch's own PR record in one go. G32 round-3 performance review,
// finding #3: "visible" used to mean the repo's FULL branch list, not what `model` (above) actually
// renders — `branch.resolvePr` answers a branch WITH an open PR from its already-cached bulk
// snapshot at no extra cost (D6), but one WITHOUT falls through to its own per-branch `gh api`
// call, so a repo with hundreds of branches fanned out hundreds of `gh` spawns from one picker
// open, easily arming GitHub's rate-limit breaker. Scoped to the Branches tab's own visible rows
// (each capped at `REF_LIST_SECTION_CAP`) and keyed off that computed itself, not just `isOpen`, so
// typing a filter that surfaces a branch outside the initial page still gets it warmed. P77: a
// picker opened on a non-Branches tab now warms nothing at all, since `model.branchesLocal`/
// `branchesRemote` are only ever materialised for the active tab (§8's own closing note).
const visibleBranchNames = computed<readonly string[]>(() => {
  if (!isOpen.value) return [];
  return [
    ...model.value.branchesLocal.visible.map((r) => r.shortName),
    ...model.value.branchesRemote.visible.map((r) => r.shortName),
  ];
});
watch(visibleBranchNames, (names) => {
  if (names.length === 0 || !props.pr) return;
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

    <KuiPopoverPanel v-if="isOpen" anchor="left" :width="380" @close="close">
    <div class="kv-branch-panel" role="dialog" :aria-label="`${TAB_LABELS[activeTab]} picker`">
      <KuiSegmented
        class="kv-branch-tabs"
        :options="tabOptions"
        :model-value="activeTab"
        ariaLabel="Picker section"
        @update:model-value="(id) => (activeTab = id as PickerTab)"
      />
      <KuiSearchInput
        ref="filterEl"
        class="kv-branch-filter"
        v-model="filter"
        :placeholder="`Filter ${TAB_LABELS[activeTab].toLowerCase()}`"
        :ariaLabel="`Filter ${TAB_LABELS[activeTab].toLowerCase()}`"
        @keydown="onFilterKeydown"
      />

      <div
        class="kv-branch-panel-scroll"
        :aria-label="TAB_LABELS[activeTab]"
        @keydown="onRowsKeydown"
      >
        <template v-if="activeTab === 'branches'">
        <div class="kv-branch-section" aria-label="Branches">
          <div class="kv-branch-section-title">Branches</div>
          <div
            v-for="row in model.branchesLocal.visible"
            :key="row.refname"
            class="kv-branch-row"
            :class="{ 'kv-branch-row--current': row.isHead }"
            :data-row-id="`branch:${row.refname}`"
            :tabindex="activeRowId === `branch:${row.refname}` ? 0 : -1"
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
                <button
                  v-if="prFor(row.shortName) && openExternalCapability"
                  type="button"
                  class="kv-badge kv-badge-pill kv-badge-pr"
                  :class="`kv-badge-pr--${prFor(row.shortName)!.state}`"
                  v-kui-tooltip="prTooltip(row.shortName)"
                  @click.stop="openPullRequest(prFor(row.shortName)!.number)"
                >#{{ prFor(row.shortName)!.number }}</button>
                <span
                  v-else-if="prFor(row.shortName)"
                  class="kv-badge kv-badge-pill kv-badge-pr"
                  :class="`kv-badge-pr--${prFor(row.shortName)!.state}`"
                  v-kui-tooltip="prTooltip(row.shortName)"
                  >#{{ prFor(row.shortName)!.number }}</span
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
          <KuiButton
            v-if="model.branchesLocal.hiddenCount > 0"
            class="kv-branch-more-button"
            @click="showMore('branchesLocal')"
          >
            Show {{ Math.min(REF_LIST_SECTION_CAP, model.branchesLocal.hiddenCount) }} more
            ({{ model.branchesLocal.hiddenCount }} remaining)
          </KuiButton>
          <div v-if="model.branchesLocal.visible.length === 0" class="kv-branch-empty">No branches</div>
        </div>

        <div class="kv-branch-section" aria-label="Remote branches">
          <div class="kv-branch-section-title">Remote branches</div>
          <div
            v-for="row in model.branchesRemote.visible"
            :key="row.refname"
            class="kv-branch-row"
            :data-row-id="`remote:${row.refname}`"
            :tabindex="activeRowId === `remote:${row.refname}` ? 0 : -1"
          >
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
          <KuiButton
            v-if="model.branchesRemote.hiddenCount > 0"
            class="kv-branch-more-button"
            @click="showMore('branchesRemote')"
          >
            Show {{ Math.min(REF_LIST_SECTION_CAP, model.branchesRemote.hiddenCount) }} more
            ({{ model.branchesRemote.hiddenCount }} remaining)
          </KuiButton>
          <div v-if="model.branchesRemote.visible.length === 0" class="kv-branch-empty">
            No remote branches
          </div>
        </div>
        </template>

        <TagList
          v-else-if="activeTab === 'tags'"
          :section="model.tags"
          :ops="ops"
          :known-remotes="knownRemotes"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          :write-capability="writeCapability"
          :show-more="() => showMore('tags')"
          :focused-row-id="activeRowId"
          @checked-out="close"
        />

        <template v-else-if="activeTab === 'stashes'">
        <StashList
          :section="model.stashStack"
          :stash="stash"
          :ops="ops"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          :current-branch="refs.currentBranchName.value ?? null"
          :write-capability="writeCapability"
          :show-more="() => showMore('stashStack')"
          :focused-row-id="activeRowId"
          @branch-from-stash="(entry) => emit('branchFromStash', entry)"
          @save-entry-to-global-stash="(entry) => emit('saveEntryToGlobalStash', entry)"
          @selected="closeForCheckout"
        />

        <GlobalStashList
          :section="model.stashGlobal"
          :stash="stash"
          :ops="ops"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          :current-branch="refs.currentBranchName.value ?? null"
          :write-capability="writeCapability"
          :show-more="() => showMore('stashGlobal')"
          :focused-row-id="activeRowId"
          @branch-from-stash="(entry) => emit('branchFromStash', entry)"
          @save-global-stash="emit('saveGlobalStash')"
          @selected="closeForCheckout"
        />
        </template>

        <WorktreeList
          v-else-if="activeTab === 'worktrees'"
          :section="model.worktrees"
          :worktrees="worktrees"
          :ops="ops"
          :open-worktree-window-capability="openWorktreeWindowCapability"
          :write-capability="writeCapability"
          :show-more="() => showMore('worktrees')"
          :focused-row-id="activeRowId"
          @switch-worktree="(path) => emit('switchWorktree', path)"
          @open-worktree-window="(path) => emit('openWorktreeWindow', path)"
          @create-worktree="emit('createWorktree')"
        />

        <StackList
          v-else-if="activeTab === 'stacks'"
          :stacks="model.stacks"
          :orphans="model.orphans"
          :ops="ops"
          :pr="pr"
          :write-capability="writeCapability"
          :open-external-capability="openExternalCapability"
          :open-pull-request="openPullRequest"
          :show-more="() => showMore('stacks')"
          :focused-row-id="activeRowId"
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
   KuiPopoverPanel's own `.kui-popover` — this is now just the content's own internal layout.
   P77 §12: the two `--kui-float-max-*` vars are `floatingPosition.ts`'s own opt-in size cap
   (written by `size()` on every `KuiPopoverPanel`, read by nobody until now) — this is what makes
   the wider 380px panel (`:width` above) safe inside a narrow VS Code webview: `shift()` already
   keeps the surface inside the viewport, and this cap keeps its *content* from overflowing when
   the panel is genuinely wider than the space. */
.kv-branch-panel {
  max-height: min(520px, var(--kui-float-max-h, 520px));
  max-width: var(--kui-float-max-w, 380px);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.kv-branch-tabs {
  margin: var(--kv-s-2) var(--kv-s-2) 0;
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

.kv-branch-empty {
  padding: var(--kv-s-1) var(--kv-s-4);
  color: var(--kv-description-fg);
  font-size: 0.85em;
}

/* P77 §6.3: the cap's own step button — a plain-text-shaped `KuiButton` so it reads as the same
   "N more" line the static div used to be, but is actually clickable. */
.kv-branch-more-button {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--kv-s-1) var(--kv-s-4);
  color: var(--kv-description-fg);
  font-size: 0.85em;
  background: none;
  border: none;
}

.kv-branch-more-button:hover {
  color: var(--kv-app-fg);
  text-decoration: underline;
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
