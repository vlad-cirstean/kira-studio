<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Textarea } from '@theme/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import SwatchRadio from '@theme/SwatchRadio.vue';
import { computed, ref, watch } from 'vue';
import type { Environment, Repo, RepoPatch } from '../ade/v2/wire';
import { control } from '../bridge/control';
import { useCodeReposStore } from '../state/coderepos';
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
// A new environment starts as a local draft and is written once name and command are both filled;
// the draft keeps its key until the persisted list shows it, so the row keeps its DOM.
interface EnvDraft extends Environment {
  key: string;
  writing: boolean;
}
const drafts = ref<EnvDraft[]>([]);
const keys = ref<string[]>([]);
watch(
  () => props.repo.environments.length,
  (n) => {
    while (keys.value.length < n) {
      const i = drafts.value.findIndex((d) => d.writing);
      if (i >= 0) keys.value.push(drafts.value.splice(i, 1)[0]?.key ?? crypto.randomUUID());
      else keys.value.push(crypto.randomUUID());
    }
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
  drafts.value.push({ key: crypto.randomUUID(), name: '', deployedShaScript: '', writing: false });
}
function removeDraft(key: string): void {
  drafts.value = drafts.value.filter((d) => d.key !== key);
}
async function saveDraft(key: string, env: Environment): Promise<void> {
  const d = drafts.value.find((x) => x.key === key);
  if (!d) return;
  d.name = env.name;
  d.deployedShaScript = env.deployedShaScript;
  const name = env.name.trim();
  const deployedShaScript = env.deployedShaScript.trim();
  if (!name || !deployedShaScript) return;
  d.writing = true;
  try {
    await writeEnvs([...props.repo.environments, { name, deployedShaScript }]);
  } catch (err) {
    d.writing = false;
    throw err;
  }
}

const envRows = computed(() => [
  ...props.repo.environments.map((env, i) => ({
    key: keys.value[i] ?? String(i),
    env,
    index: i,
    draft: false,
  })),
  ...drafts.value.map((d, i) => ({
    key: d.key,
    env: d as Environment,
    index: props.repo.environments.length + i,
    draft: true,
  })),
]);

const codeRepos = useCodeReposStore();
const color = computed(() => codeRepos.colorOf(props.repo.codeRepoId));
const colorError = ref('');
async function chooseColor(next: PaletteColor): Promise<void> {
  colorError.value = '';
  try {
    await codeRepos.setCodeRepoColor(props.repo.codeRepoId, next);
  } catch (err) {
    colorError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="repo-config">
    <section class="flex flex-col gap-3">
      <h3 class="m-0 text-kira-lg">Repository</h3>
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
      <Field>
        <span class="text-muted-foreground">Colour</span>
        <fieldset
          class="m-0 flex h-control flex-wrap items-center gap-1 border-0 p-0"
          aria-label="Colour"
          data-testid="repo-color"
        >
          <Tooltip v-for="swatch in PALETTE_COLOR_CHOICES" :key="swatch">
            <TooltipTrigger as-child>
              <SwatchRadio
                name="repo-color"
                :value="swatch"
                :color="swatch"
                :checked="color === swatch"
                @change="chooseColor(swatch)"
              />
            </TooltipTrigger>
            <TooltipContent>{{ swatch === 'none' ? 'No colour' : swatch }}</TooltipContent>
          </Tooltip>
        </fieldset>
        <FieldError v-if="colorError" data-testid="repo-color-error">{{ colorError }}</FieldError>
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
    </section>

    <section class="flex flex-col gap-3">
      <h3 class="m-0 text-kira-lg">Worktrees</h3>
      <Field>
        <FieldLabel for="repo-prepare">Prepare worktree</FieldLabel>
        <FieldDescription>
          Setup script. Runs in the root of every new worktree of this repo, before any agent starts; for example
          <code class="font-data">pnpm install</code>. A non-zero exit marks setup as failed.
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
    </section>

    <section class="flex flex-col gap-3">
      <h3 class="m-0 text-kira-lg">Branches</h3>
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
    </section>

    <section class="flex flex-col gap-3">
      <h3 class="m-0 text-kira-lg">Deployment environments</h3>
      <p class="m-0 text-kira-md text-muted-foreground">
        Track which commit each environment runs. For each one, give a command that prints the deployed commit SHA, for
        example <code class="font-data">curl -s https://staging.example.com/version</code>. Kira runs it in the repo root
        when the board refreshes and marks branches deployed there.
      </p>
      <p v-if="envRows.length === 0" class="m-0 text-kira-md text-muted-foreground" data-testid="repo-env-empty">
        No environments yet.
      </p>
      <div v-else class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5 text-kira-sm text-muted-foreground" aria-hidden="true">
          <span class="w-32 shrink-0">Name</span>
          <span class="min-w-0 flex-1">Command that prints the deployed SHA</span>
          <span class="size-6 shrink-0" />
        </div>
        <RepoEnvRow
          v-for="r in envRows"
          :key="r.key"
          :env="r.env"
          :index="r.index"
          :focus-on-mount="r.draft"
          :save="(env) => (r.draft ? saveDraft(r.key, env) : saveEnv(r.index, env))"
          :busy="update.isPending.value"
          @remove="r.draft ? removeDraft(r.key) : removeEnv(r.index)"
        />
      </div>
      <FieldError v-if="envError" data-testid="repo-env-error">{{ envError }}</FieldError>
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        :disabled="update.isPending.value || drafts.length > 0"
        data-testid="repo-add-env"
        @click="addEnv"
      >
        Add environment
      </Button>
    </section>
  </div>
</template>
