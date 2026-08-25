import { GetQueueUrlCommand, ListQueuesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { encodePath, type TreeNode } from '@shared/domain/tree';
import { mapError } from './errors';

const PAGE_LIMIT = 1000; // ListQueues's own max MaxResults per call

export interface QueueListing {
  nodes: TreeNode[];
  /** Name -> URL, surfaced so index.ts's queueUrls cache can populate itself for free (D14). */
  urlByName: Map<string, string>;
}

// §5.1's sqs row: tree is a flat queue list, no deeper level. `name` is the URL's last path
// segment (the queue name); listQueues already has every queue's full URL in hand while paging,
// so it hands the name->URL map back instead of discarding it — index.ts caches it, avoiding a
// GetQueueUrl round trip on every read()/count() (D14, fixes F14/F22).
export async function listQueues(client: SQSClient): Promise<QueueListing> {
  const nodes: TreeNode[] = [];
  const urlByName = new Map<string, string>();
  let nextToken: string | undefined;
  do {
    let result: { QueueUrls?: string[]; NextToken?: string };
    try {
      result = await client.send(
        new ListQueuesCommand({ MaxResults: PAGE_LIMIT, NextToken: nextToken }),
      );
    } catch (err) {
      throw mapError(err);
    }
    for (const url of result.QueueUrls ?? []) {
      const name = url.slice(url.lastIndexOf('/') + 1);
      urlByName.set(name, url);
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
  return { nodes, urlByName };
}

/** Resolves a queue's leaf `name` back to its full URL — GetQueueUrl is a single cheap call. */
export async function resolveQueueUrl(client: SQSClient, name: string): Promise<string> {
  try {
    const result = await client.send(new GetQueueUrlCommand({ QueueName: name }));
    if (!result.QueueUrl) throw new Error(`queue not found: ${name}`);
    return result.QueueUrl;
  } catch (err) {
    throw mapError(err);
  }
}
