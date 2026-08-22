import m0001 from './0001_init.sql?raw';
import m0002 from './0002_p2.sql?raw';

export const migrations = [
  { version: 1, name: '0001_init', sql: m0001 },
  { version: 2, name: '0002_p2', sql: m0002 },
] as const;
