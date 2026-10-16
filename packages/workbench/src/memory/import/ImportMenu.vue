<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { t } from '@theme/i18n';
import { useChooseImport } from './importQueries';
import { useImportUiStore } from './importStore';

// P211: header menu — pick documents or a folder, scan them, then confirm in ImportConfirmDialog.
const ui = useImportUiStore();
const choose = useChooseImport();

function pick(kind: 'files' | 'folder'): void {
  choose.mutate(kind, {
    onSuccess: (job) => {
      if (job) ui.confirmJobId = job.id;
    },
  });
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <TooltipIconButton
        icon="cloud-upload"
        :label="t('memory.import.documents.label')"
        :disabled="choose.isPending.value"
        data-testid="memory-import"
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem data-testid="memory-import-files" @select="pick('files')">{{
        t('memory.import.files.label')
      }}</DropdownMenuItem>
      <DropdownMenuItem data-testid="memory-import-folder" @select="pick('folder')">{{
        t('memory.import.folder.label')
      }}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
