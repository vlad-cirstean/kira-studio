<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { computed } from 'vue';
import { useReposDialogStore } from '../../../repo/state/reposDialog';
import AdeRepoTag from '../AdeRepoTag.vue';
import { useRepos } from '../queries';
import { useAdeReposUiStore } from '../state/adeReposUi';
import { TONE } from '../tones';
import AdeRepoDetail from './AdeRepoDetail.vue';

// Repos page (SPEC2 section 6.3): the shared repository list on the left, the picked repo's `ade` settings right.
const reposUi = useAdeReposUiStore();
const reposDialog = useReposDialogStore();
const repos = useRepos();

const list = computed(() => repos.data.value?.repos ?? []);
const current = computed(() => list.value.find((r) => r.codeRepoId === reposUi.repoId) ?? list.value[0] ?? null);
</script>

<template>
  <div class="flex min-h-0 flex-1" data-testid="ade-repos">
    <div class="flex w-[320px] shrink-0 flex-col gap-1 overflow-auto border-r border-border px-3 py-4">
      <h2 class="m-0 px-1 pb-1.5 text-kira-lg font-semibold">Repos</h2>
      <button
        v-for="r in list"
        :key="r.codeRepoId"
        type="button"
        class="box-border flex w-full cursor-pointer flex-col items-start gap-1 rounded-kira border-0 border-l-[3px] px-2.5 py-2 text-left text-fg"
        :class="current?.codeRepoId === r.codeRepoId ? 'bg-hover' : 'bg-transparent'"
        :style="{ borderLeftColor: current?.codeRepoId === r.codeRepoId ? TONE.amber[2] : 'transparent' }"
        data-testid="ade-repo-row"
        :data-repo-id="r.codeRepoId"
        @click="reposUi.repoId = r.codeRepoId"
      >
        <AdeRepoTag :code-repo-id="r.codeRepoId" :label="r.nickname || r.name" class="px-2 py-0.5 text-kira-lg" />
        <span class="max-w-full truncate font-data text-kira-sm text-fg" :title="r.name">{{ r.name }}</span>
        <span class="text-kira-sm text-muted-foreground"
          >{{ r.environments.length }} envs · {{ r.integrationBranches.length }} integration branches</span
        >
      </button>
      <div class="flex flex-col items-start gap-1.5 px-1 pt-1.5">
        <p class="m-0 text-kira-sm text-subtle" data-testid="ade-repos-hint">Add repositories from the Git module.</p>
        <Button variant="dialog" size="kira-lg" data-testid="ade-repos-manage" @click="reposDialog.show()">
          Manage repositories…
        </Button>
      </div>
    </div>
    <div class="min-w-0 flex-1 overflow-auto px-6 pb-6 pt-4">
      <AdeRepoDetail v-if="current" :key="current.codeRepoId" :repo="current" />
    </div>
  </div>
</template>
