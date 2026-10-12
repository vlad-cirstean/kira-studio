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
 * Every row also carries the ref-scoped menu (`useSectionMenu`) (W14: "every row also carries the
 * context menu W14 builds, which is where the destructive actions live") — a kebab button (mouse
 * *and* keyboard reachable) plus a plain right-click, both opening the same menu.
 */
import { shortSha } from '@kira/git-core';
import type { RefRow, StashEntry } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import AttributeTooltip from '@theme/components/AttributeTooltip.vue';
import InlineState from '@theme/components/InlineState.vue';
import { rowVariants } from '@theme/components/rowVariants';
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { type MessageKey, t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { useEventListener, useFocus } from '@vueuse/core';
import { useCappedList } from '@workbench/behaviour/cappedList';
import { useListNavigation } from '@workbench/behaviour/listNavigation';
import InlineEditInput from '@workbench/components/InlineEditInput.vue';
import ShowMoreButton from '@workbench/components/ShowMoreButton.vue';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, ref, useTemplateRef, watch } from 'vue';
import { PICKER_TAB_ICONS, STATE_ICONS } from '../icons/index.ts';
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
  orderTab,
  type PickerInput,
  type PickerList,
  type PickerTab,
  pickerRowIds,
} from './pickerModel.ts';
import { prStateLabel } from './prStateLabel.ts';
import RowActionsButton from './RowActionsButton.vue';
import {
  formatTrack,
  localNameForRemoteBranch,
  REF_LIST_SECTION_CAP,
  remoteCheckoutLabel,
  remoteCheckoutTarget,
} from './refListModel.ts';
import { buildRefMenu, remoteNamesFrom } from './rowMenuModel.ts';
import StackList from './StackList.vue';
import StashList from './StashList.vue';
import { childOf, parentOf } from './stackListModel.ts';
import TagList from './TagList.vue';
import { useFieldFocus } from './useFieldFocus.ts';
import { useSectionMenu } from './useSectionMenu.ts';
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
  return t('common.dashPair.label', { first: pr.title, second: prStateLabel(pr.state) });
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

const TAB_LABELS: Readonly<Record<PickerTab, MessageKey>> = {
  branches: 'common.module.branches.label',
  tags: 'git.tag.list.label',
  stashes: 'git.stash.list.label',
  worktrees: 'common.module.worktrees.label',
  stacks: 'git.stack.list.label',
};

const TAB_FILTER_PLACEHOLDERS: Readonly<Record<PickerTab, MessageKey>> = {
  branches: 'git.picker.filterBranches.placeholder',
  tags: 'git.picker.filterTags.placeholder',
  stashes: 'git.picker.filterStashes.placeholder',
  worktrees: 'git.picker.filterWorktrees.placeholder',
  stacks: 'git.picker.filterStacks.placeholder',
};

const isOpen = ref(false);
const triggerEl = useTemplateRef<{ $el: HTMLElement }>('triggerEl');
const { focused: triggerFocused } = useFocus(computed(() => triggerEl.value?.$el));
function focusTrigger(): void {
  triggerFocused.value = true;
}
const filterEl = useTemplateRef<{ $el: Element }>('filterEl');
const focusFilter = useFieldFocus(filterEl);
const filter = ref('');
const activeTab = ref<PickerTab>('branches');
// P77 §7.3: the roving-tabindex list's own "current" row — `undefined` until the user presses an
// arrow key, at which point `activeRowId` below still resolves it (falls back to the first
// enabled row), so a fresh tab/query always has exactly one tabbable row.
const focusedRowId = ref<string | null>(null);

