<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Switch } from '@theme/components/ui/switch';
import { computed, ref } from 'vue';
import AdeRepoTag from '../AdeRepoTag.vue';
import { useAddFolder, useImportRepo, useRemoveFolder, useRepos, useSetFolderWatch } from '../queries';
import { useAdeReposUiStore } from '../state/adeReposUi';
import { TONE } from '../tones';
import AdeRepoDetail from './AdeRepoDetail.vue';

// Repos page (SPEC2 section 6.3): imported folders and repos on the left, the picked repo's settings right.
const reposUi = useAdeReposUiStore();
const repos = useRepos();
const addFolder = useAddFolder();
const watchFolder = useSetFolderWatch();
const removeFolder = useRemoveFolder();
const importRepo = useImportRepo();

const list = computed(() => repos.data.value?.repos ?? []);
const folders = computed(() => repos.data.value?.folders ?? []);
const current = computed(() => list.value.find((r) => r.codeRepoId === reposUi.repoId) ?? list.value[0] ?? null);

const newFolder = ref('');
const newRepo = ref('');
const folderNote = ref('');
const folderError = ref('');
const repoError = ref('');

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function onAddFolder(): Promise<void> {
  const path = newFolder.value.trim();
  if (!path) return;
  folderNote.value = '';
  folderError.value = '';
  try {
    const res = await addFolder.mutateAsync({ path, watch: true });
    folderNote.value = `imported ${res.imported.length}`;
    newFolder.value = '';
  } catch (err) {
    folderError.value = message(err);
  }
}

async function onWatch(path: string, watch: boolean): Promise<void> {
  folderError.value = '';
  try {
    await watchFolder.mutateAsync({ path, watch });
  } catch (err) {
    folderError.value = message(err);
  }
}

async function onRemoveFolder(path: string): Promise<void> {
  folderError.value = '';
  try {
    await removeFolder.mutateAsync({ path });
  } catch (err) {
    folderError.value = message(err);
  }
}

async function onAddRepo(): Promise<void> {
  const path = newRepo.value.trim();
  if (!path) return;
  repoError.value = '';
  try {
    const repo = await importRepo.mutateAsync(path);
    reposUi.repoId = repo.id;
    newRepo.value = '';
  } catch (err) {
    repoError.value = message(err);
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1" data-testid="ade-repos">
    <div class="flex w-[320px] shrink-0 flex-col gap-1 overflow-auto border-r border-border px-3 py-4">
      <h2 class="m-0 px-1 pb-1.5 text-kira-lg font-semibold">Folders</h2>
      <div class="px-1 pb-1.5 text-kira-sm text-subtle">Every git repo inside is imported.</div>
      <div
        v-for="(f, fi) in folders"
        :key="f.path"
        class="flex items-center gap-2 rounded-kira bg-elevated px-2 py-1.5"
        data-testid="ade-folder"
        :data-path="f.path"
      >
        <span class="min-w-0 flex-1 truncate font-data text-kira-md" :title="f.path">{{ f.path }}</span>
        <span class="shrink-0 text-kira-sm text-muted-foreground">{{ f.repoCount }} repos</span>
        <div class="flex shrink-0 items-center gap-[5px] text-kira-sm text-muted-foreground" title="Import new repos that appear in this folder">
          <Switch
            :id="`ade-folder-watch-${fi}`"
            :model-value="f.watch"
            class="data-[state=checked]:border-ok data-[state=checked]:bg-ok"
            data-testid="ade-folder-watch"
            @update:model-value="(v: boolean) => onWatch(f.path, v)"
          />
          <label :for="`ade-folder-watch-${fi}`" class="cursor-pointer">watch</label>
        </div>
        <Button
          variant="toolbar"
          size="icon-xs"
          class="size-[22px]"
          aria-label="Remove folder"
          data-testid="ade-folder-remove"
          @click="onRemoveFolder(f.path)"
        >
          ✕
        </Button>
      </div>
      <div class="flex gap-1.5 pb-3 pt-0.5">
        <label for="ade-add-folder" class="sr-only">Folder path</label>
        <Input
          id="ade-add-folder"
          v-model="newFolder"
          placeholder="~/code/oss"
          class="h-[26px] min-w-0 flex-1 border-dashed bg-transparent font-data text-kira-sm"
          data-testid="ade-add-folder"
          @keydown.enter="onAddFolder"
        />
        <Button
          variant="dialog"
          size="xs"
          class="h-[26px] text-kira-sm"
          :disabled="addFolder.isPending.value"
          data-testid="ade-add-folder-go"
          @click="onAddFolder"
        >
          + Add folder
        </Button>
      </div>
      <p v-if="folderNote" class="m-0 px-1 text-kira-sm text-muted-foreground" data-testid="ade-folder-note">{{ folderNote }}</p>
      <p v-if="folderError" class="m-0 px-1 text-kira-sm text-error" data-testid="ade-folder-error">{{ folderError }}</p>
      <h2 class="m-0 px-1 pb-1.5 pt-3 text-kira-lg font-semibold">Repos</h2>
      <button
        v-for="r in list"
        :key="r.codeRepoId"
        type="button"
        class="box-border flex w-full cursor-pointer flex-col items-start gap-1 rounded-kira border-0 border-l-[3px] px-2.5 py-2 text-left text-fg"
        :class="current?.codeRepoId === r.codeRepoId ? 'bg-hover' : 'bg-transparent'"
        :style="{ borderLeftColor: current?.codeRepoId === r.codeRepoId ? TONE.amber[2] : 'transparent' }"
        data-testid="ade-repo-row"
        :data-repo-id="r.codeRepoId"
        @click="reposUi.repoId = r.codeRepoId"
      >
        <AdeRepoTag :code-repo-id="r.codeRepoId" :label="r.nickname || r.name" class="px-2 py-0.5 text-kira-lg" />
        <span class="max-w-full truncate font-data text-kira-sm text-fg" :title="r.name">{{ r.name }}</span>
        <span class="text-kira-sm text-muted-foreground"
          >{{ r.environments.length }} envs · {{ r.integrationBranches.length }} integration branches</span
        >
      </button>
      <div class="flex gap-1.5 pt-1.5">
        <label for="ade-add-repo-path" class="sr-only">Repo path</label>
        <Input
          id="ade-add-repo-path"
          v-model="newRepo"
          placeholder="~/code/some-repo"
          class="h-[26px] min-w-0 flex-1 border-dashed bg-transparent font-data text-kira-sm"
          data-testid="ade-add-repo-path"
          @keydown.enter="onAddRepo"
        />
        <Button
          variant="dialog"
          size="xs"
          class="h-[26px] text-kira-sm"
          :disabled="importRepo.isPending.value"
          data-testid="ade-add-repo-go"
          @click="onAddRepo"
        >
          + Add repo
        </Button>
      </div>
      <p v-if="repoError" class="m-0 px-1 text-kira-sm text-error" data-testid="ade-repo-add-error">{{ repoError }}</p>
    </div>
    <div class="min-w-0 flex-1 overflow-auto px-6 pb-6 pt-4">
      <AdeRepoDetail v-if="current" :key="current.codeRepoId" :repo="current" />
    </div>
  </div>
</template>
