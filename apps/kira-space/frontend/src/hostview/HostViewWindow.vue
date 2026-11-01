<script setup lang="ts">
import { computed } from 'vue';
import ChangeRequestView from './ChangeRequestView.vue';
import { useHostViewWindowStore } from './state';

// The window root: the view for this window's target kind. An unknown kind renders nothing.
const store = useHostViewWindowStore();
const target = computed(() => store.target);
</script>

<template>
  <div class="h-full" data-testid="host-view-window">
    <ChangeRequestView v-if="target?.kind === 'changeRequest'" :target="target" />
  </div>
</template>
