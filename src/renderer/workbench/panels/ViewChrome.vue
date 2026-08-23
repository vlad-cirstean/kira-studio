<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { connectionsState } from '../../state/connections';
import { useRunState } from '../../state/runState';
import IconButton from '../../theme/primitives/IconButton.vue';
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
  // Forwarded to ViewHeader — see its own props for what each targets. refreshTestid/stopTestid
  // cover the two built-in buttons below, which predate this component and had per-view names.
  targetTestid?: string;
  nameTestid?: string;
  refreshTestid?: string;
  stopTestid?: string;
}>();

const emit = defineEmits<{ refresh: []; stop: [] }>();

const connection = computed(() =>
  connectionsState.records.find((r) => r.id === props.tab.connectionId),
);

const runState = useRunState(() => props.tab.id);
</script>

<template>
  <ViewHeader
    :icon="icon"
    :icon-color="iconColor"
    :path="path"
    :name="name"
    :conn-color="connection?.color ?? null"
    :target-testid="targetTestid"
    :name-testid="nameTestid"
  >
    <slot name="badges" />
    <template #trailing>
      <slot name="head-trailing" />
    </template>
  </ViewHeader>

  <div class="p-toolbar-rail" :style="{ '--kira-rail': connection?.color ? `var(--kira-conn-${connection.color})` : undefined }" />
  <div class="p-toolbar" :class="{ last: !$slots['toolbar-2'] }">
    <div class="group">
      <IconButton icon="refresh" :size="13" title="Refresh" :data-testid="refreshTestid" :disabled="canRefresh === false" @click="emit('refresh')" />
      <IconButton icon="debug-stop" :size="13" title="Stop" :data-testid="stopTestid" :disabled="!canStop" @click="emit('stop')" />
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
