<script setup lang="ts">
import AppButton from './AppButton.vue';

// §8.4: a restored tab shows only this gate until pressed — nothing loads automatically. Every
// data/stream/keyvalue/document/definition/console view opens on exactly the same `.p-empty` +
// primary button shape while `needsReconnect` holds — item 4: this used to vary (StreamView alone
// showed an icon and a "Not connected" label; DefinitionView alone downgraded the button to
// `variant: 'default'`), which read as the gate looking different depending on which view you'd
// landed on for no reason tied to the view itself. Only the button's own testid varies now, since
// that's the one thing a caller genuinely needs to address independently.
withDefaults(
  defineProps<{
    buttonTestid: string;
    buttonLabel?: string;
    containerTestid: string;
  }>(),
  { buttonLabel: 'Reconnect & load' },
);

const emit = defineEmits<{ reconnect: [] }>();
</script>

<template>
  <div class="p-empty" :data-testid="containerTestid">
    <AppButton variant="primary" kind="dialog" :data-testid="buttonTestid" @click="emit('reconnect')">
      {{ buttonLabel }}
    </AppButton>
  </div>
</template>
