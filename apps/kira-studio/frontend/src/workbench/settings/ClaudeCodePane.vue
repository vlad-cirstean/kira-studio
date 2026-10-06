<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldError } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { useBusyAction } from '@workbench/util/useBusyAction';
import { useId } from 'vue';
import { useKeepAwakeStore } from '../../state/keepAwake';
import { useSettingsStore } from '../../state/settings';
import type { SettingsPaneProps } from './types';
import { useActionError } from './useActionError';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Claude Code'"` branch. P127: the section used to also carry the
// hooks-reporting toggle (agent-activity monitoring left Kira Studio); this leaf survives because
// keep-awake reads only the terminal registry's own agent count, never the hooks — one
// instant-action leaf, bypassing draft/Save entirely (P87 §9), since it both persists and
// recomputes the live keep-awake assertion in one call.
defineProps<SettingsPaneProps>();

const keepAwakeStore = useKeepAwakeStore();
const settingsStore = useSettingsStore();

// P87 §9: independent of the title bar's own keep-awake button — either source is enough to hold
// the assertion.
const { error: actionError, guard } = useActionError();
const { busy: keepAwakeAgentAwareToggling, run: onToggleKeepAwakeAgentAware } = useBusyAction(
  guard((enabled: boolean) => keepAwakeStore.setKeepAwakeAgentAware(enabled)),
);

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field> div.
const keepAwakeAgentAwareId = useId();
</script>

<template>
  <div class="contents" v-show="active">
    <!-- P87 §9: independent of the title bar's own keep-awake button — either source is
         enough to hold the assertion. -->
    <Field orientation="horizontal" class="items-start">
      <Checkbox
        :id="keepAwakeAgentAwareId"
        class="size-3.5"
        :model-value="settingsStore.claudeCode.keepAwakeWithAgents"
        :disabled="keepAwakeAgentAwareToggling"
        data-testid="settings-claude-code-keep-awake"
        @update:model-value="(v) => onToggleKeepAwakeAgentAware(v === true)"
      >
        <CodiconIcon name="check" :size="10" />
      </Checkbox>
      <FieldContent>
        <Label :for="keepAwakeAgentAwareId">Keep this Mac awake while a Claude Code session is running</Label>
        <FieldDescription
          >Prevents idle sleep, and system sleep on AC power, for as long as at least one
          Claude Code tab is live. Independent of the title bar's own keep-awake button —
          either one is enough to keep the machine awake.</FieldDescription
        >
      </FieldContent>
    </Field>
    <FieldError v-if="actionError" data-testid="settings-action-error">{{ actionError }}</FieldError>
  </div>
</template>
