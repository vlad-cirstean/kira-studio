package mysqlfamily

import (
	"context"
	"database/sql"
	"encoding/hex"
	"regexp"
	"strings"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// quoteIdent is read.ts's quoteIdent.
func quoteIdent(name string) string {
	if strings.ContainsRune(name, '\x00') {
		panic(adapters.New(adapters.CodeQuery, "identifier contains a NUL byte", nil))
	}
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

// binaryDatabaseTypes is B3's set: go-sql-driver's own DatabaseTypeName() already tells binary
// from text apart by the column's collation (fields.go's typeDatabaseName) — this package never
// needs to consult a collation table itself the way query.ts's typeCastString had to.
var binaryDatabaseTypes = map[string]bool{
	"BLOB": true, "TINYBLOB": true, "MEDIUMBLOB": true, "LONGBLOB": true,
	"BINARY": true, "VARBINARY": true, "GEOMETRY": true, "BIT": true,
}

// cellText is B3's cellText: a binary column's raw bytes render as 0x<hex> (D3, mirroring
// Postgres's bytea handling); everything else is the server's own text bytes, unmodified.
func cellText(raw []byte, dbType string) string {
	if binaryDatabaseTypes[dbType] {
		return "0x" + hex.EncodeToString(raw)
	}
	return string(raw)
}

var tinyint1 = regexp.MustCompile(`^tinyint\(1\)`)
var numberType = regexp.MustCompile(`^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|bit)\b`)
var temporalType = regexp.MustCompile(`^(date|datetime|timestamp|time|year)\b`)
var binaryType = regexp.MustCompile(`^(binary|varbinary|tinyblob|blob|mediumblob|longblob|geometry)\b`)

// typeClassFor is read.ts's typeClassFor — §5d's MariaDB/MySQL mapping. tinyint(1) is checked
// ahead of the general number match — it is how this family spells boolean.
func typeClassFor(dataType string) page.TypeClass {
	base := strings.ToLower(dataType)
	if tinyint1.MatchString(base) {
		return page.TypeClassBoolean
	}
	if numberType.MatchString(base) {
		return page.TypeClassNumber
	}
	if temporalType.MatchString(base) {
		return page.TypeClassTemporal
	}
	if strings.HasPrefix(base, "json") {
		return page.TypeClassJSON
	}
	if binaryType.MatchString(base) {
		return page.TypeClassBinary
	}
	return page.TypeClassText
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

// readPage is read.ts's readPage — the same eleven-step shape as postgres/read.go's.
func readPage(ctx context.Context, conn *sql.Conn, threadID uint32, op *adapters.OpCtx, track TrackQuery, target ReadTarget, req readReq) (page.TabularPage, error) {
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

	fetch, err := adapters.ResolveFetchColumns(projectedColumns, target.Columns, order, nil)
	if err != nil {
		return page.TabularPage{}, err
	}

	columns := make([]page.ColumnDescriptor, len(projectedColumns))
	for i, c := range projectedColumns {
		columns[i] = page.ColumnDescriptor{
			Name: c.Name, DataType: c.DataType, TypeClass: typeClassFor(c.DataType),
			Nullable: c.Nullable, IsPrimaryKey: c.IsPrimaryKey,
			// P36 D28: not detected here yet — false rather than a guess.
			Generated: false,
		}
	}

	relationSQL := quoteIdent(target.QualifiedName.Database) + "." + quoteIdent(target.QualifiedName.Table)
	selectNames := make([]string, len(fetch.Columns))
	for i, c := range fetch.Columns {
		selectNames[i] = quoteIdent(c.Name)
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
	// placeholder — params must line up with the two "?"s in "LIMIT ? OFFSET ?" left to right, the
	// same order the SQL text below actually emits them in.
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

	rawRows, err := runArrayQuery(ctx, conn, threadID, query, params, op, track, QueryOptions{LogParams: true})
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
		if err := builder.AppendRow(row[:len(projectedColumns)]); err != nil {
			return page.TabularPage{}, err
		}
	}
	if reverseRows {
		builder.Reverse()
	}

	displayRows := keptRows
	if reverseRows {
		displayRows = make([][]*string, len(keptRows))
		for i, row := range keptRows {
			displayRows[len(keptRows)-1-i] = row
		}
	}

	position, err := adapters.BuildKeysetPosition(adapters.KeysetPositionArgs{
		Cursor: req.Cursor, PageSize: req.PageSize, DisplayRowCount: len(displayRows),
		ProbedExtra: probedExtra, Order: order, KeysetColumnIdx: fetch.KeysetColumnIdx,
		Fingerprint: fingerprint,
		CellAt:      func(row, col int) *string { return displayRows[row][col] },
	})
	if err != nil {
		return page.TabularPage{}, err
	}

	return builder.Finish(position), nil
}

// countRows is read.ts's countRows.
func countRows(ctx context.Context, conn *sql.Conn, threadID uint32, op *adapters.OpCtx, track TrackQuery, target QualifiedName, filter *string) (adapters.CountResult, error) {
	relationSQL := quoteIdent(target.Database) + "." + quoteIdent(target.Table)
	sqlParts := []string{"SELECT count(*) AS n", "FROM " + relationSQL}
	if where := adapters.WhereClause(filter); where != "" {
		sqlParts = append(sqlParts, where)
	}
	query := strings.Join(sqlParts, "\n")

	rows, err := runArrayQuery(ctx, conn, threadID, query, nil, op, track, QueryOptions{})
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
