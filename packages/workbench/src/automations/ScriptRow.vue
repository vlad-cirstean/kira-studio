<script setup lang="ts">
import type { ScriptRun } from '@shared/domain/scriptRuns';
import type { CustomScript } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import Spinner from '@theme/components/Spinner.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { colorMarkClass } from '@theme/connColor';
import { cn } from '@theme/lib/utils';
import RunElapsed from './runs/RunElapsed.vue';
import ScriptScheduleLine from './schedule/ScriptScheduleLine.vue';
import SmartBadge from './smart/SmartBadge.vue';

defineOptions({ inheritAttrs: false });
defineProps<{ script: CustomScript; depth: 0 | 1; liveRun?: ScriptRun }>();
const emit = defineEmits<{ run: []; menu: [event: MouseEvent] }>();

function firstLine(command: string): string {
  const [first = '', ...rest] = command.split('\n');
  return rest.length > 0 ? `${first}…` : first;
}
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        v-bind="$attrs"
        :class="cn(rowVariants({ layout: 'double' }), 'w-full items-center text-left')"
        :style="rowIndent(depth)"
        :data-testid="`script-${script.id}`"
        @click="emit('run')"
        @contextmenu.prevent.stop="emit('menu', $event)"
      >
        <span
          :class="colorMarkClass('rail', script.color)"
          data-testid="script-rail"
          aria-hidden="true"
        />
        <div class="flex-1 min-w-0 flex flex-col">
          <span class="flex min-w-0 items-center gap-1">
            <SmartBadge v-if="script.kind === 'smart'" />
            <span class="truncate">{{ script.name }}</span>
          </span>
          <span class="truncate text-muted-foreground text-kira-sm">{{
            firstLine(script.command)
          }}</span>
          <ScriptScheduleLine v-if="script.schedule" :script="script" />
        </div>
        <RunElapsed
          v-if="liveRun"
          :run="liveRun"
          class="shrink-0 text-kira-sm text-muted-foreground"
        />
        <span class="flex w-5 shrink-0 items-center justify-center" data-testid="script-run-slot">
          <Spinner v-if="liveRun" label="" data-testid="script-running" />
          <CodiconIcon v-else name="play" :size="13" class="text-muted-foreground" />
        </span>
      </button>
    </TooltipTrigger>
    <TooltipContent class="whitespace-pre-wrap">{{ script.command }}</TooltipContent>
  </Tooltip>
</template>
