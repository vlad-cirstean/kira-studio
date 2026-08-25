// P34 D7/D8: query.ts is engine-neutral (F17) — the real implementation lives once in
// mysql-family/. This re-export is what keeps tests/db/mariadb.spec.ts:7's import compiling
// unchanged, which is commit 1's own acceptance criterion (D7).
export * from '../mysql-family/query';
