import type { Admin } from 'kafkajs';
import { encodePath, type TreeNode } from '../../../shared/domain/tree';
import { mapKafkaError } from './errors';

// Internal topics/groups (consumer offsets, transaction state, ...) are Kafka-internal
// bookkeeping, not anything a user would browse.
function isInternal(name: string): boolean {
  return name.startsWith('__');
}

// caps.ts's doc-comment table reads "cluster -> topics, consumer groups" — both are root-level
// siblings, not nested under each topic (a consumer group can span many topics, or none of the
// ones currently browsed, so nesting it under one topic would misrepresent it).
export async function listRoot(admin: Admin): Promise<TreeNode[]> {
  const [topicNodes, groupNodes] = await Promise.all([listTopics(admin), listGroups(admin)]);
  return [...topicNodes, ...groupNodes];
}

async function listTopics(admin: Admin): Promise<TreeNode[]> {
  let metadata: { topics: { name: string; partitions: { partitionId: number }[] }[] };
  try {
    metadata = await admin.fetchTopicMetadata();
  } catch (err) {
    throw mapKafkaError(err);
  }
  const nodes = metadata.topics
    .filter((t) => !isInternal(t.name))
    .map((t): TreeNode => {
      const count = t.partitions.length;
      return {
        kind: 'topic',
        name: t.name,
        path: encodePath([{ kind: 'topic', name: t.name }]),
        hasChildren: true,
        detail: `${count} partition${count === 1 ? '' : 's'}`,
      };
    });
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

async function listGroups(admin: Admin): Promise<TreeNode[]> {
  let groups: { groupId: string }[];
  try {
    ({ groups } = await admin.listGroups());
  } catch (err) {
    throw mapKafkaError(err);
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

export async function listPartitions(admin: Admin, topic: string): Promise<TreeNode[]> {
  let metadata: { topics: { name: string; partitions: { partitionId: number }[] }[] };
  try {
    metadata = await admin.fetchTopicMetadata({ topics: [topic] });
  } catch (err) {
    throw mapKafkaError(err);
  }
  const found = metadata.topics.find((t) => t.name === topic);
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
