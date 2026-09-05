package repos_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/postman"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// P4 §6.2: four cases, each guarding arithmetic rather than CRUD. Deliberately not tested — that
// CreateCollection then List returns the collection, that Rename renames, that a required field's
// absence is refused: each is AGENTS.md's "everything else gets nothing".

func newCollectionsRepo(t *testing.T) *repos.CollectionsRepo {
	return &repos.CollectionsRepo{DB: newRepos(t).DB}
}

func newRequest(url string) model.SavedRequest {
	return model.SavedRequest{
		Method: "GET", URL: url, Headers: []model.SavedHeader{},
		BodyMode: "none", CodeLanguage: "json",
	}
}

// mustCreateItem is the fixture builder every case below shares; a failure here is a broken test,
// not a finding.
func mustCreateItem(t *testing.T, r *repos.CollectionsRepo, collectionID string, parent *string, kind, name string) model.CollectionItem {
	t.Helper()
	var request *model.SavedRequest
	if kind == model.CollectionItemRequest {
		req := newRequest("https://api.example.com/" + name)
		request = &req
	}
	item, err := r.CreateItem(collectionID, parent, kind, name, request)
	if err != nil {
		t.Fatalf("CreateItem(%s): %v", name, err)
	}
	return item
}

// 1. sort_order is dense and stable across an insert, a delete, and a re-read. Order is data, not
// presentation: Postman's UI order, a runner's execution order and a diff of two exports all
// depend on it (F1).
func TestSortOrderStaysDenseAcrossInsertsAndDeletes(t *testing.T) {
	r := newCollectionsRepo(t)
	collection, err := r.CreateCollection("Ordering")
	if err != nil {
		t.Fatal(err)
	}
	folder := mustCreateItem(t, r, collection.ID, nil, model.CollectionItemFolder, "folder")
	first := mustCreateItem(t, r, collection.ID, &folder.ID, model.CollectionItemRequest, "first")
	second := mustCreateItem(t, r, collection.ID, &folder.ID, model.CollectionItemRequest, "second")
	third := mustCreateItem(t, r, collection.ID, &folder.ID, model.CollectionItemRequest, "third")

	if first.SortOrder != 0 || second.SortOrder != 1 || third.SortOrder != 2 {
		t.Fatalf("insert orders: %d %d %d", first.SortOrder, second.SortOrder, third.SortOrder)
	}
	// The root's own children index independently of the folder's.
	if root := mustCreateItem(t, r, collection.ID, nil, model.CollectionItemRequest, "root-level"); root.SortOrder != 1 {
		t.Fatalf("a root child indexed against the wrong parent: %d", root.SortOrder)
	}

	if err := r.Delete(second.ID, "item"); err != nil {
		t.Fatal(err)
	}
	orders := ordersByName(t, r, collection.ID)
	if orders["first"] != 0 || orders["third"] != 1 {
		t.Fatalf("after a delete the surviving siblings are not dense: %v", orders)
	}
	// And the next insert lands after them rather than colliding with `third`'s new index.
	if fourth := mustCreateItem(t, r, collection.ID, &folder.ID, model.CollectionItemRequest, "fourth"); fourth.SortOrder != 2 {
		t.Fatalf("insert after a delete: %d, want 2", fourth.SortOrder)
	}
}

func ordersByName(t *testing.T, r *repos.CollectionsRepo, collectionID string) map[string]int {
	t.Helper()
	_, items, err := r.List()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]int{}
	for _, item := range items {
		if item.CollectionID == collectionID {
			out[item.Name] = item.SortOrder
		}
	}
	return out
}

// 2. A folder delete cascades to arbitrary depth in one statement (F9), and does not touch a
// sibling subtree. db.go's DSN sets _foreign_keys=1 on every connection the pool opens, so the
// self-reference is genuinely enforced — there is no recursive delete in Go to test.
func TestDeletingAFolderCascadesAtDepthAndSparesItsSiblings(t *testing.T) {
	r := newCollectionsRepo(t)
	collection, err := r.CreateCollection("Cascade")
	if err != nil {
		t.Fatal(err)
	}
	doomed := mustCreateItem(t, r, collection.ID, nil, model.CollectionItemFolder, "doomed")
	mid := mustCreateItem(t, r, collection.ID, &doomed.ID, model.CollectionItemFolder, "mid")
	deep := mustCreateItem(t, r, collection.ID, &mid.ID, model.CollectionItemFolder, "deep")
	mustCreateItem(t, r, collection.ID, &deep.ID, model.CollectionItemRequest, "buried")

	kept := mustCreateItem(t, r, collection.ID, nil, model.CollectionItemFolder, "kept")
	mustCreateItem(t, r, collection.ID, &kept.ID, model.CollectionItemRequest, "spared")

	if err := r.Delete(doomed.ID, "item"); err != nil {
		t.Fatal(err)
	}
	orders := ordersByName(t, r, collection.ID)
	for _, gone := range []string{"doomed", "mid", "deep", "buried"} {
		if _, still := orders[gone]; still {
			t.Errorf("%q survived the cascade", gone)
		}
	}
	for _, alive := range []string{"kept", "spared"} {
		if _, ok := orders[alive]; !ok {
			t.Errorf("%q was taken down with a sibling subtree", alive)
		}
	}

	// The same cascade one level up: deleting the collection takes every remaining item.
	if err := r.Delete(collection.ID, "collection"); err != nil {
		t.Fatal(err)
	}
	if left := ordersByName(t, r, collection.ID); len(left) != 0 {
		t.Fatalf("deleting the collection left %d items", len(left))
	}
}

