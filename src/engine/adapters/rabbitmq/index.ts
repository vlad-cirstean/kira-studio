import type { Caps } from '@shared/caps';
import type { ObjectDefinition } from '@shared/domain/definition';
import type { MutationPlan, MutationResult } from '@shared/domain/mutations';
import type { ObjectTransferResult } from '@shared/domain/object-store';
import { encodePath, type NodePath, type ObjectMeta } from '@shared/domain/tree';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { Page } from '@shared/protocol/page';
import type {
  Adapter,
  AdapterDeps,
  ConnectInfo,
  CountRequest,
  OpCtx,
  ReadRequest,
  TreeChildren,
} from '../adapter';
import { AdapterError, noQueryConsole, unsupported } from '../errors';
import { rabbitmqCaps } from './caps';
import * as catalog from './catalog';
import { buildHandle, type RabbitHandle } from './client';
import { buildExchangeDefinition, buildQueueDefinition } from './definition';
import { mapNetworkError } from './errors';
import * as mutate from './mutate';
import { CONNECT_TIMEOUT_MS, request } from './query';
import { countQueue, pollQueue } from './read';

interface OverviewResponse {
  rabbitmq_version?: string;
  management_version?: string;
  node?: string;
  cluster_name?: string;
}

class RabbitMqAdapter implements Adapter {
  readonly kind = 'rabbitmq' as const;
  readonly caps: Caps = rabbitmqCaps;

  private handle: RabbitHandle | null = null;

  constructor(private readonly deps: AdapterDeps) {}

  // D5: exactly one request — GET /api/overview — and each of its distinguishable failures
  // becomes its own message: a wrong credential names itself (401 -> E_AUTH via the broker's own
  // reason, F16); a 404 or unparseable body means no management API is listening at this address
  // at all (F17); a timeout with the socket never answering names the single most common mistake —
  // pointing this adapter at AMQP's own port instead of the management API's.
  async connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo> {
    const handle = buildHandle(cfg, this.deps.log);
    // P13 D1: assigned before the probe runs — disconnect() must be reachable from the instant
    // the handle exists, even though (unlike a live socket adapter) there is nothing here to leak.
    this.handle = handle;
    try {
      const overview = await request<OverviewResponse>(handle, ctx, {
        method: 'GET',
        segments: ['overview'],
        timeoutMs: CONNECT_TIMEOUT_MS,
        command: 'GET /api/overview',
      });
      return {
        serverVersion: `RabbitMQ ${overview.rabbitmq_version ?? '(unknown)'}`,
        details: {
          management: overview.management_version ?? '(unknown)',
          node: overview.node ?? '(unknown)',
          cluster: overview.cluster_name ?? '(unknown)',
          vhost: handle.vhostScope ?? 'all',
        },
      };
    } catch (err) {
      await this.disconnect();
      throw this.classifyConnectFailure(err);
    }
  }

  private classifyConnectFailure(err: unknown): AdapterError {
    const mapped = err instanceof AdapterError ? err : mapNetworkError(err);
    if (mapped.code === 'E_TIMEOUT') {
      return new AdapterError(
        'E_CONNECT',
        'no HTTP response — port 5672 is AMQP; the management API is on 15672',
        mapped,
      );
    }
    if (mapped.code === 'E_NOT_FOUND') {
      return new AdapterError(
        'E_CONNECT',
        'no management API at this address — is the rabbitmq_management plugin enabled?',
        mapped,
      );
    }
    return mapped;
  }

  async disconnect(): Promise<void> {
    this.handle = null;
  }

