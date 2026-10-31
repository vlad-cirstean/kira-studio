<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import SplitButton from '@theme/components/SplitButton.vue';
import { DropdownMenuContent, DropdownMenuItem } from '@theme/components/ui/dropdown-menu';
import { t } from '@theme/i18n';
import { toRef } from 'vue';
import type { ProofTab } from './tabHost';
import { useProofScreenshot } from './useProofScreenshot';

// Primary action copies the active tab; the menu adds all tabs, in order, and saving as PNG.
const props = defineProps<{
  target: HTMLElement | null;
  tabs: ProofTab[];
  sessionName: string;
}>();
const shot = useProofScreenshot({
  target: toRef(props, 'target'),
  tabs: toRef(props, 'tabs'),
  sessionName: toRef(props, 'sessionName'),
});
</script>

<template>
  <SplitButton
    :tooltip="t('studio.proof.shot.copy.tooltip')"
    :chevron-label="t('studio.proof.shot.more.aria')"
    chevron-testid="proof-shot-more"
    :pending="shot.busy.value"
    :disabled="tabs.length === 0"
    data-testid="proof-shot"
    @click="shot.copy(false)"
  >
    <CodiconIcon name="device-camera" :size="13" />
    {{ t('studio.proof.shot.copy.label') }}
    <template #menu>
      <DropdownMenuContent align="end">
        <DropdownMenuItem data-testid="proof-shot-copy-all" @select="shot.copy(true)">
          {{ t('studio.proof.shot.copyAll.label') }}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="proof-shot-save" @select="shot.save(false)">
          {{ t('studio.proof.shot.save.label') }}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="proof-shot-save-all" @select="shot.save(true)">
          {{ t('studio.proof.shot.saveAll.label') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </template>
  </SplitButton>
</template>
