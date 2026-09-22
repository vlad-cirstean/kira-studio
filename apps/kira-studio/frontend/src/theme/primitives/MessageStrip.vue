<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';

// The `.p-strip` message banner (warn/err/note) used above a view's body. `note` (the informational
// tone — P8's response-history viewing band and storage notices, D10) reuses DefinitionView's own
// `.p-strip.note` CSS class rather than adding a new one (§0.3/§3: no theme/primitives/ addition) —
// DefinitionView itself still renders its own inline `<div class="p-strip note">` rather than this
// component, so this is the class gaining its second, real consumer rather than its first. Not
// every call site shows an icon (KeyValueView/DocumentView/ConsoleView's error strips are plain
// text), so `icon` is left undefined rather than defaulted per tone — a default would put an
// icon-box where none exists today.
//
// Kept as a wrapper (not inlined at call sites) — its 40+ callers span Parts 2-4, and deleting it
// would force edits outside this part (§6.2). `.p-strip` stays a marker; styling moved to Tailwind.
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
  <div
    class="p-strip shrink-0 flex items-start gap-[var(--kira-s-3)] px-[var(--kira-s-4)] py-[var(--kira-s-3)] text-[length:var(--kira-t-sm)] leading-[1.45] border-b border-border"
    :class="[
      tone,
      tone === 'err' && 'bg-error/10 text-[#f3a3a3]',
      tone === 'warn' && 'bg-warn/10 text-[#d9c47a]',
      tone === 'note' && 'bg-info/8 text-[#a8c8ee]',
    ]"
  >
    <span v-if="icon" class="icon-box"><CodiconIcon :name="icon" :size="iconSize" /></span>
    <slot />
  </div>
</template>
