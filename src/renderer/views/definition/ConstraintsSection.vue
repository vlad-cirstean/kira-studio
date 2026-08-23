<script setup lang="ts">
import type { ConstraintRow } from './structure';

defineProps<{
  constraints: ConstraintRow[];
}>();

const TYPE_LABEL: Record<ConstraintRow['type'], string> = {
  primaryKey: 'primary key',
  unique: 'unique',
  foreignKey: 'foreign key',
  check: 'check',
  exclusion: 'exclusion',
  referencedBy: 'referenced by',
};
</script>

<template>
  <section class="def-section" data-testid="definition-constraints">
    <header class="def-section-head">
      <span class="def-section-title">Constraints</span>
      <span class="p-badge">{{ constraints.length }}</span>
    </header>
    <table class="def-table">
      <tbody>
        <tr v-for="c in constraints" :key="`${c.type}:${c.name}`" class="def-row">
          <td class="def-con-name">{{ c.name }}</td>
          <td class="def-con-type">
            <span class="p-badge">{{ TYPE_LABEL[c.type] }}</span>
          </td>
          <td class="def-con-detail mono">{{ c.detail }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.def-section {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
}

.def-section-head {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
}

.def-section-title {
  font-weight: 600;
  color: var(--kira-fg);
}

.def-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--kira-t-md);
}

.def-row {
  border-bottom: 1px solid var(--kira-border);
}
.def-row:hover {
  background: var(--kira-hover);
}

.def-table td {
  padding: var(--kira-s-2) var(--kira-s-3);
  vertical-align: middle;
  color: var(--kira-fg);
}

.def-con-detail {
  color: var(--kira-fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: var(--kira-font-family);
}
</style>
