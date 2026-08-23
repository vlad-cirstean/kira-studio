<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import Codicon from '../../theme/Codicon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
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
    <span class="p-input search-input" :class="{ 'is-error': errorMessage }">
      <input v-model="query" type="text" class="mono" placeholder="Find" data-testid="search-input" />
    </span>
    <span class="p-seg">
      <span
        :class="{ on: matchCase }"
        title="Match case"
        data-testid="search-match-case"
        @click="matchCase = !matchCase"
      >
        Case
      </span>
      <span
        :class="{ on: wholeWord }"
        title="Whole word"
        data-testid="search-whole-word"
        @click="wholeWord = !wholeWord"
      >
        Word
      </span>
      <span
        :class="{ on: regex }"
        title="Regular expression"
        data-testid="search-regex"
        @click="regex = !regex"
      >
        Regex
      </span>
    </span>

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
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  background: var(--kira-bg-elevated);
  border-top: var(--kira-border-width) solid var(--kira-border);
  border-bottom: none;
}

.search-input {
  width: 200px;
  flex-shrink: 0;
}

.search-input.is-error {
  border-color: var(--kira-error);
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
