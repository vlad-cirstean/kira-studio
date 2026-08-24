import {
  type Admin,
  ConfigResourceTypes,
  type GroupDescription,
  type ITopicMetadata,
} from 'kafkajs';
import type { DefinitionSection, ObjectDefinition } from '../../../shared/domain/definition';
import { encodePath } from '../../../shared/domain/tree';
import { AdapterError } from '../errors';
import { mapKafkaError } from './errors';

// P23 D5: where a topic's/group's partition and member data went once the tree stopped showing it
// (P19's "relocation, not deletion" ground rule, F4). Every value here is already typed in the
// installed kafkajs — no new dependency, no new round trip beyond what the user's own open costs.

const SENSITIVE_MASK = '••••';

export async function buildTopicDefinition(admin: Admin, topic: string): Promise<ObjectDefinition> {
  let metadata: { topics: ITopicMetadata[] };
  try {
    metadata = await admin.fetchTopicMetadata({ topics: [topic] });
  } catch (err) {
    throw mapKafkaError(err);
  }
  const partitions = (metadata.topics.find((t) => t.name === topic)?.partitions ?? [])
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

  // describeConfigs needs DESCRIBE_CONFIGS, a separate ACL from the one that let the user browse
  // and read the topic — a cluster that denies it must still open the tab with the Partitions
  // section it does have, rather than fail the whole load over one degraded section (D5).
  let configSection: DefinitionSection = { title: 'Configuration', rows: [] };
  const notes: string[] = [];
  try {
    const configResp = await admin.describeConfigs({
      resources: [{ type: ConfigResourceTypes.TOPIC, name: topic }],
      includeSynonyms: false,
    });
    const entries = (configResp.resources[0]?.configEntries ?? [])
      .slice()
      .sort((a, b) => a.configName.localeCompare(b.configName));
    configSection = {
      title: 'Configuration',
      rows: entries.map((e) => ({
        name: e.configName,
        // A sensitive entry's real value never reaches the wire (P1 D9 — a secret needs an
        // explicit, logged path; a definition pane opened to check retention settings is not one).
        value: e.isSensitive ? SENSITIVE_MASK : e.configValue,
        detail: e.isDefault ? 'default' : null,
      })),
    };
  } catch {
    notes.push('Topic configuration could not be read (DESCRIBE_CONFIGS denied or unavailable).');
  }

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
  admin: Admin,
  groupId: string,
): Promise<ObjectDefinition> {
  let group: GroupDescription | undefined;
  try {
    ({
      groups: [group],
    } = await admin.describeGroups([groupId]));
  } catch (err) {
    throw mapKafkaError(err);
  }
  if (!group) throw new AdapterError('E_NOT_FOUND', `consumer group not found: ${groupId}`);

  const groupSection: DefinitionSection = {
    title: 'Group',
    rows: [
      { name: 'state', value: group.state, detail: null },
      { name: 'protocolType', value: group.protocolType || '—', detail: null },
      { name: 'protocol', value: group.protocol || '—', detail: null },
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

  const doc = {
    state: group.state,
    protocolType: group.protocolType,
    protocol: group.protocol,
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
