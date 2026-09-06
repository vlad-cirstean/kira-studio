<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { findRanges } from '../../editor/findRanges';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';

// P16 D11: a find bar over the response body and the raw exchange's two documents, built on
// P15b's own `rangeHighlights` seam (editor/findRanges.ts is the "find", this file is the toolbar
// chrome and the cross-document navigation) — deliberately not @codemirror/search (D11: not a
// dependency, and its own panel/keymap/styling would need suppressing and re-skinning for a
// requirement `indexOf` already meets). SearchToolbar.vue's own placement (LAW 03: docks below the
// pane it searches) and key handling (Enter/Shift+Enter to step, Escape to close) are the
// precedent this mirrors, at a fraction of that widget's size — no case/word/regex, no chunked
// scan, no filter mode: a response body is one in-memory string, not a paged result set.

export interface FindBarHost {
  scrollRangeIntoView(from: number, to: number): void;
}

export interface FindBarTarget {
  doc: string;
  host: FindBarHost | null;
}

// D11: "multiple documents, one bar" — one target for the Body pane, two for the Raw pane
// (request wire, response wire). Matches are numbered across the targets in order.
const props = defineProps<{ targets: readonly FindBarTarget[] }>();
const emit = defineEmits<{ close: [] }>();

const findInput = ref<{ $el: HTMLElement } | null>(null);

const query = ref('');
// 0-based, across every target's matches concatenated in order.
const currentGlobal = ref(0);

const matchCounts = computed(() => props.targets.map((t) => findRanges(t.doc, query.value).length));
const totalMatches = computed(() => matchCounts.value.reduce((a, b) => a + b, 0));
const displayIndex = computed(() =>
  totalMatches.value === 0 ? 0 : Math.min(currentGlobal.value, totalMatches.value - 1) + 1,
);

// D11: exposed so ResponsePane.vue (which owns the actual CodeMirrorHost instances this bar has
// no template access to) can paint the exact matches this bar counts and steps through — each
// editor's own `rangeHighlights` source reads `query`/`currentGlobal` here, so it recomputes (and
// so the compartment repaints) exactly when either changes.
defineExpose({ query, currentGlobal });

function scrollToCurrent(): void {
  if (totalMatches.value === 0) return;
  let remaining = Math.min(currentGlobal.value, totalMatches.value - 1);
  for (let i = 0; i < props.targets.length; i++) {
    const count = matchCounts.value[i] ?? 0;
    if (remaining < count) {
      const ranges = findRanges(props.targets[i]?.doc ?? '', query.value);
      const r = ranges[remaining];
      if (r) props.targets[i]?.host?.scrollRangeIntoView(r.from, r.to);
      return;
    }
    remaining -= count;
  }
}

watch(query, () => {
  currentGlobal.value = 0;
  scrollToCurrent();
});

function goNext(): void {
  if (totalMatches.value === 0) return;
  currentGlobal.value = (currentGlobal.value + 1) % totalMatches.value;
  scrollToCurrent();
}
function goPrev(): void {
  if (totalMatches.value === 0) return;
  currentGlobal.value = (currentGlobal.value - 1 + totalMatches.value) % totalMatches.value;
  scrollToCurrent();
}

function close(): void {
  emit('close');
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) goPrev();
    else goNext();
  }
}

onMounted(() => {
  void nextTick(() => findInput.value?.$el.querySelector('input')?.focus());
});
</script>

<template>
  <!-- LAW 03: docks below the pane it searches, never floating over it. -->
  <div class="response-find-bar p-toolbar" data-testid="http-find-bar" @keydown="onKeydown">
    <span class="icon-box muted">
      <CodiconIcon name="search" :size="13" />
    </span>
    <div class="find-input">
      <TextField ref="findInput" v-model="query" placeholder="Find" data-testid="http-find-input" />
    </div>
    <span class="p-sm muted find-count" data-testid="http-find-count">
      {{ totalMatches === 0 ? '0 of 0' : `${displayIndex} of ${totalMatches}` }}
    </span>
    <IconButton
      icon="chevron-up"
      v-tooltip="'Previous match'"
      data-testid="http-find-prev"
      @click="goPrev"
    />
    <IconButton
      icon="chevron-down"
      v-tooltip="'Next match'"
      data-testid="http-find-next"
      @click="goNext"
    />
    <IconButton
      icon="close"
      class="p-push"
      v-tooltip="'Close'"
      data-testid="http-find-close"
      @click="close"
    />
  </div>
</template>

<style scoped>
.response-find-bar {
  background: var(--kira-bg-elevated);
  flex-shrink: 0;
}

.find-input {
  width: 200px;
  flex-shrink: 0;
}

.find-input :deep(.p-input) {
  width: 100%;
}

.find-count {
  white-space: nowrap;
}
</style>
