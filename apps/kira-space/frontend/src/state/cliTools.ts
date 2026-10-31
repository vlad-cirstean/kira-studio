import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { control } from '../bridge/control';
import type { CliToolsResult } from './cliToolsDomain';

const CLI_TOOLS_KEY = ['cliTools'] as const;

// Status is live: a login in a terminal must show on the next open, so the data never counts as fresh.
export function useCliTools(enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: CLI_TOOLS_KEY,
    queryFn: () => control.cliTools(false),
    staleTime: 0,
    enabled: () => toValue(enabled),
  });
}

// Refresh re-probes past the providers' status caches.
export function useRefreshCliTools() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => control.cliTools(true),
    onSuccess: (res: CliToolsResult) => queryClient.setQueryData(CLI_TOOLS_KEY, res),
  });
}
