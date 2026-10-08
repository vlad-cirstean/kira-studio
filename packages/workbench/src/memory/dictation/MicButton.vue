<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@theme/components/ui/popover';
import { Progress } from '@theme/components/ui/progress';
import { computed, ref } from 'vue';
import { useDictationStatus, useInstallDictationModel, useRetryDictation } from '../queries';
import { useDictation } from './useDictation';

// P216: the dictation mic for one text input. Hidden when the host cannot dictate; otherwise a
// download prompt, progress, a failure with retry, or the record toggle. Live text lands in `model`.
const props = defineProps<{
  /** Names the input in the dictation store; unique per mounted input. */
  targetId: string;
  input: () => HTMLInputElement | HTMLTextAreaElement | null;
  maxLength?: number;
}>();
const model = defineModel<string>({ required: true });

const MB = 1024 * 1024;

const status = useDictationStatus();
const install = useInstallDictationModel();
const retry = useRetryDictation();
const dictation = useDictation({ id: props.targetId, model, input: props.input, maxLength: props.maxLength });

const data = computed(() => status.data.value);
const state = computed(() => data.value?.state ?? 'off');
const percent = computed(() => {
  const d = data.value;
  return d && d.total > 0 ? Math.min(100, (d.done / d.total) * 100) : 0;
});
const popoverOpen = ref(false);
const busyPhase = computed(() => dictation.mine.value && ['starting', 'finishing'].includes(dictation.phase.value));
const label = computed(() => (dictation.recording.value ? 'Stop dictation' : 'Start dictation'));
const icon = computed(() => {
  if (busyPhase.value || state.value === 'downloading') return 'loading codicon-modifier-spin';
  return dictation.recording.value ? 'mic-filled' : 'mic';
});

let abort: AbortController | null = null;
function download(): void {
  abort = new AbortController();
  install.mutate(abort.signal);
}
function cancelDownload(): void {
  abort?.abort();
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
      <template v-if="state === 'notInstalled'">
        <p class="m-0">Dictation runs a local speech model: 182 MB download, about 340 MB RAM while in use.</p>
        <p v-if="install.isError.value" class="m-0 text-error" data-testid="dictation-error">
          {{ install.error.value?.message }}
        </p>
        <Button size="xs" variant="outline" class="self-start" data-testid="dictation-download" @click="download">
          {{ install.isError.value ? 'Retry download' : 'Download model' }}
        </Button>
      </template>
      <template v-else-if="state === 'downloading' && data">
        <span data-testid="dictation-progress-label">
          Downloading {{ (data.done / MB).toFixed(0) }} / {{ (data.total / MB).toFixed(0) }} MB
        </span>
        <Progress :model-value="percent" />
        <Button size="xs" variant="outline" class="self-start" data-testid="dictation-cancel-download" @click="cancelDownload">
          Cancel
        </Button>
      </template>
      <template v-else-if="state === 'unavailable'">
        <p class="m-0 text-error" data-testid="dictation-unavailable">
          Dictation unavailable: {{ data?.message }}
        </p>
        <Button size="xs" variant="outline" class="self-start" data-testid="dictation-retry" @click="retry.mutate()">
          <CodiconIcon name="refresh" :size="12" />
          Retry
        </Button>
      </template>
    </PopoverContent>
  </Popover>
</template>
