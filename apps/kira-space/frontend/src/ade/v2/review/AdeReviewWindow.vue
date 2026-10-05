<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import MainView from '@workbench/components/MainView.vue';
import TabStrip from '@workbench/components/TabStrip.vue';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import { computed, ref } from 'vue';
import AdePanelResizeHandle from '../panel/AdePanelResizeHandle.vue';
import { useAdeReviewWindowStore } from '../state/adeReviewWindow';
import AdeReviewAgentPanel from './AdeReviewAgentPanel.vue';
import AdeReviewFiles from './AdeReviewFiles.vue';
import AdeReviewHeader from './AdeReviewHeader.vue';
import { useReviewContext } from './useReviewContext';

// Three panes for one branch: files to review (left), this window's diff tabs (centre), and the
// questions panel (right).
const store = useAdeReviewWindowStore();
const target = computed(() => store.target);
const { repoLabel } = useReviewContext(() => store.target as NonNullable<typeof store.target>);

const LEFT_MIN = 220;
const LEFT_MAX = 560;
const storedLeft = useStorage('kira.ade.review.leftWidth', 320);
const liveLeft = ref<number | null>(null);
const leftWidth = computed(() => liveLeft.value ?? storedLeft.value);

function commitLeft(w: number): void {
  storedLeft.value = Math.round(w);
  liveLeft.value = null;
}

const RIGHT_MIN = 280;
const RIGHT_MAX = 720;
const storedRight = useStorage('kira.ade.review.rightWidth', 380);
const liveRight = ref<number | null>(null);
const rightWidth = computed(() => liveRight.value ?? storedRight.value);

function commitRight(w: number): void {
  storedRight.value = Math.round(w);
  liveRight.value = null;
}
</script>

<template>
  <div v-if="target" class="flex h-full flex-col" data-testid="ade-review-window">
    <TitleBarBase>
      <span class="truncate text-kira-md text-muted-foreground">Review · {{ target.branch }}</span>
    </TitleBarBase>
    <AdeReviewHeader :target="target" />
    <div class="flex min-h-0 flex-1">
      <section
        class="min-h-0 flex-none overflow-hidden"
        :style="{ width: `${leftWidth}px` }"
        aria-label="Files to review"
        data-testid="ade-review-left"
      >
        <AdeReviewFiles :target="target" />
      </section>
      <AdePanelResizeHandle
        invert
        :value="leftWidth"
        :min="LEFT_MIN"
        :max="LEFT_MAX"
        @resize="(w) => (liveLeft = w)"
        @commit="commitLeft"
      />
      <section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Diffs" data-testid="ade-review-centre">
        <TabStrip />
        <div class="min-h-0 flex-1">
          <MainView>
            <template #empty>
              <p class="m-0 p-4 text-muted-foreground" data-testid="ade-review-empty">Pick a file to see its diff.</p>
            </template>
          </MainView>
        </div>
      </section>
      <AdePanelResizeHandle
        :value="rightWidth"
        :min="RIGHT_MIN"
        :max="RIGHT_MAX"
        @resize="(w) => (liveRight = w)"
        @commit="commitRight"
      />
      <section
        class="min-h-0 flex-none overflow-hidden"
        :style="{ width: `${rightWidth}px` }"
        aria-label="Review agent"
        data-testid="ade-review-right"
      >
        <AdeReviewAgentPanel :target="target" :repo-label="repoLabel" />
      </section>
    </div>
  </div>
</template>
