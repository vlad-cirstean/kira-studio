<script setup lang="ts">
import type { ConnectionSummary } from '@shared/domain/connection';
import { useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldLegend } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { useBusyAction } from '@workbench/util/useBusyAction';
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
  staleTime: Number.POSITIVE_INFINITY,
});

// M1 §6.2: the DB MCP token's own expiry line — "expired, regenerate" rather than a stale-looking
// date once the instant has passed.
function tokenExpired(expiresAt: string): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

const { busy: dbMcpToggling, run: onToggleDbMcpEnabled } = useBusyAction((enabled: boolean) =>
  dbMcpStore.setDbMcpEnabled(enabled),
);
const { busy: dbMcpRegenerating, run: onRegenerateDbMcpToken } = useBusyAction(() =>
  dbMcpStore.regenerateDbMcpToken(),
);
const { busy: dbMcpInstalling, run: onInstallDbMcpClaudeCode } = useBusyAction(() =>
  dbMcpStore.installDbMcpClaudeCode(),
);

const dbMcpInstallMessage = computed(() => {
  const result = dbMcpStore.installResult;
  if (!result) return null;
  switch (result.outcome) {
    case 'installed':
      return 'Registered with Claude Code.';
    case 'notFound':
      return "Claude Code's CLI isn't available. Copy the command above and run it yourself once it is installed.";
    case 'installFailed':
      return `Claude Code refused the registration: ${result.detail}. Copy the command above and run it yourself.`;
    default:
      return null;
  }
});

const dbMcpTokenExpired = computed(() => tokenExpired(dbMcpStore.status.expiresAt));

// M1 §6.1: exposure itself (deny by default) stays an instant toggle here. M2 §7.3: the three
// permission modes and the description are edited in the connection's own MCP tab, not here —
// this list stays a read-only glance plus the one control it already had.
async function onToggleConnectionMcpEnabled(id: string, enabled: boolean): Promise<void> {
  await connectionsStore.setConnectionMcpEnabled(id, enabled);
}

// M2 §7.3: the row's own description glance — first line only, "" when unset.
function mcpDescriptionFirstLine(conn: ConnectionSummary): string {
  return conn.mcpDescription.split('\n', 1)[0] ?? '';
}

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
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
      <Checkbox
        :id="dbMcpEnabledId"
        class="size-3.5"
        :model-value="settingsStore.dbMcp.serverEnabled"
        :disabled="dbMcpToggling"
        data-testid="settings-db-mcp-enabled"
        @update:model-value="(v) => onToggleDbMcpEnabled(v === true)"
      >
        <CodiconIcon name="check" :size="10" />
      </Checkbox>
      <FieldContent>
        <Label :for="dbMcpEnabledId">Enable the database MCP server</Label>
        <FieldDescription
          >Lets an AI client list, browse and query the connections exposed below, through
          the same path this app's own SQL console uses. Starts and stops with this
          toggle.</FieldDescription
        >
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
          >{{ dbMcpStore.status.claudeAvailable ? 'Register with Claude Code' : 'Copy command above' }}
          </Button>
          <FieldDescription v-if="dbMcpInstallMessage" data-testid="db-mcp-install-outcome">
            {{ dbMcpInstallMessage }}
          </FieldDescription>
        </template>
        <p v-else class="text-subtle text-kira-sm" data-testid="db-mcp-no-token">
          This server restarted since it was last enabled; its registration command needs a
          fresh token to show again.
        </p>
        <Button
          variant="dialog"
          size="kira-lg"
          class="self-start"
          :disabled="dbMcpRegenerating"
          data-testid="db-mcp-regenerate-button"
          @click="onRegenerateDbMcpToken"
        >
          Regenerate token
        </Button>
      </template>
      <FieldDescription
        v-if="dbMcpStore.status.running && dbMcpStore.status.expiresAt"
        data-testid="db-mcp-token-expiry"
      >
        {{
          dbMcpTokenExpired
            ? 'Token expired — regenerate it above.'
            : `Token valid until ${new Date(dbMcpStore.status.expiresAt).toLocaleString()}.`
        }}
      </FieldDescription>
    </template>

    <FieldLegend>Exposed connections</FieldLegend>
    <FieldDescription>
      Deny by default — only connections checked here are visible to an AI client through
      this server.
    </FieldDescription>
    <p class="text-subtle text-kira-sm">
      A newly exposed connection defaults to read allow, write prompt, DDL deny — this
      migration tightened what an already-exposed connection allowed too. Edit a
      connection's own three modes and description in its MCP tab. Newly exposed
      connections plan their queries before running them, and a plan over the
      expensive-query threshold pauses for approval.
    </p>
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
          <FieldDescription
            >read {{ conn.mcpReadMode }} · write {{ conn.mcpWriteMode }} · DDL
            {{ conn.mcpDdlMode }}<template v-if="conn.mcpAutoExplain">
              · plans queries</template
            ></FieldDescription
          >
          <FieldDescription v-if="mcpDescriptionFirstLine(conn)">{{
            mcpDescriptionFirstLine(conn)
          }}</FieldDescription>
          <!-- M5 §7.5: extends this existing read-only glance — no second full editor
               here (M2's own established split); editing lives in the connection's own
               Privacy tab. -->
          <FieldDescription
            v-if="maskRuleCountsQuery.data.value?.[conn.id]"
            :data-testid="`db-mcp-connection-masked-${conn.id}`"
            >{{ maskRuleCountsQuery.data.value?.[conn.id] }} masked column{{
              maskRuleCountsQuery.data.value?.[conn.id] === 1 ? '' : 's'
            }}</FieldDescription
          >
        </div>
        <Checkbox
          class="size-3.5"
          :model-value="conn.mcpEnabled"
          :data-testid="`db-mcp-connection-${conn.id}`"
          @update:model-value="(v) => onToggleConnectionMcpEnabled(conn.id, v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
      </li>
    </ul>
    <p v-else class="text-subtle text-kira-sm" data-testid="db-mcp-connections-empty">
      No connections yet — add one first.
    </p>
  </div>
</template>
