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
  <div class="kv:flex kv:flex-col kv:min-h-0 kv:h-full">
    <div class="kv:flex kv:items-center kv:gap-1 kv:h-bar kv:px-2 kv:border-b kv:border-panel-border kv:shrink-0 kv:font-ui">
      <span class="kv:text-muted-foreground kv:text-sm" data-testid="review-comments-count">{{
        countLabel
      }}</span>
      <KuiButton
        v-if="capabilities.clipboard"
        variant="icon"
        class="kv:ml-auto"
        :icon="ACTION_ICONS.copy"
        v-kui-tooltip="'Copy for AI'"
        aria-label="Copy for AI"
        :disabled="reviewComments.comments.value.length === 0"
        @click="reviewComments.copyForAi()"
      />
      <KuiButton
        v-if="!reviewComments.confirmingClear.value"
        variant="icon"
        :class="capabilities.clipboard ? '' : 'kv:ml-auto'"
        :icon="ACTION_ICONS.clearAll"
        v-kui-tooltip="'Clear all comments'"
        aria-label="Clear all comments"
        :disabled="reviewComments.comments.value.length === 0 || reviewComments.pending.value"
        @click="reviewComments.confirmClear()"
      />
      <div v-else class="kv:flex kv:items-center kv:gap-1 kv:ml-auto kv:text-base">
        <KuiButton @click="reviewComments.clear()">
          Confirm clear ({{ reviewComments.comments.value.length }})
        </KuiButton>
        <KuiButton @click="reviewComments.cancelClear()">Cancel</KuiButton>
      </div>
    </div>

    <p v-if="reviewComments.loadError.value" class="kv:m-0 kv:p-3 kv:text-error">
      Couldn't load the comment list — {{ reviewComments.loadError.value }}
    </p>

    <template v-else>
      <div
        v-if="groups.length > 0"
        class="kv:flex-1 kv:min-h-0 kv:overflow-auto"
        role="listbox"
        aria-label="Comments"
      >
        <div
          v-for="group in groups"
          :key="group.path"
          class="kv:border-t kv:border-panel-border kv:first:border-t-0"
        >
          <div class="kv:pt-1 kv:px-2 kv:pb-0.5 kv:font-data kv:font-semibold kv:text-row-fg">
            {{ group.path }}
          </div>
          <div
            v-for="c in group.comments"
            :key="c.id"
            class="kv:flex kv:flex-col kv:gap-0.5 kv:pt-0.5 kv:px-2 kv:pb-1 kv:cursor-pointer kv:hover:bg-hover"
            role="option"
            :aria-selected="false"
            tabindex="0"
            @click="emit('select-comment', group.path)"
            @keydown.enter="emit('select-comment', group.path)"
          >
            <div class="kv:flex kv:items-center kv:gap-1">
              <span class="kv:font-data kv:text-muted-foreground kv:text-sm">{{ lineLabel(c.range) }}</span>
              <span
                v-if="anchorTitle(c)"
                class="codicon codicon-warning kv:text-diff-modified"
                v-kui-tooltip="anchorTitle(c)"
                :aria-label="anchorTitle(c)"
              ></span>
              <KuiButton
                variant="icon"
                class="kv:ml-auto"
                :icon="ACTION_ICONS.remove"
                v-kui-tooltip="'Delete comment'"
                aria-label="Delete comment"
                :disabled="reviewComments.pending.value"
                @click.stop="reviewComments.remove(c.id)"
              />
            </div>
            <p class="kv:m-0 kv:pl-2.5 kv:whitespace-pre-wrap kv:text-row-fg kv:text-base">{{ c.body }}</p>
          </div>
        </div>
      </div>

      <p v-else-if="!reviewComments.loading.value" class="kv:m-0 kv:p-3 kv:text-muted-foreground">
        No comments yet — open a file from the Files tab and use the + in the diff's gutter.
      </p>

      <p
        v-if="reviewComments.loading.value && groups.length === 0"
        class="kv:m-0 kv:p-3 kv:text-muted-foreground"
      >
        Loading…
      </p>
    </template>
  </div>
</template>

