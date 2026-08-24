<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../editor/languages';
import { formatBytes } from '../../format';
import AppButton from '../../theme/primitives/AppButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import { saveValueEdit } from './keyValueMutations';

// P33 D8: an inline CodeMirrorHost band with an explicit Save — mirrors DocumentView.vue's own
// inline edit area (a document-sized body, an explicit Save), not Redis's single-line TextField
// popover (unusable for a body that can be up to OBJECT_BODY_EDIT_BYTES) and not the cell editor
// panel's onEdit seam (F19: that contract stages a write on focusout, which under S3's
// immediate-execute model would turn clicking away into a silent PutObject).
//
// Reuses keyValueMutations.ts's saveValueEdit() unmodified — it already carries the generic
// _key/$value sentinels s3/mutate.ts's applyUpdate() reads, the same way it already does for a
// redis string.

const props = defineProps<{
  tabId: string;
  objectKey: string;
  initial: string;
  language: EditorLanguageId;
}>();
const emit = defineEmits<{ close: [] }>();

const draft = ref(props.initial);
const saving = ref(false);
const error = ref<string | null>(null);

watch(
  () => props.initial,
  (v) => {
    draft.value = v;
  },
);

const byteLength = computed(() => new TextEncoder().encode(draft.value).length);

async function onSave(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    await saveValueEdit(props.tabId, props.objectKey, draft.value);
    emit('close');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

function onCancel(): void {
  emit('close');
}
</script>

<template>
  <div class="object-body-editor" data-testid="object-body-editor">
    <CodeMirrorHost v-model:doc="draft" :language="language" :read-only="saving" />
    <div class="edit-actions">
      <span class="byte-count p-sm muted" data-testid="object-body-bytes">
        {{ formatBytes(byteLength) }}
      </span>
      <MessageStrip v-if="error" tone="err" data-testid="object-body-error">{{ error }}</MessageStrip>
      <span class="edit-actions-spacer"></span>
      <AppButton
        variant="primary"
        data-testid="object-body-save"
        :disabled="saving"
        @click="onSave"
      >
        Save
      </AppButton>
      <AppButton data-testid="object-body-cancel" @click="onCancel">Cancel</AppButton>
    </div>
  </div>
</template>

<style scoped>
.object-body-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.edit-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-4);
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.byte-count {
  padding: 0;
}

.edit-actions-spacer {
  flex: 1;
  min-width: 0;
}
</style>
