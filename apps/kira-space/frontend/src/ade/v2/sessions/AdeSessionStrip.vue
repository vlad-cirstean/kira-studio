<script setup lang="ts">
import AdeActivityIcon from '../AdeActivityIcon.vue';
import { actionStyle } from '../tones';
import type { SessionView } from './sessionView';

// Tab strip of the running sessions in scope (mockup `termTabs`): activity glyph, TUI / claude -p
// badge, name.
defineProps<{ views: SessionView[]; selectedId: string | null }>();
const emit = defineEmits<{ pick: [id: string] }>();
</script>

<template>
  <div class="flex shrink-0 overflow-x-auto border-b border-border bg-chrome" data-testid="ade-session-strip">
    <button
      v-for="v in views"
      :key="v.session.id"
      type="button"
      class="flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-0 border-r border-border px-3 font-data text-kira-sm"
      :class="v.session.id === selectedId ? 'bg-bg text-fg shadow-[inset_0_2px_0_var(--kira-accent)]' : 'bg-transparent text-muted-foreground'"
      :data-testid="`ade-session-tab-${v.session.id}`"
      :data-selected="v.session.id === selectedId || undefined"
      :data-mode="v.session.mode"
      @click="emit('pick', v.session.id)"
    >
      <AdeActivityIcon :kind="v.kind" />
      <span
        class="rounded-[3px] px-1 text-kira-sm font-bold"
        :class="v.headless ? 'border border-dashed border-border-strong text-muted-foreground' : ''"
        :style="v.headless ? undefined : actionStyle('claude')"
        data-testid="ade-session-badge"
        >{{ v.badge }}</span
      >
      {{ v.tabName }}
    </button>
  </div>
</template>
