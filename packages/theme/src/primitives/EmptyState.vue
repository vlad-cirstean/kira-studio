<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';

// The `.p-empty` no-rows/no-messages/empty-list placeholder — icon + label, optionally one action
// via the default slot (LAW 15: "no matching rows" is the one case in the app that needs it — see
// ReconnectGate.vue for the older, bespoke button-bearing sibling this slot now generalises).
// Kept as a wrapper — callers span Parts 2-4 (§6.2). `.p-empty` stays a marker.
defineProps<{
  icon?: string;
  label?: string;
}>();
</script>

<template>
  <div
    class="p-empty flex flex-1 min-h-0 flex-col items-center justify-center gap-[var(--kira-s-4)] text-subtle"
  >
    <CodiconIcon v-if="icon" :name="icon" :size="24" class="big h-6 w-6" />
    <span v-if="label" class="label text-[length:var(--kira-t-md)] text-muted">{{ label }}</span>
    <slot />
  </div>
</template>