// 3. List never reads request_json — asserted by writing a row with a deliberately invalid one and
// confirming List still returns its summary while GetRequest refuses it. That is what makes the
// panel-mount query cheap (D2) and what stops one bad row from blanking the whole tree.
func TestListIgnoresRequestJSONWhileGetRequestRefusesIt(t *testing.T) {
	r := newCollectionsRepo(t)
	collection, err := r.CreateCollection("Projection")
	if err != nil {
		t.Fatal(err)
	}
	item := mustCreateItem(t, r, collection.ID, nil, model.CollectionItemRequest, "broken")
	if _, err := r.DB.Exec(`UPDATE api_items SET request_json = ? WHERE id = ?`, "{not json", item.ID); err != nil {
		t.Fatal(err)
	}

	_, items, err := r.List()
	if err != nil {
		t.Fatalf("List refused to answer because of one bad row: %v", err)
	}
	found := false
	for _, row := range items {
		if row.ID == item.ID {
			found = true
			if row.Method != "GET" || row.URL == "" {
				t.Errorf("the denormalized summary is wrong: %+v", row)
			}
		}
	}
	if !found {
		t.Fatal("List dropped a row whose request_json it never reads")
	}

	if _, err := r.GetRequest(item.ID); err == nil {
		t.Fatal("GetRequest returned a request it could not parse")
	}

	// A parseable document that fails model.SavedRequest.Validate is refused the same way.
	if _, err := r.DB.Exec(`UPDATE api_items SET request_json = ? WHERE id = ?`,
		`{"method":"GET","bodyMode":"telepathy","codeLanguage":"json"}`, item.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetRequest(item.ID); err == nil || !strings.Contains(err.Error(), "body mode") {
		t.Fatalf("GetRequest accepted an invalid body mode: %v", err)
	}
}

// 4. SaveRequest sheds exactly the changed members from origin_json and leaves the rest — D6's
// storage half. Without it an edited request keeps a stale duplicate of its own body forever, and
// export's unchanged-⇒-verbatim rule re-emits the *old* member.
func TestSaveRequestShedsOnlyTheChangedOriginMembers(t *testing.T) {
	r := newCollectionsRepo(t)
	tree, err := postman.Parse(strings.NewReader(`{
	  "info": {"name": "Shedding", "schema": "` + postman.SchemaURL + `"},
	  "item": [{
	    "name": "one",
	    "event": [{"listen": "test", "script": {"exec": ["pm.test('kept', () => {});"]}}],
	    "request": {
	      "method": "POST",
	      "url": {"raw": "https://api.example.com/one"},
	      "header": [{"key": "Accept", "value": "application/json", "description": "kept"}],
	      "body": {"mode": "raw", "raw": "original", "options": {"raw": {"language": "text"}}}
	    }
	  }]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	collection, err := r.ImportTree(tree)
	if err != nil {
		t.Fatal(err)
	}
	_, items, err := r.List()
	if err != nil {
		t.Fatal(err)
	}
	itemID := items[0].ID

	saved, err := r.GetRequest(itemID)
	if err != nil {
		t.Fatal(err)
	}
	saved.Body = "edited"
	if _, err := r.SaveRequest(itemID, "one", saved); err != nil {
		t.Fatal(err)
	}

	var originJSON string
	if err := r.DB.QueryRow(`SELECT origin_json FROM api_items WHERE id = ?`, itemID).Scan(&originJSON); err != nil {
		t.Fatal(err)
	}
	var origin map[string]json.RawMessage
	if err := json.Unmarshal([]byte(originJSON), &origin); err != nil {
		t.Fatal(err)
	}
	if _, ok := origin["event"]; !ok {
		t.Error("the item's own event[] was shed along with the body")
	}
	var request map[string]json.RawMessage
	if err := json.Unmarshal(origin["request"], &request); err != nil {
		t.Fatal(err)
	}
	if _, ok := request["body"]; ok {
		t.Error("the stale body is still in origin")
	}
	for _, kept := range []string{"url", "header"} {
		if _, ok := request[kept]; !ok {
			t.Errorf("an untouched %q was shed too", kept)
		}
	}

	// And the export that follows emits the edited body while re-emitting the untouched header
	// (with its description) verbatim — the end-to-end shape of D6 through storage.
	loaded, err := r.LoadTree(collection.ID)
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if err := postman.Write(&out, loaded); err != nil {
		t.Fatal(err)
	}
	written := out.String()
	if !strings.Contains(written, `"raw": "edited"`) {
		t.Errorf("the export did not carry the edit:\n%s", written)
	}
	if !strings.Contains(written, `"description": "kept"`) {
		t.Errorf("the untouched header lost its description:\n%s", written)
	}
	if !strings.Contains(written, "pm.test('kept'") {
		t.Errorf("the item's test script did not survive the round trip:\n%s", written)
	}
}
