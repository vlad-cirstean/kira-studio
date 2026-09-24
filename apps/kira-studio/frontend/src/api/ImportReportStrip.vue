<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import { useCollectionsStore } from './state/collections';

const collectionsStore = useCollectionsStore();

// P4 D12: the import report is part of the feature, not decoration. Every warning kind is a case
// where the app quietly does something other than what the file said — a script that is kept but
// never run, an auth block whose values are dropped and never applied, a GraphQL body imported as
// JSON, a file referenced by a name from another machine — and the alternative to saying so here
// is letting the user find out from a 401 or an E_BAD_REQUEST minutes later.
//
// A pre-import preview dialog was considered and declined: it is a second UI for an operation that
// is almost never wrong, and the report after the fact carries the same information at a tenth of
// the cost. Import is not undoable in P4; deleting the collection is the undo, one context-menu
// item away.
//
// P104 §9: Alert with the `warn`/`note` tone variants, dynamic per warning count — the same tone
// vocabulary RawExchangePane.vue's own dynamic-tone strip uses.
const report = computed(() => collectionsStore.report);

const tone = computed(() => ((report.value?.warnings.length ?? 0) > 0 ? 'warn' : 'note'));

const summary = computed(() => {
  const r = report.value;
  if (!r) return '';
  return `Imported ${r.name} — ${plural(r.requests, 'request')}, ${plural(r.folders, 'folder')}.`;
});

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
</script>

<template>
  <Alert v-if="report" :variant="tone" data-testid="import-report">
    <AlertDescription class="flex items-start gap-1.5">
      <div class="report">
        <div data-testid="import-report-summary">{{ summary }}</div>
        <ul v-if="report.warnings.length > 0" class="warnings">
          <li v-for="warning in report.warnings" :key="warning.kind" :data-kind="warning.kind">
            {{ warning.detail }}
          </li>
        </ul>
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            class="ml-auto shrink-0"
            aria-label="Dismiss"
            data-testid="import-report-dismiss"
            @click="collectionsStore.dismissReport"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Dismiss</TooltipContent>
      </Tooltip>
    </AlertDescription>
  </Alert>
  <!-- P5 D16: the export path's own strip, independent of the import one above (a session can
       export without ever having imported). -->
  <Alert v-if="collectionsStore.exportWarning" variant="warn" data-testid="export-warning">
    <AlertDescription class="flex items-start gap-1.5">
      <div class="report">{{ collectionsStore.exportWarning }}</div>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            class="ml-auto shrink-0"
            aria-label="Dismiss"
            data-testid="export-warning-dismiss"
            @click="collectionsStore.dismissExportWarning"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Dismiss</TooltipContent>
      </Tooltip>
    </AlertDescription>
  </Alert>
  <!-- P108 F10: every tree mutation (create/rename/delete/duplicate/save/import/export) used to
       let its own failure throw uncaught from a fire-and-forget `void` call — nothing told the
       user why a row didn't change. `variant="destructive"` mirrors the existing pattern
       VariableSetView.vue/BulkVariablesEditor.vue already use for their own store-level errors. -->
  <Alert v-if="collectionsStore.error" variant="destructive" data-testid="collections-error">
    <AlertDescription class="flex items-start gap-1.5">
      <div class="report">{{ collectionsStore.error }}</div>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            class="ml-auto shrink-0"
            aria-label="Dismiss"
            data-testid="collections-error-dismiss"
            @click="collectionsStore.dismissError"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Dismiss</TooltipContent>
      </Tooltip>
    </AlertDescription>
  </Alert>
  <!-- P112 §4.3: a failed tree List used to reject into a void'd promise with nothing shown — this
       is the read side's own strip, alongside the mutation-failure one above. No dismiss: it
       clears itself once the query's own retry/next refetch succeeds. -->
  <Alert
    v-if="collectionsStore.treeLoadError"
    variant="destructive"
    data-testid="collections-tree-load-error"
  >
    <AlertDescription>{{ collectionsStore.treeLoadError }}</AlertDescription>
  </Alert>
</template>

<style scoped>
@reference "@theme/base.css";

.report {
  @apply flex min-w-0 flex-col gap-0.5;
}

.warnings {
  @apply m-0 flex flex-col gap-0.5 pl-2;
}
</style>
