<script setup lang="ts">
/**
 * G26 D14/4.8: two modes, at most one active at a time (`props.target?.mode`), mirroring
 * `WorktreeDialog.vue`'s own "App.vue owns the state, this component owns nothing of its own"
 * shape:
 * - **setParent** — `op.run`'s `stackSet` kind directly: pick an existing local branch as the new
 *   parent (or "None" to remove `target.branch` from its stack, D2/D10). No preflight endpoint of
 *   its own (D10's cycle check runs host-side, at write time) — this dialog is the confirm step,
 *   the same posture `BranchDialog.vue`'s rename mode already takes.
 * - **restack** — `preflight.restack`'s own live plan/blockers (re-fetched on open), a live
 *   progress list driven by `StackState.progress` while `StackState.restacking` is true, and a
 *   Cancel button that calls `ops.cancelRestack()`. A paused (conflicted) restack is surfaced
 *   here in words (D8) — resolving it is G5's own `ConflictBanner.vue`, not a second UI here.
 *
 * P131 Part 1 §6.1/§6.2: the modal shell is shadcn's `Dialog`/`DialogContent` now, `title` feeds
 * `DialogTitle`'s default slot, and the parent picker is `NativeSelect`.
 */
import type { RestackPreflight } from '@kira/git-ipc';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { NativeSelect } from '@theme/components/ui/native-select';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import type { RefsState } from '../../state/refs.ts';
import type { StackState } from '../../state/stack.ts';

const props = defineProps<{
  stack: StackState;
  ops: OpsState;
  refs: RefsState;
  /** `App.vue` owns this — `undefined` means closed. Toggled by `StackList.vue`'s own row/header
   *  actions, the row menu's stack section, and the `restackStack` palette action. */
  target: { readonly mode: 'setParent' | 'restack'; readonly branch: string } | undefined;
}>();

const emit = defineEmits<(e: 'close') => void>();

const open = computed(() => props.target !== undefined);

// ---------------------------------------------------------------------------------------
// setParent
// ---------------------------------------------------------------------------------------

const selectedParent = ref('');
// P131 Part 1 §6.2: biome's noLabelWithoutControl can't see through NativeSelect's
// `inheritAttrs: false` to the native `<select>` it renders -- an explicit for/id pair keeps the
// same association, verifiably (same fix as ForcePushDialog.vue's/TagDialog.vue's Input labels).
const parentId = useId();

watch(
  () => props.target,
  (target) => {
    if (target === undefined || target.mode !== 'setParent') return;
    selectedParent.value = '';
  },
);

const parentCandidates = computed(() =>
  props.refs.branches.value
    .map((row) => row.shortName)
    .filter((name) => name !== props.target?.branch),
);

async function submitSetParent(): Promise<void> {
  const target = props.target;
  if (target === undefined) return;
  const result = await props.ops.runStackSet(target.branch, selectedParent.value || undefined);
  if (!result.ok) return;
  emit('close');
}

// ---------------------------------------------------------------------------------------
// restack
// ---------------------------------------------------------------------------------------

const preflight = ref<RestackPreflight | undefined>(undefined);
let previewToken = 0;

async function loadPreflight(branch: string): Promise<void> {
  const token = ++previewToken;
  const result = await props.stack.previewRestack(branch);
  if (token === previewToken) preflight.value = result;
}

watch(
  () => props.target,
  (target) => {
    if (target === undefined || target.mode !== 'restack') {
      preflight.value = undefined;
      return;
    }
    void loadPreflight(target.branch);
  },
  { immediate: true },
);

function blockerText(pf: RestackPreflight): string {
  const b = pf.blockers[0];
  if (!b) return '';
  switch (b.kind) {
    case 'inProgressOperation':
      return 'Another operation is already in progress.';
    case 'notStacked':
      return `${b.branch} is not part of a stack.`;
    case 'cycle':
      return `This stack has a cycle: ${b.branches.join(' → ')}.`;
    case 'parentMissing':
      return `${b.branch}'s recorded parent "${b.parent}" no longer exists.`;
    case 'checkedOutElsewhere':
      return `${b.branch} is checked out at ${b.worktreePath}.`;
    case 'dirtyWorktree':
      return 'Commit, stash, or discard your changes before restacking.';
  }
}

