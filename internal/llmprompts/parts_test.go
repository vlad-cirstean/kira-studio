package llmprompts

import (
	"reflect"
	"testing"
)

func TestRenderPartsWrapsValues(t *testing.T) {
	v := SendBackVars{From: "Verify", Branch: "feat/x", Reason: "red"}
	got, err := RenderParts(Defaults(), "ade.sendBack.line", v)
	if err != nil {
		t.Fatal(err)
	}
	want := []Part{
		{Var: "From", Value: "Verify"}, {Text: " failed on "}, {Var: "Branch", Value: "feat/x"},
		{Text: ": "}, {Var: "Reason", Value: "red"}, {Text: ". Fix the implementation."},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parts = %+v", got)
	}
}

func TestRenderPartsEmptyAndMarkers(t *testing.T) {
	v := SendBackVars{From: "", Branch: "a﷐b﷒", Reason: "r"}
	got, err := RenderParts(Defaults(), "ade.sendBack.line", v)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range got {
		if p.Var == "From" {
			t.Fatalf("empty value chipped: %+v", got)
		}
		if p.Var == "Branch" && p.Value != "ab" {
			t.Fatalf("markers kept: %q", p.Value)
		}
	}
}

func TestRenderPartsNestedNames(t *testing.T) {
	v := RebaseVars{Onto: "origin/main", Stack: []RebaseStackVar{{Name: "a", Worktree: "/w/a", ParentRef: "origin/main"}}}
	got, err := RenderParts(Defaults(), "ade.rebase.prompt", v)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range got {
		if p.Var == "Stack.Worktree" && p.Value == "/w/a" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no Stack.Worktree chip: %+v", got)
	}
}

func TestRenderPartsSelfCheckFallsBack(t *testing.T) {
	e := mustEntry("ade.sendBack.line")
	text := func(ID) string { return `{{if eq .From "Verify"}}same{{else}}other{{end}}` }
	got, err := renderPartsWith(e, text, SendBackVars{From: "Verify"})
	if err != nil {
		t.Fatal(err)
	}
	if want := []Part{{Text: "same"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("parts = %+v", got)
	}
}
