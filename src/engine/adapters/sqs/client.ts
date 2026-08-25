import { SQSClient, type SQSClientConfig } from '@aws-sdk/client-sqs';
import { fromIni } from '@aws-sdk/credential-providers';
import { parseConnectionUri } from '@shared/domain/uri';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { mapError } from './errors';

type Credentials = SQSClientConfig['credentials'];

// D8/D9: fields mode repurposes `database` for the AWS region and `username` for the named AWS
// profile (§5.1's "Authentication is by named AWS profile" wording) — `fromIni({ profile })` is
// the only way to resolve a *specific* named profile by name; the SDK's plain default provider
// chain does not let a user pick one. URI mode carries static keys directly
// (`sqs://accessKeyId:secretAccessKey@region`, per the same paragraph's URI-mode exception).
// `options.endpoint` (either mode) overrides the endpoint — required for LocalStack testing, and
// legitimate for any SQS-compatible non-AWS target in real usage.
export function connectSqs(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): { client: SQSClient } {
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
  if (hasEndpointOverride) log('info', `sqs: overriding endpoint to ${endpoint}`);

  const client = new SQSClient({
    region,
    credentials,
    ...(hasEndpointOverride ? { endpoint } : {}),
  });

  return { client };
}
