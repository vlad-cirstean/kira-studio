<script setup lang="ts">
import { appAnnouncement } from '../behaviour/liveRegion';
</script>

<template>
  <div class="sr-only" role="status" aria-live="polite" data-testid="app-live-region">
    {{ appAnnouncement }}
  </div>
</template>
