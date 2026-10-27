<script setup lang="ts">
import ResizeHandle from '@theme/components/ui/resizable/ResizeHandle.vue';
import { t } from '@theme/i18n';
import { useElementSize, useWindowSize } from '@vueuse/core';
import { ref } from 'vue';
import type { DialogSize } from './resizeSize';

// Only a `resizable` DialogContent mounts this, so other dialogs hold no observer or listener.
const props = defineProps<{ target: HTMLElement | null | undefined }>();
const size = defineModel<DialogSize>({ required: true });

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
// Same bounds as the size variant's `max-w-[90vw] max-h-4/5`.
const MAX_WIDTH_RATIO = 0.9;
const MAX_HEIGHT_RATIO = 0.8;

const measured = useElementSize(() => props.target, undefined, { box: 'border-box' });
const { width: viewportWidth, height: viewportHeight } = useWindowSize();
// The size to return to when a drag aborts; moves only on commit.
const committed = ref<DialogSize>({ ...size.value });

function set(axis: 'width' | 'height', v: number): void {
  size.value = { ...size.value, [axis]: v };
}
function commit(axis: 'width' | 'height', v: number): void {
  set(axis, v);
  committed.value = { ...committed.value, [axis]: v };
}
function cancel(axis: 'width' | 'height'): void {
  size.value = { ...size.value, [axis]: committed.value[axis] };
}
</script>

<template>
  <!-- The dialog is centred, so an edge moves half the size change: scale 2 keeps it under the pointer. -->
  <ResizeHandle
    axis="x"
    class="absolute inset-y-0 right-0"
    data-testid="dialog-resize-x"
    :label="t('common.dialog.resizeWidth.label')"
    :size="size.width ?? measured.width.value"
    :min="MIN_WIDTH"
    :max="viewportWidth * MAX_WIDTH_RATIO"
    :scale="2"
    @live="(v) => set('width', v)"
    @commit="(v) => commit('width', v)"
    @cancel="cancel('width')"
  />
  <ResizeHandle
    axis="y"
    class="absolute inset-x-0 bottom-0"
    data-testid="dialog-resize-y"
    :label="t('common.dialog.resizeHeight.label')"
    :size="size.height ?? measured.height.value"
    :min="MIN_HEIGHT"
    :max="viewportHeight * MAX_HEIGHT_RATIO"
    :scale="2"
    @live="(v) => set('height', v)"
    @commit="(v) => commit('height', v)"
    @cancel="cancel('height')"
  />
</template>
