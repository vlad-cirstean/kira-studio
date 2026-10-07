<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger, tabChipVariants } from '@theme/components/ui/tabs';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, ref } from 'vue';
import AdeRepoTag from '../ade/v2/AdeRepoTag.vue';
import { control } from '../bridge/control';
import { useCodeReposStore } from '../state/coderepos';
import RepoConfigForm from './RepoConfigForm.vue';
import { type ReposDialogTab, useReposDialogStore } from './state/reposDialog';
import { useAddFolder, useRemoveFolder, useRepos, useSetFolderWatch } from './state/reposQueries';

const dialog = useReposDialogStore();
const codeRepos = useCodeReposStore();
const confirmDialogStore = useConfirmDialogStore();
const repos = useRepos();
const addFolder = useAddFolder();
const watchFolder = useSetFolderWatch();
const removeFolder = useRemoveFolder();

const folders = computed(() => repos.data.value?.folders ?? []);
const configs = computed(() => repos.data.value?.repos ?? []);
const selected = computed(
  () => codeRepos.records.find((r) => r.id === dialog.selectedRepoId) ?? codeRepos.records[0] ?? null,
);
const selectedConfig = computed(() => configs.value.find((c) => c.codeRepoId === selected.value?.id) ?? null);
const error = ref('');
const note = ref('');

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function run(task: () => Promise<void>): Promise<void> {
  error.value = '';
  note.value = '';
  try {
    await task();
  } catch (err) {
    error.value = message(err);
  }
}

const onImport = () => run(async () => void (await codeRepos.importRepoViaDialog()));

const onAddFolder = () =>
  run(async () => {
    const chosen = await control.filesChooseFolder('Add scan folder…');
    if (chosen.canceled || !chosen.path) return;
    const res = await addFolder.mutateAsync({ path: chosen.path, watch: true });
    note.value = `Imported ${res.imported.length}`;
  });

const onWatch = (path: string, watch: boolean) =>
  run(async () => void (await watchFolder.mutateAsync({ path, watch })));

const onRemoveFolder = (path: string) =>
  run(async () => void (await removeFolder.mutateAsync({ path })));

const onRemoveRepo = (id: string, name: string) =>
  run(async () => {
    const ok = await confirmDialogStore.confirmDialog(`Remove repository "${name}" from Kira Space? Files on disk stay.`, {
      confirmLabel: 'Remove',
    });
    if (ok) await codeRepos.removeCodeRepo(id);
  });
</script>

