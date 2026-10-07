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
import { computed, ref } from 'vue';
import { useRepos } from '../ade/v2/queries';
import { control } from '../bridge/control';
import { useCodeReposStore } from '../state/coderepos';
import { useReposDialogStore } from './state/reposDialog';
import { useAddFolder, useRemoveFolder, useSetFolderWatch } from './state/reposQueries';

const dialog = useReposDialogStore();
const codeRepos = useCodeReposStore();
const repos = useRepos();
const addFolder = useAddFolder();
const watchFolder = useSetFolderWatch();
const removeFolder = useRemoveFolder();

const folders = computed(() => repos.data.value?.folders ?? []);
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

const onRemoveRepo = (id: string) => run(() => codeRepos.removeCodeRepo(id));
</script>

<template>
  <Dialog v-model:open="dialog.open">
    <DialogContent class="w-140" data-testid="repos-dialog">
      <DialogHeader>
        <DialogTitle>Repositories</DialogTitle>
        <DialogDescription class="sr-only">Import repositories and manage scan folders.</DialogDescription>
      </DialogHeader>
      <div class="flex max-h-[60vh] flex-col gap-3 overflow-auto px-3 py-2 text-kira-md">
        <Alert v-if="error" variant="destructive" data-testid="repos-dialog-error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <section class="flex flex-col gap-1" data-testid="repos-dialog-repos">
          <div class="flex items-center gap-1">
            <h3 class="m-0 flex-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Repositories</h3>
            <Button variant="dialog" size="kira-lg" data-testid="repos-dialog-import" @click="onImport">
              <CodiconIcon name="repo" :size="13" />
              Import repository…
            </Button>
          </div>
          <p v-if="codeRepos.records.length === 0" class="m-0 text-muted-foreground">No repositories imported.</p>
          <div
            v-for="r in codeRepos.records"
            :key="r.id"
            class="flex items-center gap-2 rounded-kira bg-elevated px-2 py-1"
            data-testid="repos-dialog-repo"
            :data-repo-id="r.id"
          >
            <span class="shrink-0">{{ r.name }}</span>
            <span class="min-w-0 flex-1 truncate font-data text-kira-sm text-muted-foreground" :title="r.root">{{ r.root }}</span>
            <TooltipIconButton
              icon="close"
              label="Remove repository"
              data-testid="repos-dialog-repo-remove"
              @click="onRemoveRepo(r.id)"
            />
          </div>
        </section>
        <section class="flex flex-col gap-1" data-testid="repos-dialog-folders">
          <div class="flex items-center gap-1">
            <h3 class="m-0 flex-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Scan folders</h3>
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
          <p class="m-0 text-kira-sm text-muted-foreground">Every git repository inside a scan folder is imported.</p>
          <p v-if="note" class="m-0 text-kira-sm text-muted-foreground" data-testid="repos-dialog-note">{{ note }}</p>
          <div
            v-for="(f, i) in folders"
            :key="f.path"
            class="flex items-center gap-2 rounded-kira bg-elevated px-2 py-1"
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
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
