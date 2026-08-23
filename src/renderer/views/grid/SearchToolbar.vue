<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import Codicon from '../../theme/Codicon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { getPage } from './page';
import { clearSearchState, runSearch, type SearchHandle, searchState } from './search';

const props = defineProps<{ tabId: string }>();

// README: "search walks the loaded rows only and never issues a query" — this label is what
// keeps a hit count from ever being mistaken for a count over the whole table.
const loadedRowCount = computed(() => getPage(props.tabId)?.rowCount ?? 0);
const emit = defineEmits<{ goToMatch: [row: number, col: number]; close: [] }>();

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

onUnmounted(() => {
  handle?.cancel();
  clearSearchState(props.tabId);
});
</script>

<template>
  <!-- LAW 03 / README: docks at the bottom of the result it searches (never floating over it),
       so it's obvious what's being searched — and it only ever walks the loaded rows. -->
  <div class="search-toolbar p-toolbar" data-testid="search-toolbar" @keydown="onKeydown">
    <span class="icon-box" :class="errorMessage ? undefined : 'muted'" :style="errorMessage ? { color: 'var(--kira-error)' } : undefined">
      <Codicon name="search" :size="14" />
    </span>
    <div class="search-input">
      <TextField
        v-model="query"
        placeholder="Find"
        data-testid="search-input"
        :invalid="!!errorMessage"
      />
    </div>
    <!-- Case/Word/Regex are three independent toggles (all three can be on at once), not a
         single-value picker, so each is its own icon button rather than a <Segmented> (which
         only models "exactly one option selected") — the same three codicons VS Code's own
         find widget uses for this. -->
    <div class="group">
      <IconButton
        icon="case-sensitive"
        :active="matchCase"
        title="Match case"
        data-testid="search-match-case"
        @click="matchCase = !matchCase"
      />
      <IconButton
        icon="whole-word"
        :active="wholeWord"
        title="Whole word"
        data-testid="search-whole-word"
        @click="wholeWord = !wholeWord"
      />
      <IconButton
        icon="regex"
        :active="regex"
        title="Regular expression"
        data-testid="search-regex"
        @click="regex = !regex"
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
      <IconButton icon="chevron-up" :size="12" title="Previous match" data-testid="search-prev" @click="goPrev" />
      <IconButton icon="chevron-down" :size="12" title="Next match" data-testid="search-next" @click="goNext" />
      <div class="sep" />
      <span class="p-xs dim">in the {{ loadedRowCount.toLocaleString() }} loaded rows</span>
    </template>
    <IconButton icon="close" class="p-push" title="Close" data-testid="search-close" @click="close" />
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
