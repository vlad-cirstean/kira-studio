<script setup lang="ts">
import KeyValueList from '@theme/components/KeyValueList.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { useRelativeTime } from '@workbench/behaviour/format';
import { useInlineEdit } from '@workbench/behaviour/inlineEdit';
import { errorText } from '@workbench/bridge/codedError';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { computed, ref } from 'vue';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import { backlogPatch } from '../board/panelFacts';
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
const ago = useRelativeTime(() => props.item.addedAt);

async function write(over: Parameters<typeof backlogPatch>[0]): Promise<boolean> {
  error.value = '';
  try {
    await update.mutateAsync({ id: props.item.id, patch: backlogPatch(over) });
    return true;
  } catch (err) {
    error.value = errorText(err);
    return false;
  }
}

const titleEdit = useInlineEdit({
  source: () => props.item.text,
  commit: async (text) => {
    await write({ text });
  },
});

const links = useLinkFields(
  () => props.item.hostLink,
  async (patch: LinkPatch) => ((await write(patch)) ? null : error.value),
);
const jira = computed(() => props.item.jira);
const hostLink = computed(() => props.item.hostLink);

function saveNotes(_id: string, value: string): void {
  void write({ notes: value });
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="ade-backlog-panel">
    <PanelHeader>{{ t('space.ade.backlog.item.label') }}</PanelHeader>
    <header class="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
      <div class="flex items-center gap-2">
        <AdeChip :label="t('space.ade.backlog.notPlanned.label')" tone="grey" />
        <h3
          class="m-0 min-w-0 flex-1 truncate text-kira-lg font-medium"
          data-testid="ade-backlog-title"
          >{{
            item.text
          }}</h3
        >
      </div>
      <div class="text-kira-sm text-muted-foreground">{{
        t('space.ade.backlog.captured.label', { ago })
      }}</div>
      <div class="flex gap-2">
        <AdeTip :text="t('space.ade.backlog.promotePanel.tooltip')">
          <Button
            variant="dialog"
            size="kira-lg"
            :class="TONE_SOLID_CLASS.amber"
            data-testid="ade-backlog-panel-promote"
            @click="emit('promote')"
          >
            {{ t('space.ade.backlog.promotePanel.label') }}
          </Button>
        </AdeTip>
        <Button
          variant="dialog"
          size="kira-lg"
          data-testid="ade-backlog-panel-delete"
          @click="emit('remove')"
        >
          {{ t('common.action.delete.label') }}
        </Button>
      </div>
    </header>
    <div class="flex shrink-0 flex-col gap-2 px-3 py-3 text-kira-md">
      <KeyValueList class="items-center">
        <dt><Label for="ade-backlog-title-input">{{ t('common.field.title.label') }}</Label></dt>
        <dd
          ><Input
            id="ade-backlog-title-input"
            :model-value="titleEdit.text.value"
            class="font-medium"
            data-testid="ade-backlog-title-input"
            @update:model-value="titleEdit.onInput"
            @blur="titleEdit.onCommit"
            @keydown="titleEdit.onKeydown"
          /></dd
        >
        <AdeLinkRow
          id="ade-backlog-jira"
          :label="t('common.product.jira.label')"
          chip=""
          :text="jira?.key ?? ''"
          :url="jira?.url ?? ''"
          :placeholder="t('space.ade.backlog.jira.placeholder')"
          :error="links.jiraError.value"
          @save="links.saveJira"
          @clear="links.clearJira"
        />
        <AdeLinkRow
          id="ade-backlog-github"
          :label="t('common.product.github.label')"
          :chip="hostLink ? (hostLink.kind === 'changeRequest' ? 'PR' : 'issue') : ''"
          :text="hostLink?.ref ?? ''"
          :url="hostLink ? item.hostUrl : ''"
          :placeholder="t('space.ade.backlog.github.placeholder')"
          :error="links.githubError.value"
          @save="links.saveGithub"
          @clear="links.clearGithub"
        />
      </KeyValueList>
      <Alert v-if="error" variant="error" data-testid="ade-backlog-error"
        ><AlertDescription>{{ error }}</AlertDescription></Alert
      >
    </div>
    <div class="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <AdeNotesEditor :notes="item.notes" :item-id="item.id" @save="saveNotes" />
    </div>
  </div>
</template>
