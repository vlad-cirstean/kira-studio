<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { useIntervalFn } from '@vueuse/core';
import { computed, nextTick, ref, watch } from 'vue';
import { useDbMcpStore } from '../state/dbmcp';

const dbMcpStore = useDbMcpStore();

// M2 §5.4/§7.4: a separate, always-mounted dialog at App.vue's root — GitPairingDialog.vue's own
// precedent applied to run_query's prompt-mode gate. An AI client is blocked while the human
// decides, the same semantics pairing's own trust prompt has, so this reuses that answer rather
// than a dock or a notification queue. Renders nothing while dbMcpStore.approval.pending is null.

const denyButton = ref<InstanceType<typeof Button> | null>(null);
const now = ref(Date.now());

// Perf (finding #19, M6): this component is always-mounted at App.vue's own root (never
// unmounted per approval), so a plain onMounted only ever fires once, at app boot — a 1s
// interval started there would tick for the app's entire lifetime even though the dialog itself
// renders nothing while dbMcpStore.approval.pending is null (DialogFrame's own v-if below).
// useIntervalFn's own pause()/resume() (immediate: false) is started/stopped instead as pending
// flips non-null/null.
const { pause: pauseTick, resume: resumeTick } = useIntervalFn(
  () => {
    now.value = Date.now();
  },
  1000,
  { immediate: false },
);

// This also fixes denyButton's own focus call: run from onMounted, it only ever executed once, at
// that same app-boot mount — with DialogFrame's v-if false and nothing in the DOM yet, so
// denyButton.value was always null there and Deny was never actually focused. nextTick here runs
// it after each approval's own DOM update instead, so it sticks for real.
//
// P108 Part 12 F2: watches requestId, not just pending-vs-not — a queue advance (A approved/denied
// while B is already queued) swaps pending from A straight to B with no null in between. The old
// boolean source never re-fired for that swap, so focus silently stayed on Approve for B (a second
// Enter or key repeat could then approve a request the user never reviewed).
watch(
  () => dbMcpStore.approval.pending?.requestId ?? null,
  (requestId) => {
    if (requestId) {
      now.value = Date.now();
      resumeTick();
      // Deny is the default focus, an approval dialog whose Enter key runs a write or DDL
      // statement is the wrong default.
      void nextTick(() => denyButton.value?.$el?.focus());
    } else {
      pauseTick();
    }
  },
  { immediate: true },
);

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
