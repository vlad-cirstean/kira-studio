<script setup lang="ts">
import type { ApiVariable } from '@shared/domain/variables';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Input } from '@theme/components/ui/input';
import { Popover, PopoverAnchor } from '@theme/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { ICON } from '@theme/icons';
import { computed, ref, watch } from 'vue';
import { useVariableSetStore } from './state/variables';
import VariableHistoryMenu from './VariableHistoryMenu.vue';

const variableSetStore = useVariableSetStore();

// P5 D11/D12/D9/D13/D14: one row — a grip handle, a name field, a value field (masked for a
// secret, until revealed), a secret checkbox, a history button/popover, a duplicate-name warning
// chip, and a remove button.
const props = defineProps<{
  row: ApiVariable;
  duplicate: boolean;
  /** True for the trailing blank row — its remove/history/reorder controls are all disabled,
   *  matching FieldRowsTable.vue's own convention for the row shape this reimplements. */
  trailing?: boolean;
  /** D10: secrets.Status().available is false — ticking "secret" is refused, with the reason
   *  shown once at the dialog level rather than repeated per row. */
  secretsUnavailable?: boolean;
  /** P16 D14: true while the dialog's own filter is non-empty — reordering is refused ("move up"
   *  past a filter-hidden neighbour has no defined result), and the drag handle says why. */
  filtered?: boolean;
}>();

const name = defineModel<string>('name', { required: true });
const value = defineModel<string>('value', { required: true });
const description = defineModel<string>('description', { required: true });
const isSecret = defineModel<boolean>('isSecret', { required: true });

const emit = defineEmits<{
  blur: [];
  remove: [];
  /** Not yet revealed (row.value === '' && row.isSecret) — the eye IS the reveal action. */
  reveal: [];
  /** R10: the parent knows the tab/scope/owner this row's history popover needs to open against
   *  (state/variables.ts's openHistoryMenu now takes them explicitly) — this row only says
   *  "the history button for this id was clicked". */
  history: [];
}>();

// "not yet revealed, the eye is the reveal action; once revealed, it's a free
// client-side mask toggle — no second round trip, no second prompt." A secret's `row.value` is ''
// until VariablesDialog.vue writes the revealed plaintext into this row's own draft (the
// projection guarantee: List/Upsert never hand this component a secret's real value any other
// way) — the transition from '' to non-empty, while still isSecret, is exactly "just revealed",
// which is when the value should first render unmasked rather than start hidden again.
const visible = ref(false);
watch(value, (next, previous) => {
  if (isSecret.value && previous === '' && next !== '') visible.value = true;
});

const notYetRevealed = () => isSecret.value && value.value === '';
const valueToggleLabel = computed(() => {
  if (notYetRevealed()) return t('common.action.reveal.label');
  return visible.value ? t('common.hideValue.label') : t('studio.api.variables.showValue.label');
});

function onEyeClick(): void {
  if (notYetRevealed()) {
    emit('reveal');
  } else {
    visible.value = !visible.value;
  }
}

const showHistory = ref(false);
// P105: PopoverAnchor's own `:reference` takes the trigger's real DOM node directly (the
// established `.$el` idiom, e.g. ConsoleView.vue's savedMenuTriggerEl).
const historyAnchorRef = ref<{ $el: HTMLElement } | null>(null);
function onHistoryClick(): void {
  showHistory.value = true;
  emit('history');
}
function onHistoryOpenChange(open: boolean): void {
  if (open) return;
  showHistory.value = false;
  variableSetStore.closeHistoryMenu();
}
</script>

