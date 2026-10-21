<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { useCopy } from '@workbench/behaviour/clipboard';
import { fireAndForget } from '@workbench/bridge/fireAndForget';
import { ref } from 'vue';
import { control } from '../../../bridge/control';
import AdeChip from '../AdeChip.vue';

// One Jira / host link field: chip, link, copy and clear when set, else a paste input. The parent
// validates the pasted text and passes the failure back as `error`.
const props = defineProps<{
  id: string;
  label: string;
  /** Chip text, e.g. `PR`, `issue`, or a Jira status; `''` for none. */
  chip: string;
  /** Link text, e.g. `PAY-102` or `repo#<n>`; `''` when nothing is set. */
  text: string;
  url: string;
  placeholder: string;
  error: string;
}>();
const emit = defineEmits<{ save: [raw: string]; clear: [] }>();

const draft = ref('');
const { copy, copied } = useCopy();

function onSave(): void {
  const raw = draft.value.trim();
  if (!raw) return;
  emit('save', raw);
}

function openLink(e: MouseEvent): void {
  e.preventDefault();
  fireAndForget(control.openExternal(props.url), 'ade.link');
}
</script>

<template>
  <dt>{{ label }}</dt>
  <dd class="flex min-w-0 flex-col justify-center">
    <div class="flex min-h-row min-w-0 items-center gap-2">
      <template v-if="text">
        <AdeChip v-if="chip" :label="chip" tone="grey" wide />
        <a
          v-if="url"
          :href="url"
          class="shrink-0 text-kira-md text-info"
          :data-testid="`${id}-link`"
          @click="openLink"
          >{{
            text
          }}</a
        >
        <span v-else class="shrink-0 text-kira-md" :data-testid="`${id}-link`">{{ text }}</span>
        <span class="min-w-0 flex-1" />
        <TooltipIconButton
          :icon="copied ? 'check' : 'copy'"
          :label="t('space.ade.link.copy.tooltip', { label })"
          class="shrink-0"
          :data-testid="`${id}-copy`"
          @click="copy(url || text)"
        />
        <TooltipIconButton
          icon="close"
          :label="t('space.ade.link.remove.tooltip', { label })"
          class="shrink-0"
          :data-testid="`${id}-clear`"
          @click="emit('clear')"
        />
      </template>
      <template v-else>
        <Label :for="id" class="sr-only">{{ t('space.ade.link.field.label', { label }) }}</Label>
        <Input
          :id="id"
          v-model="draft"
          :placeholder="placeholder"
          :aria-invalid="error ? true : undefined"
          :aria-describedby="error ? `${id}-error-text` : undefined"
          size="kira-lg"
          class="min-w-0 flex-1"
          :data-testid="`${id}-input`"
          @keydown.enter="onSave"
        />
        <Button
          variant="dialog"
          size="kira-lg"
          class="shrink-0"
          :data-testid="`${id}-save`"
          @click="onSave"
        >
          {{ t('common.action.save.label') }}
        </Button>
      </template>
    </div>
    <FieldError v-if="error" :id="`${id}-error-text`" :data-testid="`${id}-error`">{{
      error
    }}</FieldError>
  </dd>
</template>
