<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Card } from '@theme/components/ui/card';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import { computed } from 'vue';
import { useCopy } from '../../behaviour/clipboard';
import QueryState from '../../components/QueryState.vue';
import { useMemoryCommentCheck } from '../queries';

// P273: the commands that install the kira-memory commit check in another repository.
const check = useMemoryCommentCheck();
const install = computed(() => check.data.value?.installCommand ?? '');
const hook = computed(() => check.data.value?.hookLine ?? '');
const installCopy = useCopy();
const hookCopy = useCopy();
</script>

<template>
  <FieldSet data-testid="memory-check-section">
    <FieldLegend>{{ t('memory.commentCheck.title') }}</FieldLegend>
    <FieldDescription>{{ t('memory.commentCheck.description') }}</FieldDescription>
    <QueryState :query="check" variant="inline" :is-empty="() => false">
      <template #error="{ message }">
        <Alert variant="error">
          <AlertDescription>{{ message }}</AlertDescription>
        </Alert>
      </template>
      <template v-if="install">
        <FieldDescription>{{ t('memory.commentCheck.install.hint') }}</FieldDescription>
        <Card
          class="font-data whitespace-pre-wrap break-all select-all text-kira-sm leading-normal"
          data-testid="memory-check-install"
          >{{
            install
          }}</Card
        >
        <div class="flex items-center gap-1">
          <Button
            variant="dialog"
            size="kira-lg"
            data-testid="memory-check-copy-install"
            @click="installCopy.copy(install)"
          >
            {{
              installCopy.copied.value
                ? t('common.copy.copied.announce')
                : t('common.copyCommand.label')
            }}
          </Button>
        </div>
        <FieldDescription>{{ t('memory.commentCheck.hook.hint') }}</FieldDescription>
        <Card
          class="font-data whitespace-pre-wrap break-all select-all text-kira-sm leading-normal"
          data-testid="memory-check-hook"
          >{{
            hook
          }}</Card
        >
        <div class="flex items-center gap-1">
          <Button
            variant="dialog"
            size="kira-lg"
            data-testid="memory-check-copy-hook"
            @click="hookCopy.copy(hook)"
          >
            {{
              hookCopy.copied.value
                ? t('common.copy.copied.announce')
                : t('common.copyCommand.label')
            }}
          </Button>
        </div>
      </template>
    </QueryState>
  </FieldSet>
</template>
