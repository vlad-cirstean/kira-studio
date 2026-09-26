<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { usePendingDecision } from '@workbench/util/usePendingDecision';
import { computed } from 'vue';
import { useDbMcpStore } from '../state/dbmcp';

const dbMcpStore = useDbMcpStore();

// M2 §5.4/§7.4: a separate, always-mounted dialog at App.vue's root, gating run_query in
// prompt mode. An AI client is blocked while the human decides on the one pending approval the
// FIFO queue presents at a time, with a timeout — a dock or a notification queue would let more
// than one sit unresolved. Renders nothing while dbMcpStore.approval.pending is null.
//
// P108 Part 12 F2 fixed this to key on requestId, not a `pending !== null` boolean — a queue
// advance (A approved/denied while B is already queued) swaps pending from A straight to B with no
// null in between, and the old boolean source never re-fired for that swap. P113 F5 extracts that
// fix into usePendingDecision.
const { remainingSeconds } = usePendingDecision({
  pendingId: () => dbMcpStore.approval.pending?.requestId,
  expiresAtMs: () => dbMcpStore.approval.pending?.expiresAtMs,
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

// P108 Part 12 F2: takes the request id as an explicit argument, bound in the template from the
// currently-rendered request (below), rather than re-reading dbMcpStore.approval.pending fresh at
// click time — combined with the Dialog's own :key (below), a queue swap mid-click destroys and
// recreates the buttons, so a click that started on request A's button can no longer complete as a
// click on request B's.
async function onDeny(requestId: string): Promise<void> {
  await dbMcpStore.denyQuery(requestId);
}

async function onApprove(requestId: string): Promise<void> {
  await dbMcpStore.approveQuery(requestId);
}

// P110 B39: `.detail`'s own class string, used 5 times in the template below (the plan's own 4+
// threshold for de-duplication) -- a `const` here rather than a local child component, since every
// site is a plain `<p>` with no props or behaviour of its own.
const DETAIL_CLASS = 'm-0 px-3 pb-2 text-subtle';
</script>

<template>
  <Dialog
    v-if="dbMcpStore.approval.pending"
    :key="dbMcpStore.approval.pending.requestId"
    :open="true"
    @update:open="(v) => !v && onDeny(dbMcpStore.approval.pending!.requestId)"
  >
    <DialogContent
      :show-close-button="false"
      data-testid="db-mcp-approval-dialog"
      class="flex flex-col p-0 gap-0 w-130 max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            @click="onDeny(dbMcpStore.approval.pending!.requestId)"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="overflow-auto">
        <p v-if="dbMcpStore.approval.pending.reason === 'heavy'" class="whitespace-pre-wrap mb-1 pt-2 px-3">
          {{ heavyLede }}
        </p>
        <p v-else class="whitespace-pre-wrap mb-1 pt-2 px-3">
          <strong>{{ dbMcpStore.approval.pending.connectionName }}</strong>
          ({{ dbMcpStore.approval.pending.kind }}) wants to run {{ classWord }} through the database
          MCP server.
        </p>
        <pre
          class="font-data max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-kira-sm mx-3 mb-1 py-1 px-1.5 bg-field border border-border"
          data-testid="db-mcp-approval-statement"
        >{{
          dbMcpStore.approval.pending.statement
        }}</pre>

        <div v-if="dbMcpStore.approval.pending.plan" class="mb-1" data-testid="db-mcp-approval-plan">
          <p :class="DETAIL_CLASS" data-testid="db-mcp-approval-plan-rows">
            <template v-if="dbMcpStore.approval.pending.plan.estimatedRowsRead !== null">
              Estimated {{ dbMcpStore.approval.pending.plan.estimatedRowsRead.toLocaleString() }} rows
              read — threshold {{ dbMcpStore.approval.pending.plan.thresholdRows.toLocaleString() }}.
            </template>
            <template v-else> No row estimate available for this plan. </template>
          </p>
          <p
            v-for="(issue, i) in dbMcpStore.approval.pending.plan.issues"
            :key="i"
            :class="[DETAIL_CLASS, 'pt-0']"
            data-testid="db-mcp-approval-plan-issue"
          >
            <strong>{{ issue.severity }}</strong> {{ issue.message }}
          </p>
          <p v-if="dbMcpStore.approval.pending.plan.issuesOmitted > 0" :class="DETAIL_CLASS">
            +{{ dbMcpStore.approval.pending.plan.issuesOmitted }} more
          </p>
        </div>

        <p :class="DETAIL_CLASS" data-testid="db-mcp-approval-expires">Expires in {{ remainingSeconds }}s</p>
        <p v-if="dbMcpStore.approval.queued > 1" :class="DETAIL_CLASS" data-testid="db-mcp-approval-queue-count">
          1 of {{ dbMcpStore.approval.queued }} waiting
        </p>
      </div>

      <DialogFooter>
        <span class="flex items-center gap-1 ml-auto">
          <Button
            ref="denyButton"
            variant="dialog"
            size="kira-lg"
            data-testid="db-mcp-approval-deny"
            @click="onDeny(dbMcpStore.approval.pending!.requestId)"
          >
            Deny
          </Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="db-mcp-approval-approve"
            @click="onApprove(dbMcpStore.approval.pending!.requestId)"
          >
            Approve
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
