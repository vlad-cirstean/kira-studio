<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { TooltipDisabledTrigger } from '@theme/components/ui/tooltip';
import { useClipboard } from '@vueuse/core';
import { computed, ref } from 'vue';
import { control } from '../../../bridge/control';
import { useRepos } from '../../../repo/state/reposQueries';
import AdeChip from '../AdeChip.vue';
import AdeForcePushDialog from '../AdeForcePushDialog.vue';
import AdeTip from '../AdeTip.vue';
import type { Tone } from '../board/actions';
import { type RebaseAct, rebaseActs } from '../board/rebaseActions';
import { baseNameOf } from '../board/reviewCode';
import { type CardModel, type PlanModel, usePlanModel } from '../plan/usePlanModel';
import { usePrs, useRetrySetup } from '../queries';
import { useReviewCode } from '../review/useReviewCode';
import AdeSessionsTab from '../sessions/AdeSessionsTab.vue';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { ACTION_CLASS, TONE_SOLID_CLASS } from '../tones';
import type { Deployment, Integration, PR, RepoPrs, Run } from '../wire';
import AdeChangesTab from './AdeChangesTab.vue';
import AdePanelFrame from './AdePanelFrame.vue';
import AdeRunOutcome from './AdeRunOutcome.vue';
import AdeWorktreeSetup from './AdeWorktreeSetup.vue';
import { type HeaderAction, headerActions } from './headerActions';

// Branch mode: header (back link, git status, name, facts, Force push), Details and Changes tabs.
const props = defineProps<{ card: CardModel; row: CardModel['rows'][number]; model: PlanModel }>();

const ui = useAdeBoardUiStore();
const dialogs = useAdeDialogsStore();
const { sessions } = usePlanModel();
const sessionCount = computed(
  () => sessions.value.filter((x) => x.branchId === props.row.id && x.state === 'running').length,
);
const prs = usePrs();
const repos = useRepos();
const retrySetup = useRetrySetup();
const reviewCode = useReviewCode();
const setupError = ref('');
const forcePush = ref(false);
const { copy, copied } = useClipboard({ copiedDuring: 1500 });
const copiedKey = ref('');

const branch = computed(() => props.row.branch);
const graph = computed(() => props.model.view.graph);
const baseName = computed(() => baseNameOf(props.row, graph.value));
const reviewChoice = computed(() => reviewCode.choiceOf(props.row));
const reviewOff = computed(() => reviewCode.pending.value || !reviewChoice.value || reviewChoice.value.disabled);
const facts = computed(
  () => `${props.row.repo} · base ${baseName.value} · ↑${branch.value.ahead} ↓${branch.value.behind}`,
);
const chipLabel = computed(() => {
  const state = branch.value.setup?.state;
  if (state === 'running') return 'preparing';
  return state === 'failed' ? 'setup failed' : props.row.tag.label;
});
const setupFailed = computed(() => branch.value.setup?.state === 'failed');
async function onRetrySetup(): Promise<void> {
  setupError.value = '';
  try {
    await retrySetup.mutateAsync({ branchId: branch.value.id });
  } catch (err) {
    setupError.value = err instanceof Error ? err.message : String(err);
  }
}
const runs = computed(() => props.card.task.runs);
const mainName = computed(
  () => props.model.board.repos.find((r) => r.codeRepoId === branch.value.codeRepoId)?.mainName ?? '',
);
const actions = computed(() =>
  headerActions({
    branch: branch.value,
    graph: graph.value,
    after: props.model.view.after,
    hadSession: sessions.value.some((x) => x.branchId === branch.value.id),
    runs: runs.value,
    mainName: mainName.value,
  }),
);
const lastRebase = computed(() =>
  runs.value
    .filter((r) => r.purpose === 'rebase' && r.branchId === branch.value.id)
    .reduce<Run | null>((best, r) => (!best || r.attempt >= best.attempt ? r : best), null),
);
// The acts that follow a finished rebase: try again, or abort what it left behind.
const outcomeActs = computed((): RebaseAct[] =>
  rebaseActs({
    branch: branch.value,
    graph: graph.value,
    after: props.model.view.after,
    runs: runs.value,
    mainName: mainName.value,
  }).filter((a) => a.id === 'rebase-retry' || a.id === 'abort-rebase'),
);
function run(a: HeaderAction): void {
  const id = branch.value.id;
  if (a.kind === 'rebase') dialogs.act(a.act);
  else if (a.kind === 'remerge') dialogs.merge(id, a.target);
  else if (a.kind === 'start') dialogs.start(id);
  else if (a.kind === 'review') {
    setupError.value = '';
    reviewCode.open(props.card.task.id, id, null, { onError: (msg) => (setupError.value = msg) });
  }
}
const actionClass = (a: HeaderAction): string => ACTION_CLASS[a.tone];
const canForcePush = computed(() => props.row.tag.actions.some((a) => a.kind === 'forcePush'));
const shared = computed(() => {
  const a = props.model.view.after.get(branch.value.id);
  const other = a ? graph.value.byBranch.get(a.id) : undefined;
  return a && other ? `${other.name} · ${a.file}` : '';
});

