<script setup lang="ts">
import type { ApiVariable } from '@shared/domain/variables';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Input } from '@theme/components/ui/input';
import { Popover, PopoverAnchor } from '@theme/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { useEventListener } from '@vueuse/core';
import { ref, useTemplateRef, watch } from 'vue';
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
  /** D14: this row's position in the drag-reorderable list, and whether it is the one currently
   *  being dragged — both owned by the parent, since only it knows the full order. */
  index: number;
  dragging?: boolean;
  /** P16 D14: true while the dialog's own filter is non-empty — reordering is refused ("move up"
   *  past a filter-hidden neighbour has no defined result), and the drag handle says why. */
  filtered?: boolean;
}>();

const emit = defineEmits<{
  'update:name': [value: string];
  'update:value': [value: string];
  'update:isSecret': [value: boolean];
  'update:description': [value: string];
  blur: [];
  remove: [];
  /** Not yet revealed (row.value === '' && row.isSecret) — the eye IS the reveal action. */
  reveal: [];
  dragstart: [index: number];
  dragover: [index: number];
  dragend: [];
  move: [direction: 'up' | 'down'];
  /** R10: the parent knows the tab/scope/owner this row's history popover needs to open against
   *  (state/variables.ts's openHistoryMenu now takes them explicitly) — this row only says
   *  "the history button for this id was clicked". */
  history: [];
}>();

// D9/§1.4: "not yet revealed, the eye is the reveal action; once revealed, it's a free
// client-side mask toggle — no second round trip, no second prompt." A secret's `row.value` is ''
// until VariablesDialog.vue writes the revealed plaintext into this row's own draft (D5's
// projection guarantee: List/Upsert never hand this component a secret's real value any other
// way) — the transition from '' to non-empty, while still isSecret, is exactly "just revealed",
// which is when the value should first render unmasked rather than start hidden again.
const visible = ref(false);
watch(
  () => props.row.value,
  (value, previous) => {
    if (props.row.isSecret && previous === '' && value !== '') visible.value = true;
  },
);

const notYetRevealed = () => props.row.isSecret && props.row.value === '';

function onEyeClick(): void {
  if (notYetRevealed()) {
    emit('reveal');
  } else {
    visible.value = !visible.value;
  }
}

function onNameInput(v: string): void {
  emit('update:name', v);
}
function onValueInput(v: string): void {
  emit('update:value', v);
}
function onSecretChange(checked: boolean): void {
  emit('update:isSecret', checked);
}
function onDescriptionInput(v: string): void {
  emit('update:description', v);
}

const showHistory = ref(false);
// P105: PopoverAnchor's own `:reference` takes the trigger's real DOM node directly (the
// established `.$el` idiom, e.g. GitPanel.vue's promptInput / ConsoleView.vue's savedMenuTriggerEl).
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

// D14: Alt+↑/↓ moves the focused row — a drag-only affordance is unusable from the keyboard, and
// every other control in this dialog is reachable by Tab.
function onKeydown(e: KeyboardEvent): void {
  if (props.trailing || props.filtered || !e.altKey) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    emit('move', 'up');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    emit('move', 'down');
  }
}

// P105 §5.1: the row root has no interactive role of its own -- all four listeners bind here via
// VueUse instead of as raw template attributes.
const rootEl = useTemplateRef<HTMLElement>('rootEl');
useEventListener(rootEl, 'keydown', onKeydown);
useEventListener(rootEl, 'dragstart', () => emit('dragstart', props.index));
useEventListener(rootEl, 'dragover', (e) => {
  e.preventDefault();
  emit('dragover', props.index);
});
useEventListener(rootEl, 'dragend', () => emit('dragend'));
</script>

