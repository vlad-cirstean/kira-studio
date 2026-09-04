<script setup lang="ts">
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { scanJson } from '../../beautify';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { patchHttpRequestTabState } from '../../state/tabs';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';

// P3 C10/D10/D11: query on top, variables below, a fixed 2:1 stack (not a persisted
// PanelSplitter ratio — D11 declines a tenth state field for a sub-pane most requests never
// open). The query pane gets D10's own hand-written GraphQL StreamLanguage; the variables pane is
// plain JSON (needs nothing new).
const props = defineProps<{ tab: HttpRequestTabRecord }>();

function onQueryChange(text: string): void {
  patchHttpRequestTabState(props.tab.id, { graphqlQuery: text });
}

function onVariablesChange(text: string): void {
  patchHttpRequestTabState(props.tab.id, { graphqlVariables: text });
}

// D6/C10: flagged in the builder rather than waiting for Go's own CodeBadRequest at send time —
// scanJson is right there, so an invalid-JSON variables pane is knowable while typing.
const variablesError = computed(() => {
  const text = props.tab.state.graphqlVariables.trim();
  if (text === '') return null;
  const scan = scanJson(text);
  return scan.ok ? null : `GraphQL variables must be valid JSON (invalid at offset ${scan.offset})`;
});
</script>

<template>
  <div class="graphql-body-pane">
    <div class="graphql-pane query-pane">
      <div class="p-xs muted graphql-label">Query</div>
      <CodeMirrorHost
        :doc="tab.state.graphqlQuery"
        language="graphql"
        :read-only="false"
        data-testid="http-graphql-query"
        @update:doc="onQueryChange"
      />
    </div>
    <div class="graphql-divider" />
    <div class="graphql-pane variables-pane">
      <div class="p-xs muted graphql-label">Variables</div>
      <CodeMirrorHost
        :doc="tab.state.graphqlVariables"
        language="json"
        :read-only="false"
        data-testid="http-graphql-variables"
        @update:doc="onVariablesChange"
      />
      <MessageStrip v-if="variablesError" tone="err" data-testid="http-graphql-variables-error">
        {{ variablesError }}
      </MessageStrip>
    </div>
  </div>
</template>

<style scoped>
.graphql-body-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.graphql-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.query-pane {
  flex: 2;
}

.variables-pane {
  flex: 1;
}

.graphql-divider {
  height: 1px;
  flex-shrink: 0;
  background: var(--kira-border);
}

.graphql-label {
  padding: var(--kira-s-1) var(--kira-s-3);
}
</style>
