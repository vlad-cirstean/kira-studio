<script setup lang="ts">
import { t } from '@theme/i18n';
import type { PickerGroup, PickerOption } from '../../lib/pickerOptions';
import PickerPopover from './PickerPopover.vue';

// The one branch picker. Options come from the caller's own data source. `create` offers a
// "Create branch" item for a new name; `custom` offers "Use {value}" for any ref or sha.
const props = withDefaults(
  defineProps<{
    branches: readonly PickerOption[];
    groups?: readonly PickerGroup[];
    placeholder: string;
    /** Error for a typed new name, or null when valid. */
    create?: { validate: (name: string) => string | null };
    custom?: boolean;
    triggerLabel?: string;
    triggerDetail?: string;
    loading?: boolean;
    error?: string | null;
    disabled?: boolean;
    inline?: boolean;
    size?: 'kira' | 'kira-lg';
    trigger?: 'field' | 'toolbar';
    testid: string;
    id?: string;
    ariaLabel?: string;
  }>(),
  {
    groups: () => [],
    create: undefined,
    custom: false,
    triggerLabel: undefined,
    triggerDetail: undefined,
    loading: false,
    error: null,
    disabled: false,
    inline: false,
    size: 'kira-lg',
    trigger: 'field',
    id: undefined,
    ariaLabel: undefined,
  },
);
const emit = defineEmits<{
  select: [option: PickerOption];
  create: [name: string];
}>();
const model = defineModel<string | null>({ default: null });
const open = defineModel<boolean>('open', { default: false });

function onCustom(text: string): void {
  if (props.create) emit('create', text);
  else model.value = text;
}
</script>

<template>
  <PickerPopover
    v-model="model"
    v-model:open="open"
    :options="branches"
    :groups="groups"
    :placeholder="placeholder"
    :trigger-label="triggerLabel"
    :trigger-detail="triggerDetail"
    :search-placeholder="t('common.picker.findBranch.placeholder')"
    :empty-text="t('common.picker.noBranches.empty')"
    :custom-label="
      create
        ? (q) => t('common.picker.createBranch.label', { name: q })
        : custom
          ? (q) => t('common.picker.useValue.label', { value: q })
          : undefined
    "
    :validate="create?.validate"
    :loading="loading"
    :error="error"
    :disabled="disabled"
    :inline="inline"
    :size="size"
    :trigger="trigger"
    icon="git-branch"
    :testid="testid"
    :id="id"
    :aria-label="ariaLabel"
    @select="emit('select', $event)"
    @custom="onCustom"
  >
    <template #top><slot name="top" /></template>
    <template #footer><slot name="footer" /></template>
  </PickerPopover>
</template>
