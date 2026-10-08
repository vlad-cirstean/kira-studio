<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
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
      <TooltipIconButton icon="cloud-upload" label="Import documents" :disabled="choose.isPending.value" data-testid="memory-import" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem data-testid="memory-import-files" @select="pick('files')">Import files…</DropdownMenuItem>
      <DropdownMenuItem data-testid="memory-import-folder" @select="pick('folder')">Import folder…</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
