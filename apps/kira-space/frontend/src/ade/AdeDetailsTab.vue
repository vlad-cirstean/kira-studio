<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AdeBlockerRow from './AdeBlockerRow.vue';
import AdeCandidatePicker from './AdeCandidatePicker.vue';
import AdeEstimateField from './AdeEstimateField.vue';
import AdeLinkRow from './AdeLinkRow.vue';
import AdeNotesEditor from './AdeNotesEditor.vue';
import AdeWorkTypeField from './AdeWorkTypeField.vue';
import { branchWebUrl, prRow } from './links';
import { useAdeBindNewWork } from './mutations';
import { useAdeUiStore } from './state/adeUi';
import { useItemMeta } from './useItemMeta';
import type { QueuePanel } from './useQueue';
import type { AdeRepoPrs } from './wire';

// P129 Part 6 §0.9-§0.15: the Details tab (mockup 305-370). Name grid, Branch/Jira/PR rows,
// Estimate, Notes (TipTap, `AdeNotesEditor`).
const props = defineProps<{
  panel: QueuePanel;
  prs: AdeRepoPrs | undefined;
  codeRepoId: string;
}>();

const adeUiStore = useAdeUiStore();
const meta = useItemMeta(
  () => props.codeRepoId,
  () => props.panel,
);
const bindNewWork = useAdeBindNewWork(() => props.codeRepoId);

// ---- Name ----------------------------------------------------------------------------------------
const nameDraft = ref(props.panel.nameValue);
watch(
  () => props.panel.id,
  () => {
    nameDraft.value = props.panel.nameValue;
  },
);
function commitName(): void {
  if (nameDraft.value !== props.panel.nameValue) void meta.setName(nameDraft.value);
}
function revertName(): void {
  nameDraft.value = props.panel.nameValue;
}

// ---- Branch/Jira/PR rows ---------------------------------------------------------------------------
const editingJira = ref(false);
const editingPr = ref(false);
watch(
  () => props.panel.id,
  () => {
    editingJira.value = false;
    editingPr.value = false;
  },
);

const branchRow = computed(() => {
  const p = props.panel;
  if (p.isNewWork) {
    return {
      label: 'Branch',
      showLink: false,
      showBase: true,
      showInput: false,
      editing: false,
      editable: false,
      url: null,
      refText: '',
      title: '',
      hasStatus: true,
      status: p.branchStatus.label,
      statusTone: p.branchStatus.tone,
      statusTip: 'Claude creates the branch when you start',
      draftValue: '',
      placeholder: '',
      baseValue: p.branch.from ?? '',
      baseOptions: p.branch.fromOptions ?? [],
      error: meta.errors.base,
    };
  }
  return {
    label: 'Branch',
    showLink: true,
    showBase: false,
    showInput: false,
    editing: false,
    editable: false,
    url: branchWebUrl(props.prs?.webUrl ?? '', p.branch.ref),
    refText: p.branch.ref,
    title: '',
    hasStatus: true,
    status: p.branchStatus.label,
    statusTone: p.branchStatus.tone,
    statusTip: 'git status vs main (read-only)',
    draftValue: '',
    placeholder: '',
    baseValue: '',
    baseOptions: [],
    error: null,
  };
});

const jiraRow = computed(() => {
  const p = props.panel;
  const has = !!p.jira.key && !editingJira.value;
  return {
    label: 'Jira',
    showLink: has || (p.readOnly && !p.jira.key),
    showBase: false,
    showInput: !has && !p.readOnly,
    editing: editingJira.value,
    editable: !p.readOnly,
    url: p.jira.url || null,
    refText: p.jira.key || (p.readOnly ? '—' : ''),
    title: '',
    hasStatus: false,
    status: '',
    statusTone: 'grey' as const,
    statusTip: '',
    draftValue: p.jira.url || p.jira.key,
    placeholder: 'paste Jira link',
    baseValue: '',
    baseOptions: [],
    error: meta.errors.jira,
  };
});

