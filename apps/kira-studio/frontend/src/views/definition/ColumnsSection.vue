<script setup lang="ts">
import type { ColumnMeta } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@theme/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { columnTypeIcon, columnTypeTextClass } from '../../theme/icons';
import { typeDescription } from '../shared/typeGlossary';
import { columnsSectionMenu } from './columnsMenu';

const contextMenuStore = useContextMenuStore();

const props = defineProps<{
  columns: ColumnMeta[];
  foreignKeyColumnNames: ReadonlySet<string>;
  connectionId: string;
  tablePath: string;
}>();
const emit = defineEmits<{ copyError: [message: string] }>();

function keyLabel(col: ColumnMeta): 'PK' | 'FK' | null {
  if (col.isPrimaryKey) return 'PK';
  if (props.foreignKeyColumnNames.has(col.name)) return 'FK';
  return null;
}

// D9: the tree's former column-row context menu (Copy name / Add to projection / Sort by),
// relocated here — the table path is `tablePath` directly, not derived from a tree row's path.
function onContextMenu(ev: MouseEvent, col: ColumnMeta): void {
  ev.preventDefault();
  contextMenuStore.openContextMenu(
    ev,
    columnsSectionMenu(props.connectionId, props.tablePath, col.name, (m) => emit('copyError', m)),
  );
}
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-columns">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">{{
        t('studio.common.columns.label')
      }}</span>
      <Badge>{{ columns.length }}</Badge>
    </header>
    <Table columns>
      <TableHeader>
        <TableRow class="hover:bg-transparent">
          <TableHead class="w-4"></TableHead>
          <TableHead class="def-col-name">{{ t('common.field.name.label') }}</TableHead>
          <TableHead class="w-6">{{ t('common.field.key.label') }}</TableHead>
          <TableHead>{{ t('common.field.type.label') }}</TableHead>
          <TableHead class="w-20">{{ t('studio.definition.nullable.label') }}</TableHead>
          <TableHead>{{ t('common.state.default.option') }}</TableHead>
          <TableHead class="max-w-60 overflow-hidden text-ellipsis">{{
            t('common.comment.label')
          }}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="col in columns"
          :key="col.name"
          data-testid="definition-row"
          @contextmenu="onContextMenu($event, col)"
        >
          <TableCell class="w-4 text-muted-foreground">
            <CodiconIcon
              :name="columnTypeIcon(col.dataType)"
              :size="13"
              :class="columnTypeTextClass(col.dataType)"
            />
          </TableCell>
          <TableCell class="def-col-name">{{ col.name }}</TableCell>
          <TableCell class="w-6">
            <span v-if="keyLabel(col) === 'PK'" class="text-warn text-kira-sm">{{
              t('studio.definition.primaryKey.label')
            }}</span>
            <span v-else-if="keyLabel(col) === 'FK'" class="text-info text-kira-sm">{{
              t('studio.definition.foreignKey.label')
            }}</span>
          </TableCell>
          <TableCell class="whitespace-nowrap font-data text-muted-foreground">
            <span :class="columnTypeTextClass(col.dataType)">{{ col.dataType }}</span>
            <Tooltip v-if="typeDescription(col.dataType)">
              <TooltipTrigger as-child>
                <span
                  class="align-middle cursor-help text-subtle ml-0.5"
                  :aria-label="typeDescription(col.dataType) ?? ''"
                >
                  <CodiconIcon name="info" :size="13" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ typeDescription(col.dataType) }}</TooltipContent>
            </Tooltip>
          </TableCell>
          <TableCell class="w-20 whitespace-nowrap font-data text-muted-foreground">{{
            col.nullable ? t('studio.common.nullValue.label') : t('studio.definition.notNull.label')
          }}</TableCell>
          <TableCell class="whitespace-nowrap font-data text-muted-foreground">{{
            col.defaultExpr ?? ''
          }}</TableCell>
          <TableCell
            class="max-w-60 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground"
            >{{
              col.comment ?? ''
            }}</TableCell
          >
        </TableRow>
      </TableBody>
    </Table>
  </section>
</template>
