<script setup lang="ts" generic="M extends { row: number }">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import CodiconIcon from '../../../theme/CodiconIcon.vue';
import IconButton from '../../../theme/primitives/IconButton.vue';
import TextField from '../../../theme/primitives/TextField.vue';
import type { SearchHandle } from './scan';
import type { PageSearchApi } from './search';
import { isSearchFiltering, setSearchFiltering } from './searchFilter';

// P39 D9: replaces grid/SearchToolbar.vue, documents/DocumentSearchToolbar.vue and
// keyvalue/KeyValueSearchToolbar.vue — same markup, same classes, same testids (testidPrefix is
// '' for the grid, 'document-' and 'keyvalue-' for the other two). stream/StreamSearchToolbar.vue
// is a different widget (no case/word/regex toggles, no chunked scan) and stays on its own.
const props = defineProps<{
  tabId: string;
  testidPrefix: string;
  rowNoun: string;
  api: PageSearchApi<M>;
}>();

const emit = defineEmits<{ goToMatch: [match: M]; close: [] }>();

// P31 D22/F24: `api.pageVersion.n` is the explicit dependency — the page stores read a plain,
// non-reactive Map.
const loadedRowCount = computed(() => {
  void props.api.pageVersion.n;
  return props.api.loadedRowCount(props.tabId);
});

// P24 D9: the scope label gains a filtered form ("showing N of M loaded …") whenever the toggle
// is on and a scan has completed.
const filtering = computed(() => isSearchFiltering(props.tabId));
const filteredRowCount = computed(() => props.api.matchedRows(props.tabId)?.length ?? null);

function toggleFilter(): void {
  setSearchFiltering(props.tabId, !filtering.value);
}

// Typed as the bare $el shape (rather than InstanceType<typeof TextField>) so this ref doesn't
// read as a type-only use of the TextField import above — it's a real component, bound as a
// value by the template below. See ConsoleSavedMenu.vue's promptInput for the same pattern:
// TextField wraps the real <input> inside its own root <span> (P4) and isn't defineExpose'd, so
// the focus target is reached via the component's $el, which Vue always exposes on a template
// ref regardless of defineExpose.
const searchInput = ref<{ $el: HTMLElement } | null>(null);

const query = ref('');
const matchCase = ref(false);
const wholeWord = ref(false);
const regex = ref(false);
const errorMessage = ref<string | null>(null);
const scanning = ref(false);
const foundSoFar = ref(0);

let handle: SearchHandle<M> | null = null;

const entry = computed(() => props.api.searchState[props.tabId]);

// autoScroll is false for the page-replaced re-scan (D23): jumping the viewport because a
// background refresh landed would move the page under the user's hands, unlike a query edit
// which is the user's own action and should jump to the first hit immediately.
function startSearch(autoScroll = true): void {
  handle?.cancel();
  errorMessage.value = null;
  if (query.value === '') {
    props.api.clearSearchState(props.tabId);
    handle = null;
    return;
  }
  scanning.value = true;
  foundSoFar.value = 0;
  // P43 iter2 F24/D33: `runChunkedScan`'s own `done` resolves with the partial match list on
  // cancellation (a useful contract on its own — it's how cancel() can be awaited at all) — but a
  // superseded scan's `resolve` still lands on a *later* animation frame, after `startSearch` has
  // already replaced `handle` with a new one. Capturing this call's own handle in `thisHandle` and
  // testing identity (below, both in onProgress and in `.then`) is what keeps a superseded scan's
  // tick or resolution from ever touching `searchState`/`scanning` again — including the
  // close()/onUnmounted() case, where the "newer handle" is simply `null` (both null it out below).
  let thisHandle: SearchHandle<M>;
  try {
    thisHandle = props.api.runSearch(
      props.tabId,
      {
        text: query.value,
        matchCase: matchCase.value,
        wholeWord: wholeWord.value,
        regex: regex.value,
      },
      // P42 D38: every tick — the priority window's own pre-scan included — publishes into
      // searchState itself, not just this toolbar's local counter, so highlighting updates as the
      // scan runs rather than only once at the end (F29). `pending: true` is what tells
      // matchedRows() (search.ts) not to filter on an answer the scan hasn't finished yet.
      (found, rowsScanned, _totalRows, soFar) => {
        if (handle !== thisHandle) return;
        foundSoFar.value = found;
        // P43 iter2 F25/D34: `rowsScanned === 0` is scan.ts's own priority-tick marker (:104) —
        // every main-pass tick reports the row it scanned up to, always > 0 on a non-empty page.
        // The priority window's own `soFar` is a different, unrelated array (scan.ts:60-61's own
        // comment), so an index into it means nothing once the main pass takes over and replaces
        // `matches` wholesale — that transition is the one case an in-flight Enter's index must
        // reset for. Every main-pass tick after that is strictly append-only and ascending, so an
        // existing index keeps pointing at the same match as `soFar` grows underneath it.
        const previousIndex = props.api.searchState[props.tabId]?.index ?? -1;
        const index = rowsScanned === 0 ? -1 : previousIndex;
        props.api.searchState[props.tabId] = { matches: [...soFar], index, pending: true };
      },
    );
  } catch (err) {
    // An invalid regex is reported inline, never thrown into an unhandled rejection (D28).
    errorMessage.value = err instanceof Error ? err.message : String(err);
    scanning.value = false;
    return;
  }
  handle = thisHandle;
  thisHandle.done.then((matches) => {
    if (handle !== thisHandle) return;
    scanning.value = false;
    props.api.searchState[props.tabId] = { matches, index: matches.length > 0 ? 0 : -1 };
    if (autoScroll && matches.length > 0) emit('goToMatch', matches[0]);
  });
}

