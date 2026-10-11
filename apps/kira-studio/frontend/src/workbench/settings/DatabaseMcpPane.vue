<script setup lang="ts">
import type { ConnectionSummary } from '@shared/domain/connection';
import { useQuery } from '@tanstack/vue-query';
import { Button } from '@theme/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldError, FieldLegend } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { t } from '@theme/i18n';
import { useAsyncAction } from '@workbench/behaviour/asyncAction';
import { formatDateTime } from '@workbench/behaviour/format';
import { computed, useId } from 'vue';
import { useConnectionsStore } from '../../state/connections';
import { useDbMcpStore } from '../../state/dbmcp';
import { loadMaskRuleCounts, maskRuleCountsQueryKey } from '../../state/maskRules';
import { useSettingsStore } from '../../state/settings';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Database MCP'"` branch. Bypasses draft/Save entirely —
// dbMcp.serverEnabled both persists and starts/stops the embedded DB MCP server in one call.
defineProps<SettingsPaneProps>();

const connectionsStore = useConnectionsStore();
const dbMcpStore = useDbMcpStore();
const settingsStore = useSettingsStore();
const maskRuleCountsQuery = useQuery({
  queryKey: maskRuleCountsQueryKey,
  queryFn: loadMaskRuleCounts,
});

// M1 §6.2: the DB MCP token's own expiry line — "expired, regenerate" rather than a stale-looking
// date once the instant has passed.
function tokenExpired(expiresAt: string): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

// Instant-action settings (bypassing draft/Save) report a rejected call here, so the switch that
// snaps back is not the only trace of the failure. One error line serves all three actions.
const toggle = useAsyncAction((enabled: boolean) => dbMcpStore.setDbMcpEnabled(enabled));
const regenerate = useAsyncAction(() => dbMcpStore.regenerateDbMcpToken());
const install = useAsyncAction(() => dbMcpStore.installDbMcpClaudeCode());
const connectionToggle = useAsyncAction((id: string, enabled: boolean) =>
  connectionsStore.setConnectionMcpEnabled(id, enabled),
);
const dbMcpToggling = toggle.pending;
const dbMcpRegenerating = regenerate.pending;
const dbMcpInstalling = install.pending;
const actionError = computed(
  () =>
    toggle.error.value ??
    regenerate.error.value ??
    install.error.value ??
    connectionToggle.error.value,
);
function clearActionErrors(): void {
  toggle.error.value = null;
  regenerate.error.value = null;
  install.error.value = null;
  connectionToggle.error.value = null;
}
async function onToggleDbMcpEnabled(enabled: boolean): Promise<void> {
  clearActionErrors();
  await toggle.run(enabled);
}
async function onRegenerateDbMcpToken(): Promise<void> {
  clearActionErrors();
  await regenerate.run();
}
async function onInstallDbMcpClaudeCode(): Promise<void> {
  clearActionErrors();
  await install.run();
}

const dbMcpInstallMessage = computed(() => {
  const result = dbMcpStore.installResult;
  if (!result) return null;
  switch (result.outcome) {
    case 'installed':
      return t('studio.settings.dbMcp.install.installed.body');
    case 'notFound':
      return t('studio.settings.dbMcp.install.notFound.body');
    case 'installFailed':
      return t('studio.settings.dbMcp.install.failed.body', { detail: result.detail });
    default:
      return null;
  }
});

const dbMcpTokenExpired = computed(() => tokenExpired(dbMcpStore.status.expiresAt));

// M1 §6.1: exposure itself (deny by default) stays an instant toggle here. M2 §7.3: the three
// permission modes and the description are edited in the connection's own MCP tab, not here —
// this list stays a read-only glance plus the one control it already had.
async function onToggleConnectionMcpEnabled(id: string, enabled: boolean): Promise<void> {
  clearActionErrors();
  await connectionToggle.run(id, enabled);
}

// M2 §7.3: the row's own description glance — first line only, "" when unset.
function mcpDescriptionFirstLine(conn: ConnectionSummary): string {
  return conn.mcpDescription.split('\n', 1)[0] ?? '';
}

// P110 I2-26: `for`/`id` preserves the old label-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field> div.
const dbMcpEnabledId = useId();
</script>

