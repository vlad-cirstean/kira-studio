package postgres

import (
	"context"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// quoteIdent is read.ts's quoteIdent. The NUL check is unreachable with any real Postgres
// identifier — the server stores them as NUL-terminated C strings, so one physically cannot
// contain a NUL byte — but it stays, matching the TypeScript's own defensive check; panicking
// (rather than threading an error return through every quoteIdent call site) is fine specifically
// because this can only ever fire from Host.RunOp's own recover() boundary (P58 D16), which turns
// it into a failed op rather than a crash — the exact reason that boundary exists.
func quoteIdent(name string) string {
	if strings.ContainsRune(name, '\x00') {
		panic(adapters.New(adapters.CodeQuery, "identifier contains a NUL byte", nil))
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

var numericTypePrefix = regexp.MustCompile(`^(int2|int4|int8|smallint|integer|bigint|numeric|decimal|real|double precision|float4|float8|money)\b`)
var temporalTypePrefix = regexp.MustCompile(`^(date|time|timetz|timestamp|timestamptz|interval)\b`)

// typeClassFor is read.ts's typeClassFor — §5d's Postgres mapping. Array types (`_`-prefixed /
// `[]`-suffixed format_type() output) are checked first since they would otherwise match a
// base-type prefix (e.g. "integer[]").
func typeClassFor(dataType string) page.TypeClass {
	base := strings.ToLower(dataType)
	if strings.HasPrefix(base, "_") || strings.HasSuffix(base, "[]") {
		return page.TypeClassOther
	}
	if numericTypePrefix.MatchString(base) {
		return page.TypeClassNumber
	}
	if base == "boolean" || base == "bool" {
		return page.TypeClassBoolean
	}
	if temporalTypePrefix.MatchString(base) {
		return page.TypeClassTemporal
	}
	if base == "json" || base == "jsonb" {
		return page.TypeClassJSON
	}
	if base == "bytea" {
		return page.TypeClassBinary
	}
	return page.TypeClassText
}

// normalizeCellText is read.ts's normalizeCellText: bytea in text mode arrives as `\x…` (the hex
// bytea_output default since Postgres 9.0) — normalised to the app-wide `0x…` binary convention
// (D3, mirrored by MariaDB's blob handling). Reused by console.go for query results.
func normalizeCellText(value string, typeClass page.TypeClass) string {
	if typeClass == page.TypeClassBinary && strings.HasPrefix(value, `\x`) {
		return "0x" + value[2:]
	}
	return value
}

// readReq is adapter.ts's ReadRequest minus Path — the request shape readPage actually consumes.
type readReq struct {
	Projection []string
	Filter     *string
	Sort       *model.SortSpec
	PageSize   int
	Cursor     model.PageCursor
}

// readPage is read.ts's readPage — the densest function in the package.
func readPage(ctx context.Context, conn *pgx.Conn, op *adapters.OpCtx, track TrackQuery, target ReadTarget, req readReq) (page.TabularPage, error) {
	projectedColumns, err := adapters.ResolveProjection(target.Columns, req.Projection)
	if err != nil {
		return page.TabularPage{}, err
	}
	var tiebreaker []string
	if target.PrimaryKey != nil {
		tiebreaker = target.PrimaryKey
	} else if len(target.UniqueKeys) > 0 {
		tiebreaker = target.UniqueKeys[0]
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

	// The tiebreaker's columns must be fetched even when the caller did not project them — a
	// page/prev token needs their values regardless of what the grid displays.
	fetch, err := adapters.ResolveFetchColumns(projectedColumns, target.Columns, order, nil)
	if err != nil {
		return page.TabularPage{}, err
	}

	columns := make([]page.ColumnDescriptor, len(projectedColumns))
	for i, c := range projectedColumns {
		columns[i] = page.ColumnDescriptor{
			Name: c.Name, DataType: c.DataType, TypeClass: typeClassFor(c.DataType),
			Nullable: c.Nullable, IsPrimaryKey: c.IsPrimaryKey,
			// P36 D28: not detected here yet (definition.go's own attgenerated is the only place
			// this adapter currently reads it) — false rather than a guess.
			Generated: false,
		}
	}

	relationSQL := quoteIdent(target.QualifiedName.Schema) + "." + quoteIdent(target.QualifiedName.Relation)
	selectNames := make([]string, len(fetch.Columns))
	for i, c := range fetch.Columns {
		selectNames[i] = quoteIdent(c.Name)
	}
	selectList := strings.Join(selectNames, ", ")

	var params []any
	addParam := func(value any) int {
		params = append(params, value)
		return len(params)
	}

	whereSQL := adapters.WhereClause(req.Filter)

	fingerprint := adapters.RequestFingerprint(struct {
		Path       QualifiedName   `json:"path"`
		Projection []string        `json:"projection"`
		Filter     *string         `json:"filter"`
		Sort       *model.SortSpec `json:"sort"`
		PageSize   int             `json:"pageSize"`
	}{target.QualifiedName, req.Projection, req.Filter, req.Sort, req.PageSize})

	// "before" flips every direction in the ORDER BY so the scan grabs the rows immediately
	// preceding the boundary; the page is reversed back to display order after fetching (D7).
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
		firstIndex := len(params) + 1
		for _, v := range keyValues {
			addParam(v)
		}
		quotedKeyColumns := make([]string, len(order.KeysetColumns))
		for i, c := range order.KeysetColumns {
			quotedKeyColumns[i] = quoteIdent(c)
		}
		predicate := adapters.BuildKeysetPredicate(quotedKeyColumns, order.KeysetDirection, req.Cursor.Mode, firstIndex, dollarPlaceholder)
		if whereSQL != "" {
			whereSQL += " AND " + predicate
		} else {
			whereSQL = "WHERE " + predicate
		}
	}

	offsetSQL := ""
	if req.Cursor.Mode == "offset" {
		idx := addParam(req.Cursor.Offset)
		offsetSQL = " OFFSET " + dollarPlaceholder(idx)
	}

	// D24: fetch pageSize + 1 to compute hasMore without a count.
	limitIdx := addParam(req.PageSize + 1)

	sqlParts := []string{"SELECT " + selectList, "FROM " + relationSQL}
	if whereSQL != "" {
		sqlParts = append(sqlParts, whereSQL)
	}
	if orderBySQL != "" {
		sqlParts = append(sqlParts, "ORDER BY "+orderBySQL)
	}
	sqlParts = append(sqlParts, "LIMIT "+dollarPlaceholder(limitIdx)+offsetSQL)
	sql := strings.Join(sqlParts, "\n")

	// Streamed straight into the builder (P2 R1) rather than materialized into a [][]*string and
	// transposed afterward: BuildKeysetPosition's CellAt is only ever called for the first and last
	// displayed row (sqltext.go), so those two full-width fetch rows are the only ones worth keeping
	// around past the row's own AppendRow call. The SQL's own "LIMIT pageSize+1" (D24) guarantees at
	// most one row ever arrives past req.PageSize, so probing it needs no early cancellation — the
	// callback just declines to push or track it.
	builder := page.NewTabularPageBuilder(columns)
	var rowCount int
	var probedExtra bool
	var firstRow, lastRow []*string
	err = streamArrayQuery(ctx, conn, sql, params, op, track, QueryOptions{TextMode: true, LogParams: true}, func(row []*string) error {
		rowCount++
		if rowCount > req.PageSize {
			probedExtra = true
			return nil
		}

		visible := row[:len(projectedColumns)]
		values := make([]*string, len(visible))
		for i, v := range visible {
			// normalizeCellText only ever rewrites a TypeClassBinary cell (the `\x…` -> `0x…`
			// bytea_output rewrite) — every other type class returns its input string unchanged, so
			// reusing the already-scanned *string directly avoids a needless extra allocation +
			// pointer per cell (P2 R1) for what is, on any non-binary column, every row of the page.
			if v == nil || columns[i].TypeClass != page.TypeClassBinary {
				values[i] = v
				continue
			}
			normalized := normalizeCellText(*v, columns[i].TypeClass)
			values[i] = &normalized
		}
		if err := builder.AppendRow(values); err != nil {
			return err
		}

		if firstRow == nil {
			firstRow = row
		}
		lastRow = row
		return nil
	})
	if err != nil {
		return page.TabularPage{}, err
	}

	if reverseRows {
		builder.Reverse()
		firstRow, lastRow = lastRow, firstRow
	}
	displayRowCount := rowCount
	if probedExtra {
		displayRowCount--
	}

	position, err := adapters.BuildKeysetPosition(adapters.KeysetPositionArgs{
		Cursor: req.Cursor, PageSize: req.PageSize, DisplayRowCount: displayRowCount,
		ProbedExtra: probedExtra, Order: order, KeysetColumnIdx: fetch.KeysetColumnIdx,
		Fingerprint: fingerprint,
		CellAt: func(row, col int) *string {
			if row == 0 {
				return firstRow[col]
			}
			return lastRow[col]
		},
	})
	if err != nil {
		return page.TabularPage{}, err
	}

	return builder.Finish(position), nil
}

func dollarPlaceholder(i int) string { return "$" + itoaPositive(i) }

func itoaPositive(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// countRows is read.ts's countRows.
func countRows(ctx context.Context, conn *pgx.Conn, op *adapters.OpCtx, track TrackQuery, target QualifiedName, filter *string) (adapters.CountResult, error) {
	relationSQL := quoteIdent(target.Schema) + "." + quoteIdent(target.Relation)
	sqlParts := []string{"SELECT count(*) AS n", "FROM " + relationSQL}
	if where := adapters.WhereClause(filter); where != "" {
		sqlParts = append(sqlParts, where)
	}
	sql := strings.Join(sqlParts, "\n")

	rows, err := runArrayQuery(ctx, conn, sql, nil, op, track, QueryOptions{TextMode: true})
	if err != nil {
		return adapters.CountResult{}, err
	}
	var raw any
	if len(rows) > 0 && len(rows[0]) > 0 && rows[0][0] != nil {
		raw = *rows[0][0]
	}
	value, err := adapters.ParseCountValue(raw)
	if err != nil {
		return adapters.CountResult{}, err
	}
	return adapters.CountResult{Value: value, Exact: true}, nil
}
