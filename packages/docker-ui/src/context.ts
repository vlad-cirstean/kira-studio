import { createTerminalsStore, type TerminalsControl } from '@workbench/state/createTerminalsStore';
import type { TerminalHostDeps } from '@workbench/terminal/terminalHost';
import type { InjectionKey } from 'vue';
import { inject, provide } from 'vue';
import { createDockerControl, type DockerBindings, type DockerControl } from './control';

export interface DockerContext {
  control: DockerControl;
  /** The exec sessions' own terminals store (a second instance, `storeId: 'docker-exec'`). */
  execStore: ReturnType<ReturnType<typeof createTerminalsStore>>;
  execHostDeps: TerminalHostDeps;
  /** execId -> containerId, filled before an exec view mounts so `terminalOpen` can resolve it. */
  execContainers: Map<string, string>;
  /** Opens an http(s) URL in the OS browser. */
  openExternal(url: string): Promise<void>;
}

interface DockerContextOptions {
  appearance(): { fontFamily: string; fontSize: number };
  openExternal(url: string): Promise<void>;
}

const dockerKey: InjectionKey<DockerContext> = Symbol('docker');

/** Builds the module context once per app; needs an active Pinia. */
export function createDockerContext(
  bindings: DockerBindings,
  options: DockerContextOptions,
): DockerContext {
  const execContainers = new Map<string, string>();
  const control = createDockerControl(bindings, execContainers);
  const useExecStore = createTerminalsStore(control.exec as TerminalsControl, {
    appearance: options.appearance,
    storeId: 'docker-exec',
  });
  const execStore = useExecStore();
  const execHostDeps: TerminalHostDeps = {
    rendererDeps: {
      appearance: options.appearance,
      onTerminalOutput: execStore.onTerminalOutput,
      writeTerminal: execStore.writeTerminal,
    },
    terminalSession: execStore.terminalSession,
    openTerminalSession: execStore.openTerminalSession,
    resizeTerminal: execStore.resizeTerminal,
  };
  return { control, execStore, execHostDeps, execContainers, openExternal: options.openExternal };
}

export function provideDocker(ctx: DockerContext): void {
  provide(dockerKey, ctx);
}

export function useDocker(): DockerContext {
  const ctx = inject(dockerKey);
  if (!ctx) throw new Error('useDocker: no DockerContext provided');
  return ctx;
}