<template>
  <div class="contents" v-show="active">
    <!-- M1 §6.2: this leaf (dbMcp.serverEnabled) both persists and starts/stops the embedded
         DB MCP server in one call, so it belongs on the action side of the draft/Save line,
         never mixed with it. Toggle, then command, then button, strictly in that DOM order
         (§11.4/SPEC's own "enabling is never a silent action"). -->
    <Field orientation="horizontal" class="items-start">
      <Switch
        :id="dbMcpEnabledId"
        :model-value="settingsStore.dbMcp.serverEnabled"
        :disabled="dbMcpToggling"
        data-testid="settings-db-mcp-enabled"
        @update:model-value="(v) => onToggleDbMcpEnabled(v === true)"
      />
      <FieldContent>
        <Label :for="dbMcpEnabledId">{{ t('studio.settings.dbMcp.enable.label') }}</Label>
        <FieldDescription>{{ t('studio.settings.dbMcp.enable.description') }}</FieldDescription>
      </FieldContent>
    </Field>

    <template v-if="settingsStore.dbMcp.serverEnabled">
      <p v-if="dbMcpStore.status.error" class="text-subtle text-kira-sm" data-testid="db-mcp-error">
        {{ dbMcpStore.status.error }}
      </p>
      <!-- F9: Regenerate must render whenever the server is running, in both branches below —
           the expired-token message further down ("regenerate it above") has no remedy otherwise
           once a command was shown (the common case post-F8: the command shows across ordinary
           restarts now, so this is no longer the rare branch it used to be). -->
      <template v-else-if="dbMcpStore.status.running">
        <template v-if="dbMcpStore.status.command">
          <p
            class="font-data m-0 whitespace-pre-wrap break-all select-all rounded-kira-sm p-1 bg-field border border-border text-kira-sm leading-normal"
            data-testid="db-mcp-command"
          >
            {{ dbMcpStore.status.command }}
          </p>
          <Button
            variant="dialog"
            size="kira-lg"
            class="self-start"
            :disabled="dbMcpInstalling"
            data-testid="db-mcp-install-button"
            @click="onInstallDbMcpClaudeCode"
          >{{
              dbMcpStore.status.claudeAvailable
                ? t('studio.settings.dbMcp.register.label')
                : t('studio.settings.dbMcp.copyCommandAbove.label')
            }}
          </Button>
          <FieldDescription v-if="dbMcpInstallMessage" data-testid="db-mcp-install-outcome">
            {{ dbMcpInstallMessage }}
          </FieldDescription>
        </template>
        <p v-else class="text-subtle text-kira-sm" data-testid="db-mcp-no-token">
          {{ t('studio.settings.dbMcp.noToken.hint') }}
        </p>
        <Button
          variant="dialog"
          size="kira-lg"
          class="self-start"
          :disabled="dbMcpRegenerating"
          data-testid="db-mcp-regenerate-button"
          @click="onRegenerateDbMcpToken"
        >
          {{ t('studio.settings.dbMcp.regenerate.label') }}
        </Button>
      </template>
      <FieldDescription
        v-if="dbMcpStore.status.running && dbMcpStore.status.expiresAt"
        data-testid="db-mcp-token-expiry"
      >
        {{
          dbMcpTokenExpired
            ? t('studio.settings.dbMcp.tokenExpired.body')
            : t('studio.settings.dbMcp.tokenValid.body', { date: formatDateTime(dbMcpStore.status.expiresAt) })
        }}
      </FieldDescription>
    </template>

    <FieldLegend>{{ t('studio.settings.dbMcp.exposed.label') }}</FieldLegend>
    <FieldDescription>{{ t('studio.settings.dbMcp.exposed.description') }}</FieldDescription>
    <p class="text-subtle text-kira-sm">{{ t('studio.settings.dbMcp.defaults.hint') }}</p>
    <ul
      v-if="connectionsStore.records.length"
      class="flex flex-col m-0 p-0 list-none gap-0.5"
      data-testid="db-mcp-connections-list"
    >
      <li
        v-for="conn in connectionsStore.records"
        :key="conn.id"
        class="flex items-center justify-between rounded-kira-sm gap-1.5 py-1 px-1.5 border border-border"
        :data-testid="`db-mcp-connection-row-${conn.id}`"
      >
        <div class="flex flex-col min-w-0 gap-0.5">
          <span class="break-words text-fg text-kira-md">{{ conn.name }}</span>
          <FieldDescription>{{
              t(conn.mcpAutoExplain ? 'studio.settings.dbMcp.modesPlans.status' : 'studio.settings.dbMcp.modes.status', {
                read: conn.mcpReadMode,
                write: conn.mcpWriteMode,
                ddl: conn.mcpDdlMode,
              })
            }}</FieldDescription>
          <FieldDescription v-if="mcpDescriptionFirstLine(conn)">{{
            mcpDescriptionFirstLine(conn)
          }}</FieldDescription>
          <!-- M5 §7.5: extends this existing read-only glance — no second full editor
               here (M2's own established split); editing lives in the connection's own
               Privacy tab. -->
          <FieldDescription
            v-if="maskRuleCountsQuery.data.value?.[conn.id]"
            :data-testid="`db-mcp-connection-masked-${conn.id}`"
            >{{
              t('studio.settings.dbMcp.masked.status', { count: maskRuleCountsQuery.data.value?.[conn.id] ?? 0 })
            }}</FieldDescription
          >
        </div>
        <Switch
          :model-value="conn.mcpEnabled"
          :data-testid="`db-mcp-connection-${conn.id}`"
          @update:model-value="(v) => onToggleConnectionMcpEnabled(conn.id, v === true)"
        />
      </li>
    </ul>
    <p v-else class="text-subtle text-kira-sm" data-testid="db-mcp-connections-empty">
      {{ t('studio.settings.dbMcp.empty.empty') }}
    </p>
    <FieldError v-if="actionError" data-testid="settings-action-error">{{ actionError }}</FieldError>
  </div>
</template>
