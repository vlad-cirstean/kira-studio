<script setup lang="ts">
/**
 * `docs/plans/P6.md` W13: §6.2's `[branch ▾]` toolbar slot. P77 redesigns it from seven stacked
 * sections in one scroll context into a five-tab structure — Branches (local + remote sub-group),
 * Tags, Stashes (stack + global-bucket sub-group), Worktrees, Stacks — over one `ToggleGroup`
 * strip (§3, `type="single"`, P131 Part 2). `pickerModel.ts` owns the fold (filter/order/cap) for
 * every tab; this file renders
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
import CodiconIcon from '@theme/CodiconIcon.vue';
import AttributeTooltip from '@theme/components/AttributeTooltip.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { cn } from '@theme/lib/utils';
import { useEventListener } from '@vueuse/core';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { codiconName, PICKER_TAB_ICONS, STATE_ICONS } from '../icons/index.ts';
import { enabledNeighbour, firstEnabled, type MenuItem } from '../lib/menuModel.ts';
import { rowVariants } from '../lib/rowVariants.ts';
import type { OpsState } from '../state/ops.ts';
import type { PrState } from '../state/pr.ts';
import type { RefsState } from '../state/refs.ts';
import type { StackState } from '../state/stack.ts';
import type { StashState } from '../state/stash.ts';
import type { WorktreeCreateSeed, WorktreeState } from '../state/worktrees.ts';
import { prBadgeClass } from './badgeClass.ts';
import GlobalStashList from './GlobalStashList.vue';
import {
  filterPickerInput,
  orderAndCapTab,
  type PickerInput,
  type PickerListKey,
  type PickerModel,
  type PickerTab,
} from './pickerModel.ts';
import RefSectionHeader from './RefSectionHeader.vue';
import RowActionsButton from './RowActionsButton.vue';
import RowContextMenu from './RowContextMenu.vue';
import {
  formatTrack,
  localNameForRemoteBranch,
  REF_LIST_SECTION_CAP,
  remoteCheckoutLabel,
  remoteCheckoutTarget,
} from './refListModel.ts';
import { buildRefMenu, remoteNamesFrom } from './rowMenuModel.ts';
import ShowMoreButton from './ShowMoreButton.vue';
import StackList from './StackList.vue';
import StashList from './StashList.vue';
import { childOf, parentOf } from './stackListModel.ts';
import TagList from './TagList.vue';
import { useRowMenu } from './useRowMenu.ts';
import WorktreeList from './WorktreeList.vue';

const props = defineProps<{
  refs: RefsState;
  ops: OpsState;
  stash: StashState;
  worktrees: WorktreeState;
  /** G26 D3 — see `StackList.vue`'s own doc comment. */
  stack: StackState;
  /** G24 D9's own branch-tip badge — optional so a caller with nothing to show yet gets a plain,
   *  badge-free picker (mirrors `CommitGrid.vue`'s own `pr` prop). */
  pr?: PrState;
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
const triggerEl = useTemplateRef<{ $el: HTMLElement }>('triggerEl');
const panelEl = ref<HTMLElement | null>(null);
const filterEl = useTemplateRef<{ $el: HTMLElement }>('filterEl');
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

// P79: split into two computeds so a tab switch or "show more" click (only ever changing
// `activeTab`/`capSteps`) never re-runs the expensive filter fold over every list —
// `filteredPicker` depends only on `(pickerInput, filter)`, `model` only adds the cheap per-tab
// ordering/cap pass on top. See `pickerModel.ts`'s own doc comment on `filterPickerInput`.
const filteredPicker = computed(() => filterPickerInput(pickerInput.value, filter.value));
const model = computed(() => orderAndCapTab(filteredPicker.value, activeTab.value, capSteps.value));

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
// §7.3: roving focus over the active tab's own rows, via this package's own `lib/menuModel.ts`
// `enabledNeighbour`/`firstEnabled` — the same wrap-around neighbour walk kira-ui's own
// (now-deleted) KuiMenuList used. Those take `MenuItem[]`; `model.rowIds` is the narrower
// `{id, disabled}[]` §9 already produces as a by-product, so `toMenuItems` pads it with the
// fields neither function actually reads.
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
  panelEl.value?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)?.focus();
}

