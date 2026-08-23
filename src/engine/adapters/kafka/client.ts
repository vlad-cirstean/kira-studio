import type { Admin } from 'kafkajs';
import { Kafka, logLevel } from 'kafkajs';
import { parseConnectionUri } from '../../../shared/domain/uri';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { mapKafkaError } from './errors';

const CONNECT_TIMEOUT_MS = 10_000;

export interface KafkaClientHandle {
  kafka: Kafka; // kept to construct ephemeral browse consumers later (read.ts)
  admin: Admin;
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
    if (!parsed?.host) throw mapKafkaError(new Error('could not parse the connection URI'));
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

  const kafka = new Kafka({
    clientId: 'kira-studio',
    brokers: [`${host}:${port}`],
    connectionTimeout: CONNECT_TIMEOUT_MS,
    logLevel: logLevel.NOTHING,
    ssl,
    sasl: username && password ? { mechanism: 'plain', username, password } : undefined,
  });

  const admin = kafka.admin();
  try {
    await admin.connect();
  } catch (err) {
    throw mapKafkaError(err);
  }

  return { kafka, admin };
}
