<script setup lang="ts">
/**
 * `docs/plans/P10.md` W11: §7.7's confirm step — and, unlike every other dialog in this
 * directory, the confirm step for EVERY reset, not only a hazardous one (judgment call 18:
 * the row menu's "Reset to this commit…" is §7.7's one entry point, and choosing a mode IS the
 * confirmation here — there is no "clean, skip the dialog" fast path to mirror `CheckoutDialog`/
 * `RevertDialog`'s own).
 *
 * OQ11: switching the mode radio never re-requests `preflight.reset` — `OpsState.previewResetMode`
 * recomputes `destroys`/`requiresTypedConfirmation`/`routes`/`verdict` client-side via `core`'s own
 * `classifyReset`, holding `leaving`/`gaining`/`dirty` fixed (they do not depend on `mode` at all).
 *
 * P131 Part 1 §6.1/§6.2: the modal shell is shadcn's `Dialog`/`DialogContent` now, the mode
 * fieldset's radios are `RadioGroup`/`RadioGroupItem` (still an imperative `selectMode` call via
 * `@update:model-value`, not a plain `v-model`, per OQ11 above), the stash-first checkbox is
 * `Checkbox`+`Label`, and the confirm-token field is `Input`.
 */
import type { ResetMode } from '@kira/git-ipc';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ ops: OpsState }>();

const preflight = computed(() => props.ops.pendingReset.value);
const active = computed(() => preflight.value !== undefined);

const typedToken = ref('');
const stashFirst = ref(false);
const tokenId = useId();
const modeId = useId();
const stashFirstId = useId();

// A genuinely new target resets the typed confirmation and the stash-first choice; a mode-radio
// change (`previewResetMode`'s own re-classify, same target) must not, or picking a mode would
// immediately blank out what was already typed.
watch(
  () => preflight.value?.target,
  () => {
    typedToken.value = '';
    stashFirst.value = false;
  },
);

const mode = computed<ResetMode>(() => preflight.value?.mode ?? 'mixed');

function selectMode(next: ResetMode): void {
  props.ops.previewResetMode(next);
}

const shortTarget = computed(() => preflight.value?.target.slice(0, 7) ?? '');
const destroys = computed(() => preflight.value?.destroys ?? []);
const requiresToken = computed(() => preflight.value?.requiresTypedConfirmation ?? false);
const canStashFirst = computed(() => (preflight.value?.routes ?? []).includes('stashFirst'));
const tokenMatches = computed(
  () => !requiresToken.value || typedToken.value.trim() === shortTarget.value,
);
const canConfirm = computed(() => stashFirst.value || tokenMatches.value);
const isHardDestructive = computed(() => mode.value === 'hard' && destroys.value.length > 0);

function cancel(): void {
  props.ops.resolveResetDialog(null);
}

function confirm(): void {
  if (!canConfirm.value) return;
  props.ops.resolveResetDialog({
    mode: mode.value,
    stashFirst: stashFirst.value,
    token: requiresToken.value && !stashFirst.value ? typedToken.value.trim() : undefined,
  });
}
</script>

