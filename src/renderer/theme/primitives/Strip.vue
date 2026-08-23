<script setup lang="ts">
import Codicon from '../Codicon.vue';

// The `.p-strip` message banner (warn/err) used above a view's body — DefinitionView's own `note` tone
// has no consumer besides itself and stays inline there rather than widening this to a third
// tone. Not every call site shows an icon (KeyValueView/DocumentView/ConsoleView's error strips
// are plain text), so `icon` is left undefined rather than defaulted per tone — a default would
// put an icon-box where none exists today.
withDefaults(
  defineProps<{
    tone: 'warn' | 'err';
    icon?: string;
    iconSize?: number;
  }>(),
  { iconSize: 14 },
);
</script>

<template>
  <div class="p-strip" :class="tone">
    <span v-if="icon" class="icon-box"><Codicon :name="icon" :size="iconSize" /></span>
    <slot />
  </div>
</template>
