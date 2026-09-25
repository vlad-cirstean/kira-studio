<script setup lang="ts">
/**
 * §6.2's refresh action: the leftmost operation button, `F5`/`Ctrl+R` (`Cmd+R` on macOS). Calls
 * `GraphViewState.refresh()`, which already carries its own "second press while running is a
 * no-op" idempotency (§6.2) — the `disabled` attribute here is belt-and-braces, not the only
 * guard. Spins only while `loading === "refreshing"`, not for an unrelated `loadMore`/`loadAll`
 * in flight, so the icon never implies a re-walk that is not happening.
 *
 * A `repo.changed` event with `kind: "refsChanged"` shows a small dot and changes the tooltip,
 * cleared again whenever `loading` leaves `"refreshing"` — manual or automatic. G-UX D10 made the
 * graph itself auto-refresh on this same signal, so this dot now exists purely as the *backup*
 * for whatever case genuinely did not auto-refresh, not as the primary mechanism P4 originally
 * shipped it as.
 *
 * The `F5`/`Ctrl+R` keybinding itself is not attached here: `CommitGrid.vue` (W6) already owns a
 * keydown listener scoped to its own host element and emits a `refresh` event from it, which is
 * exactly "while the panel has focus" (§6.2) — precise focus scoping a second, independent
 * document-level listener here could not match without duplicating it. `App.vue` (W11) wires
 * that emit to this component's exposed `refresh()`, so both paths share one implementation and
 * one `hasPendingChange` state.
 */
import { KuiButton } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import { ACTION_ICONS } from '../icons/index.ts';
import type { GraphViewState } from '../state/graphView.ts';
import type { RepoState } from '../state/repo.ts';

const props = defineProps<{ graphView: GraphViewState; repoState: RepoState }>();

const hasPendingChange = ref(false);

watch(
  () => props.repoState.lastChange.value,
  (change) => {
    if (change?.kind === 'refsChanged') hasPendingChange.value = true;
  },
);

// Cleared on ANY completed refresh, not only one `doRefresh` itself triggered — D10's
// auto-refresh runs through the same `loading === 'refreshing'` state, and once it exists the
// dot must clear on that too or it becomes permanent noise.
watch(
  () => props.graphView.loading.value,
  (state, previous) => {
    if (previous === 'refreshing' && state !== 'refreshing') hasPendingChange.value = false;
  },
);

const isBusy = computed(() => props.graphView.loading.value !== 'idle');
const isRefreshing = computed(() => props.graphView.loading.value === 'refreshing');

const tooltip = computed(() =>
  hasPendingChange.value ? 'The history changed on disk — refresh to see it' : 'Refresh (F5)',
);

async function doRefresh(): Promise<void> {
  if (isBusy.value) return;
  await props.graphView.refresh();
}

defineExpose({ refresh: doRefresh });
</script>

<template>
  <!-- KuiButton's own icon renders through KuiIconBox internally (no class passthrough to the
       inner `.codicon` span), so spinning it needs an arbitrary descendant-selector variant here
       rather than a class placed directly on the icon (§1.1 rung 4). Pre-approved spinner change
       (§1.4/§6.4): the stepped 1.5s rotation becomes Tailwind's smooth 1s `animate-spin`. -->
  <KuiButton
    :icon="ACTION_ICONS.refresh"
    variant="icon"
    :class="[
      'kv:relative kv:disabled:cursor-default kv:disabled:opacity-70',
      { 'kv:[&_.codicon]:animate-spin': isRefreshing },
    ]"
    :disabled="isBusy"
    v-kui-tooltip="tooltip"
    aria-label="Refresh"
    @click="doRefresh"
  >
    <span
      v-if="hasPendingChange"
      class="kv:absolute kv:top-0.75 kv:right-0.75 kv:size-1.5 kv:rounded-full kv:bg-focus"
      aria-hidden="true"
    ></span>
  </KuiButton>
</template>