/** §7.2: `ArrowDown` from the filter box moves into the list — bound directly on
 *  `InputGroupInput`'s own `@keydown`, which falls through to the real `<input>`. */
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
 *  branch). `Tab` is left alone: it already reaches the row's own trailing buttons.
 *
 *  P110 A18: `.kv-branch-row`/`.kv-branch-row-main` carry no CSS any more (every row's own styling
 *  moved to utilities, here and in TagList/StashRows/WorktreeList/StackList) — both class
 *  names stay as bare query-selector hooks for `closest()`/`querySelector()` below, the same
 *  "functional, not stylistic" reason `.kv-branch-rename-input` (line ~636) stays a literal class
 *  for its own `querySelector(...).focus()` call. */
const rowsScrollEl = ref<HTMLElement | null>(null);
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
        filterEl.value?.$el.focus();
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
      // Only the row itself: Enter on an inner button (actions, PR badge, main) activates natively.
      if (event.target !== rowEl) return;
      event.preventDefault();
      rowEl.querySelector<HTMLElement>('.kv-branch-row-main')?.click();
      return;
    default:
      return;
  }
}

// P105 §5.1: the row-scroll div carries no interactive role of its own -- binds via VueUse
// instead of a raw @keydown on it.
useEventListener(rowsScrollEl, 'keydown', onRowsKeydown);

// P131 Part 2 §5.2: KuiSegmentedOption goes with KuiSegmented -- this is the same shape, inlined
// as a local type instead of importing one from kira-ui.
interface PickerTabOption {
  readonly id: PickerTab;
  readonly icon: string;
  readonly label: string;
  readonly badge: number;
}

