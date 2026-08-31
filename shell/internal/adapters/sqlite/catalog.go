package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// QueryExecutor is catalog.ts's own QueryExecutor: every catalog query is routed through it so it
// stays command-logged and cancellation-checked like any other query (F17's own comment). scan is
// called once per row.
type QueryExecutor func(query string, params []any, scan func(*sql.Rows) error) error

// execFor binds one conn/op pair — ctx is always the adapter-owned driverCtx (adapter.go's
// runOnConn), never the op's own context (B8).
func execFor(ctx context.Context, conn *sql.Conn, op *adapters.OpCtx) QueryExecutor {
	return func(query string, params []any, scan func(*sql.Rows) error) error {
		return runRows(ctx, conn, query, params, op, false, scan)
	}
}

// QualifiedName is the sqlite analogue of mysqlfamily's own QualifiedName.
type QualifiedName struct {
	Database string `json:"database"`
	Table    string `json:"table"`
}

// listDatabases is catalog.ts's listDatabases — D19: the tree's one "schema" level, read from
// `PRAGMA database_list` rather than hardcoded. `temp` is always present and never has anything a
// user put there; Kira never issues ATTACH, so in practice this is always exactly one `main` row.
func listDatabases(exec QueryExecutor) ([]model.TreeNode, error) {
	var nodes []model.TreeNode
	err := exec("PRAGMA database_list", nil, func(rows *sql.Rows) error {
		var seq int
		var name string
		var file sql.NullString
		if err := rows.Scan(&seq, &name, &file); err != nil {
			return err
		}
		if name == "temp" {
			return nil
		}
		var detail *string
		if file.Valid && file.String != "" {
			base := filepath.Base(file.String)
			detail = &base
		}
		nodes = append(nodes, model.TreeNode{
			Kind: "database", Name: name,
			Path:        model.EncodePath([]model.PathSegment{{Kind: "database", Name: name}}),
			HasChildren: true, Detail: detail,
		})
		return nil
	})
	return nodes, err
}

type tableListRow struct {
	schema string
	name   string
	typ    string
}

// relevantTables is catalog.ts's own — F17/F24: a `shadow` row is FTS5/RTREE/etc.'s own internal
// bookkeeping table, never shown, the same discipline mysql-family/catalog.go applies to
// information_schema/performance_schema/mysql/sys. `sqlite_`-prefixed names are SQLite's own,
// hidden the same way. A `virtual` table (FTS5, RTREE, ...) reads through SELECT like any other and
// is shown as a plain table.
func relevantTables(exec QueryExecutor, schema string) ([]tableListRow, error) {
	var rows []tableListRow
	err := exec("PRAGMA table_list", nil, func(r *sql.Rows) error {
		var rowSchema, name, typ string
		var ncol, wr, strict int
		if err := r.Scan(&rowSchema, &name, &typ, &ncol, &wr, &strict); err != nil {
			return err
		}
		if rowSchema != schema || typ == "shadow" || strings.HasPrefix(name, "sqlite_") {
			return nil
		}
		rows = append(rows, tableListRow{schema: rowSchema, name: name, typ: typ})
		return nil
	})
	return rows, err
}

// statsQueryFailed is catalog.ts's own — a never-ANALYZEd database has no sqlite_stat1 *table* at
// all, not merely an empty one; the fixed-literal, no-params query below (the only way it can fail)
// throws E_QUERY for it. That is a real, not hypothetical, hole: it took tree enumeration itself
// down before this check existed (P57 e2e-revisit §7 item 1). Absent estimates is exactly what the
// empty-map/nil return already means for every table stat1 has no row for, so the missing-table
// case is handled the same way, not treated as an error.
func statsQueryFailed(err error) bool {
	code, ok := adapters.CodeOf(err)
	return ok && code == adapters.CodeQuery
}

