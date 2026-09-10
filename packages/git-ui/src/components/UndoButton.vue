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
import { KuiButton } from '@kira/kira-ui';
import { composeUndoTooltip } from '../state/liveAnnouncements.ts';
import type { OpsState } from '../state/ops.ts';

const props = defineProps<{
  ops: OpsState;
  clipboardEnabled: boolean;
  copy: (text: string, whatCopied: string) => void;
}>();

async function undo(): Promise<void> {
  await props.ops.undo();
}
</script>

<template>
  <div v-if="ops.undoSlot.value" class="kv-undo">
    <KuiButton
      icon="codicon-discard"
      v-kui-tooltip="composeUndoTooltip(ops.undoSlot.value.label)"
      :disabled="ops.busy.value"
      @click="undo"
    >
      {{ ops.undoSlot.value.label }}
    </KuiButton>
    <!-- G34 D5: the plan's own icon-only/text split names this call site as icon-only (its `ghost`
         predates both real classes) — it is not: the slot holds real multi-character sha text, not
         an icon, so `variant="icon"`'s fixed square width would clip it. Dropped to the plain
         default, the same call the "Show more"/"Show less" toggle gets for the identical reason. -->
    <KuiButton
      v-if="clipboardEnabled"
      class="kv-undo-sha"
      v-kui-tooltip="`Copy recovery SHA ${ops.undoSlot.value.recoverySha}`"
      @click="copy(ops.undoSlot.value.recoverySha, 'recovery SHA')"
    >
      {{ ops.undoSlot.value.recoverySha.slice(0, 7) }}
    </KuiButton>
    <span v-else class="kv-undo-sha">{{ ops.undoSlot.value.recoverySha.slice(0, 7) }}</span>
  </div>
</template>

<style>
.kv-undo {
  display: flex;
  align-items: center;
  gap: var(--kv-s-1);
}

/* G34 D14: `.kv-undo-button` (this component's first KuiButton, the undo affordance itself) is
   gone — it re-declared `.kui-button`'s own box byte for byte; the default `KuiButton` is now
   exactly this shape. */
.kv-undo-sha {
  font-family: var(--kv-mono-font-family);
  font-size: 0.85em;
  color: var(--kv-description-fg);
  cursor: copy;
}
</style>
