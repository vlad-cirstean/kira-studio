<script setup lang="ts">
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { formatBytes } from '../../format';
import { patchHttpRequestTabState } from '../../http/tabs';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
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
  <div class="binary-body-picker">
    <AppButton data-testid="http-binary-choose-file" @click="onChooseFile">Choose file…</AppButton>
    <template v-if="tab.state.binaryFile">
      <span class="p-sm muted binary-file-caption" data-testid="http-binary-file-caption">
        {{ caption }}
      </span>
      <IconButton
        icon="close"
        v-tooltip="'Clear'"
        data-testid="http-binary-clear-file"
        @click="onClearFile"
      />
    </template>
  </div>
</template>

<style scoped>
.binary-body-picker {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3);
}

.binary-file-caption {
  padding: 0;
}
</style>
