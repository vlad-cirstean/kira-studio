<script setup lang="ts">
import type { ConnectionSummary } from '@shared/domain/connection';
import { useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Label } from '@theme/components/ui/label';
import { useBusyAction } from '@workbench/util/useBusyAction';
import { computed } from 'vue';
import { useConnectionsStore } from '../../state/connections';
import { useDbMcpStore } from '../../state/dbmcp';
import { loadMaskRuleCounts, maskRuleCountsQueryKey } from '../../state/maskRules';
import { useSettingsStore } from '../../state/settings';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Database MCP'"` branch. Bypasses draft/Save entirely (same
// instant-action posture as 'Connected editors' before it moved to apps/kira-space, P100 Part 2) —
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
</script>

<template>
  <div class="settings-pane" v-show="active">
    <!-- M1 §6.2: the same instant-action posture the 'Connected editors' section's own
         revoke/install actions used before it moved to apps/kira-space (P100 Part 2) — this leaf
         (dbMcp.serverEnabled) both persists and starts/stops the embedded DB MCP server in
         one call, so it belongs on the action side of the draft/Save line, never mixed with
         it. Toggle, then command, then button, strictly in that DOM order (§11.4/SPEC's own
         "enabling is never a silent action"). -->
    <Label class="field checkbox">
      <Checkbox
        class="size-3.5"
        :model-value="settingsStore.dbMcp.serverEnabled"
        :disabled="dbMcpToggling"
        data-testid="settings-db-mcp-enabled"
        @update:model-value="(v) => onToggleDbMcpEnabled(v === true)"
      >
        <CodiconIcon name="check" :size="10" />
      </Checkbox>
      <span>Enable the database MCP server</span>
      <span class="helper-text"
        >Lets an AI client list, browse and query the connections exposed below, through
        the same path this app's own SQL console uses. Starts and stops with this
        toggle.</span
      >
    </Label>

    <template v-if="settingsStore.dbMcp.serverEnabled">
      <p v-if="dbMcpStore.status.error" class="muted-note" data-testid="db-mcp-error">
        {{ dbMcpStore.status.error }}
      </p>
      <!-- F9: Regenerate must render whenever the server is running, in both branches below —
           the expired-token message further down ("regenerate it above") has no remedy otherwise
           once a command was shown (the common case post-F8: the command shows across ordinary
           restarts now, so this is no longer the rare branch it used to be). -->
      <template v-else-if="dbMcpStore.status.running">
        <template v-if="dbMcpStore.status.command">
          <p class="mono command-text" data-testid="db-mcp-command">
            {{ dbMcpStore.status.command }}
          </p>
          <Button
            variant="dialog"
            size="kira-lg"
            class="action-button"
            :disabled="dbMcpInstalling"
            data-testid="db-mcp-install-button"
            @click="onInstallDbMcpClaudeCode"
          >{{ dbMcpStore.status.claudeAvailable ? 'Register with Claude Code' : 'Copy command above' }}
          </Button>
          <p v-if="dbMcpInstallMessage" class="helper-text" data-testid="db-mcp-install-outcome">
            {{ dbMcpInstallMessage }}
          </p>
        </template>
        <p v-else class="muted-note" data-testid="db-mcp-no-token">
          This server restarted since it was last enabled; its registration command needs a
          fresh token to show again.
        </p>
        <Button
          variant="dialog"
          size="kira-lg"
          class="action-button"
          :disabled="dbMcpRegenerating"
          data-testid="db-mcp-regenerate-button"
          @click="onRegenerateDbMcpToken"
        >
          Regenerate token
        </Button>
      </template>
      <p
        v-if="dbMcpStore.status.running && dbMcpStore.status.expiresAt"
        class="helper-text"
        data-testid="db-mcp-token-expiry"
      >
        {{
          dbMcpTokenExpired
            ? 'Token expired — regenerate it above.'
            : `Token valid until ${new Date(dbMcpStore.status.expiresAt).toLocaleString()}.`
        }}
      </p>
    </template>

    <div class="sec-label">Exposed connections</div>
    <p class="helper-text">
      Deny by default — only connections checked here are visible to an AI client through
      this server.
    </p>
    <p class="muted-note">
      A newly exposed connection defaults to read allow, write prompt, DDL deny — this
      migration tightened what an already-exposed connection allowed too. Edit a
      connection's own three modes and description in its MCP tab. Newly exposed
      connections plan their queries before running them, and a plan over the
      expensive-query threshold pauses for approval.
    </p>
    <ul
      v-if="connectionsStore.records.length"
      class="db-mcp-connections-list"
      data-testid="db-mcp-connections-list"
    >
      <li
        v-for="conn in connectionsStore.records"
        :key="conn.id"
        class="db-mcp-connection-row"
        :data-testid="`db-mcp-connection-row-${conn.id}`"
      >
        <div class="db-mcp-connection-info">
          <span class="db-mcp-connection-name">{{ conn.name }}</span>
          <span class="helper-text"
            >read {{ conn.mcpReadMode }} · write {{ conn.mcpWriteMode }} · DDL
            {{ conn.mcpDdlMode }}<template v-if="conn.mcpAutoExplain">
              · plans queries</template
            ></span
          >
          <span v-if="mcpDescriptionFirstLine(conn)" class="helper-text">{{
            mcpDescriptionFirstLine(conn)
          }}</span>
          <!-- M5 §7.5: extends this existing read-only glance — no second full editor
               here (M2's own established split); editing lives in the connection's own
               Privacy tab. -->
          <span
            v-if="maskRuleCountsQuery.data.value?.[conn.id]"
            class="helper-text"
            :data-testid="`db-mcp-connection-masked-${conn.id}`"
            >{{ maskRuleCountsQuery.data.value?.[conn.id] }} masked column{{
              maskRuleCountsQuery.data.value?.[conn.id] === 1 ? '' : 's'
            }}</span
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
    <p v-else class="muted-note" data-testid="db-mcp-connections-empty">
      No connections yet — add one first.
    </p>
  </div>
</template>
