package apiflow

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/httpclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/postman"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func TestSavedRequestHistory(t *testing.T) {
	app := flowharness.New(t)
	srv := flowharness.HTTP(t)

	mark := app.Events.Mark()
	col := newCollection(t, app, "orders")
	if ch := apiChanges(t, app, mark); len(ch) != 1 || len(ch[0]) != 1 || ch[0][0].Kind != bridge.ApiDataTree {
		t.Errorf("CreateCollection events = %+v, want one tree change", ch)
	}

	req := savedGet()
	req.URL = srv.URL + "/echo?saved=1"
	item, err := app.W.Collections.CreateItem(bridge.CollectionsCreateItemArgs{
		CollectionID: col.ID, Kind: "request", Name: "list", Request: &req,
	})
	if err != nil {
		t.Fatal(err)
	}
	mark = app.Events.Mark()
	if _, err := app.W.Collections.SaveRequest(bridge.CollectionsSaveRequestArgs{ItemID: item.ID, Name: "list", Request: req}); err != nil {
		t.Fatal(err)
	}
	ch := apiChanges(t, app, mark)
	if len(ch) != 1 || !hasChange(ch[0], bridge.ApiDataChange{Kind: bridge.ApiDataTree}) ||
		!hasChange(ch[0], bridge.ApiDataChange{Kind: bridge.ApiDataSavedRequest, ItemID: item.ID}) {
		t.Errorf("SaveRequest events = %+v, want tree and savedRequest(%s)", ch, item.ID)
	}

	bound := get(req.URL)
	bound.ItemID, bound.CollectionID = item.ID, col.ID
	send(t, app, bound)
	scratch := get(srv.URL + "/echo?scratch=1")
	scratch.TabID = "scratch-tab"
	send(t, app, scratch)

	itemRows, err := app.W.ResponseHistory.List(bridge.ResponseHistoryScopeArgs{ItemID: item.ID})
	if err != nil || len(itemRows) != 1 || itemRows[0].ItemID == nil || *itemRows[0].ItemID != item.ID {
		t.Fatalf("item history = %+v (%v), want one row under the item", itemRows, err)
	}
	if tabRows, _ := app.W.ResponseHistory.List(bridge.ResponseHistoryScopeArgs{TabID: "tab-1"}); len(tabRows) != 0 {
		t.Errorf("the saved request's send also landed under its tab: %+v", tabRows)
	}

	ad, err := app.W.ResponseHistory.Adopt(bridge.ResponseHistoryAdoptArgs{TabID: "scratch-tab", ItemID: item.ID})
	if err != nil || ad.Adopted != 1 {
		t.Fatalf("Adopt = %+v (%v), want 1", ad, err)
	}
	if rows, _ := app.W.ResponseHistory.List(bridge.ResponseHistoryScopeArgs{ItemID: item.ID}); len(rows) != 2 {
		t.Errorf("item history after adopt = %d rows, want 2", len(rows))
	}
	if rows, _ := app.W.ResponseHistory.List(bridge.ResponseHistoryScopeArgs{TabID: "scratch-tab"}); len(rows) != 0 {
		t.Errorf("scratch tab still holds %d rows after adopt", len(rows))
	}

	mark = app.Events.Mark()
	if err := app.W.Collections.Delete(bridge.CollectionsTargetArgs{ID: col.ID, Target: "collection"}); err != nil {
		t.Fatal(err)
	}
	ch = apiChanges(t, app, mark)
	if len(ch) != 1 || !hasChange(ch[0], bridge.ApiDataChange{Kind: bridge.ApiDataTree}) ||
		!hasChange(ch[0], bridge.ApiDataChange{Kind: bridge.ApiDataVariables, Scope: model.VariableScopeCollection, OwnerID: col.ID}) {
		t.Errorf("collection delete events = %+v, want tree and the collection's variables", ch)
	}
	if rows, _ := app.W.ResponseHistory.List(bridge.ResponseHistoryScopeArgs{ItemID: item.ID}); len(rows) != 0 {
		t.Errorf("deleting the collection left %d history rows for its item", len(rows))
	}
	if _, err := app.W.Collections.GetRequest(bridge.CollectionsItemArgs{ItemID: item.ID}); ipcErr(t, err).Code != "E_NOT_FOUND" {
		t.Errorf("GetRequest after delete = %v, want E_NOT_FOUND", err)
	}
}

