<script setup lang="ts">
import { computed } from 'vue';
import IconButton from '../theme/primitives/IconButton.vue';
import { collectionsState, dismissExportWarning, dismissReport } from './state/collections';

// P4 D12: the import report is part of the feature, not decoration. Every warning kind is a case
// where the app quietly does something other than what the file said — a script that is kept but
// never run, an auth block that is kept but never applied, a GraphQL body imported as JSON, a file
// referenced by a name from another machine — and the alternative to saying so here is letting the
// user find out from a 401 or an E_BAD_REQUEST minutes later.
//
// A pre-import preview dialog was considered and declined: it is a second UI for an operation that
// is almost never wrong, and the report after the fact carries the same information at a tenth of
// the cost. Import is not undoable in P4; deleting the collection is the undo, one context-menu
// item away.
//
// Built on `.p-strip` and its existing `warn`/`note` tones and `.strip-action` slot directly,
// rather than through MessageStrip: that primitive has no dismiss affordance and only two tones,
// and §3's rule is that this phase adds nothing to theme/primitives/. ProjectTree.vue's own
// search-incomplete note uses the same class the same way.
const report = computed(() => collectionsState.report);

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
  <div v-if="report" class="p-strip" :class="tone" data-testid="import-report">
    <div class="report">
      <div data-testid="import-report-summary">{{ summary }}</div>
      <ul v-if="report.warnings.length > 0" class="warnings">
        <li v-for="warning in report.warnings" :key="warning.kind" :data-kind="warning.kind">
          {{ warning.detail }}
        </li>
      </ul>
    </div>
    <span class="strip-action">
      <IconButton
        icon="close"
        aria-label="Dismiss"
        v-tooltip="'Dismiss'"
        data-testid="import-report-dismiss"
        @click="dismissReport"
      />
    </span>
  </div>
  <!-- P5 D16: the export path's own strip, independent of the import one above (a session can
       export without ever having imported). -->
  <div v-if="collectionsState.exportWarning" class="p-strip warn" data-testid="export-warning">
    <div class="report">{{ collectionsState.exportWarning }}</div>
    <span class="strip-action">
      <IconButton
        icon="close"
        aria-label="Dismiss"
        v-tooltip="'Dismiss'"
        data-testid="export-warning-dismiss"
        @click="dismissExportWarning"
      />
    </span>
  </div>
</template>

<style scoped>
.report {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  min-width: 0;
}

.warnings {
  margin: 0;
  padding-left: var(--kira-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
}
</style>
