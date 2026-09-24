<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import type { DataGripPreviewRow, DataGripReportRow } from '@shared/domain/datagrip';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import { useConnectionsStore } from '../state/connections';
import { looksAlreadyImported, useDatagripImportStore } from '../state/datagripImport';
import EngineIcon from '../theme/EngineIcon.vue';

// P25 D10: a real review step. Nothing is written until "Import N connections" is pressed —
// every row here is either checkable (it maps to a supported engine and has enough of a JDBC URL
// to build fields from) or greyed with the specific D11 reason it cannot be. The password itself
// is never fetched or shown here (D9/OQ-3): only an outlook badge, resolved from file reads,
// says what Import is expected to do.

const KIND_ACCENT: Record<ConnectionKind, string> = {
  postgres: 'cyan',
  mariadb: 'blue',
  mysql: 'teal',
  sqlite: 'violet',
  clickhouse: 'orange',
  mongodb: 'green',
  redis: 'red',
  kafka: 'amber',
  sqs: 'magenta',
  s3: 'olive',
};

const OUTLOOK_LABEL: Record<string, string> = {
  'will-attempt': 'password will be imported',
  'from-url': 'password came from the JDBC URL',
  'not-saved': 'DataGrip did not save a password',
  'store-unsupported': 'password store not supported here',
};
const OUTLOOK_TONE: Record<string, 'ok' | 'warn' | 'err'> = {
  'will-attempt': 'ok',
  'from-url': 'ok',
  'not-saved': 'warn',
  'store-unsupported': 'err',
};

const SKIP_LABEL: Record<string, (row: DataGripPreviewRow) => string> = {
  'unsupported-engine': (row) =>
    `DataGrip driver “${row.skipDetail ?? '?'}” — no adapter for this engine`,
  'unrepresentable-url': () => 'this connection cannot be represented as host/port/database fields',
  'sqlite-path-not-absolute': (row) =>
    `database path did not resolve to an absolute path (${row.skipDetail ?? ''})`,
  'no-jdbc-url': () => 'no usable JDBC URL for this data source',
};

// Every D11 reason code that can reach ReportRow.Error (either a resolveFields skip, quoted back
// with its own detail joined by ": " — internal/datagrip/apply.go's applyOne — or a bare
// password-only refusal code with no detail at all) gets the same plain-English label the preview
// step already gives it elsewhere in this file, so a row's report reads the same way its preview
// row did rather than surfacing a bare wire code.
const REPORT_REASON_LABEL: Record<string, string> = {
  'unsupported-engine': 'no adapter for this engine',
  'unrepresentable-url': 'cannot be represented as host/port/database fields',
  'sqlite-path-not-absolute': 'database path did not resolve to an absolute path',
  'no-jdbc-url': 'no usable JDBC URL for this data source',
  'password-not-saved': 'DataGrip did not save a password',
  'password-not-found': 'no password is stored for this data source',
  'credential-store-not-found': 'the credential store could not be found',
  'credential-store-unsupported': 'password store not supported here',
  'credential-store-locked': 'the credential store is locked',
  'secret-storage-unavailable': 'passwords cannot be saved on this machine',
};

const datagripImportStore = useDatagripImportStore();
const connectionsStore = useConnectionsStore();

