import type { Adapter, AdapterDeps } from '../adapter';
import { createMysqlFamilyAdapter } from '../mysql-family/index';
import type { MysqlFamilyProfile } from '../mysql-family/profile';
import { mariadbCaps } from './caps';
import { applyEngineOptions } from './client';

// P34 D7/D9: the MariaDB-specific profile — everything else lives once in mysql-family/.
const mariadbProfile: MysqlFamilyProfile = {
  kind: 'mariadb',
  serverLabel: 'MariaDB',
  applyEngineOptions,
};

export function createMariaDbAdapter(deps: AdapterDeps): Adapter {
  return createMysqlFamilyAdapter(deps, mariadbProfile, mariadbCaps);
}
