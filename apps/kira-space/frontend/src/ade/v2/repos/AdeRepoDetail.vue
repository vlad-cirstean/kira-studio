<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, ref, watch } from 'vue';
import { useUpdateRepo } from '../queries';
import type { Environment, Repo, RepoPatch } from '../wire';
import AdeRepoEnvRow from './AdeRepoEnvRow.vue';
import { useCommitField } from './useCommitField';

// Settings of one repo (SPEC2 section 6.3). Each field commits alone: the patch carries only its leaf.
const props = defineProps<{ repo: Repo }>();
const update = useUpdateRepo();

async function write(p: Partial<RepoPatch>): Promise<void> {
  await update.mutateAsync({
    codeRepoId: props.repo.codeRepoId,
    patch: {
      nickname: null,
      integrationBranches: null,
      prepareScript: null,
      prepareTimeout: null,
      environments: null,
      ...p,
    },
  });
}

const nick = useCommitField(
  () => props.repo.nickname,
  (v) => write({ nickname: v.trim() }),
);
const prepare = useCommitField(
  () => props.repo.prepareScript,
  (v) => write({ prepareScript: v }),
);
const timeout = useCommitField(
  () => props.repo.prepareTimeout,
  (v) => write({ prepareTimeout: v.trim() }),
);
const targets = useCommitField(
  () => props.repo.integrationBranches.join(', '),
  (v) =>
    write({
      integrationBranches: v
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }),
);

const source = computed(() =>
  props.repo.source === 'added' ? 'added individually' : `imported from ${props.repo.source}`,
);
const envError = ref('');
async function writeEnvs(envs: Environment[]): Promise<void> {
  envError.value = '';
  try {
    await write({ environments: envs });
  } catch (err) {
    envError.value = err instanceof Error ? err.message : String(err);
    throw err;
  }
}
function saveEnv(i: number, env: Environment): Promise<void> {
  return writeEnvs(props.repo.environments.map((e, k) => (k === i ? env : e)));
}

// Rows are keyed by a client id that follows the env through add and remove, so a row's uncommitted
// text stays with it. Writes send the whole list, so Add and Remove wait for the one in flight.
const keys = ref<string[]>([]);
watch(
  () => props.repo.environments.length,
  (n) => {
    while (keys.value.length < n) keys.value.push(crypto.randomUUID());
    keys.value.length = n;
  },
  { immediate: true },
);
function resetKeys(): void {
  keys.value = props.repo.environments.map(() => crypto.randomUUID());
}
function removeEnv(i: number): void {
  keys.value.splice(i, 1);
  writeEnvs(props.repo.environments.filter((_, k) => k !== i)).catch(resetKeys);
}
function addEnv(): void {
  keys.value.push(crypto.randomUUID());
  writeEnvs([...props.repo.environments, { name: 'new-env', deployedShaScript: '' }]).catch(resetKeys);
}
</script>

