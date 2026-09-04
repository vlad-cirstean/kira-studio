<script setup lang="ts">
import { activeTab } from '../../state/mode';
import { TAB_VIEWS } from '../tabViews';
import StudioStart from './StudioStart.vue';
</script>

<template>
  <component :is="TAB_VIEWS[activeTab.kind]" v-if="activeTab" :key="activeTab.id" :tab="activeTab" />
  <StudioStart v-else />
</template>
