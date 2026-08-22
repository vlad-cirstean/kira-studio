import type { ConnectionInput, ConnectionKind } from './connection';

export interface ParsedUri {
  scheme: string;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  password: string | null;
  params: Record<string, string>;
}

export function parseConnectionUri(uri: string): ParsedUri | null {
  try {
    const url = new URL(uri);
    const scheme = url.protocol.replace(/:$/, '');
    const database = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams) params[key] = value;
    return {
      scheme,
      host: url.hostname || null,
      port: url.port ? Number(url.port) : null,
      database: database || null,
      username: url.username ? decodeURIComponent(url.username) : null,
      password: url.password ? decodeURIComponent(url.password) : null,
      params,
    };
  } catch {
    return null;
  }
}

export function formatConnectionUri(input: Omit<ConnectionInput, 'uri' | 'mode'>): string {
  const scheme = input.kind === 'postgres' ? 'postgresql' : input.kind;
  const url = new URL(`${scheme}://placeholder`);
  url.hostname = input.host ?? '';
  if (input.port) url.port = String(input.port);
  if (input.username) url.username = encodeURIComponent(input.username);
  if (input.password) url.password = encodeURIComponent(input.password);
  url.pathname = input.database ? `/${input.database}` : '';
  for (const [key, value] of Object.entries(input.options)) {
    if (typeof value === 'string') url.searchParams.set(key, value);
  }
  return url.toString();
}

// D7: strip the userinfo password out of a URI at save time; the extracted password
// goes to the SecretStore, and the stored `uri` column is safe to hand to the renderer verbatim.
export function stripUriPassword(uri: string): { uri: string; password: string | null } {
  try {
    const url = new URL(uri);
    const password = url.password ? decodeURIComponent(url.password) : null;
    url.password = '';
    return { uri: url.toString(), password };
  } catch {
    return { uri, password: null };
  }
}

export function injectUriPassword(uri: string, password: string | null): string {
  if (!password) return uri;
  try {
    const url = new URL(uri);
    url.password = encodeURIComponent(password);
    return url.toString();
  } catch {
    return uri;
  }
}

// False for: a non-postgres scheme, multi-host (comma in the host section), a unix-socket
// path host, or userinfo that would not survive an encodeURIComponent round trip. When false,
// the connection dialog stays in URI mode (§8.12) rather than silently dropping information.
export function canRoundTripToFields(parsed: ParsedUri, kind: ConnectionKind): boolean {
  if (kind !== 'postgres') return false;
  if (parsed.scheme !== 'postgres' && parsed.scheme !== 'postgresql') return false;
  if (!parsed.host || parsed.host.includes(',') || parsed.host.startsWith('/')) return false;
  for (const value of [parsed.username, parsed.password]) {
    if (value === null) continue;
    try {
      if (decodeURIComponent(encodeURIComponent(value)) !== value) return false;
    } catch {
      return false;
    }
  }
  return true;
}
