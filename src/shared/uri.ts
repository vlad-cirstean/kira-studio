import type { ConnectionInput, ConnectionKind } from './connection';

// Connection-URI handling (§8.12). The WHATWG `URL` constructor parses userinfo, host, port and
// pathname for non-special schemes such as `postgres:`/`postgresql:`; its `username`/`password`/
// `pathname` getters return percent-ENCODED forms, so every read here decodes them and every write
// re-encodes through the URL setters (which percent-encode on assignment).

export interface ParsedUri {
  scheme: string;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  password: string | null;
  params: Record<string, string>;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseConnectionUri(uri: string): ParsedUri | null {
  try {
    const u = new URL(uri);
    const scheme = u.protocol.replace(/:$/, '');
    const host = u.hostname || null;
    const port = u.port ? Number(u.port) : null;
    const database = u.pathname && u.pathname !== '/' ? safeDecode(u.pathname.slice(1)) : null;
    const username = u.username ? safeDecode(u.username) : null;
    const password = u.password ? safeDecode(u.password) : null;
    const params: Record<string, string> = {};
    for (const [key, value] of u.searchParams) params[key] = value;
    return { scheme, host, port, database, username, password, params };
  } catch {
    return null;
  }
}

// Builds a URI from fields. `options` (e.g. `?sslmode=require`) survive a fields↔URI flip as
// query parameters. Only scalar option values are emitted; the rest are ignored.
export function formatConnectionUri(input: Omit<ConnectionInput, 'uri' | 'mode'>): string {
  const scheme = input.kind;
  let out = `${scheme}://`;
  const user = input.username ?? '';
  const pass = input.password ?? '';
  if (user || pass) {
    out += encodeURIComponent(user);
    if (pass) out += `:${encodeURIComponent(pass)}`;
    out += '@';
  }
  out += input.host ?? '';
  if (input.port != null) out += `:${input.port}`;
  if (input.database) out += `/${encodeURIComponent(input.database)}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input.options ?? {})) {
    if (value === null || value === undefined) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  if (query) out += `?${query}`;
  return out;
}

// D7: the stored URI must never carry a password. Returns the password-free URI and the extracted
// secret, so the caller can route the latter through the SecretStore.
export function stripUriPassword(uri: string): { uri: string; password: string | null } {
  const parsed = parseConnectionUri(uri);
  if (!parsed || parsed.password === null) return { uri, password: null };
  const u = new URL(uri);
  u.password = '';
  return { uri: u.toString(), password: parsed.password };
}

// D7: main re-injects the stored password into the password-free URI before handing it to the
// engine. A `null` password leaves the URI untouched.
export function injectUriPassword(uri: string, password: string | null): string {
  if (password === null) return uri;
  try {
    const u = new URL(uri);
    u.password = password;
    return u.toString();
  } catch {
    return uri;
  }
}

// §8.12: URI → fields is a best-effort round-trip. When it cannot round-trip, the dialog stays in
// URI mode rather than silently dropping information.
export function canRoundTripToFields(parsed: ParsedUri, kind: ConnectionKind): boolean {
  if (kind === 'postgres') {
    if (parsed.scheme !== 'postgres' && parsed.scheme !== 'postgresql') return false;
  } else if (kind === 'mariadb') {
    if (parsed.scheme !== 'mariadb' && parsed.scheme !== 'mysql') return false;
  } else {
    return false;
  }
  if (!parsed.host || parsed.host.startsWith('/')) return false; // unix socket or missing host
  if (parsed.host.includes(',')) return false; // multi-host connection string
  // Userinfo characters that are structural in a URI cannot be stored unambiguously in fields.
  for (const value of [parsed.username, parsed.password]) {
    if (value !== null && /[:/@%]/.test(value)) return false;
  }
  return true;
}