// loadRowEstimates is catalog.ts's own bulk fetch — F20: taking the max across every stat1 row for
// a table is correct whether the row came from a bare-table stat or a full/partial index's stat (a
// partial index's row can only ever be an undercount, never an overcount).
func loadRowEstimates(exec QueryExecutor) (map[string]int64, error) {
	byTable := make(map[string]int64)
	err := exec("SELECT tbl, stat FROM sqlite_stat1", nil, func(r *sql.Rows) error {
		var tbl, stat string
		if err := r.Scan(&tbl, &stat); err != nil {
			return err
		}
		n, err := strconv.ParseInt(strings.SplitN(stat, " ", 2)[0], 10, 64)
		if err != nil {
			return nil
		}
		if prev, ok := byTable[tbl]; !ok || n > prev {
			byTable[tbl] = n
		}
		return nil
	})
	if err != nil {
		if statsQueryFailed(err) {
			return map[string]int64{}, nil
		}
		return nil, err
	}
	return byTable, nil
}

// getRowEstimateFor is describe()'s single-table counterpart to loadRowEstimates' bulk fetch — same
// max-across-stat1-rows logic (F20), scoped to one table.
func getRowEstimateFor(exec QueryExecutor, table string) (*int, error) {
	var best *int64
	err := exec("SELECT tbl, stat FROM sqlite_stat1 WHERE tbl = ?", []any{table}, func(r *sql.Rows) error {
		var tbl, stat string
		if err := r.Scan(&tbl, &stat); err != nil {
			return err
		}
		n, perr := strconv.ParseInt(strings.SplitN(stat, " ", 2)[0], 10, 64)
		if perr != nil {
			return nil
		}
		if best == nil || n > *best {
			best = &n
		}
		return nil
	})
	if err != nil {
		if statsQueryFailed(err) {
			return nil, nil
		}
		return nil, err
	}
	if best == nil {
		return nil, nil
	}
	v := int(*best)
	return &v, nil
}

// listTablesAndViews is catalog.ts's own — §5.1: database -> tables/views -> column. No routine
// level (SQLite has no stored routines) and no sequence kind (SQLite has no SEQUENCE engine).
func listTablesAndViews(exec QueryExecutor, schema string) ([]model.TreeNode, error) {
	tables, err := relevantTables(exec, schema)
	if err != nil {
		return nil, err
	}
	estimates, err := loadRowEstimates(exec)
	if err != nil {
		return nil, err
	}

	sort.SliceStable(tables, func(i, j int) bool {
		rank := func(t string) int {
			if t == "view" {
				return 1
			}
			return 0
		}
		ri, rj := rank(tables[i].typ), rank(tables[j].typ)
		if ri != rj {
			return ri < rj
		}
		return tables[i].name < tables[j].name
	})

	nodes := make([]model.TreeNode, len(tables))
	for i, row := range tables {
		kind := "table"
		if row.typ == "view" {
			kind = "view"
		}
		var detail *string
		if kind == "table" {
			if n, ok := estimates[row.name]; ok {
				d := "~" + abbreviateCount(n) + " rows"
				detail = &d
			}
		}
		nodes[i] = model.TreeNode{
			Kind: kind, Name: row.name,
			Path: model.EncodePath([]model.PathSegment{
				{Kind: "database", Name: schema}, {Kind: kind, Name: row.name},
			}),
			// P19 D5: every relation is a leaf — a table/view's columns live in the definition view.
			HasChildren: false, Detail: detail,
		}
	}
	return nodes, nil
}

type tableXInfoRow struct {
	cid     int
	name    string
	typ     string
	notnull int
	dflt    sql.NullString
	pk      int
	hidden  int
}

func scanXInfoRow(r *sql.Rows) (tableXInfoRow, error) {
	var row tableXInfoRow
	if err := r.Scan(&row.cid, &row.name, &row.typ, &row.notnull, &row.dflt, &row.pk, &row.hidden); err != nil {
		return tableXInfoRow{}, err
	}
	return row, nil
}

