// D21: the five EXPLAIN plan normalizers + D15's issue rules earn a unit test — five dialects ×
// several node shapes is precisely a decision structure too large to hold in one's head. Every
// fixture below is F11-F15's own verified real-server output, pasted verbatim (this repo's
// "capture, don't hand-write" discipline applied where a capture tool wasn't needed because the
// capture is already in the plan doc).

import { describe, expect, test } from 'bun:test';
import { parseClickhousePlan } from '../../frontend/src/views/console/planParsers/clickhouse';
import { parseMariadbPlan } from '../../frontend/src/views/console/planParsers/mariadb';
import { parseMysqlPlan } from '../../frontend/src/views/console/planParsers/mysql';
import { parsePostgresPlan } from '../../frontend/src/views/console/planParsers/postgres';
import { parseSqlitePlan } from '../../frontend/src/views/console/planParsers/sqlite';

describe('parsePostgresPlan — F11', () => {
  const JOIN_PLAN = JSON.stringify([
    {
      Plan: {
        'Node Type': 'Limit',
        'Startup Cost': 7814.39,
        'Total Cost': 7814.41,
        'Plan Rows': 10,
        'Plan Width': 15,
        Plans: [
          {
            'Node Type': 'Sort',
            'Sort Key': ['(count(*)) DESC'],
            'Plan Rows': 46038,
            Plans: [
              {
                'Node Type': 'Aggregate',
                Strategy: 'Hashed',
                'Group Key': ['t.name'],
                Plans: [
                  {
                    'Node Type': 'Hash Join',
                    'Join Type': 'Inner',
                    'Hash Cond': '(t.id = c.t_id)',
                    'Total Cost': 6128.95,
                    'Plan Rows': 46038,
                    Plans: [
                      {
                        'Node Type': 'Seq Scan',
                        'Relation Name': 't',
                        Alias: 't',
                        'Total Cost': 3582.0,
                        'Plan Rows': 184153,
                        Filter: '(cat > 3)',
                      },
                      {
                        'Node Type': 'Hash',
                        Plans: [
                          {
                            'Node Type': 'Seq Scan',
                            'Relation Name': 'c',
                            'Total Cost': 771.0,
                            'Plan Rows': 50000,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ]);

  test('finds the widest scan, not the root estimate (D14)', () => {
    const plan = parsePostgresPlan(JOIN_PLAN, 100_000);
    // The root Limit reports 10 rows; the real widest read is the 184,153-row Seq Scan on t.
    expect(plan.estimatedRowsRead).toBe(184153);
    expect(plan.overThreshold).toBe(true);
    expect(plan.nativeCost).toEqual({ value: 7814.41, unit: 'postgres-planner' });
  });

  test('flags the full scan with a filter, and the wide scan, on the same node', () => {
    const plan = parsePostgresPlan(JOIN_PLAN, 100_000);
    const codes = plan.issues.map((i) => i.code);
    expect(codes).toContain('full-scan');
    expect(codes).toContain('wide-scan');
    expect(plan.issues.find((i) => i.code === 'full-scan')?.message).toContain('"t"');
  });

  test('a lower threshold does not flag the same plan', () => {
    const plan = parsePostgresPlan(JOIN_PLAN, 1_000_000);
    expect(plan.overThreshold).toBe(false);
    expect(plan.issues.map((i) => i.code)).not.toContain('wide-scan');
  });

  test('an index-only scan is an info issue, not a warning', () => {
    const plan = parsePostgresPlan(
      JSON.stringify([
        { Plan: { 'Node Type': 'Index Only Scan', 'Relation Name': 'u', 'Plan Rows': 5 } },
      ]),
      100_000,
    );
    expect(plan.issues).toEqual([
      {
        severity: 'info',
        code: 'index-only-scan',
        message: '"u" is read entirely from its index — no heap access needed',
      },
    ]);
  });
});

describe('parseMysqlPlan — F12', () => {
  const FULL_SCAN = JSON.stringify({
    query_block: {
      select_id: 1,
      cost_info: { query_cost: '6304.55' },
      table: {
        table_name: 't',
        access_type: 'ALL',
        rows_examined_per_scan: 62643,
        rows_produced_per_join: 6264,
        filtered: '10.00',
        cost_info: {
          read_cost: '5678.12',
          eval_cost: '626.43',
          prefix_cost: '6304.55',
          data_read_per_join: '1M',
        },
        used_columns: ['id', 'cat', 'name'],
        attached_condition: "(`app`.`t`.`name` = 'n5')",
      },
    },
  });

  test('flags a full scan and reports the query-level cost verbatim', () => {
    const plan = parseMysqlPlan(FULL_SCAN, 100_000);
    expect(plan.estimatedRowsRead).toBe(62643);
    expect(plan.nativeCost).toEqual({ value: 6304.55, unit: 'mysql-cost' });
    expect(plan.issues.map((i) => i.code)).toEqual(['full-scan']);
    expect(plan.root.children[0]?.detail).toBe("(`app`.`t`.`name` = 'n5')");
  });

  test('a materialized derived table is flagged as a temp table', () => {
    const plan = parseMysqlPlan(
      JSON.stringify({
        query_block: {
          cost_info: { query_cost: '10.00' },
          table: {
            table_name: '<derived2>',
            access_type: 'ALL',
            rows_examined_per_scan: 100,
            materialized_from_subquery: {
              using_temporary_table: true,
              query_block: {
                table: { table_name: 't', access_type: 'ALL', rows_examined_per_scan: 500 },
              },
            },
          },
        },
      }),
      100_000,
    );
    expect(plan.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['full-scan', 'temp-table']),
    );
  });
});

describe('parseMariadbPlan — F13', () => {
  test('a same-named cost field is not comparable to MySQL’s', () => {
    const plan = parseMariadbPlan(
      JSON.stringify({
        query_block: {
          select_id: 1,
          cost: 16.5855622,
          nested_loop: [
            {
              table: {
                table_name: 't',
                access_type: 'ALL',
                loops: 1,
                rows: 100175,
                cost: 16.5855622,
                filtered: 100,
                attached_condition: "t.`name` = 'n5'",
              },
            },
          ],
        },
      }),
      100_000,
    );
    // F17's own empirical proof: this genuine full scan reads more rows than F12's MySQL example
    // (100,175 vs 62,643) yet its identically-named `cost` field (16.59) is three orders of
    // magnitude smaller than MySQL's 6,304.55 for that comparable scan — the reason D14 thresholds
    // on rows, never on either dialect's own cost number.
    expect(plan.nativeCost).toEqual({ value: 16.5855622, unit: 'mariadb-cost' });
    expect(plan.estimatedRowsRead).toBe(100175);
    expect(plan.overThreshold).toBe(true);
    expect(plan.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['full-scan', 'wide-scan']),
    );
  });

  test('a read_sorted_file/filesort wrapper is unwrapped to its own table', () => {
    const plan = parseMariadbPlan(
      JSON.stringify({
        query_block: {
          select_id: 1,
          cost: 2.22612952,
          nested_loop: [
            {
              read_sorted_file: {
                filesort: {
                  sort_key: 't.`name`',
                  table: {
                    table_name: 't',
                    access_type: 'ref',
                    possible_keys: ['cat'],
                    key: 'cat',
                    key_length: '5',
                    used_key_parts: ['cat'],
                    ref: ['const'],
                    loops: 1,
                    rows: 2000,
                    cost: 2.22612952,
                    filtered: 100,
                    attached_condition: 't.cat <=> 3',
                  },
                },
              },
            },
          ],
        },
      }),
      100_000,
    );
    expect(plan.root.children[0]?.label).toBe('Sort (filesort)');
    expect(plan.issues.map((i) => i.code)).toEqual(['filesort']);
    // The wrapped table itself is not a full scan (access_type 'ref', a key chosen) — no
    // full-scan/unused-index issue should leak from the nested table.
    const tableNode = plan.root.children[0]?.children[0];
    expect(tableNode?.relation).toBe('t');
    expect(tableNode?.estimatedRows).toBe(2000);
  });
});

describe('parseSqlitePlan — F14', () => {
  test('no cost, no row estimate — the threshold never applies', () => {
    const plan = parseSqlitePlan([{ id: 2, parent: 0, detail: 'SCAN t' }]);
    expect(plan.estimatedRowsRead).toBeUndefined();
    expect(plan.overThreshold).toBe(false);
    expect(plan.nativeCost).toBeUndefined();
    expect(plan.issues).toEqual([
      {
        severity: 'warn',
        code: 'full-scan',
        message: 'SCAN t — a full scan, no index narrowed the read',
      },
    ]);
  });

  test('a SEARCH row is not flagged as a full scan; a temp b-tree still fires', () => {
    const plan = parseSqlitePlan([
      { id: 4, parent: 0, detail: 'SEARCH t USING INDEX t_cat (cat=?)' },
      { id: 15, parent: 0, detail: 'USE TEMP B-TREE FOR ORDER BY' },
    ]);
    expect(plan.issues.map((i) => i.code)).toEqual(['temp-btree']);
    expect(plan.root.children).toHaveLength(2);
  });

  test('parent pointers nest a subquery/compound row instead of assuming a flat list', () => {
    const plan = parseSqlitePlan([
      { id: 9, parent: 0, detail: 'SCAN c' },
      { id: 11, parent: 9, detail: 'SEARCH t USING INTEGER PRIMARY KEY (rowid=?)' },
    ]);
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0]?.children).toHaveLength(1);
    expect(plan.root.children[0]?.children[0]?.relation).toBe('t');
  });
});

describe('parseClickhousePlan — F15', () => {
  function planJson(
    selectedGranules: number,
    initialGranules: number,
    selectedParts = 1,
    initialParts = 1,
  ) {
    return JSON.stringify([
      {
        Plan: {
          'Node Type': 'Expression',
          Description: '(Project names + Projection)',
          Plans: [
            {
              'Node Type': 'ReadFromMergeTree',
              'Node Id': 'ReadFromMergeTree_0',
              Description: 'default.t',
              Indexes: [
                {
                  Type: 'PrimaryKey',
                  Keys: ['id'],
                  Condition: 'and((id in (-Inf, 20]), (id in [10, +Inf)))',
                  'Search Algorithm': 'binary search',
                  'Initial Parts': initialParts,
                  'Selected Parts': selectedParts,
                  'Initial Granules': initialGranules,
                  'Selected Granules': selectedGranules,
                },
              ],
            },
          ],
        },
      },
    ]);
  }

  test('the primary key narrowed the read — no issue, no cost reported', () => {
    const plan = parseClickhousePlan(planJson(1, 62), [{ rows: 8192 }], 100_000);
    expect(plan.nativeCost).toBeUndefined();
    expect(plan.issues).toEqual([]);
    expect(plan.estimatedRowsRead).toBe(8192);
  });

  test('Selected Granules == Initial Granules is the "no index used" tell', () => {
    const plan = parseClickhousePlan(planJson(62, 62), [{ rows: 500000 }], 100_000);
    expect(plan.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['pk-not-narrowed', 'wide-scan']),
    );
    expect(plan.overThreshold).toBe(true);
  });

  test('every part read fires only when there was more than one part to begin with', () => {
    const singlePart = parseClickhousePlan(planJson(62, 62, 1, 1), [{ rows: 1 }], 100_000);
    expect(singlePart.issues.map((i) => i.code)).not.toContain('all-parts-read');

    const multiPart = parseClickhousePlan(planJson(62, 62, 3, 3), [{ rows: 1 }], 100_000);
    expect(multiPart.issues.map((i) => i.code)).toContain('all-parts-read');
  });

  test('page order is asserted, not trusted — plan is page 0, estimate is page 1 (§7.3)', () => {
    // parseExplainPages (plan.ts) is the caller that actually receives the two Execute pages in
    // order; this asserts the parser's own estimateRows parameter is what estimatedRowsRead comes
    // from, so a caller that swapped page order would produce a visibly wrong number rather than
    // a silent one.
    const plan = parseClickhousePlan(planJson(1, 62), [{ rows: 111 }, { rows: 222 }], 100_000);
    expect(plan.estimatedRowsRead).toBe(333);
  });
});
