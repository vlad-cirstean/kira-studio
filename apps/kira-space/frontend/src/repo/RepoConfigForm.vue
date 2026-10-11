<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Textarea } from '@theme/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { CatalogText, t } from '@theme/i18n';
import SwatchRadio from '@theme/SwatchRadio.vue';
import { useInlineEdit } from '@workbench/behaviour/inlineEdit';
import { errorText } from '@workbench/bridge/codedError';
import { computed, ref, watch } from 'vue';
import type { Environment, Repo, RepoPatch } from '../ade/v2/wire';
import { control } from '../bridge/control';
import { useCodeReposStore } from '../state/coderepos';
import RepoEnvRow from './RepoEnvRow.vue';
import { useUpdateRepo } from './state/reposQueries';

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

const nick = useInlineEdit({
  source: () => props.repo.nickname,
  commit: (v) => write({ nickname: v.trim() }),
  allowEmpty: true,
});
const prepare = useInlineEdit({
  source: () => props.repo.prepareScript,
  commit: (v) => write({ prepareScript: v }),
  allowEmpty: true,
});
const timeout = useInlineEdit({
  source: () => props.repo.prepareTimeout,
  commit: (v) => write({ prepareTimeout: v.trim() }),
  allowEmpty: true,
});
const basePath = useInlineEdit({
  source: () => props.repo.worktreeBasePath,
  commit: (v) => write({ worktreeBasePath: v.trim() }),
  allowEmpty: true,
});
const targets = useInlineEdit({
  source: () => props.repo.integrationBranches.join(', '),
  commit: (v) =>
    write({
      integrationBranches: v
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }),
  allowEmpty: true,
});

async function chooseBasePath(): Promise<void> {
  const chosen = await control.filesChooseFolder(t('space.repo.config.basePath.chooseTitle.title'));
  if (chosen.canceled || !chosen.path) return;
  basePath.onInput(chosen.path);
  await basePath.onCommit();
}

const source = computed(() =>
  t('space.common.dotPair.label', {
    first:
      props.repo.source === 'added'
        ? t('space.repo.config.source.added.status')
        : t('space.repo.config.source.imported.status', { source: props.repo.source }),
    second: props.repo.usedByTasks ? t('space.repo.config.source.usedOnPlan.status') : t('space.repo.config.source.notOnPlan.status'),
  }),
);
const SETUP_EXAMPLE = 'pnpm install';
const VERSION_EXAMPLE = 'curl -s https://staging.example.com/version';
const envError = ref('');
// Environment writes send the whole list, so they run one at a time and build it when they run,
// after the previous write updated props.repo.
let envWrite: Promise<void> = Promise.resolve();
function writeEnvs(build: (current: Environment[]) => Environment[]): Promise<void> {
  const run = async (): Promise<void> => {
    envError.value = '';
    try {
      await write({ environments: build(props.repo.environments) });
    } catch (err) {
      envError.value = errorText(err);
      throw err;
    }
  };
  const result = envWrite.then(run);
  envWrite = result.catch(() => {
    // Already shown through envError; the chain only needs to stay alive for the next write.
  });
  return result;
}
function saveEnv(i: number, env: Environment): Promise<void> {
  return writeEnvs((cur) => cur.map((e, k) => (k === i ? env : e)));
}

