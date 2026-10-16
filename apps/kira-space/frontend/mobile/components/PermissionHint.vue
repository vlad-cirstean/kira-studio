<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { t } from '@theme/i18n';

// Names the desktop pane that turns a phone permission on; the phone cannot grant it itself.
defineProps<{ what: string }>();
</script>

<template>
  <Alert variant="info" strip data-testid="permission-hint">
    <AlertDescription> {{ what }} {{ t('mobile.permission.allow.hint') }} </AlertDescription>
  </Alert>
</template>
