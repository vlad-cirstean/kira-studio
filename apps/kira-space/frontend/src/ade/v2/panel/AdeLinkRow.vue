<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { useClipboard } from '@vueuse/core';
import { ref } from 'vue';
import { control } from '../../../bridge/control';
import AdeChip from '../AdeChip.vue';

// One Jira / GitHub field: chip, link, copy and clear when set, else a paste input. The parent
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
const { copy, copied } = useClipboard({ copiedDuring: 1500 });

function onSave(): void {
  const raw = draft.value.trim();
  if (!raw) return;
  emit('save', raw);
}

function openLink(e: MouseEvent): void {
  e.preventDefault();
  void control.linkOpenExternal(props.url);
}
</script>

<template>
  <span class="text-kira-sm text-muted-foreground">{{ label }}</span>
  <div class="flex min-w-0 flex-col justify-center">
    <div class="flex h-7 min-w-0 items-center gap-2">
      <template v-if="text">
        <AdeChip v-if="chip" :label="chip" tone="grey" wide />
        <a
          v-if="url"
          :href="url"
          class="shrink-0 text-kira-md text-info"
          :data-testid="`${id}-link`"
          @click="openLink"
          >{{ text }}</a
        >
        <span v-else class="shrink-0 text-kira-md" :data-testid="`${id}-link`">{{ text }}</span>
        <span class="min-w-0 flex-1" />
        <TooltipIconButton
          :icon="copied ? 'check' : 'copy'"
          :label="`Copy ${label} link`"
          class="shrink-0"
          :data-testid="`${id}-copy`"
          @click="copy(url || text)"
        />
        <TooltipIconButton
          icon="close"
          :label="`Remove ${label} link`"
          class="shrink-0"
          :data-testid="`${id}-clear`"
          @click="emit('clear')"
        />
      </template>
      <template v-else>
        <Label :for="id" class="sr-only">{{ label }} link</Label>
        <Input
          :id="id"
          v-model="draft"
          :placeholder="placeholder"
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
          Save
        </Button>
      </template>
    </div>
    <span v-if="error" class="text-kira-sm text-error" :data-testid="`${id}-error`">{{ error }}</span>
  </div>
</template>
