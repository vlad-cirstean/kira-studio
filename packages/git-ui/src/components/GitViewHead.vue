<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { colorMarkClass } from '@theme/connColor';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed } from 'vue';

export interface RepoHead {
  readonly name: string;
  readonly dir?: string;
  readonly color?: string;
}

// Studio's view head (`DataView`, `KeyValuePane`): colour dot, icon, name with dim path prefix,
// badges, then the colour band.
const props = defineProps<{
  repo: RepoHead;
  headLabel?: string;
  ahead?: number;
  behind?: number;
  operation?: string;
}>();

const hasColor = computed(() => props.repo.color !== undefined && props.repo.color !== 'none');
const sync = computed(() => {
  const parts: string[] = [];
  if (props.ahead) parts.push(`↑${props.ahead}`);
  if (props.behind) parts.push(`↓${props.behind}`);
  return parts.join(' ');
});
</script>

<template>
  <ViewToolbar data-testid="git-view-head">
    <span v-if="hasColor" :class="colorMarkClass('dot', repo.color)" />
    <span class="size-4 flex items-center justify-center shrink-0 text-muted-foreground">
      <CodiconIcon name="source-control" :size="13" />
    </span>
    <span class="text-kira-md text-fg truncate" data-testid="git-view-head-name"
      ><span v-if="repo.dir" class="text-subtle">{{ repo.dir }}</span
      >{{ repo.name }}</span
    >
    <Badge v-if="headLabel" data-testid="git-view-head-branch">{{ headLabel }}</Badge>
    <Badge v-if="sync" data-testid="git-view-head-sync">{{ sync }}</Badge>
    <Badge v-if="operation" variant="warn" class="ml-auto" data-testid="git-view-head-operation">{{ operation }}</Badge>
  </ViewToolbar>
  <div :class="colorMarkClass('band', repo.color)" />
</template>
