import m0001 from './0001_init.sql?raw';

export const migrations = [{ version: 1, name: '0001_init', sql: m0001 }] as const;
