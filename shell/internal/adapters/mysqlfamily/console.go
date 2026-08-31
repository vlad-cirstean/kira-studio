package mysqlfamily

import (
	"context"
	"database/sql"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
)

// numberDBTypes/temporalDBTypes are console.ts's own NUMBER_TYPES/TEMPORAL_TYPES, spelled in
// go-sql-driver's own DatabaseTypeName() vocabulary (fields.go's typeDatabaseName) rather than the
// mariadb npm package's FieldInfo.type enum — the two name the same wire types differently, but
// the classification is the same.
var numberDBTypes = map[string]bool{
	"DECIMAL": true, "TINYINT": true, "UNSIGNED TINYINT": true, "SMALLINT": true, "UNSIGNED SMALLINT": true,
	"MEDIUMINT": true, "UNSIGNED MEDIUMINT": true, "INT": true, "UNSIGNED INT": true,
	"BIGINT": true, "UNSIGNED BIGINT": true, "FLOAT": true, "DOUBLE": true, "YEAR": true,
}
var temporalDBTypes = map[string]bool{"TIMESTAMP": true, "DATE": true, "TIME": true, "DATETIME": true}

// typeClassForField is console.ts's typeClassForField, minus its boolean case (B4: go-sql-driver's
// ColumnTypeLength is commented out upstream, so a TINYINT console column has no display-width
// signal to distinguish tinyint(1) from any other TINYINT — it classifies as 'number', a documented
// capability loss recorded in docs/ARCHITECTURE.md, not an oversight).
func typeClassForField(dbType string) page.TypeClass {
	if binaryDatabaseTypes[dbType] {
		return page.TypeClassBinary
	}
	if numberDBTypes[dbType] {
		return page.TypeClassNumber
	}
	if temporalDBTypes[dbType] {
		return page.TypeClassTemporal
	}
	if dbType == "JSON" {
		return page.TypeClassJSON
	}
	return page.TypeClassText
}

// runRaw is console.ts's own low-level runner, deliberately separate from query.go's
// runArrayQuery/runCommand — it must not call op.SetCommand() per statement, and it needs full
// field metadata (name + DatabaseTypeName) those discard. QueryContext is used unconditionally,
// never ExecContext: MY-1 confirmed a non-row-returning statement (UPDATE/INSERT/DDL) still comes
// back through QueryContext with zero columns, the same signal SQLite's own StatementSync gives —
// so the console needs no per-statement leading-keyword decision the way ClickHouse's does.
func runRaw(ctx context.Context, conn *sql.Conn, threadID uint32, query string, op *adapters.OpCtx, track TrackQuery) (rows [][]*string, dbTypes []string, names []string, err error) {
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return nil, nil, nil, err
	}
	release := track(RunningQuery{ThreadID: threadID})

	type result struct {
		rows    [][]*string
		dbTypes []string
		names   []string
	}
	r, err := adapters.RunWithAbortRace(ctx, release, func(queryCtx context.Context) (result, error) {
		sqlRows, err := conn.QueryContext(queryCtx, query)
		if err != nil {
			return result{}, mapError(err)
		}
		defer sqlRows.Close()

		types, err := sqlRows.ColumnTypes()
		if err != nil {
			return result{}, mapError(err)
		}
		names := make([]string, len(types))
		dbTypes := make([]string, len(types))
		for i, t := range types {
			names[i] = t.Name()
			dbTypes[i] = t.DatabaseTypeName()
		}

		var out [][]*string
		for sqlRows.Next() {
			raw := make([]sql.RawBytes, len(types))
			dest := make([]any, len(types))
			for i := range raw {
				dest[i] = &raw[i]
			}
			if err := sqlRows.Scan(dest...); err != nil {
				return result{}, mapError(err)
			}
			cells := make([]*string, len(types))
			for i, rb := range raw {
				if rb == nil {
					continue
				}
				text := cellText(rb, dbTypes[i])
				cells[i] = &text
			}
			out = append(out, cells)
		}
		if err := sqlRows.Err(); err != nil {
			return result{}, mapError(err)
		}
		return result{rows: out, dbTypes: dbTypes, names: names}, nil
	})
	if err != nil {
		return nil, nil, nil, err
	}
	return r.rows, r.dbTypes, r.names, nil
}

// buildPage is console.ts's buildPage. A non-row-returning statement (zero columns) renders a
// generic "OK" status, not "<N> row(s) affected": go-sql-driver's Rows type exposes no affected-row
// count over QueryContext (confirmed against its own source — mysqlRows implements no
// driver.Result), a real, documented capability loss (docs/ARCHITECTURE.md's per-engine section),
// not an oversight.
func buildPage(rows [][]*string, dbTypes, names []string) page.TabularPage {
	if len(names) == 0 {
		return adapters.SingleStatusPage("OK", "text")
	}

	columns := make([]page.ColumnDescriptor, len(names))
	for i, name := range names {
		columns[i] = page.ColumnDescriptor{
			Name: name, DataType: dbTypes[i], TypeClass: typeClassForField(dbTypes[i]),
			Nullable: true, IsPrimaryKey: false, Generated: false,
		}
	}

	builder := page.NewTabularPageBuilder(columns)
	for _, row := range rows {
		_ = builder.AppendRow(row)
	}
	return builder.Finish(page.UnpagedPosition(len(rows)))
}

// execute is console.ts's execute.
func execute(ctx context.Context, conn *sql.Conn, threadID uint32, op *adapters.OpCtx, track TrackQuery, statements []string) ([]page.Page, error) {
	if len(statements) == 0 {
		return nil, adapters.New(adapters.CodeQuery, "no statements to execute", nil)
	}
	op.SetCommand(joinSemicolons(statements))

	pages := make([]page.Page, len(statements))
	for i, stmt := range statements {
		if err := adapters.CheckCancelled(ctx); err != nil {
			return nil, err
		}
		rows, dbTypes, names, err := runRaw(ctx, conn, threadID, stmt, op, track)
		if err != nil {
			return nil, err
		}
		pages[i] = buildPage(rows, dbTypes, names)
	}
	return pages, nil
}
