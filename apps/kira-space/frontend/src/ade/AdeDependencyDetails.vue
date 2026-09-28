<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Textarea } from '@theme/components/ui/textarea';
import { ref, watch } from 'vue';
import { useAdeSetBlocker, useAdeUpdateDependency } from './mutations';
import { useAdeUiStore } from './state/adeUi';
import type { QueuePanel, QueuePanelDependency } from './useQueue';

// P135 §4.7: a dependency's own detail surface, replacing the tabbed shell (no changes/agents to
// show). Name/Waiting on/Expected by each commit through UpdateDependency the same blur/change rule
// `AdeDetailsTab`'s own Name grid uses. Blocks lists this dependency's own blocked items, unlinkable
// here (`AdeBlockerRow` is the mirror, on the blocked item's own panel).
const props = defineProps<{
  panel: QueuePanel;
  dependency: QueuePanelDependency;
  codeRepoId: string;
}>();

const adeUiStore = useAdeUiStore();
const updateDependency = useAdeUpdateDependency(() => props.codeRepoId);
const setBlocker = useAdeSetBlocker(() => props.codeRepoId);

function resetDrafts(): void {
  nameDraft.value = props.panel.title;
  waitingOnDraft.value = props.dependency.waitingOn;
  expectedByDraft.value = props.dependency.expectedBy ?? '';
}

// ---- Name (blur-commit, empty reverts) --------------------------------------------------------
const nameDraft = ref(props.panel.title);
function commitName(): void {
  const value = nameDraft.value.trim();
  if (value === '') {
    nameDraft.value = props.panel.title;
    return;
  }
  if (value !== props.panel.title) {
    void updateDependency.mutateAsync({
      codeRepoId: props.codeRepoId,
      id: props.panel.id,
      patch: { title: value },
    });
  }
}

// ---- Waiting on (blur-commit) -----------------------------------------------------------------
const waitingOnDraft = ref(props.dependency.waitingOn);
function commitWaitingOn(): void {
  if (waitingOnDraft.value !== props.dependency.waitingOn) {
    void updateDependency.mutateAsync({
      codeRepoId: props.codeRepoId,
      id: props.panel.id,
      patch: { waitingOn: waitingOnDraft.value },
    });
  }
}

// ---- Expected by (change-commit, empty clears) ------------------------------------------------
const expectedByDraft = ref(props.dependency.expectedBy ?? '');
function commitExpectedBy(): void {
  if (expectedByDraft.value !== (props.dependency.expectedBy ?? '')) {
    void updateDependency.mutateAsync({
      codeRepoId: props.codeRepoId,
      id: props.panel.id,
      patch: { expectedBy: expectedByDraft.value },
    });
  }
}

watch(() => props.panel.id, resetDrafts);

function selectItem(id: string): void {
  adeUiStore.select(props.codeRepoId, id);
}

function unlink(id: string): void {
  void setBlocker.mutateAsync({
    codeRepoId: props.codeRepoId,
    dependency: props.panel.id,
    item: id,
    linked: false,
  });
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-3.5 pb-3.5 pt-3 text-kira-sm"
    data-testid="ade-dependency-details"
  >
    <div class="flex flex-col gap-1">
      <label for="ade-dependency-name" class="text-kira-sm text-[#9a9ca5]">Name</label>
      <Input
        id="ade-dependency-name"
        v-model="nameDraft"
        data-testid="ade-dependency-name-input"
        @blur="commitName"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label for="ade-dependency-waiting-on" class="text-kira-sm text-[#9a9ca5]">Waiting on</label>
      <Textarea
        id="ade-dependency-waiting-on"
        v-model="waitingOnDraft"
        placeholder="What's this waiting on?"
        data-testid="ade-dependency-waiting-on-input"
        @blur="commitWaitingOn"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label for="ade-dependency-expected-by" class="text-kira-sm text-[#9a9ca5]">Expected by</label>
      <Input
        id="ade-dependency-expected-by"
        v-model="expectedByDraft"
        type="date"
        data-testid="ade-dependency-expected-by-input"
        @change="commitExpectedBy"
      />
    </div>

    <p v-if="dependency.late" class="text-kira-sm text-[#f28b7d]" data-testid="ade-dependency-late">
      {{ dependency.lateTip }}
    </p>
    <p v-else-if="dependency.neededByLabel" class="text-kira-sm text-muted-foreground">
      needed by {{ dependency.neededByLabel }}
    </p>

    <div class="flex flex-col gap-1.5">
      <span class="text-kira-sm text-[#9a9ca5]">Blocks</span>
      <div
        v-if="dependency.blocks.length"
        class="flex flex-wrap gap-1.5"
        data-testid="ade-dependency-blocks"
      >
        <Badge
          v-for="b in dependency.blocks"
          :key="b.id"
          class="cursor-pointer gap-1"
          :data-testid="`ade-dependency-block-${b.id}`"
          @click="selectItem(b.id)"
        >
          {{ b.title }}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            class="size-4 p-0"
            :data-testid="`ade-dependency-unlink-${b.id}`"
            @click.stop="unlink(b.id)"
            >×</Button
          >
        </Badge>
      </div>
      <span v-else class="text-kira-sm text-muted-foreground">Nothing linked</span>
    </div>
  </div>
</template>
