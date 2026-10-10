<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { computed } from 'vue';
import { formatSize } from '../lib/format';
import { useContainerSize } from '../queries';
import DetailSection from './DetailSection.vue';

const props = defineProps<{ id: string }>();

const { query, refresh } = useContainerSize(() => props.id);

const size = computed(() => query.data.value);
const measuring = computed(() => query.isFetching.value);
const takenAt = computed(() => (size.value ? new Date(size.value.takenAt) : new Date()));
const ago = useTimeAgo(takenAt);
</script>

<template>
  <DetailSection title="Size">
    <template #actions>
      <span class="ml-auto flex items-center gap-1 normal-case tracking-normal">
        <span
          v-if="size"
          :title="new Date(size.takenAt).toLocaleString()"
          data-testid="docker-size-taken"
        >{{ ago }}</span>
        <TooltipIconButton
          icon="refresh"
          label="Measure size"
          :disabled="measuring"
          data-testid="docker-size-refresh"
          @click="refresh"
        />
      </span>
    </template>

    <p v-if="query.error.value" class="mb-2 text-error" data-testid="docker-size-error">{{ query.error.value.message }}</p>

    <div v-if="measuring && !size" class="flex items-center gap-2 text-muted-foreground">
      <CodiconIcon name="loading" :size="12" class="codicon-modifier-spin" />Measuring…
    </div>
    <div v-else-if="!size" class="flex flex-wrap items-center gap-3 text-muted-foreground">
      <span>Not measured. Measuring walks the container's filesystem and can take a while.</span>
      <Button size="kira" variant="secondary" data-testid="docker-size-measure" @click="refresh">Measure</Button>
    </div>
    <dl v-else class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      <dt class="text-muted-foreground">Writable layer</dt>
      <dd class="font-data" data-testid="docker-size-rw">{{ formatSize(size.sizeRw) }}</dd>
      <dt class="text-muted-foreground">Total (with image)</dt>
      <dd class="font-data" data-testid="docker-size-rootfs">{{ formatSize(size.sizeRootFs) }}</dd>
    </dl>
  </DetailSection>
</template>
