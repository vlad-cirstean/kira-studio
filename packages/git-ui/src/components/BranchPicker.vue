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
// `import type`, silently erasing the import — `biome.json`'s own `**/*.vue` override turns
// `useImportType` off for exactly this class of false positive (P96 §5.2).
import {
  enabledNeighbour,
  firstEnabled,
  KuiButton,
  KuiPopoverPanel,
  KuiSearchInput,
  KuiSegmented,
  KuiTextInput,
  kuiRowVariants,
  type MenuItem,
} from '@kira/kira-ui';
import { onClickOutside, useEventListener } from '@vueuse/core';
import { computed, nextTick, ref, watch } from 'vue';
import { PICKER_TAB_ICONS, STATE_ICONS } from '../icons/index.ts';
import type { OpsState } from '../state/ops.ts';
import type { PrState } from '../state/pr.ts';
import type { RefsState } from '../state/refs.ts';
import type { StackState } from '../state/stack.ts';
import type { StashState } from '../state/stash.ts';
import type { WorktreeCreateSeed, WorktreeState } from '../state/worktrees.ts';
import GlobalStashList from './GlobalStashList.vue';
import {
  filterPickerInput,
  orderAndCapTab,
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
import { useRowMenu } from './useRowMenu.ts';
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
 *  branch). `Tab` is left alone: it already reaches the row's own trailing buttons.
 *
 *  P110 A18: `.kv-branch-row`/`.kv-branch-row-main` carry no CSS any more (every row's own styling
 *  moved to `kv:` utilities, here and in TagList/StashRows/WorktreeList/StackList) — both class
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

// P105 §5.1: the row-scroll div carries no interactive role of its own -- binds via VueUse
// instead of a raw @keydown on it.
useEventListener(rowsScrollEl, 'keydown', onRowsKeydown);

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

// P105 §5.1: the wrapping div carries no interactive role of its own -- binds via VueUse instead
// of a raw @keydown.escape on it.
useEventListener(rootEl, 'keydown', (e) => {
  if (e.key === 'Escape') close();
});

