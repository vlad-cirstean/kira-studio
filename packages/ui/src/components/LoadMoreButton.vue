<script setup lang="ts">
/**
 * §5.1.1's explicit "load more" affordance — pages of `pageSize` rows, never infinite scroll.
 * A plain click calls `graphView.loadMore()`; an Alt/Option-click ("do the bigger thing", the
 * workbench's own modifier convention) calls `graphView.loadAll()` instead. Both share one
 * `loading` state on `GraphViewState`, so a second press while either is in flight is a no-op —
 * the native `disabled` attribute plus the `loading` guard in `handlePress` cover it twice.
 *
 * Deliberately has no live region of its own: W14 owns "one polite live region" announcing both
 * load-more and refresh outcomes, and a second region here would fight it (plan lines ~1325-6).
 */
import { computed } from "vue";
import type { GraphViewState } from "../state/graphView.ts";

const props = defineProps<{
  graphView: GraphViewState;
  pageSize: number;
}>();

const formatter = new Intl.NumberFormat();

function fmt(n: number): string {
  return formatter.format(n);
}

const isLoading = computed(() => props.graphView.loading.value !== "idle");

const buttonLabel = computed(() => {
  const remaining = props.graphView.remaining.value;
  if (isLoading.value) {
    return `Loading… (${fmt(remaining)} remaining)`;
  }
  if (remaining < props.pageSize) {
    return `Load the last ${fmt(remaining)}`;
  }
  return `Load ${fmt(props.pageSize)} more (${fmt(remaining)} remaining)`;
});

function handlePress(event: MouseEvent): void {
  if (isLoading.value) return;
  if (event.altKey) {
    void props.graphView.loadAll();
  } else {
    void props.graphView.loadMore();
  }
}

function handleCancel(): void {
  props.graphView.cancelLoad();
}
</script>

<template>
  <div v-if="!graphView.exhausted.value" class="kv-load-more">
    <button
      type="button"
      class="kv-load-more-button"
      :disabled="isLoading"
      title="Alt-click to load everything remaining — this keeps every loaded commit in memory."
      @click="handlePress"
    >
      {{ buttonLabel }}
    </button>
    <button
      v-if="isLoading"
      type="button"
      class="kv-load-more-cancel"
      aria-label="Cancel loading"
      @click="handleCancel"
    >
      Cancel
    </button>
  </div>
</template>

<style>
.kv-load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--kv-space-2);
  padding: var(--kv-space-2) var(--kv-space-3);
  flex-shrink: 0;
}

.kv-load-more-button {
  padding: var(--kv-space-2) var(--kv-space-3);
  border: 1px solid var(--kv-toolbar-border);
  border-radius: var(--kv-radius);
  background: transparent;
  color: var(--kv-app-fg);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}

.kv-load-more-button:hover:not(:disabled) {
  background-color: var(--kv-row-hover-bg);
}

.kv-load-more-button:focus-visible,
.kv-load-more-cancel:focus-visible {
  outline: 1px solid var(--kv-focus-border);
  outline-offset: -1px;
}

.kv-load-more-button:disabled {
  cursor: default;
  opacity: 0.7;
}

.kv-load-more-cancel {
  padding: var(--kv-space-2) var(--kv-space-3);
  border: none;
  border-radius: var(--kv-radius);
  background: transparent;
  color: var(--kv-app-fg);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.kv-load-more-cancel:hover {
  background-color: var(--kv-row-hover-bg);
}
</style>
