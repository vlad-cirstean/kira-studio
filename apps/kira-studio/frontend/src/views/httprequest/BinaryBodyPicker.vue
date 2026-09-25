<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { patchHttpRequestTabState } from '../../api/tabs';
import type { HttpRequestTabRecord } from '../../state/tabDomain';
import { chooseBodyFile } from './files';

// P3 C9/D4: the binary (Postman `file`) body — one whole local file, sent as the entire request
// body. Choose file / name (size) / Clear over state.binaryFile, the same shape FormDataTable's
// file row uses (D15) and UploadObjectDialog.vue established (D4's precedent). The caption in
// RequestBodyPane.vue already reads "No Content-Type (binary)" for this mode (C5/F3/D7).
const props = defineProps<{ tab: HttpRequestTabRecord }>();

// P7 F15: an imported `--data-binary @path` has no size to supply (the renderer never reads a
// file's bytes, P3 D4) — `size: 0` is that "unknown" state, and formatBytes(0) would print a
// misleading "(0 B)" for it, so the parenthetical is omitted entirely rather than lying about it.
const caption = computed(() => {
  const file = props.tab.state.binaryFile;
  if (!file) return '';
  return file.size > 0 ? `${file.name} (${formatBytes(file.size)})` : file.name;
});

async function onChooseFile(): Promise<void> {
  const file = await chooseBodyFile('Choose file');
  if (!file) return;
  patchHttpRequestTabState(props.tab.id, { binaryFile: file });
}

function onClearFile(): void {
  patchHttpRequestTabState(props.tab.id, { binaryFile: null });
}
</script>

<template>
  <div class="flex items-center gap-1 p-1.5">
    <Button variant="toolbar" size="kira" data-testid="http-binary-choose-file" @click="onChooseFile">
      Choose file…
    </Button>
    <template v-if="tab.state.binaryFile">
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="text-kira-sm text-muted-foreground p-0" data-testid="http-binary-file-caption">{{ caption }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ tab.state.binaryFile.path }}</TooltipContent>
      </Tooltip>
      <TooltipIconButton
        icon="close"
        label="Clear"
        data-testid="http-binary-clear-file"
        @click="onClearFile"
      />
    </template>
  </div>
</template>
