<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Kbd } from '@theme/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { formatShortcut } from '@workbench/shortcuts/keys';

defineProps<{ editing: boolean; dirty: boolean; saving: boolean; locked: boolean }>();
defineEmits<{ edit: []; save: []; done: [] }>();
</script>

<template>
  <div class="ml-auto flex items-center gap-1.5">
    <Button
      v-if="!editing"
      variant="toolbar"
      size="kira"
      :disabled="locked"
      data-testid="repo-file-edit"
      @click="$emit('edit')"
    >
      {{ t('common.action.edit.label') }}
    </Button>
    <template v-else>
      <Badge v-if="dirty" variant="warn" data-testid="repo-file-modified">
        {{ t('common.state.unsavedChanges.status') }}
      </Badge>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira"
            :disabled="!dirty"
            :pending="saving"
            data-testid="repo-file-save"
            @click="$emit('save')"
          >
            {{ t('common.action.save.label') }}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ t('common.action.save.label') }} <Kbd>{{ formatShortcut('form.save') }}</Kbd>
        </TooltipContent>
      </Tooltip>
      <Button
        variant="toolbar"
        size="kira"
        :disabled="locked"
        data-testid="repo-file-done"
        @click="$emit('done')"
      >
        {{ t('common.done.status') }}
      </Button>
    </template>
  </div>
</template>
