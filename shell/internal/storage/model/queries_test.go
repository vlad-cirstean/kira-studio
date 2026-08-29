package model_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

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

func TestSortSpecMarshalOmitsOtherArmKey(t *testing.T) {
	structured, err := json.Marshal(model.SortSpec{Kind: "structured", Terms: []model.SortTerm{{Column: "a", Direction: "asc"}}})
	if err != nil {
		t.Fatalf("Marshal structured: %v", err)
	}
	if strings.Contains(string(structured), `"text"`) {
		t.Errorf("structured SortSpec JSON contains text key: %s", structured)
	}

	text, err := json.Marshal(model.SortSpec{Kind: "text", Text: "x"})
	if err != nil {
		t.Fatalf("Marshal text: %v", err)
	}
	if strings.Contains(string(text), `"terms"`) {
		t.Errorf("text SortSpec JSON contains terms key: %s", text)
	}
}

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

func TestValidSavedQueryKind(t *testing.T) {
	for _, v := range []string{"filter", "console"} {
		if !model.ValidSavedQueryKind(v) {
			t.Errorf("ValidSavedQueryKind(%q) = false, want true", v)
		}
	}
	if model.ValidSavedQueryKind("banana") {
		t.Error("ValidSavedQueryKind(banana) = true, want false")
	}
}

func TestValidSavedQueryName(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"ok", "My Query", false},
		{"empty", "", true},
		{"whitespace only", "   ", true},
		{"exactly 120", strings.Repeat("a", 120), false},
		{"121 chars", strings.Repeat("a", 121), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := model.ValidSavedQueryName(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidSavedQueryName(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
		})
	}
}
