import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { encodePath, type TreeNode } from '../../../shared/domain/tree';
import { mapError } from './errors';

// Internal topics/groups (consumer offsets, transaction state, ...) are Kafka-internal
// bookkeeping, not anything a user would browse.
function isInternal(name: string): boolean {
  return name.startsWith('__');
}

// caps.ts's doc-comment table reads "cluster -> topics, consumer groups" — both are root-level
// siblings, not nested under each topic (a consumer group can span many topics, or none of the
// ones currently browsed, so nesting it under one topic would misrepresent it).
export async function listRoot(admin: KafkaJS.Admin): Promise<TreeNode[]> {
  const [topicNodes, groupNodes] = await Promise.all([listTopics(admin), listGroups(admin)]);
  return [...topicNodes, ...groupNodes];
}

// P32 D9/F15.1: fetchTopicMetadata returns the topic array directly now, not `{ topics: [...] }`
// — the array's own elements (name, partitions[].partitionId/leader/replicas/isr) kept their
// kafkajs field names in this client's own compat layer, so only the outer shape changed.
async function listTopics(admin: KafkaJS.Admin): Promise<TreeNode[]> {
  let topics: KafkaJS.ITopicMetadata[];
  try {
    topics = await admin.fetchTopicMetadata();
  } catch (err) {
    throw mapError(err);
  }
  const nodes = topics
    .filter((t) => !isInternal(t.name))
    .map((t): TreeNode => {
      const count = t.partitions.length;
      return {
        kind: 'topic',
        name: t.name,
        path: encodePath([{ kind: 'topic', name: t.name }]),
        // P23 D3: a topic no longer expands in the tree — its partitions moved into the
        // definition view. `detail` keeps the count as the tree's at-a-glance summary.
        hasChildren: false,
        detail: `${count} partition${count === 1 ? '' : 's'}`,
      };
    });
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

async function listGroups(admin: KafkaJS.Admin): Promise<TreeNode[]> {
  let groups: KafkaJS.GroupOverview[];
  try {
    ({ groups } = await admin.listGroups());
  } catch (err) {
    throw mapError(err);
  }
  const nodes = groups
    .filter((g) => !isInternal(g.groupId))
    .map(
      (g): TreeNode => ({
        kind: 'consumerGroup',
        name: g.groupId,
        path: encodePath([{ kind: 'consumerGroup', name: g.groupId }]),
        hasChildren: false,
      }),
    );
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

export async function listPartitions(admin: KafkaJS.Admin, topic: string): Promise<TreeNode[]> {
  let topics: KafkaJS.ITopicMetadata[];
  try {
    topics = await admin.fetchTopicMetadata({ topics: [topic] });
  } catch (err) {
    throw mapError(err);
  }
  const found = topics.find((t) => t.name === topic);
  return (found?.partitions ?? [])
    .slice()
    .sort((a, b) => a.partitionId - b.partitionId)
    .map((p) => ({
      kind: 'partition' as const,
      name: String(p.partitionId),
      path: encodePath([
        { kind: 'topic', name: topic },
        { kind: 'partition', name: String(p.partitionId) },
      ]),
      hasChildren: false,
    }));
}
