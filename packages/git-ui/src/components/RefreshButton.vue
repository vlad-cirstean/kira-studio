<script setup lang="ts">
/**
 * §6.2's refresh action: the leftmost operation button, `F5`/`Ctrl+R` (`Cmd+R` on macOS). Calls
 * `GraphViewState.refresh()`, which already carries its own "second press while running is a
 * no-op" idempotency (§6.2) — the `disabled` attribute here is belt-and-braces, not the only
 * guard. Spins only while `loading === "refreshing"`, not for an unrelated `loadMore`/`loadAll`
 * in flight, so the icon never implies a re-walk that is not happening.
 *
 * The one piece of watcher UI P4 owns (§6.2): a `repo.changed` event with `kind: "refsChanged"`
 * shows a small dot and changes the tooltip, cleared again once a refresh actually runs. P4 does
 * not auto-refresh — pulling the list out from under a mid-scroll user because a background
 * `git fetch` finished is exactly what §6.2 draws the line against.
 *
 * The `F5`/`Ctrl+R` keybinding itself is not attached here: `CommitGrid.vue` (W6) already owns a
 * keydown listener scoped to its own host element and emits a `refresh` event from it, which is
 * exactly "while the panel has focus" (§6.2) — precise focus scoping a second, independent
 * document-level listener here could not match without duplicating it. `App.vue` (W11) wires
 * that emit to this component's exposed `refresh()`, so both paths share one implementation and
 * one `hasPendingChange` state.
 */
import { computed, ref, watch } from 'vue';
import { ACTION_ICONS } from '../icons/index';
import type { GraphViewState } from '../state/graphView';
import type { RepoState } from '../state/repo';

const props = defineProps<{ graphView: GraphViewState; repoState: RepoState }>();

const hasPendingChange = ref(false);

watch(
  () => props.repoState.lastChange.value,
  (change) => {
    if (change?.kind === 'refsChanged') hasPendingChange.value = true;
  },
);

const isBusy = computed(() => props.graphView.loading.value !== 'idle');
const isRefreshing = computed(() => props.graphView.loading.value === 'refreshing');

const tooltip = computed(() =>
  hasPendingChange.value ? 'The history changed on disk — refresh to see it' : 'Refresh (F5)',
);

async function doRefresh(): Promise<void> {
  if (isBusy.value) return;
  hasPendingChange.value = false;
  await props.graphView.refresh();
}

defineExpose({ refresh: doRefresh });
</script>

<template>
  <button
    type="button"
    class="kv-icon-button kv-refresh-button"
    :class="{ 'kv-refresh-spinning': isRefreshing }"
    :disabled="isBusy"
    :title="tooltip"
    aria-label="Refresh"
    @click="doRefresh"
  >
    <span class="codicon" :class="ACTION_ICONS.refresh" aria-hidden="true"></span>
    <span v-if="hasPendingChange" class="kv-refresh-dot" aria-hidden="true"></span>
  </button>
</template>

<style>
.kv-refresh-button {
  position: relative;
}

.kv-refresh-button:disabled {
  cursor: default;
  opacity: 0.7;
}

.kv-refresh-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--kv-focus-border);
}

.kv-refresh-spinning .codicon {
  display: inline-block;
  animation: kv-refresh-spin 1.5s steps(30) infinite;
}

@keyframes kv-refresh-spin {
  100% {
    transform: rotate(360deg);
  }
}
</style>
