import m0001 from './0001_init.sql?raw';
import m0002 from './0002_p2.sql?raw';
import m0003 from './0003_p11.sql?raw';
import m0004 from './0004_misc_fixes.sql?raw';
import m0005 from './0005_p28_tree_filters.sql?raw';

export const migrations = [
  { version: 1, name: '0001_init', sql: m0001 },
  { version: 2, name: '0002_p2', sql: m0002 },
  { version: 3, name: '0003_p11', sql: m0003 },
  { version: 4, name: '0004_misc_fixes', sql: m0004 },
  { version: 5, name: '0005_p28_tree_filters', sql: m0005 },
] as const;