<template>
  <Dialog v-model:open="dialog.open">
    <DialogContent :show-close-button="true" class="flex h-4/5 w-full max-w-5xl flex-col gap-0 overflow-hidden p-0" data-testid="repos-dialog">
      <DialogHeader class="border-b-0 pb-0">
        <DialogTitle>Repositories</DialogTitle>
        <DialogDescription class="sr-only">Import repositories, configure them and manage scan folders.</DialogDescription>
      </DialogHeader>
      <Tabs
        :model-value="dialog.tab"
        class="min-h-0 flex-1 gap-0"
        @update:model-value="(v) => (dialog.tab = v as ReposDialogTab)"
      >
        <TabsList class="px-3 py-2">
          <TabsTrigger
            value="repos"
            :class="tabChipVariants({ active: dialog.tab === 'repos', size: 'wide' })"
            data-testid="repos-dialog-tab-repos"
          >
            Repositories
          </TabsTrigger>
          <TabsTrigger
            value="folders"
            :class="tabChipVariants({ active: dialog.tab === 'folders', size: 'wide' })"
            data-testid="repos-dialog-tab-folders"
          >
            Scan folders
          </TabsTrigger>
        </TabsList>
        <Alert v-if="error" variant="destructive" class="mx-3 mb-2 w-auto" data-testid="repos-dialog-error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <TabsContent value="repos" class="flex min-h-0 flex-1 border-t border-border" data-testid="repos-dialog-repos">
          <div class="flex w-72 shrink-0 flex-col border-r border-border">
            <div class="flex h-bar shrink-0 items-center border-b border-border px-1.5">
              <Button variant="dialog" size="kira-lg" class="w-full" data-testid="repos-dialog-import" @click="onImport">
                <CodiconIcon name="repo" :size="13" />
                Import repository…
              </Button>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Repositories">
              <p v-if="codeRepos.records.length === 0" class="m-0 px-3 py-2 text-muted-foreground">No repositories imported.</p>
              <div
                v-for="r in codeRepos.records"
                :key="r.id"
                class="flex h-row cursor-default select-none items-center gap-1.5 px-1.5"
                :class="selected?.id === r.id ? 'bg-select' : 'hover:bg-hover'"
                role="option"
                tabindex="0"
                :aria-selected="selected?.id === r.id"
                data-testid="repos-dialog-repo"
                :data-repo-id="r.id"
                @click="dialog.selectedRepoId = r.id"
                @keydown.enter.prevent="dialog.selectedRepoId = r.id"
                @keydown.space.prevent="dialog.selectedRepoId = r.id"
              >
                <AdeRepoTag
                  v-if="configs.find((c) => c.codeRepoId === r.id)?.nickname"
                  :code-repo-id="r.id"
                  :label="configs.find((c) => c.codeRepoId === r.id)?.nickname ?? ''"
                />
                <span class="min-w-0 flex-1 truncate" :title="r.root">{{ r.name }}</span>
              </div>
            </div>
          </div>
          <div class="flex min-w-0 flex-1 flex-col">
            <template v-if="selected">
              <div class="flex h-bar shrink-0 items-center gap-1.5 border-b border-border px-3">
                <span class="min-w-0 flex-1 truncate font-semibold" data-testid="repos-dialog-selected">{{ selected.name }}</span>
                <Button
                  variant="dialog-danger"
                  size="kira-lg"
                  data-testid="repos-dialog-repo-remove"
                  @click="onRemoveRepo(selected.id, selected.name)"
                >
                  Remove repository
                </Button>
              </div>
              <div class="min-h-0 flex-1 overflow-y-auto p-4">
                <RepoConfigForm v-if="selectedConfig" :key="selectedConfig.codeRepoId" :repo="selectedConfig" />
              </div>
            </template>
            <p v-else class="m-0 p-4 text-muted-foreground">Import a repository to configure it.</p>
          </div>
        </TabsContent>
        <TabsContent value="folders" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto border-t border-border p-4" data-testid="repos-dialog-folders">
          <div class="flex items-center gap-2">
            <p class="m-0 flex-1 text-muted-foreground">Every git repository inside a scan folder is imported.</p>
            <Button
              variant="dialog"
              size="kira-lg"
              :disabled="addFolder.isPending.value"
              data-testid="repos-dialog-add-folder"
              @click="onAddFolder"
            >
              <CodiconIcon name="folder" :size="13" />
              Add folder…
            </Button>
          </div>
          <p v-if="note" class="m-0 text-kira-sm text-muted-foreground" data-testid="repos-dialog-note">{{ note }}</p>
          <p v-if="folders.length === 0" class="m-0 text-muted-foreground">No scan folders.</p>
          <div
            v-for="(f, i) in folders"
            :key="f.path"
            class="flex items-center gap-2 rounded-kira bg-field px-2 py-1"
            data-testid="repos-dialog-folder"
            :data-path="f.path"
          >
            <span class="min-w-0 flex-1 truncate font-data" :title="f.path">{{ f.path }}</span>
            <span class="shrink-0 text-kira-sm text-muted-foreground">{{ f.repoCount }} repos</span>
            <div class="flex shrink-0 items-center gap-1.5" title="Import new repositories that appear in this folder">
              <Switch
                :id="`repos-dialog-watch-${i}`"
                :model-value="f.watch"
                data-testid="repos-dialog-folder-watch"
                @update:model-value="(v: boolean) => onWatch(f.path, v)"
              />
              <Label :for="`repos-dialog-watch-${i}`" class="text-kira-sm text-muted-foreground">watch</Label>
            </div>
            <TooltipIconButton
              icon="close"
              label="Remove folder"
              data-testid="repos-dialog-folder-remove"
              @click="onRemoveFolder(f.path)"
            />
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
