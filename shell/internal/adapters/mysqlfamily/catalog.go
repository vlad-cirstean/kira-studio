package mysqlfamily

import (
	"context"
	"database/sql"
	"strconv"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// queryExec is catalog.ts's QueryExecutor: every catalog query is routed through it so it stays
// cancellable and command-logged like any other query. scan is called once per row.
type queryExec func(ctx context.Context, query string, params []any, scan func(*sql.Rows) error) error

// execFor is adapter.go's own execFor, binding one conn/threadID/op/track quadruple.
func execFor(conn *sql.Conn, threadID uint32, op *adapters.OpCtx, track TrackQuery) queryExec {
	return func(ctx context.Context, query string, params []any, scan func(*sql.Rows) error) error {
		op.SetCommand(query)
		if err := adapters.CheckNotStarted(ctx); err != nil {
			return err
		}
		release := track(RunningQuery{ThreadID: threadID})
		defer release()

		rows, err := conn.QueryContext(ctx, query, params...)
		if err != nil {
			return mapError(err)
		}
		defer rows.Close()
		for rows.Next() {
			if err := scan(rows); err != nil {
				return mapError(err)
			}
		}
		if err := rows.Err(); err != nil {
			return mapError(err)
		}
		return nil
	}
}

var systemSchemas = []string{"information_schema", "performance_schema", "mysql", "sys"}

// listDatabases is catalog.ts's listDatabases.
func listDatabases(ctx context.Context, exec queryExec, currentDatabase string) ([]model.TreeNode, error) {
	params := make([]any, len(systemSchemas))
	placeholders := ""
	for i, s := range systemSchemas {
		params[i] = s
		if i > 0 {
			placeholders += ", "
		}
		placeholders += "?"
	}
	var nodes []model.TreeNode
	err := exec(ctx, `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
	 WHERE SCHEMA_NAME NOT IN (`+placeholders+`)
	 ORDER BY SCHEMA_NAME`, params, func(rows *sql.Rows) error {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		var detail *string
		if name == currentDatabase {
			d := "connected"
			detail = &d
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

var tableTypeToNodeKind = map[string]string{"BASE TABLE": "table", "VIEW": "view", "SEQUENCE": "sequence"}

// listTablesAndRoutines is catalog.ts's listTablesAndRoutines. §5.1: database -> tables/views/
// routines -> column. No schema level.
func listTablesAndRoutines(ctx context.Context, exec queryExec, database string) ([]model.TreeNode, error) {
	var nodes []model.TreeNode
	err := exec(ctx, `SELECT TABLE_NAME AS name, TABLE_TYPE AS table_type, TABLE_ROWS AS table_rows,
	        TABLE_COMMENT AS comment
	 FROM information_schema.TABLES
	 WHERE TABLE_SCHEMA = ?
	 ORDER BY CASE TABLE_TYPE WHEN 'BASE TABLE' THEN 0 WHEN 'VIEW' THEN 1 WHEN 'SEQUENCE' THEN 2
	                          ELSE 0 END, TABLE_NAME`, []any{database}, func(rows *sql.Rows) error {
		var name, tableType string
		var tableRows *int64
		var comment *string
		if err := rows.Scan(&name, &tableType, &tableRows, &comment); err != nil {
			return err
		}
		kind, ok := tableTypeToNodeKind[tableType]
		if !ok {
			kind = "table"
		}
		var detail *string
		if kind == "table" && tableRows != nil {
			d := "~" + abbreviateCount(*tableRows) + " rows"
			detail = &d
		}
		nodes = append(nodes, model.TreeNode{
			Kind: kind, Name: name,
			Path: model.EncodePath([]model.PathSegment{
				{Kind: "database", Name: database}, {Kind: kind, Name: name},
			}),
			// P19 D5: every relation is a leaf now.
			HasChildren: false, Detail: detail,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = exec(ctx, `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS routine_type, DTD_IDENTIFIER AS dtd
	 FROM information_schema.ROUTINES
	 WHERE ROUTINE_SCHEMA = ?
	 ORDER BY ROUTINE_NAME`, []any{database}, func(rows *sql.Rows) error {
		var name, routineType string
		var dtd *string
		if err := rows.Scan(&name, &routineType, &dtd); err != nil {
			return err
		}
		var detail *string
		if routineType == "FUNCTION" {
			detail = dtd
		} else {
			d := "procedure"
			detail = &d
		}
		nodes = append(nodes, model.TreeNode{
			Kind: "function", Name: name,
			Path: model.EncodePath([]model.PathSegment{
				{Kind: "database", Name: database}, {Kind: "function", Name: name},
			}),
			HasChildren: false, Detail: detail,
		})
		return nil
	})
	return nodes, err
}

// listColumns is catalog.ts's listColumns. COLUMN_TYPE, not DATA_TYPE — "varchar(50)" is what the
// user wants to see.
func listColumns(ctx context.Context, exec queryExec, database, table string) ([]model.ColumnMeta, error) {
	var columns []model.ColumnMeta
	err := exec(ctx, `SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS position, COLUMN_TYPE AS data_type,
	        IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS default_expr, COLUMN_COMMENT AS comment
	 FROM information_schema.COLUMNS
	 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
	 ORDER BY ORDINAL_POSITION`, []any{database, table}, func(rows *sql.Rows) error {
		var col model.ColumnMeta
		var position int64
		var isNullable string
		var comment *string
		if err := rows.Scan(&col.Name, &position, &col.DataType, &isNullable, &col.DefaultExpr, &comment); err != nil {
			return err
		}
		col.Position = int(position)
		col.Nullable = isNullable == "YES"
		if comment != nil && *comment != "" {
			col.Comment = comment
		}
		columns = append(columns, col)
		return nil
	})
	return columns, err
}

// listIndexes is catalog.ts's listIndexes.
func listIndexes(ctx context.Context, exec queryExec, database, table string) ([]model.IndexMeta, error) {
	type row struct {
		indexName, indexType, columnName string
		nonUnique                        int
	}
	var rowsOut []row
	err := exec(ctx, `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, INDEX_TYPE AS index_type,
	        COLUMN_NAME AS column_name, SEQ_IN_INDEX AS seq
	 FROM information_schema.STATISTICS
	 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
	 ORDER BY INDEX_NAME, SEQ_IN_INDEX`, []any{database, table}, func(rows *sql.Rows) error {
		var r row
		var seq int
		if err := rows.Scan(&r.indexName, &r.nonUnique, &r.indexType, &r.columnName, &seq); err != nil {
			return err
		}
		rowsOut = append(rowsOut, r)
		return nil
	})
	if err != nil {
		return nil, err
	}
	order := []string{}
	byName := map[string][]row{}
	for _, r := range rowsOut {
		if _, ok := byName[r.indexName]; !ok {
			order = append(order, r.indexName)
		}
		byName[r.indexName] = append(byName[r.indexName], r)
	}
	indexes := make([]model.IndexMeta, 0, len(order))
	for _, name := range order {
		group := byName[name]
		columns := make([]string, len(group))
		for i, r := range group {
			columns[i] = r.columnName
		}
		method := group[0].indexType
		indexes = append(indexes, model.IndexMeta{
			Name: name, Columns: columns, Unique: group[0].nonUnique == 0, Primary: name == "PRIMARY",
			Method: &method,
		})
	}
	return indexes, nil
}

var constraintActionNames = map[string]string{
	"NO ACTION": "NO ACTION", "RESTRICT": "RESTRICT", "CASCADE": "CASCADE",
	"SET NULL": "SET NULL", "SET DEFAULT": "SET DEFAULT",
}

// listForeignKeys is catalog.ts's listForeignKeys — outbound (this table's own FKs). referencedPath
// is a two-segment path (database/table), one shallower than Postgres's three (§6d).
func listForeignKeys(ctx context.Context, exec queryExec, database, table string) ([]model.ForeignKeyMeta, error) {
	type row struct {
		name, column, refSchema, refTable, refColumn string
		onDelete, onUpdate                           string
	}
	var rowsOut []row
	err := exec(ctx, `SELECT kcu.CONSTRAINT_NAME AS name, kcu.COLUMN_NAME AS column_name,
	        kcu.REFERENCED_TABLE_SCHEMA AS ref_schema, kcu.REFERENCED_TABLE_NAME AS ref_table,
	        kcu.REFERENCED_COLUMN_NAME AS ref_column,
	        rc.DELETE_RULE AS on_delete, rc.UPDATE_RULE AS on_update
	 FROM information_schema.KEY_COLUMN_USAGE kcu
	 JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
	   ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
	 WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
	 ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`, []any{database, table}, func(rows *sql.Rows) error {
		var r row
		if err := rows.Scan(&r.name, &r.column, &r.refSchema, &r.refTable, &r.refColumn, &r.onDelete, &r.onUpdate); err != nil {
			return err
		}
		rowsOut = append(rowsOut, r)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return groupForeignKeys(rowsOut, func(r row) (name, col, refDB, refTable, refCol, onDel, onUpd string) {
		return r.name, r.column, r.refSchema, r.refTable, r.refColumn, r.onDelete, r.onUpdate
	}), nil
}

// listReferencedBy is catalog.ts's listReferencedBy (D17): I am the referenced table, so my own
// columns are ref_column and the other (referencing) table is src_* — the mirror image.
func listReferencedBy(ctx context.Context, exec queryExec, database, table string) ([]model.ForeignKeyMeta, error) {
	type row struct {
		name, srcSchema, srcTable, srcColumn, refColumn string
		onDelete, onUpdate                              string
	}
	var rowsOut []row
	err := exec(ctx, `SELECT kcu.CONSTRAINT_NAME AS name, kcu.TABLE_SCHEMA AS src_schema, kcu.TABLE_NAME AS src_table,
	        kcu.COLUMN_NAME AS src_column, kcu.REFERENCED_COLUMN_NAME AS ref_column,
	        rc.DELETE_RULE AS on_delete, rc.UPDATE_RULE AS on_update
	 FROM information_schema.KEY_COLUMN_USAGE kcu
	 JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
	   ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
	 WHERE kcu.REFERENCED_TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME = ?
	 ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`, []any{database, table}, func(rows *sql.Rows) error {
		var r row
		if err := rows.Scan(&r.name, &r.srcSchema, &r.srcTable, &r.srcColumn, &r.refColumn, &r.onDelete, &r.onUpdate); err != nil {
			return err
		}
		rowsOut = append(rowsOut, r)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return groupForeignKeys(rowsOut, func(r row) (name, col, refDB, refTable, refCol, onDel, onUpd string) {
		return r.name, r.refColumn, r.srcSchema, r.srcTable, r.srcColumn, r.onDelete, r.onUpdate
	}), nil
}

// groupForeignKeys folds a flat list of key-column rows into one ForeignKeyMeta per constraint
// name, in first-seen order — shared by listForeignKeys/listReferencedBy's own mirror-image
// column mapping (get picks which raw field plays which role).
func groupForeignKeys[R any](rows []R, get func(R) (name, col, refDatabase, refTable, refCol, onDelete, onUpdate string)) []model.ForeignKeyMeta {
	order := []string{}
	byName := map[string][]R{}
	for _, r := range rows {
		name, _, _, _, _, _, _ := get(r)
		if _, ok := byName[name]; !ok {
			order = append(order, name)
		}
		byName[name] = append(byName[name], r)
	}
	metas := make([]model.ForeignKeyMeta, 0, len(order))
	for _, name := range order {
		group := byName[name]
		columns := make([]string, len(group))
		refColumns := make([]string, len(group))
		var refDatabase, refTable, onDelete, onUpdate string
		for i, r := range group {
			_, col, rd, rt, rc, od, ou := get(r)
			columns[i] = col
			refColumns[i] = rc
			refDatabase, refTable, onDelete, onUpdate = rd, rt, od, ou
		}
		var onDeletePtr, onUpdatePtr *string
		if v, ok := constraintActionNames[onDelete]; ok {
			onDeletePtr = &v
		}
		if v, ok := constraintActionNames[onUpdate]; ok {
			onUpdatePtr = &v
		}
		metas = append(metas, model.ForeignKeyMeta{
			Name: name, Columns: columns,
			ReferencedPath: model.EncodePath([]model.PathSegment{
				{Kind: "database", Name: refDatabase}, {Kind: "table", Name: refTable},
			}),
			ReferencedColumns: refColumns, OnDelete: onDeletePtr, OnUpdate: onUpdatePtr,
		})
	}
	return metas
}

// QualifiedName is the database/table pair every SQL statement this package builds quotes and
// joins itself — never interpolated raw.
type QualifiedName struct {
	Database, Table string
}

// ReadTarget is catalog.ts's ReadTarget.
type ReadTarget struct {
	QualifiedName QualifiedName
	Columns       []model.ColumnMeta
	PrimaryKey    []string
	UniqueKeys    [][]string
}

// getReadTarget is catalog.ts's getReadTarget — the read path's relation shape in one shot,
// resolved fresh on every uncached read (D10).
func getReadTarget(ctx context.Context, exec queryExec, database, table string) (ReadTarget, error) {
	rawColumns, err := listColumns(ctx, exec, database, table)
	if err != nil {
		return ReadTarget{}, err
	}
	indexes, err := listIndexes(ctx, exec, database, table)
	if err != nil {
		return ReadTarget{}, err
	}
	shape := adapters.ResolveKeyShape(rawColumns, indexes)
	return ReadTarget{
		QualifiedName: QualifiedName{Database: database, Table: table},
		Columns:       shape.Columns, PrimaryKey: shape.PrimaryKey, UniqueKeys: shape.UniqueKeys,
	}, nil
}

// abbreviateCount mirrors @shared/format's abbreviateCount (postgres/catalog.go's own copy,
// deliberately duplicated per package rather than shared — see that file's comment).
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
