package apiflow

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func TestEnvironmentLifecycle(t *testing.T) {
	app := flowharness.New(t)
	srv := flowharness.HTTP(t)
	vs := app.W.Variables
	col := newCollection(t, app, "scoped")
	dev, stage, prod := newEnv(t, app, "dev"), newEnv(t, app, "stage"), newEnv(t, app, "prod")
	upsertSecret(t, app, model.VariableScopeCollection, col.ID, "who", "collection")
	for _, e := range []model.Environment{dev, stage, prod} {
		upsertSecret(t, app, model.VariableScopeEnvironment, e.ID, "who", "from-"+e.Name)
	}
	sendWho := func(envID string) string {
		t.Helper()
		args := get(srv.URL + "/echo?who={{who}}")
		args.CollectionID, args.EnvironmentID = col.ID, envID
		send(t, app, args)
		return lastRequest(srv).Query
	}
	names := func() []string {
		t.Helper()
		envs, err := vs.ListEnvironments()
		if err != nil {
			t.Fatal(err)
		}
		out := make([]string, len(envs))
		for i, e := range envs {
			out[i] = e.Name
		}
		return out
	}
	equal := func(got []string, want ...string) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}

	if err := vs.UpdateEnvironment(bridge.VariablesUpdateEnvironmentArgs{ID: dev.ID, Name: "development", Description: "local", Color: "green"}); err != nil {
		t.Fatal(err)
	}
	envs, _ := vs.ListEnvironments()
	if envs[0].Name != "development" || envs[0].Description != "local" || envs[0].Color != "green" {
		t.Fatalf("UpdateEnvironment left %+v", envs[0])
	}
	if err := vs.UpdateEnvironment(bridge.VariablesUpdateEnvironmentArgs{ID: dev.ID, Name: "", Color: "green"}); ipcErr(t, err).Code != "E_BAD_REQUEST" {
		t.Fatalf("UpdateEnvironment with no name = %v", err)
	}
	if got := sendWho(dev.ID); got != "who=from-dev" {
		t.Fatalf("renamed environment still resolves its own variables: %q", got)
	}

	if err := vs.ReorderEnvironments(bridge.VariablesReorderEnvironmentsArgs{IDs: []string{prod.ID, dev.ID, stage.ID}}); err != nil {
		t.Fatal(err)
	}
	if got := names(); !equal(got, "prod", "development", "stage") {
		t.Fatalf("order after ReorderEnvironments = %v", got)
	}

	// Variables reorder inside one owner.
	a := upsertSecret(t, app, model.VariableScopeEnvironment, stage.ID, "a", "1")
	b := upsertSecret(t, app, model.VariableScopeEnvironment, stage.ID, "b", "2")
	if err := vs.Reorder(bridge.VariablesReorderArgs{Scope: model.VariableScopeEnvironment, OwnerID: stage.ID, IDs: []string{b.ID, a.ID}}); err != nil {
		t.Fatal(err)
	}
	vars, err := vs.List(bridge.VariablesScopeArgs{Scope: model.VariableScopeEnvironment, OwnerID: stage.ID})
	if err != nil || len(vars) < 2 || vars[0].ID != b.ID || vars[1].ID != a.ID {
		t.Fatalf("variable order after Reorder = %+v (%v), want b then a first", vars, err)
	}

	// Deleting the active environment: the next send resolves without it, the list loses it.
	if err := vs.SetActiveEnvironment(bridge.VariablesEnvironmentIDArgs{ID: prod.ID}); err != nil {
		t.Fatal(err)
	}
	if err := vs.DeleteEnvironment(bridge.VariablesEnvironmentIDArgs{ID: prod.ID}); err != nil {
		t.Fatal(err)
	}
	if got := names(); !equal(got, "development", "stage") {
		t.Fatalf("environments after DeleteEnvironment = %v", got)
	}
	envs, _ = vs.ListEnvironments()
	for _, e := range envs {
		if e.IsActive {
			t.Fatalf("environment %q still active after the active one was deleted", e.Name)
		}
	}
	if got := sendWho(stage.ID); got != "who=from-stage" {
		t.Fatalf("send with a live environment = %q", got)
	}
	if got := sendWho(prod.ID); got != "who=collection" {
		t.Fatalf("send referencing the deleted environment = %q, want the collection value", got)
	}
	if left, err := vs.List(bridge.VariablesScopeArgs{Scope: model.VariableScopeEnvironment, OwnerID: prod.ID}); err != nil || len(left) != 0 {
		t.Fatalf("deleted environment kept variables: %+v (%v)", left, err)
	}

	app.Restart(t)
	vs = app.W.Variables
	if got := names(); !equal(got, "development", "stage") {
		t.Fatalf("environments after relaunch = %v", got)
	}
}

// Same scenario as tests/ui/http-variables.spec.ts "the active environment's base variable reaches
// the wire": both halves read tests/contract/api-boot.json. The renderer substitutes plain
// variables before sending; the backend only resolves secrets.
func TestActiveEnvironmentResolvesBase(t *testing.T) {
	app := flowharness.New(t)
	srv := flowharness.HTTP(t)
	const sc = "api-boot"
	env, err := app.W.Variables.CreateEnvironment(bridge.VariablesCreateEnvironmentArgs{Name: "Flow", Color: "blue"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.W.Variables.Upsert(bridge.VariablesUpsertArgs{
		Scope: model.VariableScopeEnvironment, OwnerID: env.ID, Name: "base", Value: ptr(srv.URL),
	}); err != nil {
		t.Fatal(err)
	}
	if err := app.W.Variables.SetActiveEnvironment(bridge.VariablesEnvironmentIDArgs{ID: env.ID}); err != nil {
		t.Fatal(err)
	}
	envs, err := app.W.Variables.ListEnvironments()
	if err != nil {
		t.Fatal(err)
	}
	app.Contract(t, sc, "VariablesService.ListEnvironments", envs)
	vars, err := app.W.Variables.List(bridge.VariablesScopeArgs{Scope: model.VariableScopeEnvironment, OwnerID: env.ID})
	if err != nil {
		t.Fatal(err)
	}
	opts := flowharness.Replace(srv.URL, "<http>")
	app.Contract(t, sc, "VariablesService.List", vars, opts)

	args := get(srv.URL + "/echo?from=ui")
	args.EnvironmentID = env.ID
	app.Contract(t, sc, "args:HttpService.Send", args, flowharness.Mask("opId"), opts)
	res := send(t, app, args)
	app.Contract(t, sc, "HttpService.Send", res, opts, flowharness.Mask("elapsedMs", "bodyBytes"), flowharness.Omit("body", "headers", "timeline", "wire"))
	if got := lastRequest(srv); got.Path != "/echo" || got.Query != "from=ui" {
		t.Errorf("server saw %s?%s, want /echo?from=ui", got.Path, got.Query)
	}
}
