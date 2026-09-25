<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
import type { ApiVariable } from '@shared/domain/variables';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { Input } from '@theme/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import RunState from '@theme/RunState.vue';
import SwatchRadio from '@theme/SwatchRadio.vue';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { useDragReorder } from '@workbench/util/useDragReorder';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useConnectionsStore } from '../state/connections';
import { useRunState } from '../state/runState';
import type { VariableSetTabRecord } from '../state/tabDomain';
import BulkVariablesEditor from './BulkVariablesEditor.vue';
import { useVariableRows } from './state/apiQueries';
import { useCollectionsStore } from './state/collections';
import { mergeDrafts } from './state/draftMerge';
import { useVariableSetStore, useVariablesStore } from './state/variables';
import VariableRow from './VariableRow.vue';

// P17 D16: VariablesDialog.vue's own replacement — the exact same per-row draft/blur/reorder
// mechanics, re-hosted in a tab instead of a dialog (DialogFrame), keyed by `tab.id` (MainView.vue
// keys this component by it, so one instance <-> one tab, same discipline every other tab view
// already follows). `data-testid="variables-dialog"`/`"variables-filter"`/`"variables-error"` are
// kept byte-identical to the dialog's own — the row-level testids never changed at all
// (VariableRow.vue is untouched apart from D14's description cell) — so the existing
// http-variables.spec.ts/api-secret-reveal-isolation.spec.ts regression net passes with no edit.
//
// P104 §3: ViewChrome/ViewHeader/RunState inlined at this call site (no library counterpart).
const props = defineProps<{ tab: VariableSetTabRecord }>();

const collectionsStore = useCollectionsStore();
const variablesStore = useVariablesStore();
const variableSetStore = useVariableSetStore();
const connectionsStore = useConnectionsStore();

const scope = computed(() => props.tab.state.scope);
const ownerId = computed(() => props.tab.state.ownerId);

// D16: a restored tab whose owner no longer exists renders an EmptyState rather than an empty
// table (P4 D14's orphan posture) — gated on the owner list actually having loaded, so a
// freshly-mounted tab doesn't flash "no longer exists" before initCollections/initVariables ever
// resolve.
const ownersLoaded = computed(() =>
  scope.value === 'collection' ? collectionsStore.loaded : variablesStore.loaded,
);
const owningCollection = computed(() =>
  scope.value === 'collection' ? collectionsStore.collectionRecord(ownerId.value) : undefined,
);
const owningEnvironment = computed(() =>
  scope.value === 'environment'
    ? variablesStore.environments.find((e) => e.id === ownerId.value)
    : undefined,
);
const ownerExists = computed(() =>
  scope.value === 'collection' ? !!owningCollection.value : !!owningEnvironment.value,
);

const connRecord = computed(() => connectionsStore.connectionRecord(props.tab.connectionId));
const railColor = computed<PaletteColor | null | undefined>(() => {
  if (scope.value === 'environment') return owningEnvironment.value?.color ?? 'none';
  return connRecord.value ? (connRecord.value.color ?? null) : undefined;
});
const runState = useRunState(() => props.tab.id);

// P112: no init call left here — useCollectionsStore's and useVariablesStore's own app-lifetime
// query observers fetch the tree and the environments list on store creation, and rowsQuery below
// (a useVariableRows observer) fetches this tab's own scope on creation the same way.

// P112: the scope is fixed per tab (VariableSetTabRecord never changes it), so this observer is
// created once, for `ownerId`'s own live value (a rename never changes the id, but a future
// re-target would still be tracked correctly).
const rowsQuery = useVariableRows(scope.value, ownerId);
const rows = computed<ApiVariable[]>(() => rowsQuery.data.value ?? []);
const error = computed(() => variableSetStore.variableSetError(props.tab.id));

// ---- environment scope only: name + description + Duplicate (D16/D17) ----