<template>
  <div
    ref="rootEl"
    class="variable-row"
    :class="{ 'is-dragging': dragging }"
    data-testid="variable-row"
    :data-id="row.id"
    :draggable="!trailing && !filtered"
  >
    <Tooltip v-if="filtered && !trailing">
      <TooltipTrigger as-child>
        <span class="drag-handle" aria-hidden="true" data-testid="variable-grip">
          <CodiconIcon name="gripper" :size="13" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Clear the filter to reorder</TooltipContent>
    </Tooltip>
    <span v-else class="drag-handle" :class="{ 'is-disabled': trailing }" aria-hidden="true" data-testid="variable-grip">
      <CodiconIcon name="gripper" :size="13" />
    </span>
    <div class="cell name-cell">
      <Input
        :model-value="row.name"
        placeholder="name"
        data-testid="variable-name"
        @update:model-value="onNameInput(String($event))"
        @blur="emit('blur')"
      />
      <span v-if="duplicate" class="p-chip warn" data-testid="variable-duplicate">duplicate</span>
    </div>
    <div class="cell value-cell">
      <span v-if="notYetRevealed()" class="masked-value" data-testid="variable-value-masked">••••••••</span>
      <Input
        v-else
        :type="row.isSecret && !visible ? 'password' : 'text'"
        :model-value="row.value"
        placeholder="value"
        data-testid="variable-value"
        @update:model-value="onValueInput(String($event))"
        @blur="emit('blur')"
      />
      <Tooltip v-if="row.isSecret">
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-field text-fg': visible }"
            aria-label="Reveal"
            data-testid="variable-reveal"
            @click="onEyeClick"
          >
            <CodiconIcon name="eye" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ notYetRevealed() ? 'Reveal' : 'Toggle visibility' }}</TooltipContent>
      </Tooltip>
    </div>
    <div class="cell description-cell">
      <Input
        :model-value="row.description"
        placeholder="description"
        data-testid="variable-description"
        @update:model-value="onDescriptionInput(String($event))"
        @blur="emit('blur')"
      />
    </div>
    <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger class="secret-toggle">
          <Checkbox
            :model-value="row.isSecret"
            :disabled="secretsUnavailable && !row.isSecret"
            data-testid="variable-secret"
            @update:model-value="(v) => onSecretChange(v === true)"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>{{ secretsUnavailable ? 'Secret storage is unavailable' : 'Secret' }}</TooltipContent>
    </Tooltip>
    <Popover
      :open="showHistory && variableSetStore.variableId === row.id"
      @update:open="onHistoryOpenChange"
    >
      <div class="history-anchor">
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger ref="historyAnchorRef">
              <Button
                variant="toolbar"
                size="kira-icon"
                :disabled="trailing"
                aria-label="History"
                data-testid="variable-history"
                @click="onHistoryClick"
              >
                <CodiconIcon name="history" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>History</TooltipContent>
        </Tooltip>
        <PopoverAnchor :reference="(historyAnchorRef?.$el as HTMLElement) ?? undefined" />
      </div>
      <VariableHistoryMenu v-if="variableSetStore.variableId === row.id" />
    </Popover>
    <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger>
          <Button
            variant="toolbar"
            size="kira-icon"
            :disabled="props.trailing"
            aria-label="Remove"
            data-testid="variable-remove"
            @click="emit('remove')"
          >
            <CodiconIcon name="trash" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>Remove</TooltipContent>
    </Tooltip>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P22b D9: a grid, not independent flex items — F13's own finding was that adjacent rows' name/
   value/description columns never lined up, since each field carried its own `flex` value and a
   secret row's reveal button (inside the value cell) shifted its neighbours. Named, fixed-fraction
   columns: handle, name, value, description, secret toggle, history, remove. */
.variable-row {
  grid-template-columns: auto 1.2fr 2fr 1.5fr auto auto auto;
  @apply grid items-center gap-1 px-1.5 py-1;
}

.variable-row.is-dragging {
  @apply opacity-50;
}

.drag-handle {
  @apply flex cursor-grab items-center text-subtle;
}

.drag-handle.is-disabled {
  @apply invisible;
}

.cell {
  @apply flex min-w-0 items-center gap-1;
}

/* v1.9 tailwind-declines deep dive: tracking-widest (0.1em) is the widest step Tailwind's default
   scale has; at this row's inherited body font-size (--kira-font-size, 12px default) that is
   1.2px, not the original flat 2px, but nothing further out exists on the scale. */
.masked-value {
  @apply flex-1 text-subtle tracking-widest;
}

.secret-toggle {
  @apply flex items-center;
}

.history-anchor {
  @apply relative flex;
}
</style>
