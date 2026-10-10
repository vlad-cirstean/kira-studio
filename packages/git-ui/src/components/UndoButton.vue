<script setup lang="ts">
/**
 * `docs/plans/P6.md` W17: §7.12's single-level "Undo last operation". Present only while
 * `ops.undoSlot` holds a record (`OpsState.refreshUndo`/`#applyResult` are the only things that
 * ever set it, and both clear it — to `null` — the moment a non-undoable op runs, which is what
 * makes "no non-undoable operation ever renders this" true without this file re-deriving
 * `UNDO_POLICY` itself). Recovery sha is real, copyable text (`clipboardActions.ts`, matching
 * every other sha in this app), never only inside a tooltip.
 *
 * `docs/plans/P10.md` W14: the tooltip text itself moved into `composeUndoTooltip` (mode-matched
 * for a reset, per hard part 1's own table) rather than staying the single fixed string this file
 * used to render inline.
 */
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { composeUndoTooltip } from '../state/liveAnnouncements.ts';
import type { OpsState } from '../state/ops.ts';

const props = defineProps<{
  ops: OpsState;
  copy: (text: string, whatCopied: string) => void;
}>();

async function undo(): Promise<void> {
  await props.ops.undo();
}
</script>

<template>
  <div v-if="ops.undoSlot.value" class="flex items-center gap-0.5">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="toolbar" size="kira" :disabled="ops.busy.value" @click="undo">
          <CodiconIcon name="discard" :size="13" />
          {{ ops.undoSlot.value.label }}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ composeUndoTooltip(ops.undoSlot.value.label) }}</TooltipContent>
    </Tooltip>
    <!-- G34 D5: the plan's own icon-only/text split names this call site as icon-only (its `ghost`
         predates both real classes) — it is not: the slot holds real multi-character sha text, not
         an icon, so an icon-only button's fixed square width would clip it. Dropped to the plain
         default, the same call the "Show more"/"Show less" toggle gets for the identical reason. -->
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="toolbar"
          size="kira"
          class="font-data text-kira-sm text-muted-foreground cursor-copy"
          @click="copy(ops.undoSlot.value.recoverySha, 'recovery SHA')"
        >
          {{ ops.undoSlot.value.recoverySha.slice(0, 7) }}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy recovery SHA {{ ops.undoSlot.value.recoverySha }}</TooltipContent>
    </Tooltip>
  </div>
</template>
