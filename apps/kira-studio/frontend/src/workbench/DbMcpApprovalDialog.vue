<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { approveQuery, dbMcpState, denyQuery } from '../state/dbmcp';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';

// M2 §5.4/§7.4: a separate, always-mounted dialog at App.vue's root — GitPairingDialog.vue's own
// precedent applied to run_query's prompt-mode gate. An AI client is blocked while the human
// decides, the same semantics pairing's own trust prompt has, so this reuses that answer rather
// than a dock or a notification queue. Renders nothing while dbMcpState.approval.pending is null.

const denyButton = ref<{ $el: HTMLElement } | null>(null);
let ticking = 0;
const now = ref(Date.now());

onMounted(() => {
  // Runs after DialogFrame's own onMounted (children mount before their parent), so this is the
  // focus call that sticks — Deny is the default focus, an approval dialog whose Enter key runs a
  // write or DDL statement is the wrong default.
  denyButton.value?.$el?.focus();
  ticking = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => window.clearInterval(ticking));

const remainingSeconds = computed(() => {
  const expires = dbMcpState.approval.pending?.expiresAtMs;
  if (expires === undefined) return 0;
  return Math.max(0, Math.ceil((expires - now.value) / 1000));
});

const CLASS_WORDS: Record<string, string> = {
  read: 'a read statement',
  write: 'a write statement',
  ddl: 'a schema-changing (DDL) statement',
  unknown: 'a statement this app could not classify',
};

const classWord = computed(() => {
  const cls = dbMcpState.approval.pending?.class;
  return cls ? (CLASS_WORDS[cls] ?? 'a statement') : 'a statement';
});

async function onDeny(): Promise<void> {
  const id = dbMcpState.approval.pending?.requestId;
  if (id) await denyQuery(id);
}

async function onApprove(): Promise<void> {
  const id = dbMcpState.approval.pending?.requestId;
  if (id) await approveQuery(id);
}
</script>

<template>
  <DialogFrame
    v-if="dbMcpState.approval.pending"
    title="Approve this query?"
    :width="520"
    test-id="db-mcp-approval-dialog"
    @close="onDeny"
  >
    <p class="message">
      <strong>{{ dbMcpState.approval.pending.connectionName }}</strong>
      ({{ dbMcpState.approval.pending.kind }}) wants to run {{ classWord }} through the database
      MCP server.
    </p>
    <pre class="mono statement" data-testid="db-mcp-approval-statement">{{
      dbMcpState.approval.pending.statement
    }}</pre>
    <p v-if="dbMcpState.approval.pending.truncated" class="detail">
      Statement truncated for display — the full text still runs.
    </p>
    <p class="detail" data-testid="db-mcp-approval-expires">Expires in {{ remainingSeconds }}s</p>
    <p v-if="dbMcpState.approval.queued > 1" class="detail" data-testid="db-mcp-approval-queue-count">
      1 of {{ dbMcpState.approval.queued }} waiting
    </p>

    <template #footer>
      <span class="p-dialog-actions end footer-actions p-push">
        <AppButton ref="denyButton" kind="dialog" data-testid="db-mcp-approval-deny" @click="onDeny">
          Deny
        </AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="db-mcp-approval-approve"
          @click="onApprove"
        >
          Approve
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.message {
  margin: 0 0 var(--kira-s-2);
  padding: var(--kira-s-4) var(--kira-s-5) 0;
  white-space: pre-wrap;
}

.statement {
  margin: 0 var(--kira-s-5) var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--kira-bg-input);
  border: 1px solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
}

.detail {
  margin: 0;
  padding: 0 var(--kira-s-5) var(--kira-s-4);
  color: var(--kira-fg-subtle);
}

.footer-actions {
  gap: var(--kira-s-2);
}
</style>