  async children(path: NodePath, ctx: OpCtx): Promise<TreeChildren> {
    const h = this.requireHandle();
    const segments = path.segments;

    if (segments.length === 0) return { nodes: await catalog.listVhosts(h, ctx) };

    const [vhostSegment, objectSegment] = segments;
    if (vhostSegment.kind !== 'database') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${vhostSegment.kind}`,
      );
    }
    if (segments.length === 1) {
      return { nodes: await catalog.listVhostChildren(h, ctx, vhostSegment.name) };
    }

    // Adapter rule 5: children() returns [] for a leaf, never throws — queues and exchanges are
    // both leaves (D17: bindings live in the definition view, not the tree).
    if (
      segments.length === 2 &&
      objectSegment &&
      (objectSegment.kind === 'queue' || objectSegment.kind === 'exchange')
    ) {
      return { nodes: [] };
    }

    throw new AdapterError('E_NOT_FOUND', `unrecognized path: ${encodePath(segments)}`);
  }

  async describe(): Promise<ObjectMeta> {
    // caps.describe is false (D19) — unreachable while that flag gates every caller.
    unsupported(this.kind, 'describe');
  }

  async definition(path: NodePath, ctx: OpCtx): Promise<ObjectDefinition> {
    const h = this.requireHandle();
    const { vhost, name, kind } = this.requireObjectPath(path, 'definition');
    return kind === 'queue'
      ? buildQueueDefinition(h, ctx, vhost, name)
      : buildExchangeDefinition(h, ctx, vhost, name);
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const h = this.requireHandle();
    const { vhost, name, kind } = this.requireObjectPath(req.path, 'read');
    if (kind !== 'queue') {
      throw new AdapterError('E_NOT_FOUND', 'only a queue can be read as a stream');
    }
    return pollQueue(h, vhost, name, req, ctx);
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    const h = this.requireHandle();
    const { vhost, name, kind } = this.requireObjectPath(req.path, 'count');
    if (kind !== 'queue') {
      throw new AdapterError('E_NOT_FOUND', 'only a queue can be counted');
    }
    return countQueue(h, vhost, name, ctx);
  }

  preview(plan: MutationPlan): string[] {
    const { vhost, name, kind } = this.requireObjectPath(plan.path, 'preview');
    if (kind !== 'queue') throw new AdapterError('E_UNSUPPORTED', 'only a queue accepts a publish');
    return mutate.preview(plan, vhost, name);
  }

  async mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult> {
    const h = this.requireHandle();
    const { vhost, name, kind } = this.requireObjectPath(plan.path, 'mutate');
    if (kind !== 'queue') throw new AdapterError('E_UNSUPPORTED', 'only a queue accepts a publish');
    return mutate.mutateQueue(h, vhost, name, h.readOnly, plan, ctx);
  }

  async execute(): Promise<Page[]> {
    // caps.sql === false — the management API has no ad-hoc command language worth a console
    // (D28); never reached.
    noQueryConsole(this.kind);
  }

  async downloadObject(): Promise<ObjectTransferResult> {
    // caps.fileTransfer === false — no UI ever offers Download for this engine; never reached.
    unsupported(this.kind, 'file transfer');
  }

  // D7: cancellation is delivered per-request via ctx.signal (query.ts's request()) — there is no
  // long-running server-side query to reach afterward the way ClickHouse's KILL QUERY does, so
  // this stays a permanent no-op, mirroring kafka's and sqs's own cancel().
  async cancel(): Promise<boolean> {
    return false;
  }

  private requireHandle(): RabbitHandle {
    if (!this.handle) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.handle;
  }

  private requireObjectPath(
    path: NodePath,
    op: string,
  ): { vhost: string; name: string; kind: 'queue' | 'exchange' } {
    const [vhostSegment, objectSegment] = path.segments;
    if (
      path.segments.length !== 2 ||
      vhostSegment?.kind !== 'database' ||
      !objectSegment ||
      (objectSegment.kind !== 'queue' && objectSegment.kind !== 'exchange')
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `${op} requires a vhost/queue or vhost/exchange path, got: ${encodePath(path.segments)}`,
      );
    }
    return { vhost: vhostSegment.name, name: objectSegment.name, kind: objectSegment.kind };
  }
}

export function createRabbitMqAdapter(deps: AdapterDeps): Adapter {
  return new RabbitMqAdapter(deps);
}
