import { KafkaJS } from '@confluentinc/kafka-javascript';
import { parseConnectionUri } from '@shared/domain/uri';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { mapError } from './errors';

const CONNECT_TIMEOUT_MS = 10_000;

// P32 D12: one raw-librdkafka-property config, built once, shared by every client this adapter
// creates — the compat Admin (catalog/definition/watermarks), the compat Producer (mutate), and
// the native browse consumer (read.ts, D19). Both the compat and native APIs accept raw
// librdkafka properties outside a `kafkaJS` block (MIGRATION.md:114), so there is one config
// vocabulary in this file instead of two. `GlobalConfig`/`ConsumerGlobalConfig`/
// `ProducerConstructorConfig` each type specific keys with narrow literal unions
// (`"security.protocol"?: 'plaintext' | 'ssl' | ...`), so a plain indexed Record does not
// structurally satisfy any of them — each construction site casts once, deliberately, rather
// than this type chasing three different generated interfaces.
export type RdConfig = Readonly<Record<string, string | number | boolean>>;

export interface KafkaClientHandle {
  readonly rdConfig: RdConfig;
  /** KafkaJS-compat factory — producers only (D11); the browse consumer is native (D19). */
  readonly kafka: KafkaJS.Kafka;
  readonly admin: KafkaJS.Admin;
  /** The configured bootstrap-address count, not a live cluster-wide broker enumeration — no
   *  compat or native admin call exposes broker metadata (verified against both the KafkaJS
   *  d.ts's `Admin` type and the native `IAdminClient`, neither has a `getMetadata()`), and this
   *  app's connection form only ever produces one bootstrap address. `details` is free-form and
   *  currently unread by the renderer (P32 D13) — worth a real live-broker call the day it is. */
  readonly brokerCount: number;
}

// One long-lived Admin client per adapter instance (reality #10, mirrors mongo/client.ts's single
// pooled client) — browse consumers are separate and fully ephemeral (P10's D6), so there is no
// ConnectionSet/LRU analog to build here.
export async function connectKafka(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): Promise<KafkaClientHandle> {
  let host: string;
  let port: number;
  let username: string | null;
  let password: string | null;

  if (cfg.mode === 'uri' && cfg.uri) {
    const parsed = parseConnectionUri(cfg.uri);
    if (!parsed?.host) throw mapError(new Error('could not parse the connection URI'));
    host = parsed.host;
    port = parsed.port ?? 9092;
    username = parsed.username;
    password = parsed.password;
  } else {
    host = cfg.host ?? 'localhost';
    port = cfg.port ?? 9092;
    username = cfg.username;
    password = cfg.password;
  }

  const sslmode = cfg.options.sslmode;
  let ssl = false;
  if (typeof sslmode === 'string' && sslmode !== 'disable') {
    if (sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-full') {
      ssl = true;
    } else {
      log('warn', `kafka: unknown sslmode "${sslmode}", ignoring`);
    }
  }

  const sasl = !!(username && password);
  const bootstrapServers = `${host}:${port}`;
  const rdConfig: RdConfig = {
    'bootstrap.servers': bootstrapServers,
    'client.id': 'kira-studio',
    'socket.connection.setup.timeout.ms': CONNECT_TIMEOUT_MS,
    // P32 §6/§9 Q3: kept at today's semantics deliberately (every non-'disable' mode verifies) —
    // matching libpq's own `require` (no verification) would be a security-relevant behaviour
    // change, and a driver swap is the wrong commit to smuggle one into.
    'security.protocol': sasl ? (ssl ? 'sasl_ssl' : 'sasl_plaintext') : ssl ? 'ssl' : 'plaintext',
    ...(sasl
      ? {
          'sasl.mechanism': 'PLAIN',
          'sasl.username': username as string,
          'sasl.password': password as string,
        }
      : {}),
  };

  const kafka = new KafkaJS.Kafka(rdConfig as never);
  const admin = kafka.admin();
  try {
    await admin.connect();
    // P32 D13/F16: admin.connect() alone proves nothing about broker reachability — it resolves
    // on the 'ready' event of a synchronously-created librdkafka handle, not a round trip. This
    // bounded probe is what surfaces a wrong host/port as E_CONNECT here, rather than silently
    // "connecting" and only failing on the first tree expand.
    await admin.listTopics({ timeout: CONNECT_TIMEOUT_MS });
  } catch (err) {
    await admin.disconnect().catch(() => {});
    throw mapError(err);
  }

  return {
    rdConfig,
    kafka,
    admin,
    brokerCount: bootstrapServers.split(',').length,
  };
}
