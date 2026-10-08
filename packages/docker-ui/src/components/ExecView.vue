<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { tabChipVariants } from '@theme/components/ui/tabs';
import TerminalHostView from '@workbench/terminal/TerminalHostView.vue';
import { computed, ref, watch } from 'vue';
import { useDocker } from '../context';
import { useDockerExecSessionsStore } from '../state/dockerExec';

const props = defineProps<{ containerId: string }>();

const ctx = useDocker();
const store = useDockerExecSessionsStore();
const sessions = computed(() => store.forContainer(props.containerId));
const activeId = ref('');

function openSession(): void {
  activeId.value = store.open(ctx, props.containerId).id;
}

function closeSession(id: string): void {
  store.close(ctx, id);
  if (activeId.value === id) activeId.value = sessions.value[0]?.id ?? '';
}

watch(
  () => props.containerId,
  () => {
    const first = sessions.value[0];
    if (first) activeId.value = first.id;
    else openSession();
  },
  { immediate: true },
);

// An exec session dies with its container; no chip is kept for a stopped one.
const hostTab = (id: string) => ({ id, state: { cwd: '', codeRepoId: '', command: '', launchKind: 'shell' as const } });
</script>

<template>
  <div class="flex h-full flex-col" data-testid="docker-exec">
    <div class="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
      <span
        v-for="s in sessions"
        :key="s.id"
        :class="tabChipVariants({ active: s.id === activeId })"
        data-testid="docker-exec-chip"
      >
        <button type="button" class="cursor-default" @click="activeId = s.id">{{ s.title }}</button>
        <TooltipIconButton
          icon="close"
          :icon-size="12"
          :label="`Close ${s.title}`"
          data-testid="docker-exec-close"
          @click="closeSession(s.id)"
        />
      </span>
      <Button variant="ghost" size="xs" data-testid="docker-exec-new" @click="openSession">
        <CodiconIcon name="add" :size="12" />
        New session
      </Button>
    </div>
    <div class="relative min-h-0 flex-1">
      <div
        v-for="s in sessions"
        :key="s.id"
        v-show="s.id === activeId"
        class="absolute inset-0"
        :data-testid="`docker-exec-pane`"
      >
        <TerminalHostView :tab="hostTab(s.id)" :deps="ctx.execHostDeps" />
      </div>
    </div>
  </div>
</template>
