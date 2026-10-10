<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowVariants } from '@theme/components/rowVariants';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
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
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed, ref } from 'vue';
import { control } from '../bridge/control';
import { useCodeReposStore } from '../state/coderepos';
import RepoConfigForm from './RepoConfigForm.vue';
import { useReposDialogStore } from './state/reposDialog';
import {
  useAddFolder,
  useRemoveFolder,
  useRepos,
  useSetFolderHidden,
  useSetFolderWatch,
} from './state/reposQueries';

const dialog = useReposDialogStore();
const codeRepos = useCodeReposStore();
const repos = useRepos();
const addFolder = useAddFolder();
const watchFolder = useSetFolderWatch();
const hideFolder = useSetFolderHidden();
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

const onHideFolder = (path: string, hidden: boolean) =>
  run(async () => void (await hideFolder.mutateAsync({ path, hidden })));

const onHideRepo = (id: string, hidden: boolean) => run(() => codeRepos.setCodeRepoHidden(id, hidden));

const onRemoveRepo = (id: string, name: string) =>
  run(async () => void (await codeRepos.confirmRemoveCodeRepo(id, name)));

/** Parent directory of the checkout with its trailing separator, the dim half of the head's path. */
function parentDir(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i >= 0 ? trimmed.slice(0, i + 1) : '';
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
}

function repoRowClass(r: { id: string; hidden: boolean }): string {
  return rowVariants({ layout: 'nav', selected: showRepos.value && selected.value?.id === r.id, muted: r.hidden });
}
</script>

<template>
  <Dialog v-model:open="dialog.open">
    <DialogContent size="xl" fixed-height data-testid="repos-dialog">
      <DialogHeader icon="repo" closable close-testid="repos-dialog-close">
        <DialogTitle>Repositories</DialogTitle>
        <DialogDescription class="sr-only">Import repositories, configure them and manage scan folders.</DialogDescription>
      </DialogHeader>

      <DialogBody flush class="flex-row overflow-hidden">
        <nav class="flex w-44 shrink-0 flex-col border-r border-border">
          <div class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 py-1.5" role="listbox" aria-label="Repositories" data-testid="repos-dialog-repos">
            <p v-if="codeRepos.records.length === 0" class="m-0 px-1.5 py-1 text-kira-md text-muted-foreground">No repositories imported.</p>
            <button
              v-for="r in codeRepos.records"
              :key="r.id"
              type="button"
              role="option"
              class="relative flex w-full shrink-0 cursor-pointer items-center gap-1.5 border-none text-left"
              :class="repoRowClass(r)"
              :aria-selected="showRepos && selected?.id === r.id"
              :title="r.root"
              data-testid="repos-dialog-repo"
              :data-repo-id="r.id"
              :data-hidden="r.hidden"
              @click="pickRepo(r.id)"
            >
              <span :class="colorMarkClass('rail', r.color)" data-testid="repos-dialog-repo-rail" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ nickOf(r.id) || r.name }}</span>
              <CodiconIcon v-if="r.hidden" name="eye-closed" :size="13" class="shrink-0" data-testid="repos-dialog-repo-hidden-mark" />
            </button>
          </div>
          <div class="flex flex-col gap-px border-t border-border px-1 py-1.5">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-1.5 border-none text-left"
              :class="rowVariants({ layout: 'nav', selected: dialog.tab === 'folders' })"
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

        <section class="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Alert v-if="error" variant="destructive" class="m-3 w-auto" data-testid="repos-dialog-error">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
          <template v-if="showRepos">
            <template v-if="selected">
              <ViewToolbar border="none" data-testid="repos-dialog-repo-head" :data-repo-id="selected.id">
                <span :class="colorMarkClass('dot', selected.color)" />
                <span class="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                  <CodiconIcon name="repo" :size="13" />
                </span>
                <span class="min-w-0 truncate text-kira-md text-fg" :title="selected.root" data-testid="repos-dialog-selected"
                  ><span v-if="parentDir(selected.root)" class="text-subtle">{{ parentDir(selected.root) }}</span
                  >{{ selected.name }}</span
                >
                <Badge
                  v-if="selectedConfig"
                  class="shrink-0"
                  :title="selectedConfig.source === 'added' ? undefined : selectedConfig.source"
                  data-testid="repos-dialog-repo-source"
                  >{{ selectedConfig.source === 'added' ? 'Added' : baseName(selectedConfig.source) }}</Badge
                >
                <Badge v-if="selected.hidden" variant="warn" class="shrink-0" data-testid="repos-dialog-repo-hidden-badge">Hidden</Badge>
                <div class="ml-auto flex shrink-0 items-center gap-1">
                  <TooltipIconButton
                    :icon="selected.hidden ? 'eye' : 'eye-closed'"
                    :label="selected.hidden ? 'Show in Git panel' : 'Hide from Git panel'"
                    :aria-pressed="selected.hidden"
                    data-testid="repos-dialog-repo-hide"
                    @click="onHideRepo(selected.id, !selected.hidden)"
                  />
                  <TooltipIconButton
                    icon="trash"
                    label="Remove repository…"
                    data-testid="repos-dialog-repo-remove"
                    @click="onRemoveRepo(selected.id, selected.name)"
                  />
                </div>
              </ViewToolbar>
              <div :class="colorMarkClass('band', selected.color)" />
              <RepoConfigForm v-if="selectedConfig" :key="selectedConfig.codeRepoId" class="m-3" :repo="selectedConfig" />
            </template>
            <p v-else class="m-3 text-muted-foreground">Import a repository to configure it.</p>
          </template>
          <div v-else class="flex flex-col gap-2 p-3" data-testid="repos-dialog-folders">
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
              <span class="shrink-0 text-kira-sm text-muted-foreground" data-testid="repos-dialog-folder-count">{{
                f.hiddenCount > 0 ? `${f.repoCount} repos · ${f.hiddenCount} hidden` : `${f.repoCount} repos`
              }}</span>
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
                :icon="f.hidden ? 'eye' : 'eye-closed'"
                :label="f.hidden ? 'Show all' : 'Hide all'"
                :aria-pressed="f.hidden"
                data-testid="repos-dialog-folder-hide"
                @click="onHideFolder(f.path, !f.hidden)"
              />
              <TooltipIconButton
                icon="close"
                label="Remove folder"
                data-testid="repos-dialog-folder-remove"
                @click="onRemoveFolder(f.path)"
              />
            </div>
          </div>
        </section>
      </DialogBody>

      <DialogFooter>
        <template v-if="!showRepos && note" #start>
          <p class="m-0 text-kira-sm text-muted-foreground" data-testid="repos-dialog-note">{{ note }}</p>
        </template>
        <DialogClose as-child>
          <Button variant="dialog" size="kira-lg" data-testid="repos-dialog-footer-close">Close</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
