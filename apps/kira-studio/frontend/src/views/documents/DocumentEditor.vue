<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { useShortcut } from '@workbench/shortcuts/useShortcut';
import { useTemplateRef } from 'vue';
import MonacoHost from '../../editor/MonacoHost.vue';
import EditBufferActions from '../shared/EditBufferActions.vue';
import type { EditBuffer } from '../shared/useEditBuffer';

// The JSON editor with its buffer actions and Save / Cancel, for a new or an edited document.
const props = defineProps<{ buffer: EditBuffer; testidPrefix: string; saving: boolean }>();
const emit = defineEmits<{ save: []; cancel: [] }>();

const rootEl = useTemplateRef<HTMLElement>('rootEl');
useShortcut(rootEl, ['form.save'], () => emit('save'));
</script>

<template>
  <div ref="rootEl" class="flex min-h-0 flex-1 flex-col">
    <MonacoHost :doc="props.buffer.doc.value" language="json" @update:doc="props.buffer.writeDoc" />
    <div class="flex shrink-0 items-center gap-1.5 border-t border-border py-1 px-2">
      <EditBufferActions
        :buffer="props.buffer"
        :testid-prefix="testidPrefix"
        :show-compact="false"
      />
      <span class="flex-1 min-w-0"></span>
      <Button
        variant="toolbar-primary"
        size="kira"
        :pending="saving"
        :data-testid="`${testidPrefix}-save`"
        @click="emit('save')"
        >{{
          t('common.action.save.label')
        }}</Button
      >
      <Button
        variant="toolbar"
        size="kira"
        :data-testid="`${testidPrefix}-cancel`"
        @click="emit('cancel')"
        >{{
          t('common.action.cancel.label')
        }}</Button
      >
    </div>
  </div>
</template>
