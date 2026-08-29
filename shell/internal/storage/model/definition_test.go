package model

import "testing"

func validDefinition() ObjectDefinition {
	return ObjectDefinition{
		Path: "table:orders", Kind: "table", QualifiedName: "public.orders",
		Language: "sql", Statements: []string{"CREATE TABLE orders (id int)"},
		Origin: "server", GeneratedAt: "2026-01-01T00:00:00.000Z",
	}
}

func TestValidateObjectDefinition(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		d := validDefinition()
		if !ValidateObjectDefinition(&d) {
			t.Fatalf("ValidateObjectDefinition(%+v) = false, want true", d)
		}
	})

	t.Run("empty statements rejected", func(t *testing.T) {
		d := validDefinition()
		d.Statements = []string{}
		if ValidateObjectDefinition(&d) {
			t.Errorf("ValidateObjectDefinition with empty statements = true, want false")
		}
	})

	t.Run("nil sections normalizes to empty slice", func(t *testing.T) {
		d := validDefinition()
		d.Sections = nil
		if !ValidateObjectDefinition(&d) {
			t.Fatalf("ValidateObjectDefinition(%+v) = false, want true", d)
		}
		if d.Sections == nil {
			t.Errorf("Sections is still nil, want []")
		}
		if len(d.Sections) != 0 {
			t.Errorf("Sections = %v, want empty", d.Sections)
		}
	})

	t.Run("unknown language rejected", func(t *testing.T) {
		d := validDefinition()
		d.Language = "xml"
		if ValidateObjectDefinition(&d) {
			t.Errorf("ValidateObjectDefinition with bad language = true, want false")
		}
	})

	t.Run("unknown origin rejected", func(t *testing.T) {
		d := validDefinition()
		d.Origin = "client"
		if ValidateObjectDefinition(&d) {
			t.Errorf("ValidateObjectDefinition with bad origin = true, want false")
		}
	})

	t.Run("unknown kind rejected", func(t *testing.T) {
		d := validDefinition()
		d.Kind = "nonsense"
		if ValidateObjectDefinition(&d) {
			t.Errorf("ValidateObjectDefinition with bad kind = true, want false")
		}
	})

	t.Run("unknown constraint type rejected", func(t *testing.T) {
		d := validDefinition()
		d.Constraints = []ConstraintMeta{{Name: "c1", Type: "bogus", Definition: "x"}}
		if ValidateObjectDefinition(&d) {
			t.Errorf("ValidateObjectDefinition with bad constraint type = true, want false")
		}
	})

	t.Run("valid constraint types pass", func(t *testing.T) {
		for _, ct := range []string{"primaryKey", "unique", "foreignKey", "check", "exclusion"} {
			d := validDefinition()
			d.Constraints = []ConstraintMeta{{Name: "c1", Type: ct, Definition: "x"}}
			if !ValidateObjectDefinition(&d) {
				t.Errorf("ValidateObjectDefinition with constraint type %q = false, want true", ct)
			}
		}
	})
}