// listColumns is catalog.ts's own — F18: `table_xinfo`, not `table_info` — the latter omits
// generated columns that `SELECT *` still returns. hidden 1 marks a virtual table's shadow-only
// column (excluded); hidden 0/2/3 (ordinary / VIRTUAL generated / STORED generated) are all real,
// selectable columns.
func listColumns(exec QueryExecutor, table string) ([]model.ColumnMeta, []tableXInfoRow, error) {
	var raw []tableXInfoRow
	err := exec("SELECT * FROM pragma_table_xinfo(?)", []any{table}, func(r *sql.Rows) error {
		row, err := scanXInfoRow(r)
		if err != nil {
			return err
		}
		raw = append(raw, row)
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	var columns []model.ColumnMeta
	for _, r := range raw {
		if r.hidden == 1 {
			continue
		}
		var def *string
		if r.dflt.Valid {
			def = &r.dflt.String
		}
		columns = append(columns, model.ColumnMeta{
			Name: r.name, Position: r.cid, DataType: r.typ, Nullable: r.notnull == 0,
			DefaultExpr: def, IsPrimaryKey: r.pk > 0,
		})
	}
	return columns, raw, nil
}

// primaryKeyFromColumns is catalog.ts's own — the `pk` ordinal is 1-based and always present on
// table_xinfo, unlike the other SQL adapters: a single-column INTEGER PRIMARY KEY (the rowid alias)
// has no backing index at all, so this is read directly rather than derived from listIndexes.
func primaryKeyFromColumns(columns []model.ColumnMeta, raw []tableXInfoRow) []string {
	known := make(map[string]bool, len(columns))
	for _, c := range columns {
		known[c.Name] = true
	}
	pkRows := make([]tableXInfoRow, 0)
	for _, r := range raw {
		if r.pk > 0 {
			pkRows = append(pkRows, r)
		}
	}
	if len(pkRows) == 0 {
		return nil
	}
	sort.SliceStable(pkRows, func(i, j int) bool { return pkRows[i].pk < pkRows[j].pk })
	var names []string
	for _, r := range pkRows {
		if known[r.name] {
			names = append(names, r.name)
		}
	}
	return names
}

// listIndexes is catalog.ts's own.
func listIndexes(exec QueryExecutor, table string) ([]model.IndexMeta, error) {
	type idxRow struct {
		name   string
		unique bool
		origin string
	}
	var indexes []idxRow
	err := exec("SELECT * FROM pragma_index_list(?)", []any{table}, func(r *sql.Rows) error {
		var seq int
		var name string
		var unique, partial int
		var origin string
		if err := r.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			return err
		}
		indexes = append(indexes, idxRow{name: name, unique: unique == 1, origin: origin})
		return nil
	})
	if err != nil {
		return nil, err
	}

	result := make([]model.IndexMeta, len(indexes))
	for i, idx := range indexes {
		var columns []string
		err := exec("SELECT * FROM pragma_index_info(?)", []any{idx.name}, func(r *sql.Rows) error {
			var seqno, cid int
			var name sql.NullString
			if err := r.Scan(&seqno, &cid, &name); err != nil {
				return err
			}
			if name.Valid {
				columns = append(columns, name.String)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		result[i] = model.IndexMeta{
			Name: idx.name, Columns: columns, Unique: idx.unique, Primary: idx.origin == "pk",
			// SQLite reports no index method via any pragma — always a B-tree internally, but
			// there is nothing honest to put here beyond nil (unlike MariaDB's INDEX_TYPE).
			Method: nil,
		}
	}
	return result, nil
}

type foreignKeyListRow struct {
	id       int
	seq      int
	table    string
	from     string
	to       string
	onUpdate string
	onDelete string
}

func fetchForeignKeyList(exec QueryExecutor, table string) ([]foreignKeyListRow, error) {
	var rows []foreignKeyListRow
	err := exec("SELECT * FROM pragma_foreign_key_list(?)", []any{table}, func(r *sql.Rows) error {
		var row foreignKeyListRow
		var match string
		if err := r.Scan(&row.id, &row.seq, &row.table, &row.from, &row.to, &row.onUpdate, &row.onDelete, &match); err != nil {
			return err
		}
		rows = append(rows, row)
		return nil
	})
	return rows, err
}

// synthesizeFkName is catalog.ts's own — `foreign_key_list` never reports the constraint's own
// name, even when the SQL declared one with `CONSTRAINT name FOREIGN KEY (...)`. Postgres's own
// convention for an unnamed FK (`<table>_<column>_fkey`).
func synthesizeFkName(table, firstColumn string) string {
	return table + "_" + firstColumn + "_fkey"
}

func groupByID(rows []foreignKeyListRow) [][]foreignKeyListRow {
	byID := make(map[int][]foreignKeyListRow)
	var order []int
	for _, r := range rows {
		if _, ok := byID[r.id]; !ok {
			order = append(order, r.id)
		}
		byID[r.id] = append(byID[r.id], r)
	}
	groups := make([][]foreignKeyListRow, len(order))
	for i, id := range order {
		group := append([]foreignKeyListRow{}, byID[id]...)
		sort.SliceStable(group, func(a, b int) bool { return group[a].seq < group[b].seq })
		groups[i] = group
	}
	return groups
}

// listForeignKeys is catalog.ts's own.
func listForeignKeys(exec QueryExecutor, schema, table string) ([]model.ForeignKeyMeta, error) {
	rows, err := fetchForeignKeyList(exec, table)
	if err != nil {
		return nil, err
	}
	groups := groupByID(rows)
	result := make([]model.ForeignKeyMeta, len(groups))
	for i, group := range groups {
		columns := make([]string, len(group))
		refColumns := make([]string, len(group))
		for j, r := range group {
			columns[j] = r.from
			refColumns[j] = r.to
		}
		onDelete, onUpdate := group[0].onDelete, group[0].onUpdate
		result[i] = model.ForeignKeyMeta{
			Name:    synthesizeFkName(table, group[0].from),
			Columns: columns,
			ReferencedPath: model.EncodePath([]model.PathSegment{
				{Kind: "database", Name: schema}, {Kind: "table", Name: group[0].table},
			}),
			ReferencedColumns: refColumns, OnDelete: &onDelete, OnUpdate: &onUpdate,
		}
	}
	return result, nil
}

// listReferencedBy is catalog.ts's own — F17/D20: SQLite has no reverse-FK index, so this scans
// every other relevant table's own foreign_key_list looking for one that points back at `table`.
// allTables includes `table` itself on purpose: a self-referencing FK must appear here too.
func listReferencedBy(exec QueryExecutor, schema, table string, allTables []string) ([]model.ForeignKeyMeta, error) {
	var result []model.ForeignKeyMeta
	for _, source := range allTables {
		rows, err := fetchForeignKeyList(exec, source)
		if err != nil {
			return nil, err
		}
		var filtered []foreignKeyListRow
		for _, r := range rows {
			if r.table == table {
				filtered = append(filtered, r)
			}
		}
		for _, group := range groupByID(filtered) {
			columns := make([]string, len(group))
			refColumns := make([]string, len(group))
			for j, r := range group {
				columns[j] = r.to
				refColumns[j] = r.from
			}
			onDelete, onUpdate := group[0].onDelete, group[0].onUpdate
			result = append(result, model.ForeignKeyMeta{
				Name:    synthesizeFkName(source, group[0].from),
				Columns: columns,
				ReferencedPath: model.EncodePath([]model.PathSegment{
					{Kind: "database", Name: schema}, {Kind: "table", Name: source},
				}),
				ReferencedColumns: refColumns, OnDelete: &onDelete, OnUpdate: &onUpdate,
			})
		}
	}
	return result, nil
}

func listAllTableNames(exec QueryExecutor, schema string) ([]string, error) {
	tables, err := relevantTables(exec, schema)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, t := range tables {
		if t.typ != "view" {
			names = append(names, t.name)
		}
	}
	return names, nil
}

// ReadTarget is the sqlite analogue of catalog.ts's ReadTarget.
type ReadTarget struct {
	QualifiedName QualifiedName
	Columns       []model.ColumnMeta
	PrimaryKey    []string
	// UniqueKeys are unique indexes whose columns are all NOT NULL — keyset tiebreaker candidates.
	UniqueKeys [][]string
	// RowidColumn is 'rowid' (or one of its two aliases, whichever isn't shadowed by a real column)
	// for a rowid table with no explicit primary key candidate of its own; nil for a view, a
	// WITHOUT ROWID table, or the rare table that shadows all three rowid aliases (F23/D22). Never
	// mutation identity (D23) — purely an internal keyset tiebreaker.
	RowidColumn *string
	// GeneratedColumns is table_xinfo.hidden 2 (VIRTUAL) or 3 (STORED) — a GENERATED ALWAYS AS
	// column (P36 D28).
	GeneratedColumns map[string]bool
}

var rowidAliases = []string{"rowid", "_rowid_", "oid"}

func pickRowidColumn(columns []model.ColumnMeta, isRowidTable bool) *string {
	if !isRowidTable {
		return nil
	}
	used := make(map[string]bool, len(columns))
	for _, c := range columns {
		used[strings.ToLower(c.Name)] = true
	}
	for _, alias := range rowidAliases {
		if !used[alias] {
			a := alias
			return &a
		}
	}
	return nil
}

// getReadTarget is catalog.ts's own — the read path needs the relation's columns/PK/unique-index/
// rowid shape in one shot, resolved fresh on every uncached read (same discipline as the other SQL
// adapters' getReadTarget).
func getReadTarget(exec QueryExecutor, schema, table string) (ReadTarget, error) {
	columns, raw, err := listColumns(exec, table)
	if err != nil {
		return ReadTarget{}, err
	}
	primaryKey := primaryKeyFromColumns(columns, raw)

	indexes, err := listIndexes(exec, table)
	if err != nil {
		return ReadTarget{}, err
	}
	nullableByName := make(map[string]bool, len(columns))
	for _, c := range columns {
		nullableByName[c.Name] = c.Nullable
	}
	var uniqueKeys [][]string
	for _, idx := range indexes {
		if !idx.Unique {
			continue
		}
		allNotNull := true
		for _, c := range idx.Columns {
			if nullableByName[c] {
				allNotNull = false
				break
			}
		}
		if allNotNull {
			uniqueKeys = append(uniqueKeys, idx.Columns)
		}
	}

	// Independent of whether a primary key exists — readPage's own fallback order (PK, else a
	// unique index, else rowid, D22) decides when this is actually consulted; a WITHOUT ROWID table
	// (wr === 1) always has its own declared PK by SQLite's own rule, so this is simply nil there.
	// `type` has to be checked too: pragma_table_list reports wr:0 for a *view* as well (the field
	// is meaningless there, not "false") — found empirically, reading a view crashed with
	// "no such column: rowid" before this check existed.
	var tableType string
	var wr int
	hasRow := false
	err = exec("SELECT type, wr FROM pragma_table_list(?)", []any{table}, func(r *sql.Rows) error {
		hasRow = true
		return r.Scan(&tableType, &wr)
	})
	if err != nil {
		return ReadTarget{}, err
	}
	isRowidTable := hasRow && tableType != "view" && wr == 0
	rowidColumn := pickRowidColumn(columns, isRowidTable)

	generated := make(map[string]bool)
	for _, r := range raw {
		if r.hidden == 2 || r.hidden == 3 {
			generated[r.name] = true
		}
	}

	return ReadTarget{
		QualifiedName: QualifiedName{Database: schema, Table: table},
		Columns:       columns, PrimaryKey: primaryKey, UniqueKeys: uniqueKeys,
		RowidColumn: rowidColumn, GeneratedColumns: generated,
	}, nil
}

// abbreviateCount mirrors @shared/format's abbreviateCount (postgres/catalog.go's own copy,
// deliberately duplicated per package rather than shared).
var abbreviateUnits = []struct {
	threshold int64
	suffix    string
}{
	{1_000_000_000_000, "T"},
	{1_000_000_000, "B"},
	{1_000_000, "M"},
	{1_000, "K"},
}

func abbreviateCount(n int64) string {
	sign := ""
	abs := n
	if abs < 0 {
		sign = "-"
		abs = -abs
	}
	for _, u := range abbreviateUnits {
		if abs < u.threshold {
			continue
		}
		scaled := float64(abs) / float64(u.threshold)
		var text string
		if scaled < 10 {
			text = trimTrailingZero(scaled)
		} else {
			text = strconv.FormatInt(int64(scaled+0.5), 10)
		}
		return sign + text + u.suffix
	}
	return sign + strconv.FormatInt(abs, 10)
}

func trimTrailingZero(f float64) string {
	s := strconv.FormatFloat(f, 'f', 1, 64)
	if len(s) >= 2 && s[len(s)-2:] == ".0" {
		return s[:len(s)-2]
	}
	return s
}
