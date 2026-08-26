<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue';
import CodiconIcon from '../CodiconIcon.vue';

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
    // Opt out of the up/down stepper a plain type="number" field otherwise gets — the pager's
    // page-jump box (DataToolbar.vue/DocumentView.vue) has no sensible "next page number" to
    // step to that Next/Prev don't already do better, and the stepper's width only cramps its
    // already-narrow 46px box.
    hideStepper?: boolean;
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
const showStepper = computed(() => props.type === 'number' && !props.hideStepper);

function stepBy(dir: 1 | -1): void {
  const el = inputRef.value;
  if (!el || !showStepper.value || 'disabled' in attrs) return;
  if (dir > 0) el.stepUp();
  else el.stepDown();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
</script>

<template>
  <span
    class="p-input"
    :class="{ md: size === 'md', ui, 'is-invalid': invalid, 'has-stepper': showStepper }"
  >
    <span v-if="icon" class="icon-box"><CodiconIcon :name="icon" :size="13" /></span>
    <span v-if="prefix" class="ph">{{ prefix }}</span>
    <input
      autocomplete="off"
      v-bind="$attrs"
      ref="inputRef"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('enter')"
      @blur="emit('blur', $event)"
    />
    <span v-if="showStepper" class="stepper">
      <button
        type="button"
        class="step-btn"
        tabindex="-1"
        aria-hidden="true"
        v-tooltip="'Increase'"
        @mousedown.prevent="stepBy(1)"
      >
        <CodiconIcon name="chevron-up" :size="9" />
      </button>
      <button
        type="button"
        class="step-btn"
        tabindex="-1"
        aria-hidden="true"
        v-tooltip="'Decrease'"
        @mousedown.prevent="stepBy(-1)"
      >
        <CodiconIcon name="chevron-down" :size="9" />
      </button>
    </span>
  </span>
</template>