const prRowView = computed(() => {
  const p = props.panel;
  if (p.isNewWork) return null;
  const resolved = props.prs?.branches[p.branch.ref];
  const row = prRow(resolved, p.prUrl);
  const has = !!row.url && !editingPr.value;
  return {
    label: 'PR',
    showLink: has || (p.readOnly && !row.url),
    showBase: false,
    showInput: !has && !p.readOnly,
    editing: editingPr.value,
    editable: !p.readOnly,
    url: row.url || null,
    refText: row.number !== null ? `#${row.number}` : p.readOnly ? '—' : '',
    title: row.chip ? row.title : '',
    hasStatus: !!row.chip,
    status: row.chip?.label ?? '',
    statusTone: row.chip?.tone ?? ('grey' as const),
    statusTip: 'GitHub PR status (read-only)',
    draftValue: p.prUrl,
    placeholder: 'paste GitHub PR link',
    baseValue: '',
    baseOptions: [],
    error: meta.errors.prUrl,
  };
});

function onJiraSave(value: string): void {
  editingJira.value = false;
  void meta.setJira(value);
}
function onPrSave(value: string): void {
  editingPr.value = false;
  void meta.setPrUrl(value);
}
function onBaseChange(value: string): void {
  void meta.setBase(value);
}

const candidatePickError = ref<string | null>(null);
async function onCandidatePick(branch: string): Promise<void> {
  candidatePickError.value = null;
  try {
    await bindNewWork.mutateAsync({ codeRepoId: props.codeRepoId, id: props.panel.id, branch });
    adeUiStore.select(props.codeRepoId, branch);
  } catch (e) {
    candidatePickError.value = e instanceof Error ? e.message : 'Save failed';
  }
}

// ---- Notes -----------------------------------------------------------------------------------------
function onNotesSave(value: string): void {
  void meta.setNotes(value);
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-3.5 pb-3.5 pt-3 text-kira-sm"
    data-testid="ade-details-tab"
  >
    <div class="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5">
      <label for="ade-work-name" class="text-kira-sm text-[#9a9ca5]">Name</label>
      <input
        v-if="!panel.readOnly"
        id="ade-work-name"
        v-model="nameDraft"
        :placeholder="panel.defaultTitle"
        class="h-7 rounded-kira-sm border border-transparent bg-[#1b1d22] px-2 text-kira-md font-semibold text-fg"
        data-testid="ade-name-input"
        @blur="commitName"
        @keydown.enter="commitName"
        @keydown.esc="revertName"
      />
      <span v-else class="flex h-7 items-center px-2 text-kira-md font-semibold text-[#c9c7c2]">{{
        panel.title
      }}</span>

      <AdeWorkTypeField :panel="panel" :code-repo-id="codeRepoId" />

      <AdeLinkRow v-bind="branchRow" @base="onBaseChange" />
      <AdeCandidatePicker
        v-if="panel.isNewWork && panel.candidates.length > 1"
        :candidates="panel.candidates"
        :error="candidatePickError"
        @pick="onCandidatePick"
      />

      <AdeLinkRow v-bind="jiraRow" @edit="editingJira = true" @save="onJiraSave" />
      <AdeLinkRow v-if="prRowView" v-bind="prRowView" @edit="editingPr = true" @save="onPrSave" />
    </div>

    <AdeBlockerRow
      v-if="!panel.readOnly && panel.kind !== 'review'"
      :panel="panel"
      :code-repo-id="codeRepoId"
    />

    <AdeEstimateField
      v-if="!panel.readOnly"
      :estimate="panel.estimate"
      :error="meta.errors.estimate"
      @save="meta.setEstimate"
    />

    <AdeNotesEditor :notes="panel.notes" :item-id="panel.id" @save="onNotesSave" />
    <span v-if="meta.errors.notes" class="text-kira-sm text-[#f28b7d]">{{ meta.errors.notes }}</span>
  </div>
</template>
