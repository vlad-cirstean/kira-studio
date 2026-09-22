<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { formatRelative } from '@workbench/util/format';
import { computed, ref } from 'vue';
import { useGitClientsStore } from '../../state/gitClients';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Connected editors'"` branch — state/gitClients.ts, moved to this
// app wholesale from Kira Studio (P100 Part 2). Bypasses draft/Save entirely, same posture as
// Kira Studio's own 'Scripts'/'Database MCP' sections: gitClientsStore is a module-level store,
// not a settings leaf.
defineProps<SettingsPaneProps>();

const confirmDialogStore = useConfirmDialogStore();
const gitClientsStore = useGitClientsStore();

// D16: a revoke must take effect immediately, not wait for Save.
async function onRevokeGitClient(id: string, label: string): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    `Revoke access for "${label || id}"? It will need to be re-approved.`,
    { danger: true },
  );
  if (ok) await gitClientsStore.revokeGitClient(id);
}

// G10 D12/D14: same bypass-draft-entirely posture as onRevokeGitClient above — an install is an
// action, not a setting. installing starts true only while the click is in flight.
const vsixInstalling = ref(false);
async function onInstallVsCodeIntegration(): Promise<void> {
  vsixInstalling.value = true;
  try {
    await gitClientsStore.installVsCodeIntegration();
  } finally {
    vsixInstalling.value = false;
  }
}

// D12's own outcome copy, verbatim where it's a fixed string; installFailed/revealFailed weave in
// the server's own bounded detail/vsixPath.
const vsixOutcomeMessage = computed(() => {
  const result = gitClientsStore.vsixInstallResult;
  if (!result) return null;
  switch (result.outcome) {
    case 'installed':
      return 'Installed into VS Code. Reload the window to activate it.';
    case 'revealed':
      return "VS Code's code command isn't available. Revealed the file in Finder — drag it onto VS Code, or run Shell Command: Install 'code' command in PATH.";
    case 'notBundled':
      return 'The extension ships inside the packaged app. This build has none.';
    case 'installFailed':
      return `VS Code refused the install: ${result.detail}. Reveal the file in Finder and drag it onto VS Code instead.`;
    case 'revealFailed':
      return `Couldn't reveal the file automatically. Find it at ${result.vsixPath}.`;
    default:
      return null;
  }
});
</script>

<template>
  <div class="settings-pane" v-show="active">
    <!-- G10 D14: the Install VS Code Integration entry point — advisory-rendered from
         VsixStatus, but the click itself always re-resolves through Install. -->
    <div class="git-vsix-install">
      <p v-if="!gitClientsStore.vsix.bundled" class="muted-note" data-testid="git-vsix-not-bundled">
        The extension ships inside the packaged app. This build has none.
      </p>
      <template v-else>
        <p class="mono command-text" data-testid="git-vsix-command">
          {{ gitClientsStore.vsix.command }}
        </p>
        <Button
          variant="dialog"
          size="kira-lg"
          class="action-button"
          :disabled="vsixInstalling"
          data-testid="git-vsix-install-button"
          @click="onInstallVsCodeIntegration"
        >
          {{
            gitClientsStore.vsix.codeAvailable
              ? 'Install VS Code Integration'
              : 'Reveal Extension in Finder'
          }}
        </Button>
      </template>
      <p v-if="vsixOutcomeMessage" class="helper-text" data-testid="git-vsix-outcome">
        {{ vsixOutcomeMessage }}
      </p>
      <p
        v-if="gitClientsStore.vsix.bundled && !gitClientsStore.vsix.codeAvailable && gitClientsStore.vsix.probed.length > 0"
        class="muted-note"
        data-testid="git-vsix-probed"
      >
        Looked for VS Code's <span class="mono">code</span> command at:
        <span class="mono">{{ gitClientsStore.vsix.probed.join(', ') }}</span>
      </p>
    </div>

    <p v-if="gitClientsStore.clients.length === 0" class="muted-note" data-testid="git-clients-empty">
      No editors have been paired yet. A VS Code editor pairs by connecting to
      <span class="mono">~/.kira-space/git.sock</span>.
    </p>
    <ul v-else class="git-clients-list">
      <li
        v-for="client in gitClientsStore.clients"
        :key="client.id"
        class="git-client-row"
        :data-testid="`git-client-row-${client.id}`"
      >
        <div class="git-client-info">
          <span class="git-client-label">{{ client.label || client.id }}</span>
          <span class="helper-text">
            <template v-if="client.revokedAt">Revoked</template>
            <template v-else>Last seen {{ formatRelative(client.lastSeenAt) }}</template>
          </span>
        </div>
        <Tooltip v-if="!client.revokedAt">
          <TooltipTrigger as-child>
            <Button
              variant="danger"
              size="kira-icon"
              :data-testid="`git-client-revoke-${client.id}`"
              aria-label="Revoke"
              @click="onRevokeGitClient(client.id, client.label)"
            >
              <CodiconIcon name="trash" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Revoke</TooltipContent>
        </Tooltip>
      </li>
    </ul>
  </div>
</template>