const rows = computed(() => datagripImportStore.preview?.rows ?? []);
const checkedCount = computed(() => datagripImportStore.selected.size);
const secretStatus = computed(() => connectionsStore.secretStorage);
const report = computed(() => datagripImportStore.report);
const reportSummary = computed(() => {
  const r = report.value;
  if (!r) return '';
  const created = r.rows.filter((row) => row.created).length;
  const failed = r.rows.length - created;
  const passwords = r.rows.filter((row) => row.passwordImported).length;
  const parts = [
    `${created} of ${r.rows.length} connection${r.rows.length === 1 ? '' : 's'} created`,
  ];
  if (passwords > 0) parts.push(`${passwords} password${passwords === 1 ? '' : 's'} imported`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(' — ');
});
const reportTone = computed<'note' | 'warn'>(() =>
  (report.value?.rows.some((row) => !row.created) ?? false) ? 'warn' : 'note',
);

function skipLabel(row: DataGripPreviewRow): string {
  const fn = row.skipReason ? SKIP_LABEL[row.skipReason] : undefined;
  return fn ? fn(row) : (row.skipDetail ?? 'not importable');
}

function warningLabel(code: string): string {
  if (code === 'name-truncated') return 'name was over 120 characters and was shortened';
  if (code === 'ssh-tunnel-dropped')
    return 'this data source has an SSH tunnel, which is not imported';
  return code;
}

// row.error is either "<code>: <detail>" (a resolveFields skip, D11) or a bare code/message —
// only the leading segment is ever a known reason code, so an unmapped prefix (a Creator/Validate
// error such as "name must be 1-120 characters") falls back to the raw text verbatim.
function reportErrorLabel(row: DataGripReportRow): string {
  if (!row.error) return '';
  const sep = row.error.indexOf(': ');
  const code = sep === -1 ? row.error : row.error.slice(0, sep);
  const label = REPORT_REASON_LABEL[code];
  if (!label) return row.error;
  const detail = sep === -1 ? '' : row.error.slice(sep + 2);
  return detail ? `${label} (${detail})` : label;
}

function reportOutcome(row: DataGripReportRow): { label: string; tone: 'ok' | 'warn' | 'err' } {
  if (!row.created) return { label: `Not created — ${reportErrorLabel(row)}`, tone: 'err' };
  if (row.passwordImported) return { label: 'Created — password imported', tone: 'ok' };
  if (row.error) return { label: `Created — ${reportErrorLabel(row)}`, tone: 'warn' };
  return { label: 'Created', tone: 'ok' };
}

async function onConfirm(): Promise<void> {
  // Deliberately no auto-close here (review finding): confirmDataGripImport already stores its
  // result on the store's own `report`, which flips the template below into the results view —
  // the user closes explicitly once they have seen it.
  await datagripImportStore.confirmDataGripImport();
}
</script>

<template>
  <Dialog v-if="datagripImportStore.open" :open="true" @update:open="(v) => !v && datagripImportStore.closeDataGripImportDialog()">
    <DialogContent
      :show-close-button="false"
      data-testid="datagrip-import-dialog"
      class="flex flex-col p-0 gap-0 w-180 h-140"
    >
      <DialogHeader class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <span class="size-4 flex items-center justify-center shrink-0 text-muted-foreground"><CodiconIcon name="database" :size="13" /></span>
        <DialogTitle class="text-kira-lg font-normal">{{ report ? 'Import from DataGrip — results' : 'Import from DataGrip' }}</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="datagrip-import-dialog-close"
            @click="datagripImportStore.closeDataGripImportDialog"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex-1 min-h-0 overflow-auto">
    <div v-if="!report" class="p-dialog-body">
      <Alert
        v-if="secretStatus && !secretStatus.available"
        data-testid="datagrip-secrets-unavailable"
        variant="warn"
      >
        <AlertDescription>
          {{ secretStatus.reason ?? 'Passwords cannot be saved on this machine, so every connection will import without one.' }}
        </AlertDescription>
      </Alert>
      <Alert v-if="datagripImportStore.error" variant="destructive" data-testid="datagrip-import-error">
        <AlertDescription>{{ datagripImportStore.error }}</AlertDescription>
      </Alert>

      <div class="row-list" data-testid="datagrip-preview-rows">
        <div
          v-for="row in rows"
          :key="row.uuid"
          class="ds-row"
          :class="{ 'is-off': !row.importable }"
          :data-testid="`datagrip-row-${row.uuid}`"
          :data-importable="row.importable"
        >
          <span class="row-check">
            <Checkbox
              v-if="row.importable"
              :model-value="datagripImportStore.selected.has(row.uuid)"
              class="size-3.5"
              @update:model-value="datagripImportStore.toggleDataGripRow(row.uuid)"
            >
              <CodiconIcon name="check" :size="10" />
            </Checkbox>
          </span>
          <span v-if="row.importable" class="engine-mark" :style="{ color: `var(--kira-conn-${KIND_ACCENT[row.kind as ConnectionKind]})` }">
            <EngineIcon :kind="row.kind as ConnectionKind" :size="15" />
          </span>
          <span v-else class="engine-mark text-subtle"><CodiconIcon name="circle-slash" :size="15" /></span>

          <span class="ds-name">{{ row.name }}</span>

          <template v-if="row.importable">
            <span class="ds-target text-subtle">
              {{ row.host ? `${row.host}:${row.port}` : '' }}<span v-if="row.database">/{{ row.database }}</span>
            </span>
            <span v-if="row.username" class="ds-username text-subtle">{{ row.username }}</span>
            <Tooltip v-if="looksAlreadyImported(row)">
              <TooltipTrigger as-child>
                <Badge variant="warn" data-testid="datagrip-row-duplicate">
                  looks like it's already imported
                </Badge>
              </TooltipTrigger>
              <TooltipContent>A connection with this name, host, port and database already exists.</TooltipContent>
            </Tooltip>
            <Badge
              v-if="row.passwordOutlook"
              class="ml-auto"
              :variant="OUTLOOK_TONE[row.passwordOutlook]"
              data-testid="datagrip-row-outlook"
            >
              {{ OUTLOOK_LABEL[row.passwordOutlook] }}
            </Badge>
          </template>
          <template v-else>
            <span class="ds-skip ml-auto" data-testid="datagrip-row-skip-reason">{{ skipLabel(row) }}</span>
          </template>

          <span v-if="row.warnings.length > 0" class="ds-warnings">
            <Tooltip v-for="w in row.warnings" :key="w">
              <TooltipTrigger as-child>
                <span class="size-4 flex items-center justify-center shrink-0 text-subtle">
                  <CodiconIcon name="warning" :size="12" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ warningLabel(w) }}</TooltipContent>
            </Tooltip>
          </span>
        </div>
        <span v-if="rows.length === 0" class="empty-note">No data sources found in this project.</span>
      </div>
    </div>

    <!-- Review finding: the report Import returns used to be discarded on close with no display
         at all — every per-row outcome (created, password imported, or the specific reason it
         wasn't) is now shown here instead of auto-closing. -->
    <div v-else class="p-dialog-body">
      <Alert data-testid="datagrip-report-summary" :variant="reportTone">
        <AlertDescription>
          {{ reportSummary }}
        </AlertDescription>
      </Alert>

      <div class="row-list" data-testid="datagrip-report-rows">
        <div
          v-for="row in report.rows"
          :key="row.uuid"
          class="ds-row"
          :data-testid="`datagrip-report-row-${row.uuid}`"
        >
          <span class="engine-mark" :class="row.created ? 'text-ok' : 'text-error'">
            <CodiconIcon :name="row.created ? 'check' : 'error'" :size="15" />
          </span>
          <span class="ds-name">{{ row.name }}</span>
          <Badge
            class="ml-auto"
            :variant="reportOutcome(row).tone"
            data-testid="datagrip-report-row-outcome"
          >
            {{ reportOutcome(row).label }}
          </Badge>
        </div>
      </div>
    </div>
      </div>

      <DialogFooter class="border-t border-border">
        <template v-if="!report">
          <span class="help">{{ datagripImportStore.projectPath }}</span>
          <span class="flex items-center gap-1 ml-auto">
            <Button variant="dialog" size="kira-lg" data-testid="datagrip-import-cancel" @click="datagripImportStore.closeDataGripImportDialog">
              Cancel
            </Button>
            <Button
              variant="dialog-primary"
              size="kira-lg"
              data-testid="datagrip-import-confirm"
              :disabled="checkedCount === 0 || datagripImportStore.busy"
              @click="onConfirm"
            >
              Import {{ checkedCount }} connection{{ checkedCount === 1 ? '' : 's' }}
            </Button>
          </span>
        </template>
        <template v-else>
          <span class="flex items-center gap-1 ml-auto">
            <Button
              variant="dialog-primary"
              size="kira-lg"
              data-testid="datagrip-import-report-close"
              @click="datagripImportStore.closeDataGripImportDialog"
            >
              Close
            </Button>
          </span>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
@reference "@theme/base.css";

.row-list {
  @apply flex flex-col;
  padding: var(--kira-s-2) 0;
}

.ds-row {
  @apply flex items-center;
  gap: var(--kira-s-3);
  height: var(--kira-h-md);
  padding: 0 var(--kira-s-5);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: var(--kira-t-md);
}

.ds-row.is-off {
  color: var(--kira-fg-muted);
}

.row-check {
  @apply w-4 shrink-0 flex justify-center;
}

.engine-mark {
  @apply shrink-0 flex;
}

.ds-name {
  @apply min-w-0 max-w-56 overflow-hidden text-ellipsis whitespace-nowrap;
}

.ds-target,
.ds-username {
  @apply whitespace-nowrap;
  font-size: var(--kira-t-sm);
}

.ds-skip {
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}

.ds-warnings {
  @apply flex shrink-0;
  gap: var(--kira-s-1);
}

.empty-note {
  @apply text-center;
  padding: var(--kira-s-5);
  color: var(--kira-fg-muted);
}
</style>