// Rows are keyed by a client id that follows the env through add and remove, so a row's uncommitted
// text stays with it.
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
  writeEnvs((cur) => cur.filter((_, k) => k !== i)).catch(resetKeys);
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
    await writeEnvs((cur) => [...cur, { name, deployedShaScript }]);
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
    colorError.value = errorText(err);
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="repo-config">
    <section class="flex flex-col gap-3">
      <h3 class="m-0 text-kira-lg">{{ t('space.repo.config.repository.label') }}</h3>
      <Field>
        <FieldLabel for="repo-nick">{{ t('space.repo.config.nickname.label') }}</FieldLabel>
        <Input
          id="repo-nick"
          :model-value="nick.text.value"
          class="max-w-60 font-data"
          data-testid="repo-nick"
          @update:model-value="nick.onInput"
          @blur="nick.onCommit"
          @keydown="nick.onKeydown"
        />
        <FieldDescription>{{ t('space.repo.config.nickname.description') }}</FieldDescription>
        <FieldError v-if="nick.error.value" data-testid="repo-nick-error">{{ nick.error.value }}</FieldError>
      </Field>
      <Field>
        <span class="text-muted-foreground">{{ t('common.field.colour.label') }}</span>
        <fieldset
          class="m-0 flex h-control flex-wrap items-center gap-1 border-0 p-0"
          :aria-label="t('common.field.colour.label')"
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
            <TooltipContent>{{ swatch === 'none' ? t('common.field.noColour.label') : swatch }}</TooltipContent>
          </Tooltip>
        </fieldset>
        <FieldError v-if="colorError" data-testid="repo-color-error">{{ colorError }}</FieldError>
      </Field>
      <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-kira-md">
        <dt class="text-muted-foreground">{{ t('space.repo.config.repository.label') }}</dt>
        <dd class="m-0 min-w-0">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="block truncate font-data" data-testid="repo-full">{{ repo.name }}</span>
            </TooltipTrigger>
            <TooltipContent>{{ repo.name }}</TooltipContent>
          </Tooltip>
        </dd>
        <dt class="text-muted-foreground">{{ t('space.repo.config.path.label') }}</dt>
        <dd class="m-0 min-w-0">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="block truncate font-data" data-testid="repo-path">{{ repo.path }}</span>
            </TooltipTrigger>
            <TooltipContent>{{ repo.path }}</TooltipContent>
          </Tooltip>
        </dd>
        <dt class="text-muted-foreground">{{ t('common.field.source.label') }}</dt>
        <dd class="m-0" data-testid="repo-source">
          {{ source }}
        </dd>
      </dl>
    </section>

    <section class="flex flex-col gap-3">
      <h3 class="m-0 text-kira-lg">{{ t('common.module.worktrees.label') }}</h3>
      <Field>
        <FieldLabel for="repo-prepare">{{ t('space.repo.config.prepare.label') }}</FieldLabel>
        <FieldDescription>
          <CatalogText k="space.repo.config.prepare.description">
            <template #command><code class="font-data">{{ SETUP_EXAMPLE }}</code></template>
          </CatalogText>
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
        <FieldLabel for="repo-timeout">{{ t('common.field.timeout.label') }}</FieldLabel>
        <Input
          id="repo-timeout"
          :model-value="timeout.text.value"
          class="w-20 font-data"
          data-testid="repo-timeout"
          @update:model-value="timeout.onInput"
          @blur="timeout.onCommit"
          @keydown="timeout.onKeydown"
        />
        <FieldError v-if="timeout.error.value" data-testid="repo-timeout-error">{{ timeout.error.value }}</FieldError>
      </Field>
      <Field>
        <FieldLabel for="repo-base-path">{{ t('space.repo.config.basePath.label') }}</FieldLabel>
        <FieldDescription>{{ t('space.repo.config.basePath.description') }}</FieldDescription>
        <div class="flex items-center gap-1.5">
          <Input
            id="repo-base-path"
            :model-value="basePath.text.value"
            :placeholder="t('space.repo.config.basePath.placeholder')"
            class="min-w-0 flex-1 font-data"
            data-testid="repo-base-path"
            @update:model-value="basePath.onInput"
            @blur="basePath.onCommit"
            @keydown="basePath.onKeydown"
          />
          <Button variant="dialog" size="kira-lg" data-testid="repo-base-path-choose" @click="chooseBasePath">
            {{ t('space.repo.config.basePath.choose.label') }}
          </Button>
        </div>
        <FieldError v-if="basePath.error.value" data-testid="repo-base-path-error">{{ basePath.error.value }}</FieldError>
      </Field>
    </section>

    <section class="flex flex-col gap-3">
      <h3 class="m-0 text-kira-lg">{{ t('common.module.branches.label') }}</h3>
      <Field>
        <FieldLabel for="repo-targets">{{ t('space.repo.config.targets.label') }}</FieldLabel>
        <FieldDescription>{{ t('space.repo.config.targets.description') }}</FieldDescription>
        <Input
          id="repo-targets"
          :model-value="targets.text.value"
          :placeholder="t('space.repo.config.targets.example')"
          class="font-data"
          data-testid="repo-targets"
          @update:model-value="targets.onInput"
          @blur="targets.onCommit"
          @keydown="targets.onKeydown"
        />
        <FieldError v-if="targets.error.value" data-testid="repo-targets-error">{{ targets.error.value }}</FieldError>
      </Field>
    </section>

    <section class="flex flex-col gap-3">
      <h3 class="m-0 text-kira-lg">{{ t('space.repo.config.environments.title') }}</h3>
      <p class="m-0 text-kira-md text-muted-foreground">
        <CatalogText k="space.repo.config.environments.intro.hint">
          <template #command><code class="font-data">{{ VERSION_EXAMPLE }}</code></template>
        </CatalogText>
      </p>
      <p v-if="envRows.length === 0" class="m-0 text-kira-md text-muted-foreground" data-testid="repo-env-empty">
        {{ t('space.repo.env.empty.empty') }}
      </p>
      <div v-else class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5 text-kira-sm text-muted-foreground" aria-hidden="true">
          <span class="w-32 shrink-0">{{ t('common.field.name.label') }}</span>
          <span class="min-w-0 flex-1">{{ t('space.repo.env.command.label') }}</span>
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
        {{ t('space.repo.env.add.label') }}
      </Button>
    </section>
  </div>
</template>
