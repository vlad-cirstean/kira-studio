import { GetQueueUrlCommand, ListQueuesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { encodePath, type TreeNode } from '../../../shared/domain/tree';
import { mapSqsError } from './errors';

const PAGE_LIMIT = 1000; // ListQueues's own max MaxResults per call

// §5.1's sqs row: tree is a flat queue list, no deeper level. `name` is the URL's last path
// segment (the queue name); the full URL is recovered at read time via listQueues's own lookup
// (read.ts/index.ts resolve a leaf's name back to a URL by re-listing, mirroring how every other
// adapter's tree node carries only a display name, never a resolved handle).
export async function listQueues(client: SQSClient): Promise<TreeNode[]> {
  const nodes: TreeNode[] = [];
  let nextToken: string | undefined;
  do {
    let result: { QueueUrls?: string[]; NextToken?: string };
    try {
      result = await client.send(
        new ListQueuesCommand({ MaxResults: PAGE_LIMIT, NextToken: nextToken }),
      );
    } catch (err) {
      throw mapSqsError(err);
    }
    for (const url of result.QueueUrls ?? []) {
      const name = url.slice(url.lastIndexOf('/') + 1);
      nodes.push({
        kind: 'queue',
        name,
        path: encodePath([{ kind: 'queue', name }]),
        hasChildren: false,
      });
    }
    nextToken = result.NextToken;
  } while (nextToken);

  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

/** Resolves a queue's leaf `name` back to its full URL — GetQueueUrl is a single cheap call. */
export async function resolveQueueUrl(client: SQSClient, name: string): Promise<string> {
  try {
    const result = await client.send(new GetQueueUrlCommand({ QueueName: name }));
    if (!result.QueueUrl) throw new Error(`queue not found: ${name}`);
    return result.QueueUrl;
  } catch (err) {
    throw mapSqsError(err);
  }
}
