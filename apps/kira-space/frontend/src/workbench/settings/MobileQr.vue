<script setup lang="ts">
import { renderSVG } from 'uqr';
import { computed } from 'vue';

const props = defineProps<{ url: string }>();

// Generated from the app's own URL only, so v-html never sees foreign markup.
const svg = computed(() => renderSVG(props.url, { border: 2, ecc: 'M' }));
</script>

<template>
  <div class="size-36 shrink-0 rounded-kira-sm bg-white p-0.5 [&>svg]:size-full" role="img" :aria-label="`QR code for ${url}`" v-html="svg" />
</template>