const envNameDraft = ref('');
const envDescriptionDraft = ref('');
watch(
  owningEnvironment,
  (env) => {
    envNameDraft.value = env?.name ?? '';
    envDescriptionDraft.value = env?.description ?? '';
  },
  { immediate: true },
);
async function onEnvFieldBlur(): Promise<void> {
  const env = owningEnvironment.value;
  if (!env) return;
  const name = envNameDraft.value.trim();
  if (name === '') {
    envNameDraft.value = env.name;
    return;
  }
  if (name === env.name && envDescriptionDraft.value === env.description) return;
  // updateEnvironment writes name/description/color as one row update (D19) — color has its own
  // immediate handler below, so a name/description blur passes the environment's own current
  // colour through unchanged rather than defaulting it back to 'none'.
  await variablesStore.updateEnvironment(env.id, name, envDescriptionDraft.value, env.color);
}
// P18 D17/D19: a swatch click applies immediately, unlike name/description's blur-commit — a
// colour choice is a discrete action with its own visible feedback (the swatch's own selection
// ring), not text a user is still composing.
async function onEnvColorChange(color: PaletteColor): Promise<void> {
  const env = owningEnvironment.value;
  if (!env) return;
  await variablesStore.updateEnvironment(env.id, env.name, env.description, color);
}
async function onDuplicateEnvironment(): Promise<void> {
  if (owningEnvironment.value) await variablesStore.duplicateEnvironment(owningEnvironment.value.id);
}

// ---- the row table (VariablesDialog.vue's own mechanics, verbatim but tab-scoped) ----

// F2 (P108 Part 3): valueTouched is the three-state signal commitDraft sends to Upsert's own
// nil-means-unchanged `value` parameter. A secret row's seeded `value` is always "" (D4/D5's list
// projection), so without this flag every blur — even one that only renamed or re-described the
// row — would send that blank seed as a real replacement value and silently wipe the stored
// secret. Only onUpdateValue (a real edit) and onUpdateSecret's own commit (which always fills
// draft.value with a genuine plaintext first, revealed or already-plain) ever set it true; a mere
// reveal-icon peek (the revealMirroredValue watcher below) never does — it is a read-only mirror,
// not an edit. Reset to false on every syncDrafts, since a freshly loaded row has no pending edit.
interface Draft {
  name: string;
  value: string;
  valueTouched: boolean;
  isSecret: boolean;
  description: string;
}

function equalDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.value === b.value &&
    a.isSecret === b.isSecret &&
    a.description === b.description
  );
}

// P108 F3: every `rows` reload (any row's edit/add/reorder, a Git restore of another row's history
// entry, or — P112 — a cross-window refetch) used to reset every draft to the row's own stored
// `value` — '' for a secret (D4/D5's list projection). A revealed secret's plaintext survives in
// `revealedValues[id]` untouched, but a fresh draft object starts blank; the reveal-mirror watch
// below only fires when `revealedValues` itself changes, so pressing the eye again re-reveals the
// same string, `revealedValues[id] = value` is a same-value set, and the watch never fires — the
// row shows reveal state with an empty field until the grace expiry (up to 5 min). Seeding from
// `revealedValues[id]` here, same mirror rule the watch uses, keeps the field showing what's
// actually revealed across any unrelated reload.
function draftFromRow(row: ApiVariable): Draft {
  const revealed = variableSetStore.revealedValues[row.id];
  return {
    name: row.name,
    value: revealed !== undefined ? revealed : row.value,
    valueTouched: false,
    isSecret: row.isSecret,
    description: row.description,
  };
}

const drafts = reactive<Record<string, Draft>>({});
// P112: the snapshot each draft in `drafts` was last reseeded from — mergeDrafts' own "dirty
// against its seed" test compares the live draft to this, never to whatever the incoming row is.
const seeds = reactive<Record<string, Draft>>({});
const trailingDraft = reactive<Draft>({
  name: '',
  value: '',
  valueTouched: false,
  isSecret: false,
  description: '',
});
const order = ref<string[]>([]);

// P107 T2-20: same drag/keyboard reorder EnvironmentsView.vue's own rows use. Declared here, ahead
// of syncDrafts below, so dragIndex already exists before that first immediate watch fires
// (canReorder/onReorder close over isFiltered/variableSetStore lazily, so declaring this early is
// safe even though both are defined further down).
const { dragIndex, onDragStart, onDragOver, onDragEnd } = useDragReorder(order, {
  canReorder: () => !isFiltered.value,
  onReorder: (next) =>
    variableSetStore.reorderVariables(props.tab.id, scope.value, ownerId.value, next),
});

