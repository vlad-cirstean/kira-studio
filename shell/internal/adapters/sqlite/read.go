package sqlite

import (
	"context"
	"database/sql"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// quoteIdent is read.ts's quoteIdent.
func quoteIdent(name string) string {
	if strings.ContainsRune(name, '\x00') {
		panic(adapters.New(adapters.CodeQuery, "identifier contains a NUL byte", nil))
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

var (
	boolType     = regexp.MustCompile(`^BOOL`)
	temporalType = regexp.MustCompile(`^(DATE|DATETIME|TIMESTAMP)$`)
)

// typeClassFor is read.ts's typeClassFor — F21/D21: SQLite's own five type-affinity rules over
// the *declared* type string, plus three sugar cases no affinity rule covers on its own (BOOLEAN,
// the DATE family, JSON). 'other' for an undeclared or STRICT-table ANY column: the declared type
// is a hint at best (F21).
func typeClassFor(declaredType string) page.TypeClass {
	base := strings.ToUpper(strings.TrimSpace(declaredType))
	switch {
	case base == "" || base == "ANY":
		return page.TypeClassOther
	case boolType.MatchString(base):
		return page.TypeClassBoolean
	case temporalType.MatchString(base):
		return page.TypeClassTemporal
	case base == "JSON":
		return page.TypeClassJSON
	case strings.Contains(base, "INT"):
		return page.TypeClassNumber
	case strings.Contains(base, "CHAR") || strings.Contains(base, "CLOB") || strings.Contains(base, "TEXT"):
		return page.TypeClassText
	case strings.Contains(base, "BLOB"):
		return page.TypeClassBinary
	case strings.Contains(base, "REAL") || strings.Contains(base, "FLOA") || strings.Contains(base, "DOUB"):
		return page.TypeClassNumber
	default:
		return page.TypeClassNumber // NUMERIC affinity catch-all: DECIMAL, NUMERIC, anything else undeclared
	}
}

// resolveKeysetColumnMeta is read.ts's own inline helper: a rowid table's own rowid is not a
// declared column, so it needs a synthetic ColumnMeta only for fetch purposes when it is the
// chosen tiebreaker (D22/F23) — never added to target.Columns, never shown as a page column (D23).
func resolveKeysetColumnMeta(target ReadTarget, name string) (model.ColumnMeta, error) {
	for _, c := range target.Columns {
		if c.Name == name {
			return c, nil
		}
	}
	if target.RowidColumn != nil && name == *target.RowidColumn {
		return model.ColumnMeta{Name: name, Position: -1, DataType: "INTEGER", Nullable: false}, nil
	}
	return model.ColumnMeta{}, adapters.New(adapters.CodeQuery, "keyset tiebreaker column not found: "+name, nil)
}

// selectExpr wraps a quoted identifier the way readPage's own SELECT list must, to route around a
// real modernc.org/sqlite driver behaviour that has nothing to do with SQLite itself: unlike
// node:sqlite (D21's whole "nothing switches on the declared type" claim held there), this driver's
// own Next() unconditionally re-parses a TEXT value into a Go time.Time whenever the column's
// declared type is DATE/DATETIME/TIMESTAMP and the stored text happens to look like a date —
// verified directly against the driver's own rows.go, then confirmed against a live query: a
// DATETIME column holding '2024-01-01 12:34:56' comes back as time.Time, silently, with no DSN
// option to disable it (unlike the unrelated, genuinely opt-in _inttotime/_texttotime flags). A
// CASE expression is not a "simple column reference" in SQLite's own sqlite3_column_decltype()
// terms, so wrapping every fetched column in one defeats the coercion — a NULL stays NULL, an
// INTEGER/REAL/BLOB value actually stored in a temporally-declared column (D21's own dynamic-typing
// point) still comes back as int64/float64/[]byte untouched, and a TEXT value comes back byte for
// byte, valid-looking date string included. Confirmed empirically (see AGENTS.md's P58b findings)
// against all six combinations before this landed, not assumed from reading the driver's source.
func selectExpr(ident string) string {
	return "CASE WHEN typeof(" + ident + ") = 'text' THEN " + ident + " || '' ELSE " + ident + " END"
}

// readReq is adapter.ts's ReadRequest minus Path.
type readReq struct {
	Projection []string
	Filter     *string
	Sort       *model.SortSpec
	PageSize   int
	Cursor     model.PageCursor
}

func questionPlaceholder(int) string { return "?" }

// readPage is read.ts's readPage.
func readPage(ctx context.Context, conn *sql.Conn, op *adapters.OpCtx, target ReadTarget, req readReq) (page.TabularPage, error) {
	projectedColumns, err := adapters.ResolveProjection(target.Columns, req.Projection)
	if err != nil {
		return page.TabularPage{}, err
	}
	// D22: the fallback chain is primary key, else a unique (all-NOT-NULL) index, else — a step
	// further than the other SQL adapters can offer — the table's own implicit rowid (F23), which
	// every rowid table has for free regardless of whether it declares a primary key at all.
	var tiebreaker []string
	switch {
	case target.PrimaryKey != nil:
		tiebreaker = target.PrimaryKey
	case len(target.UniqueKeys) > 0:
		tiebreaker = target.UniqueKeys[0]
	case target.RowidColumn != nil:
		tiebreaker = []string{*target.RowidColumn}
	}
	order, err := adapters.ComputeEffectiveOrder(req.Sort, target.Columns, tiebreaker)
	if err != nil {
		return page.TabularPage{}, err
	}
	isTextSort := req.Sort != nil && req.Sort.Kind == "text"
	wantsKeyset := req.Cursor.Mode == "after" || req.Cursor.Mode == "before"
	if err := adapters.AssertKeysetSupported(wantsKeyset, isTextSort, order.KeysetEligible); err != nil {
		return page.TabularPage{}, err
	}

	fetch, err := adapters.ResolveFetchColumns(projectedColumns, target.Columns, order, func(name string) (model.ColumnMeta, error) {
		return resolveKeysetColumnMeta(target, name)
	})
	if err != nil {
		return page.TabularPage{}, err
	}

	columns := make([]page.ColumnDescriptor, len(projectedColumns))
	for i, c := range projectedColumns {
		columns[i] = page.ColumnDescriptor{
			Name: c.Name, DataType: c.DataType, TypeClass: typeClassFor(c.DataType),
			Nullable: c.Nullable, IsPrimaryKey: c.IsPrimaryKey,
			Generated: target.GeneratedColumns[c.Name],
		}
	}

	relationSQL := quoteIdent(target.QualifiedName.Database) + "." + quoteIdent(target.QualifiedName.Table)
	selectNames := make([]string, len(fetch.Columns))
	for i, c := range fetch.Columns {
		selectNames[i] = selectExpr(quoteIdent(c.Name))
	}
	selectList := strings.Join(selectNames, ", ")

	var params []any
	whereSQL := adapters.WhereClause(req.Filter)

	fingerprint := adapters.RequestFingerprint(struct {
		Path       QualifiedName   `json:"path"`
		Projection []string        `json:"projection"`
		Filter     *string         `json:"filter"`
		Sort       *model.SortSpec `json:"sort"`
		PageSize   int             `json:"pageSize"`
	}{target.QualifiedName, req.Projection, req.Filter, req.Sort, req.PageSize})

	reverseRows := req.Cursor.Mode == "before" && order.KeysetEligible
	orderBySQL := adapters.BuildScanOrderBy(req.Sort, order, reverseRows, quoteIdent)

	if wantsKeyset && req.Cursor.Mode != "offset" {
		keyValues, err := adapters.DecodePageToken(req.Cursor.Token, fingerprint)
		if err != nil {
			return page.TabularPage{}, err
		}
		if len(keyValues) != len(order.KeysetColumns) {
			return page.TabularPage{}, adapters.New(adapters.CodeQuery, "page token key length does not match the sort key", nil)
		}
		for _, v := range keyValues {
			params = append(params, v)
		}
		quotedKeyColumns := make([]string, len(order.KeysetColumns))
		for i, c := range order.KeysetColumns {
			quotedKeyColumns[i] = quoteIdent(c)
		}
		predicate := adapters.BuildKeysetPredicate(quotedKeyColumns, order.KeysetDirection, req.Cursor.Mode, 1, questionPlaceholder)
		if whereSQL != "" {
			whereSQL += " AND " + predicate
		} else {
			whereSQL = "WHERE " + predicate
		}
	}

	// D24: fetch pageSize + 1 to compute hasMore without a count. Bound before the OFFSET
	// placeholder, matching M6.2's own LIMIT/OFFSET fix — params must line up with the "?"s left to
	// right in the SQL text below, the same order it actually emits them in.
	params = append(params, req.PageSize+1)
	offsetSQL := ""
	if req.Cursor.Mode == "offset" {
		params = append(params, req.Cursor.Offset)
		offsetSQL = " OFFSET ?"
	}

	sqlParts := []string{"SELECT " + selectList, "FROM " + relationSQL}
	if whereSQL != "" {
		sqlParts = append(sqlParts, whereSQL)
	}
	if orderBySQL != "" {
		sqlParts = append(sqlParts, "ORDER BY "+orderBySQL)
	}
	sqlParts = append(sqlParts, "LIMIT ?"+offsetSQL)
	query := strings.Join(sqlParts, "\n")

	rawRows, err := runArrayQuery(ctx, conn, query, params, op, true)
	if err != nil {
		return page.TabularPage{}, err
	}

	probedExtra := len(rawRows) > req.PageSize
	keptRows := rawRows
	if probedExtra {
		keptRows = rawRows[:req.PageSize]
	}

	builder := page.NewTabularPageBuilder(columns)
	for _, row := range keptRows {
		cells := make([]*string, len(projectedColumns))
		for i := range cells {
			cells[i] = toCellText(row[i])
		}
		if err := builder.AppendRow(cells); err != nil {
			return page.TabularPage{}, err
		}
	}
	if reverseRows {
		builder.Reverse()
	}

	displayRows := keptRows
	if reverseRows {
		displayRows = make([][]any, len(keptRows))
		for i, row := range keptRows {
			displayRows[len(keptRows)-1-i] = row
		}
	}

	position, err := adapters.BuildKeysetPosition(adapters.KeysetPositionArgs{
		Cursor: req.Cursor, PageSize: req.PageSize, DisplayRowCount: len(displayRows),
		ProbedExtra: probedExtra, Order: order, KeysetColumnIdx: fetch.KeysetColumnIdx,
		Fingerprint: fingerprint,
		CellAt:      func(row, col int) *string { return toCellText(displayRows[row][col]) },
	})
	if err != nil {
		return page.TabularPage{}, err
	}

	return builder.Finish(position), nil
}

// countRows is read.ts's countRows.
func countRows(ctx context.Context, conn *sql.Conn, op *adapters.OpCtx, target QualifiedName, filter *string) (adapters.CountResult, error) {
	relationSQL := quoteIdent(target.Database) + "." + quoteIdent(target.Table)
	sqlParts := []string{"SELECT count(*) AS n", "FROM " + relationSQL}
	if where := adapters.WhereClause(filter); where != "" {
		sqlParts = append(sqlParts, where)
	}
	query := strings.Join(sqlParts, "\n")

	rows, err := runArrayQuery(ctx, conn, query, nil, op, false)
	if err != nil {
		return adapters.CountResult{}, err
	}
	var raw any
	if len(rows) > 0 && len(rows[0]) > 0 {
		raw = rows[0][0]
	}
	value, err := adapters.ParseCountValue(raw)
	if err != nil {
		return adapters.CountResult{}, err
	}
	return adapters.CountResult{Value: value, Exact: true}, nil
}

// toCellText is read.ts's D3/D21 value->text codec: it switches on the *value's* own Go type,
// never the column's declared type — SQLite is dynamically typed (F21), so a TEXT-declared column
// is free to hold a BLOB value and vice versa. The `0x<hex>` spelling is mysql-family's own
// convention (D21), not a new one. The time.Time case has no TypeScript counterpart: it exists
// only because of the modernc.org/sqlite decltype coercion selectExpr's own comment documents —
// readPage's SELECT list already routes around it for the data-grid path, so this branch is reached
// only via the query console running a user's own raw "SELECT dt FROM t" against a
// DATE/DATETIME/TIMESTAMP column, which the adapter cannot rewrite (it is the user's own SQL text,
// not adapter-composed). Reformatted to SQLite's own canonical strftime('%Y-%m-%d %H:%M:%f') shape
// rather than passed through byte for byte in that one case — a narrow, documented capability trade
// (docs/ARCHITECTURE.md), not a silent gap.
func toCellText(value any) *string {
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case []byte:
		s := "0x" + hex.EncodeToString(v)
		return &s
	case int64:
		s := strconv.FormatInt(v, 10)
		return &s
	case float64:
		s := strconv.FormatFloat(v, 'g', -1, 64)
		return &s
	case string:
		return &v
	case time.Time:
		var s string
		if v.Nanosecond() == 0 {
			s = v.UTC().Format("2006-01-02 15:04:05")
		} else {
			s = v.UTC().Format("2006-01-02 15:04:05.999999999")
		}
		return &s
	default:
		s := ""
		return &s
	}
}
