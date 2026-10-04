<script setup lang="ts">
import { useClipboard } from '@vueuse/core';
import { computed, ref } from 'vue';
import { control } from '../../../bridge/control';
import AdeChip from '../AdeChip.vue';
import AdeForcePushDialog from '../AdeForcePushDialog.vue';
import AdeTip from '../AdeTip.vue';
import type { Tone } from '../board/actions';
import type { CardModel, PlanModel } from '../plan/usePlanModel';
import { usePrs, useRepos, useRetrySetup } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { solidStyle, TONE } from '../tones';
import type { Deployment, Integration } from '../wire';
import AdeChangesTab from './AdeChangesTab.vue';
import AdePanelFrame from './AdePanelFrame.vue';
import AdeWorktreeSetup from './AdeWorktreeSetup.vue';

// Branch mode: header (back link, git status, name, facts, Force push), Details and Changes tabs.
const props = defineProps<{ card: CardModel; row: CardModel['rows'][number]; model: PlanModel }>();

const ui = useAdeBoardUiStore();
const prs = usePrs();
const repos = useRepos();
const tab = ref('details');
const retrySetup = useRetrySetup();
const setupError = ref('');
const forcePush = ref(false);
const { copy, copied } = useClipboard({ copiedDuring: 1500 });
const copiedKey = ref('');

const branch = computed(() => props.row.branch);
const graph = computed(() => props.model.view.graph);
const baseName = computed(() => {
  const parent = graph.value.parentOf.get(branch.value.id);
  return (parent ? graph.value.byBranch.get(parent)?.name : '') || branch.value.base || 'main';
});
const facts = computed(
  () => `${props.row.repo} · base ${baseName.value} · ↑${branch.value.ahead} ↓${branch.value.behind}`,
);
const setupFailed = computed(() => branch.value.setup?.state === 'failed');
async function onRetrySetup(): Promise<void> {
  setupError.value = '';
  try {
    await retrySetup.mutateAsync({ branchId: branch.value.id });
  } catch (err) {
    setupError.value = err instanceof Error ? err.message : String(err);
  }
}
const canForcePush = computed(() => props.row.tag.actions.some((a) => a.kind === 'forcePush'));
const shared = computed(() => {
  const a = props.model.view.after.get(branch.value.id);
  const other = a ? graph.value.byBranch.get(a.id) : undefined;
  return a && other ? `${other.name} · ${a.file}` : '';
});

// ---- Details rows
const pr = computed(() => prs.data.value?.branches[branch.value.id] ?? null);
const webUrl = computed(
  () => prs.data.value?.repos.find((r) => r.codeRepoId === branch.value.codeRepoId)?.webUrl ?? '',
);
const branchUrl = computed(() =>
  webUrl.value && branch.value.name ? `${webUrl.value}/tree/${branch.value.name}` : '',
);
const PR_TONE: Record<string, Tone> = { open: 'green', merged: 'purple', closed: 'red', draft: 'grey' };

function copyLink(key: string, text: string): void {
  copiedKey.value = key;
  void copy(text);
}
function open(url: string, e: MouseEvent): void {
  e.preventDefault();
  void control.linkOpenExternal(url);
}

const repoInfo = computed(() =>
  repos.data.value?.repos.find((r) => r.codeRepoId === branch.value.codeRepoId),
);

// The repo's own integration branches and environments, each filled from the branch when it has an
// entry, else `not merged` / `not deployed`; an entry the repo no longer lists still shows.
const intoRows = computed((): Integration[] => {
  const have = new Map(branch.value.integration.map((i) => [i.target, i]));
  const rows = (repoInfo.value?.integrationBranches ?? []).map(
    (target): Integration =>
      have.get(target) ?? { target, status: 'not merged', note: '', recorded: false },
  );
  const listed = new Set(rows.map((r) => r.target));
  return [...rows, ...branch.value.integration.filter((i) => !listed.has(i.target))];
});
const deployRows = computed((): Deployment[] => {
  const have = new Map(branch.value.deployments.map((d) => [d.env, d]));
  const rows = (repoInfo.value?.environments ?? []).map(
    (e): Deployment =>
      have.get(e.name) ?? {
        env: e.name,
        deployedSha: '',
        checkedAt: 0,
        status: 'not deployed',
        missingCommits: 0,
        note: '',
        error: '',
      },
  );
  const listed = new Set(rows.map((r) => r.env));
  return [...rows, ...branch.value.deployments.filter((d) => !listed.has(d.env))];
});