// ---- Details rows
const pr = computed((): PR | null => prs.data.value?.branches[branch.value.id] ?? null);
const repoPrs = computed((): RepoPrs | undefined =>
  prs.data.value?.repos.find((r) => r.codeRepoId === branch.value.codeRepoId),
);
const webUrl = computed(() => repoPrs.value?.webUrl ?? '');
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

/** Merging acts on a created branch of mine. */
const canMerge = computed(() => branch.value.kind === 'mine' && branch.value.name !== '');

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
    v-model="ui.branchTab"
    title="Branch"
    :tabs="[
      { value: 'details', label: 'Details' },
      { value: 'changes', label: 'Changes' },
      { value: 'sessions', label: `Sessions ${sessionCount}` },
    ]"
  >
    <template #header>
      <Button
        variant="ghost"
        size="kira"
        class="-ml-1.5 max-w-full justify-start self-start truncate text-muted-foreground"
        data-testid="ade-panel-back"
        @click="ui.select(card.task.id)"
      >
        ← {{ card.title }}
      </Button>
      <div class="flex items-start gap-2">
        <span
          class="mt-1 box-border size-3 shrink-0 rounded-kira-xs border-2"
          :class="card.review && 'border-tone-blue-solid'"
          :style="card.review ? undefined : { borderColor: card.color }"
          data-testid="ade-panel-dot"
        />
        <AdeTip :text="row.tag.tip">
          <AdeChip :label="chipLabel" :tone="row.tag.tone" />
        </AdeTip>
        <AdeTip v-if="branch.origin === 'agent'" text="Added or named by the agent">
          <span class="mt-px inline-flex shrink-0 text-subtle" data-testid="ade-panel-agent">
            <CodiconIcon name="sparkle" :size="14" />
          </span>
        </AdeTip>
        <h3
          class="m-0 min-w-0 flex-1 break-all font-data text-kira-lg font-semibold leading-4.5"
          data-testid="ade-panel-title"
        >
          {{ row.draft ? `new branch (${row.repo})` : branch.name }}
        </h3>
      </div>
      <div class="truncate text-kira-sm text-muted-foreground" data-testid="ade-panel-facts">{{ facts }}</div>
      <p v-if="setupError" class="m-0 text-kira-sm text-error" data-testid="ade-panel-setup-error">{{ setupError }}</p>
      <p v-if="ui.actionError[card.task.id]" class="m-0 text-kira-sm text-error" data-testid="ade-panel-action-error">
        {{ ui.actionError[card.task.id] }}
      </p>
      <div v-if="canForcePush || setupFailed || actions.length" class="flex flex-wrap gap-1.5 pt-1">
        <Button
          v-if="setupFailed"
          size="kira-lg"
          class="font-semibold"
          :class="TONE_SOLID_CLASS.amber"
          data-testid="ade-panel-retry-setup"
          @click="onRetrySetup"
        >
          Retry setup
        </Button>
        <AdeTip v-if="canForcePush" text="git push --force-with-lease">
          <Button
            size="kira-lg"
            class="font-semibold"
            :class="TONE_SOLID_CLASS.amber"
            data-testid="ade-panel-force-push"
            @click="forcePush = true"
          >
            Force push
          </Button>
        </AdeTip>
        <template v-for="a in actions" :key="(a.kind === 'rebase' ? a.act.id : a.kind) + a.label">
          <AdeTip v-if="a.kind === 'review'" :parts="reviewChoice?.tip ?? []">
            <TooltipDisabledTrigger :disabled="reviewOff">
              <Button
                size="kira-lg"
                class="font-semibold"
                :class="actionClass(a)"
                :disabled="reviewOff"
                :data-testid="`ade-panel-action-${a.kind}`"
                @click="run(a)"
              >
                {{ a.label }}
              </Button>
            </TooltipDisabledTrigger>
          </AdeTip>
          <AdeTip v-else-if="a.kind === 'rebase'" :parts="a.act.tip">
            <TooltipDisabledTrigger :disabled="a.act.disabled">
              <Button
                size="kira-lg"
                class="font-semibold"
                :class="actionClass(a)"
                :disabled="a.act.disabled"
                :data-testid="`ade-panel-action-${a.act.id}`"
                @click="run(a)"
              >
                {{ a.label }}
              </Button>
            </TooltipDisabledTrigger>
          </AdeTip>
          <Button
            v-else
            size="kira-lg"
            class="font-semibold"
            :class="actionClass(a)"
            :disabled="a.kind === 'created'"
            :data-testid="`ade-panel-action-${a.kind}`"
            @click="run(a)"
          >
            {{ a.label }}
          </Button>
        </template>
      </div>
    </template>

    <div
      v-if="ui.branchTab === 'details'"
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3.5 pb-3.5 pt-3 text-kira-md"
      data-testid="ade-branch-details"
    >
      <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5">
        <span class="text-kira-sm text-muted-foreground">Branch</span>
        <div class="flex h-7 min-w-0 items-center gap-2">
          <AdeChip :label="chipLabel" :tone="row.tag.tone" wide />
          <template v-if="branch.name">
            <a
              v-if="branchUrl"
              :href="branchUrl"
              class="min-w-0 max-w-1/2 truncate font-data text-kira-md text-info"
              @click="(e) => open(branchUrl, e)"
              >{{ branch.name }}</a
            >
            <span v-else class="min-w-0 truncate font-data text-kira-md">{{ branch.name }}</span>
            <span class="flex-1" />
            <TooltipIconButton
              :icon="copied && copiedKey === 'branch' ? 'check' : 'copy'"
              label="Copy Branch link"
              class="shrink-0"
              @click="copyLink('branch', branchUrl || branch.name)"
            />
          </template>
        </div>
        <span class="text-kira-sm text-muted-foreground">PR</span>
        <div class="flex h-7 min-w-0 items-center gap-2" data-testid="ade-branch-pr">
          <AdeChip :label="pr ? pr.state : 'none'" :tone="pr ? (PR_TONE[pr.state] ?? 'grey') : 'grey'" wide />
          <template v-if="pr">
            <a
              :href="pr.url"
              class="max-w-1/2 shrink-0 truncate font-data text-kira-md text-info"
              @click="(e) => open(pr!.url, e)"
              >#{{ pr.number }}</a
            >
            <span class="min-w-0 flex-1 truncate text-kira-md">{{ pr.title }}</span>
            <TooltipIconButton
              :icon="copied && copiedKey === 'pr' ? 'check' : 'copy'"
              label="Copy PR link"
              class="shrink-0"
              @click="copyLink('pr', pr.url)"
            />
          </template>
        </div>
      </div>

      <AdeWorktreeSetup :row="row" />

      <AdeRunOutcome v-if="lastRebase" :run="lastRebase" title="Last rebase" :acts="outcomeActs" listen />

      <div class="flex flex-col gap-0.5">
        <div class="pb-0.5 text-kira-sm text-muted-foreground">Merged into</div>
        <div
          v-for="i in intoRows"
          :key="i.target"
          class="flex h-8 items-center gap-2 rounded-kira bg-elevated px-1.5"
          data-testid="ade-branch-into"
          :data-target="i.target"
        >
          <AdeChip :label="i.status" :tone="INTO_TONE[i.status]" wide />
          <span class="font-data text-kira-md">{{ i.target }}</span>
          <span class="min-w-0 flex-1 truncate text-kira-sm text-muted-foreground">{{ intoNote(i) }}</span>
          <Button
            v-if="canMerge && i.status !== 'merged'"
            size="kira"
            class="shrink-0 font-semibold"
            :class="ACTION_CLASS[i.status === 'stale' ? 'amber' : 'claude']"
            :disabled="dialogs.pending.has(`merge:${branch.id}:${i.target}`)"
            data-testid="ade-branch-merge"
            @click="dialogs.merge(branch.id, i.target)"
          >
            {{ i.status === 'stale' ? 'Re-merge' : 'Merge' }}
          </Button>
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
          class="flex h-8 items-center gap-2 rounded-kira bg-elevated px-1.5"
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
    <AdeSessionsTab v-else-if="ui.branchTab === 'sessions'" :task-id="card.task.id" :branch-id="branch.id" />
    <AdeChangesTab v-else :branch="branch" :base="baseName" :shared="shared" />

    <AdeForcePushDialog
      :target="forcePush ? { branchId: branch.id, branchName: branch.name, repo: row.repo } : null"
      @close="forcePush = false"
    />
  </AdePanelFrame>
</template>
