import * as DockerService from '@bindings/dockerservice.js';
import * as LinkService from '@bindings/linkservice.js';
import { createDockerContext, type DockerBindings, type DockerContext } from '@kira/docker-ui';
import { createOpenExternal } from '@workbench/bridge/openExternal';
import { useSettingsStore } from '../state/settings';

let ctx: DockerContext | null = null;

/** One Docker module context per app; created on first use, after Pinia is active. */
export function studioDocker(): DockerContext {
  ctx ??= createDockerContext(DockerService as unknown as DockerBindings, {
    appearance: () => useSettingsStore().appearance,
    openExternal: createOpenExternal((url) => LinkService.OpenExternal({ url })),
  });
  return ctx;
}
