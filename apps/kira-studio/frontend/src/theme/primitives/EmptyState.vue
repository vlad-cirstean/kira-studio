<script setup lang="ts">
import CodiconIcon from '../CodiconIcon.vue';

// The `.p-empty` no-rows/no-messages/empty-list placeholder — icon + label, optionally one action
// via the default slot (LAW 15: "no matching rows" is the one case in the app that needs it — see
// ReconnectGate.vue for the older, bespoke button-bearing sibling this slot now generalises).
defineProps<{
  icon?: string;
  label?: string;
}>();
</script>

<template>
  <div class="p-empty">
    <CodiconIcon v-if="icon" :name="icon" :size="24" class="big" />
    <span v-if="label" class="label">{{ label }}</span>
    <slot />
  </div>
</template>
