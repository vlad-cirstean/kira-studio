<script setup lang="ts">
import { computed } from 'vue';
import { activeTab, modeState } from '../../state/mode';
import { MODES } from '../modes';
import { TAB_VIEWS } from '../tabViews';

// P1 D6/C6: no active tab in the current mode falls back to that mode's own start component
// (StudioStart for Studio, http/HttpStart for Http) instead of a hardcoded <StudioStart />.
const modeStart = computed(() => MODES[modeState.active].start);
</script>

<template>
  <component :is="TAB_VIEWS[activeTab.kind]" v-if="activeTab" :key="activeTab.id" :tab="activeTab" />
  <component :is="modeStart" v-else />
</template>
