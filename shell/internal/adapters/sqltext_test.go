package adapters

import (
	"encoding/base64"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Ported one for one from tests/unit/sql-text.spec.ts (P44 F44) — see that file's own header for
// why these cases exist (computeEffectiveOrder/decodePageToken are reached by seven adapters and
// named in no live-server spec; the eligible-and-correct path is the only one Testcontainers-backed
// suites ever exercise).

func col(name string, position int, isPrimaryKey bool) model.ColumnMeta {
	return model.ColumnMeta{Name: name, Position: position, DataType: "int4", Nullable: false, IsPrimaryKey: isPrimaryKey}
}

func testColumns() []model.ColumnMeta {
	return []model.ColumnMeta{col("id", 0, true), col("name", 1, false), col("created_at", 2, false)}
}

func structuredSort(terms ...model.SortTerm) *model.SortSpec {
	return &model.SortSpec{Kind: "structured", Terms: terms}
}

func textSort(text string) *model.SortSpec {
	return &model.SortSpec{Kind: "text", Text: text}
}

// 1. a text sort is never keyset-eligible
func TestComputeEffectiveOrder_TextSortIneligible(t *testing.T) {
	got, err := ComputeEffectiveOrder(textSort("name asc"), testColumns(), []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	want := EffectiveOrder{Terms: nil, KeysetEligible: false, KeysetColumns: nil, KeysetDirection: "asc"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// 2. mixed sort directions disqualify keyset, but keep both requested terms
func TestComputeEffectiveOrder_MixedDirectionsDisqualify(t *testing.T) {
	sort := structuredSort(
		model.SortTerm{Column: "name", Direction: "asc"},
		model.SortTerm{Column: "created_at", Direction: "desc"},
	)
	got, err := ComputeEffectiveOrder(sort, testColumns(), []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	if got.KeysetEligible {
		t.Error("expected KeysetEligible = false")
	}
	if len(got.KeysetColumns) != 0 {
		t.Errorf("expected no keyset columns, got %v", got.KeysetColumns)
	}
	want := []OrderTerm{{Column: "name", Direction: "asc"}, {Column: "created_at", Direction: "desc"}}
	if !reflect.DeepEqual(got.Terms, want) {
		t.Errorf("got terms %v, want %v", got.Terms, want)
	}
}

// 3. an absent tiebreaker disqualifies keyset but keeps the requested direction
func TestComputeEffectiveOrder_NoTiebreaker(t *testing.T) {
	sort := structuredSort(model.SortTerm{Column: "name", Direction: "desc"})
	got, err := ComputeEffectiveOrder(sort, testColumns(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.KeysetEligible {
		t.Error("expected KeysetEligible = false")
	}
	if got.KeysetDirection != "desc" {
		t.Errorf("got direction %q, want desc", got.KeysetDirection)
	}
}

// 4. the tiebreaker is appended in the requested direction, deduping a column already sorted by
func TestComputeEffectiveOrder_TiebreakerAppendedDeduped(t *testing.T) {
	sort := structuredSort(model.SortTerm{Column: "name", Direction: "desc"})
	got, err := ComputeEffectiveOrder(sort, testColumns(), []string{"name", "id"})
	if err != nil {
		t.Fatal(err)
	}
	if !got.KeysetEligible {
		t.Fatal("expected KeysetEligible = true")
	}
	want := []OrderTerm{{Column: "name", Direction: "desc"}, {Column: "id", Direction: "desc"}}
	if !reflect.DeepEqual(got.Terms, want) {
		t.Errorf("got terms %v, want %v", got.Terms, want)
	}
	if !reflect.DeepEqual(got.KeysetColumns, []string{"name", "id"}) {
		t.Errorf("got keyset columns %v", got.KeysetColumns)
	}
}

// 5. no sort at all is ascending and eligible on the tiebreaker alone
func TestComputeEffectiveOrder_NoSortEligibleOnTiebreaker(t *testing.T) {
	got, err := ComputeEffectiveOrder(nil, testColumns(), []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	want := EffectiveOrder{
		Terms: []OrderTerm{{Column: "id", Direction: "asc"}}, KeysetEligible: true,
		KeysetColumns: []string{"id"}, KeysetDirection: "asc",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// 6. an unknown sort column throws E_NOT_FOUND
func TestComputeEffectiveOrder_UnknownColumn(t *testing.T) {
	sort := structuredSort(model.SortTerm{Column: "nope", Direction: "asc"})
	_, err := ComputeEffectiveOrder(sort, testColumns(), []string{"id"})
	if code, ok := CodeOf(err); !ok || code != CodeNotFound {
		t.Fatalf("got %v, want E_NOT_FOUND", err)
	}
}

// 7. a token round-trips under a matching fingerprint
func TestPageToken_RoundTrips(t *testing.T) {
	fp := RequestFingerprint(map[string]string{"filter": "x", "sort": "y"})
	token := EncodePageToken([]string{"id", "42"}, fp)
	got, err := DecodePageToken(token, fp)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"id", "42"}) {
		t.Errorf("got %v", got)
	}
}

// 8. a mismatched fingerprint is refused, naming why
func TestPageToken_MismatchedFingerprint(t *testing.T) {
	token := EncodePageToken([]string{"id", "42"}, RequestFingerprint(map[string]int{"a": 1}))
	_, err := DecodePageToken(token, RequestFingerprint(map[string]int{"a": 2}))
	code, ok := CodeOf(err)
	if !ok || code != CodeQuery {
		t.Fatalf("got %v, want E_QUERY", err)
	}
	if !contains(err.Error(), "does not match") {
		t.Errorf("message %q does not mention the mismatch", err.Error())
	}
}

// 9. a malformed token and a wrong-shape payload are both refused
func TestPageToken_Malformed(t *testing.T) {
	if _, err := DecodePageToken("not-base64-json!!", "fp"); err == nil {
		t.Error("expected an error for a malformed token")
	}
	wrongShape := base64.RawURLEncoding.EncodeToString([]byte(`{"v":2,"k":"not-an-array"}`))
	if _, err := DecodePageToken(wrongShape, "fp"); err == nil {
		t.Error("expected an error for a wrong-shape payload")
	}
}

// 10. the operator flips with both direction and mode
func TestBuildKeysetPredicate_OperatorFlips(t *testing.T) {
	ph := func(i int) string { return "$" + itoa(int64(i)) }
	cases := []struct {
		direction, mode, want string
	}{
		{"asc", "after", `("id") > ($1)`},
		{"asc", "before", `("id") < ($1)`},
		{"desc", "after", `("id") < ($1)`},
		{"desc", "before", `("id") > ($1)`},
	}
	for _, c := range cases {
		got := BuildKeysetPredicate([]string{`"id"`}, c.direction, c.mode, 1, ph)
		if got != c.want {
			t.Errorf("%s/%s: got %q, want %q", c.direction, c.mode, got, c.want)
		}
	}
}

func TestBuildKeysetPosition(t *testing.T) {
	fp := RequestFingerprint(map[string]any{"path": "t", "pageSize": 2})
	eligibleOrder := EffectiveOrder{
		Terms: []OrderTerm{{Column: "id", Direction: "asc"}}, KeysetEligible: true,
		KeysetColumns: []string{"id"}, KeysetDirection: "asc",
	}
	keysetColumnIdx := map[string]int{"id": 0}
	cellAt := func(rows [][]string) func(int, int) *string {
		return func(row, col int) *string { return &rows[row][col] }
	}

	// 14. an 'after' page with a next page reports strategy 'keyset' and both tokens
	t.Run("14", func(t *testing.T) {
		rows := [][]string{{"1"}, {"2"}}
		pos, err := BuildKeysetPosition(KeysetPositionArgs{
			Cursor: model.PageCursor{Mode: "after", Token: "x"}, PageSize: 2, DisplayRowCount: 2,
			ProbedExtra: true, Order: eligibleOrder, KeysetColumnIdx: keysetColumnIdx,
			Fingerprint: fp, CellAt: cellAt(rows),
		})
		if err != nil {
			t.Fatal(err)
		}
		if pos.Strategy != "keyset" || pos.Offset != nil || !pos.HasMore {
			t.Errorf("got %+v", pos)
		}
		assertTokenDecodesTo(t, pos.NextToken, fp, []string{"2"})
		assertTokenDecodesTo(t, pos.PrevToken, fp, []string{"1"})
	})

	// 15. a 'before' page always reports hasMore true, regardless of probedExtra
	t.Run("15", func(t *testing.T) {
		rows := [][]string{{"5"}, {"6"}}
		pos, err := BuildKeysetPosition(KeysetPositionArgs{
			Cursor: model.PageCursor{Mode: "before", Token: "x"}, PageSize: 2, DisplayRowCount: 2,
			ProbedExtra: false, Order: eligibleOrder, KeysetColumnIdx: keysetColumnIdx,
			Fingerprint: fp, CellAt: cellAt(rows),
		})
		if err != nil {
			t.Fatal(err)
		}
		if !pos.HasMore || pos.PrevToken != nil {
			t.Errorf("got %+v", pos)
		}
		assertTokenDecodesTo(t, pos.NextToken, fp, []string{"6"})
	})

	// 16. an offset page at 0 never has a prevToken
	t.Run("16", func(t *testing.T) {
		rows := [][]string{{"1"}, {"2"}}
		pos, err := BuildKeysetPosition(KeysetPositionArgs{
			Cursor: model.PageCursor{Mode: "offset", Offset: 0}, PageSize: 2, DisplayRowCount: 2,
			ProbedExtra: true, Order: eligibleOrder, KeysetColumnIdx: keysetColumnIdx,
			Fingerprint: fp, CellAt: cellAt(rows),
		})
		if err != nil {
			t.Fatal(err)
		}
		if pos.Offset == nil || *pos.Offset != 0 || pos.PrevToken != nil {
			t.Errorf("got %+v", pos)
		}
		assertTokenDecodesTo(t, pos.NextToken, fp, []string{"2"})
	})

	// 17. an offset page at >0 gets a prevToken once keyset-eligible
	t.Run("17", func(t *testing.T) {
		rows := [][]string{{"21"}, {"22"}}
		pos, err := BuildKeysetPosition(KeysetPositionArgs{
			Cursor: model.PageCursor{Mode: "offset", Offset: 20}, PageSize: 2, DisplayRowCount: 2,
			ProbedExtra: false, Order: eligibleOrder, KeysetColumnIdx: keysetColumnIdx,
			Fingerprint: fp, CellAt: cellAt(rows),
		})
		if err != nil {
			t.Fatal(err)
		}
		if pos.Offset == nil || *pos.Offset != 20 || pos.HasMore || pos.NextToken != nil {
			t.Errorf("got %+v", pos)
		}
		assertTokenDecodesTo(t, pos.PrevToken, fp, []string{"21"})
	})
}

func assertTokenDecodesTo(t *testing.T, token *string, fp string, want []string) {
	t.Helper()
	if token == nil {
		t.Fatal("expected a non-nil token")
	}
	got, err := DecodePageToken(*token, fp)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

// 11a. returns ordinal order, not request order
func TestResolveProjection_OrdinalOrder(t *testing.T) {
	got, err := ResolveProjection(testColumns(), []string{"created_at", "id"})
	if err != nil {
		t.Fatal(err)
	}
	want := []model.ColumnMeta{col("id", 0, true), col("created_at", 2, false)}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// 11b. dedups a repeated request
func TestResolveProjection_Dedups(t *testing.T) {
	got, err := ResolveProjection(testColumns(), []string{"id", "id"})
	if err != nil {
		t.Fatal(err)
	}
	want := []model.ColumnMeta{col("id", 0, true)}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
}

// 11c. nil means every column, in the input slice's identity
func TestResolveProjection_NilIsIdentity(t *testing.T) {
	columns := testColumns()
	got, err := ResolveProjection(columns, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(columns) || &got[0] != &columns[0] {
		t.Error("expected the same backing array, not a copy")
	}
}

// 11d. an unknown column throws E_NOT_FOUND
func TestResolveProjection_UnknownColumn(t *testing.T) {
	_, err := ResolveProjection(testColumns(), []string{"nope"})
	if code, ok := CodeOf(err); !ok || code != CodeNotFound {
		t.Fatalf("got %v, want E_NOT_FOUND", err)
	}
}

// 12. refuses a negative value (Go's int has no non-integer/NaN case to port — see sqltext.go's
// own comment on SafeInt).
func TestSafeInt_RefusesNegative(t *testing.T) {
	if v, err := SafeInt(5, "pageSize"); err != nil || v != 5 {
		t.Errorf("got %d, %v", v, err)
	}
	if _, err := SafeInt(-1, "pageSize"); err == nil {
		t.Error("expected an error for -1")
	}
}

// 13. strips exactly one trailing semicolon, with its trailing whitespace
func TestStripOneTrailingSemicolon(t *testing.T) {
	cases := map[string]string{
		"SELECT 1;":     "SELECT 1",
		"SELECT 1;  \n": "SELECT 1",
		"SELECT 1;;":    "SELECT 1;",
		"SELECT 1":      "SELECT 1",
	}
	for in, want := range cases {
		if got := StripOneTrailingSemicolon(in); got != want {
			t.Errorf("StripOneTrailingSemicolon(%q) = %q, want %q", in, got, want)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (func() bool {
		for i := 0; i+len(substr) <= len(s); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	})()
}
