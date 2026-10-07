import { useMutation } from '@tanstack/vue-query';
import { queryClient } from '@workbench/state/queryClient';
import { reposKey } from '../../ade/v2/queries';
import type { FolderArgs, PathArgs } from '../../ade/v2/wire';
import { control } from '../../bridge/control';

function invalidateRepos(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: reposKey, exact: true });
}

export function useAddFolder() {
  return useMutation({
    mutationFn: (args: FolderArgs) => control.adeTaskAddFolder(args),
    onSettled: invalidateRepos,
  });
}

export function useSetFolderWatch() {
  return useMutation({
    mutationFn: (args: FolderArgs) => control.adeTaskSetFolderWatch(args),
    onSettled: invalidateRepos,
  });
}

export function useRemoveFolder() {
  return useMutation({
    mutationFn: (args: PathArgs) => control.adeTaskRemoveFolder(args),
    onSettled: invalidateRepos,
  });
}
