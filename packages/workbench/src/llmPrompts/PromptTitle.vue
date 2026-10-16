<script setup lang="ts">
import type { LlmPromptView } from '@shared/domain/llmPrompts';
import { type MessageKey, t } from '@theme/i18n';

// Tool and argument entries are named by their identifier; the rest by a catalog title.
defineProps<{ view: Pick<LlmPromptView, 'kind' | 'name' | 'titleKey'> }>();
</script>

<template>
  <span v-if="view.kind === 'tool' || view.kind === 'argument'" class="font-data">{{
    view.name
  }}</span>
  <span v-else>{{ t(view.titleKey as MessageKey) }}</span>
</template>
