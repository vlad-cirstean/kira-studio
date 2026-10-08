<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { useTimeAgo } from '@vueuse/core';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { computed, ref, watch } from 'vue';
import AdeChip from '../AdeChip.vue';
import { adeAgoOptions } from '../ago';
import { backlogPatch, parseGithub } from '../board/panelFacts';
import AdeNotesEditor from '../notes/AdeNotesEditor.vue';
import AdeLinkRow from '../panel/AdeLinkRow.vue';
import { type LinkPatch, useLinkFields } from '../panel/useLinkFields';
import { useUpdateBacklogItem } from '../queries';
import { TONE_SOLID_CLASS } from '../tones';
import type { BacklogItem } from '../wire';

// Detail of one backlog item: title, Jira and GitHub links, notes, and the promote and delete actions.
const props = defineProps<{ item: BacklogItem }>();
const emit = defineEmits<{ promote: []; remove: [] }>();

const update = useUpdateBacklogItem();
const error = ref('');
const title = ref(props.item.text);
watch(
  () => props.item.text,
  (t) => {
    title.value = t;
  },
);
const ago = useTimeAgo(() => props.item.addedAt, adeAgoOptions);

async function write(over: Parameters<typeof backlogPatch>[0]): Promise<boolean> {
  error.value = '';
  try {
    await update.mutateAsync({ id: props.item.id, patch: backlogPatch(over) });
    return true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    return false;
  }
}

const links = useLinkFields(
  () => props.item.githubUrl,
  async (patch: LinkPatch) => ((await write(patch)) ? null : error.value),
);
const jira = computed(() => props.item.jira);

async function commitTitle(): Promise<void> {
  const text = title.value.trim();
  if (!text) {
    title.value = props.item.text;
    return;
  }
  if (text !== props.item.text) await write({ text });
}

function saveNotes(_id: string, value: string): void {
  void write({ notes: value });
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="ade-backlog-panel">
    <PanelHeader>Backlog item</PanelHeader>
    <header class="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
      <div class="flex items-center gap-2">
        <AdeChip label="backlog · not planned" tone="grey" />
        <h3 class="m-0 min-w-0 flex-1 truncate text-kira-lg font-bold" data-testid="ade-backlog-title">{{ item.text }}</h3>
      </div>
      <div class="text-kira-sm text-muted-foreground">captured {{ ago }}</div>
      <div class="flex gap-2">
        <Button
          size="kira-lg"
          class="font-semibold"
          :class="TONE_SOLID_CLASS.amber"
          title="Turn into a task in the Spec phase, unscheduled (Later)"
          data-testid="ade-backlog-panel-promote"
          @click="emit('promote')"
        >
          → Plan as task
        </Button>
        <Button
          variant="dialog"
          size="kira-lg"
          data-testid="ade-backlog-panel-delete"
          @click="emit('remove')"
        >
          Delete
        </Button>
      </div>
    </header>
    <div class="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 px-3 py-3 text-kira-md">
      <label for="ade-backlog-title-input" class="text-kira-sm text-muted-foreground">Title</label>
      <Input
        id="ade-backlog-title-input"
        v-model="title"
        class="bg-field font-semibold"
        data-testid="ade-backlog-title-input"
        @blur="commitTitle"
        @keydown.enter="commitTitle"
      />
      <AdeLinkRow
        id="ade-backlog-jira"
        label="Jira"
        chip=""
        :text="jira?.key ?? ''"
        :url="jira?.url ?? ''"
        placeholder="paste Jira link or key"
        :error="links.jiraError.value"
        @save="links.saveJira"
        @clear="links.clearJira"
      />
      <AdeLinkRow
        id="ade-backlog-github"
        label="GitHub"
        :chip="links.github.value?.kind ?? ''"
        :text="links.github.value?.ref ?? ''"
        :url="parseGithub(item.githubUrl) ? item.githubUrl : ''"
        placeholder="paste GitHub PR or issue link"
        :error="links.githubError.value"
        @save="links.saveGithub"
        @clear="links.clearGithub"
      />
      <span v-if="error" class="col-span-2 text-kira-sm text-error" data-testid="ade-backlog-error">{{ error }}</span>
    </div>
    <div class="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <AdeNotesEditor :notes="item.notes" :item-id="item.id" @save="saveNotes" />
    </div>
  </div>
</template>
