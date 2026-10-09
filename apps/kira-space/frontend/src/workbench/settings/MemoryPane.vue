<script setup lang="ts">
import LegacyClaudeConfigSection from '@workbench/claude/LegacyClaudeConfigSection.vue';
import ClaudeCodeMcpSection from '@workbench/memory/settings/ClaudeCodeMcpSection.vue';
import SemanticModelSection from '@workbench/memory/settings/SemanticModelSection.vue';
import { claudeLegacyControl } from '../../bridge/memoryControl';
import type { SettingsPaneProps } from './types';

// P221: memory setup actions. Bypasses draft/Save like ConnectedEditorsPane: a legacy cleanup or a
// model download is an action, not a settings leaf.
defineProps<SettingsPaneProps>();
</script>

<template>
  <div class="contents" v-show="active">
    <ClaudeCodeMcpSection />
    <LegacyClaudeConfigSection
      :load="claudeLegacyControl.load"
      :remove="claudeLegacyControl.remove"
      backup-dir="~/.kira-space/claude-config-backups"
    />
    <SemanticModelSection />
  </div>
</template>
