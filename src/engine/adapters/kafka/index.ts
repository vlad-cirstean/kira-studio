import type { Admin, Kafka } from 'kafkajs';
import type { SourceText } from '../../../shared/domain/ddl';
import type { MutationResult } from '../../../shared/domain/mutations';
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
import { connectKafka } from './client';
import { mapKafkaError } from './errors';
import { countTopic, readTopic } from './read';

class KafkaAdapter implements Adapter {
  readonly kind = 'kafka' as const;
  readonly caps = kafkaCaps;

  private kafka: Kafka | null = null;
  private admin: Admin | null = null;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig): Promise<ConnectInfo> {
    const { kafka, admin } = await connectKafka(cfg, this.deps.log);
    let clusterId: string;
    try {
      ({ clusterId } = await admin.describeCluster());
    } catch (err) {
      await admin.disconnect().catch(() => {});
      throw mapKafkaError(err);
    }

    this.kafka = kafka;
    this.admin = admin;

    return {
      serverVersion: 'Kafka',
      details: { cluster: clusterId },
    };
  }

  async disconnect(): Promise<void> {
    await this.admin?.disconnect().catch(() => {});
    this.kafka = null;
    this.admin = null;
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
    if (segments.length === 1) return catalog.listPartitions(this.requireAdmin(), rootSegment.name);
    return []; // a partition — leaf.
  }

  async describe(): Promise<ObjectMeta> {
    // §8.9 has no column/FK navigation for streams — never reached by a 'stream' tab.
    throw new AdapterError('E_UNSUPPORTED', 'describe is not supported for kafka');
  }

  async ddl(): Promise<SourceText> {
    // caps.ddl === false gates §8.10's "Open DDL" menu item for kafka — never reached.
    throw new AdapterError('E_UNSUPPORTED', 'ddl is not supported for kafka');
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const topic = this.resolveTopicTarget(req.path);
    return readTopic(this.requireKafka(), this.requireAdmin(), topic, req, ctx);
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    const topic = this.resolveTopicTarget(req.path);
    return countTopic(this.requireAdmin(), topic, ctx);
  }

  preview(): string[] {
    // caps.writable === false — read-only in v1 (P10's ground rules); no producer UI in scope.
    throw new AdapterError('E_UNSUPPORTED', 'kafka connections are read-only in this version');
  }

  async mutate(): Promise<MutationResult> {
    throw new AdapterError('E_UNSUPPORTED', 'kafka connections are read-only in this version');
  }

  async execute(): Promise<Page[]> {
    // caps.sql === false — no console for kafka (P10's D13); never reached.
    throw new AdapterError('E_UNSUPPORTED', 'kafka has no query console');
  }

  // D6/D14: `ctx.signal.addEventListener('abort', () => consumer.stop())` inside read() is the
  // sole cancel mechanism, mirroring P9's D7/D8 — this stays a permanent no-op.
  async cancel(): Promise<boolean> {
    return false;
  }

  private requireKafka(): Kafka {
    if (!this.kafka) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.kafka;
  }

  private requireAdmin(): Admin {
    if (!this.admin) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.admin;
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
