package codegraph

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

func TestImplementationsOfJavaContainment(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "Greeter.java", "java", nil, []codeparse.Symbol{
		sym("interface", "Greeter", 0, 0, 50, 10, -1),
	}, nil)
	seedFile(t, store, "Person.java", "java", nil, []codeparse.Symbol{
		sym("class", "Person", 0, 0, 300, 6, -1),
	}, []codeparse.Reference{
		ref("implementation", "Greeter", 0, 20, 28, 20), // inside Person's own span
	})

	targets, err := g.ImplementationsOf(ctx, Query{Path: "Greeter.java", Name: "Greeter", Byte: -1})
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "Person" || targets[0].Path != "Person.java" {
		t.Fatalf("want Person recovered by containment, got %+v", targets)
	}
}

func TestImplementationsOfTypeScriptContainment(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "Greeter.ts", "typescript", nil, []codeparse.Symbol{
		sym("interface", "Greeter", 0, 0, 50, 10, -1),
	}, nil)
	seedFile(t, store, "Robot.ts", "typescript", nil, []codeparse.Symbol{
		sym("class", "Robot", 0, 0, 300, 6, -1),
	}, []codeparse.Reference{
		ref("implementation", "Greeter", 0, 20, 28, 20),
	})

	targets, err := g.ImplementationsOf(ctx, Query{Path: "Greeter.ts", Name: "Greeter", Byte: -1})
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "Robot" {
		t.Fatalf("want Robot recovered by containment, got %+v", targets)
	}
}

func TestImplementationsOfRustIsAnImplSite(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "caller.rs", "rust", nil, nil, nil)
	seedFile(t, store, "traits.rs", "rust", nil, nil, []codeparse.Reference{
		ref("implementation", "Greeter", 0, 0, 300, 0), // the whole impl_item
	})

	targets, err := g.ImplementationsOf(ctx, Query{Path: "caller.rs", Name: "Greeter", Byte: -1})
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Path != "traits.rs" || targets[0].Name != "Greeter" || targets[0].SymbolID != 0 {
		t.Fatalf("want the impl block's own location, got %+v", targets)
	}
}

func TestImplementationsOfGoIsAlwaysEmpty(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "iface.go", "go", nil, []codeparse.Symbol{
		sym("type", "Greeter", 0, 0, 50, 5, -1),
	}, nil)

	targets, err := g.ImplementationsOf(ctx, Query{Path: "iface.go", Byte: 6})
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 0 {
		t.Fatalf("want no results for Go (§6/D4), got %+v", targets)
	}
}
