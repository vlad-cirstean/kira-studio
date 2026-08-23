<script setup lang="ts">
import { ref, useAttrs } from 'vue';
import Codicon from '../Codicon.vue';

// P4. inheritAttrs is off because the one attribute every call site actually needs to land
// correctly — data-testid — belongs on the real <input> a test drives, not on this wrapping
// <span class="p-input"> (the element .p-input's CSS actually styles as a bordered box).
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue: string;
    type?: 'text' | 'password' | 'number';
    icon?: string;
    prefix?: string;
    placeholder?: string;
    size?: 'sm' | 'md';
    ui?: boolean;
    invalid?: boolean;
  }>(),
  { size: 'sm', type: 'text' },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  enter: [];
  blur: [event: FocusEvent];
}>();

const attrs = useAttrs();
const inputRef = ref<HTMLInputElement | null>(null);

// The native spinner is hidden (see .p-input input[type='number'] below) and replaced with
// stepBtn below — stepUp()/stepDown() already honour the element's own min/max/step attrs,
// so this needs no min/max parsing of its own. Dispatching real input/change events (rather
// than emitting update:modelValue directly) keeps both v-model callers and the plain
// @change="..." callers (SettingsDialog) working exactly as they would for a native spinner.
function stepBy(dir: 1 | -1): void {
  const el = inputRef.value;
  if (!el || props.type !== 'number' || 'disabled' in attrs) return;
  if (dir > 0) el.stepUp();
  else el.stepDown();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
</script>

<template>
  <span
    class="p-input"
    :class="{ md: size === 'md', ui, 'is-invalid': invalid, 'has-stepper': type === 'number' }"
    :style="invalid ? { borderColor: 'var(--kira-error)' } : undefined"
  >
    <span v-if="icon" class="icon-box"><Codicon :name="icon" :size="13" /></span>
    <span v-if="prefix" class="ph">{{ prefix }}</span>
    <input
      v-bind="$attrs"
      ref="inputRef"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('enter')"
      @blur="emit('blur', $event)"
    />
    <span v-if="type === 'number'" class="stepper">
      <button
        type="button"
        class="step-btn"
        tabindex="-1"
        aria-hidden="true"
        @mousedown.prevent="stepBy(1)"
      >
        <Codicon name="chevron-up" :size="9" />
      </button>
      <button
        type="button"
        class="step-btn"
        tabindex="-1"
        aria-hidden="true"
        @mousedown.prevent="stepBy(-1)"
      >
        <Codicon name="chevron-down" :size="9" />
      </button>
    </span>
  </span>
</template>
