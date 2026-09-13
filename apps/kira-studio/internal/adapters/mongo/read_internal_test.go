package mongo

import (
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// White-box (package mongo) coverage for mergeKeysetIDCondition — task #94 (P2 R2): a scalar _id
// already present in the caller's own filter (a single-document lookup) used to be silently
// dropped once a keyset pagination token was also in play, because the old merge only recognized
// an existing _id value shaped as an operator document (bson.D), not a bare scalar. This exercises
// the merge logic directly against synthetic filters, without a live MongoDB connection.

func TestMergeKeysetIDCondition_NoExistingID(t *testing.T) {
	base := bson.D{{Key: "status", Value: "active"}}
	got := mergeKeysetIDCondition(base, "$gt", "abc123")
	want := bson.D{
		{Key: "status", Value: "active"},
		{Key: "_id", Value: bson.D{{Key: "$gt", Value: "abc123"}}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestMergeKeysetIDCondition_ScalarExistingID_NotDropped(t *testing.T) {
	// A single-document lookup by _id, combined with a keyset boundary that never legitimately
	// applies to more than one document at once — the bug this guards against silently discarded
	// this exact value and turned the query into "any document past the boundary".
	base := bson.D{{Key: "_id", Value: "scalar-id-value"}}
	got := mergeKeysetIDCondition(base, "$gt", "boundary-id")

	andValue, ok := lookupField(got, "$and")
	if !ok {
		t.Fatalf("got %+v, want an $and wrapping both the scalar _id and the keyset boundary", got)
	}
	clauses, ok := andValue.(bson.A)
	if !ok || len(clauses) != 2 {
		t.Fatalf("$and = %+v, want a 2-element bson.A", andValue)
	}
	if !reflect.DeepEqual(clauses[0], base) {
		t.Errorf("$and[0] = %+v, want the original scalar _id filter %+v unchanged", clauses[0], base)
	}
	keysetClause, ok := clauses[1].(bson.D)
	if !ok {
		t.Fatalf("$and[1] = %+v, want a bson.D", clauses[1])
	}
	idValue, ok := lookupField(keysetClause, "_id")
	if !ok {
		t.Fatalf("$and[1] = %+v, want an _id key", keysetClause)
	}
	idOp, ok := idValue.(bson.D)
	if !ok || !reflect.DeepEqual(idOp, bson.D{{Key: "$gt", Value: "boundary-id"}}) {
		t.Errorf("$and[1]._id = %+v, want {$gt: boundary-id}", idValue)
	}
}

func TestMergeKeysetIDCondition_OperatorDocumentExistingID_BothPreserved(t *testing.T) {
	// The pre-existing (already-working) shape: the user's own filter constrains _id with an
	// operator document of its own (e.g. {"_id": {"$in": [...]}}) — must still keep both
	// constraints, now via $and rather than folding into one _id document.
	existing := bson.D{{Key: "$in", Value: bson.A{"a", "b"}}}
	base := bson.D{{Key: "_id", Value: existing}}
	got := mergeKeysetIDCondition(base, "$lt", "boundary-id")

	andValue, ok := lookupField(got, "$and")
	if !ok {
		t.Fatalf("got %+v, want an $and wrapping both _id conditions", got)
	}
	clauses, ok := andValue.(bson.A)
	if !ok || len(clauses) != 2 {
		t.Fatalf("$and = %+v, want a 2-element bson.A", andValue)
	}
	if !reflect.DeepEqual(clauses[0], base) {
		t.Errorf("$and[0] = %+v, want the original filter %+v unchanged", clauses[0], base)
	}
}