// P77 §7.2 fix: was `isOpen.value = !isOpen.value`, which opened the panel without ever calling
// `open()` — the filter-focus fix below only ran for the palette's own `runUiAction` route
// (§13), never for a plain trigger click, contradicting `open()`'s own doc comment ("both entry
// points ... go through open()"). Routing the open half through `open()` (no `tab` argument, so
// the click-trigger path keeps whatever tab was last active, unchanged) is what actually makes
// that true.
function toggle(): void {
  if (isOpen.value) {
    close();
    return;
  }
  open();
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
    // P105 §8: not the panel's first focusable element (case 2) — `autofocus` can't see the
    // custom `role="dialog"` context, so it's focused explicitly once the input renders.
    void nextTick(() => {
      rootEl.value?.querySelector<HTMLInputElement>('.kv-branch-rename-input')?.focus();
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

onClickOutside(rootEl, () => {
  if (isOpen.value) close();
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
</script>

<template>
  <div ref="rootEl" class="kv:relative">
    <!-- G34 D5/D14: a real `KuiButton` — `closeForCheckout()`'s own W20 fix below calls real
         `.focus()` on `triggerEl` before a dialog opens, and `KuiButton` now exposes that. -->
    <KuiButton
      ref="triggerEl"
      class="kv-branch-trigger kv:max-w-50"
      aria-haspopup="true"
      :aria-expanded="isOpen"
      v-kui-tooltip="refs.head.value?.kind === 'detached' ? refs.head.value.sha : triggerLabel"
      @click="toggle"
    >
      <span class="codicon codicon-git-branch" aria-hidden="true"></span>
      <span class="kv:truncate">{{ triggerLabel }}</span>
      <span class="codicon" :class="STATE_ICONS.chevronDown" aria-hidden="true"></span>
    </KuiButton>

    <KuiPopoverPanel v-if="isOpen" anchor="left" :width="380" @close="close">
    <div
      class="kv:flex kv:flex-col kv:min-h-0 kv:max-h-[min(520px,var(--kui-float-max-h,520px))] kv:max-w-[var(--kui-float-max-w,380px)]"
      role="dialog"
      :aria-label="`${TAB_LABELS[activeTab]} picker`"
    >
      <KuiSegmented
        class="kv-branch-tabs kv:mx-1 kv:mt-1 kv:mb-0"
        :options="tabOptions"
        :model-value="activeTab"
        ariaLabel="Picker section"
        @update:model-value="(id) => (activeTab = id as PickerTab)"
      />
      <KuiSearchInput
        ref="filterEl"
        class="kv:m-1"
        v-model="filter"
        :placeholder="`Filter ${TAB_LABELS[activeTab].toLowerCase()}`"
        :ariaLabel="`Filter ${TAB_LABELS[activeTab].toLowerCase()}`"
        @keydown="onFilterKeydown"
      />

      <div
        ref="rowsScrollEl"
        class="kv:overflow-y-auto kv:min-h-0"
        :aria-label="TAB_LABELS[activeTab]"
      >
        <template v-if="activeTab === 'branches'">
        <section aria-label="Branches">
          <div class="kv:flex kv:items-center kv:h-control-sm kv:px-2 kv:text-xs kv:font-semibold kv:text-muted kv:uppercase kv:tracking-wider">Branches</div>
          <div
            v-for="row in model.branchesLocal.visible"
            :key="row.refname"
            class="kv-branch-row kv:flex kv:items-center kv:gap-0.5 kv:px-1"
            :class="{ 'kv:font-semibold': row.isHead }"
            :data-row-id="`branch:${row.refname}`"
            :tabindex="activeRowId === `branch:${row.refname}` ? 0 : -1"
          >
            <template v-if="renaming?.name === row.shortName">
              <KuiTextInput
                class="kv-branch-rename-input kv:flex-1"
                v-model="renaming.value"
                ariaLabel="Rename branch"
                @keydown.enter="submitRename"
                @keydown.escape="renaming = undefined"
              />
              <KuiButton variant="icon" @click="submitRename">
                <span class="codicon codicon-check" aria-hidden="true"></span>
              </KuiButton>
            </template>
            <template v-else>
              <KuiButton :class="[kuiRowVariants(), 'kv-branch-row-main kv:flex-1 kv:min-w-0 kv:text-left']" @click="checkoutBranch(row)">
                <span
                  class="kv:w-2.5 kv:text-focus"
                  :role="row.isHead ? 'img' : undefined"
                  :aria-label="row.isHead ? 'current branch' : undefined"
                  :aria-hidden="!row.isHead"
                  >{{ row.isHead ? "●" : "" }}</span
                >
                <span class="kv:truncate">{{ row.shortName }}</span>
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
                <span
                  v-if="row.checkedOutIn"
                  class="kv:text-xs kv:px-0.5 kv:border kv:border-dashed kv:border-panel-border kv:rounded-sm kv:text-muted"
                  v-kui-tooltip="`Checked out in ${row.checkedOutIn}`"
                >
                  worktree
                </span>
                <span v-if="formatTrack(row.track)" class="kv:text-xs kv:text-muted">{{ formatTrack(row.track) }}</span>
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
          <div
            v-if="forceDeleteCandidate"
            class="kv:flex kv:items-center kv:gap-1 kv:py-1 kv:px-2 kv:bg-overlay kv:text-xs"
          >
            <span>“{{ forceDeleteCandidate }}” is not fully merged.</span>
            <KuiButton variant="danger" @click="confirmForceDelete">Force delete</KuiButton>
            <KuiButton @click="forceDeleteCandidate = undefined">Cancel</KuiButton>
          </div>
          <KuiButton
            v-if="model.branchesLocal.hiddenCount > 0"
            class="kv:block kv:w-full kv:text-left kv:py-0.5 kv:px-2 kv:border-0 kv:text-xs kv:enabled:hover:bg-transparent kv:enabled:hover:underline"
            @click="showMore('branchesLocal')"
          >
            Show {{ Math.min(REF_LIST_SECTION_CAP, model.branchesLocal.hiddenCount) }} more
            ({{ model.branchesLocal.hiddenCount }} remaining)
          </KuiButton>
          <div v-if="model.branchesLocal.visible.length === 0" class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs">No branches</div>
        </section>

        <section aria-label="Remote branches">
          <div class="kv:flex kv:items-center kv:h-control-sm kv:px-2 kv:text-xs kv:font-semibold kv:text-muted kv:uppercase kv:tracking-wider">Remote branches</div>
          <div
            v-for="row in model.branchesRemote.visible"
            :key="row.refname"
            class="kv-branch-row kv:flex kv:items-center kv:gap-0.5 kv:px-1"
            :data-row-id="`remote:${row.refname}`"
            :tabindex="activeRowId === `remote:${row.refname}` ? 0 : -1"
          >
            <KuiButton
              :class="[kuiRowVariants(), 'kv-branch-row-main kv:flex-1 kv:min-w-0 kv:text-left']"
              icon="codicon-cloud"
              @click="checkoutRemote(row)"
            >
              <span class="kv:truncate">{{ row.shortName }}</span>
              <span class="kv:text-xs kv:text-muted">{{ remoteCheckoutLabel(row, refs.branches.value) }}</span>
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
            class="kv:block kv:w-full kv:text-left kv:py-0.5 kv:px-2 kv:border-0 kv:text-xs kv:enabled:hover:bg-transparent kv:enabled:hover:underline"
            @click="showMore('branchesRemote')"
          >
            Show {{ Math.min(REF_LIST_SECTION_CAP, model.branchesRemote.hiddenCount) }} more
            ({{ model.branchesRemote.hiddenCount }} remaining)
          </KuiButton>
          <div v-if="model.branchesRemote.visible.length === 0" class="kv:py-0.5 kv:px-2 kv:text-muted kv:text-xs">
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

