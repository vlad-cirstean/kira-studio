package apiflow

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func collectionNames(t *testing.T, app *flowharness.App) []string {
	t.Helper()
	all, err := app.W.Collections.List()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, c := range all.Collections {
		names = append(names, c.Name)
	}
	return names
}

// TestCollectionOrder is the backend half of tests/ui/api-order.spec.ts (contract api-order).
func TestCollectionOrder(t *testing.T) {
	app := flowharness.New(t)
	cs := app.W.Collections
	a, b, c := newCollection(t, app, "A"), newCollection(t, app, "B"), newCollection(t, app, "C")

	mark := app.Events.Mark()
	reorder := bridge.CollectionsReorderCollectionsArgs{IDs: []string{c.ID, a.ID}}
	if err := cs.ReorderCollections(reorder); err != nil {
		t.Fatal(err)
	}
	if ch := apiChanges(t, app, mark); len(ch) != 1 || len(ch[0]) != 1 || ch[0][0].Kind != bridge.ApiDataTree {
		t.Errorf("ReorderCollections events = %+v, want one tree change", ch)
	}
	app.Contract(t, "api-order", "args:CollectionsService.ReorderCollections", reorder)
	if diff := cmp.Diff([]string{"C", "A", "B"}, collectionNames(t, app)); diff != "" {
		t.Errorf("collections (-want +got):\n%s", diff)
	}

	mark = app.Events.Mark()
	err := cs.ReorderCollections(bridge.CollectionsReorderCollectionsArgs{IDs: []string{b.ID, "nope"}})
	if ipcErr(t, err).Code != "E_BAD_REQUEST" {
		t.Fatalf("unknown id = %v, want E_BAD_REQUEST", err)
	}
	if ch := apiChanges(t, app, mark); len(ch) != 0 {
		t.Errorf("a refused reorder emitted %+v", ch)
	}
	if diff := cmp.Diff([]string{"C", "A", "B"}, collectionNames(t, app)); diff != "" {
		t.Errorf("collections after refusal (-want +got):\n%s", diff)
	}

	// Keyboard shape: Move up / Move down inside one parent.
	mk := func(parent *model.CollectionItem, kind, name string) model.CollectionItem {
		t.Helper()
		args := bridge.CollectionsCreateItemArgs{CollectionID: a.ID, Kind: kind, Name: name}
		if parent != nil {
			args.ParentID = &parent.ID
		}
		it, err := cs.CreateItem(args)
		if err != nil {
			t.Fatal(err)
		}
		return it
	}
	r1, r2, f := mk(nil, model.CollectionItemRequest, "r1"), mk(nil, model.CollectionItemRequest, "r2"), mk(nil, model.CollectionItemFolder, "f")
	mk(&f, model.CollectionItemRequest, "r3")

	up := bridge.CollectionsMoveItemsArgs{ItemIDs: []string{r2.ID}, CollectionID: a.ID, BeforeID: &r1.ID}
	if err := cs.MoveItems(up); err != nil {
		t.Fatal(err)
	}
	app.Contract(t, "api-order", "args:CollectionsService.MoveItems#up", up)
	if diff := cmp.Diff([]string{"r2", "r1", "f"}, childOrder(t, app, a.ID, nil)); diff != "" {
		t.Errorf("root after up (-want +got):\n%s", diff)
	}
	down := bridge.CollectionsMoveItemsArgs{ItemIDs: []string{r1.ID}, CollectionID: a.ID}
	if err := cs.MoveItems(down); err != nil {
		t.Fatal(err)
	}
	app.Contract(t, "api-order", "args:CollectionsService.MoveItems#down", down)
	if diff := cmp.Diff([]string{"r2", "f", "r1"}, childOrder(t, app, a.ID, nil)); diff != "" {
		t.Errorf("root after down (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff([]string{"r3"}, childOrder(t, app, a.ID, &f.ID)); diff != "" {
		t.Errorf("folder children (-want +got):\n%s", diff)
	}

	app.Restart(t)
	if diff := cmp.Diff([]string{"C", "A", "B"}, collectionNames(t, app)); diff != "" {
		t.Errorf("collections after restart (-want +got):\n%s", diff)
	}
	after, err := app.W.Collections.List()
	if err != nil {
		t.Fatal(err)
	}
	app.Contract(t, "api-order", "CollectionsService.List#ordered", after)
}
