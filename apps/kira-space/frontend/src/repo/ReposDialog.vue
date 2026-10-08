<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { colorMarkClass } from '@theme/connColor';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, ref } from 'vue';
import { control } from '../bridge/control';
import { useCodeReposStore } from '../state/coderepos';
import RepoConfigForm from './RepoConfigForm.vue';
import { useReposDialogStore } from './state/reposDialog';
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
const nickOf = (id: string) => configs.value.find((c) => c.codeRepoId === id)?.nickname ?? '';
const selectedConfig = computed(() => configs.value.find((c) => c.codeRepoId === selected.value?.id) ?? null);
function pickRepo(id: string): void {
  dialog.selectedRepoId = id;
  dialog.tab = 'repos';
}
const showRepos = computed(() => dialog.tab === 'repos');
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
    <DialogContent
      :show-close-button="false"
      class="flex h-140 max-h-[85vh] w-190 max-w-[90vw] flex-col gap-0 p-0"
      data-testid="repos-dialog"
    >
      <DialogHeader>
        <span class="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <CodiconIcon name="repo" :size="13" />
        </span>
        <DialogTitle>Repositories</DialogTitle>
        <DialogDescription class="sr-only">Import repositories, configure them and manage scan folders.</DialogDescription>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close" data-testid="repos-dialog-close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex min-h-0 flex-1">
        <nav class="flex w-52 shrink-0 flex-col border-r border-border">
          <div class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 py-1.5" role="listbox" aria-label="Repositories" data-testid="repos-dialog-repos">
            <p v-if="codeRepos.records.length === 0" class="m-0 px-1.5 py-1 text-kira-md text-muted-foreground">No repositories imported.</p>
            <button
              v-for="r in codeRepos.records"
              :key="r.id"
              type="button"
              role="option"
              class="relative flex h-5.5 shrink-0 cursor-pointer items-center gap-1.5 rounded-kira-sm border-none px-1.5 text-left text-kira-md"
              :class="showRepos && selected?.id === r.id ? 'bg-select text-fg' : 'bg-transparent text-muted-foreground hover:bg-hover'"
              :aria-selected="showRepos && selected?.id === r.id"
              :title="r.root"
              data-testid="repos-dialog-repo"
              :data-repo-id="r.id"
              @click="pickRepo(r.id)"
            >
              <span :class="colorMarkClass('rail', r.color)" data-testid="repos-dialog-repo-rail" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ nickOf(r.id) || r.name }}</span>
            </button>
          </div>
          <div class="flex flex-col gap-px border-t border-border px-1 py-1.5">
            <button
              type="button"
              class="flex h-5.5 cursor-pointer items-center gap-1.5 rounded-kira-sm border-none px-1.5 text-left text-kira-md"
              :class="dialog.tab === 'folders' ? 'bg-select text-fg' : 'bg-transparent text-muted-foreground hover:bg-hover'"
              :aria-current="dialog.tab === 'folders' ? 'page' : undefined"
              data-testid="repos-dialog-tab-folders"
              @click="dialog.tab = 'folders'"
            >
              <CodiconIcon name="folder" :size="13" />
              Scan folders
            </button>
          </div>
          <Button variant="dialog" size="kira-lg" class="m-1.5" data-testid="repos-dialog-import" @click="onImport">
            <CodiconIcon name="repo" :size="13" />
            Import repository…
          </Button>
        </nav>

        <section class="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <Alert v-if="error" variant="destructive" class="w-auto" data-testid="repos-dialog-error">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
          <template v-if="showRepos">
            <template v-if="selected">
              <h2 class="m-0 truncate text-kira-lg font-semibold" data-testid="repos-dialog-selected">{{ selected.name }}</h2>
              <RepoConfigForm v-if="selectedConfig" :key="selectedConfig.codeRepoId" :repo="selectedConfig" />
            </template>
            <p v-else class="m-0 text-muted-foreground">Import a repository to configure it.</p>
          </template>
          <div v-else class="flex flex-col gap-2" data-testid="repos-dialog-folders">
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
          </div>
        </section>
      </div>

      <DialogFooter>
        <Button
          v-if="showRepos && selected"
          variant="dialog-danger"
          size="kira-lg"
          data-testid="repos-dialog-repo-remove"
          @click="onRemoveRepo(selected.id, selected.name)"
        >
          Remove repository
        </Button>
        <p v-else-if="!showRepos && note" class="m-0 text-kira-sm text-muted-foreground" data-testid="repos-dialog-note">{{ note }}</p>
        <DialogClose as-child>
          <Button variant="dialog" size="kira-lg" class="ml-auto" data-testid="repos-dialog-footer-close">Close</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
