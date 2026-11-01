<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import Spinner from '@theme/components/Spinner.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Card } from '@theme/components/ui/card';
import { FieldDescription } from '@theme/components/ui/field';
import { Textarea } from '@theme/components/ui/textarea';
import { formatBytes } from '@theme/format';
import { t } from '@theme/i18n';
import { useDropZone, useEventListener, useFileDialog, useSessionStorage } from '@vueuse/core';
import { errorText } from '@workbench/bridge/codedError';
import { windowKey } from '@workbench/bridge/rpc';
import { shortcutKeydown } from '@workbench/shortcuts/useShortcut';
import { computed, ref, useTemplateRef } from 'vue';
import { gapText } from '../ade/v2/artifacts/gapText';
import { checkFile, fileToBase64 } from './attachments';
import MarkdownBody from './MarkdownBody.vue';
import { PostRejected, useDiscardAttachment, usePostComment, useStageAttachment } from './queries';
import type { HostViewCompose } from './wire';

// One comment composer: Markdown text, files by picker, drop or paste, and Post. Text stays exactly
// as typed (Markdown source, not rich text). A failed post keeps the text and the staged files.
const props = defineProps<{
  compose: HostViewCompose;
  kind: 'changeRequest' | 'issue';
  /** The query the optimistic comment is written to. */
  queryKey: readonly unknown[];
  /** Tracker id, for the reason words of an issue failure. */
  provider: string;
  replyTo?: string;
  compact?: boolean;
}>();
const emit = defineEmits<{ posted: []; cancel: [] }>();

interface Item {
  id: number;
  name: string;
  size: number;
  state: 'reading' | 'staging' | 'ready' | 'error';
  stagedId?: string;
  error?: string;
}

const card = useTemplateRef<{ $el: HTMLElement }>('root');
const root = computed(() => card.value?.$el);
const body = useSessionStorage(
  () => `kira.hostview.draft:${windowKey}:${props.kind}:${props.replyTo ?? ''}`,
  '',
);
const mode = ref('write');
const items = ref<Item[]>([]);
const notice = ref('');
const error = ref('');
let nextId = 0;

const stage = useStageAttachment(windowKey);
const discard = useDiscardAttachment(windowKey);
const post = usePostComment({ windowKey, kind: props.kind, queryKey: () => props.queryKey });

