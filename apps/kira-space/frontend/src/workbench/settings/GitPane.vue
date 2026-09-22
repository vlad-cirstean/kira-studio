<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, ref, watch } from 'vue';
import {
  defaultSettings,
  FETCH_AUTO_INTERVAL_MINUTES_RANGE,
  FONT_SIZE_RANGE,
} from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Git'"` branch — server-owned remote-op settings, moved to this
// app wholesale from Kira Studio (P100 Part 2) along with the repo workspace they configure.
const props = defineProps<SettingsPaneProps>();

function onFetchAutoIntervalInput(e: Event): void {
  props.draft.git.fetchAutoIntervalMinutes = Number((e.target as HTMLInputElement).value);
}

// P92 item 9: an emptied field writes 0 (the "follow appearance.fontSize" sentinel), same rule
// applyAppearance() reads — not NaN, which a plain Number(...) would let through unnoticed for a
// genuinely blank input.
function onGraphFontSizeInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  props.draft.git.graphFontSize = raw === '' ? 0 : Number(raw);
}

// G7 D17: `*` matches any run of characters except `/` — the same rule server-side git preflight
// enforces; this dialog only edits the pattern list, never evaluates it. A plain ref, not a
// computed bound straight to draft.git.protectedBranches: parsing on every keystroke and feeding
// the result back into the textarea's own value would snap away a blank line the instant it's
// created, fighting the user mid-edit — parsed into the draft by the watcher below instead,
// one-directionally.
const protectedBranchesText = ref(props.draft.git.protectedBranches.join('\n'));
watch(protectedBranchesText, (v) => {
  props.draft.git.protectedBranches = v
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
});
function resetProtectedBranches(): void {
  props.draft.git.protectedBranches = [...defaultSettings.git.protectedBranches];
  protectedBranchesText.value = props.draft.git.protectedBranches.join('\n');
}

const fetchAutoIntervalError = computed<string | null>(() => {
  const v = props.draft.git.fetchAutoIntervalMinutes;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < FETCH_AUTO_INTERVAL_MINUTES_RANGE.min || v > FETCH_AUTO_INTERVAL_MINUTES_RANGE.max) {
    return `${FETCH_AUTO_INTERVAL_MINUTES_RANGE.min}–${FETCH_AUTO_INTERVAL_MINUTES_RANGE.max} minutes`;
  }
  return null;
});
props.registerFieldError('git.fetchAutoIntervalMinutes', fetchAutoIntervalError);

// P92 item 9: 0 is the valid "follow appearance.fontSize" sentinel, but 1..8 is below
// FONT_SIZE_RANGE.min and unreadable — reject that gap here, in the control, since the schema
// itself accepts the full 0..max range (a stored out-of-range value must still hydrate).
const graphFontSizeError = computed<string | null>(() => {
  const v = props.draft.git.graphFontSize;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v === 0) return null;
  if (v < FONT_SIZE_RANGE.min || v > FONT_SIZE_RANGE.max) {
    return `0, or ${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max} px`;
  }
  return null;
});
props.registerFieldError('git.graphFontSize', graphFontSizeError);
</script>

<template>
  <div class="settings-pane" v-show="active">
    <h3 class="section-subhead">Git remote operations</h3>
    <p class="muted-note">
      Server-owned: applies to every connected editor immediately, since two windows
      disagreeing about either is a safety issue, not a preference.
    </p>
    <label class="field">
      <div class="field-head">
        <span>Protected branch patterns (one per line)</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('git', 'protectedBranches') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-git-protectedBranches"
              :disabled="isAtDefault('git', 'protectedBranches')"
              aria-label="Reset to default"
              @click="resetProtectedBranches"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <textarea
        v-model="protectedBranchesText"
        class="p-textarea"
        rows="4"
        placeholder="main"
        data-testid="settings-git-protected-branches"
      />
      <span class="helper-text"
        >Force-pushing or deleting a matching remote branch requires typing its name to
        confirm. "*" matches any characters except "/". Ordinary pushes are never gated.</span
      >
    </label>
    <label class="field">
      <div class="field-head">
        <span>Auto-fetch interval (minutes)</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('git', 'fetchAutoIntervalMinutes') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-git-fetchAutoIntervalMinutes"
              :disabled="isAtDefault('git', 'fetchAutoIntervalMinutes')"
              aria-label="Reset to default"
              @click="resetLeaf('git', 'fetchAutoIntervalMinutes')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <Input
        type="number"
        :min="FETCH_AUTO_INTERVAL_MINUTES_RANGE.min"
        :max="FETCH_AUTO_INTERVAL_MINUTES_RANGE.max"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        :aria-invalid="!!fetchAutoIntervalError || undefined"
        data-testid="settings-git-fetch-auto-interval"
        :model-value="String(draft.git.fetchAutoIntervalMinutes)"
        @input="onFetchAutoIntervalInput"
      />
      <span
        v-if="fetchAutoIntervalError"
        class="field-error"
        data-testid="settings-git-fetch-auto-interval-error"
      >
        {{ fetchAutoIntervalError }}
      </span>
      <span v-else class="helper-text"
        >0 disables background fetching. Never prompts for a credential — a remote that
        needs one simply fails silently and disables the timer until the next explicit
        fetch.</span
      >
    </label>
    <label class="field">
      <div class="field-head">
        <span>Git executable path</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('git', 'gitPath') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-git-gitPath"
              :disabled="isAtDefault('git', 'gitPath')"
              aria-label="Reset to default"
              @click="resetLeaf('git', 'gitPath')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <Input
        type="text"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        data-testid="settings-git-path"
        v-model="draft.git.gitPath"
      />
      <span class="helper-text"
        >Empty uses the host's own discovery (PATH). A remote op reads this fresh every
        time, never cached, so a change here takes effect on the next one.</span
      >
    </label>
    <h3 class="section-subhead">Graph</h3>
    <label class="field">
      <div class="field-head">
        <span>Font size</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('git', 'graphFontSize') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-git-graphFontSize"
              :disabled="isAtDefault('git', 'graphFontSize')"
              aria-label="Reset to default"
              @click="resetLeaf('git', 'graphFontSize')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <Input
        type="number"
        :min="FONT_SIZE_RANGE.min"
        :max="FONT_SIZE_RANGE.max"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        :aria-invalid="!!graphFontSizeError || undefined"
        data-testid="settings-git-graphFontSize"
        :model-value="String(draft.git.graphFontSize)"
        @input="onGraphFontSizeInput"
      />
      <span v-if="graphFontSizeError" class="field-error" data-testid="settings-git-graphFontSize-error">
        {{ graphFontSizeError }}
      </span>
      <span v-else class="helper-text">0 = match the app font size.</span>
    </label>
  </div>
</template>