<template>
  <Dialog :open="active" @update:open="(v) => !v && cancel()">
    <DialogContent
      size="md"
    >
      <DialogHeader closable>
        <DialogTitle>
          <template v-if="preflight?.branch">Move <code class="font-data">{{ preflight.branch }}</code> to</template>
          <template v-else>Move HEAD to</template>
          <code class="font-data">{{ shortTarget }}</code>
          <template v-if="preflight?.targetSubject">— {{ preflight.targetSubject }}</template>
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FieldDescription v-if="preflight && !preflight.branch">
          You are not on a branch, so no branch is changed — this moves HEAD only.
        </FieldDescription>

        <DialogDescription v-if="preflight?.leaving === 0 && preflight.gaining === 0">
          HEAD is already here — this resets your working state only.
        </DialogDescription>
        <template v-else-if="preflight?.gaining === 0">
          <DialogDescription>
            {{ preflight.leaving }} commit{{ preflight.leaving === 1 ? '' : 's' }} will leave
            <template v-if="preflight.branch"><code class="font-data">{{ preflight.branch }}</code></template>
            <template v-else>HEAD</template>:
          </DialogDescription>
          <ul class="max-h-40 overflow-y-auto pl-3 font-data text-kira-md">
            <li v-for="c in preflight.leavingCommits" :key="c.sha">
              <code class="font-data">{{ c.sha.slice(0, 7) }}</code> {{ c.subject }}
            </li>
          </ul>
          <p v-if="preflight.leavingTruncated" class="text-muted-foreground italic">and more…</p>
        </template>
        <DialogDescription v-else-if="preflight">
          This moves to a different line of history: {{ preflight.leaving }} commit{{
            preflight.leaving === 1 ? '' : 's'
          }}
          leave, {{ preflight.gaining }} arrive.
        </DialogDescription>

        <FieldSet>
          <FieldLegend>Mode</FieldLegend>
          <RadioGroup :model-value="mode" @update:model-value="(v) => selectMode(v as ResetMode)">
            <Field orientation="horizontal" class="items-start py-1">
              <RadioGroupItem :id="`${modeId}-soft`" value="soft" class="mt-0.5" />
              <FieldLabel :for="`${modeId}-soft`">
                <span>
                  <strong>Soft</strong> — Branch pointer moves. Index and working tree untouched; the
                  difference appears as staged changes. Nothing is lost.
                </span>
              </FieldLabel>
            </Field>
            <Field orientation="horizontal" class="items-start py-1">
              <RadioGroupItem :id="`${modeId}-mixed`" value="mixed" class="mt-0.5" />
              <FieldLabel :for="`${modeId}-mixed`">
                <span>
                  <strong>Mixed</strong> — Branch pointer moves, index reset. Changes appear unstaged.
                  Working tree files untouched. Nothing is lost.
                </span>
              </FieldLabel>
            </Field>
            <Field orientation="horizontal" class="items-start py-1">
              <RadioGroupItem :id="`${modeId}-hard`" value="hard" class="mt-0.5" />
              <FieldLabel :for="`${modeId}-hard`">
                <span>
                  <strong>Hard</strong> — Branch pointer, index, <strong>and working tree</strong> reset.
                  <strong>Uncommitted changes are destroyed and are not recoverable.</strong> Commits left
                  behind remain in the reflog for about 90 days.
                </span>
              </FieldLabel>
            </Field>
          </RadioGroup>
        </FieldSet>

        <template v-if="mode === 'hard' && destroys.length > 0">
          <Alert variant="warn">
            <AlertDescription>
              <p>This will permanently discard these uncommitted changes:</p>
              <ul class="max-h-40 overflow-y-auto pl-3 font-data text-kira-md">
                <li v-for="path in destroys" :key="path"><code class="font-data">{{ path }}</code></li>
              </ul>
            </AlertDescription>
          </Alert>
          <FieldDescription class="italic">
            Untracked and ignored files are <strong>not</strong> affected.
          </FieldDescription>

          <Field v-if="canStashFirst" orientation="horizontal">
            <Checkbox :id="stashFirstId" v-model="stashFirst" />
            <FieldLabel :for="stashFirstId">Stash these changes first instead of discarding them</FieldLabel>
          </Field>

          <Field v-if="!stashFirst">
            <FieldLabel :for="tokenId">
              <span>Type <code class="font-data">{{ shortTarget }}</code> to confirm</span>
            </FieldLabel>
            <Input
              :id="tokenId"
              v-model="typedToken"
              type="text"
              size="kira-lg"
              class="w-full"
              data-testid="reset-confirm-token"
            />
          </Field>
        </template>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
        <Button
          v-if="isHardDestructive && canStashFirst"
          variant="dialog-primary"
          size="kira-lg"
          :disabled="!canConfirm"
          data-testid="reset-confirm"
          @click="confirm"
        >
          {{ stashFirst ? 'Stash and reset' : 'Reset (discard changes)' }}
        </Button>
        <Button
          v-else
          :variant="isHardDestructive ? 'dialog-danger' : 'dialog-primary'"
          size="kira-lg"
          :disabled="!canConfirm"
          data-testid="reset-confirm"
          @click="confirm"
        >
          Reset
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