<template>
  <!-- A grid, not independent flex items -- the finding was that adjacent rows'
       name/value/description columns never lined up, since each field carried its own `flex`
       value and a secret row's reveal button (inside the value cell) shifted its neighbours.
       Named, fixed-fraction columns: handle, name, value, description, secret toggle, history,
       remove. grid-cols-[auto_1.2fr_2fr_1.5fr_auto_auto_auto] -- same disclosed
       allowlist gap as VariableSetView.vue's own header-row and VariablesOverviewPanel.vue's
       overview-row -- a pre-existing value relocated, not a new one. -->
  <div
    class="grid items-center gap-1 px-1.5 py-1 grid-cols-[auto_1.2fr_2fr_1.5fr_auto_auto_auto] variable-row"
    data-testid="variable-row"
    :data-id="row.id"
  >
    <Tooltip v-if="filtered && !trailing">
      <TooltipTrigger as-child>
        <span
          class="flex cursor-grab items-center text-subtle"
          aria-hidden="true"
          data-testid="variable-grip"
        >
          <CodiconIcon name="gripper" :size="13" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ t('studio.api.common.reorderBlocked.hint') }}</TooltipContent>
    </Tooltip>
    <span
      v-else
      class="flex cursor-grab items-center text-subtle"
      :class="{ invisible: trailing }"
      aria-hidden="true"
      data-testid="variable-grip"
    >
      <CodiconIcon name="gripper" :size="13" />
    </span>
    <div class="flex min-w-0 items-center gap-1 name-cell">
      <Input
        size="kira"
        :model-value="name"
        :placeholder="t('common.field.name.label')"
        data-testid="variable-name"
        @update:model-value="name = String($event)"
        @blur="emit('blur')"
      />
      <Badge v-if="duplicate" variant="warn" data-testid="variable-duplicate">{{
        t('studio.api.variables.duplicate.status')
      }}</Badge>
    </div>
    <div class="flex min-w-0 items-center gap-1 value-cell">
      <!-- tracking-widest (0.1em) is the widest step Tailwind's default scale has; at this row's
           inherited body font-size (--kira-font-size, 12px default) that is 1.2px, not the
           original flat 2px, but nothing further out exists on the scale. -->
      <span
        v-if="notYetRevealed()"
        class="flex-1 text-subtle tracking-widest"
        data-testid="variable-value-masked"
        >••••••••</span
      >
      <Input
        v-else
        size="kira"
        :type="isSecret && !visible ? 'password' : 'text'"
        :model-value="value"
        :placeholder="t('common.field.value.label')"
        data-testid="variable-value"
        @update:model-value="value = String($event)"
        @blur="emit('blur')"
      />
      <TooltipIconButton
        v-if="isSecret"
        icon="eye"
        :label="valueToggleLabel"
        :aria-label="t('common.action.reveal.label')"
        :pressed="visible"
        data-testid="variable-reveal"
        @click="onEyeClick"
      />
    </div>
    <div class="flex min-w-0 items-center gap-1 description-cell">
      <Input
        size="kira"
        :model-value="description"
        :placeholder="t('common.field.description.label')"
        data-testid="variable-description"
        @update:model-value="description = String($event)"
        @blur="emit('blur')"
      />
    </div>
    <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger class="flex items-center">
          <Checkbox
            :model-value="isSecret"
            :disabled="secretsUnavailable && !isSecret"
            data-testid="variable-secret"
            @update:model-value="(v) => (isSecret = v === true)"
          >
            <CodiconIcon name="check" :size="12" />
          </Checkbox>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>{{
        secretsUnavailable
          ? t('studio.api.variables.secretsUnavailable.tooltip')
          : t('common.secret.label')
      }}</TooltipContent>
    </Tooltip>
    <Popover
      :open="showHistory && variableSetStore.variableId === row.id"
      @update:open="onHistoryOpenChange"
    >
      <div class="relative flex">
        <TooltipIconButton
          :icon="ICON.history"
          :label="t('common.module.history.label')"
          ref="historyAnchorRef"
          disabled-trigger
          :disabled="trailing"
          data-testid="variable-history"
          @click="onHistoryClick"
        />
        <PopoverAnchor :reference="(historyAnchorRef?.$el as HTMLElement) ?? undefined" />
      </div>
      <VariableHistoryMenu v-if="variableSetStore.variableId === row.id" />
    </Popover>
    <TooltipIconButton
      :icon="ICON.remove"
      :label="t('common.action.remove.label')"
      disabled-trigger
      :disabled="props.trailing"
      data-testid="variable-remove"
      @click="emit('remove')"
    />
  </div>
</template>
