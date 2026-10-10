package termflow_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/scriptruns"
	"github.com/kirathecat/kira-studio/internal/scripts"
)

// Contract script-editor: tests/ui/automations-editor.spec.ts saves the same script from the
// three-tab editor and reads the run dialog's resolved param from the same preview.
func TestScriptEditorSave(t *testing.T) {
	app := flowharness.New(t)
	coll, err := app.W.CustomScripts.CreateCollection(bridge.CustomScriptsCreateCollectionArgs{Name: "Ops"})
	if err != nil {
		t.Fatal(err)
	}
	args := bridge.CustomScriptsCreateArgs{Fields: scripts.CustomScriptFields{
		Name: "triage", Kind: scripts.KindSmart, Command: "Look at {topic}", Color: "blue", CollectionID: &coll.ID,
		Params: []scripts.Param{{Name: "topic", Label: "Topic", Type: scripts.ParamText, Options: []string{}, Default: []string{"auth"}}},
		Smart:  &scripts.Smart{},
		Schedule: &scripts.Schedule{
			Cron: "0 9 * * 1-5", Timezone: "UTC", Enabled: true, Confirm: true,
		},
	}}
	app.Contract(t, "script-editor", "args:CustomScriptsService.Create", args)
	rec, err := app.W.CustomScripts.Create(args)
	if err != nil {
		t.Fatal(err)
	}
	if rec.CollectionID == nil || *rec.CollectionID != coll.ID || rec.Schedule == nil || rec.Schedule.Cron != "0 9 * * 1-5" ||
		!rec.Schedule.Enabled || !rec.Schedule.Confirm || len(rec.Params) != 1 || rec.Params[0].Default[0] != "auth" {
		t.Fatalf("stored = %+v", rec)
	}
	app.Contract(t, "script-editor", "CustomScriptsService.Create", rec)

	pv, err := app.W.ScriptRuns.Preview(scriptruns.RunArgs{ScriptID: rec.ID})
	if err != nil {
		t.Fatal(err)
	}
	var topic *scripts.Part
	for i, p := range pv.Prompt {
		if p.Var == "topic" {
			topic = &pv.Prompt[i]
		}
	}
	if topic == nil || topic.Value != "auth" {
		t.Fatalf("prompt = %+v, want {topic} resolved to its default", pv.Prompt)
	}
	app.Contract(t, "script-editor", "ScriptRunsService.Preview", pv, flowharness.Mask("hash"))

	// Edit schedule, uncheck enabled, Save: the schedule stays stored, switched off.
	offFields := args.Fields
	offSchedule := *args.Fields.Schedule
	offSchedule.Enabled = false
	offFields.Schedule = &offSchedule
	off := bridge.CustomScriptsUpdateArgs{ID: rec.ID, Fields: offFields}
	app.Contract(t, "script-editor", "args:CustomScriptsService.Update#schedule-off", off)
	updated, err := app.W.CustomScripts.Update(off)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Schedule == nil || updated.Schedule.Enabled || updated.Schedule.Cron != "0 9 * * 1-5" || !updated.Schedule.Confirm {
		t.Fatalf("updated schedule = %+v, want kept and disabled", updated.Schedule)
	}
	list, err := app.W.CustomScripts.List()
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range list.Scripts {
		if s.ID == rec.ID && (s.Schedule == nil || s.Schedule.Enabled) {
			t.Fatalf("listed schedule = %+v, want disabled", s.Schedule)
		}
	}
	app.Contract(t, "script-editor", "CustomScriptsService.Update#schedule-off", updated)
}