async function submitRestack(): Promise<void> {
  const target = props.target;
  if (target === undefined || props.stack.restacking.value) return;
  await props.ops.runRestack(target.branch);
  // A conflict/cancellation leaves real state to look at (G5's own ConflictBanner) — re-fetch the
  // preflight rather than closing, so the dialog's own plan reflects what is actually left.
  if (props.target !== undefined) await loadPreflight(target.branch);
}

function cancelRestack(): void {
  void props.ops.cancelRestack();
}

function closeDialog(): void {
  emit('close');
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && closeDialog()">
    <DialogContent
      :show-close-button="false"
      :aria-describedby="undefined"
      class="flex flex-col gap-0 p-3 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>
          {{
            target?.mode === 'setParent'
              ? `Set ${target.branch}'s stack parent`
              : `Restack ${target?.branch ?? ''}`
          }}
        </DialogTitle>
      </DialogHeader>
      <div class="min-h-0 overflow-y-auto">
        <template v-if="target?.mode === 'setParent'">
          <label :for="parentId" class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
            Parent branch
            <NativeSelect
              :id="parentId"
              v-model="selectedParent"
              variant="bordered"
              size="kira"
              class="w-full"
            >
              <option value="">None (remove from stack)</option>
              <option v-for="name in parentCandidates" :key="name" :value="name">{{ name }}</option>
            </NativeSelect>
          </label>
        </template>

        <template v-else-if="target?.mode === 'restack' && preflight">
          <p v-if="preflight.verdict === 'blocked'" class="kv:text-diff-deleted">
            {{ blockerText(preflight) }}
          </p>
          <p v-else-if="preflight.verdict === 'noop'">This stack is already up to date.</p>
          <template v-else>
            <p>The following branches will be restacked onto <code>{{ preflight.base }}</code>:</p>
            <ul class="kv:max-h-50 kv:overflow-y-auto kv:p-1 kv:bg-panel kv:border kv:border-panel-border kv:text-base">
              <li v-for="entry in preflight.plan" :key="entry.branch">
                <code>{{ entry.branch }}</code> onto <code>{{ entry.parent }}</code>
                ({{ entry.commits }} commit{{ entry.commits === 1 ? '' : 's' }},
                {{ entry.reason === 'stale' ? 'stale' : 'ancestor restacked' }},
                base: {{ entry.baseSource }})
              </li>
            </ul>
            <p v-if="preflight.needsForcePush.length > 0" class="kv:text-muted-foreground">
              These branches will need a force-push afterwards:
              {{ preflight.needsForcePush.join(', ') }}.
            </p>
          </template>

          <template v-if="stack.restacking.value">
            <p>Restacking…</p>
            <ul class="kv:max-h-50 kv:overflow-y-auto kv:p-1 kv:bg-panel kv:border kv:border-panel-border kv:text-base">
              <li v-for="(p, i) in stack.progress.value" :key="i">
                {{ p.branch }} ({{ p.index }}/{{ p.total }})
              </li>
            </ul>
          </template>
        </template>
      </div>

      <DialogFooter class="justify-end gap-1">
        <template v-if="target?.mode === 'setParent'">
          <Button variant="dialog-primary" size="kira-lg" @click="submitSetParent">Save</Button>
          <Button variant="dialog" size="kira-lg" @click="closeDialog">Cancel</Button>
        </template>
        <template v-else-if="target?.mode === 'restack'">
          <template v-if="stack.restacking.value">
            <Button variant="dialog" size="kira-lg" @click="cancelRestack">Cancel restack</Button>
          </template>
          <template v-else>
            <Button
              variant="dialog-primary"
              size="kira-lg"
              :disabled="!preflight || preflight.verdict === 'blocked' || preflight.verdict === 'noop'"
              @click="submitRestack"
            >
              Restack
            </Button>
            <Button variant="dialog" size="kira-lg" @click="closeDialog">Close</Button>
          </template>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
