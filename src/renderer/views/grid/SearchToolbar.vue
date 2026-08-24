<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { getPage } from './page';
import {
  clearSearchState,
  isSearchFiltering,
  matchedRows,
  runSearch,
  type SearchHandle,
  searchState,
  setSearchFiltering,
} from './search';

const props = defineProps<{ tabId: string }>();

// README: "search walks the loaded rows only and never issues a query" — this label is what
// keeps a hit count from ever being mistaken for a count over the whole table.
const loadedRowCount = computed(() => getPage(props.tabId)?.rowCount ?? 0);

// P24 D9: the scope label gains a filtered form ("showing N of M loaded rows") whenever the
// toggle is on and a scan has completed.
const filtering = computed(() => isSearchFiltering(props.tabId));
const filteredRowCount = computed(() => matchedRows(props.tabId)?.length ?? null);

function toggleFilter(): void {
  setSearchFiltering(props.tabId, !filtering.value);
}
const emit = defineEmits<{ goToMatch: [row: number, col: number]; close: [] }>();

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

let handle: SearchHandle | null = null;

const entry = computed(() => searchState[props.tabId]);

function startSearch(): void {
  handle?.cancel();
  errorMessage.value = null;
  if (query.value === '') {
    clearSearchState(props.tabId);
    return;
  }
  scanning.value = true;
  foundSoFar.value = 0;
  try {
    handle = runSearch(
      props.tabId,
      {
        text: query.value,
        matchCase: matchCase.value,
        wholeWord: wholeWord.value,
        regex: regex.value,
      },
      (found) => {
        foundSoFar.value = found;
      },
    );
  } catch (err) {
    // An invalid regex is reported inline, never thrown into an unhandled rejection (D28).
    errorMessage.value = err instanceof Error ? err.message : String(err);
    scanning.value = false;
    return;
  }
  handle.done.then((matches) => {
    scanning.value = false;
    searchState[props.tabId] = { matches, index: matches.length > 0 ? 0 : -1 };
    if (matches.length > 0) emit('goToMatch', matches[0].row, matches[0].col);
  });
}

watch([query, matchCase, wholeWord, regex], startSearch);

function goNext(): void {
  const e = entry.value;
  if (!e || e.matches.length === 0) return;
  e.index = (e.index + 1) % e.matches.length;
  const m = e.matches[e.index];
  emit('goToMatch', m.row, m.col);
}
function goPrev(): void {
  const e = entry.value;
  if (!e || e.matches.length === 0) return;
  e.index = (e.index - 1 + e.matches.length) % e.matches.length;
  const m = e.matches[e.index];
  emit('goToMatch', m.row, m.col);
}

function close(): void {
  handle?.cancel();
  clearSearchState(props.tabId);
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
  // This component is mounted fresh each time `rt.searchOpen` flips true (DataView.vue's
  // `v-if="rt?.searchOpen"`), so onMounted fires exactly when the toolbar opens — both from the
  // toolbar button and from Cmd+F (view.find) — and is the right place to autofocus so typing can
  // start immediately without an extra click into the field.
  void nextTick(() => searchInput.value?.$el.querySelector('input')?.focus());
});

onUnmounted(() => {
  handle?.cancel();
  clearSearchState(props.tabId);
  // P24 D7: Cmd+F toggling searchOpen off (DataView.vue's view.find command) unmounts this
  // component without ever calling close() above — the toggle must reset here too.
  setSearchFiltering(props.tabId, false);
});
</script>

<template>
  <!-- LAW 03 / README: docks at the bottom of the result it searches (never floating over it),
       so it's obvious what's being searched — and it only ever walks the loaded rows. -->
  <div class="search-toolbar p-toolbar" data-testid="search-toolbar" @keydown="onKeydown">
    <span class="icon-box" :class="errorMessage ? undefined : 'muted'" :style="errorMessage ? { color: 'var(--kira-error)' } : undefined">
      <CodiconIcon name="search" :size="14" />
    </span>
    <div class="search-input">
      <TextField
        ref="searchInput"
        v-model="query"
        placeholder="Find"
        data-testid="search-input"
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
        data-testid="search-match-case"
        @click="matchCase = !matchCase"
      />
      <IconButton
        icon="whole-word"
        :active="wholeWord"
        v-tooltip="'Whole word'"
        data-testid="search-whole-word"
        @click="wholeWord = !wholeWord"
      />
      <IconButton
        icon="regex"
        :active="regex"
        v-tooltip="'Regular expression'"
        data-testid="search-regex"
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
        data-testid="search-filter-rows"
        @click="toggleFilter"
      />
    </div>

    <div class="sep" />

    <span v-if="errorMessage" class="p-sm search-error" data-testid="search-error">{{
      errorMessage
    }}</span>
    <template v-else>
      <span class="p-sm muted search-count" data-testid="search-count">
        <template v-if="entry && entry.matches.length > 0">
          <b class="mono">{{ entry.index + 1 }}</b> of <b class="mono">{{ entry.matches.length }}</b>
        </template>
        <template v-else-if="scanning">{{ foundSoFar }}…</template>
        <template v-else>0 of 0</template>
      </span>
      <IconButton icon="chevron-up" :size="12" v-tooltip="'Previous match'" data-testid="search-prev" @click="goPrev" />
      <IconButton icon="chevron-down" :size="12" v-tooltip="'Next match'" data-testid="search-next" @click="goNext" />
      <div class="sep" />
      <span class="p-xs dim" data-testid="search-scope">
        <template v-if="filtering && filteredRowCount !== null">
          showing {{ filteredRowCount.toLocaleString() }} of {{ loadedRowCount.toLocaleString() }} loaded rows
        </template>
        <template v-else>in the {{ loadedRowCount.toLocaleString() }} loaded rows</template>
      </span>
    </template>
    <IconButton icon="close" class="p-push" v-tooltip="'Close'" data-testid="search-close" @click="close" />
  </div>
</template>

<style scoped>
.search-toolbar {
  background: var(--kira-bg-elevated);
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so the fixed width lives on this wrapper instead of
   a class/style on the <TextField> tag itself (DocumentView.vue's same `.filter-field`
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
