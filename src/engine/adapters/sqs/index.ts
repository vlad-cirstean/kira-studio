import type { SQSClient } from '@aws-sdk/client-sqs';
import type { ObjectDefinition } from '../../../shared/domain/definition';
import type { MutationPlan, MutationResult } from '../../../shared/domain/mutations';
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
import { sqsCaps } from './caps';
import * as catalog from './catalog';
import { connectSqs } from './client';
import { buildQueueDefinition } from './definition';
import { mapSqsError } from './errors';
import * as mutate from './mutate';
import { countQueue, pollQueue } from './read';

class SqsAdapter implements Adapter {
  readonly kind = 'sqs' as const;
  readonly caps = sqsCaps;

  private client: SQSClient | null = null;
  private readOnly = false;
  // D14: name -> URL, populated by listQueues (free — it already has every URL while paging) and
  // by resolveQueueUrl on a miss; avoids a GetQueueUrl round trip on every read()/count() call.
  private readonly queueUrls = new Map<string, string>();
  // D-delete: MessageId -> ReceiptHandle, populated by pollQueue (read.ts) as messages arrive and
  // consumed by mutate() below — see mutate.ts's doc comment for why this never crosses the wire.
  private readonly receiptHandles = new Map<string, string>();

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig): Promise<ConnectInfo> {
    const { client } = connectSqs(cfg, this.deps.log);
    try {
      await catalog.listQueues(client);
    } catch (err) {
      client.destroy();
      throw mapSqsError(err);
    }
    this.client = client;
    this.readOnly = cfg.readOnly;
    return { serverVersion: 'Amazon SQS' };
  }

  async disconnect(): Promise<void> {
    this.client?.destroy();
    this.client = null;
    this.queueUrls.clear();
    this.receiptHandles.clear();
  }

  async children(path: NodePath): Promise<TreeNode[]> {
    // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws — a 'queue'
    // node never has children (§5.1's flat "region -> queues" tree, no deeper level).
    if (path.segments.length > 0) return [];
    const { nodes, urlByName } = await catalog.listQueues(this.requireClient());
    for (const [name, url] of urlByName) this.queueUrls.set(name, url);
    return nodes;
  }

  private async resolveQueueUrl(client: SQSClient, name: string): Promise<string> {
    const cached = this.queueUrls.get(name);
    if (cached) return cached;
    const url = await catalog.resolveQueueUrl(client, name);
    this.queueUrls.set(name, url);
    return url;
  }

  async describe(): Promise<ObjectMeta> {
    // §8.9 has no column/FK navigation for streams — never reached by a 'stream' tab.
    throw new AdapterError('E_UNSUPPORTED', 'describe is not supported for sqs');
  }

  async definition(path: NodePath): Promise<ObjectDefinition> {
    const client = this.requireClient();
    const queueName = this.resolveQueueTarget(path);
    const queueUrl = await this.resolveQueueUrl(client, queueName);
    return buildQueueDefinition(client, queueUrl, queueName);
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const client = this.requireClient();
    const queueUrl = await this.resolveQueueUrl(client, this.resolveQueueTarget(req.path));
    return pollQueue(client, queueUrl, req, ctx, this.receiptHandles);
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    const client = this.requireClient();
    const queueUrl = await this.resolveQueueUrl(client, this.resolveQueueTarget(req.path));
    return countQueue(client, queueUrl, ctx);
  }

  preview(plan: MutationPlan): string[] {
    const queueName = this.resolveQueueTarget(plan.path);
    return mutate.preview(plan, queueName);
  }

  async mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult> {
    const client = this.requireClient();
    const queueName = this.resolveQueueTarget(plan.path);
    const queueUrl = await this.resolveQueueUrl(client, queueName);
    return mutate.mutateQueue(
      client,
      queueUrl,
      queueName,
      this.readOnly,
      plan,
      this.receiptHandles,
      ctx,
    );
  }

  async execute(): Promise<Page[]> {
    // caps.sql === false — no console for sqs (P10's D13); never reached.
    throw new AdapterError('E_UNSUPPORTED', 'sqs has no query console');
  }

  // D14: the SDK's own abortSignal request option (passed straight through in read.ts/pollQueue)
  // is the sole cancel mechanism — this stays a permanent no-op, mirroring kafka's own cancel().
  async cancel(): Promise<boolean> {
    return false;
  }

  private requireClient(): SQSClient {
    if (!this.client) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.client;
  }

  private resolveQueueTarget(path: NodePath): string {
    const [queueSegment] = path.segments;
    if (queueSegment?.kind !== 'queue') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `read requires a queue path, got: ${encodePath(path.segments)}`,
      );
    }
    return queueSegment.name;
  }
}

export function createSqsAdapter(deps: AdapterDeps): Adapter {
  return new SqsAdapter(deps);
}
