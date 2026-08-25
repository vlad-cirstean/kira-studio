import type { Adapter, AdapterDeps } from '../adapter';
import { createMysqlFamilyAdapter } from '../mysql-family/index';
import type { MysqlFamilyProfile } from '../mysql-family/profile';
import { mysqlCaps } from './caps';
import { applyEngineOptions } from './client';

// P34 D7/D9: the MySQL-specific profile — everything else lives once in mysql-family/.
const mysqlProfile: MysqlFamilyProfile = {
  kind: 'mysql',
  serverLabel: 'MySQL',
  applyEngineOptions,
};

export function createMysqlAdapter(deps: AdapterDeps): Adapter {
  return createMysqlFamilyAdapter(deps, mysqlProfile, mysqlCaps);
}
