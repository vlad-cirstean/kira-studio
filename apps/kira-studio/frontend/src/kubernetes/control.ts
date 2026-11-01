import * as KubernetesService from '@bindings/kubernetesservice.js';
import { on, trust, unwrap, windowKey } from '@workbench/bridge/rpc';
import {
  KUBE_CHANNEL,
  type KubeClusters,
  type KubeDescription,
  type KubeKinds,
  type KubeList,
  type KubeLogsEvent,
  type KubeLogsOpen,
  type KubeMcpSettings,
  type KubeNamespaces,
  type KubeStatus,
} from './wire';

export const kubeControl = {
  clusters: () => unwrap(KubernetesService.Clusters()).then((r) => trust<KubeClusters>(r)),
  status: (clusterId: string, refresh: boolean) =>
    unwrap(KubernetesService.Status({ clusterId, refresh })).then((r) => trust<KubeStatus>(r)),
  setMcp: (clusterId: string, mcp: KubeMcpSettings) =>
    unwrap(KubernetesService.SetMcp({ clusterId, mcp })).then((r) => trust<KubeMcpSettings>(r)),
  namespaces: (clusterId: string) =>
    unwrap(KubernetesService.Namespaces({ clusterId })).then((r) => trust<KubeNamespaces>(r)),
  kinds: (clusterId: string) =>
    unwrap(KubernetesService.Kinds({ clusterId })).then((r) => trust<KubeKinds>(r)),
  list: (clusterId: string, kind: string, namespace: string, labelSelector: string) =>
    unwrap(KubernetesService.List({ clusterId, kind, namespace, labelSelector })).then((r) =>
      trust<KubeList>(r),
    ),
  describe: (clusterId: string, kind: string, namespace: string, name: string) =>
    unwrap(KubernetesService.Describe({ clusterId, kind, namespace, name })).then((r) =>
      trust<KubeDescription>(r),
    ),
  logsOpen: (a: KubeLogsOpen) => unwrap(KubernetesService.LogsOpen({ windowKey, ...a })),
  logsClose: (streamId: string) => unwrap(KubernetesService.LogsClose({ streamId })),
  onLogs: (cb: (e: KubeLogsEvent) => void) => on<KubeLogsEvent>(KUBE_CHANNEL.logs, cb),
};