const INTO_TONE: Record<Integration['status'], Tone> = { merged: 'green', stale: 'amber', 'not merged': 'grey' };
function intoNote(i: Integration): string {
  if (i.note) return i.note;
  if (i.status === 'merged') return 'up to date';
  return i.status === 'stale' ? `has changes not in ${i.target}` : '';
}

const DEPLOY_TONE: Record<Deployment['status'], Tone> = {
  deployed: 'green',
  stale: 'amber',
  'not deployed': 'grey',
  unknown: 'grey',
};
function deployNote(d: Deployment): string {
  if (d.status === 'deployed') return `runs ${d.deployedSha}, contains this branch`;
  if (d.status === 'stale') return d.note || `runs ${d.deployedSha}`;
  return d.status === 'unknown' ? d.error : '';
}
</script>

<template>
  <AdePanelFrame
    v-model="tab"
    :tabs="[
      { value: 'details', label: 'Details' },
      { value: 'changes', label: 'Changes' },
    ]"
  >
    <template #header>
      <button
        type="button"
        class="-ml-1.5 h-5 max-w-full cursor-pointer self-start truncate rounded-kira-xs border-0 bg-transparent px-1.5 text-kira-sm text-muted-foreground"
        data-testid="ade-panel-back"
        @click="ui.select(card.task.id)"
      >
        ← {{ card.title }}
      </button>
      <div class="flex items-start gap-2">
        <span
          class="mt-[3px] box-border size-3 shrink-0 rounded-[3px] border-2"
          :style="{ borderColor: card.review ? TONE.blue[2] : card.color }"
          data-testid="ade-panel-dot"
        />
        <AdeTip :text="row.tag.tip">
          <AdeChip :label="row.tag.label" :tone="row.tag.tone" />
        </AdeTip>
        <h3
          class="m-0 min-w-0 flex-1 break-all font-data text-kira-lg font-semibold leading-[18px]"
          data-testid="ade-panel-title"
        >
          {{ row.draft ? `new branch (${row.repo})` : branch.name }}
        </h3>
      </div>
      <div class="truncate font-data text-kira-sm text-muted-foreground" data-testid="ade-panel-facts">{{ facts }}</div>
      <p v-if="setupError" class="m-0 text-kira-sm text-error" data-testid="ade-panel-setup-error">{{ setupError }}</p>
      <div v-if="canForcePush || setupFailed" class="flex flex-wrap gap-1.5 pt-[3px]">
        <button
          v-if="setupFailed"
          type="button"
          class="h-[26px] cursor-pointer rounded-kira-sm border-0 px-2.5 text-kira-md font-semibold"
          :style="solidStyle('amber')"
          data-testid="ade-panel-retry-setup"
          @click="onRetrySetup"
        >
          Retry setup
        </button>
        <AdeTip text="git push --force-with-lease">
          <button
            type="button"
            class="h-[26px] cursor-pointer rounded-kira-sm border-0 px-2.5 text-kira-md font-semibold"
            :style="solidStyle('amber')"
            data-testid="ade-panel-force-push"
            @click="forcePush = true"
          >
            Force push
          </button>
        </AdeTip>
      </div>
    </template>

    <div
      v-if="tab === 'details'"
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3.5 pb-3.5 pt-3 text-kira-md"
      data-testid="ade-branch-details"
    >
      <div class="grid grid-cols-[70px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5">
        <span class="text-kira-sm text-muted-foreground">Branch</span>
        <div class="flex h-7 min-w-0 items-center gap-2">
          <AdeChip :label="row.tag.label" :tone="row.tag.tone" wide />
          <template v-if="branch.name">
            <a
              v-if="branchUrl"
              :href="branchUrl"
              class="min-w-0 max-w-[55%] truncate font-data text-kira-md text-info"
              @click="(e) => open(branchUrl, e)"
              >{{ branch.name }}</a
            >
            <span v-else class="min-w-0 truncate font-data text-kira-md">{{ branch.name }}</span>
            <span class="flex-1" />
            <button
              type="button"
              class="size-[22px] shrink-0 cursor-pointer rounded-kira-xs border-0 bg-transparent text-muted-foreground"
              aria-label="Copy Branch link"
              title="Copy link"
              @click="copyLink('branch', branchUrl || branch.name)"
            >
              {{ copied && copiedKey === 'branch' ? '✓' : '⧉' }}
            </button>
          </template>
        </div>
        <span class="text-kira-sm text-muted-foreground">PR</span>
        <div class="flex h-7 min-w-0 items-center gap-2" data-testid="ade-branch-pr">
          <AdeChip :label="pr ? pr.state : 'none'" :tone="pr ? (PR_TONE[pr.state] ?? 'grey') : 'grey'" wide />
          <template v-if="pr">
            <a
              :href="pr.url"
              class="max-w-[55%] shrink-0 truncate font-data text-kira-md text-info"
              @click="(e) => open(pr!.url, e)"
              >#{{ pr.number }}</a
            >
            <span class="min-w-0 flex-1 truncate text-kira-md">{{ pr.title }}</span>
            <button
              type="button"
              class="size-[22px] shrink-0 cursor-pointer rounded-kira-xs border-0 bg-transparent text-muted-foreground"
              aria-label="Copy PR link"
              title="Copy link"
              @click="copyLink('pr', pr.url)"
            >
              {{ copied && copiedKey === 'pr' ? '✓' : '⧉' }}
            </button>
          </template>
        </div>
      </div>

      <AdeWorktreeSetup :row="row" />

      <div class="flex flex-col gap-0.5">
        <div class="pb-0.5 text-kira-sm text-muted-foreground">Merged into</div>
        <div
          v-for="i in intoRows"
          :key="i.target"
          class="flex h-[30px] items-center gap-2 rounded-kira bg-elevated px-1.5"
          data-testid="ade-branch-into"
          :data-target="i.target"
        >
          <AdeChip :label="i.status" :tone="INTO_TONE[i.status]" wide />
          <span class="font-data text-kira-md">{{ i.target }}</span>
          <span class="min-w-0 truncate text-kira-sm text-muted-foreground">{{ intoNote(i) }}</span>
        </div>
        <div v-if="intoRows.length === 0" class="text-kira-md text-subtle">
          This repo has no integration branches besides main.
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <div class="pb-0.5 text-kira-sm text-muted-foreground">Deployed to</div>
        <div
          v-for="d in deployRows"
          :key="d.env"
          class="flex h-[30px] items-center gap-2 rounded-kira bg-elevated px-1.5"
          data-testid="ade-branch-deploy"
          :data-env="d.env"
        >
          <AdeChip :label="d.status" :tone="DEPLOY_TONE[d.status]" wide />
          <span class="font-data text-kira-md">{{ d.env }}</span>
          <span class="min-w-0 truncate text-kira-sm text-muted-foreground">{{ deployNote(d) }}</span>
        </div>
        <div v-if="deployRows.length === 0" class="text-kira-md text-subtle">
          No environments configured for this repo.
        </div>
      </div>
    </div>
    <AdeChangesTab v-else :branch="branch" :base="baseName" :shared="shared" />

    <AdeForcePushDialog
      :target="forcePush ? { branchId: branch.id, branchName: branch.name, repo: row.repo } : null"
      @close="forcePush = false"
    />
  </AdePanelFrame>
</template>
