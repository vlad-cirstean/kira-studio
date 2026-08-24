<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { getPage } from './kvPage';
import { clearSearchState, runSearch, type SearchHandle, searchState } from './kvSearch';

// Mirrors views/grid/SearchToolbar.vue exactly (same docking rule, same case/word/regex
// toggles, same "loaded rows only" framing) — narrowed to kvSearch.ts's `'field' | 'value'`
// column instead of a tabular page's column index.
const props = defineProps<{ tabId: string }>();

const loadedRowCount = computed(() => getPage(props.tabId)?.rowCount ?? 0);
const emit = defineEmits<{ goToMatch: [row: number, col: 'field' | 'value']; close: [] }>();

const query = ref('');
const matchCase = ref(false);
const wholeWord = ref(false);
const regex = ref(false);
const errorMessage = ref<string | null>(null);
const scanning = ref(false);
const foundSoFar = ref(0);

// See views/grid/SearchToolbar.vue's identical ref/onMounted pair for why $el is the focus
// target (TextField wraps its <input> in its own root <span>, P4) and why onMounted is the
// right place to autofocus (this component is mounted fresh each time the toolbar opens).
const searchInput = ref<{ $el: HTMLElement } | null>(null);

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

onMounted(() => {
  void nextTick(() => searchInput.value?.$el.querySelector('input')?.focus());
});

onUnmounted(() => {
  handle?.cancel();
  clearSearchState(props.tabId);
});
</script>

<template>
  <!-- Docks below the toolbar it searches, never floating over the rows — same placement rule
       as SearchToolbar.vue. -->
  <div class="search-toolbar p-toolbar" data-testid="keyvalue-search-toolbar" @keydown="onKeydown">
    <span class="icon-box" :class="errorMessage ? undefined : 'muted'" :style="errorMessage ? { color: 'var(--kira-error)' } : undefined">
      <CodiconIcon name="search" :size="13" />
    </span>
    <div class="search-input">
      <TextField
        ref="searchInput"
        v-model="query"
        placeholder="Find"
        data-testid="keyvalue-search-input"
        :invalid="!!errorMessage"
      />
    </div>
    <div class="group">
      <IconButton
        icon="case-sensitive"
        :active="matchCase"
        v-tooltip="'Match case'"
        data-testid="keyvalue-search-match-case"
        @click="matchCase = !matchCase"
      />
      <IconButton
        icon="whole-word"
        :active="wholeWord"
        v-tooltip="'Whole word'"
        data-testid="keyvalue-search-whole-word"
        @click="wholeWord = !wholeWord"
      />
      <IconButton
        icon="regex"
        :active="regex"
        v-tooltip="'Regular expression'"
        data-testid="keyvalue-search-regex"
        @click="regex = !regex"
      />
    </div>

    <div class="sep" />

    <span v-if="errorMessage" class="p-sm search-error" data-testid="keyvalue-search-error">{{
      errorMessage
    }}</span>
    <template v-else>
      <span class="p-sm muted search-count" data-testid="keyvalue-search-count">
        <template v-if="entry && entry.matches.length > 0">
          <b class="mono">{{ entry.index + 1 }}</b> of <b class="mono">{{ entry.matches.length }}</b>
        </template>
        <template v-else-if="scanning">{{ foundSoFar }}…</template>
        <template v-else>0 of 0</template>
      </span>
      <IconButton icon="chevron-up" v-tooltip="'Previous match'" data-testid="keyvalue-search-prev" @click="goPrev" />
      <IconButton icon="chevron-down" v-tooltip="'Next match'" data-testid="keyvalue-search-next" @click="goNext" />
      <div class="sep" />
      <span class="p-xs dim">in the {{ loadedRowCount.toLocaleString() }} loaded rows</span>
    </template>
    <IconButton icon="close" class="p-push" v-tooltip="'Close'" data-testid="keyvalue-search-close" @click="close" />
  </div>
</template>

<style scoped>
.search-toolbar {
  background: var(--kira-bg-elevated);
}

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
