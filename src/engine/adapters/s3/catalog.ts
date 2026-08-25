import {
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { encodePath, type TreeNode } from '@shared/domain/tree';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { mapError } from './errors';

// Never an unbudgeted listing (ground rules, mirrors redis/catalog.ts's own SCAN_COUNT/
// MAX_SCAN_ROUNDS): ListObjectsV2's own MaxKeys default (1000) per round-trip, capped rounds —
// a call degrades to "not everything shown yet under this prefix" rather than an unbounded crawl.
const MAX_LIST_ROUNDS = 20;

// `scopedBucket` (SPEC §6's options_json `bucket` field) is the escape hatch for a very common
// IAM shape: credentials scoped to exactly one bucket, which commonly deny `s3:ListAllMyBuckets`
// outright (a permission ListBucketsCommand needs but a single-bucket policy has no reason to
// grant). HeadBucketCommand only needs access to that one bucket, so a scoped connection never
// calls ListBuckets at all — the root "listing" is just that one bucket, existence-checked.
export async function listBuckets(client: S3Client, scopedBucket?: string): Promise<TreeNode[]> {
  if (scopedBucket) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: scopedBucket }));
    } catch (err) {
      throw mapError(err);
    }
    return [
      {
        kind: 'bucket',
        name: scopedBucket,
        path: encodePath([{ kind: 'bucket', name: scopedBucket }]),
        hasChildren: true,
      },
    ];
  }
  let buckets: { Name?: string }[];
  try {
    const res = await client.send(new ListBucketsCommand({}));
    buckets = res.Buckets ?? [];
  } catch (err) {
    throw mapError(err);
  }
  return buckets
    .filter((b): b is { Name: string } => !!b.Name)
    .map((b) => ({
      kind: 'bucket' as const,
      name: b.Name,
      path: encodePath([{ kind: 'bucket', name: b.Name }]),
      hasChildren: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// §17: prefix tree from ListObjectsV2 with Delimiter — CommonPrefixes are the "folders" one level
// down, Contents (minus the exact-prefix-match "directory marker" object some tools create) are
// the leaf objects at this level. `prefixSegments` is the local segments collected while
// descending the tree, joined back into an S3 Prefix here — same discipline as redis/catalog.ts's
// own `listNamespaceChildren`, never reconstructed from a leaf.
export async function listPrefixChildren(
  client: S3Client,
  bucket: string,
  prefixSegments: string[],
  ctx: OpCtx,
): Promise<TreeNode[]> {
  const prefix = prefixSegments.length > 0 ? `${prefixSegments.join('/')}/` : '';
  const ancestor = [
    { kind: 'bucket' as const, name: bucket },
    ...prefixSegments.map((s) => ({ kind: 'prefix' as const, name: s })),
  ];
  const prefixNodes: TreeNode[] = [];
  const objectNodes: TreeNode[] = [];
  let continuationToken: string | undefined;
  let rounds = 0;

  do {
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    let commonPrefixes: { Prefix?: string }[];
    let contents: { Key?: string }[];
    try {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        }),
        { abortSignal: ctx.signal },
      );
      commonPrefixes = res.CommonPrefixes ?? [];
      contents = res.Contents ?? [];
      continuationToken = res.NextContinuationToken;
    } catch (err) {
      throw mapError(err);
    }

    for (const cp of commonPrefixes) {
      if (!cp.Prefix) continue;
      // "a/b/" -> local segment "b" (strip the parent prefix and the trailing delimiter).
      const segment = cp.Prefix.slice(prefix.length, -1);
      prefixNodes.push({
        kind: 'prefix',
        name: segment,
        path: encodePath([...ancestor, { kind: 'prefix', name: segment }]),
        hasChildren: true,
      });
    }
    for (const obj of contents) {
      if (!obj.Key || obj.Key === prefix) continue; // skip the exact-prefix "directory marker"
      objectNodes.push({
        kind: 'object',
        // The full key verbatim, not just this local segment — same split as redis/catalog.ts's
        // namespaceNodes (local segment) vs. keyNodes (full key, P9 D3): every intermediate
        // "folder" node here carries just its own segment, but the leaf carries the identifier a
        // consumer actually needs (KeyValueView.vue's header/tab title, TabStrip.vue's tab label —
        // both read straight off pathTail(path).name with no S3-specific reconstruction). The
        // encoded path's own last segment must carry the same full key, not the local segment,
        // or pathTail() hands those consumers only the last path component back.
        name: obj.Key,
        path: encodePath([...ancestor, { kind: 'object', name: obj.Key }]),
        hasChildren: false,
      });
    }
    rounds++;
  } while (continuationToken && rounds < MAX_LIST_ROUNDS);

  return [
    ...prefixNodes.sort((a, b) => a.name.localeCompare(b.name)),
    ...objectNodes.sort((a, b) => a.name.localeCompare(b.name)),
  ];
}