const bytes = computed(() => new TextEncoder().encode(body.value).length);
const overCap = computed(() => bytes.value > props.compose.maxBodyBytes);
const nearCap = computed(() => bytes.value > props.compose.maxBodyBytes * 0.8);
const busy = computed(() =>
  items.value.some((i) => i.state === 'reading' || i.state === 'staging'),
);
const failed = computed(() => items.value.some((i) => i.state === 'error'));
const readyIds = computed(() =>
  items.value.flatMap((i) => (i.state === 'ready' && i.stagedId ? [i.stagedId] : [])),
);
const canPost = computed(
  () =>
    !post.isPending.value &&
    !busy.value &&
    !failed.value &&
    !overCap.value &&
    (body.value.trim() !== '' || readyIds.value.length > 0),
);
const done = computed(() => items.value.filter((i) => i.state === 'ready').length);
const preview = computed(() => {
  const names = items.value
    .filter((i) => i.state === 'ready')
    .map((i) => i.name.replaceAll('`', ''));
  return names.length
    ? `${body.value}\n\n${names.map((n) => `- \`${n}\``).join('\n')}`
    : body.value;
});
const unsupportedReason = computed(() => props.compose.attachmentsReason ?? '');

async function addFile(file: File): Promise<void> {
  const refusal = checkFile(
    file,
    props.compose,
    items.value.filter((i) => i.state !== 'error'),
  );
  if (refusal) {
    notice.value = refusal;
    return;
  }
  items.value.push({ id: ++nextId, name: file.name, size: file.size, state: 'reading' });
  const item = items.value[items.value.length - 1] as Item;
  try {
    const data = await fileToBase64(file);
    item.state = 'staging';
    const staged = await stage.mutateAsync({ name: file.name, data });
    item.stagedId = staged.id;
    item.name = staged.name;
    item.state = 'ready';
  } catch (err) {
    item.state = 'error';
    item.error = errorText(err);
  }
}

function addFiles(files: readonly File[] | null): void {
  if (!files?.length) return;
  notice.value = '';
  if (!props.compose.attachments) {
    notice.value = unsupportedReason.value;
    return;
  }
  for (const file of files) void addFile(file);
}

const { isOverDropZone } = useDropZone(root, {
  onDrop: (files) => addFiles(files),
  multiple: true,
  preventDefaultForUnhandled: true,
});
const dialog = useFileDialog({
  multiple: true,
  reset: true,
  accept: props.compose.allowedExtensions.map((e) => `.${e}`).join(','),
});
dialog.onChange((list) => addFiles(list ? Array.from(list) : null));
useEventListener(root, 'paste', (e: ClipboardEvent) => {
  const files = e.clipboardData?.files;
  if (!files || files.length === 0) return;
  e.preventDefault();
  addFiles(Array.from(files));
});

function remove(item: Item): void {
  items.value = items.value.filter((i) => i.id !== item.id);
  if (item.stagedId) discard.mutate(item.stagedId);
}

function failureText(err: unknown): string {
  if (!(err instanceof PostRejected)) return errorText(err);
  if (err.kind === 'gone') return t('space.hostView.gone.body');
  const text =
    props.kind === 'issue'
      ? gapText({ source: props.provider, repo: '', reason: err.reason || 'failed' })
      : err.reason;
  const timedOut =
    props.kind === 'issue' ? err.reason === 'timeout' : /may have been recorded/.test(err.reason);
  return timedOut ? `${text} ${t('space.hostView.compose.mayHavePosted.hint')}` : text;
}

async function submit(): Promise<void> {
  if (!canPost.value) return;
  error.value = '';
  try {
    await post.mutateAsync({
      body: body.value,
      replyTo: props.replyTo ?? '',
      attachmentIds: readyIds.value,
    });
    body.value = '';
    items.value = [];
    notice.value = '';
    mode.value = 'write';
    emit('posted');
  } catch (err) {
    error.value = failureText(err);
  }
}

const onSubmitKey = shortcutKeydown(['form.submit'], () => void submit());
const modes = computed(() => [
  { value: 'write', label: t('common.action.edit.label'), testid: 'comment-mode-write' },
  { value: 'preview', label: t('llmPrompts.tab.preview.label'), testid: 'comment-mode-preview' },
]);
</script>

<template>
  <Card
    ref="root"
    variant="section"
    class="relative gap-2 p-2"
    :data-compact="compact || undefined"
    data-testid="comment-composer"
  >
    <div
      v-if="isOverDropZone"
      class="absolute inset-0 z-3 flex items-center justify-center rounded-kira-md border border-dashed border-primary bg-bg/90 px-4 text-center text-kira-md"
      data-testid="comment-drop-overlay"
    >
      {{ compose.attachments ? t('space.hostView.compose.drop.label') : unsupportedReason }}
    </div>
    <div class="flex items-center gap-2">
      <SecondaryTabs
        v-model="mode"
        :items="modes"
        variant="segmented"
        :aria-label="t('space.hostView.compose.mode.aria')"
      />
      <TooltipIconButton
        class="ml-auto"
        icon="attach"
        :label="t('space.hostView.compose.attach.label')"
        :disabled="!compose.attachments"
        disabled-trigger
        data-testid="comment-attach"
        @click="dialog.open()"
      >
        {{ compose.attachments ? t('space.hostView.compose.attach.label') : unsupportedReason }}
      </TooltipIconButton>
    </div>
    <Textarea
      v-if="mode === 'write'"
      v-model="body"
      :rows="compact ? 3 : 5"
      class="min-h-16 resize-none field-sizing-fixed"
      :aria-label="t('common.comment.label')"
      :placeholder="t('space.hostView.compose.body.placeholder')"
      data-testid="comment-body"
      @keydown="onSubmitKey"
    />
    <Card v-else class="min-h-16" data-testid="comment-preview">
      <MarkdownBody v-if="preview.trim()" :source="preview" />
      <FieldDescription v-else>{{ t('space.hostView.compose.preview.empty') }}</FieldDescription>
    </Card>
    <ul
      v-if="items.length"
      class="m-0 flex list-none flex-col gap-1 p-0"
      :aria-label="t('space.hostView.compose.attachments.aria')"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="flex items-center gap-2 px-2 py-1 text-kira-sm"
        :data-state="item.state"
        data-testid="comment-attachment"
      >
        <span class="min-w-0 flex-1 truncate font-data">{{ item.name }}</span>
        <span class="shrink-0 text-muted-foreground">{{ formatBytes(item.size) }}</span>
        <template v-if="item.state === 'reading' || item.state === 'staging'">
          <Spinner :label="''" />
          <span class="shrink-0 text-muted-foreground">{{
            t('space.hostView.compose.staging.status', { done, total: items.length })
          }}</span>
        </template>
        <span
          v-else-if="item.state === 'error'"
          class="text-error"
          data-testid="comment-attachment-error"
          >{{
            item.error
          }}</span
        >
        <TooltipIconButton
          icon="close"
          :label="t('automations.smart.remove.tooltip', { name: item.name })"
          data-testid="comment-attachment-remove"
          @click="remove(item)"
        />
      </li>
    </ul>
    <FieldDescription v-if="notice" data-testid="comment-notice">{{ notice }}</FieldDescription>
    <Alert v-if="error" variant="error" data-testid="comment-error">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <div class="flex items-center gap-2">
      <span
        v-if="nearCap"
        class="text-kira-sm"
        :class="overCap ? 'text-error' : 'text-muted-foreground'"
        data-testid="comment-cap"
        >{{
          t('common.ofTotal.label', {
            value: formatBytes(bytes),
            total: formatBytes(compose.maxBodyBytes),
          })
        }}</span
      >
      <div class="ml-auto flex items-center gap-2">
        <Button
          v-if="replyTo"
          variant="dialog"
          size="kira"
          data-testid="comment-cancel"
          @click="emit('cancel')"
        >
          {{ t('common.action.cancel.label') }}
        </Button>
        <Button
          variant="dialog-primary"
          size="kira"
          :pending="post.isPending.value"
          :disabled="!canPost"
          data-testid="comment-post"
          @click="submit"
        >
          {{ t('common.comment.label') }}
        </Button>
      </div>
    </div>
  </Card>
</template>