// P112 §6.5: keep a draft that has changed since it was seeded and still differs from what the
// row now is (an in-progress edit); reseed everything else, including after this window's own
// commit lands (the draft then equals the incoming row again). Order reseeds from the incoming
// rows too, unless a drag is in progress.
function syncDrafts(): void {
  const merged = mergeDrafts(seeds, drafts, rows.value, {
    rowId: (row) => row.id,
    toDraft: draftFromRow,
    equalDraft,
  });
  for (const key of Object.keys(drafts)) delete drafts[key];
  Object.assign(drafts, merged.drafts);
  for (const key of Object.keys(seeds)) delete seeds[key];
  Object.assign(seeds, merged.seeds);
  trailingDraft.name = '';
  trailingDraft.value = '';
  trailingDraft.valueTouched = false;
  trailingDraft.isSecret = false;
  trailingDraft.description = '';
  if (dragIndex.value === null) order.value = merged.order;
}
watch(rows, syncDrafts, { immediate: true });

// Which id's draft currently mirrors a revealed plaintext, and what that plaintext was — so a
// later grace-window expiry (state/variables.ts's own scheduleRevealExpiry) can re-mask the field
// it filled in, without clobbering a value the user has since typed themselves (finding 5: a
// revealed value used to stay legible on screen for the life of the tab, well past the 5-minute
// auth grace it came from, because closing the tab was the only thing that ever cleared it).
const revealMirroredValue: Record<string, string> = {};

watch(variableSetStore.revealedValues, (values) => {
  for (const [id, value] of Object.entries(values)) {
    const draft = drafts[id];
    if (draft && draft.value === '') draft.value = value;
    revealMirroredValue[id] = value;
  }
  for (const id of Object.keys(revealMirroredValue)) {
    if (id in values) continue;
    const draft = drafts[id];
    if (draft && draft.value === revealMirroredValue[id]) draft.value = '';
    delete revealMirroredValue[id];
  }
});

const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');

const allRealRows = computed<ApiVariable[]>(() => {
  const byId = new Map(rows.value.map((row) => [row.id, row]));
  return order.value.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const draft = drafts[id] ?? {
      name: row.name,
      value: row.value,
      isSecret: row.isSecret,
      description: row.description,
    };
    return [
      {
        ...row,
        name: draft.name,
        value: draft.value,
        isSecret: draft.isSecret,
        description: draft.description,
      },
    ];
  });
});

const trailingRow = computed<ApiVariable>(() => ({
  id: '',
  scope: scope.value,
  ownerId: ownerId.value,
  name: trailingDraft.name,
  value: trailingDraft.value,
  isSecret: trailingDraft.isSecret,
  description: trailingDraft.description,
  sortOrder: allRealRows.value.length,
}));

const displayRows = computed<ApiVariable[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  const real = q
    ? allRealRows.value.filter((row) => row.name.toLowerCase().includes(q))
    : allRealRows.value;
  return [...real, trailingRow.value];
});

function duplicateFor(row: ApiVariable): boolean {
  const full = [...allRealRows.value, trailingRow.value];
  const idx = row.id === '' ? full.length - 1 : allRealRows.value.findIndex((r) => r.id === row.id);
  if (idx === -1) return false;
  return variableSetStore.isDuplicateName(full, idx);
}

function draftFor(id: string): Draft {
  if (id === '') return trailingDraft;
  if (!drafts[id])
    drafts[id] = { name: '', value: '', valueTouched: false, isSecret: false, description: '' };
  return drafts[id];
}

function onUpdateName(id: string, value: string): void {
  draftFor(id).name = value;
}
function onUpdateValue(id: string, value: string): void {
  const draft = draftFor(id);
  draft.value = value;
  draft.valueTouched = true;
}
function onUpdateDescription(id: string, value: string): void {
  draftFor(id).description = value;
}

