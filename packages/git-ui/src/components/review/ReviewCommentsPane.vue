<script setup lang="ts">
/**
 * G13 D10 — the review sidebar's Comments pane, and the only new component this phase adds to
 * `packages/git-ui`: the centralized list, the copy-for-AI action and clear-all. The webview never
 * adds a comment (D9) — that gesture lives entirely in VS Code's own Comments API — so this pane is
 * read, remove and clear-all only.
 *
 * Comments render in the server's own order (D13: path, then line, then created_at, then id) —
 * this component groups consecutive same-path comments into one visual section without
 * re-sorting.
 */
import type { LineRange, ReviewComment } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import { computed } from 'vue';
import { ACTION_ICONS } from '../../icons/index.ts';
import type { Capabilities } from '../../state/detailActions.ts';
import type { ReviewCommentsState } from '../../state/reviewComments.ts';

const props = defineProps<{
  reviewComments: ReviewCommentsState;
  capabilities: Capabilities;
}>();

// Reuses ReviewFilesState.selectFile rather than a second editor.openRangeDiff call site (D10) —
// revealing the specific line inside the diff is not attempted (§10).
const emit = defineEmits<(e: 'select-comment', path: string) => void>();

interface PathGroup {
  readonly path: string;
  readonly comments: ReviewComment[];
}

const groups = computed<readonly PathGroup[]>(() => {
  const out: PathGroup[] = [];
  for (const c of props.reviewComments.comments.value) {
    const last = out[out.length - 1];
    if (last && last.path === c.path) {
      last.comments.push(c);
    } else {
      out.push({ path: c.path, comments: [c] });
    }
  }
  return out;
});

const countLabel = computed(() => {
  const n = props.reviewComments.comments.value.length;
  return `${n} ${n === 1 ? 'comment' : 'comments'}`;
});

function lineLabel(range: LineRange): string {
  return range.start === range.end ? `L${range.start}` : `L${range.start}-${range.end}`;
}

/** D12's own two suffix forms, restated for the sidebar rather than the export's plain text. */
function anchorTitle(c: ReviewComment): string | undefined {
  const sha8 = c.anchorSha.slice(0, 8);
  switch (c.anchor) {
    case 'removed':
      return `These lines no longer exist — shown as of ${sha8}`;
    case 'stale':
      return `Lines as of ${sha8} — history was rewritten since`;
    case 'exact':
    case 'projected':
      return undefined;
  }
}
</script>

<template>
  <div class="kv-review-comments-pane">
    <div class="kv-review-comments-header">
      <span class="kv-review-comments-count" data-testid="review-comments-count">{{
        countLabel
      }}</span>
      <KuiButton
        v-if="capabilities.clipboard"
        class="kv-review-comments-icon-button"
        :icon="ACTION_ICONS.copy"
        v-kui-tooltip="'Copy for AI'"
        aria-label="Copy for AI"
        :disabled="reviewComments.comments.value.length === 0"
        @click="reviewComments.copyForAi()"
      />
      <KuiButton
        v-if="!reviewComments.confirmingClear.value"
        class="kv-review-comments-icon-button"
        :icon="ACTION_ICONS.clearAll"
        v-kui-tooltip="'Clear all comments'"
        aria-label="Clear all comments"
        :disabled="reviewComments.comments.value.length === 0 || reviewComments.pending.value"
        @click="reviewComments.confirmClear()"
      />
      <div v-else class="kv-review-comments-clear-confirm">
        <KuiButton @click="reviewComments.clear()">
          Confirm clear ({{ reviewComments.comments.value.length }})
        </KuiButton>
        <KuiButton @click="reviewComments.cancelClear()">Cancel</KuiButton>
      </div>
    </div>

    <p v-if="reviewComments.loadError.value" class="kv-detail-pane-error">
      Couldn't load the comment list — {{ reviewComments.loadError.value }}
    </p>

    <template v-else>
      <div v-if="groups.length > 0" class="kv-review-comments-list">
        <div v-for="group in groups" :key="group.path" class="kv-review-comments-group">
          <div class="kv-review-comments-path">{{ group.path }}</div>
          <div
            v-for="c in group.comments"
            :key="c.id"
            class="kv-review-comments-row"
            role="button"
            tabindex="0"
            @click="emit('select-comment', group.path)"
            @keydown.enter="emit('select-comment', group.path)"
          >
            <div class="kv-review-comments-row-head">
              <span class="kv-review-comments-lines">{{ lineLabel(c.range) }}</span>
              <span
                v-if="anchorTitle(c)"
                class="codicon codicon-warning kv-review-comments-warning"
                v-kui-tooltip="anchorTitle(c)"
                :aria-label="anchorTitle(c)"
              ></span>
              <KuiButton
                class="kv-review-comments-icon-button kv-review-comments-row-delete"
                :icon="ACTION_ICONS.remove"
                v-kui-tooltip="'Delete comment'"
                aria-label="Delete comment"
                :disabled="reviewComments.pending.value"
                @click.stop="reviewComments.remove(c.id)"
              />
            </div>
            <p class="kv-review-comments-body">{{ c.body }}</p>
          </div>
        </div>
      </div>

      <p v-else-if="!reviewComments.loading.value" class="kv-review-comments-empty">
        No comments yet — open a file from the Files tab and use the + in the diff's gutter.
      </p>

      <p v-if="reviewComments.loading.value && groups.length === 0" class="kv-detail-pane-loading">
        Loading…
      </p>
    </template>
  </div>
