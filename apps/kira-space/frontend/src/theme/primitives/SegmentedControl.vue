<script setup lang="ts" generic="T extends string | number">
// P6. Generic so each caller keeps its own literal union for `modelValue` (e.g. 'all' | 'running'
// | 'error', or a numeric page-size union) instead of widening to string. See
// theme/primitives/VirtualList.vue for this codebase's other precedent for a generic SFC.
//
// P99 Part 2 (§4.3/§6.2): declined reka-ui's ToggleGroup — its ToggleGroupItem `value` is typed
// `string`, so wiring it here would widen every one of this component's 33 callers off their own
// literal union onto `string`, a real type/behaviour change riding along with a styling
// conversion (§9.4 forbids it). Styling moved to Tailwind; `.p-seg` stays a marker.
withDefaults(
  defineProps<{
    modelValue: T;
    options: readonly { value: T; label: string; title?: string; testid?: string }[];
    size?: 'sm' | 'md';
    // M2 §7.2: the MCP tab's three permission rows disable (not hide) while mcpEnabled is false —
    // real disabled buttons, unlike a passed-through `disabled` attr (which would land on this
    // component's root div and do nothing, since a plain <div> has no such semantics).
    disabled?: boolean;
  }>(),
  { size: 'sm', disabled: false },
);

defineEmits<{ 'update:modelValue': [value: T] }>();
</script>

<template>
  <div
    class="p-seg inline-flex shrink-0 overflow-hidden rounded-kira-sm border border-border-strong"
    :class="[size === 'md' ? 'h-[var(--kira-control-h-lg)]' : 'h-[var(--kira-control-h)]']"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="flex items-center justify-center whitespace-nowrap border-0 bg-transparent px-[var(--kira-s-3)] text-[length:var(--kira-t-sm)] text-muted cursor-pointer [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border-strong disabled:cursor-default disabled:opacity-50"
      :class="{ 'on bg-input text-fg': opt.value === modelValue }"
      :disabled="disabled"
      v-tooltip="opt.title"
      :data-testid="opt.testid"
      @click="$emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