async function commitDraft(id: string): Promise<void> {
  const draft = draftFor(id);
  if (id === '') {
    if (draft.name.trim() === '') return;
    const { value, isSecret, description } = draft;
    const name = draft.name.trim();
    trailingDraft.name = '';
    trailingDraft.value = '';
    trailingDraft.valueTouched = false;
    trailingDraft.isSecret = false;
    trailingDraft.description = '';
    await variableSetStore.upsertVariable(props.tab.id, scope.value, ownerId.value, {
      id: '',
      name,
      // Create always carries a real value (never null) — Upsert requires one for id === '' (a
      // fresh row has no prior stored value nil could ever mean "leave untouched" against).
      value,
      isSecret,
      description,
    });
    return;
  }
  const row = rows.value.find((r) => r.id === id);
  if (!row) return;
  if (draft.name.trim() === '') {
    draft.name = row.name;
    return;
  }
  await variableSetStore.upsertVariable(props.tab.id, scope.value, ownerId.value, {
    id,
    name: draft.name.trim(),
    // F2: null unless this draft's value was actually touched — see Draft's own comment above.
    value: draft.valueTouched ? draft.value : null,
    isSecret: draft.isSecret,
    description: draft.description,
  });
}

async function onBlur(id: string): Promise<void> {
  const draft = draftFor(id);
  if (id === '') {
    await commitDraft(id);
    return;
  }
  const row = rows.value.find((r) => r.id === id);
  if (!row) return;
  if (draft.name.trim() === '') {
    draft.name = row.name;
    return;
  }
  // F2: a secret row's own row.value is always "" (D4/D5), so comparing draft.value to it
  // directly is meaningless for a secret — valueTouched is the real "did the value change"
  // signal; draft.value === row.value still short-circuits a touched-then-reverted plain edit.
  if (
    draft.name === row.name &&
    (!draft.valueTouched || draft.value === row.value) &&
    draft.isSecret === row.isSecret &&
    draft.description === row.description
  )
    return;
  await commitDraft(id);
}

function onRevealError(message: string): void {
  variableSetStore.setVariableSetError(props.tab.id, message);
}

async function onUpdateSecret(id: string, checked: boolean): Promise<void> {
  const draft = draftFor(id);
  if (checked) {
    draft.isSecret = true;
    // draft.value already holds the row's real plaintext here (a plain row's own List value is
    // never blanked) — a genuine value, safe (and necessary) to send.
    draft.valueTouched = true;
    await commitDraft(id);
    return;
  }
  if (id !== '') {
    const value = await variableSetStore.revealVariable(id, onRevealError);
    if (value === undefined) return;
    draft.value = value;
  }
  draft.isSecret = false;
  draft.valueTouched = true;
  await commitDraft(id);
}

function onReveal(id: string): void {
  void variableSetStore.revealVariable(id, onRevealError);
}

async function onMove(id: string, direction: 'up' | 'down'): Promise<void> {
  if (isFiltered.value) return;
  const from = order.value.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= order.value.length) return;
  const next = [...order.value];
  [next[from], next[to]] = [next[to], next[from]];
  order.value = next;
  await variableSetStore.reorderVariables(props.tab.id, scope.value, ownerId.value, order.value);
}

async function onRemove(id: string): Promise<void> {
  if (id === '') return;
  await variableSetStore.deleteVariable(props.tab.id, scope.value, ownerId.value, id);
}

