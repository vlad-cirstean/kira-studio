<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useDbMcpStore } from '../state/dbmcp';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';

const dbMcpStore = useDbMcpStore();

// M2 §5.4/§7.4: a separate, always-mounted dialog at App.vue's root — GitPairingDialog.vue's own
// precedent applied to run_query's prompt-mode gate. An AI client is blocked while the human
// decides, the same semantics pairing's own trust prompt has, so this reuses that answer rather
// than a dock or a notification queue. Renders nothing while dbMcpStore.approval.pending is null.

const denyButton = ref<{ $el: HTMLElement } | null>(null);
let ticking = 0;
const now = ref(Date.now());

// Perf (finding #19, M6): this component is always-mounted at App.vue's own root (never
// unmounted per approval), so a plain onMounted only ever fires once, at app boot — a 1s
// setInterval started there ticked for the app's entire lifetime even though the dialog itself
// renders nothing while dbMcpStore.approval.pending is null (DialogFrame's own v-if below). Start
// and stop the interval instead as pending flips non-null/null.
//
// This also fixes denyButton's own focus call: run from onMounted, it only ever executed once, at
// that same app-boot mount — with DialogFrame's v-if false and nothing in the DOM yet, so
// denyButton.value was always null there and Deny was never actually focused. nextTick here runs
// it after each approval's own DOM update instead, so it sticks for real.
watch(
  () => dbMcpStore.approval.pending !== null,
  (isPending) => {
    if (isPending) {
      now.value = Date.now();
      ticking = window.setInterval(() => {
        now.value = Date.now();
      }, 1000);
      // Deny is the default focus, an approval dialog whose Enter key runs a write or DDL
      // statement is the wrong default.
      void nextTick(() => denyButton.value?.$el?.focus());
    } else if (ticking) {
      window.clearInterval(ticking);
      ticking = 0;
    }
  },
  { immediate: true },
);
onUnmounted(() => window.clearInterval(ticking));

const remainingSeconds = computed(() => {
  const expires = dbMcpStore.approval.pending?.expiresAtMs;
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
  const cls = dbMcpStore.approval.pending?.class;
  return cls ? (CLASS_WORDS[cls] ?? 'a statement') : 'a statement';
});

// M3 §6.2/§6.3: the same dialog, one more reason to raise it — title and lede vary by reason,
// everything else (Deny focused on mount, Escape denies, the countdown, the queue count, the
// statement <pre>) stays exactly as M2 shipped it. A heavy query and a write are the same keyboard
// interaction.
const dialogTitle = computed(() =>
  dbMcpStore.approval.pending?.reason === 'heavy' ? 'Run this heavy query?' : 'Approve this query?',
);

const heavyLede = computed(() => {
  const plan = dbMcpStore.approval.pending?.plan;
  const pending = dbMcpStore.approval.pending;
  if (!pending || !plan || plan.estimatedRowsRead === null) return '';
  return `${pending.connectionName} (${pending.kind}) wants to run a query estimated to read ${plan.estimatedRowsRead.toLocaleString()} rows — over your threshold of ${plan.thresholdRows.toLocaleString()}.`;
});

async function onDeny(): Promise<void> {
  const id = dbMcpStore.approval.pending?.requestId;
  if (id) await dbMcpStore.denyQuery(id);
}

async function onApprove(): Promise<void> {
  const id = dbMcpStore.approval.pending?.requestId;
  if (id) await dbMcpStore.approveQuery(id);
}
</script>

<template>
  <DialogFrame
    v-if="dbMcpStore.approval.pending"
    :title="dialogTitle"
    :width="520"
    test-id="db-mcp-approval-dialog"
    @close="onDeny"
  >
    <p v-if="dbMcpStore.approval.pending.reason === 'heavy'" class="message">
      {{ heavyLede }}
    </p>
    <p v-else class="message">
      <strong>{{ dbMcpStore.approval.pending.connectionName }}</strong>
      ({{ dbMcpStore.approval.pending.kind }}) wants to run {{ classWord }} through the database
      MCP server.
    </p>
    <pre class="mono statement" data-testid="db-mcp-approval-statement">{{
      dbMcpStore.approval.pending.statement
    }}</pre>

    <div v-if="dbMcpStore.approval.pending.plan" class="plan-block" data-testid="db-mcp-approval-plan">
      <p class="detail" data-testid="db-mcp-approval-plan-rows">
        <template v-if="dbMcpStore.approval.pending.plan.estimatedRowsRead !== null">
          Estimated {{ dbMcpStore.approval.pending.plan.estimatedRowsRead.toLocaleString() }} rows
          read — threshold {{ dbMcpStore.approval.pending.plan.thresholdRows.toLocaleString() }}.
        </template>
        <template v-else> No row estimate available for this plan. </template>
      </p>
      <p
        v-for="(issue, i) in dbMcpStore.approval.pending.plan.issues"
        :key="i"
        class="detail plan-issue"
        data-testid="db-mcp-approval-plan-issue"
      >
        <strong>{{ issue.severity }}</strong> {{ issue.message }}
      </p>
      <p v-if="dbMcpStore.approval.pending.plan.issuesOmitted > 0" class="detail">
        +{{ dbMcpStore.approval.pending.plan.issuesOmitted }} more
      </p>
    </div>

    <p class="detail" data-testid="db-mcp-approval-expires">Expires in {{ remainingSeconds }}s</p>
    <p v-if="dbMcpStore.approval.queued > 1" class="detail" data-testid="db-mcp-approval-queue-count">
      1 of {{ dbMcpStore.approval.queued }} waiting
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

.plan-block {
  margin: 0 0 var(--kira-s-2);
}

.plan-issue {
  padding-top: 0;
}

.footer-actions {
  gap: var(--kira-s-2);
}
</style>
