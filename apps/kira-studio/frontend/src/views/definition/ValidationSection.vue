<script setup lang="ts">
import type { DocumentSchemaMeta } from '@shared/domain/definition';
import { Badge } from '@theme/components/ui/badge';
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
      <Badge v-if="documentSchema?.validationLevel" variant="chip">
        {{ documentSchema.validationLevel }}
      </Badge>
      <Badge v-if="documentSchema?.validationAction" variant="chip">
        {{ documentSchema.validationAction }}
      </Badge>
    </header>

    <p v-if="!documentSchema?.validator" class="def-empty">
      No validator is set for this collection.
    </p>

    <table v-else-if="fields" class="def-table">
      <tbody>
        <tr v-for="f in fields" :key="f.name" class="def-row">
          <td class="def-val-name font-data">{{ f.name }}</td>
          <td class="def-val-type font-data">{{ f.bsonType ?? '' }}</td>
          <td class="def-val-required">
            <Badge v-if="f.required">required</Badge>
          </td>
          <td class="def-val-desc">{{ f.description ?? '' }}</td>
        </tr>
      </tbody>
    </table>

    <pre v-else-if="showRaw" class="def-raw font-data">{{ documentSchema?.validator }}</pre>
  </section>
</template>

<style scoped>
@reference "@theme/base.css";

.def-val-desc {
  @apply text-muted-foreground;
}

.def-raw {
  @apply m-0 whitespace-pre-wrap rounded-kira-sm bg-field text-fg p-2;
}
</style>
