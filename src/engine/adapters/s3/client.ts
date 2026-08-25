import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { parseConnectionUri } from '../../../shared/domain/uri';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { mapError } from './errors';

type Credentials = S3ClientConfig['credentials'];

// Mirrors sqs/client.ts exactly (same D8/D9 fields-mode repurposing of database→region,
// username→named profile; same URI-mode static-key exception; same `options.endpoint` override
// for LocalStack/MinIO/any S3-compatible target). `forcePathStyle` is turned on automatically
// whenever an endpoint override is present — a non-AWS S3-compatible endpoint almost always
// needs path-style addressing (`endpoint/bucket/key`) since it has no per-bucket DNS/TLS setup
// for AWS's usual virtual-hosted form (`bucket.endpoint/key`), and turning it on has no effect
// against real AWS S3 when no override is set.
export function connectS3(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): { client: S3Client } {
  let region: string;
  let credentials: Credentials;

  if (cfg.mode === 'uri' && cfg.uri) {
    const parsed = parseConnectionUri(cfg.uri);
    if (!parsed?.host) throw mapError(new Error('could not parse the connection URI'));
    region = parsed.host;
    credentials =
      parsed.username && parsed.password
        ? { accessKeyId: parsed.username, secretAccessKey: parsed.password }
        : undefined;
  } else {
    if (!cfg.database) throw mapError(new Error('a region is required (the "database" field)'));
    region = cfg.database;
    credentials = cfg.username ? fromIni({ profile: cfg.username }) : undefined;
  }

  const endpoint = cfg.options.endpoint;
  const hasEndpointOverride = typeof endpoint === 'string' && endpoint !== '';
  if (hasEndpointOverride) log('info', `s3: overriding endpoint to ${endpoint}`);

  const client = new S3Client({
    region,
    credentials,
    ...(hasEndpointOverride ? { endpoint, forcePathStyle: true } : {}),
  });

  return { client };
}
