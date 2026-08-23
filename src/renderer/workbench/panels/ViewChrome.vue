<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { connectionsState } from '../../state/connections';
import { useRunState } from '../../state/runState';
import RunState from '../../theme/primitives/RunState.vue';
import ViewHeader from '../../theme/primitives/ViewHeader.vue';

// The view-head + rail + toolbar + run-state trio every non-grid view opens with (LAW 09/10/12
// in docs/design/kira-design-system). Refresh/Stop live here rather than in each view's own
// toolbar slot because "Stop always follows Refresh, disabled when idle" is a chrome-level rule,
// not a per-view choice — six views implementing it separately is exactly how three of them
// drifted into showing Stop only while running instead of merely disabling it.
const props = defineProps<{
  tab: TabRecord;
  icon: string;
  iconColor?: string;
  path?: string;
  name: string;
  canRefresh?: boolean;
  canStop?: boolean;
}>();

const emit = defineEmits<{ refresh: []; stop: [] }>();

const connection = computed(() =>
  connectionsState.records.find((r) => r.id === props.tab.connectionId),
);

const runState = useRunState(() => props.tab.id);
</script>

<template>
  <ViewHeader :icon="icon" :icon-color="iconColor" :path="path" :name="name" :conn-color="connection?.color ?? null">
    <slot name="badges" />
    <template #trailing>
      <slot name="head-trailing" />
    </template>
  </ViewHeader>

  <div class="p-toolbar-rail" :style="{ '--kira-rail': connection?.color ? `var(--kira-conn-${connection.color})` : undefined }" />
  <div class="p-toolbar" :class="{ last: !$slots['toolbar-2'] }">
    <div class="group">
      <button type="button" class="p-iconbtn" title="Refresh" :disabled="canRefresh === false" @click="emit('refresh')">
        <span class="icon-box"><svg class="icon" viewBox="0 0 16 16" width="13" height="13"><path d="M13 8A5 5 0 1 1 11.2 4.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M13 2.5V6H9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg></span>
      </button>
      <button type="button" class="p-iconbtn" title="Stop" :disabled="!canStop" @click="emit('stop')">
        <span class="icon-box"><svg class="icon" viewBox="0 0 16 16" width="13" height="13"><rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor"/></svg></span>
      </button>
      <RunState :status="runState.status" :elapsed-ms="runState.elapsedMs" />
    </div>
    <slot name="toolbar" />
    <span class="p-push" />
    <div class="group">
      <slot name="toolbar-end" />
    </div>
  </div>
  <div v-if="$slots['toolbar-2']" class="p-toolbar last">
    <slot name="toolbar-2" />
  </div>

  <slot name="strips" />
  <slot />
</template>
