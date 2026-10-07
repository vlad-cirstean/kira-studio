<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel, FieldSet } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, ref, watch } from 'vue';
import type { Environment, Repo, RepoPatch } from '../ade/v2/wire';
import { control } from '../bridge/control';
import RepoEnvRow from './RepoEnvRow.vue';
import { useUpdateRepo } from './state/reposQueries';
import { useCommitField } from './useCommitField';

// Settings of one repo. Each field commits alone: the patch carries only its leaf.
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
      worktreeBasePath: null,
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
const basePath = useCommitField(
  () => props.repo.worktreeBasePath,
  (v) => write({ worktreeBasePath: v.trim() }),
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

async function chooseBasePath(): Promise<void> {
  const chosen = await control.filesChooseFolder('Worktree base path…');
  if (chosen.canceled || !chosen.path) return;
  basePath.onInput(chosen.path);
  await basePath.onCommit();
}

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
  <div class="flex max-w-4xl flex-col gap-5" data-testid="repo-config">
    <Field>
      <FieldLabel for="repo-nick">Nickname</FieldLabel>
      <Input
        id="repo-nick"
        :model-value="nick.text.value"
        class="max-w-60 font-data"
        data-testid="repo-nick"
        @update:model-value="nick.onInput"
        @blur="nick.onCommit"
        @keydown.enter="nick.onCommit"
      />
      <FieldDescription>Shown everywhere instead of the repo name.</FieldDescription>
      <FieldError v-if="nick.error.value" data-testid="repo-nick-error">{{ nick.error.value }}</FieldError>
    </Field>

    <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-kira-md">
      <dt class="text-muted-foreground">Repo</dt>
      <dd class="m-0 truncate font-data" :title="repo.name" data-testid="repo-full">{{ repo.name }}</dd>
      <dt class="text-muted-foreground">Path</dt>
      <dd class="m-0 truncate font-data" :title="repo.path" data-testid="repo-path">{{ repo.path }}</dd>
      <dt class="text-muted-foreground">Source</dt>
      <dd class="m-0" data-testid="repo-source">
        {{ source }} · {{ repo.usedByTasks ? 'used by tasks on the plan' : 'not on the plan' }}
      </dd>
    </dl>

    <FieldSet class="gap-2">
      <Field>
        <FieldLabel for="repo-prepare">Prepare worktree</FieldLabel>
        <FieldDescription>
          Runs in every new worktree of this repo before any agent starts. Non-zero exit = setup failed.
        </FieldDescription>
        <Textarea
          id="repo-prepare"
          :model-value="prepare.text.value"
          rows="6"
          class="field-sizing-fixed min-h-32 resize-y font-data leading-normal"
          data-testid="repo-prepare"
          @update:model-value="prepare.onInput"
          @blur="prepare.onCommit"
        />
        <FieldError v-if="prepare.error.value" data-testid="repo-prepare-error">{{ prepare.error.value }}</FieldError>
      </Field>
      <Field orientation="horizontal">
        <FieldLabel for="repo-timeout">Timeout</FieldLabel>
        <Input
          id="repo-timeout"
          :model-value="timeout.text.value"
          class="w-20 font-data"
          data-testid="repo-timeout"
          @update:model-value="timeout.onInput"
          @blur="timeout.onCommit"
          @keydown.enter="timeout.onCommit"
        />
        <FieldError v-if="timeout.error.value" data-testid="repo-timeout-error">{{ timeout.error.value }}</FieldError>
      </Field>
    </FieldSet>

    <Field>
      <FieldLabel for="repo-base-path">Worktree base path</FieldLabel>
      <FieldDescription>Pre-fills the path of new worktrees. Empty uses the default.</FieldDescription>
      <div class="flex items-center gap-1.5">
        <Input
          id="repo-base-path"
          :model-value="basePath.text.value"
          placeholder="Default location"
          class="min-w-0 flex-1 font-data"
          data-testid="repo-base-path"
          @update:model-value="basePath.onInput"
          @blur="basePath.onCommit"
          @keydown.enter="basePath.onCommit"
        />
        <Button variant="dialog" size="kira-lg" data-testid="repo-base-path-choose" @click="chooseBasePath">
          Choose…
        </Button>
      </div>
      <FieldError v-if="basePath.error.value" data-testid="repo-base-path-error">{{ basePath.error.value }}</FieldError>
    </Field>

    <Field>
      <FieldLabel for="repo-targets">Integration branches</FieldLabel>
      <FieldDescription>Besides main. Branches are checked for being merged / stale in these.</FieldDescription>
      <Input
        id="repo-targets"
        :model-value="targets.text.value"
        placeholder="develop, staging"
        class="font-data"
        data-testid="repo-targets"
        @update:model-value="targets.onInput"
        @blur="targets.onCommit"
        @keydown.enter="targets.onCommit"
      />
      <FieldError v-if="targets.error.value" data-testid="repo-targets-error">{{ targets.error.value }}</FieldError>
    </Field>

    <FieldSet class="gap-2">
      <Field>
        <FieldLabel>Environments</FieldLabel>
        <FieldDescription>Each script must print the git SHA currently deployed there. Run on Refresh.</FieldDescription>
      </Field>
      <RepoEnvRow
        v-for="(e, i) in repo.environments"
        :key="keys[i] ?? i"
        :env="e"
        :index="i"
        :save="(env) => saveEnv(i, env)"
        :busy="update.isPending.value"
        @remove="removeEnv(i)"
      />
      <FieldError v-if="envError" data-testid="repo-env-error">{{ envError }}</FieldError>
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        :disabled="update.isPending.value"
        data-testid="repo-add-env"
        @click="addEnv"
      >
        Add environment
      </Button>
    </FieldSet>
  </div>
</template>
