import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { ConsumerGroupStates, ConsumerGroupTypes } from '@confluentinc/kafka-javascript';
import type { DefinitionSection, ObjectDefinition } from '../../../shared/domain/definition';
import { encodePath } from '../../../shared/domain/tree';
import { AdapterError } from '../errors';
import { mapKafkaError } from './errors';

// P23 D5: where a topic's/group's partition and member data went once the tree stopped showing it
// (P19's "relocation, not deletion" ground rule, F4). Every value here is already typed in the
// installed client — no new dependency, no new round trip beyond what the user's own open costs.

// P32 D15: this client's GroupDescription types state/type as numeric enums
// (ConsumerGroupStates/ConsumerGroupTypes), not kafkajs's plain strings — rendering the number
// would be a regression, so both get a name lookup rather than `String(state)`. The runtime
// objects behind these `.d.ts` enum declarations are plain one-way name->number maps (no reverse
// mapping the way a real TS-compiled enum would have — verified against lib/admin.js), so the
// reverse lookup is built here rather than indexed directly.
function reverseLookup(source: Record<string, unknown>): Map<number, string> {
  const map = new Map<number, string>();
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'number') map.set(value, name);
  }
  return map;
}
const STATE_NAMES = reverseLookup(ConsumerGroupStates);
const TYPE_NAMES = reverseLookup(ConsumerGroupTypes);

function groupStateName(state: ConsumerGroupStates): string {
  return STATE_NAMES.get(state) ?? `unknown (${state})`;
}
function groupTypeName(type: ConsumerGroupTypes): string {
  return TYPE_NAMES.get(type) ?? `unknown (${type})`;
}

export async function buildTopicDefinition(
  admin: KafkaJS.Admin,
  topic: string,
): Promise<ObjectDefinition> {
  let topics: KafkaJS.ITopicMetadata[];
  try {
    topics = await admin.fetchTopicMetadata({ topics: [topic] });
  } catch (err) {
    throw mapKafkaError(err);
  }
  const partitions = (topics.find((t) => t.name === topic)?.partitions ?? [])
    .slice()
    .sort((a, b) => a.partitionId - b.partitionId);

  const partitionsSection: DefinitionSection = {
    title: 'Partitions',
    rows: partitions.map((p) => ({
      name: String(p.partitionId),
      value: `leader ${p.leader}`,
      detail: `replicas ${p.replicas.join(',')} · isr ${p.isr.join(',')}`,
    })),
  };

  // P32 D14/F11: this client has no describeConfigs and no describeCluster — not on the compat
  // Admin, not on the native AdminClient either (grep describeconfig/clusterid over the package
  // finds nothing but two prose mentions of the broker-side API). The section stays, rendered
  // empty, with a note saying why — the same degradation shape the old DESCRIBE_CONFIGS-denied
  // path already used (a missing section must not fail the whole tab), just permanent now rather
  // than ACL-dependent. librdkafka's C API has rd_kafka_DescribeConfigs; this binding simply does
  // not wrap it, so this can come back from upstream without any change here.
  const configSection: DefinitionSection = { title: 'Configuration', rows: [] };
  const notes: string[] = [
    'Topic configuration is not available: this Kafka client has no DescribeConfigs call.',
  ];

  const doc = {
    partitions: partitions.map((p) => ({
      id: p.partitionId,
      leader: p.leader,
      replicas: p.replicas,
      isr: p.isr,
    })),
    config: configSection.rows.map((r) => ({
      name: r.name,
      value: r.value,
      default: r.detail === 'default',
    })),
  };

  return {
    path: encodePath([{ kind: 'topic', name: topic }]),
    kind: 'topic',
    qualifiedName: topic,
    language: 'json',
    statements: [JSON.stringify(doc, null, 2)],
    origin: 'server',
    notes,
    constraints: [],
    documentSchema: null,
    sections: [partitionsSection, configSection],
    generatedAt: new Date().toISOString(),
  };
}

export async function buildGroupDefinition(
  admin: KafkaJS.Admin,
  groupId: string,
): Promise<ObjectDefinition> {
  // GroupDescription isn't itself re-exported from the kafkajs compat surface (only the plural
  // GroupDescriptions is) — pull the element type out rather than reaching into ./rdkafka directly.
  let group: KafkaJS.GroupDescriptions['groups'][number] | undefined;
  try {
    ({
      groups: [group],
    } = await admin.describeGroups([groupId]));
  } catch (err) {
    throw mapKafkaError(err);
  }
  if (!group) throw new AdapterError('E_NOT_FOUND', `consumer group not found: ${groupId}`);

  // P32 D15: partitionAssignor and coordinator are new in this client's GroupDescription — worth
  // a row each, since a Kafka 4 client's group view is exactly where "classic vs KIP-848 consumer
  // protocol" and "which broker owns this group" belong.
  const groupSection: DefinitionSection = {
    title: 'Group',
    rows: [
      { name: 'state', value: groupStateName(group.state), detail: null },
      { name: 'type', value: groupTypeName(group.type), detail: null },
      { name: 'protocolType', value: group.protocolType || '—', detail: null },
      { name: 'protocol', value: group.protocol || '—', detail: null },
      { name: 'partitionAssignor', value: group.partitionAssignor || '—', detail: null },
      {
        name: 'coordinator',
        value: `${group.coordinator.host}:${group.coordinator.port}`,
        detail: null,
      },
      { name: 'members', value: String(group.members.length), detail: null },
    ],
  };

  const membersSection: DefinitionSection = {
    title: 'Members',
    rows: group.members.map((m) => ({
      name: m.clientId,
      value: m.clientHost,
      detail: m.memberId,
    })),
  };

  // fetchOffsets is a second, independent call — a group with read access but no offset-fetch
  // permission still shows its Group/Members sections rather than failing the whole load.
  let offsetsSection: DefinitionSection = { title: 'Committed offsets', rows: [] };
  const notes: string[] = [];
  try {
    const offsets = await admin.fetchOffsets({ groupId });
    offsetsSection = {
      title: 'Committed offsets',
      rows: offsets.flatMap((t) =>
        t.partitions
          .slice()
          .sort((a, b) => a.partition - b.partition)
          .map((p) => ({ name: `${t.topic}[${p.partition}]`, value: p.offset, detail: null })),
      ),
    };
  } catch {
    notes.push('Committed offsets could not be read.');
  }

  // P32 D15: doc mirrors groupSection's human-readable values for state/type, not the raw numeric
  // enum — unlike a topic's partition leader/replica ids (already meaningful integers), a bare
  // state/type number in the JSON statements view would be opaque without cross-referencing
  // ConsumerGroupStates/ConsumerGroupTypes.
  const doc = {
    state: groupStateName(group.state),
    type: groupTypeName(group.type),
    protocolType: group.protocolType,
    protocol: group.protocol,
    partitionAssignor: group.partitionAssignor,
    coordinator: { host: group.coordinator.host, port: group.coordinator.port },
    members: group.members.map((m) => ({
      clientId: m.clientId,
      clientHost: m.clientHost,
      memberId: m.memberId,
    })),
    offsets: offsetsSection.rows,
  };

  return {
    path: encodePath([{ kind: 'consumerGroup', name: groupId }]),
    kind: 'consumerGroup',
    qualifiedName: groupId,
    language: 'json',
    statements: [JSON.stringify(doc, null, 2)],
    origin: 'server',
    notes,
    constraints: [],
    documentSchema: null,
    sections: [groupSection, membersSection, offsetsSection],
    generatedAt: new Date().toISOString(),
  };
}
