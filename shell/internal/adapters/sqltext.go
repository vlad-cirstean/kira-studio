package adapters

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// This file is the Go analogue of sql-text.ts: the genuinely shared, driver-agnostic glue the SQL
// adapters' read.go and catalog.go modules call. Everything dialect-shaped (quoting, LIMIT syntax,
// catalog SQL) stays in each adapter's own package.

// OrderTerm is one column/direction pair.
type OrderTerm struct {
	Column    string
	Direction string // "asc" | "desc"
}

// BuildOrderBy ports sql-text.ts's buildOrderBy.
func BuildOrderBy(terms []OrderTerm, quote func(string) string) string {
	parts := make([]string, len(terms))
	for i, t := range terms {
		parts[i] = quote(t.Column) + " " + strings.ToUpper(t.Direction)
	}
	return strings.Join(parts, ", ")
}

// BuildKeysetPredicate ports sql-text.ts's buildKeysetPredicate: a row-value comparison for a
// keyset boundary, e.g. (col1, col2) > (p1, p2). columns are already quoted identifiers.
// direction/mode select the operator: 'after' compares forward in the requested direction;
// 'before' — having flipped the ORDER BY and reversed the builder — needs the mirror-image
// comparison for that same flip.
func BuildKeysetPredicate(columns []string, direction, mode string, firstParamIndex int, placeholder func(int) string) string {
	operator := "<"
	if (mode == "after") == (direction == "asc") {
		operator = ">"
	}
	rhs := make([]string, len(columns))
	for i := range columns {
		rhs[i] = placeholder(firstParamIndex + i)
	}
	return fmt.Sprintf("(%s) %s (%s)", strings.Join(columns, ", "), operator, strings.Join(rhs, ", "))
}

type pageTokenPayload struct {
	V int      `json:"v"`
	K []string `json:"k"`
	F string   `json:"f"`
}

// EncodePageToken ports sql-text.ts's encodePageToken. base64.RawURLEncoding matches Node's
// unpadded 'base64url' encoding.
func EncodePageToken(key []string, fingerprint string) string {
	payload := pageTokenPayload{V: 1, K: key, F: fingerprint}
	raw, err := json.Marshal(payload)
	if err != nil {
		// payload is a plain struct of strings; json.Marshal cannot fail on it.
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

// DecodePageToken ports sql-text.ts's decodePageToken. Returns E_QUERY when the token is
// malformed or its fingerprint no longer matches.
func DecodePageToken(token, expectedFingerprint string) ([]string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, New(CodeQuery, "malformed page token", err)
	}
	var payload pageTokenPayload
	if err := json.Unmarshal(raw, &payload); err != nil || payload.V != 1 || payload.K == nil {
		return nil, New(CodeQuery, "malformed page token", err)
	}
	if payload.F != expectedFingerprint {
		return nil, New(CodeQuery,
			"keyset pagination is unavailable for this request: the token does not match the "+
				"current filter/sort/projection/page size", nil)
	}
	return payload.K, nil
}

// RequestFingerprint ports sql-text.ts's requestFingerprint: sha1 -> hex -> first 16 chars.
// Deterministic within a process is all that is required — a token is only ever decoded by the
// process that minted it.
func RequestFingerprint(parts any) string {
	raw, err := json.Marshal(parts)
	if err != nil {
		panic(err)
	}
	sum := sha1.Sum(raw)
	return hex.EncodeToString(sum[:])[:16]
}

// ResolveProjection ports sql-text.ts's resolveProjection. requested == nil returns the input
// slice itself (identity, not a copy — callers rely on this).
func ResolveProjection(columns []model.ColumnMeta, requested []string) ([]model.ColumnMeta, error) {
	if requested == nil {
		return columns, nil
	}
	byName := make(map[string]model.ColumnMeta, len(columns))
	for _, c := range columns {
		byName[c.Name] = c
	}
	seen := make(map[string]struct{}, len(requested))
	resolved := make([]model.ColumnMeta, 0, len(requested))
	for _, name := range requested {
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		col, ok := byName[name]
		if !ok {
			return nil, New(CodeNotFound, "unknown column in projection: "+name, nil)
		}
		resolved = append(resolved, col)
	}
	sort.Slice(resolved, func(i, j int) bool { return resolved[i].Position < resolved[j].Position })
	return resolved, nil
}

// SafeInt ports sql-text.ts's safeInt. Go's int is already integral, so only the negative check
// survives — app-generated integers only (pageSize+1, a port-validated offset), inlined into SQL
// rather than bound, per each adapter's own note.
func SafeInt(value int, label string) (int, error) {
	if value < 0 {
		return 0, New(CodeQuery, fmt.Sprintf("invalid %s: %d", label, value), nil)
	}
	return value, nil
}

// WhereClause ports sql-text.ts's whereClause: WHERE (<filter>) or "" — always parenthesised so a
// keyset predicate joined by a bare AND never silently changes the user's own filter's meaning.
func WhereClause(filter *string) string {
	if filter == nil || strings.TrimSpace(*filter) == "" {
		return ""
	}
	return "WHERE (" + *filter + ")"
}

// ParseCountValue ports sql-text.ts's parseCountValue. int64 rather than float64: count(*) is a
// 64-bit integer and JS's Number was the lossy half of this port, not a design choice to keep.
func ParseCountValue(raw any) (int64, error) {
	switch v := raw.(type) {
	case int64:
		return v, nil
	case int:
		return int64(v), nil
	case string:
		var n int64
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n, nil
		}
	}
	return 0, New(CodeQuery, fmt.Sprintf("count returned a non-numeric result: %v", raw), nil)
}

