package model

import "testing"

func TestEncodeDecodePathRoundTrip(t *testing.T) {
	tests := []struct {
		name     string
		segments []PathSegment
	}{
		{"simple", []PathSegment{{Kind: "schema", Name: "public"}, {Kind: "table", Name: "orders"}}},
		{"name with slash", []PathSegment{{Kind: "table", Name: "order/items"}}},
		{"name with colon", []PathSegment{{Kind: "table", Name: "a:b"}}},
		{"name with space", []PathSegment{{Kind: "table", Name: "my table"}}},
		{"non-ascii name", []PathSegment{{Kind: "table", Name: "pässwörd"}}},
		{"empty", []PathSegment{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encoded := EncodePath(tt.segments)
			decoded, err := DecodePath("conn1", encoded)
			if err != nil {
				t.Fatalf("DecodePath(%q): %v", encoded, err)
			}
			if decoded.ConnectionID != "conn1" {
				t.Errorf("ConnectionID = %q, want conn1", decoded.ConnectionID)
			}
			if len(decoded.Segments) != len(tt.segments) {
				t.Fatalf("got %d segments, want %d", len(decoded.Segments), len(tt.segments))
			}
			for i, s := range tt.segments {
				if decoded.Segments[i] != s {
					t.Errorf("segment[%d] = %+v, want %+v", i, decoded.Segments[i], s)
				}
			}
		})
	}
}

func TestDecodePathEmptyYieldsZeroSegments(t *testing.T) {
	decoded, err := DecodePath("conn1", "")
	if err != nil {
		t.Fatalf("DecodePath(\"\"): %v", err)
	}
	if len(decoded.Segments) != 0 {
		t.Errorf("Segments = %v, want empty", decoded.Segments)
	}
}

func TestDecodePathErrors(t *testing.T) {
	tests := []string{"bogus:x", "table"}
	for _, encoded := range tests {
		if _, err := DecodePath("conn1", encoded); err == nil {
			t.Errorf("DecodePath(%q): want an error, got none", encoded)
		}
	}
}

func TestValidateTreeNodes(t *testing.T) {
	tests := []struct {
		name  string
		nodes []TreeNode
		want  bool
	}{
		{"valid", []TreeNode{{Kind: "table", Name: "orders", Path: "table:orders"}}, true},
		{"invalid kind", []TreeNode{{Kind: "nonsense", Name: "orders", Path: "table:orders"}}, false},
		{"empty name", []TreeNode{{Kind: "table", Name: "", Path: "table:orders"}}, false},
		{"empty path", []TreeNode{{Kind: "table", Name: "orders", Path: ""}}, false},
		{"empty list", []TreeNode{}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ValidateTreeNodes(tt.nodes); got != tt.want {
				t.Errorf("ValidateTreeNodes(%+v) = %v, want %v", tt.nodes, got, tt.want)
			}
		})
	}
}

func TestValidateObjectMeta(t *testing.T) {
	valid := func() ObjectMeta {
		return ObjectMeta{Path: "table:orders", Kind: "table", Name: "orders", QualifiedName: "public.orders"}
	}

	t.Run("valid with nil lists normalizes to empty slices", func(t *testing.T) {
		m := valid()
		if !ValidateObjectMeta(&m) {
			t.Fatalf("ValidateObjectMeta(%+v) = false, want true", m)
		}
		if m.Columns == nil || m.ForeignKeys == nil || m.ReferencedBy == nil || m.Indexes == nil {
			t.Errorf("lists not normalized: %+v", m)
		}
	})

	t.Run("invalid kind", func(t *testing.T) {
		m := valid()
		m.Kind = "nonsense"
		if ValidateObjectMeta(&m) {
			t.Errorf("ValidateObjectMeta with bad kind = true, want false")
		}
	})

	t.Run("empty path", func(t *testing.T) {
		m := valid()
		m.Path = ""
		if ValidateObjectMeta(&m) {
			t.Errorf("ValidateObjectMeta with empty path = true, want false")
		}
	})

	t.Run("empty name", func(t *testing.T) {
		m := valid()
		m.Name = ""
		if ValidateObjectMeta(&m) {
			t.Errorf("ValidateObjectMeta with empty name = true, want false")
		}
	})

	t.Run("empty qualified name", func(t *testing.T) {
		m := valid()
		m.QualifiedName = ""
		if ValidateObjectMeta(&m) {
			t.Errorf("ValidateObjectMeta with empty qualifiedName = true, want false")
		}
	})
}
