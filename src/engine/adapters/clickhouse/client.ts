import type { ClickHouseClient } from '@clickhouse/client';
import { parseConnectionUri } from '../../../shared/domain/uri';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { AdapterError } from '../errors';
import { mapError } from './errors';

export interface ClickHouseHandle {
  readonly client: ClickHouseClient;
  readonly url: string;
  readonly defaultDatabase: string;
  readonly readOnly: boolean;
}

// D6: a fixed clickhouse_settings block, defaults included — an unstated default is one a later
// server release can move under us. Deliberately does NOT include `readonly`: D7 sends that per
// request instead (query.ts), because it must apply to every data/console/mutation request but
// never to the KILL QUERY cancel request, and a client-level setting would apply to both alike.
//   default_format                    -> D16's read wire shape, for any request that doesn't ask
//                                         for its own format
//   output_format_json_validate_utf8  -> the EachRow JSON format family does not validate UTF-8
//                                         by default (F26); this is what stops an invalid-UTF-8
//                                         String column from breaking the response's own JSON
//   show_table_uuid_in_table_create_query_if_not_nil -> its own default (0), pinned so
//                                         definition()'s text (D22) stays re-executable rather
//                                         than carrying an Atomic-database UUID clause
//   date_time_output_format           -> the spelling the cell editor's timestamp pane parses
const FIXED_SETTINGS: Record<string, string | number> = {
  default_format: 'JSONCompactStringsEachRowWithNamesAndTypes',
  output_format_json_validate_utf8: 1,
  show_table_uuid_in_table_create_query_if_not_nil: 0,
  date_time_output_format: 'simple',
};

interface ResolvedTarget {
  scheme: 'http' | 'https';
  host: string;
  port: number;
  database: string;
  username: string | null;
  password: string | null;
}

// D12: the client's own `tls` option is `ca_cert`/`cert`/`key` Buffers with no
// `rejectUnauthorized` escape hatch (F35) — `require`/`verify-full` both just mean "speak https
// with the system trust store" here, and the plan says so rather than pretending to a
// distinction the client cannot make.
function resolveTarget(cfg: ResolvedConnectionConfig, log: AdapterDeps['log']): ResolvedTarget {
  let host: string | null;
  let port: number | null;
  let database: string | null;
  let username: string | null;
  let password: string | null;

  if (cfg.mode === 'uri' && cfg.uri) {
    const parsed = parseConnectionUri(cfg.uri);
    if (!parsed) throw new AdapterError('E_CONNECT', 'could not parse the connection URI');
    host = parsed.host;
    port = parsed.port;
    database = parsed.database;
    username = parsed.username;
    password = parsed.password;
  } else {
    host = cfg.host;
    port = cfg.port;
    database = cfg.database;
    username = cfg.username;
    password = cfg.password;
  }
  if (!host) throw new AdapterError('E_CONNECT', 'no host was given');

  // D9/D13: `options.sslmode` is read the same way regardless of fields/URI mode, mirroring
  // mysql-family/client.ts's own check — it is a first-class ResolvedConnectionConfig field, not
  // part of the parsed URI's own query string.
  let scheme: 'http' | 'https' = 'http';
  const sslmode = cfg.options.sslmode;
  if (typeof sslmode === 'string' && sslmode !== '' && sslmode !== 'disable') {
    if (sslmode === 'require' || sslmode === 'verify-full') {
      scheme = 'https';
    } else {
      log('warn', `unknown sslmode "${sslmode}", ignoring`);
    }
  }

  return { scheme, host, port: port ?? 8123, database: database ?? 'default', username, password };
}

export async function openClient(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): Promise<ClickHouseHandle> {
  const target = resolveTarget(cfg, log);
  const url = `${target.scheme}://${target.host}:${target.port}`;

  let clickhouseModule: typeof import('@clickhouse/client');
  try {
    clickhouseModule = await import('@clickhouse/client');
  } catch {
    throw new AdapterError('E_CONNECT', '@clickhouse/client failed to load');
  }

  let client: ClickHouseClient;
  try {
    client = clickhouseModule.createClient({
      url,
      username: target.username ?? undefined,
      password: target.password ?? undefined,
      database: target.database,
      application: 'kira-studio', // D13 — the ClickHouse counterpart of the other SQL adapters'
      // own connect-attribute/program-name conventions; lands in system.query_log.
      clickhouse_settings: FIXED_SETTINGS,
      // The client's own DefaultLogger otherwise writes every error straight to the console
      // (verified empirically) — the adapter surfaces failures through AdapterError already, so
      // this keeps the engine process's own log the one place errors are reported.
      log: { level: clickhouseModule.ClickHouseLogLevel.OFF },
    });
  } catch (err) {
    throw mapError(err);
  }

  return { client, url, defaultDatabase: target.database, readOnly: cfg.readOnly };
}
