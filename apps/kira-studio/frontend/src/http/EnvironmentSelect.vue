<script setup lang="ts">
import { onMounted } from 'vue';
import {
  activeEnvironmentId,
  initVariables,
  openEnvironmentsDialog,
  setActiveEnvironment,
  variablesState,
} from './state/variables';

// P5 D11: the switcher — a `.p-select.bordered` listing "No environment", every environment by
// name, and a trailing "Manage environments…" option — mounted in HttpRequestView.vue's existing
// `#toolbar-2` slot, right-aligned via `.p-push` beside the request-pane SegmentedControl. The
// left panel's header and the title bar were both weighed and declined (§ D11): environments exist
// independently of collections, so the switcher must stay visible with none, and the title bar is
// shared chrome Http must not grow into.
onMounted(initVariables);

const MANAGE = '__manage__';

function onChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value;
  if (value === MANAGE) {
    openEnvironmentsDialog();
    return; // the <select> itself reverts to activeEnvironmentId on the next render
  }
  void setActiveEnvironment(value);
}
</script>

<template>
  <select
    class="p-select bordered p-push"
    data-testid="http-environment-select"
    :value="activeEnvironmentId"
    @change="onChange"
  >
    <option value="">No environment</option>
    <option v-for="env in variablesState.environments" :key="env.id" :value="env.id">
      {{ env.name }}
    </option>
    <option :value="MANAGE" data-testid="http-environment-manage">Manage environments…</option>
  </select>
</template>
