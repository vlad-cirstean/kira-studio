// Field-for-field mirrors of internal/docker's wire types.

export const DOCKER_CHANNEL = {
  changed: 'kira:docker:changed',
  status: 'kira:docker:status',
  stats: 'kira:docker:stats',
  logs: 'kira:docker:logs',
  exec: 'kira:docker:exec',
} as const;

type EndpointSource = 'selected' | 'env' | 'context' | 'default' | 'probe';

interface DockerEndpoint {
  context: string;
  host: string;
  source: EndpointSource;
  secure: boolean;
  remote: boolean;
}

export interface DockerContextInfo {
  name: string;
  host: string;
  description: string;
  current: boolean;
}

export type UnavailableReason =
  | 'not-installed'
  | 'daemon-down'
  | 'permission-denied'
  | 'unreachable'
  | 'tls'
  | 'error';

interface EngineInfo {
  version: string;
  apiVersion: string;
  os: string;
  arch: string;
  operatingSystem: string;
  kernelVersion: string;
  cpus: number;
  memTotal: number;
  containers: number;
  running: number;
  paused: number;
  stopped: number;
  images: number;
}

export interface DockerStatus {
  state: 'ok' | 'unavailable';
  reason?: UnavailableReason;
  message?: string;
  endpoint: DockerEndpoint;
  engine?: EngineInfo;
}

interface DockerPort {
  ip: string;
  privatePort: number;
  publicPort: number;
  type: string;
}

export type ContainerState =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: ContainerState;
  status: string;
  created: number;
  ports: DockerPort[];
  composeProject: string;
  composeService: string;
  networks: string[];
}

export interface DockerImage {
  id: string;
  tags: string[];
  size: number;
  created: number;
  containers: number;
  dangling: boolean;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  created: string;
  labels: Record<string, string>;
  usedBy: string[];
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnets: string[];
  containers: number;
  builtin: boolean;
  usedBy: string[];
}

interface DockerMount {
  type: string;
  name: string;
  source: string;
  destination: string;
  mode: string;
  rw: boolean;
}

interface DockerNetworkAttachment {
  network: string;
  ipAddress: string;
  gateway: string;
  macAddress: string;
  aliases: string[];
}

export interface DockerContainerDetail {
  container: DockerContainer;
  command: string[];
  entrypoint: string[];
  env: string[];
  workingDir: string;
  user: string;
  restartPolicy: string;
  health: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  tty: boolean;
  mounts: DockerMount[];
  labels: Record<string, string>;
  networkAttachments: DockerNetworkAttachment[];
  raw: string;
}

export type InspectKind = 'image' | 'volume' | 'network';

export type ResourceKind = 'container' | InspectKind;

export interface DockerStatsSample {
  id: string;
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
  at: number;
}

export interface DockerChangedEvent {
  kinds: ResourceKind[];
}

export interface DockerStatsEvent {
  samples: DockerStatsSample[];
}

export interface DockerLogLine {
  stream: 'stdout' | 'stderr';
  ts?: string;
  text: string;
}

export interface DockerLogsEvent {
  streamId: string;
  lines: DockerLogLine[];
  ended: boolean;
  error?: string;
}

export interface LogsOpenOptions {
  streamId: string;
  containerId: string;
  /** -1 = all */
  tail: number;
  timestamps: boolean;
  follow: boolean;
}
