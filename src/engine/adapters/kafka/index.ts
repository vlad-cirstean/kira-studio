import { librdkafkaVersion } from '@confluentinc/kafka-javascript';
import type { ObjectDefinition } from '../../../shared/domain/definition';
import type { MutationPlan, MutationResult } from '../../../shared/domain/mutations';
import type { ObjectTransferResult } from '../../../shared/domain/object-store';
import {
  encodePath,
  type NodePath,
  type ObjectMeta,
  type TreeNode,
} from '../../../shared/domain/tree';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { Page } from '../../../shared/protocol/page';
import type {
  Adapter,
  AdapterDeps,
  ConnectInfo,
  CountRequest,
  OpCtx,
  ReadRequest,
} from '../adapter';
import { AdapterError } from '../errors';
import { kafkaCaps } from './caps';
import * as catalog from './catalog';
import { connectKafka, type KafkaClientHandle } from './client';
import { buildGroupDefinition, buildTopicDefinition } from './definition';
import * as producer from './produce';
import { countTopic, readTopic } from './read';

class KafkaAdapter implements Adapter {
  readonly kind = 'kafka' as const;
  readonly caps = kafkaCaps;

  private handle: KafkaClientHandle | null = null;
  private readOnly = false;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig): Promise<ConnectInfo> {
    const handle = await connectKafka(cfg, this.deps.log);
    this.handle = handle;
    this.readOnly = cfg.readOnly;

    // P32 D13/F11: no describeCluster() in this client — details loses `cluster` and gains
    // `brokers`/`librdkafka` instead. `details` is free-form (adapter.ts) and currently unread by
    // the renderer (only serverVersion is), so the swap costs the user nothing today.
    return {
      serverVersion: 'Kafka',
      details: {
        brokers: String(handle.brokerCount),
        librdkafka: librdkafkaVersion,
      },
    };
  }

  async disconnect(): Promise<void> {
    await this.handle?.admin.disconnect().catch(() => {});
    this.handle = null;
  }

  async children(path: NodePath): Promise<TreeNode[]> {
    const segments = path.segments;
    if (segments.length === 0) return catalog.listRoot(this.requireAdmin());

    const [rootSegment] = segments;
    // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws.
    if (rootSegment.kind === 'consumerGroup') return [];
    if (rootSegment.kind !== 'topic') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${rootSegment.kind}`,
      );
    }
    // P23 D4: a topic path still enumerates its partitions here — the tree no longer expands a
    // topic (D3), but StreamView.vue's partition filter popover is a second, live caller of this
    // same call, re-fetched every time it opens (loadPartitionOptions()). Deleting this the way
    // P19's D5 deleted column enumeration would break that filter; the two cases differ precisely
    // because this one still has a caller.
    if (segments.length === 1) return catalog.listPartitions(this.requireAdmin(), rootSegment.name);
    return []; // a partition — leaf.
  }

  async describe(): Promise<ObjectMeta> {
    // caps.describe is false (P31 D2) — unreachable while that flag gates every caller,
    // including the definition view's own describe() load that used to fire this every time.
    throw new AdapterError('E_UNSUPPORTED', 'describe is not supported for kafka');
  }

  async definition(path: NodePath): Promise<ObjectDefinition> {
    const [segment] = path.segments;
    if (segment?.kind === 'topic') {
      return buildTopicDefinition(this.requireAdmin(), segment.name);
    }
    if (segment?.kind === 'consumerGroup') {
      return buildGroupDefinition(this.requireAdmin(), segment.name);
    }
    throw new AdapterError(
      'E_NOT_FOUND',
      `definition requires a topic or consumer group path, got: ${encodePath(path.segments)}`,
    );
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const topic = this.resolveTopicTarget(req.path);
    return readTopic(this.requireHandle(), topic, req, ctx);
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    const topic = this.resolveTopicTarget(req.path);
    return countTopic(this.requireAdmin(), topic, ctx);
  }

  preview(plan: MutationPlan): string[] {
    const topic = this.resolveTopicTarget(plan.path);
    return producer.preview(plan, topic);
  }

  async mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult> {
    const topic = this.resolveTopicTarget(plan.path);
    return producer.produce(this.requireKafka(), topic, this.readOnly, plan, ctx);
  }

  async execute(): Promise<Page[]> {
    // caps.sql === false — no console for kafka (P10's D13); never reached.
    throw new AdapterError('E_UNSUPPORTED', 'kafka has no query console');
  }

  // P32 D22 (was D6/D14): `ctx.signal.addEventListener('abort', () => consumer.disconnect())`
  // inside read() is the sole cancel mechanism, mirroring P9's D7/D8 — this stays a permanent
  // no-op. The mechanism changed shape (stop() no longer exists on this client, F14), not its
  // effectiveness.
  async downloadObject(): Promise<ObjectTransferResult> {
    // caps.fileTransfer === false — no UI ever offers Download for kafka; never reached.
    throw new AdapterError('E_UNSUPPORTED', 'file transfer is not supported for kafka');
  }

  async cancel(): Promise<boolean> {
    return false;
  }

  private requireHandle(): KafkaClientHandle {
    if (!this.handle) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.handle;
  }

  private requireKafka(): KafkaClientHandle['kafka'] {
    return this.requireHandle().kafka;
  }

  private requireAdmin(): KafkaClientHandle['admin'] {
    return this.requireHandle().admin;
  }

  private resolveTopicTarget(path: NodePath): string {
    const [topicSegment] = path.segments;
    if (topicSegment?.kind !== 'topic') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `read requires a topic path, got: ${encodePath(path.segments)}`,
      );
    }
    return topicSegment.name;
  }
}

export function createKafkaAdapter(deps: AdapterDeps): Adapter {
  return new KafkaAdapter(deps);
}
