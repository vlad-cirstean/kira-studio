package adapters

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// This file hoists the prologue postgres/mysqlfamily/sqlite's own readPage each ran verbatim
// (P94 pass 2, commit 1): tiebreaker selection, effective-order computation, keyset support
// assertion, fetch-column resolution, display column construction, the request fingerprint and the
// scan ORDER BY. SQL text assembly, parameter binding and row streaming genuinely differ per
// dialect and stay in each adapter.

// RelationalPageArgs is what the three SQL adapters' readPage prologues actually differ on, beyond
// the columns/projection/sort/cursor every one of them shares.
type RelationalPageArgs struct {
	Columns    []model.ColumnMeta
	Projection []string
	PrimaryKey []string
	UniqueKeys [][]string
	// ExtraTiebreaker is consulted only when PrimaryKey is nil and UniqueKeys is empty — sqlite's
	// own RowidColumn fallback (D22/F23). nil for postgres/mysqlfamily.
	ExtraTiebreaker []string
	Sort            *model.SortSpec
	CursorMode      string
	// ResolveHidden resolves a keyset tiebreaker column not among target.Columns — sqlite's own
	// synthetic rowid ColumnMeta. nil for postgres/mysqlfamily, which have no such case.
	ResolveHidden func(name string) (model.ColumnMeta, error)
	TypeClassFor  func(dataType string) page.TypeClass
	// GeneratedFor reports the ColumnDescriptor.Generated flag per column name — sqlite consults
	// target.GeneratedColumns; postgres/mysqlfamily always return false (P36 D28: not detected
	// there yet).
	GeneratedFor func(name string) bool
	QuoteIdent   func(string) string
	// Fingerprint is the already-built, adapter-specific struct (its Path field's type differs per
	// adapter) passed straight to RequestFingerprint.
	Fingerprint any
}

// RelationalPagePlan is the prologue's output: everything readPage needs before it starts
// assembling dialect-specific SQL text.
type RelationalPagePlan struct {
	ProjectedColumns []model.ColumnMeta
	Order            EffectiveOrder
	Fetch            FetchColumns
	Columns          []page.ColumnDescriptor
	Fingerprint      string
	ReverseRows      bool
	OrderBySQL       string
	WantsKeyset      bool
}

// PlanRelationalPage runs the shared readPage prologue. See the per-adapter readPage for the
// dialect-specific SQL text, parameter binding and streaming that follow it.
func PlanRelationalPage(args RelationalPageArgs) (RelationalPagePlan, error) {
	projectedColumns, err := ResolveProjection(args.Columns, args.Projection)
	if err != nil {
		return RelationalPagePlan{}, err
	}

	tiebreaker := selectTiebreaker(args.PrimaryKey, args.UniqueKeys, args.ExtraTiebreaker)
	order, err := ComputeEffectiveOrder(args.Sort, args.Columns, tiebreaker)
	if err != nil {
		return RelationalPagePlan{}, err
	}

	isTextSort := args.Sort != nil && args.Sort.Kind == "text"
	wantsKeyset := args.CursorMode == "after" || args.CursorMode == "before"
	if err := AssertKeysetSupported(wantsKeyset, isTextSort, order.KeysetEligible); err != nil {
		return RelationalPagePlan{}, err
	}

	// The tiebreaker's columns must be fetched even when the caller did not project them — a
	// next/prev token needs their values regardless of what the grid displays.
	fetch, err := ResolveFetchColumns(projectedColumns, args.Columns, order, args.ResolveHidden)
	if err != nil {
		return RelationalPagePlan{}, err
	}

	columns := make([]page.ColumnDescriptor, len(projectedColumns))
	for i, c := range projectedColumns {
		columns[i] = page.ColumnDescriptor{
			Name: c.Name, DataType: c.DataType, TypeClass: args.TypeClassFor(c.DataType),
			Nullable: c.Nullable, IsPrimaryKey: c.IsPrimaryKey,
			Generated: args.GeneratedFor(c.Name),
		}
	}

	fingerprint := RequestFingerprint(args.Fingerprint)

	// "before" flips every direction in the ORDER BY so the scan grabs the rows immediately
	// preceding the boundary; the page is reversed back to display order after fetching (D7).
	reverseRows := args.CursorMode == "before" && order.KeysetEligible
	orderBySQL := BuildScanOrderBy(args.Sort, order, reverseRows, args.QuoteIdent)

	return RelationalPagePlan{
		ProjectedColumns: projectedColumns,
		Order:            order,
		Fetch:            fetch,
		Columns:          columns,
		Fingerprint:      fingerprint,
		ReverseRows:      reverseRows,
		OrderBySQL:       orderBySQL,
		WantsKeyset:      wantsKeyset,
	}, nil
}

// selectTiebreaker picks the primary key, else the first unique key, else (only when the caller
// supplied one, per sqlite's own rowid fallback) extra — the same fallback chain each readPage's
// prologue ran inline.
func selectTiebreaker(primaryKey []string, uniqueKeys [][]string, extra []string) []string {
	switch {
	case primaryKey != nil:
		return primaryKey
	case len(uniqueKeys) > 0:
		return uniqueKeys[0]
	case extra != nil:
		return extra
	default:
		return nil
	}
}
