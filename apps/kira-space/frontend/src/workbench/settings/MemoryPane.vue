<script setup lang="ts">
import ClaudeCodeMcpSection from '@workbench/memory/settings/ClaudeCodeMcpSection.vue';
import DictationModelSection from '@workbench/memory/settings/DictationModelSection.vue';
import SemanticModelSection from '@workbench/memory/settings/SemanticModelSection.vue';
import type { SettingsPaneProps } from './types';

// P221: memory setup actions. Bypasses draft/Save like ConnectedEditorsPane: a registration or a
// model download is an action, not a settings leaf.
defineProps<SettingsPaneProps>();
</script>

<template>
  <div class="contents" v-show="active">
    <ClaudeCodeMcpSection />
    <SemanticModelSection />
    <DictationModelSection />
  </div>
</template>
