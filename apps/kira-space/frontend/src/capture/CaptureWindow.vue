<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { FieldDescription } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Kbd } from '@theme/components/ui/kbd';
import { Label } from '@theme/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { t } from '@theme/i18n';
import { useEventListener, useWindowFocus } from '@vueuse/core';
import { useFocusOnMount } from '@workbench/behaviour/focus';
import { errorText } from '@workbench/bridge/codedError';
import { windowKey } from '@workbench/bridge/rpc';
import { type ComponentPublicInstance, computed, ref, useTemplateRef, watch } from 'vue';
import { useConfirmCapture, useDismissCapture } from './queries';
import { useCaptureWindowStore } from './state';
import type { CaptureAction, CaptureItem } from './wire';

// The quick-capture popup: what the clipboard held and the actions that fit it, first preselected.
// Enter confirms, Esc or losing focus dismisses.
const store = useCaptureWindowStore();
const item = computed(() => store.item as CaptureItem);

const selected = ref<CaptureAction | ''>('');
const title = ref('');
const confirm = useConfirmCapture();
const dismiss = useDismissCapture();

// A pushed item replaces the content and clears the last error.
watch(
  item,
  (next) => {
    selected.value = next.actions[0] ?? '';
    title.value = next.title;
    confirm.reset();
  },
  { immediate: true },
);

const isEmpty = computed(() => item.value.kind === 'empty');
const showTitle = computed(() => selected.value === 'later');
const error = computed(() => (confirm.error.value ? errorText(confirm.error.value) : ''));

function close(): void {
  dismiss.mutate(windowKey);
}

function run(): void {
  if (isEmpty.value) {
    close();
    return;
  }
  if (selected.value === '' || confirm.isPending.value) return;
  confirm.mutate({
    windowKey,
    itemId: item.value.id,
    action: selected.value,
    title: title.value,
  });
}

useEventListener(window, 'keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'Enter') {
    e.preventDefault();
    run();
  }
});

// Losing focus after having it dismisses; a panel that never got focus stays.
const focused = useWindowFocus();
watch(focused, (now, before) => {
  if (before && !now) close();
});

// A file dropped on the popup must not navigate the webview to it.
useEventListener(window, ['dragover', 'drop'], (e) => e.preventDefault());

const titleInput = useTemplateRef<ComponentPublicInstance>('titleInput');
useFocusOnMount(titleInput);
</script>

<template>
  <div
    class="flex h-full flex-col gap-2 bg-chrome p-3 text-fg"
    :aria-label="t('space.capture.window.label')"
    data-testid="capture-window"
  >
    <template v-if="isEmpty">
      <FieldDescription data-testid="capture-empty">{{
        t('space.capture.empty.body')
      }}</FieldDescription>
      <div class="mt-auto flex justify-end">
        <Button
          variant="dialog-primary"
          size="kira-lg"
          data-testid="capture-dismiss"
          @click="close"
        >
          {{ t('common.action.dismiss.label') }}
        </Button>
      </div>
    </template>
    <template v-else>
      <div v-if="item.label" class="flex items-center gap-2">
        <Badge data-testid="capture-label">{{ item.label }}</Badge>
      </div>
      <pre
        class="max-h-28 overflow-hidden whitespace-pre-wrap break-all font-ui text-kira-md"
        data-testid="capture-text"
      >{{ item.text }}</pre>
      <FieldDescription v-if="item.truncated" data-testid="capture-truncated">{{
        t('space.capture.truncated.body')
      }}</FieldDescription>
      <RadioGroup
        v-model="selected"
        class="flex flex-col gap-1"
        :aria-label="t('space.capture.actions.label')"
        data-testid="capture-actions"
      >
        <div v-for="action in item.actions" :key="action" class="flex items-center gap-2">
          <RadioGroupItem
            :id="`capture-action-${action}`"
            :value="action"
            :data-testid="`capture-action-${action}`"
          />
          <Label :for="`capture-action-${action}`">{{
            t(`space.capture.action.${action}.label`)
          }}</Label>
        </div>
      </RadioGroup>
      <Input
        v-if="showTitle"
        ref="titleInput"
        v-model="title"
        :aria-label="t('space.capture.title.label')"
        :placeholder="t('space.capture.title.label')"
        data-testid="capture-title"
      />
      <Alert v-if="error" variant="error" data-testid="capture-error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <FieldDescription class="mt-auto flex items-center justify-end gap-3">
        <span
          ><Kbd>{{ t('common.key.enter.label') }}</Kbd>
          {{ t('space.capture.hint.confirm.label') }}</span
        >
        <span
          ><Kbd>{{ t('common.key.escape.label') }}</Kbd>
          {{ t('common.action.close.label') }}</span
        >
      </FieldDescription>
    </template>
  </div>
</template>