const triggerLabel = computed(() => {
  const head = props.refs.head.value;
  if (!head) return '…';
  if (head.kind === 'branch') return head.name;
  if (head.kind === 'unborn') return t('git.picker.unborn.label', { name: head.name });
  return shortSha(head.sha);
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

// P79: split into two computeds so a tab switch (only ever changing `activeTab`) never re-runs the
// expensive filter fold over every list — `filteredPicker` depends only on `(pickerInput, filter)`,
// `ordered` only adds the cheap per-tab ordering pass on top. See `pickerModel.ts`'s own doc
// comment on `filterPickerInput`.
const filteredPicker = computed(() => filterPickerInput(pickerInput.value, filter.value));
const ordered = computed(() => orderTab(filteredPicker.value, activeTab.value));

// P77 §6.3: one list's own "Show 50 more" cap for the current panel-open — reset on close and on a
// filter change (a new query is a new list, §6.3's own words), never persisted.
const caps = {
  branchesLocal: useCappedList(() => ordered.value.branchesLocal, REF_LIST_SECTION_CAP),
  branchesRemote: useCappedList(() => ordered.value.branchesRemote, REF_LIST_SECTION_CAP),
  tags: useCappedList(() => ordered.value.tags, REF_LIST_SECTION_CAP),
  stashStack: useCappedList(() => ordered.value.stashStack, REF_LIST_SECTION_CAP),
  stashGlobal: useCappedList(() => ordered.value.stashGlobal, REF_LIST_SECTION_CAP),
  worktrees: useCappedList(() => ordered.value.worktrees, REF_LIST_SECTION_CAP),
  stacks: useCappedList(() => ordered.value.stacks, REF_LIST_SECTION_CAP),
  orphans: useCappedList(() => ordered.value.orphans, REF_LIST_SECTION_CAP),
};

function resetCaps(): void {
  for (const cap of Object.values(caps)) cap.reset();
}

function sectionOf<T>(cap: {
  visible: { value: readonly T[] };
  hiddenCount: { value: number };
}): PickerList<T> {
  return { visible: cap.visible.value, hiddenCount: cap.hiddenCount.value };
}

const model = computed(() => {
  const lists = {
    branchesLocal: sectionOf(caps.branchesLocal),
    branchesRemote: sectionOf(caps.branchesRemote),
    tags: sectionOf(caps.tags),
    stashStack: sectionOf(caps.stashStack),
    stashGlobal: sectionOf(caps.stashGlobal),
    worktrees: sectionOf(caps.worktrees),
    stacks: sectionOf(caps.stacks),
    orphans: sectionOf(caps.orphans),
  };
  return {
    ...lists,
    counts: filteredPicker.value.counts,
    rowIds: pickerRowIds(activeTab.value, {
      branchesLocal: lists.branchesLocal.visible,
      branchesRemote: lists.branchesRemote.visible,
      tags: lists.tags.visible,
      stashStack: lists.stashStack.visible,
      stashGlobal: lists.stashGlobal.visible,
      worktrees: lists.worktrees.visible,
      stacks: lists.stacks.visible,
      orphans: lists.orphans.visible,
    }),
  };
});

function showMoreStacks(): void {
  caps.stacks.showMore();
  caps.orphans.showMore();
}

watch(filter, resetCaps);

// ---------------------------------------------------------------------------------------
// §7.3: roving focus over the active tab's own rows through `useListNavigation`. The rows live in
// this picker's child lists, so the roving stop is tracked from `focusin` on the shared container.
// `branch-row`/`branch-row-main` stay as bare query hooks for `closest()`/`querySelector()`.
// ---------------------------------------------------------------------------------------
const rowsScrollEl = ref<HTMLElement | null>(null);
type PickerRow = (typeof model.value.rowIds)[number];

const activeRowId = computed<string | undefined>(() => {
  const rows = model.value.rowIds;
  if (focusedRowId.value !== null && rows.some((r) => r.id === focusedRowId.value)) {
    return focusedRowId.value;
  }
  return rows.find((r) => !r.disabled)?.id;
});

function rowEl(id: string): HTMLElement | null {
  return rowsScrollEl.value?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`) ?? null;
}

const nav = useListNavigation<PickerRow>({
  container: rowsScrollEl,
  items: () => model.value.rowIds,
  key: (row) => row.id,
  isDisabled: (row) => row.disabled,
  activeKey: focusedRowId,
  rowSelector: (key) => `[data-row-id="${CSS.escape(key)}"]`,
  // Worktree/stack rows have no main button, so Enter does nothing there.
  onOpen: (row) => rowEl(row.id)?.querySelector<HTMLElement>('[data-testid="branch-row-main"]')?.click(),
  onMenu: (row) => rowEl(row.id)?.querySelector<HTMLElement>('[data-testid="row-actions"]')?.click(),
  onExitTop: () => focusFilter(),
});

useEventListener(rowsScrollEl, 'focusin', (event: FocusEvent) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
  if (id !== undefined) focusedRowId.value = id;
});

/** §7.2: `ArrowDown` from the filter box moves into the list. */
function onFilterDown(event: KeyboardEvent): void {
  const first = model.value.rowIds.find((row) => !row.disabled);
  if (first === undefined) return;
  event.preventDefault();
  void nav.focusKey(first.id);
}

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
    label: t(TAB_LABELS.branches),
    badge: model.value.counts.branches,
  },
  { id: 'tags', icon: PICKER_TAB_ICONS.tags, label: t(TAB_LABELS.tags), badge: model.value.counts.tags },
  {
    id: 'stashes',
    icon: PICKER_TAB_ICONS.stashes,
    label: t(TAB_LABELS.stashes),
    badge: model.value.counts.stashes,
  },
  {
    id: 'worktrees',
    icon: PICKER_TAB_ICONS.worktrees,
    label: t(TAB_LABELS.worktrees),
    badge: model.value.counts.worktrees,
  },
  {
    id: 'stacks',
    icon: PICKER_TAB_ICONS.stacks,
    label: t(TAB_LABELS.stacks),
    badge: model.value.counts.stacks,
  },
]);
const tabItems = computed(() =>
  tabOptions.value.map((tab) => ({
    value: tab.id,
    label: tab.label,
    icon: tab.icon,
    count: tab.badge,
    tooltip: tab.label,
  })),
);

const knownRemotes = computed(() =>
  remoteNamesFrom(props.refs.remoteBranches.value.map((row) => row.shortName)),
);

// P131 Part 2 §5.2: reka's own PopoverContent Escape/outside-click dismissal replaces the
// rootEl keydown listener and onClickOutside call this file used to own -- close()'s resets
// (row menu, renaming, forceDeleteCandidate, filter, caps) now run from the Popover's own
// @update:open(false), reached either way (trigger click, Escape, outside click, or this file's
// own explicit close() calls below).
function close(): void {
  isOpen.value = false;
  rowMenu.close();
  renaming.value = undefined;
  forceDeleteCandidate.value = undefined;
  filter.value = '';
  resetCaps();
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
  focusFilter();
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
  focusTrigger();
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
const rowMenu = useSectionMenu();
const contextMenuStore = useContextMenuStore();
const renaming = ref<string | undefined>(undefined);
const forceDeleteCandidate = ref<string | undefined>(undefined);

function menuFor(row: RefRow) {
  // G26 D-4.14: the stack section is present only for a local branch row — a tag/remoteBranch is
  // never a stack member (buildRefMenu itself already returns before reading `stack` for those
  // two kinds, but computing it only for `branch` here keeps `parentOf`/`childOf` from ever
  // running against a row that could not possibly answer anything).
  const stackResult = { stacks: props.stack.stacks.value, orphans: props.stack.orphans.value };
  return buildRefMenu({
    kind: row.kind,
    shortName: row.shortName,
    isHead: row.isHead,
    knownRemotes: row.kind === 'tag' ? knownRemotes.value : [],
    inProgress: props.ops.statusSummary.value?.inProgress ?? null,
    stack:
      row.kind === 'branch'
        ? {
            hasParent: parentOf(stackResult, row.shortName) !== undefined,
            hasChild: childOf(stackResult, row.shortName) !== undefined,
          }
        : undefined,
  });
}

async function onRefMenuSelect(row: RefRow, id: string): Promise<void> {
  if (id === 'checkoutRef') {
    await (row.kind === 'remoteBranch' ? checkoutRemote(row) : checkoutBranch(row));
    return;
  }
  if (id === 'renameRef') {
    contextMenuStore.afterClose(() => {
      renaming.value = row.shortName;
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

async function submitRename(from: string, to: string): Promise<void> {
  renaming.value = undefined;
  await props.ops.branchRename(from, to);
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
              <Button data-testid="branch-trigger" ref="triggerEl" variant="toolbar" size="kira" class="max-w-50">
                <CodiconIcon name="git-branch" :size="13" />
                <span class="truncate">{{ triggerLabel }}</span>
                <CodiconIcon :name="STATE_ICONS.chevronDown" :size="13" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ triggerLabel }}</TooltipContent>
        </Tooltip>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        class="w-96 p-0 gap-0"
        :aria-label="t('git.picker.region.aria', { tab: t(TAB_LABELS[activeTab]) })"
        @open-auto-focus="onOpenAutoFocus"
        @close-auto-focus="onCloseAutoFocus"
      >
        <div
          class="flex flex-col min-h-0 max-h-[min(520px,var(--reka-popover-content-available-height))]"
        >
          <SecondaryTabs
            data-testid="branch-tabs"
            class="mx-1 mt-1"
            :aria-label="t('git.picker.sections.aria')"
            :model-value="activeTab"
            :items="tabItems"
            @update:model-value="(v) => (activeTab = v as PickerTab)"
          >
            <template #item="{ item }">
              <CodiconIcon :name="item.icon ?? ''" :size="13" />
              <span class="sr-only">{{ item.label }}</span>
              <Badge variant="count" data-testid="picker-tab-badge">{{ item.count }}</Badge>
            </template>
          </SecondaryTabs>

          <div class="m-1">
            <SearchField
              ref="filterEl"
              v-model="filter"
              :placeholder="t(TAB_FILTER_PLACEHOLDERS[activeTab])"
              :aria-label="t(TAB_FILTER_PLACEHOLDERS[activeTab])"
              @keydown.down="onFilterDown"
            />
          </div>

          <div
            ref="rowsScrollEl"
            class="overflow-y-auto min-h-0"
            :aria-label="t(TAB_LABELS[activeTab])"
          >
            <AttributeTooltip :container="rowsScrollEl" />
            <template v-if="activeTab === 'branches'">
        <section :aria-label="t('common.module.branches.label')">
          <SectionHeading :label="t('common.module.branches.label')" />
          <div data-testid="branch-row"
            v-for="row in model.branchesLocal.visible"
            :key="row.refname"
            class="flex items-center gap-0.5 px-1"
            :data-row-id="`branch:${row.refname}`"
            :tabindex="activeRowId === `branch:${row.refname}` ? 0 : -1"
          >
            <InlineEditInput
              v-if="renaming === row.shortName"
              data-testid="branch-rename-input"
              :aria-label="t('git.dialog.rename.title')"
              :name="row.shortName"
              @commit="(to) => submitRename(row.shortName, to)"
              @cancel="renaming = undefined"
            />
            <template v-else>
              <button data-testid="branch-row-main"
                type="button"
                :class="cn(rowVariants(), 'flex-1 min-w-0 text-left')"
                @click="checkoutBranch(row)"
              >
                <span
                  class="w-2.5 text-focus"
                  :role="row.isHead ? 'img' : undefined"
                  :aria-label="row.isHead ? t('git.common.currentBranch.tooltip') : undefined"
                  :aria-hidden="!row.isHead"
                  >{{ row.isHead ? "●" : "" }}</span
                >
                <span class="truncate">{{ row.shortName }}</span>
                <Badge v-if="row.checkedOutIn" :data-kira-tip="t('git.picker.checkedOutIn.tooltip', { path: row.checkedOutIn })">{{ t('common.worktree.label') }}</Badge>
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
                @click="rowMenu.openFromButton($event, menuFor(row), (id) => onRefMenuSelect(row, id))"
                @contextmenu="rowMenu.openAt($event, menuFor(row), (id) => onRefMenuSelect(row, id))"
              />
            </template>
          </div>
          <Alert v-if="forceDeleteCandidate" variant="warn" strip>
            <AlertDescription>{{ t('git.common.forceDelete.body', { name: forceDeleteCandidate }) }}</AlertDescription>
            <div class="flex items-center gap-1">
              <Button variant="danger" size="kira" @click="confirmForceDelete">{{ t('git.common.forceDelete.confirm') }}</Button>
              <Button variant="toolbar" size="kira" @click="forceDeleteCandidate = undefined">{{ t('common.action.cancel.label') }}</Button>
            </div>
          </Alert>
          <ShowMoreButton :step="REF_LIST_SECTION_CAP" :hidden-count="model.branchesLocal.hiddenCount" @click="caps.branchesLocal.showMore()" />
          <InlineState v-if="model.branchesLocal.visible.length === 0" kind="empty">{{ t('git.picker.branches.empty') }}</InlineState>
        </section>

        <section :aria-label="t('git.picker.remoteBranches.label')">
          <SectionHeading :label="t('git.picker.remoteBranches.label')" />
          <div data-testid="branch-row"
            v-for="row in model.branchesRemote.visible"
            :key="row.refname"
            class="flex items-center gap-0.5 px-1"
            :data-row-id="`remote:${row.refname}`"
            :tabindex="activeRowId === `remote:${row.refname}` ? 0 : -1"
          >
            <button data-testid="branch-row-main"
              type="button"
              :class="cn(rowVariants(), 'flex-1 min-w-0 text-left')"
              @click="checkoutRemote(row)"
            >
              <CodiconIcon name="cloud" :size="13" />
              <span class="truncate">{{ row.shortName }}</span>
              <span class="text-kira-sm text-muted-foreground">{{ remoteCheckoutLabel(row, refs.branches.value) }}</span>
            </button>
            <RowActionsButton
              @click="rowMenu.openFromButton($event, menuFor(row), (id) => onRefMenuSelect(row, id))"
              @contextmenu="rowMenu.openAt($event, menuFor(row), (id) => onRefMenuSelect(row, id))"
            />
          </div>
          <ShowMoreButton :step="REF_LIST_SECTION_CAP" :hidden-count="model.branchesRemote.hiddenCount" @click="caps.branchesRemote.showMore()" />
          <InlineState v-if="model.branchesRemote.visible.length === 0" kind="empty">
            {{ t('git.picker.remoteBranches.empty') }}
          </InlineState>
        </section>
        </template>

        <template v-else-if="activeTab === 'tags'">
        <TagList
          :section="model.tags"
          :ops="ops"
          :known-remotes="knownRemotes"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          :focused-row-id="activeRowId"
          @checked-out="close"
        />
        <ShowMoreButton :step="REF_LIST_SECTION_CAP" :hidden-count="model.tags.hiddenCount" @click="caps.tags.showMore()" />
        </template>

        <template v-else-if="activeTab === 'stashes'">
        <StashList
          :section="model.stashStack"
          :stash="stash"
          :ops="ops"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          :current-branch="refs.currentBranchName.value ?? null"
          :focused-row-id="activeRowId"
          @branch-from-stash="(entry) => emit('branchFromStash', entry)"
          @save-entry-to-global-stash="(entry) => emit('saveEntryToGlobalStash', entry)"
          @selected="closeForCheckout"
        />
        <ShowMoreButton :step="REF_LIST_SECTION_CAP" :hidden-count="model.stashStack.hiddenCount" @click="caps.stashStack.showMore()" />

        <GlobalStashList
          :section="model.stashGlobal"
          :stash="stash"
          :ops="ops"
          :in-progress="ops.statusSummary.value?.inProgress ?? null"
          :current-branch="refs.currentBranchName.value ?? null"
          :focused-row-id="activeRowId"
          @branch-from-stash="(entry) => emit('branchFromStash', entry)"
          @save-global-stash="emit('saveGlobalStash')"
          @selected="closeForCheckout"
        />
        <ShowMoreButton :step="REF_LIST_SECTION_CAP" :hidden-count="model.stashGlobal.hiddenCount" @click="caps.stashGlobal.showMore()" />
        </template>

        <template v-else-if="activeTab === 'worktrees'">
        <WorktreeList
          :section="model.worktrees"
          :worktrees="worktrees"
          :ops="ops"
          :focused-row-id="activeRowId"
          @switch-worktree="(path) => emit('switchWorktree', path)"
          @create-worktree="emit('createWorktree')"
        />
        <ShowMoreButton :step="REF_LIST_SECTION_CAP" :hidden-count="model.worktrees.hiddenCount" @click="caps.worktrees.showMore()" />
        </template>

        <template v-else-if="activeTab === 'stacks'">
        <StackList
          :stacks="model.stacks"
          :orphans="model.orphans"
          :ops="ops"
          :pr="pr"
          :open-pull-request="openPullRequest"
          :focused-row-id="activeRowId"
          @open-restack-dialog="(branch) => emit('openRestackDialog', branch)"
          @open-set-parent-dialog="(branch) => emit('openSetStackParentDialog', branch)"
        />
        <ShowMoreButton :step="REF_LIST_SECTION_CAP" :hidden-count="model.stacks.hiddenCount + model.orphans.hiddenCount" @click="showMoreStacks" />
        </template>
          </div>
        </div>
      </PopoverContent>
    </Popover>

  </div>
</template>

