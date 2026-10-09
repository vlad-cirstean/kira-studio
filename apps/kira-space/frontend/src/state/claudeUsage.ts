import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, onScopeDispose } from 'vue';
import { type ClaudeUsageSnapshot, control } from '../bridge/index';
import { useModeStore } from './mode';
import { useSettingsStore } from './settings';

export const claudeUsageKey = ['claudeUsage'] as const;

// P239: the Claude Code limits snapshot. Server state, so TanStack Query; Go pushes each change
// and the push replaces the cached value. The 60 s poll only covers a push Go rate-limited away.
export function useClaudeUsage() {
  const mode = useModeStore();
  const settings = useSettingsStore();
  const queryClient = useQueryClient();
  const enabled = computed(() => mode.active === 'ade' && settings.claudeCode.usageEnabled);

  const stop = control.onClaudeUsage((snapshot: ClaudeUsageSnapshot) => {
    queryClient.setQueryData(claudeUsageKey, snapshot);
  });
  onScopeDispose(stop);

  return useQuery({
    queryKey: claudeUsageKey,
    queryFn: () => control.claudeUsageGet(),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
