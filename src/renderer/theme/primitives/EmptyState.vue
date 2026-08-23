<script setup lang="ts">
import Codicon from '../Codicon.vue';

// The `.p-empty` no-rows/no-messages/empty-list placeholder — icon + label, no action (see
// ReconnectGate.vue for the button-bearing sibling of this pattern). No current call site puts
// anything besides icon+label inside it, so this stays props-only rather than growing a default
// slot no one uses.
defineProps<{
  icon?: string;
  label?: string;
}>();
</script>

<template>
  <div class="p-empty">
    <Codicon v-if="icon" :name="icon" :size="24" class="big" />
    <span v-if="label" class="label">{{ label }}</span>
  </div>
</template>