const tabOptions = computed<readonly PickerTabOption[]>(() => [
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

// P131 Part 2 §5.2: reka's own PopoverContent Escape/outside-click dismissal replaces the
// rootEl keydown listener and onClickOutside call this file used to own -- close()'s resets
// (refMenu, renaming, forceDeleteCandidate, filter, capSteps) now run from the Popover's own
// @update:open(false), reached either way (trigger click, Escape, outside click, or this file's
// own explicit close() calls below).
function close(): void {
  isOpen.value = false;
  refMenu.value = undefined;
  renaming.value = undefined;
  forceDeleteCandidate.value = undefined;
  filter.value = '';
  capSteps.value = {};
}

// G10 D17/P77 §13: forwarded so App.vue's palette dispatcher can open this panel exactly the way
// clicking its own trigger does — the picker is the only place the UI names a ref/stash/worktree/
// stack to act on, so every such palette command reaches one of `openBranchPicker`/`openTagPicker`/
// `openStashPicker`/`openWorktreePicker`/`openStackPicker`. `tab` is optional so the click-trigger
// path (which always wants whatever tab was last open) is unchanged.
function open(tab?: PickerTab): void {
  if (tab !== undefined) activeTab.value = tab;
  isOpen.value = true;
}
defineExpose({ open });

/** The Popover's own `@update:open` -- fired for every dismissal (trigger click, Escape, outside
 *  click) and every trigger-click open. `true` just tracks the boolean (the palette route's own
 *  `open()` already set it directly); the filter-focus-on-open side effect lives in
 *  `onOpenAutoFocus` below, so it fires for both routes alike, P77 §7.2's own requirement. */
function onOpenChange(value: boolean): void {
  if (value) isOpen.value = true;
  else close();
}

/** §7.2: "filter focused on open" for both the click-trigger and palette (`open()`) routes --
 *  `preventDefault()` skips reka's own default (the panel's first focusable element) so the
 *  filter input wins regardless of where it sits in the panel. */
function onOpenAutoFocus(e: Event): void {
  e.preventDefault();
  filterEl.value?.$el.focus();
}

/** W20: reka's own close-auto-focus fires after the panel's exit animation, which could steal
 *  focus back from a dialog `runCheckout` opens in the meantime (`closeForCheckout` below already
 *  moves focus to the trigger synchronously, before that animation even starts). Suppressed for
 *  exactly that one call, not for every close. */
let suppressCloseAutoFocus = false;
function onCloseAutoFocus(e: Event): void {
  if (!suppressCloseAutoFocus) return;
  e.preventDefault();
  suppressCloseAutoFocus = false;
}

/** W20: `close()` unmounts the whole panel, including whatever row button the click just
 *  focused — by the time `runCheckout` might open `CheckoutDialog.vue`, that button is gone and
 *  a dialog's own focus-return capture would land on nothing (the browser's own fallback,
 *  `<body>`). Moving focus to the trigger *first*, synchronously — a stable control that survives
 *  the panel's own close — gives that capture something real to return to. `suppressCloseAutoFocus`
 *  stops reka's own close-auto-focus (which fires after the exit animation) from firing later and
 *  stealing focus back from whatever dialog `runCheckout` opened in the meantime. */
function closeForCheckout(): void {
  triggerEl.value?.$el.focus();
  suppressCloseAutoFocus = true;
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
const { menu: refMenu, open: openRefMenu, openFromButton: openRefMenuFromButton } = useRowMenu<RefRow>();
const renaming = ref<{ name: string; value: string } | undefined>(undefined);
const forceDeleteCandidate = ref<string | undefined>(undefined);

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
    // P105 §8: not the panel's own open-auto-focus moment (the panel is already open, mid-row-
    // menu-selection here) — focused explicitly once the rename input renders.
    void nextTick(() => {
      panelEl.value?.querySelector<HTMLInputElement>('.kv-branch-rename-input')?.focus();
    });
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
</script>

<template>
  <div class="relative">
    <Popover :open="isOpen" modal @update:open="onOpenChange">
      <PopoverAnchor as-child>
        <Tooltip>
          <TooltipTrigger as-child>
            <PopoverTrigger as-child>
              <Button ref="triggerEl" variant="toolbar" size="kira" class="kv-branch-trigger max-w-50">
                <CodiconIcon name="git-branch" :size="13" />
                <span class="truncate">{{ triggerLabel }}</span>
                <CodiconIcon :name="codiconName(STATE_ICONS.chevronDown)" :size="13" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ triggerLabel }}</TooltipContent>
        </Tooltip>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        class="w-95 p-0 gap-0"
        :aria-label="`${TAB_LABELS[activeTab]} picker`"
        @open-auto-focus="onOpenAutoFocus"
        @close-auto-focus="onCloseAutoFocus"
      >
        <div
          ref="panelEl"
          class="flex flex-col min-h-0 max-h-[min(520px,var(--reka-popover-content-available-height))]"
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="kira"
            class="kv-branch-tabs mx-1 mt-1"
            aria-label="Picker section"
            :model-value="activeTab"
            @update:model-value="(v) => v && (activeTab = v as PickerTab)"
          >
            <Tooltip v-for="tab in tabOptions" :key="tab.id">
              <TooltipTrigger as-child>
                <ToggleGroupItem :value="tab.id" :aria-label="`${tab.label} (${tab.badge})`">
                  <CodiconIcon :name="codiconName(tab.icon)" :size="13" />
                  <Badge variant="count" data-testid="picker-tab-badge">{{ tab.badge }}</Badge>
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{{ tab.label }}</TooltipContent>
            </Tooltip>
          </ToggleGroup>

          <InputGroup variant="kira" class="m-1">
            <InputGroupAddon>
              <CodiconIcon name="search" :size="13" />
            </InputGroupAddon>
            <InputGroupInput
              ref="filterEl"
              v-model="filter"
              :placeholder="`Filter ${TAB_LABELS[activeTab].toLowerCase()}`"
              :aria-label="`Filter ${TAB_LABELS[activeTab].toLowerCase()}`"
              @keydown="onFilterKeydown"
            />
            <InputGroupAddon v-if="filter" align="inline-end">
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton aria-label="Clear filter" @click="filter = ''">
                    <CodiconIcon name="close" :size="13" />
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>Clear filter</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>

          <div
            ref="rowsScrollEl"
            class="overflow-y-auto min-h-0"
            :aria-label="TAB_LABELS[activeTab]"
          >
            <AttributeTooltip :container="rowsScrollEl" />
            <template v-if="activeTab === 'branches'">
        <section aria-label="Branches">
          <RefSectionHeader label="Branches" />
          <div
            v-for="row in model.branchesLocal.visible"
            :key="row.refname"
            class="kv-branch-row flex items-center gap-0.5 px-1"
            :data-row-id="`branch:${row.refname}`"
            :tabindex="activeRowId === `branch:${row.refname}` ? 0 : -1"
          >
            <template v-if="renaming?.name === row.shortName">
              <Input
                v-model="renaming.value"
                size="kira"
                class="kv-branch-rename-input flex-1"
                aria-label="Rename branch"
                @keydown.enter="submitRename"
                @keydown.escape="renaming = undefined"
              />
              <TooltipIconButton icon="check" label="Rename branch" @click="submitRename" />
            </template>
            <template v-else>
              <button
                type="button"
                :class="cn(rowVariants(), 'kv-branch-row-main flex-1 min-w-0 text-left')"
                @click="checkoutBranch(row)"
              >
                <span
                  class="w-2.5 text-focus"
                  :role="row.isHead ? 'img' : undefined"
                  :aria-label="row.isHead ? 'current branch' : undefined"
                  :aria-hidden="!row.isHead"
                  >{{ row.isHead ? "●" : "" }}</span
                >
                <span class="truncate">{{ row.shortName }}</span>
                <Badge v-if="row.checkedOutIn" :data-kira-tip="`Checked out in ${row.checkedOutIn}`">worktree</Badge>
                <span v-if="formatTrack(row.track)" class="text-kira-sm text-muted-foreground">{{ formatTrack(row.track) }}</span>
              </button>
              <button
                v-if="prFor(row.shortName)"
                type="button"
                :class="prBadgeClass(prFor(row.shortName)!.state)"
                :data-kira-tip="prTooltip(row.shortName)"
                @click.stop="openPullRequest(prFor(row.shortName)!.number)"
              >#{{ prFor(row.shortName)!.number }}</button>
              <RowActionsButton
                @click="openRefMenuFromButton(row, $event)"
                @contextmenu="openRefMenu(row, $event)"
              />
            </template>
          </div>
          <Alert v-if="forceDeleteCandidate" variant="warn" class="flex items-center gap-1 rounded-none border-x-0">
            <AlertDescription>“{{ forceDeleteCandidate }}” is not fully merged.</AlertDescription>
            <Button variant="danger" size="kira" @click="confirmForceDelete">Force delete</Button>
            <Button variant="toolbar" size="kira" @click="forceDeleteCandidate = undefined">Cancel</Button>
          </Alert>
          <ShowMoreButton :hidden-count="model.branchesLocal.hiddenCount" @click="showMore('branchesLocal')" />
          <div v-if="model.branchesLocal.visible.length === 0" class="text-kira-sm text-subtle py-1 px-1.5">No branches</div>
        </section>

        <section aria-label="Remote branches">
          <RefSectionHeader label="Remote branches" />
          <div
            v-for="row in model.branchesRemote.visible"
            :key="row.refname"
            class="kv-branch-row flex items-center gap-0.5 px-1"
            :data-row-id="`remote:${row.refname}`"
            :tabindex="activeRowId === `remote:${row.refname}` ? 0 : -1"
          >
            <button
              type="button"
              :class="cn(rowVariants(), 'kv-branch-row-main flex-1 min-w-0 text-left')"
              @click="checkoutRemote(row)"
            >
              <CodiconIcon name="cloud" :size="13" />
              <span class="truncate">{{ row.shortName }}</span>
              <span class="text-kira-sm text-muted-foreground">{{ remoteCheckoutLabel(row, refs.branches.value) }}</span>
            </button>
            <RowActionsButton
              @click="openRefMenuFromButton(row, $event)"
              @contextmenu="openRefMenu(row, $event)"
            />
          </div>
          <ShowMoreButton :hidden-count="model.branchesRemote.hiddenCount" @click="showMore('branchesRemote')" />
          <div v-if="model.branchesRemote.visible.length === 0" class="text-kira-sm text-subtle py-1 px-1.5">
            No remote branches
          </div>
        </section>
        </template>

        <TagList
          v-else-if="activeTab === 'tags'"
          :section="model.tags"
          :ops="ops"
          :known-remotes="knownRemotes"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
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
          :show-more="() => showMore('worktrees')"
          :focused-row-id="activeRowId"
          @switch-worktree="(path) => emit('switchWorktree', path)"
          @create-worktree="emit('createWorktree')"
        />

        <StackList
          v-else-if="activeTab === 'stacks'"
          :stacks="model.stacks"
          :orphans="model.orphans"
          :ops="ops"
          :pr="pr"
          :open-pull-request="openPullRequest"
          :show-more="() => showMore('stacks')"
          :focused-row-id="activeRowId"
          @open-restack-dialog="(branch) => emit('openRestackDialog', branch)"
          @open-set-parent-dialog="(branch) => emit('openSetStackParentDialog', branch)"
        />
          </div>
        </div>
      </PopoverContent>
    </Popover>

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