// PrimaryKeyFromIndexes ports sql-text.ts's primaryKeyFromIndexes. nil when there is none.
func PrimaryKeyFromIndexes(indexes []model.IndexMeta) []string {
	for _, idx := range indexes {
		if idx.Primary {
			return idx.Columns
		}
	}
	return nil
}

// KeyShape is the Go analogue of resolveKeyShape's return object.
type KeyShape struct {
	Columns    []model.ColumnMeta
	PrimaryKey []string
	UniqueKeys [][]string
}

// ResolveKeyShape ports sql-text.ts's resolveKeyShape.
func ResolveKeyShape(raw []model.ColumnMeta, indexes []model.IndexMeta) KeyShape {
	primaryKey := PrimaryKeyFromIndexes(indexes)
	pkColumns := make(map[string]struct{}, len(primaryKey))
	for _, c := range primaryKey {
		pkColumns[c] = struct{}{}
	}
	columns := make([]model.ColumnMeta, len(raw))
	nullableByName := make(map[string]bool, len(raw))
	for i, c := range raw {
		_, isPK := pkColumns[c.Name]
		c.IsPrimaryKey = isPK
		columns[i] = c
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
	return KeyShape{Columns: columns, PrimaryKey: primaryKey, UniqueKeys: uniqueKeys}
}

var trailingSemicolonRE = regexp.MustCompile(`;\s*$`)

// StripOneTrailingSemicolon ports sql-text.ts's stripOneTrailingSemicolon.
func StripOneTrailingSemicolon(text string) string {
	loc := trailingSemicolonRE.FindStringIndex(text)
	if loc == nil {
		return text
	}
	return text[:loc[0]]
}

// SingleStatusPage ports sql-text.ts's singleStatusPage: the one-column, one-row "status" page a
// console statement with no result set returns. dataType varies (ClickHouse spells it "String").
func SingleStatusPage(text, dataType string) page.TabularPage {
	columns := []page.ColumnDescriptor{{
		Name: "status", DataType: dataType, TypeClass: page.TypeClassText,
		Nullable: false, IsPrimaryKey: false, Generated: false,
	}}
	builder := page.NewTabularPageBuilder(columns)
	_ = builder.AppendRow([]*string{&text})
	return builder.Finish(page.UnpagedPosition(1))
}

// AssertKeysetSupported ports sql-text.ts's assertKeysetSupported.
func AssertKeysetSupported(wantsKeyset, isTextSort, eligible bool) error {
	if wantsKeyset && (isTextSort || !eligible) {
		return New(CodeUnsupported,
			"keyset pagination is unavailable for this sort; the client must use an offset cursor", nil)
	}
	return nil
}

// EffectiveOrder is the Go analogue of sql-text.ts's EffectiveOrder.
type EffectiveOrder struct {
	Terms           []OrderTerm
	KeysetEligible  bool
	KeysetColumns   []string
	KeysetDirection string
}

// ComputeEffectiveOrder ports sql-text.ts's computeEffectiveOrder — the D7 keyset-eligibility rule.
func ComputeEffectiveOrder(sort_ *model.SortSpec, columns []model.ColumnMeta, tiebreaker []string) (EffectiveOrder, error) {
	if sort_ != nil && sort_.Kind == "text" {
		return EffectiveOrder{KeysetDirection: "asc"}, nil
	}

	var requestedTerms []OrderTerm
	if sort_ != nil && sort_.Kind == "structured" {
		for _, t := range sort_.Terms {
			requestedTerms = append(requestedTerms, OrderTerm{Column: t.Column, Direction: t.Direction})
		}
	}
	if len(requestedTerms) > 0 {
		byName := make(map[string]struct{}, len(columns))
		for _, c := range columns {
			byName[c.Name] = struct{}{}
		}
		for _, t := range requestedTerms {
			if _, ok := byName[t.Column]; !ok {
				return EffectiveOrder{}, New(CodeNotFound, "unknown column in sort: "+t.Column, nil)
			}
		}
	}

	uniform := true
	for _, t := range requestedTerms {
		if t.Direction != requestedTerms[0].Direction {
			uniform = false
			break
		}
	}
	if !uniform {
		return EffectiveOrder{Terms: requestedTerms, KeysetDirection: "asc"}, nil
	}
	direction := "asc"
	if len(requestedTerms) > 0 {
		direction = requestedTerms[0].Direction
	}

	if tiebreaker == nil {
		return EffectiveOrder{Terms: requestedTerms, KeysetDirection: direction}, nil
	}

	already := make(map[string]struct{}, len(requestedTerms))
	for _, t := range requestedTerms {
		already[t.Column] = struct{}{}
	}
	terms := append([]OrderTerm{}, requestedTerms...)
	var keysetColumns []string
	for _, t := range requestedTerms {
		keysetColumns = append(keysetColumns, t.Column)
	}
	for _, c := range tiebreaker {
		if _, ok := already[c]; ok {
			continue
		}
		terms = append(terms, OrderTerm{Column: c, Direction: direction})
		keysetColumns = append(keysetColumns, c)
	}
	return EffectiveOrder{
		Terms: terms, KeysetEligible: true, KeysetColumns: keysetColumns, KeysetDirection: direction,
	}, nil
}

// FetchColumns is the Go analogue of sql-text.ts's resolveFetchColumns return object.
type FetchColumns struct {
	Columns         []model.ColumnMeta
	KeysetColumnIdx map[string]int
}

// ResolveFetchColumns ports sql-text.ts's resolveFetchColumns. resolveHidden nil uses the default
// by-name lookup; sqlite passes its own rowid-aware resolver in P58b.
func ResolveFetchColumns(projected, all []model.ColumnMeta, order EffectiveOrder, resolveHidden func(string) (model.ColumnMeta, error)) (FetchColumns, error) {
	projectedNames := make(map[string]struct{}, len(projected))
	for _, c := range projected {
		projectedNames[c.Name] = struct{}{}
	}
	columnByName := make(map[string]model.ColumnMeta, len(all))
	for _, c := range all {
		columnByName[c.Name] = c
	}
	resolve := resolveHidden
	if resolve == nil {
		resolve = func(name string) (model.ColumnMeta, error) {
			col, ok := columnByName[name]
			if !ok {
				return model.ColumnMeta{}, New(CodeQuery, "keyset tiebreaker column not found: "+name, nil)
			}
			return col, nil
		}
	}
	fetchColumns := append([]model.ColumnMeta{}, projected...)
	if order.KeysetEligible {
		for _, name := range order.KeysetColumns {
			if _, already := projectedNames[name]; already {
				continue
			}
			col, err := resolve(name)
			if err != nil {
				return FetchColumns{}, err
			}
			fetchColumns = append(fetchColumns, col)
		}
	}
	keysetColumnIdx := make(map[string]int, len(order.KeysetColumns))
	for _, name := range order.KeysetColumns {
		idx := -1
		for i, c := range fetchColumns {
			if c.Name == name {
				idx = i
				break
			}
		}
		keysetColumnIdx[name] = idx
	}
	return FetchColumns{Columns: fetchColumns, KeysetColumnIdx: keysetColumnIdx}, nil
}

// BuildScanOrderBy ports sql-text.ts's buildScanOrderBy: a text sort verbatim, else the effective
// terms with every direction flipped when the fetch runs backwards for a 'before' cursor.
func BuildScanOrderBy(sort_ *model.SortSpec, order EffectiveOrder, reverseRows bool, quote func(string) string) string {
	if sort_ != nil && sort_.Kind == "text" {
		return sort_.Text
	}
	if len(order.Terms) == 0 {
		return ""
	}
	scanTerms := order.Terms
	if reverseRows {
		scanTerms = make([]OrderTerm, len(order.Terms))
		for i, t := range order.Terms {
			d := "asc"
			if t.Direction == "asc" {
				d = "desc"
			}
			scanTerms[i] = OrderTerm{Column: t.Column, Direction: d}
		}
	}
	return BuildOrderBy(scanTerms, quote)
}

// KeysetPositionArgs is the Go analogue of sql-text.ts's buildKeysetPosition argument object.
// A8: DisplayRowCount + CellAt replaces the TS generic Row type — the same dependency (a fetched
// row's cell as text), spelled without a type parameter every caller would otherwise have to name.
type KeysetPositionArgs struct {
	Cursor          model.PageCursor
	PageSize        int
	DisplayRowCount int
	ProbedExtra     bool
	Order           EffectiveOrder
	KeysetColumnIdx map[string]int
	Fingerprint     string
	CellAt          func(row, col int) *string
}

// BuildKeysetPosition ports sql-text.ts's buildKeysetPosition — D7's whole forward-and-backward
// token rule.
func BuildKeysetPosition(args KeysetPositionArgs) (page.PagePosition, error) {
	rowCount := args.DisplayRowCount

	strategy := "offset"
	if args.Order.KeysetEligible {
		strategy = "keyset"
	}

	hasMore := false
	if rowCount != 0 {
		if args.Cursor.Mode == "before" {
			hasMore = true
		} else {
			hasMore = args.ProbedExtra
		}
	}

	keysetValuesOf := func(row int) ([]string, error) {
		values := make([]string, len(args.Order.KeysetColumns))
		for i, name := range args.Order.KeysetColumns {
			idx, ok := args.KeysetColumnIdx[name]
			var v *string
			if ok && idx >= 0 {
				v = args.CellAt(row, idx)
			}
			if v == nil {
				return nil, New(CodeQuery, fmt.Sprintf("keyset tiebreaker column %q was NULL", name), nil)
			}
			values[i] = *v
		}
		return values, nil
	}

	var nextToken, prevToken *string
	if args.Order.KeysetEligible && rowCount > 0 {
		hasForward := args.ProbedExtra
		if args.Cursor.Mode == "before" {
			hasForward = true
		}
		var hasBackward bool
		switch args.Cursor.Mode {
		case "before":
			hasBackward = args.ProbedExtra
		case "after":
			hasBackward = true
		default:
			hasBackward = args.Cursor.Offset > 0
		}
		if hasForward {
			values, err := keysetValuesOf(rowCount - 1)
			if err != nil {
				return page.PagePosition{}, err
			}
			token := EncodePageToken(values, args.Fingerprint)
			nextToken = &token
		}
		if hasBackward {
			values, err := keysetValuesOf(0)
			if err != nil {
				return page.PagePosition{}, err
			}
			token := EncodePageToken(values, args.Fingerprint)
			prevToken = &token
		}
	}

	var offset *int
	if args.Cursor.Mode == "offset" {
		o := args.Cursor.Offset
		offset = &o
	}

	return page.PagePosition{
		Offset: offset, PageSize: args.PageSize, HasMore: hasMore,
		NextToken: nextToken, PrevToken: prevToken, Strategy: strategy,
	}, nil
}