func TestVariablePrecedence(t *testing.T) {
	app := flowharness.New(t)
	srv := flowharness.HTTP(t)
	col := newCollection(t, app, "scoped")
	dev, prod := newEnv(t, app, "dev"), newEnv(t, app, "prod")

	upsertSecret(t, app, model.VariableScopeCollection, col.ID, "who", "from-collection")
	devVar := upsertSecret(t, app, model.VariableScopeEnvironment, dev.ID, "who", "from-dev")
	upsertSecret(t, app, model.VariableScopeEnvironment, prod.ID, "who", "from-prod")

	sendWho := func(envID string) string {
		t.Helper()
		args := get(srv.URL + "/echo?who={{who}}")
		args.CollectionID, args.EnvironmentID = col.ID, envID
		send(t, app, args)
		return lastRequest(srv).Query
	}
	if got := sendWho(dev.ID); got != "who=from-dev" {
		t.Errorf("with dev = %q, want the environment value over the collection's", got)
	}
	if got := sendWho(prod.ID); got != "who=from-prod" {
		t.Errorf("with prod = %q, want who=from-prod", got)
	}
	if got := sendWho(""); got != "who=from-collection" {
		t.Errorf("with no environment = %q, want the collection value", got)
	}

	if err := app.W.Variables.SetActiveEnvironment(bridge.VariablesEnvironmentIDArgs{ID: prod.ID}); err != nil {
		t.Fatal(err)
	}
	envs, err := app.W.Variables.ListEnvironments()
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range envs {
		if e.IsActive != (e.ID == prod.ID) {
			t.Errorf("environment %s active = %v", e.Name, e.IsActive)
		}
	}

	t.Run("bulk edit", func(t *testing.T) {
		upsertPlain := func(name, value string) {
			t.Helper()
			if _, err := app.W.Variables.Upsert(bridge.VariablesUpsertArgs{
				Scope: model.VariableScopeCollection, OwnerID: col.ID, Name: name, Value: ptr(value),
			}); err != nil {
				t.Fatal(err)
			}
		}
		upsertPlain("keep", "1")
		upsertPlain("change", "old")
		upsertPlain("drop", "x")
		res, err := app.W.Variables.ApplyBulk(bridge.VariablesApplyBulkArgs{
			Scope: model.VariableScopeCollection, OwnerID: col.ID,
			Entries: []model.VariableBulkEntry{
				{Name: "who", HasValue: false},
				{Name: "keep", Value: "1", HasValue: true},
				{Name: "change", Value: "new", HasValue: true},
				{Name: "added", Value: "a", HasValue: true},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if res.Added != 1 || res.Updated != 1 || res.Removed != 1 {
			t.Errorf("bulk result = %+v, want 1 added, 1 updated, 1 removed", res)
		}
		vars, err := app.W.Variables.List(bridge.VariablesScopeArgs{Scope: model.VariableScopeCollection, OwnerID: col.ID})
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		got := map[string]string{}
		for _, v := range vars {
			names = append(names, v.Name)
			got[v.Name] = v.Value
		}
		if strings.Join(names, ",") != "who,keep,change,added" || got["change"] != "new" {
			t.Errorf("variables after bulk = %v %v, want who,keep,change,added with change=new", names, got)
		}
		if got := sendWho(""); got != "who=from-collection" {
			t.Errorf("a bulk edit without a value changed the secret: %q", got)
		}
	})

	t.Run("history and reveal", func(t *testing.T) {
		upsertVal := "from-dev-2"
		if _, err := app.W.Variables.Upsert(bridge.VariablesUpsertArgs{
			Scope: model.VariableScopeEnvironment, OwnerID: dev.ID, ID: devVar.ID, Name: "who", Value: &upsertVal, IsSecret: true,
		}); err != nil {
			t.Fatal(err)
		}
		if got := sendWho(dev.ID); got != "who=from-dev-2" {
			t.Errorf("after the edit = %q, want the new value", got)
		}
		hist, err := app.W.Variables.History(bridge.VariablesHistoryArgs{VariableID: devVar.ID})
		if err != nil || len(hist) != 1 || !hist[0].IsSecret {
			t.Fatalf("history = %+v (%v), want the one replaced secret value", hist, err)
		}
		if strings.Contains(hist[0].Value, "from-dev") {
			t.Error("history list exposes a secret value")
		}

		denied := app.W.Variables.Reveal(bridge.VariablesRevealArgs{VariableID: devVar.ID})
		if denied.Outcome != "confirmation-required" || denied.Value != nil {
			t.Errorf("unconfirmed reveal = %+v, want confirmation-required without a value", denied)
		}
		ok := app.W.Variables.Reveal(bridge.VariablesRevealArgs{VariableID: devVar.ID, Confirmed: true})
		if ok.Outcome != "revealed" || ok.Value == nil || *ok.Value != "from-dev-2" {
			t.Errorf("confirmed reveal = %+v, want from-dev-2", ok)
		}
		old := app.W.Variables.RevealHistory(bridge.VariablesRevealHistoryArgs{HistoryID: hist[0].ID, Confirmed: true})
		if old.Outcome != "revealed" || old.Value == nil || *old.Value != "from-dev" {
			t.Errorf("history reveal = %+v, want from-dev", old)
		}
		if u := app.W.Variables.RevealHistory(bridge.VariablesRevealHistoryArgs{HistoryID: hist[0].ID}); u.Outcome != "confirmation-required" {
			t.Errorf("unconfirmed history reveal = %+v", u)
		}
	})

	t.Run("duplicated environment keeps secrets that decrypt", func(t *testing.T) {
		dup, err := app.W.Variables.DuplicateEnvironment(bridge.VariablesEnvironmentIDArgs{ID: dev.ID})
		if err != nil {
			t.Fatal(err)
		}
		if dup.ID == dev.ID {
			t.Fatal("duplicate has the original id")
		}
		if got := sendWho(dup.ID); got != "who=from-dev-2" {
			t.Errorf("duplicate sends %q, want who=from-dev-2", got)
		}
	})
}

// tree flattens a collection into comparable lines: folder path, kind, method, url and body.
func tree(t *testing.T, app *flowharness.App, collectionID string) []string {
	t.Helper()
	all, err := app.W.Collections.List()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]model.CollectionItem{}
	for _, it := range all.Items {
		if it.CollectionID == collectionID {
			byID[it.ID] = it
		}
	}
	path := func(it model.CollectionItem) string {
		parts := []string{it.Name}
		for it.ParentID != nil {
			it = byID[*it.ParentID]
			parts = append([]string{it.Name}, parts...)
		}
		return strings.Join(parts, "/")
	}
	var lines []string
	for _, it := range byID {
		line := path(it) + "|" + it.Kind + "|" + it.Method + "|" + it.URL
		if it.Kind == model.CollectionItemRequest && it.Protocol == model.ItemProtocolHTTP {
			r, err := app.W.Collections.GetRequest(bridge.CollectionsItemArgs{ItemID: it.ID})
			if err != nil {
				t.Fatal(err)
			}
			line += "|" + r.BodyMode + "|" + r.Body + "|" + r.Code + "|" + r.CodeLanguage + "|" + mustHeaders(r)
		}
		lines = append(lines, line)
	}
	sort.Strings(lines)
	return lines
}

func mustHeaders(r model.SavedRequest) string {
	var parts []string
	for _, h := range r.Headers {
		parts = append(parts, h.Name+"="+h.Value)
	}
	return strings.Join(parts, ";")
}

func TestPostmanImportSendExport(t *testing.T) {
	app := flowharness.New(t)
	srv := flowharness.HTTP(t)

	fixture, err := os.ReadFile(filepath.Join("testdata", "collection.json"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	imported := filepath.Join(dir, "collection.json")
	if err := os.WriteFile(imported, []byte(strings.ReplaceAll(string(fixture), "__BASE_URL__", srv.URL)), 0o600); err != nil {
		t.Fatal(err)
	}

	// Contract api-postman, read by tests/ui/collections.spec.ts "Postman import builds the tree
	// and export asks for a save path".
	const sc = "api-postman"
	pathOpts := []flowharness.ContractOption{flowharness.Replace(dir, "<tmp>"), flowharness.Replace(srv.URL, "<http>")}
	app.Dialogs.QueueOpenFile(imported)
	chosen, err := app.W.Files.ChooseOpen(bridge.FilesChooseOpenArgs{})
	if err != nil || chosen.File == nil {
		t.Fatalf("ChooseOpen = %+v (%v)", chosen, err)
	}
	app.Contract(t, sc, "FilesService.ChooseOpen", chosen, append(pathOpts, flowharness.Mask("size"))...)
	importArgs := bridge.CollectionsImportArgs{Path: chosen.File.Path}
	app.Contract(t, sc, "args:CollectionsService.Import", importArgs, pathOpts...)
	rep, err := app.W.Collections.Import(importArgs)
	if err != nil {
		t.Fatal(err)
	}
	app.Contract(t, sc, "CollectionsService.Import", rep, pathOpts...)
	if rep.Name != "Flow Orders" || rep.Folders != 1 || rep.Requests != 4 {
		t.Errorf("report = %+v, want Flow Orders with 1 folder and 4 requests", rep)
	}
	warnings := map[string]int{}
	for _, w := range rep.Warnings {
		warnings[w.Kind] = w.Count
	}
	for kind, count := range map[string]int{
		postman.WarnScriptsInert: 3, postman.WarnAuthInert: 2, postman.WarnVariablesImported: 2,
		postman.WarnGraphQLBody: 1, postman.WarnUnresolvedFile: 1,
	} {
		if warnings[kind] != count {
			t.Errorf("warning %s = %d, want %d (all: %v)", kind, warnings[kind], count, warnings)
		}
	}

	// Collection variables arrive: baseUrl is a secret, so Studio itself resolves it on the wire.
	items, err := app.W.Collections.List()
	if err != nil {
		t.Fatal(err)
	}
	app.Contract(t, sc, "CollectionsService.List", items, pathOpts...)
	var create model.CollectionItem
	for _, it := range items.Items {
		if it.Name == "Create order" && it.CollectionID == rep.CollectionID {
			create = it
		}
	}
	saved, err := app.W.Collections.GetRequest(bridge.CollectionsItemArgs{ItemID: create.ID})
	if err != nil {
		t.Fatal(err)
	}
	args := get(saved.URL)
	args.Method, args.CollectionID, args.ItemID = saved.Method, rep.CollectionID, create.ID
	args.Body.Mode, args.Body.Code, args.Body.CodeLanguage = "code", saved.Code, saved.CodeLanguage
	for _, h := range saved.Headers {
		args.Headers = append(args.Headers, headerOf(h))
	}
	send(t, app, args)
	got := lastRequest(srv)
	if got.Method != "POST" || got.Path != "/echo" || got.Header.Get("X-Flow") != "orders" || string(got.Body) != `{"sku":"x"}` {
		t.Errorf("server saw %s %s X-Flow=%q body %q, want the imported request", got.Method, got.Path, got.Header.Get("X-Flow"), got.Body)
	}
	if got.Query != "v={{apiVersion}}" {
		t.Errorf("query = %q; a plain collection variable is left for the renderer", got.Query)
	}

	if _, err := app.W.Collections.CreateGrpcItem(bridge.CollectionsCreateGrpcItemArgs{
		CollectionID: rep.CollectionID, Name: "Stream orders",
		Request: &model.SavedGrpcRequest{TLSMode: "plaintext", DescriptorMode: "reflection", Target: "localhost:50051"},
	}); err != nil {
		t.Fatal(err)
	}

	exported := filepath.Join(dir, "export.json")
	app.Dialogs.QueueSaveFile(exported)
	dest, err := app.W.Files.ChooseSave(bridge.FilesChooseSaveArgs{DefaultName: "Flow Orders.postman_collection.json"})
	if err != nil || dest.FilePath == nil {
		t.Fatalf("ChooseSave = %+v (%v)", dest, err)
	}
	app.Contract(t, sc, "FilesService.ChooseSave", dest, pathOpts...)
	exportArgs := bridge.CollectionsExportArgs{CollectionID: rep.CollectionID, Path: *dest.FilePath}
	app.Contract(t, sc, "args:CollectionsService.Export", exportArgs, pathOpts...)
	exp, err := app.W.Collections.Export(exportArgs)
	if err != nil {
		t.Fatal(err)
	}
	app.Contract(t, sc, "CollectionsService.Export", exp, pathOpts...)
	if exp.SecretCount != 1 || exp.SkippedGrpc != 1 {
		t.Errorf("export = %+v, want 1 secret and 1 skipped gRPC item", exp)
	}
	raw, err := os.ReadFile(exported)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), srv.URL) {
		t.Error("the export carries the secret variable's value")
	}

	app.Dialogs.QueueOpenFile(exported)
	again, err := app.W.Files.ChooseOpen(bridge.FilesChooseOpenArgs{})
	if err != nil || again.File == nil {
		t.Fatal(err)
	}
	rep2, err := app.W.Collections.Import(bridge.CollectionsImportArgs{Path: again.File.Path})
	if err != nil {
		t.Fatal(err)
	}
	if rep2.CollectionID == rep.CollectionID {
		t.Fatal("re-import reused the collection")
	}
	want := tree(t, app, rep.CollectionID)
	var wantHTTP []string
	for _, l := range want {
		if !strings.Contains(l, "Stream orders") {
			wantHTTP = append(wantHTTP, l)
		}
	}
	if gotTree := tree(t, app, rep2.CollectionID); strings.Join(gotTree, "\n") != strings.Join(wantHTTP, "\n") {
		t.Errorf("re-imported tree differs\n got: %q\nwant: %q", gotTree, wantHTTP)
	}
}

func headerOf(h model.SavedHeader) httpclient.Header {
	return httpclient.Header{Name: h.Name, Value: h.Value}
}

func TestMoveRenameGrpcItem(t *testing.T) {
	app := flowharness.New(t)
	cs := app.W.Collections
	from, to := newCollection(t, app, "from"), newCollection(t, app, "to")
	folder, err := cs.CreateItem(bridge.CollectionsCreateItemArgs{CollectionID: from.ID, Kind: model.CollectionItemFolder, Name: "dir"})
	if err != nil {
		t.Fatal(err)
	}
	req := model.SavedGrpcRequest{
		Target: "localhost:50051", TLSMode: "plaintext", DescriptorMode: "reflection",
		Service: "kira.flow.v1.Flow", Method: "Unary", Message: `{"text":"hi"}`,
		Metadata: []model.SavedGrpcMetaRow{{Name: "x-id", Value: "1", Enabled: true}},
	}
	item, err := cs.CreateGrpcItem(bridge.CollectionsCreateGrpcItemArgs{CollectionID: from.ID, ParentID: &folder.ID, Name: "unary", Request: &req})
	if err != nil {
		t.Fatal(err)
	}
	if item.Protocol != model.ItemProtocolGrpc {
		t.Fatalf("created item protocol %q, want grpc", item.Protocol)
	}

	// SaveGrpcRequest replaces the body and the name; GetGrpcRequest reads it back.
	req.Message = `{"text":"edited"}`
	req.Metadata = append(req.Metadata, model.SavedGrpcMetaRow{Name: "x-trace", Value: "t", Enabled: true})
	if _, err := cs.SaveGrpcRequest(bridge.CollectionsSaveGrpcRequestArgs{ItemID: item.ID, Name: "unary v2", Request: req}); err != nil {
		t.Fatal(err)
	}
	got, err := cs.GetGrpcRequest(bridge.CollectionsItemArgs{ItemID: item.ID})
	if err != nil || got.Message != req.Message || len(got.Metadata) != 2 || got.Method != "Unary" {
		t.Fatalf("GetGrpcRequest = %+v (%v), want the edited request", got, err)
	}
	if _, err := cs.GetRequest(bridge.CollectionsItemArgs{ItemID: item.ID}); ipcErr(t, err).Code != "E_BAD_REQUEST" {
		t.Fatalf("GetRequest on a gRPC item = %v, want E_BAD_REQUEST", err)
	}
	if _, err := cs.GetGrpcRequest(bridge.CollectionsItemArgs{ItemID: "missing"}); ipcErr(t, err).Code != "E_NOT_FOUND" {
		t.Fatalf("GetGrpcRequest of an unknown item = %v, want E_NOT_FOUND", err)
	}

	if err := cs.Rename(bridge.CollectionsTargetArgs{ID: item.ID, Target: "item", Name: "renamed"}); err != nil {
		t.Fatal(err)
	}
	if err := cs.MoveItem(bridge.CollectionsMoveItemArgs{ItemID: folder.ID, CollectionID: to.ID}); err != nil {
		t.Fatal(err)
	}
	if err := cs.MoveItem(bridge.CollectionsMoveItemArgs{ItemID: folder.ID, CollectionID: "missing"}); err == nil {
		t.Fatal("MoveItem into an unknown collection succeeded")
	}

	check := func(label string) {
		t.Helper()
		all, err := cs.List()
		if err != nil {
			t.Fatal(err)
		}
		byID := map[string]model.CollectionItem{}
		for _, it := range all.Items {
			byID[it.ID] = it
		}
		if byID[folder.ID].CollectionID != to.ID || byID[item.ID].CollectionID != to.ID {
			t.Fatalf("%s: folder in %s, item in %s; want both in %s (a move takes the subtree)", label, byID[folder.ID].CollectionID, byID[item.ID].CollectionID, to.ID)
		}
		if it := byID[item.ID]; it.Name != "renamed" || it.ParentID == nil || *it.ParentID != folder.ID || it.Protocol != model.ItemProtocolGrpc {
			t.Fatalf("%s: item = %+v, want renamed, still under the folder, gRPC", label, it)
		}
		if g, err := cs.GetGrpcRequest(bridge.CollectionsItemArgs{ItemID: item.ID}); err != nil || g.Message != req.Message {
			t.Fatalf("%s: request body after the move = %+v (%v)", label, g, err)
		}
	}
	check("after move")
	app.Restart(t)
	cs = app.W.Collections
	check("after relaunch")

	// Postman has no gRPC item, so an export skips it; the rest of the collection still exports.
	dest := filepath.Join(t.TempDir(), "out.json")
	exp, err := cs.Export(bridge.CollectionsExportArgs{CollectionID: to.ID, Path: dest})
	if err != nil || exp.SkippedGrpc != 1 {
		t.Fatalf("Export = %+v (%v), want the gRPC item skipped", exp, err)
	}
}

func TestMoveRequest(t *testing.T) {
	app := flowharness.New(t)
	cs := app.W.Collections
	from, to := newCollection(t, app, "from"), newCollection(t, app, "to")
	item, err := cs.CreateItem(bridge.CollectionsCreateItemArgs{CollectionID: from.ID, Kind: model.CollectionItemRequest, Name: "health"})
	if err != nil {
		t.Fatal(err)
	}
	args := bridge.CollectionsMoveItemArgs{ItemID: item.ID, CollectionID: to.ID}
	if err := cs.MoveItem(args); err != nil {
		t.Fatal(err)
	}
	app.Contract(t, "api-move", "args:CollectionsService.MoveItem", args)
	all, err := cs.List()
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range all.Items {
		if it.ID == item.ID && it.CollectionID != to.ID {
			t.Fatalf("item in %s after the move, want %s", it.CollectionID, to.ID)
		}
	}
}
