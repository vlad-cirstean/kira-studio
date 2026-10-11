<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { type MessageKey, t } from '@theme/i18n';
import { formatCount } from '@workbench/behaviour/format';
import { usePendingDecision } from '@workbench/behaviour/pendingDecision';
import { computed } from 'vue';
import { useDbMcpStore } from '../state/dbmcp';

// P246: mounted by PromptHost for the routed `dbmcp` entry whose ref is the pending request.
const props = defineProps<{ entry: RoutedPrompt; more: number }>();
const dbMcpStore = useDbMcpStore();

// M2 §5.4/§7.4: a dialog gating run_query in prompt mode. An AI client is blocked while the human decides on the one pending approval the
// FIFO queue presents at a time, with a timeout — a dock or a notification queue would let more
// than one sit unresolved. Renders nothing unless the pending request is this entry's.
//
// P108 Part 12 F2 fixed this to key on requestId, not a `pending !== null` boolean — a queue
// advance (A approved/denied while B is already queued) swaps pending from A straight to B with no
// null in between, and the old boolean source never re-fired for that swap. P113 F5 extracts that
// fix into usePendingDecision.
const { remainingSeconds } = usePendingDecision({
  pendingId: () => dbMcpStore.approval.pending?.requestId,
  expiresAtMs: () => dbMcpStore.approval.pending?.expiresAtMs,
});

const CLASS_BODY_KEYS: Record<string, MessageKey> = {
  read: 'studio.dbMcp.approval.read.body',
  write: 'studio.dbMcp.approval.write.body',
  ddl: 'studio.dbMcp.approval.ddl.body',
  unknown: 'studio.dbMcp.approval.unknown.body',
};

const classBody = computed(() => {
  const pending = dbMcpStore.approval.pending;
  if (!pending) return '';
  const key = (pending.class && CLASS_BODY_KEYS[pending.class]) || 'studio.dbMcp.approval.other.body';
  return t(key, { connection: pending.connectionName, kind: pending.kind });
});

// M3 §6.2/§6.3: the same dialog, one more reason to raise it — title and lede vary by reason,
// everything else (Deny focused on mount, Escape denies, the countdown, the queue count, the
// statement <pre>) stays exactly as M2 shipped it. A heavy query and a write are the same keyboard
// interaction.
const dialogTitle = computed(() =>
  dbMcpStore.approval.pending?.reason === 'heavy'
    ? t('studio.dbMcp.heavyConfirm.title')
    : t('studio.dbMcp.approveConfirm.title'),
);

const heavyLede = computed(() => {
  const plan = dbMcpStore.approval.pending?.plan;
  const pending = dbMcpStore.approval.pending;
  if (!pending || !plan || plan.estimatedRowsRead === null) return '';
  return t('studio.dbMcp.approval.heavy.body', {
    connection: pending.connectionName,
    kind: pending.kind,
    count: plan.estimatedRowsRead,
    threshold: formatCount(plan.thresholdRows),
  });
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
const DETAIL_CLASS = 'm-0 text-subtle';
</script>

<template>
  <Dialog
    v-if="dbMcpStore.approval.pending?.requestId === props.entry.ref"
    :key="dbMcpStore.approval.pending.requestId"
    :open="true"
    @update:open="(v) => !v && onDeny(dbMcpStore.approval.pending!.requestId)"
  >
    <DialogContent size="lg" data-testid="db-mcp-approval-dialog">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
      </DialogHeader>

      <DialogBody>
        <p v-if="dbMcpStore.approval.pending.reason === 'heavy'" class="m-0 whitespace-pre-wrap">
          {{ heavyLede }}
        </p>
        <p v-else class="m-0 whitespace-pre-wrap">{{ classBody }}</p>
        <pre
          class="font-data max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-kira-sm m-0 py-1 px-1.5 bg-field border border-border"
          data-testid="db-mcp-approval-statement"
        >{{
          dbMcpStore.approval.pending.statement
        }}</pre>

        <div v-if="dbMcpStore.approval.pending.plan" class="flex flex-col gap-1" data-testid="db-mcp-approval-plan">
          <p :class="DETAIL_CLASS" data-testid="db-mcp-approval-plan-rows">
            <template v-if="dbMcpStore.approval.pending.plan.estimatedRowsRead !== null">
              {{
                t('studio.dbMcp.approval.estimate.body', {
                  count: dbMcpStore.approval.pending.plan.estimatedRowsRead,
                  threshold: formatCount(dbMcpStore.approval.pending.plan.thresholdRows),
                })
              }}
            </template>
            <template v-else>{{ t('studio.console.plan.noEstimate.body') }}</template>
          </p>
          <p
            v-for="(issue, i) in dbMcpStore.approval.pending.plan.issues"
            :key="i"
            :class="DETAIL_CLASS"
            data-testid="db-mcp-approval-plan-issue"
          >
            <strong>{{ issue.severity }}</strong> {{ issue.message }}
          </p>
          <p v-if="dbMcpStore.approval.pending.plan.issuesOmitted > 0" :class="DETAIL_CLASS">
            {{ t('common.more.label', { count: dbMcpStore.approval.pending.plan.issuesOmitted }) }}
          </p>
        </div>

        <p :class="DETAIL_CLASS" data-testid="db-mcp-approval-expires">{{ t('common.expiresIn.status', { seconds: remainingSeconds }) }}</p>
        <p v-if="more > 0" :class="DETAIL_CLASS" data-testid="db-mcp-approval-queue-count">
          {{ t('common.moreWaiting.status', { count: more }) }}
        </p>
      </DialogBody>

      <DialogFooter>
        <Button
          ref="denyButton"
          variant="dialog"
          size="kira-lg"
          data-testid="db-mcp-approval-deny"
          @click="onDeny(dbMcpStore.approval.pending!.requestId)"
        >
          {{ t('common.action.deny.label') }}
        </Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          data-testid="db-mcp-approval-approve"
          @click="onApprove(dbMcpStore.approval.pending!.requestId)"
        >
          {{ t('common.action.approve.label') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
