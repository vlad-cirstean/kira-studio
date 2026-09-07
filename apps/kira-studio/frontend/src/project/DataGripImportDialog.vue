<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import type { DataGripPreviewRow, DataGripReportRow } from '@shared/domain/datagrip';
import { computed } from 'vue';
import { connectionsState } from '../state/connections';
import {
  closeDataGripImportDialog,
  confirmDataGripImport,
  datagripImportState,
  looksAlreadyImported,
  toggleDataGripRow,
} from '../state/datagripImport';
import CodiconIcon from '../theme/CodiconIcon.vue';
import EngineIcon from '../theme/EngineIcon.vue';
import AppButton from '../theme/primitives/AppButton.vue';
import Checkbox from '../theme/primitives/Checkbox.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';

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

const rows = computed(() => datagripImportState.preview?.rows ?? []);
const checkedCount = computed(() => datagripImportState.selected.size);
const secretStatus = computed(() => connectionsState.secretStorage);
const report = computed(() => datagripImportState.report);
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
  // result on datagripImportState.report, which flips the template below into the results view —
  // the user closes explicitly once they have seen it.
  await confirmDataGripImport();
}
</script>

<template>
  <DialogFrame
    v-if="datagripImportState.open"
    title="Import from DataGrip"
    :width="720"
    :height="560"
    test-id="datagrip-import-dialog"
    close-test-id="datagrip-import-dialog-close"
    @close="closeDataGripImportDialog"
  >
    <template #header>
      <span class="icon-box muted"><CodiconIcon name="database" :size="13" /></span>
      <span>{{ report ? 'Import from DataGrip — results' : 'Import from DataGrip' }}</span>
    </template>

    <div v-if="!report" class="p-dialog-body">
      <MessageStrip
        v-if="secretStatus && !secretStatus.available"
        tone="warn"
        data-testid="datagrip-secrets-unavailable"
      >
        {{ secretStatus.reason ?? 'Passwords cannot be saved on this machine, so every connection will import without one.' }}
      </MessageStrip>
      <MessageStrip v-if="datagripImportState.error" tone="err" data-testid="datagrip-import-error">
        {{ datagripImportState.error }}
      </MessageStrip>

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
              :model-value="datagripImportState.selected.has(row.uuid)"
              @update:model-value="toggleDataGripRow(row.uuid)"
            />
          </span>
          <span v-if="row.importable" class="engine-mark" :style="{ color: `var(--kira-conn-${KIND_ACCENT[row.kind as ConnectionKind]})` }">
            <EngineIcon :kind="row.kind as ConnectionKind" :size="15" />
          </span>
          <span v-else class="engine-mark dim"><CodiconIcon name="circle-slash" :size="15" /></span>

          <span class="ds-name">{{ row.name }}</span>

          <template v-if="row.importable">
            <span class="ds-target dim">
              {{ row.host ? `${row.host}:${row.port}` : '' }}<span v-if="row.database">/{{ row.database }}</span>
            </span>
            <span v-if="row.username" class="ds-username dim">{{ row.username }}</span>
            <span
              v-if="looksAlreadyImported(row)"
              class="p-chip warn"
              data-testid="datagrip-row-duplicate"
              v-tooltip="'A connection with this name, host, port and database already exists.'"
            >
              looks like it's already imported
            </span>
            <span
              v-if="row.passwordOutlook"
              class="p-chip p-push"
              :class="OUTLOOK_TONE[row.passwordOutlook]"
              data-testid="datagrip-row-outlook"
            >
              {{ OUTLOOK_LABEL[row.passwordOutlook] }}
            </span>
          </template>
          <template v-else>
            <span class="ds-skip p-push" data-testid="datagrip-row-skip-reason">{{ skipLabel(row) }}</span>
          </template>

          <span v-if="row.warnings.length > 0" class="ds-warnings">
            <span
              v-for="w in row.warnings"
              :key="w"
              class="icon-box dim"
              v-tooltip="warningLabel(w)"
            >
              <CodiconIcon name="warning" :size="12" />
            </span>
          </span>
        </div>
        <span v-if="rows.length === 0" class="empty-note">No data sources found in this project.</span>
      </div>
    </div>

    <!-- Review finding: the report Import returns used to be discarded on close with no display
         at all — every per-row outcome (created, password imported, or the specific reason it
         wasn't) is now shown here instead of auto-closing. -->
    <div v-else class="p-dialog-body">
      <MessageStrip :tone="reportTone" data-testid="datagrip-report-summary">
        {{ reportSummary }}
      </MessageStrip>

      <div class="row-list" data-testid="datagrip-report-rows">
        <div
          v-for="row in report.rows"
          :key="row.uuid"
          class="ds-row"
          :data-testid="`datagrip-report-row-${row.uuid}`"
        >
          <span class="engine-mark" :style="{ color: row.created ? 'var(--kira-ok)' : 'var(--kira-error)' }">
            <CodiconIcon :name="row.created ? 'check' : 'error'" :size="15" />
          </span>
          <span class="ds-name">{{ row.name }}</span>
          <span
            class="p-chip p-push"
            :class="reportOutcome(row).tone"
            data-testid="datagrip-report-row-outcome"
          >
            {{ reportOutcome(row).label }}
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <template v-if="!report">
        <span class="help">{{ datagripImportState.projectPath }}</span>
        <span class="p-dialog-actions p-push">
          <AppButton kind="dialog" data-testid="datagrip-import-cancel" @click="closeDataGripImportDialog">
            Cancel
          </AppButton>
          <AppButton
            kind="dialog"
            variant="primary"
            data-testid="datagrip-import-confirm"
            :disabled="checkedCount === 0 || datagripImportState.busy"
            @click="onConfirm"
          >
            Import {{ checkedCount }} connection{{ checkedCount === 1 ? '' : 's' }}
          </AppButton>
        </span>
      </template>
      <template v-else>
        <span class="p-dialog-actions p-push">
          <AppButton
            kind="dialog"
            variant="primary"
            data-testid="datagrip-import-report-close"
            @click="closeDataGripImportDialog"
          >
            Close
          </AppButton>
        </span>
      </template>
    </template>
  </DialogFrame>
</template>

<style scoped>
.row-list {
  display: flex;
  flex-direction: column;
  padding: var(--kira-s-2) 0;
}

.ds-row {
  display: flex;
  align-items: center;
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
  width: 16px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}

.engine-mark {
  flex-shrink: 0;
  display: flex;
}

.ds-name {
  min-width: 0;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ds-target,
.ds-username {
  font-size: var(--kira-t-sm);
  white-space: nowrap;
}

.ds-skip {
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}

.ds-warnings {
  display: flex;
  gap: var(--kira-s-1);
  flex-shrink: 0;
}

.empty-note {
  padding: var(--kira-s-5);
  color: var(--kira-fg-muted);
  text-align: center;
}
</style>
