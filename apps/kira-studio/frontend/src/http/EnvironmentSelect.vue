<script setup lang="ts">
import { onMounted } from 'vue';
import {
  activeEnvironmentId,
  initVariables,
  setActiveEnvironment,
  variablesState,
} from './state/variables';

// P5 D11: the switcher — a `.p-select.bordered` listing "No environment" and every environment by
// name, mounted in HttpRequestView.vue's existing `#toolbar-2` slot, right-aligned via `.p-push`
// beside the request-pane SegmentedControl. The left panel's header and the title bar were both
// weighed and declined (§ D11): environments exist independently of collections, so the switcher
// must stay visible with none, and the title bar is shared chrome Http must not grow into.
onMounted(initVariables);

function onChange(e: Event): void {
  void setActiveEnvironment((e.target as HTMLSelectElement).value);
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
  </select>
</template>
