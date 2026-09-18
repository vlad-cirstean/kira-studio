package mongo

import (
	"context"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	mongodriver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// idText is read.ts's idText: EJSON.stringify(doc._id, {relaxed:false}) — C3. bson.MarshalExtJSON
// cannot encode a bare scalar at the top level (only a document, M7.0's own IDText probe finding),
// so id is wrapped in a one-field document, marshalled, and the wrapper text stripped back off.
// literal.go's ParseFilterObject/ParseJSON5Literal must accept whatever this emits (§1.5).
func IDText(id any) (string, error) {
	data, err := bson.MarshalExtJSON(bson.D{{Key: "v", Value: id}}, true, false)
	if err != nil {
		return "", err
	}
	s := strings.TrimPrefix(string(data), `{"v":`)
	return strings.TrimSuffix(s, "}"), nil
}

// ejsonStringify is EJSON.stringify(v, opts). canonical mirrors the TS call sites exactly: every
// id/body text passes {relaxed: false} (canonical=true here) for byte-exact round-tripping through
// literal.go's parser, while op.SetCommand's own rendered filter text is bson.js's default
// EJSON.stringify(filter) with no options — relaxed (canonical=false here), the human-readable
// form (plain numbers instead of {"$numberInt":...} wrappers).
func ejsonStringify(v any, canonical bool) (string, error) {
	data, err := bson.MarshalExtJSON(v, canonical, false)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// readReq is the field subset of adapters.ReadRequest readPage needs, minus Path (already
// resolved by the caller into db/collection).
type readReq struct {
	Projection []string
	Filter     *string
	Sort       *model.SortSpec
	PageSize   int
	Cursor     model.PageCursor
}

// readSortPlan is readPage's sort/keyset eligibility resolution — the two directions (mongoDirection,
// the sort's own; scanDirection, what the find() itself issues) diverge only for a "before" keyset
// scan, which walks toward the boundary from the near side and is reversed back to display order
// after fetching.
type readSortPlan struct {
	sortTerms     []model.SortTerm
	idOnlySort    bool
	wantsKeyset   bool
	reverseRows   bool
	scanDirection int
}

func resolveReadSortPlan(req readReq) (readSortPlan, error) {
	if req.Sort != nil && req.Sort.Kind == "text" {
		return readSortPlan{}, adapters.Unsupported("mongodb", "a free-text sort expression")
	}
	var sortTerms []model.SortTerm
	if req.Sort != nil && req.Sort.Kind == "structured" {
		sortTerms = req.Sort.Terms
	}
	idOnlySort := len(sortTerms) == 0 || (len(sortTerms) == 1 && sortTerms[0].Column == "_id")
	direction := "asc"
	if len(sortTerms) > 0 {
		direction = sortTerms[0].Direction
	}
	wantsKeyset := req.Cursor.Mode == "after" || req.Cursor.Mode == "before"
	if wantsKeyset && !idOnlySort {
		return readSortPlan{}, adapters.New(adapters.CodeUnsupported,
			"keyset pagination is unavailable for this sort; the client must use an offset cursor", nil)
	}
	reverseRows := req.Cursor.Mode == "before" && idOnlySort
	mongoDirection := 1
	if direction == "desc" {
		mongoDirection = -1
	}
	scanDirection := mongoDirection
	if reverseRows {
		scanDirection = -mongoDirection
	}
	return readSortPlan{sortTerms, idOnlySort, wantsKeyset, reverseRows, scanDirection}, nil
}

// buildKeysetFilter extends baseFilter with the _id keyset boundary decoded from the cursor token,
// when the request actually wants one — the comparison operator tracks the scan's own direction
// (plan.scanDirection), not which user-facing request ('after'/'before') caused it.
func buildKeysetFilter(req readReq, plan readSortPlan, baseFilter bson.D, fingerprint string) (bson.D, error) {
	if !(plan.idOnlySort && plan.wantsKeyset && req.Cursor.Mode != "offset") {
		return baseFilter, nil
	}
	keyValues, err := adapters.DecodePageToken(req.Cursor.Token, fingerprint)
	if err != nil {
		return nil, err
	}
	if len(keyValues) != 1 {
		return nil, adapters.New(adapters.CodeQuery, "malformed page token", nil)
	}
	boundaryID, err := ParseJSON5Literal(keyValues[0])
	if err != nil {
		return nil, adapters.New(adapters.CodeQuery, "malformed page token", nil)
	}
	boundaryID = ResolveEJSONWrappers(boundaryID)
	cmpOp := "$gt"
	if plan.scanDirection == -1 {
		cmpOp = "$lt"
	}
	return mergeKeysetIDCondition(baseFilter, cmpOp, boundaryID), nil
}

// buildFindOptions assembles find()'s own options — limit, projection, sort, skip — from req and
// the already-resolved sort plan.
func buildFindOptions(req readReq, plan readSortPlan, op *adapters.OpCtx) (*options.FindOptionsBuilder, error) {
	limit, err := adapters.SafeInt(req.PageSize+1, "page size") // D24's +1 probe, mirroring the SQL adapters
	if err != nil {
		return nil, err
	}
	findOpts := options.Find().SetLimit(int64(limit)).SetComment(op.OpID)
	// req.Projection is the generic ReadRequest field every adapter shares (Adapter rule 7's
	// relational precedent) — Mongo's own shape for "return a field subset" is a find() options
	// projection document, {field: 1, ...}. _id is never listed here even when the caller omitted
	// it from the picker: an inclusion projection returns _id by default unless it is explicitly
	// excluded (_id: 0), and this adapter never sends that exclusion, so the document's identity
	// always survives regardless of which fields the UI's picker has checked.
	if len(req.Projection) > 0 {
		proj := make(bson.D, len(req.Projection))
		for i, field := range req.Projection {
			proj[i] = bson.E{Key: field, Value: 1}
		}
		findOpts.SetProjection(proj)
	}
	if plan.idOnlySort {
		findOpts.SetSort(bson.D{{Key: "_id", Value: plan.scanDirection}})
	} else if len(plan.sortTerms) > 0 {
		sortDoc := make(bson.D, len(plan.sortTerms))
		for i, t := range plan.sortTerms {
			d := 1
			if t.Direction == "desc" {
				d = -1
			}
			sortDoc[i] = bson.E{Key: t.Column, Value: d}
		}
		findOpts.SetSort(sortDoc)
	}
	// P43 iter2 D24: any offset cursor with a non-zero offset applies skip, not just a non-_id
	// sort — skip() has no relationship to which sort is in force. The > 0 test keeps the
	// ordinary first page issuing no skip at all.
	if req.Cursor.Mode == "offset" && req.Cursor.Offset > 0 {
		offset, err := adapters.SafeInt(req.Cursor.Offset, "offset")
		if err != nil {
			return nil, err
		}
		findOpts.SetSkip(int64(offset))
	}
	return findOpts, nil
}

// buildKeysetTokens computes readPage's next/prev page tokens from the already-reversed
// displayDocs — only meaningful under the _id-keyset strategy (plan.idOnlySort), nil/nil otherwise.
func buildKeysetTokens(req readReq, plan readSortPlan, displayDocs []bson.Raw, probedExtra bool, fingerprint string) (nextToken, prevToken *string, err error) {
	if !plan.idOnlySort || len(displayDocs) == 0 {
		return nil, nil, nil
	}
	rowCount := len(displayDocs)
	hasForward := probedExtra
	if req.Cursor.Mode == "before" {
		hasForward = true
	}
	var hasBackward bool
	switch req.Cursor.Mode {
	case "before":
		hasBackward = probedExtra
	case "after":
		hasBackward = true
	default:
		hasBackward = req.Cursor.Offset > 0
	}
	if hasForward {
		text, err := IDText(displayDocs[rowCount-1].Lookup("_id"))
		if err != nil {
			return nil, nil, mapError(err)
		}
		token := adapters.EncodePageToken([]string{text}, fingerprint)
		nextToken = &token
	}
	if hasBackward {
		text, err := IDText(displayDocs[0].Lookup("_id"))
		if err != nil {
			return nil, nil, mapError(err)
		}
		token := adapters.EncodePageToken([]string{text}, fingerprint)
		prevToken = &token
	}
	return nextToken, prevToken, nil
}

// buildReadPage is readPage's reverse/probe/token tail: turns the fetched (pageSize+1-probed) docs
// into a page.DocumentPage, including the _id-keyset next/prev tokens when idOnlySort applies.
func buildReadPage(req readReq, plan readSortPlan, docs []bson.Raw, fingerprint string) (page.DocumentPage, error) {
	probedExtra := len(docs) > req.PageSize
	keptDocs := docs
	if probedExtra {
		keptDocs = docs[:req.PageSize]
	}
	displayDocs := keptDocs
	if plan.reverseRows {
		displayDocs = make([]bson.Raw, len(keptDocs))
		for i, d := range keptDocs {
			displayDocs[len(keptDocs)-1-i] = d
		}
	}
	rowCount := len(displayDocs)

	builder := page.NewDocumentPageBuilder(false)
	for _, doc := range displayDocs {
		idStr, err := IDText(doc.Lookup("_id"))
		if err != nil {
			return page.DocumentPage{}, mapError(err)
		}
		bodyStr, err := ejsonStringify(doc, true)
		if err != nil {
			return page.DocumentPage{}, mapError(err)
		}
		builder.Push(idStr, bodyStr)
	}

	strategy := "offset"
	if plan.idOnlySort {
		strategy = "keyset"
	}
	hasMore := false
	if rowCount > 0 {
		if req.Cursor.Mode == "before" {
			hasMore = true
		} else {
			hasMore = probedExtra
		}
	}

	nextToken, prevToken, err := buildKeysetTokens(req, plan, displayDocs, probedExtra, fingerprint)
	if err != nil {
		return page.DocumentPage{}, err
	}

	var offsetPtr *int
	if req.Cursor.Mode == "offset" {
		o := req.Cursor.Offset
		offsetPtr = &o
	}

	position := page.PagePosition{
		Offset: offsetPtr, PageSize: req.PageSize, HasMore: hasMore,
		NextToken: nextToken, PrevToken: prevToken, Strategy: strategy,
	}
	return builder.Finish(position), nil
}

// readPage ports read.ts's readPage. D6: _id-keyset when the request is unsorted or sorted purely
// by _id; skip/limit fallback for any other sort.
func readPage(ctx context.Context, db *mongodriver.Database, collectionName string, req readReq, op *adapters.OpCtx) (page.DocumentPage, error) {
	plan, err := resolveReadSortPlan(req)
	if err != nil {
		return page.DocumentPage{}, err
	}
	collection := db.Collection(collectionName)
	baseFilter, err := ParseFilterObject(req.Filter)
	if err != nil {
		return page.DocumentPage{}, err
	}

	fingerprint := adapters.RequestFingerprint(struct {
		Path     string          `json:"path"`
		Filter   *string         `json:"filter"`
		Sort     *model.SortSpec `json:"sort"`
		PageSize int             `json:"pageSize"`
	}{collectionName, req.Filter, req.Sort, req.PageSize})

	filter, err := buildKeysetFilter(req, plan, baseFilter, fingerprint)
	if err != nil {
		return page.DocumentPage{}, err
	}

	findOpts, err := buildFindOptions(req, plan, op)
	if err != nil {
		return page.DocumentPage{}, err
	}

	filterText, err := ejsonStringify(filter, false)
	if err != nil {
		return page.DocumentPage{}, mapError(err)
	}
	op.SetCommand("db." + collectionName + ".find(" + filterText + ")")

	// docs is left as bson.Raw — the driver's own wire bytes — rather than decoded into bson.D.
	// P2 R2 (task #96): the id/body text below only ever re-marshals each document straight back
	// to EJSON (IDText/ejsonStringify), never inspects or mutates a decoded field, so decoding into
	// bson.D first paid a full reflection-driven tree build only to walk it again on the way back
	// out. bson.Raw/bson.RawValue have their own codecs (rawEncodeValue/rawValueEncodeValue) that
	// bson.MarshalExtJSON dispatches to automatically, streaming the wire bytes straight into the
	// EJSON writer with no intermediate tree at all.
	docs, err := adapters.RunWithAbortRace(ctx, func() {}, func(queryCtx context.Context) ([]bson.Raw, error) {
		cursor, err := collection.Find(queryCtx, filter, findOpts)
		if err != nil {
			return nil, mapError(err)
		}
		defer cursor.Close(queryCtx)
		var out []bson.Raw
		if err := cursor.All(queryCtx, &out); err != nil {
			return nil, mapError(err)
		}
		return out, nil
	})
	if err != nil {
		return page.DocumentPage{}, err
	}

	return buildReadPage(req, plan, docs, fingerprint)
}

// lookupField returns d's value for key, and whether the key was present.
func lookupField(d bson.D, key string) (any, bool) {
	for _, e := range d {
		if e.Key == key {
			return e.Value, true
		}
	}
	return nil, false
}

// mergeKeysetIDCondition combines the keyset boundary condition ($gt/$lt boundaryID) for _id with
// whatever _id constraint the caller's own filter already carries. P2 R2 (task #94): the previous
// version only handled an existing operator document (e.g. {"_id": {"$in": [...]}}) — it type-
// asserted the existing value as bson.D and merged its operators in, but a scalar _id (a
// single-document lookup, e.g. {"_id": ObjectId("...")}) failed that assertion and was silently
// discarded when setField then overwrote the _id key outright. Wrapping in $and instead of trying
// to fold both into one _id document handles either shape without dropping anything, and also
// avoids two conflicting keys under the same _id document if the filter's own operator document
// already used the same comparison operator the keyset boundary needs.
func mergeKeysetIDCondition(baseFilter bson.D, cmpOp string, boundaryID any) bson.D {
	if _, hasExistingID := lookupField(baseFilter, "_id"); !hasExistingID {
		return setField(baseFilter, "_id", bson.D{{Key: cmpOp, Value: boundaryID}})
	}
	idCond := bson.D{{Key: "_id", Value: bson.D{{Key: cmpOp, Value: boundaryID}}}}
	return bson.D{{Key: "$and", Value: bson.A{baseFilter, idCond}}}
}

// setField returns a copy of d with key set to value, appended if absent.
func setField(d bson.D, key string, value any) bson.D {
	out := make(bson.D, 0, len(d)+1)
	replaced := false
	for _, e := range d {
		if e.Key == key {
			out = append(out, bson.E{Key: key, Value: value})
			replaced = true
			continue
		}
		out = append(out, e)
	}
	if !replaced {
		out = append(out, bson.E{Key: key, Value: value})
	}
	return out
}

// countRows ports read.ts's countRows (D5): estimatedDocumentCount() by default (Caps.ExactCount
// == false), countDocuments() (exact) only when the caller passes a non-empty filter — an
// unfiltered estimate is what the pager wants by default, but an estimate ignores any filter
// entirely, so a filtered count must always go through the exact (slow) path.
func countRows(ctx context.Context, db *mongodriver.Database, collectionName string, filter *string, op *adapters.OpCtx) (adapters.CountResult, error) {
	collection := db.Collection(collectionName)
	parsedFilter, err := ParseFilterObject(filter)
	if err != nil {
		return adapters.CountResult{}, err
	}
	wantsExact := filter != nil && strings.TrimSpace(*filter) != ""

	if wantsExact {
		value, err := adapters.RunWithAbortRace(ctx, func() {}, func(queryCtx context.Context) (int64, error) {
			n, err := collection.CountDocuments(queryCtx, parsedFilter, options.Count().SetComment(op.OpID))
			if err != nil {
				return 0, mapError(err)
			}
			return n, nil
		})
		if err != nil {
			return adapters.CountResult{}, err
		}
		return adapters.CountResult{Value: value, Exact: true}, nil
	}

	// EstimatedDocumentCount has no per-call comment/killOp-fallback tag in the driver — a single
	// fast metadata command, so this is not a gap in the cancel coverage in practice (mirrors
	// read.ts's own note that estimatedDocumentCount() has no AbortSignal support either).
	value, err := adapters.RunWithAbortRace(ctx, func() {}, func(queryCtx context.Context) (int64, error) {
		n, err := collection.EstimatedDocumentCount(queryCtx)
		if err != nil {
			return 0, mapError(err)
		}
		return n, nil
	})
	if err != nil {
		return adapters.CountResult{}, err
	}
	return adapters.CountResult{Value: value, Exact: false}, nil
}
