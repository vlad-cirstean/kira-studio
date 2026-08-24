<script setup lang="ts">
import type { DocumentSchemaMeta } from '@shared/domain/definition';
import { computed } from 'vue';
import { jsonSchemaFields } from './structure';

const props = defineProps<{
  documentSchema: DocumentSchemaMeta | null;
}>();

const fields = computed(() =>
  props.documentSchema?.isJsonSchema && props.documentSchema.validator
    ? jsonSchemaFields(props.documentSchema.validator)
    : null,
);

// Raw JSON fallback: no validator, a validator that isn't a $jsonSchema, or a $jsonSchema this
// parser could not turn into field rows (P19 D12) — never an empty table pretending to be one.
const showRaw = computed(() => props.documentSchema?.validator != null && fields.value === null);
</script>

<template>
  <section class="def-section" data-testid="definition-validation">
    <header class="def-section-head">
      <span class="def-section-title">Validation</span>
      <span v-if="documentSchema?.validationLevel" class="p-chip">
        {{ documentSchema.validationLevel }}
      </span>
      <span v-if="documentSchema?.validationAction" class="p-chip">
        {{ documentSchema.validationAction }}
      </span>
    </header>

    <p v-if="!documentSchema?.validator" class="def-empty">
      No validator is set for this collection.
    </p>

    <table v-else-if="fields" class="def-table">
      <tbody>
        <tr v-for="f in fields" :key="f.name" class="def-row">
          <td class="def-val-name mono">{{ f.name }}</td>
          <td class="def-val-type mono">{{ f.bsonType ?? '' }}</td>
          <td class="def-val-required">
            <span v-if="f.required" class="p-badge">required</span>
          </td>
          <td class="def-val-desc">{{ f.description ?? '' }}</td>
        </tr>
      </tbody>
    </table>

    <pre v-else-if="showRaw" class="def-raw mono">{{ documentSchema?.validator }}</pre>
  </section>
</template>

<style scoped>
.def-val-desc {
  color: var(--kira-fg-muted);
}

.def-raw {
  margin: 0;
  padding: var(--kira-s-4);
  background: var(--kira-bg-input);
  border-radius: var(--kira-radius-sm);
  white-space: pre-wrap;
  color: var(--kira-fg);
}
</style>
