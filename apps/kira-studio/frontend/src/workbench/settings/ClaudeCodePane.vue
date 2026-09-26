<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Field, FieldContent, FieldDescription } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { useBusyAction } from '@workbench/util/useBusyAction';
import { useId } from 'vue';
import { useAgentHooksStore } from '../../state/agentHooks';
import { useKeepAwakeStore } from '../../state/keepAwake';
import { useSettingsStore } from '../../state/settings';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Claude Code'"` branch. Both leaves here bypass draft/Save
// entirely (P86 §9.3/P87 §9) — each both persists and starts/stops a live effect (the embedded
// hook listener; the keep-awake assertion) in one call.
defineProps<SettingsPaneProps>();

const agentHooksStore = useAgentHooksStore();
const keepAwakeStore = useKeepAwakeStore();
const settingsStore = useSettingsStore();

const { busy: claudeCodeHooksToggling, run: onToggleAgentHooksEnabled } = useBusyAction(
  (enabled: boolean) => agentHooksStore.setAgentHooksEnabled(enabled),
);

// P87 §9: independent of the title bar's own keep-awake button — either source is enough to hold
// the assertion.
const { busy: keepAwakeAgentAwareToggling, run: onToggleKeepAwakeAgentAware } = useBusyAction(
  (enabled: boolean) => keepAwakeStore.setKeepAwakeAgentAware(enabled),
);

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field> div.
const hooksEnabledId = useId();
const keepAwakeAgentAwareId = useId();
</script>

<template>
  <div class="contents" v-show="active">
    <!-- P86 §9.3: instant-action only, same posture as Connected editors/Database MCP —
         this leaf (claudeCode.hooksEnabled) both persists and starts/stops the embedded
         hook listener in one call, so it belongs on the action side of the draft/Save
         line, never mixed with it. -->
    <Field orientation="horizontal" class="items-start">
      <Checkbox
        :id="hooksEnabledId"
        class="size-3.5"
        :model-value="settingsStore.claudeCode.hooksEnabled"
        :disabled="claudeCodeHooksToggling"
        data-testid="settings-claude-code-hooks"
        @update:model-value="(v) => onToggleAgentHooksEnabled(v === true)"
      >
        <CodiconIcon name="check" :size="10" />
      </Checkbox>
      <FieldContent>
        <Label :for="hooksEnabledId" class="text-kira-sm">Report session activity to Kira Studio</Label>
        <FieldDescription
          >A Claude Code tab launches with a `--settings` flag pointing at a file this app
          owns — no project file is written. Turning this off affects only the next launch;
          a session already running simply stops reporting.</FieldDescription
        >
      </FieldContent>
    </Field>

    <template v-if="settingsStore.claudeCode.hooksEnabled">
      <p
        v-if="agentHooksStore.status.error"
        class="text-subtle text-kira-xs"
        data-testid="claude-code-hooks-error"
      >
        {{ agentHooksStore.status.error }}
      </p>
      <p
        v-else-if="agentHooksStore.status.running"
        class="font-data m-0 whitespace-pre-wrap break-all select-all rounded-kira-sm p-1 bg-field border border-border text-kira-xs leading-normal"
        data-testid="claude-code-hooks-path"
      >
        {{ agentHooksStore.status.settingsPath }}
      </p>
    </template>

    <!-- P87 §9: independent of the title bar's own keep-awake button — either source is
         enough to hold the assertion, and this leaf's own instant-action posture mirrors
         the hooks toggle just above. -->
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
        <Label :for="keepAwakeAgentAwareId" class="text-kira-sm">Keep this Mac awake while a Claude Code session is running</Label>
        <FieldDescription
          >Prevents idle sleep, and system sleep on AC power, for as long as at least one
          Claude Code tab is live. Independent of the title bar's own keep-awake button —
          either one is enough to keep the machine awake.</FieldDescription
        >
      </FieldContent>
    </Field>
  </div>
</template>