watch([query, matchCase, wholeWord, regex], () => startSearch());

// P31 D22/D23/F23: paging, Fetch more, a page-size change, Refresh or a WHERE re-run all call
// setPage and bump pageVersion.n — without this, searchState[tabId].matches keeps pointing at
// rows from the page that's gone. Restarting the scan is the only way back to a consistent match
// list; not auto-scrolling matches a fresh scan's own initial state (D23).
watch(
  () => props.api.pageVersion.n,
  () => {
    if (query.value !== '') startSearch(false);
  },
);

function goNext(): void {
  const e = entry.value;
  if (!e || e.matches.length === 0) return;
  e.index = (e.index + 1) % e.matches.length;
  emit('goToMatch', e.matches[e.index]);
}
function goPrev(): void {
  const e = entry.value;
  if (!e || e.matches.length === 0) return;
  e.index = (e.index - 1 + e.matches.length) % e.matches.length;
  emit('goToMatch', e.matches[e.index]);
}

function close(): void {
  handle?.cancel();
  handle = null;
  props.api.clearSearchState(props.tabId);
  // P24 D7: a closed toolbar must never leave rows hidden with no visible cause.
  setSearchFiltering(props.tabId, false);
  emit('close');
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) goPrev();
    else goNext();
  }
}

onMounted(() => {
  // This component is mounted fresh each time its host toolbar opens (both from the toolbar
  // button and from Cmd+F), so onMounted fires exactly then — the right place to autofocus so
  // typing can start immediately without an extra click into the field.
  void nextTick(() => searchInput.value?.$el.querySelector('input')?.focus());
});

onUnmounted(() => {
  handle?.cancel();
  handle = null;
  props.api.clearSearchState(props.tabId);
  // P24 D7: Cmd+F toggling the toolbar off unmounts this component without ever calling close()
  // above — the toggle must reset here too.
  setSearchFiltering(props.tabId, false);
});
</script>

