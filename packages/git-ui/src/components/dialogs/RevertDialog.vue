<script setup lang="ts">
import { shortSha } from '@kira/git-core';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
/**
 * Confirm step. `OpsState.runRevert` awaits this dialog whenever
 * the preflight is not a clean, non-merge, single-sha revert (`verdict !== "clean"` or a mainline
 * is required) — see that method's own doc comment — so a plain revert of an ordinary commit
 * never opens it at all.
 *
 * The modal shell is shadcn's `Dialog`/`DialogContent` now — this file still
 * only supplies its own body/footer content.
 */
import { Card } from '@theme/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Field, FieldLabel } from '@theme/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import Identifier from '@workbench/components/Identifier.vue';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import PreflightPrediction from './PreflightPrediction.vue';

const props = defineProps<{ ops: OpsState }>();
const mainlineId = useId();

const preflight = computed(() => props.ops.pendingRevert.value);
const active = computed(() => preflight.value !== undefined);

const selectedMainline = ref<number | undefined>(undefined);
const noCommit = ref(false);

// A genuinely new revert request (a different `shas` set) resets the choice; a re-preflight for
// the *same* shas — `previewRevertMainline`'s own refresh, triggered by the watch just below —
// must not, or picking a mainline would immediately un-pick itself.
watch(
  () => preflight.value?.shas.join(','),
  () => {
    selectedMainline.value = undefined;
    noCommit.value = false;
  },
);

watch(selectedMainline, (mainline) => {
  if (mainline !== undefined) void props.ops.previewRevertMainline(mainline);
});

const needsMainline = computed(() => (preflight.value?.mainlineRequired.length ?? 0) > 0);
const canConfirm = computed(() => !needsMainline.value || selectedMainline.value !== undefined);
const isMultiSha = computed(() => (preflight.value?.shas.length ?? 0) > 1);
const commitCount = computed(() => Math.max(preflight.value?.shas.length ?? 1, 1));

function cancel(): void {
  props.ops.resolveRevertDialog(null);
}

function confirm(): void {
  if (!canConfirm.value) return;
  props.ops.resolveRevertDialog({ mainline: selectedMainline.value, noCommit: noCommit.value });
}
</script>

<template>
  <Dialog :open="active" @update:open="(v) => !v && cancel()">
    <DialogContent size="md" destructive>
      <DialogHeader>
        <DialogTitle>{{ t('git.dialog.revert.title', { count: commitCount }) }}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <DialogDescription>
          {{
            t(isMultiSha ? 'git.dialog.revert.multiple.description' : 'git.dialog.revert.description')
          }}
        </DialogDescription>

        <Alert v-if="preflight?.detachedHead" variant="warn">
          <AlertDescription>
            {{ t('git.dialog.revert.detachedHead.hint') }}
          </AlertDescription>
        </Alert>

        <template v-if="needsMainline">
          <p>{{ t('git.dialog.revert.mainline.body') }}</p>
          <RadioGroup v-model="selectedMainline">
            <Card v-for="entry in preflight?.mainlineRequired" :key="entry.sha">
              <p class="m-0 mb-0.5"><Identifier :value="entry.sha" :short="shortSha" /></p>
              <Field
                v-for="parent in entry.parents"
                :key="parent.parentNumber"
                orientation="horizontal"
                class="py-0.5"
              >
                <RadioGroupItem
                  :id="`${mainlineId}-${entry.sha}-${parent.parentNumber}`"
                  :value="parent.parentNumber"
                />
                <FieldLabel :for="`${mainlineId}-${entry.sha}-${parent.parentNumber}`">
                  <span>
                    <CatalogText
                      k="git.common.mergeParent.option"
                      :params="{ number: parent.parentNumber, subject: parent.subject }"
                    >
                      <template #sha><Identifier :value="parent.sha" :short="shortSha" /></template>
                    </CatalogText>
                  </span>
                </FieldLabel>
              </Field>
            </Card>
          </RadioGroup>
        </template>

        <template v-if="!needsMainline || selectedMainline !== undefined">
          <PreflightPrediction
            v-if="preflight"
            :prediction="preflight.prediction"
            v-model:no-commit="noCommit"
          />

          <Alert v-if="isMultiSha" variant="warn">
            <AlertDescription>
              {{ t('git.dialog.revert.multiple.hint', { count: commitCount }) }}
            </AlertDescription>
          </Alert>
        </template>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-dialog-dismiss @click="cancel">{{
          t('common.action.cancel.label')
        }}</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canConfirm" @click="confirm">
          {{ t('common.revert.label') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
