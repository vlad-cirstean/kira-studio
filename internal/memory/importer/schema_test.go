package importer

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
)

// The structured-output schemas live in code and in the registry (shown read-only in Settings);
// they must not drift apart.
func TestSchemasMatchRegistry(t *testing.T) {
	b := &llmprompts.Bound{Store: llmprompts.NewStore(filepath.Join(t.TempDir(), "p.json")), App: llmprompts.Space}
	list, err := b.List()
	if err != nil {
		t.Fatal(err)
	}
	want := map[llmprompts.ID]string{
		llmprompts.MemoryImportExtractSystem.ID():  extractSchema,
		llmprompts.MemoryImportFinalizeSystem.ID(): finalizeSchema,
	}
	seen := 0
	for _, p := range list.Prompts {
		code, ok := want[p.ID]
		if !ok {
			continue
		}
		seen++
		var a, c any
		if err := json.Unmarshal([]byte(p.Schema), &a); err != nil {
			t.Fatalf("%s: registry schema: %v", p.ID, err)
		}
		if err := json.Unmarshal([]byte(code), &c); err != nil {
			t.Fatalf("%s: code schema: %v", p.ID, err)
		}
		if !reflect.DeepEqual(a, c) {
			t.Errorf("%s: schema in code differs from the registry", p.ID)
		}
	}
	if seen != len(want) {
		t.Fatalf("found %d of %d prompts", seen, len(want))
	}
}