// P22b D16: FieldRowsTable.vue's own trailing-blank-row watcher, restated for this view's own
// shape — the scroller is `listRef` (this view's own utility-classed div, not `.field-rows-table`),
// the row class is
// `.variable-row` (not `.field-row`), and the watched count is `allRealRows` (this view's own
// real-row list) rather than a `rows` prop. One real difference from FieldRowsTable's own copy:
// `allRealRows` starts at 0 and is populated *asynchronously* once rowsQuery's own fetch resolves
// (P112: a useVariableRows observer) — a tab's rows prop, by contrast, is already the real count
// the moment this component mounts — so the watcher's very first invocation is that initial load
// resolving, not a user adding a row, and must not scroll a freshly opened set straight to its own
// bottom. `hasLoadedOnce` distinguishes the two: false for that first invocation only, true for
// every real add after it.
const listRef = ref<HTMLElement | null>(null);
let hasLoadedOnce = false;
watch(
  () => allRealRows.value.length,
  (next, prev) => {
    const isInitialLoad = !hasLoadedOnce;
    hasLoadedOnce = true;
    if (isInitialLoad || next <= prev) return;
    void nextTick(() => {
      listRef.value
        ?.querySelector('.variable-row:last-child')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  },
);

function onHistoryClickFor(row: ApiVariable): void {
  void variableSetStore.openHistoryMenu(props.tab.id, scope.value, ownerId.value, row.id);
}

// ---- bulk `.env` mode (R11, item 5) ----
//
// A component-local lens, not tab state (D16's "a lens, not a setting" rule, same as filterQuery
// above): reopening this tab must never silently resurrect an unapplied text buffer. `v-if` below
// (not `v-show`) is load-bearing — it means BulkVariablesEditor is freshly mounted every time bulk
// mode is entered, so its own baseline snapshot is always taken from the rows the table holds *at
// that moment*, never a stale one from an earlier visit.
const bulkMode = ref(false);
function onBulkClose(): void {
  bulkMode.value = false;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="variables-dialog" :data-scope="scope">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined (no library counterpart). -->
    <ViewToolbar>
      <span
        v-if="railColor !== undefined"
        class="size-1.25 rounded-full shrink-0"
        :class="(!railColor || railColor === 'none') ? 'bg-none border border-disabled' : 'bg-(--kira-rail)'"
        :style="{ '--kira-rail': connColorVar(railColor) }"
      />
      <span class="size-4 flex items-center justify-center shrink-0">
        <CodiconIcon :name="scope === 'environment' ? 'server-environment' : 'symbol-variable'" :size="13" />
      </span>
      <span class="text-kira-md text-fg truncate" data-testid="variable-set-target">{{ tab.state.name || 'Variables' }}</span>
      <span class="ml-auto flex items-center gap-1" />
    </ViewToolbar>
    <div class="h-0.5 shrink-0 bg-(--kira-rail)" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <!-- P22b D9 (remainder): the standard toolbar bands, rather than the hand-spaced single
         #toolbar-2 row this view used to build both controls into on its own — the search box
         (the band every other view's own filter/search control lives in), the .env-text toggle in
         the trailing group (every other view's own trailing action group). -->
    <ViewToolbar border="none">
      <InputGroup v-if="!bulkMode">
        <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
        <InputGroupInput v-model="filterQuery" placeholder="Filter by name" data-testid="variables-filter" />
        <InputGroupAddon v-if="filterQuery" align="inline-end">
          <InputGroupButton aria-label="Clear filter" @click="filterQuery = ''">
            <CodiconIcon name="close" :size="13" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <span class="ml-auto" />
      <RunState :state="runState" />
      <div class="flex items-center gap-1.5 min-w-0">
        <Tooltip v-if="ownerExists">
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-field text-fg': bulkMode }"
              aria-label="Edit as .env text"
              data-testid="variables-bulk-toggle"
              @click="bulkMode = !bulkMode"
            >
              <CodiconIcon name="code" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit as .env text</TooltipContent>
        </Tooltip>
      </div>
    </ViewToolbar>

    <Empty v-if="ownersLoaded && !ownerExists" data-testid="variable-set-orphan">
      <EmptyMedia><CodiconIcon name="warning" :size="24" /></EmptyMedia>
      <EmptyTitle>This variable set no longer exists</EmptyTitle>
    </Empty>
    <BulkVariablesEditor
      v-else-if="bulkMode"
      :tab-id="tab.id"
      :variable-scope="scope"
      :owner-id="ownerId"
      :rows="rows"
      @close="onBulkClose"
    />
    <div
      v-else
      ref="listRef"
      class="flex flex-col gap-0.5 p-1 flex-1 min-h-0 overflow-y-auto"
      data-testid="variables-list"
    >
      <Alert v-if="error" variant="destructive" data-testid="variables-error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <Alert
        v-else-if="connectionsStore.secretStorage && !connectionsStore.secretStorage.available"
        variant="warn"
        data-testid="variables-secrets-unavailable"
      >
        <AlertDescription>{{ connectionsStore.secretStorage.reason }}</AlertDescription>
      </Alert>

      <!-- P28 D16(b): flex-end, not center -- each labelled field is now a two-row column, and
           centering would misalign the inputs against the colour picker and Duplicate button
           beside them. -->
      <div
        v-if="scope === 'environment' && owningEnvironment"
        class="flex items-end gap-1 border-b border-border px-1.5 py-1"
      >
        <!-- P28 D16(b): real labels. Both fields carried a placeholder and nothing else, so a
             populated environment showed two unlabelled text boxes — the placeholder is gone the
             moment either has a value, which is most of the time. Same .cell label convention
             the variable table's own header row below uses. -->
        <Label class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="pl-0.5 text-kira-xs text-subtle">Name</span>
          <Input
            v-model="envNameDraft"
            placeholder="name"
            data-testid="environment-name"
            @blur="onEnvFieldBlur"
          />
        </Label>
        <Label class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="pl-0.5 text-kira-xs text-subtle">Description</span>
          <Input
            v-model="envDescriptionDraft"
            placeholder="description"
            data-testid="environment-description"
            @blur="onEnvFieldBlur"
          />
        </Label>
        <!-- P104 §3 "ColorPicker -> inline composition": the swatch grid of Buttons inlined at the
             call site rather than kept as a shared primitive component. -->
        <!-- P105 §7: `role="radio"` on a `<Button>` wants a real radio input (`useSemanticElements`)
             — a visually-hidden native `<input type="radio">` per swatch keeps the circle's own
             styling exactly (an actual `ToggleGroupItem` would swap in `toggleVariants`' own
             rectangular look), with native Tab/Arrow-key/checked behaviour for free. `opacity-0`
             over the swatch's full area rather than `sr-only`'s 1px-clip technique — Playwright's
             `.click()` (this file's own e2e suite, `connections.spec.ts` and others) refuses a
             target with a near-zero bounding box; a real-size, invisible overlay stays clickable
             both for a person and for a test, same as a custom file-input skin. -->
        <fieldset
          class="color-picker m-0 flex h-6.5 flex-wrap items-center gap-1 border-0 p-0"
          aria-label="Environment color"
          data-testid="environment-color-picker"
        >
          <Tooltip v-for="color in PALETTE_COLOR_CHOICES" :key="color">
            <TooltipTrigger as-child>
              <SwatchRadio
                name="environment-color"
                :value="color"
                :color="color"
                :checked="owningEnvironment.color === color"
                @change="onEnvColorChange(color)"
              />
            </TooltipTrigger>
            <TooltipContent>{{ color === 'none' ? 'No colour' : color }}</TooltipContent>
          </Tooltip>
        </fieldset>
        <Button variant="toolbar" size="kira" data-testid="environment-duplicate" @click="onDuplicateEnvironment">
          Duplicate
        </Button>
      </div>

      <!-- P22b D9: mirrors VariableRow.vue's own grid template exactly (handle, name, value,
           description, secret, history, remove) so the labels sit above their columns; the four
           non-labelled cells are blank placeholders for the columns that carry no header text.
           grid-cols-[auto_1.2fr_2fr_1.5fr_auto_auto_auto] -- same disclosed section 1.2 allowlist
           gap as .overview-row (VariablesOverviewPanel.vue) and .variable-row (VariableRow.vue) --
           a pre-existing value relocated, not a new one. -->
      <div class="grid gap-1 border-b border-border px-1.5 py-1 text-subtle text-kira-sm grid-cols-[auto_1.2fr_2fr_1.5fr_auto_auto_auto]">
        <span class="cell"></span>
        <span class="cell">Name</span>
        <span class="cell">Value</span>
        <span class="cell">Description</span>
        <span class="cell"></span>
        <span class="cell"></span>
        <span class="cell"></span>
      </div>
      <VariableRow
        v-for="(row, i) in displayRows"
        :key="row.id || 'trailing'"
        :row="row"
        :index="i"
        :dragging="dragIndex === i"
        :duplicate="duplicateFor(row)"
        :trailing="row.id === ''"
        :filtered="isFiltered"
        :secrets-unavailable="!!connectionsStore.secretStorage && !connectionsStore.secretStorage.available"
        @update:name="onUpdateName(row.id, $event)"
        @update:value="onUpdateValue(row.id, $event)"
        @update:is-secret="onUpdateSecret(row.id, $event)"
        @update:description="onUpdateDescription(row.id, $event)"
        @blur="onBlur(row.id)"
        @remove="onRemove(row.id)"
        @reveal="onReveal(row.id)"
        @history="onHistoryClickFor(row)"
        @dragstart="onDragStart"
        @dragover="onDragOver"
        @dragend="onDragEnd"
        @move="onMove(row.id, $event)"
      />
    </div>
  </div>
</template>
