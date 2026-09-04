<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { connectionRecord } from '../../state/connections';
import { useRunState } from '../../state/runState';
import { connColorVar } from '../connColor';
import IconButton from './IconButton.vue';
import RunState from './RunState.vue';
import ViewHeader from './ViewHeader.vue';

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
  // P48 D8: the grid's own `data-testid="data-toolbar"`/`"filter-toolbar"` (pre-dating this
  // component) survive on the bands themselves rather than a nested `.p-toolbar` the grid would
  // otherwise have to keep — nesting `.p-toolbar` inside `.p-toolbar` doubles the band height and
  // border.
  toolbarTestid?: string;
  toolbar2Testid?: string;
}>();

const emit = defineEmits<{ refresh: []; stop: [] }>();

// P2 D14/F8: `connection?.color ?? null` used to fold "no connection at all" (an HTTP request
// tab) and "a connection with no colour assigned" into the same `null` — ViewHeader's own
// `connColor !== undefined` guard then rendered a dot for both. `undefined` only for the former.
const connection = computed(() => connectionRecord(props.tab.connectionId));

const runState = useRunState(() => props.tab.id);
</script>

<template>
  <ViewHeader
    :icon="icon"
    :icon-color="iconColor"
    :path="path"
    :name="name"
    :conn-color="connection ? (connection.color ?? null) : undefined"
    :conn-kind="connection?.kind"
    :target-testid="targetTestid"
    :name-testid="nameTestid"
  >
    <slot name="badges" />
    <template #trailing>
      <slot name="head-trailing" />
    </template>
  </ViewHeader>

  <div class="p-toolbar-rail" :style="{ '--kira-rail': connColorVar(connection?.color) }" />
  <div class="p-toolbar" :class="{ last: !$slots['toolbar-2'] }" :data-testid="toolbarTestid">
    <div class="group">
      <IconButton icon="refresh" v-tooltip="'Refresh'" :data-testid="refreshTestid" :disabled="canRefresh === false" @click="emit('refresh')" />
      <!-- DataToolbar.vue's hand-rolled Stop already tints itself red only while a cancellable op
           is in flight (`is-live`, keyed off the same boolean that also drives `disabled`) — this
           shared Stop never got that treatment, so every non-grid view's Stop looked identically
           muted whether idle or running. `canStop` is exactly "there is a live op to cancel", the
           same signal DataToolbar keys off, so it doubles as the is-live flag here too. -->
      <IconButton
        icon="debug-stop"
        :class="{ 'is-live': !!canStop }"
        v-tooltip="'Stop'"
        :data-testid="stopTestid"
        :disabled="!canStop"
        @click="emit('stop')"
      />
    </div>
    <slot name="toolbar" />
    <span class="p-push" />
    <div class="group">
      <slot name="toolbar-end" />
    </div>
    <!-- RunState sits last, after everything else in the toolbar (including toolbar-end): its
         label's width changes as elapsed time ticks up, and it must never be able to reflow
         controls to its left (see docs/design/kira-design-system LAW 12). -->
    <RunState :status="runState.status" :elapsed-ms="runState.elapsedMs" />
  </div>
  <div v-if="$slots['toolbar-2']" class="p-toolbar last" :data-testid="toolbar2Testid">
    <slot name="toolbar-2" />
  </div>

  <slot name="strips" />
  <slot />
</template>
