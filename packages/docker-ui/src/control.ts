import type { TerminalEvent } from '@shared/protocol/events';
import { on, trust, unwrap, windowKey } from '@workbench/bridge/rpc';
import type { TerminalsControl } from '@workbench/state/createTerminalsStore';
import {
  DOCKER_CHANNEL,
  type DockerChangedEvent,
  type DockerContainer,
  type DockerContainerDetail,
  type DockerContextInfo,
  type DockerImage,
  type DockerLogsEvent,
  type DockerNetwork,
  type DockerStatsEvent,
  type DockerStatus,
  type DockerVolume,
  type InspectKind,
  type LogsOpenOptions,
} from './wire';

/** The generated `@bindings/dockerservice.js` module's shape — each app passes its own. */
export interface DockerBindings {
  Status(a: { refresh: boolean }): Promise<unknown>;
  Contexts(): Promise<unknown>;
  UseContext(a: { name: string }): Promise<unknown>;
  Containers(a: { all: boolean }): Promise<unknown>;
  Images(): Promise<unknown>;
  Volumes(): Promise<unknown>;
  Networks(): Promise<unknown>;
  InspectContainer(a: { id: string }): Promise<unknown>;
  Inspect(a: { kind: string; id: string }): Promise<unknown>;
  Start(a: { id: string }): Promise<void>;
  Stop(a: { id: string }): Promise<void>;
  Restart(a: { id: string }): Promise<void>;
  Watch(a: { windowKey: string }): Promise<void>;
  Unwatch(a: { windowKey: string }): Promise<void>;
  StatsSubscribe(a: { windowKey: string; ids: string[] }): Promise<void>;
  StatsUnsubscribe(a: { windowKey: string }): Promise<void>;
  LogsOpen(a: {
    windowKey: string;
    streamId: string;
    containerId: string;
    tail: number;
    timestamps: boolean;
    follow: boolean;
  }): Promise<void>;
  LogsClose(a: { streamId: string }): Promise<void>;
  ExecOpen(a: {
    windowKey: string;
    terminalId: string;
    containerId: string;
    cols: number;
    rows: number;
  }): Promise<unknown>;
  ExecWrite(a: { terminalId: string; data: string }): Promise<void>;
  ExecResize(a: { terminalId: string; cols: number; rows: number }): Promise<void>;
  ExecClose(a: { terminalId: string }): Promise<void>;
}

export interface DockerControl {
  status(refresh: boolean): Promise<DockerStatus>;
  contexts(): Promise<DockerContextInfo[]>;
  useContext(name: string): Promise<DockerStatus>;
  containers(all: boolean): Promise<DockerContainer[]>;
  images(): Promise<DockerImage[]>;
  volumes(): Promise<DockerVolume[]>;
  networks(): Promise<DockerNetwork[]>;
  inspectContainer(id: string): Promise<DockerContainerDetail>;
  inspect(kind: InspectKind, id: string): Promise<{ raw: string }>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  watch(): Promise<void>;
  unwatch(): Promise<void>;
  statsSubscribe(ids: string[]): Promise<void>;
  statsUnsubscribe(): Promise<void>;
  logsOpen(opts: LogsOpenOptions): Promise<void>;
  logsClose(streamId: string): Promise<void>;
  onChanged(cb: (e: DockerChangedEvent) => void): () => void;
  onStatus(cb: (s: DockerStatus) => void): () => void;
  onStats(cb: (e: DockerStatsEvent) => void): () => void;
  onLogs(cb: (e: DockerLogsEvent) => void): () => void;
  /** Exec sessions through the terminal stack: `terminalOpen`'s id is looked up in `execContainers`. */
  exec: TerminalsControl;
}

export function createDockerControl(
  b: DockerBindings,
  execContainers: Map<string, string>,
): DockerControl {
  const list = <T>(p: Promise<unknown>): Promise<T[]> =>
    unwrap(p).then((r) => trust<T[] | null>(r) ?? []);

  const exec: TerminalsControl = {
    terminalDefaultCwd: async () => ({ path: '' }),
    onTerminal: (cb) => on<TerminalEvent>(DOCKER_CHANNEL.exec, cb),
    terminalOpen: async (terminalId, _cwd, cols, rows) => {
      const containerId = execContainers.get(terminalId);
      if (!containerId) throw new Error(`no container registered for exec session ${terminalId}`);
      return trust<{ shell: string }>(
        await unwrap(b.ExecOpen({ windowKey, terminalId, containerId, cols, rows })),
      );
    },
    terminalWrite: (terminalId, data) => unwrap(b.ExecWrite({ terminalId, data })),
    terminalResize: (terminalId, cols, rows) => unwrap(b.ExecResize({ terminalId, cols, rows })),
    terminalClose: (terminalId) => {
      execContainers.delete(terminalId);
      return unwrap(b.ExecClose({ terminalId }));
    },
  };

  return {
    status: (refresh) => unwrap(b.Status({ refresh })).then((r) => trust<DockerStatus>(r)),
    contexts: () => list<DockerContextInfo>(b.Contexts()),
    useContext: (name) => unwrap(b.UseContext({ name })).then((r) => trust<DockerStatus>(r)),
    containers: (all) => list<DockerContainer>(b.Containers({ all })),
    images: () => list<DockerImage>(b.Images()),
    volumes: () => list<DockerVolume>(b.Volumes()),
    networks: () => list<DockerNetwork>(b.Networks()),
    inspectContainer: (id) =>
      unwrap(b.InspectContainer({ id })).then((r) => trust<DockerContainerDetail>(r)),
    inspect: (kind, id) => unwrap(b.Inspect({ kind, id })).then((r) => trust<{ raw: string }>(r)),
    start: (id) => unwrap(b.Start({ id })),
    stop: (id) => unwrap(b.Stop({ id })),
    restart: (id) => unwrap(b.Restart({ id })),
    watch: () => unwrap(b.Watch({ windowKey })),
    unwatch: () => unwrap(b.Unwatch({ windowKey })),
    statsSubscribe: (ids) => unwrap(b.StatsSubscribe({ windowKey, ids })),
    statsUnsubscribe: () => unwrap(b.StatsUnsubscribe({ windowKey })),
    logsOpen: (opts) => unwrap(b.LogsOpen({ windowKey, ...opts })),
    logsClose: (streamId) => unwrap(b.LogsClose({ streamId })),
    onChanged: (cb) => on<DockerChangedEvent>(DOCKER_CHANNEL.changed, cb),
    onStatus: (cb) => on<DockerStatus>(DOCKER_CHANNEL.status, cb),
    onStats: (cb) => on<DockerStatsEvent>(DOCKER_CHANNEL.stats, cb),
    onLogs: (cb) => on<DockerLogsEvent>(DOCKER_CHANNEL.logs, cb),
    exec,
  };
}
