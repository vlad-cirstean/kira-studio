package model_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// TestSortSpecRoundTrip is the accept half of SortSpec's hand-written codec — note the
// "structured empty term list" case, which must round-trip as valid; see
// TestSortSpecUnmarshalRejectsInvalid for why telling it apart from an absent terms key is the
// whole reason the decoder probes into json.RawMessage.
func TestSortSpecRoundTrip(t *testing.T) {
	tests := []struct {
		name string
		spec model.SortSpec
	}{
		{"structured with terms", model.SortSpec{
			Kind:  "structured",
			Terms: []model.SortTerm{{Column: "name", Direction: "asc"}, {Column: "id", Direction: "desc"}},
		}},
		{"structured empty term list", model.SortSpec{Kind: "structured", Terms: []model.SortTerm{}}},
		{"text", model.SortSpec{Kind: "text", Text: "name asc"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(tt.spec)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}
			var got model.SortSpec
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatalf("Unmarshal: %v", err)
			}
			if diff := cmp.Diff(tt.spec, got); diff != "" {
				t.Errorf("round trip mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestSortSpecUnmarshalRejectsInvalid is the reject half, and the reason the decoder cannot just
// unmarshal into the struct: a missing `terms`/`text` key and an empty one both land as a nil Go
// slice, so only probing the raw JSON can tell "structured with no terms key" (invalid) from
// "structured with an empty term list" (valid). A bare null must be rejected too.
func TestSortSpecUnmarshalRejectsInvalid(t *testing.T) {
	tests := []struct {
		name string
		json string
	}{
		{"unknown kind", `{"kind":"banana"}`},
		{"structured missing terms", `{"kind":"structured"}`},
		{"text missing text", `{"kind":"text"}`},
		{"text over 4096 chars", `{"kind":"text","text":"` + strings.Repeat("a", 4097) + `"}`},
		{"null", `null`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got model.SortSpec
			// A JSON null unmarshals into the zero-value probe struct (kind ""), which correctly
			// falls through UnmarshalJSON's "unknown kind" branch — matching the TS build's own
			// discriminated union, which also rejects a bare null.
			if err := json.Unmarshal([]byte(tt.json), &got); err == nil {
				t.Fatalf("Unmarshal(%s) = nil error, want an error", tt.json)
			}
		})
	}
}
