<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';

// Keys a soft keyboard lacks. Arrows honour the application cursor mode Claude Code may enable.
const props = defineProps<{ appCursor: boolean; ctrl: boolean }>();
const emit = defineEmits<{ key: [seq: string]; 'update:ctrl': [on: boolean] }>();

const arrow = (letter: string): string => (props.appCursor ? `\x1bO${letter}` : `\x1b[${letter}`);

const KEYS = [
  { id: 'esc', label: 'Esc', seq: () => '\x1b' },
  { id: 'tab', label: 'Tab', seq: () => '\t' },
  { id: 'shift-tab', label: 'Shift Tab', seq: () => '\x1b[Z' },
  { id: 'ctrl-c', label: 'Ctrl C', seq: () => '\x03' },
  { id: 'up', label: 'Up', icon: 'arrow-up', seq: () => arrow('A') },
  { id: 'down', label: 'Down', icon: 'arrow-down', seq: () => arrow('B') },
  { id: 'left', label: 'Left', icon: 'arrow-left', seq: () => arrow('D') },
  { id: 'right', label: 'Right', icon: 'arrow-right', seq: () => arrow('C') },
  { id: 'enter', label: 'Enter', seq: () => '\r' },
];
</script>

<template>
  <div class="flex gap-1 overflow-x-auto px-2 py-1 [scrollbar-width:none]" data-testid="term-keybar">
    <Button size="kira"
      variant="dialog"
      class="h-11 shrink-0 px-3"
      :class="ctrl ? 'bg-primary text-primary-foreground' : ''"
      :aria-pressed="ctrl"
      data-testid="term-key-ctrl"
      @click="emit('update:ctrl', !ctrl)"
    >
      Ctrl
    </Button>
    <Button size="kira"
      v-for="key in KEYS"
      :key="key.id"
      variant="dialog"
      class="h-11 shrink-0 px-3"
      :aria-label="key.label"
      :data-testid="`term-key-${key.id}`"
      @click="emit('key', key.seq())"
    >
      <CodiconIcon v-if="key.icon" :name="key.icon" :size="13" />
      <template v-else>{{ key.label }}</template>
    </Button>
  </div>
</template>
