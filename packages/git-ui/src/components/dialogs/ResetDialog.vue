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
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content. The title embeds `<code>` markup, so it goes through `KuiDialog`'s own
 * `#title` slot rather than its plain string `title` prop.
 */
import type { ResetMode } from '@kira/git-ipc';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ ops: OpsState }>();

const preflight = computed(() => props.ops.pendingReset.value);
const active = computed(() => preflight.value !== undefined);

const typedToken = ref('');
const stashFirst = ref(false);

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
  <KuiDialog v-if="preflight" :open="active" @close="cancel">
    <template #title>
      <template v-if="preflight.branch">Move <code>{{ preflight.branch }}</code> to</template>
      <template v-else>Move HEAD to</template>
      <code>{{ shortTarget }}</code>
      <template v-if="preflight.targetSubject">— {{ preflight.targetSubject }}</template>
    </template>

    <p v-if="!preflight.branch" class="kv:text-diff-deleted">
      You are not on a branch, so no branch is changed — this moves HEAD only.
    </p>

    <p v-if="preflight.leaving === 0 && preflight.gaining === 0">
      HEAD is already here — this resets your working state only.
    </p>
    <template v-else-if="preflight.gaining === 0">
      <p>
        {{ preflight.leaving }} commit{{ preflight.leaving === 1 ? '' : 's' }} will leave
        <template v-if="preflight.branch"><code>{{ preflight.branch }}</code></template>
        <template v-else>HEAD</template>:
      </p>
      <ul class="kv:max-h-40 kv:overflow-y-auto kv:my-1 kv:pl-3 kv:font-data kv:text-sm">
        <li v-for="c in preflight.leavingCommits" :key="c.sha">
          <code>{{ c.sha.slice(0, 7) }}</code> {{ c.subject }}
        </li>
      </ul>
      <p v-if="preflight.leavingTruncated" class="kv:text-muted-foreground kv:italic">and more…</p>
    </template>
    <p v-else>
      This moves to a different line of history: {{ preflight.leaving }} commit{{
        preflight.leaving === 1 ? '' : 's'
      }}
      leave, {{ preflight.gaining }} arrive.
    </p>

    <fieldset class="kv:my-2 kv:p-1 kv:border kv:border-panel-border kv:rounded-sm">
      <legend class="kv:px-0.5 kv:text-muted-foreground">Mode</legend>
      <label class="kv:flex kv:gap-1 kv:items-start kv:py-1">
        <input
          type="radio"
          name="kv-reset-mode"
          value="soft"
          :checked="mode === 'soft'"
          class="kv:mt-0.5"
          @change="selectMode('soft')"
        />
        <span>
          <strong>Soft</strong> — Branch pointer moves. Index and working tree untouched; the
          difference appears as staged changes. Nothing is lost.
        </span>
      </label>
      <label class="kv:flex kv:gap-1 kv:items-start kv:py-1">
        <input
          type="radio"
          name="kv-reset-mode"
          value="mixed"
          :checked="mode === 'mixed'"
          class="kv:mt-0.5"
          @change="selectMode('mixed')"
        />
        <span>
          <strong>Mixed</strong> — Branch pointer moves, index reset. Changes appear unstaged.
          Working tree files untouched. Nothing is lost.
        </span>
      </label>
      <label class="kv:flex kv:gap-1 kv:items-start kv:py-1">
        <input
          type="radio"
          name="kv-reset-mode"
          value="hard"
          :checked="mode === 'hard'"
          class="kv:mt-0.5"
          @change="selectMode('hard')"
        />
        <span>
          <strong>Hard</strong> — Branch pointer, index, <strong>and working tree</strong> reset.
          <strong>Uncommitted changes are destroyed and are not recoverable.</strong> Commits left
          behind remain in the reflog for about 90 days.
        </span>
      </label>
    </fieldset>

    <template v-if="mode === 'hard' && destroys.length > 0">
      <p class="kv:text-diff-deleted">This will permanently discard these uncommitted changes:</p>
      <ul class="kv:max-h-40 kv:overflow-y-auto kv:my-1 kv:pl-3 kv:font-data kv:text-sm">
        <li v-for="path in destroys" :key="path"><code>{{ path }}</code></li>
      </ul>
      <p class="kv:text-muted-foreground kv:italic">
        Untracked and ignored files are <strong>not</strong> affected.
      </p>

      <label v-if="canStashFirst" class="kv:block kv:my-1">
        <input type="checkbox" v-model="stashFirst" />
        Stash these changes first instead of discarding them
      </label>

      <template v-if="!stashFirst">
        <label class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
          Type <code>{{ shortTarget }}</code> to confirm
          <input
            v-model="typedToken"
            type="text"
            data-testid="reset-confirm-token"
            class="kv:px-1 kv:py-0.5 kv:bg-panel kv:text-row-fg kv:border kv:border-panel-border kv:font-inherit"
          />
        </label>
      </template>
    </template>

    <template #actions>
      <KuiButton
        v-if="isHardDestructive && canStashFirst"
        variant="primary"
        :disabled="!canConfirm"
        data-testid="reset-confirm"
        @click="confirm"
      >
        {{ stashFirst ? 'Stash and reset' : 'Reset (discard changes)' }}
      </KuiButton>
      <KuiButton
        v-else
        :variant="isHardDestructive ? 'danger' : 'primary'"
        :disabled="!canConfirm"
        data-testid="reset-confirm"
        @click="confirm"
      >
        Reset
      </KuiButton>
      <KuiButton @click="cancel">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>
