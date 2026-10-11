<script setup lang="ts">
import type { DocumentSchemaMeta } from '@shared/domain/definition';
import { Badge } from '@theme/components/ui/badge';
import { Table, TableBody, TableCell, TableRow } from '@theme/components/ui/table';
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
  <section class="flex flex-col gap-1.5" data-testid="definition-validation">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">Validation</span>
      <Badge v-if="documentSchema?.validationLevel" variant="chip" data>
        {{ documentSchema.validationLevel }}
      </Badge>
      <Badge v-if="documentSchema?.validationAction" variant="chip" data>
        {{ documentSchema.validationAction }}
      </Badge>
    </header>

    <p v-if="!documentSchema?.validator" class="text-muted-foreground m-0">
      No validator is set for this collection.
    </p>

    <Table v-else-if="fields">
      <TableBody>
        <TableRow v-for="f in fields" :key="f.name" data-testid="definition-row">
          <TableCell class="def-val-name font-data">{{ f.name }}</TableCell>
          <TableCell class="def-val-type font-data">{{ f.bsonType ?? '' }}</TableCell>
          <TableCell class="def-val-required">
            <Badge v-if="f.required">required</Badge>
          </TableCell>
          <TableCell class="text-muted-foreground">{{ f.description ?? '' }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <pre v-else-if="showRaw" class="m-0 whitespace-pre-wrap rounded-kira-sm bg-field text-fg p-2 font-data">{{ documentSchema?.validator }}</pre>
  </section>
</template>
