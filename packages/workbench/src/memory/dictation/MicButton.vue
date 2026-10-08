<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@theme/components/ui/popover';
import { computed, ref } from 'vue';
import { useMemoryModule } from '../module';
import { useDictationStatus } from '../queries';
import { useDictation } from './useDictation';

// P216: the dictation mic for one text input. Hidden when the host cannot dictate; otherwise the
// record toggle, or a popover pointing to Settings while the model is not ready (P221). Live text lands in `model`.
const props = defineProps<{
  /** Names the input in the dictation store; unique per mounted input. */
  targetId: string;
  input: () => HTMLInputElement | HTMLTextAreaElement | null;
  maxLength?: number;
}>();
const model = defineModel<string>({ required: true });

const MB = 1024 * 1024;

const status = useDictationStatus();
const { openSettings } = useMemoryModule();
const dictation = useDictation({ id: props.targetId, model, input: props.input, maxLength: props.maxLength });

const data = computed(() => status.data.value);
const state = computed(() => data.value?.state ?? 'off');
const popoverOpen = ref(false);
const busyPhase = computed(() => dictation.mine.value && ['starting', 'finishing'].includes(dictation.phase.value));
const label = computed(() => (dictation.recording.value ? 'Stop dictation' : 'Start dictation'));
const icon = computed(() => {
  if (busyPhase.value || state.value === 'downloading') return 'loading codicon-modifier-spin';
  return dictation.recording.value ? 'mic-filled' : 'mic';
});

function goToSettings(): void {
  popoverOpen.value = false;
  openSettings();
}
function onClick(): void {
  if (state.value === 'ready') dictation.toggle();
  else popoverOpen.value = !popoverOpen.value;
}
</script>

<template>
  <Popover v-if="state !== 'off'" v-model:open="popoverOpen">
    <PopoverAnchor as-child>
      <span class="relative inline-flex">
        <span
          v-if="dictation.recording.value"
          class="pointer-events-none absolute inset-0 rounded-kira bg-error/30"
          :style="{ transform: `scale(${1 + dictation.level.value * 0.8})`, opacity: 0.4 + dictation.level.value * 0.6 }"
          data-testid="dictation-pulse"
        />
        <TooltipIconButton
          :icon="icon"
          :label="label"
          :class="{ 'relative text-error': dictation.recording.value }"
          :aria-pressed="dictation.recording.value"
          :disabled="dictation.blocked.value || busyPhase"
          :data-testid="`dictation-mic-${targetId}`"
          :data-state="state"
          @click="onClick"
        />
      </span>
    </PopoverAnchor>
    <PopoverContent v-if="state !== 'ready'" class="w-64" data-testid="dictation-popover">
      <p v-if="state === 'notInstalled'" class="m-0">Dictation needs a local speech model.</p>
      <p v-else-if="state === 'downloading' && data" class="m-0" data-testid="dictation-progress-label">
        Downloading the speech model: {{ (data.done / MB).toFixed(0) }} / {{ (data.total / MB).toFixed(0) }} MB
      </p>
      <p v-else-if="state === 'unavailable'" class="m-0 text-error" data-testid="dictation-unavailable">
        Dictation unavailable: {{ data?.message }}
      </p>
      <Button size="xs" variant="link" class="h-auto self-start p-0" data-testid="dictation-open-settings" @click="goToSettings">
        Open Settings
      </Button>
    </PopoverContent>
  </Popover>
</template>
