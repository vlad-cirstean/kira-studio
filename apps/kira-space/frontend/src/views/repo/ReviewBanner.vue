<script setup lang="ts">
import { Alert, AlertAction, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';

defineProps<{ message: string; retryable: boolean }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="flex h-full items-center">
    <Alert :variant="retryable ? 'error' : 'info'">
      <AlertDescription>{{ message }}</AlertDescription>
      <AlertAction v-if="retryable" class="top-1/2 -translate-y-1/2">
        <Button variant="link" size="inline" @click="$emit('retry')">
          {{ t('common.action.retry.label') }}
        </Button>
      </AlertAction>
    </Alert>
  </div>
</template>