</template>

<style>
.kv-review-comments-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.kv-review-comments-header {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  height: var(--kv-bar-h);
  padding: 0 var(--kv-s-4);
  border-bottom: var(--kv-border-width) solid var(--kv-panel-border);
  flex-shrink: 0;
  font-family: var(--kv-font-ui);
}

.kv-review-comments-count {
  color: var(--kv-description-fg);
  font-size: var(--kv-t-sm);
}

.kv-review-comments-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--kv-control-h);
  width: var(--kv-control-h);
  margin-left: auto;
  border: none;
  border-radius: var(--kv-radius-sm);
  background: transparent;
  color: var(--kv-app-fg);
  cursor: pointer;
}

.kv-review-comments-icon-button + .kv-review-comments-icon-button {
  margin-left: 0;
}

.kv-review-comments-icon-button:hover:not(:disabled) {
  background-color: var(--kv-row-hover-bg);
}

.kv-review-comments-icon-button:disabled {
  cursor: default;
  opacity: 0.5;
}

.kv-review-comments-clear-confirm {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  margin-left: auto;
  font-size: var(--kv-t-sm);
}

.kv-review-comments-clear-confirm button {
  height: var(--kv-control-h);
  padding: 0 var(--kv-s-2);
  border: var(--kv-border-width) solid var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
  background: transparent;
  color: var(--kv-app-fg);
  font-family: var(--kv-font-ui);
  cursor: pointer;
}

.kv-review-comments-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.kv-review-comments-group + .kv-review-comments-group {
  border-top: var(--kv-border-width) solid var(--kv-panel-border);
}

.kv-review-comments-path {
  padding: var(--kv-s-2) var(--kv-s-4) var(--kv-s-1);
  font-family: var(--kv-font-data); /* LAW 08: a file path is data. */
  font-weight: 600;
  color: var(--kv-row-fg);
}

.kv-review-comments-row {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
  padding: var(--kv-s-1) var(--kv-s-4) var(--kv-s-2);
  cursor: pointer;
}

.kv-review-comments-row:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-review-comments-row-head {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
}

.kv-review-comments-lines {
  font-family: var(--kv-font-data); /* LAW 08: a line reference is data. */
  color: var(--kv-description-fg);
  font-size: var(--kv-t-sm);
}

/* ConflictBanner.vue's own precedent for a warning-tinted codicon — no dedicated --kv-warning-fg
   token exists, so this reuses the same amber "modified" tint. */
.kv-review-comments-warning {
  color: var(--kv-diff-modified-fg);
}

.kv-review-comments-row-delete {
  margin-left: auto;
  height: calc(var(--kv-control-h) * 0.8);
  width: calc(var(--kv-control-h) * 0.8);
}

.kv-review-comments-body {
  margin: 0;
  padding-left: calc(var(--kv-s-4) + var(--kv-s-1));
  white-space: pre-wrap;
  color: var(--kv-row-fg);
  font-size: var(--kv-t-sm);
}

.kv-review-comments-empty {
  margin: 0;
  padding: var(--kv-s-5);
  color: var(--kv-description-fg);
}

/* `.kv-detail-pane-error`/`.kv-detail-pane-loading` are `DetailPane.vue`'s own — reused, not
 * redeclared (`ReviewFilesPane.vue`'s own precedent). */
</style>
