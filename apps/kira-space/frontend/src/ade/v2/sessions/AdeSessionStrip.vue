<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { tabChipVariants } from '@theme/components/ui/tabs';
import { useMobileTerminalsStore } from '../../../state/mobileTerminals';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import { ACTION_CLASS } from '../tones';
import type { SessionView } from './sessionView';

// Tab strip of the running sessions in scope (mockup `termTabs`): activity glyph, TUI / claude -p
// badge, name.
defineProps<{ views: SessionView[]; selectedId: string | null }>();
const emit = defineEmits<{ pick: [id: string] }>();
const phones = useMobileTerminalsStore();
</script>

<template>
  <div class="flex shrink-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] border-b border-border bg-chrome px-1.5 py-1" data-testid="ade-session-strip">
    <Button
      v-for="v in views"
      :key="v.session.id"
      type="button"
      variant="toolbar"
      size="kira-lg"
      :class="[tabChipVariants({ active: v.session.id === selectedId }), 'font-data overflow-hidden']"
      :data-testid="`ade-session-tab-${v.session.id}`"
      :data-selected="v.session.id === selectedId || undefined"
      :data-mode="v.session.mode"
      @click="emit('pick', v.session.id)"
    >
      <AdeActivityIcon :kind="v.kind" />
      <span
        class="shrink-0 rounded-kira-xs px-1 text-kira-sm font-bold"
        :class="v.headless ? 'border border-dashed border-border-strong text-muted-foreground' : ACTION_CLASS.claude"
        data-testid="ade-session-badge"
        >{{ v.badge }}</span
      >
      <span class="min-w-0 truncate">{{ v.tabName }}</span>
      <CodiconIcon
        v-if="phones.holdOf(v.session.terminalId)"
        name="device-mobile"
        :size="12"
        class="shrink-0 text-muted-foreground"
        data-testid="ade-session-phone"
      />
    </Button>
  </div>
</template>
