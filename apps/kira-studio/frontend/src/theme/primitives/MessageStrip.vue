<script setup lang="ts">
import CodiconIcon from '../CodiconIcon.vue';

// The `.p-strip` message banner (warn/err/note) used above a view's body. `note` (the informational
// tone — P8's response-history viewing band and storage notices, D10) reuses DefinitionView's own
// `.p-strip.note` CSS class rather than adding a new one (§0.3/§3: no theme/primitives/ addition) —
// DefinitionView itself still renders its own inline `<div class="p-strip note">` rather than this
// component, so this is the class gaining its second, real consumer rather than its first. Not
// every call site shows an icon (KeyValueView/DocumentView/ConsoleView's error strips are plain
// text), so `icon` is left undefined rather than defaulted per tone — a default would put an
// icon-box where none exists today.
withDefaults(
  defineProps<{
    tone: 'warn' | 'err' | 'note';
    icon?: string;
    iconSize?: number;
  }>(),
  { iconSize: 14 },
);
</script>

<template>
  <div class="p-strip" :class="tone">
    <span v-if="icon" class="icon-box"><CodiconIcon :name="icon" :size="iconSize" /></span>
    <slot />
  </div>
</template>
