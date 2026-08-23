<script setup lang="ts">
import Codicon from '../Codicon.vue';
import Button from './Button.vue';

// §8.4: a restored tab shows only this gate until pressed — nothing loads automatically. Every
// data/stream/keyvalue/document/ddl/console view opens on the same `.p-empty` + button shape
// while `needsReconnect` holds; only the icon/label (StreamView alone shows both) and the
// button's own testid/variant vary per view, which is why those are props rather than baked in.
withDefaults(
  defineProps<{
    icon?: string;
    label?: string;
    buttonTestid: string;
    buttonLabel?: string;
    containerTestid: string;
    variant?: 'default' | 'primary';
  }>(),
  { buttonLabel: 'Reconnect & load', variant: 'primary' },
);

const emit = defineEmits<{ reconnect: [] }>();
</script>

<template>
  <div class="p-empty" :data-testid="containerTestid">
    <Codicon v-if="icon" :name="icon" :size="24" class="big" />
    <span v-if="label" class="label">{{ label }}</span>
    <Button
      :variant="variant"
      kind="dialog"
      :data-testid="buttonTestid"
      @click="emit('reconnect')"
    >
      {{ buttonLabel }}
    </Button>
  </div>
</template>
