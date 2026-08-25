import type { S3Client } from '@aws-sdk/client-s3';
import type { ObjectDefinition } from '../../../shared/domain/definition';
import type { MutationPlan, MutationResult } from '../../../shared/domain/mutations';
import type {
  ObjectDownloadRequest,
  ObjectTransferResult,
} from '../../../shared/domain/object-store';
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
import { AdapterError, noQueryConsole, unsupported } from '../errors';
import { s3Caps } from './caps';
import * as catalog from './catalog';
import { connectS3 } from './client';
import { mapError } from './errors';
import * as mutateOps from './mutate';
import { countObject, readObject } from './read';
import { downloadObject } from './transfer';

// Mirrors redis/index.ts closely: bucket ~ redis's database, prefix ~ redis's namespace, object ~
// redis's key — a lazy, '/'-delimited tree with the same "only the leaf opens a tab, every
// ancestor is expand-only" shape (§17's own roadmap-table tree-levels column: "account → bucket →
// prefix/object, lazy, '/'-delimited").
class S3Adapter implements Adapter {
  readonly kind = 's3' as const;
  readonly caps = s3Caps;

  private client: S3Client | null = null;
  // SPEC §6's options_json `bucket` field — set, this scopes the whole tree to one bucket (see
  // catalog.ts's listBuckets), for credentials that can only ever see that one bucket.
  private scopedBucket: string | null = null;
  private readOnly = false;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig): Promise<ConnectInfo> {
    const { client } = connectS3(cfg, this.deps.log);
    const bucket = cfg.options.bucket;
    const scopedBucket = typeof bucket === 'string' && bucket !== '' ? bucket : null;
    try {
      await catalog.listBuckets(client, scopedBucket ?? undefined);
    } catch (err) {
      client.destroy();
      throw mapError(err);
    }
    this.client = client;
    this.scopedBucket = scopedBucket;
    this.readOnly = cfg.readOnly;
    return { serverVersion: 'Amazon S3' };
  }

  async disconnect(): Promise<void> {
    this.client?.destroy();
    this.client = null;
    this.scopedBucket = null;
  }

  async children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]> {
    const segments = path.segments;
    if (segments.length === 0) {
      return catalog.listBuckets(this.requireClient(), this.scopedBucket ?? undefined);
    }

    const [bucketSegment, ...rest] = segments;
    if (bucketSegment.kind !== 'bucket') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${bucketSegment.kind}`,
      );
    }
    // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws — an 'object'
    // node never has children.
    if (rest.length > 0 && rest[rest.length - 1].kind === 'object') return [];

    const prefixSegments: string[] = [];
    for (const seg of rest) {
      if (seg.kind !== 'prefix') {
        throw new AdapterError('E_NOT_FOUND', `unexpected path segment kind: ${seg.kind}`);
      }
      prefixSegments.push(seg.name);
    }

    return catalog.listPrefixChildren(
      this.requireClient(),
      bucketSegment.name,
      prefixSegments,
      ctx,
    );
  }

  async describe(): Promise<ObjectMeta> {
    // caps.describe is false (P31 D2) — unreachable while that flag gates every caller.
    unsupported(this.kind, 'describe');
  }

  async definition(): Promise<ObjectDefinition> {
    // caps.definition === false gates §8.10's "Open definition" menu item for s3 — never reached.
    unsupported(this.kind, 'definition');
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const { bucket, key } = this.resolveObjectTarget(req.path);
    return readObject(this.requireClient(), bucket, key, ctx);
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    const { bucket, key } = this.resolveObjectTarget(req.path);
    return countObject(this.requireClient(), bucket, key, ctx);
  }

  preview(plan: MutationPlan): string[] {
    return mutateOps.preview(plan);
  }

  // A single client serves the whole bucket-rooted tree (unlike mariadb/postgres's per-database
  // connection set) — mutate.ts's own resolveBucketSegment validates plan.path, so this just
  // forwards the client and the connection's read-only flag (F1).
  async mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult> {
    return mutateOps.mutate(this.requireClient(), ctx, this.readOnly, plan);
  }

  async execute(): Promise<Page[]> {
    // caps.sql === false — no console for s3; never reached.
    noQueryConsole(this.kind);
  }

  async downloadObject(req: ObjectDownloadRequest, ctx: OpCtx): Promise<ObjectTransferResult> {
    const { bucket, key } = this.resolveObjectTarget(req.path);
    return downloadObject(this.requireClient(), bucket, key, req.destPath, ctx);
  }

  // The SDK's own abortSignal request option (passed straight through in catalog.ts/read.ts) is
  // the sole cancel mechanism — this stays a permanent no-op, mirroring sqs's/kafka's own cancel().
  async cancel(): Promise<boolean> {
    return false;
  }

  private requireClient(): S3Client {
    if (!this.client) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.client;
  }

  private resolveObjectTarget(path: NodePath): { bucket: string; key: string } {
    const segments = path.segments;
    const [bucketSegment, ...rest] = segments;
    const objectSegment = rest[rest.length - 1];
    if (bucketSegment?.kind !== 'bucket' || objectSegment?.kind !== 'object') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `read requires a bucket/.../object path, got: ${encodePath(segments)}`,
      );
    }
    // objectSegment.name is already the full key (catalog.ts encodes it that way, mirroring
    // redis/index.ts's resolveKeyTarget) — no prefix-segment joining needed.
    return { bucket: bucketSegment.name, key: objectSegment.name };
  }
}

export function createS3Adapter(deps: AdapterDeps): Adapter {
  return new S3Adapter(deps);
}