<template>
  <!-- LAW 03 / README: docks at the bottom of the result it searches (never floating over it),
       so it's obvious what's being searched — and it only ever walks the loaded rows. -->
  <div
    class="search-toolbar p-toolbar"
    :data-testid="`${testidPrefix}search-toolbar`"
    @keydown="onKeydown"
  >
    <span
      class="icon-box"
      :class="errorMessage ? undefined : 'muted'"
      :style="errorMessage ? { color: 'var(--kira-error)' } : undefined"
    >
      <CodiconIcon name="search" :size="13" />
    </span>
    <div class="search-input">
      <TextField
        ref="searchInput"
        v-model="query"
        placeholder="Find"
        :data-testid="`${testidPrefix}search-input`"
        :invalid="!!errorMessage"
      />
    </div>
    <!-- Case/Word/Regex are three independent toggles (all three can be on at once), not a
         single-value picker, so each is its own icon button rather than a <SegmentedControl> (which
         only models "exactly one option selected") — the same three codicons VS Code's own
         find widget uses for this. -->
    <div class="group">
      <IconButton
        icon="case-sensitive"
        :active="matchCase"
        v-tooltip="'Match case'"
        :data-testid="`${testidPrefix}search-match-case`"
        @click="matchCase = !matchCase"
      />
      <IconButton
        icon="whole-word"
        :active="wholeWord"
        v-tooltip="'Whole word'"
        :data-testid="`${testidPrefix}search-whole-word`"
        @click="wholeWord = !wholeWord"
      />
      <IconButton
        icon="regex"
        :active="regex"
        v-tooltip="'Regular expression'"
        :data-testid="`${testidPrefix}search-regex`"
        @click="regex = !regex"
      />
    </div>

    <div class="sep" />

    <!-- P24 D1/D9: a filter *mode* on this same widget — hides every row with no match. Its own
         group, flanked by .sep on both sides, since case/word/regex say *how to match* and this
         (with prev/next) says *what to do with the matches*. -->
    <div class="group">
      <IconButton
        icon="filter"
        :active="filtering"
        v-tooltip="
          filtering ? 'Showing only matching rows — click to show all' : 'Show only matching rows'
        "
        :data-testid="`${testidPrefix}search-filter-rows`"
        @click="toggleFilter"
      />
    </div>

    <div class="sep" />

    <span
      v-if="errorMessage"
      class="p-sm search-error"
      :data-testid="`${testidPrefix}search-error`"
      >{{ errorMessage }}</span
    >
    <template v-else>
      <!-- P42 D38: `scanning` now wins over a non-empty `entry` — a scan in progress publishes
           partial matches into searchState too (so highlighting can show them immediately), and
           without this order swap that partial entry's own non-zero length would make the branch
           above print a growing, and misleading, "0 of N" instead of "N…". P43 iter2 F24/D33: the
           order swap alone doesn't cover every path here — a superseded scan's own stale `.then`
           used to set `scanning` false while a newer scan was still genuinely running, falling
           through to this same branch with a partial `index: -1` entry underneath it; that path is
           closed by `startSearch`'s own handle-identity check, not by this template. -->
      <span class="p-sm muted search-count" :data-testid="`${testidPrefix}search-count`">
        <template v-if="scanning">{{ foundSoFar }}…</template>
        <template v-else-if="entry && entry.matches.length > 0">
          <b class="mono">{{ entry.index + 1 }}</b> of <b class="mono">{{ entry.matches.length }}</b>
        </template>
        <template v-else>0 of 0</template>
      </span>
      <IconButton
        icon="chevron-up"
        v-tooltip="'Previous match'"
        :data-testid="`${testidPrefix}search-prev`"
        @click="goPrev"
      />
      <IconButton
        icon="chevron-down"
        v-tooltip="'Next match'"
        :data-testid="`${testidPrefix}search-next`"
        @click="goNext"
      />
      <div class="sep" />
      <span class="p-xs dim" :data-testid="`${testidPrefix}search-scope`">
        <template v-if="filtering && filteredRowCount !== null">
          showing {{ filteredRowCount.toLocaleString() }} of {{ loadedRowCount.toLocaleString() }}
          loaded {{ rowNoun }}
        </template>
        <template v-else>in the {{ loadedRowCount.toLocaleString() }} loaded {{ rowNoun }}</template>
      </span>
    </template>
    <IconButton
      icon="close"
      class="p-push"
      v-tooltip="'Close'"
      :data-testid="`${testidPrefix}search-close`"
      @click="close"
    />
  </div>
</template>

<style scoped>
.search-toolbar {
  background: var(--kira-bg-elevated);
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so the fixed width lives on this wrapper instead of
   a class/style on the <TextField> tag itself (DocumentView.vue's own `.filter-field`
   precedent). */
.search-input {
  width: 200px;
  flex-shrink: 0;
}

.search-input :deep(.p-input) {
  width: 100%;
}

.search-count {
  white-space: nowrap;
}

.search-error {
  color: var(--kira-error);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
