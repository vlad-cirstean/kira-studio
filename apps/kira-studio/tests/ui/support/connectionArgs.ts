export function mongoCreateArgs(name: string) {
  return {
    name,
    kind: 'mongodb',
    color: 'green',
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 27017,
    database: 'kira_test',
    username: 'kira',
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    autoExplain: false,
    throttlePerSec: 0,
  };
}

export function redisCreateArgs(name: string) {
  return {
    name,
    kind: 'redis',
    color: 'red',
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 6379,
    database: '0',
    username: null,
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    autoExplain: false,
    throttlePerSec: 0,
  };
}

export function postgresCreateArgs(name: string, color: string) {
  return {
    name,
    kind: 'postgres',
    color,
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 5432,
    database: 'kira_test',
    username: 'postgres',
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    autoExplain: false,
    throttlePerSec: 0,
  };
}
