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

// P110 B30: ColumnsSection.vue's own DEF_TD constant (see its comment) -- folded off
// primitives.css's old shared body-cell rule. No thead/border-r override here (see
// ColumnsSection.vue's own scoped-style comment on why).
const DEF_TD = 'px-1.5 py-1 align-middle text-fg';
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-validation">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">Validation</span>
      <Badge v-if="documentSchema?.validationLevel" variant="chip">
        {{ documentSchema.validationLevel }}
      </Badge>
      <Badge v-if="documentSchema?.validationAction" variant="chip">
        {{ documentSchema.validationAction }}
      </Badge>
    </header>

    <p v-if="!documentSchema?.validator" class="text-muted-foreground m-0">
      No validator is set for this collection.
    </p>

    <table v-else-if="fields" class="w-full border-collapse text-kira-md">
      <tbody>
        <tr v-for="f in fields" :key="f.name" class="border-b border-border hover:bg-hover" data-testid="definition-row">
          <td :class="DEF_TD" class="def-val-name font-data">{{ f.name }}</td>
          <td :class="DEF_TD" class="def-val-type font-data">{{ f.bsonType ?? '' }}</td>
          <td :class="DEF_TD" class="def-val-required">
            <Badge v-if="f.required">required</Badge>
          </td>
          <td :class="DEF_TD" class="def-val-desc">{{ f.description ?? '' }}</td>
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