<template>
  <div class="flex max-w-[860px] flex-col gap-[18px]" data-testid="ade-repo-detail">
    <div class="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-kira-md">
      <label for="ade-repo-nick" class="text-kira-sm text-muted-foreground">Nickname</label>
      <div class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2.5">
          <Input
            id="ade-repo-nick"
            :model-value="nick.text.value"
            class="h-[30px] w-[200px] bg-field font-data text-kira-lg font-semibold"
            data-testid="ade-repo-nick"
            @update:model-value="nick.onInput"
            @blur="nick.onCommit"
            @keydown.enter="nick.onCommit"
          />
          <span class="text-kira-sm text-subtle">Shown everywhere instead of the repo name.</span>
        </div>
        <span v-if="nick.error.value" class="text-kira-sm text-error" data-testid="ade-repo-nick-error">{{ nick.error.value }}</span>
      </div>
      <span class="text-kira-sm text-muted-foreground">Repo</span>
      <span class="truncate font-data text-kira-md text-fg" :title="repo.name" data-testid="ade-repo-full">{{ repo.name }}</span>
      <span class="text-kira-sm text-muted-foreground">Path</span>
      <span class="truncate font-data text-kira-md text-fg" :title="repo.path" data-testid="ade-repo-path">{{ repo.path }}</span>
      <span class="text-kira-sm text-muted-foreground">Source</span>
      <span class="text-kira-md text-fg" data-testid="ade-repo-source"
        >{{ source }} · {{ repo.usedByTasks ? 'used by tasks on the plan' : 'not on the plan' }}</span
      >
    </div>

    <section class="flex flex-col gap-1.5">
      <div class="flex items-baseline gap-2.5">
        <h3 class="m-0 text-kira-lg font-bold">Prepare worktree</h3>
        <span class="text-kira-sm text-subtle"
          >Runs in every new worktree of this repo before any agent starts. Non-zero exit = setup failed.</span
        >
      </div>
      <label for="ade-repo-prepare" class="sr-only">Prepare script</label>
      <Textarea
        id="ade-repo-prepare"
        :model-value="prepare.text.value"
        class="min-h-[72px] resize-y bg-bg px-2.5 py-2 font-data text-kira-md leading-normal"
        data-testid="ade-repo-prepare"
        @update:model-value="prepare.onInput"
        @blur="prepare.onCommit"
      />
      <span v-if="prepare.error.value" class="text-kira-sm text-error" data-testid="ade-repo-prepare-error">{{ prepare.error.value }}</span>
      <div class="flex items-center gap-2 text-kira-sm text-muted-foreground">
        <label for="ade-repo-timeout">Timeout</label>
        <Input
          id="ade-repo-timeout"
          :model-value="timeout.text.value"
          class="h-6 w-[60px] bg-field px-1.5 font-data text-kira-md"
          data-testid="ade-repo-timeout"
          @update:model-value="timeout.onInput"
          @blur="timeout.onCommit"
          @keydown.enter="timeout.onCommit"
        />
        <span v-if="timeout.error.value" class="text-error" data-testid="ade-repo-timeout-error">{{ timeout.error.value }}</span>
      </div>
    </section>

    <section class="flex flex-col gap-1.5">
      <div class="flex items-baseline gap-2.5">
        <h3 class="m-0 text-kira-lg font-bold">Integration branches</h3>
        <span class="text-kira-sm text-subtle">Besides main. Branches are checked for being merged / stale in these.</span>
      </div>
      <label for="ade-repo-targets" class="sr-only">Integration branches</label>
      <Input
        id="ade-repo-targets"
        :model-value="targets.text.value"
        placeholder="develop, staging"
        class="h-[30px] bg-field font-data text-kira-md"
        data-testid="ade-repo-targets"
        @update:model-value="targets.onInput"
        @blur="targets.onCommit"
        @keydown.enter="targets.onCommit"
      />
      <span v-if="targets.error.value" class="text-kira-sm text-error" data-testid="ade-repo-targets-error">{{ targets.error.value }}</span>
    </section>

    <section class="flex flex-col gap-2">
      <div class="flex items-baseline gap-2.5">
        <h3 class="m-0 text-kira-lg font-bold">Environments</h3>
        <span class="text-kira-sm text-subtle">Each script must print the git SHA currently deployed there. Run on Refresh.</span>
      </div>
      <AdeRepoEnvRow
        v-for="(e, i) in repo.environments"
        :key="keys[i] ?? i"
        :env="e"
        :index="i"
        :save="(env) => saveEnv(i, env)"
        :busy="update.isPending.value"
        @remove="removeEnv(i)"
      />
      <span v-if="envError" class="text-kira-sm text-error" data-testid="ade-repo-env-error">{{ envError }}</span>
      <Button
        variant="dialog"
        size="sm"
        class="h-7 self-start border-dashed bg-transparent px-3 text-kira-md"
        :disabled="update.isPending.value"
        data-testid="ade-repo-add-env"
        @click="addEnv"
      >
        + Add environment
      </Button>
    </section>
  </div>
</template>
