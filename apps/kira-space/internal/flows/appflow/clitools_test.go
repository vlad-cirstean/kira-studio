package appflow_test

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/clisetup"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeacli"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker/jira"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
)

// P417 Settings, CLI tools. Contract space-cli-tools: tests/ui/settings-cli-tools.spec.ts reads these.

func toolOf(t *testing.T, res bridge.ToolsResult, provider string) bridge.Tool {
	t.Helper()
	for _, tool := range res.Tools {
		if tool.Provider == provider {
			return tool
		}
	}
	t.Fatalf("no tool %q in %+v", provider, res.Tools)
	return bridge.Tool{}
}

func purposes(s clisetup.Setup) []string {
	var out []string
	for _, st := range s.Steps {
		out = append(out, st.Purpose)
	}
	return out
}

func TestCliTools(t *testing.T) {
	acli := fakeacli.New("acme.atlassian.net")
	acli.SetLoggedIn(false)
	app := flowharness.New(t, flowharness.WithIssueTracker(jira.Options{Locator: acli, Runner: acli}))
	write := func(name, body string) string {
		p := filepath.Join(app.FakeDir, name)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	app.Scenario(fakeagent.Scenario{Gh: []fakeagent.GhRule{
		{Match: "--version", Emit: write("gh-version.txt", "gh version 2.42.0 (2024-01-08)\n")},
		{Match: "auth status", Emit: write("gh-auth.txt", "github.com\n  Logged in to github.com account octocat (keyring)\n")},
	}})
	tools := func(refresh bool) bridge.ToolsResult {
		args := bridge.ToolsArgs{Refresh: refresh}
		res, err := app.W.IssueTracker.Tools(ctx, args)
		if err != nil {
			t.Fatalf("Tools: %v", err)
		}
		return res
	}

	// 1. gh is ready, acli is installed but signed out; hosts come before trackers, each with its steps.
	app.Contract(t, "space-cli-tools", "args:IssueTrackerService.Tools", bridge.ToolsArgs{Refresh: true})
	first := tools(false)
	if len(first.Tools) != 2 || first.Tools[0].Kind != "host" || first.Tools[1].Kind != "tracker" {
		t.Fatalf("tools = %+v, want the host then the tracker", first.Tools)
	}
	gh, jr := toolOf(t, first, "github"), toolOf(t, first, "jira")
	if gh.Status.Kind != "ok" || gh.Status.Account != "octocat" || gh.Status.Version != "2.42.0" || gh.Label != "GitHub" || gh.CLI != "GitHub CLI (gh)" {
		t.Fatalf("gh = %+v", gh)
	}
	if jr.Status.Kind != "unauthenticated" || jr.Label != "Jira" || jr.CLI != "Atlassian CLI (acli)" || jr.Status.Reason == "" {
		t.Fatalf("acli = %+v", jr)
	}
	if got := purposes(gh.Setup); !reflect.DeepEqual(got, []string{"install", "login", "check"}) {
		t.Fatalf("gh steps = %v", got)
	}
	if got := purposes(jr.Setup); !reflect.DeepEqual(got, []string{"install", "login", "loginToken", "check"}) {
		t.Fatalf("acli steps = %v", got)
	}
	app.Contract(t, "space-cli-tools", "IssueTrackerService.Tools#signed-out", first,
		flowharness.Mask("path"))

	// 2. A login in another terminal shows only after a refresh: the probe is cached.
	acli.SetLoggedIn(true)
	if st := toolOf(t, tools(false), "jira").Status; st.Kind != "unauthenticated" {
		t.Fatalf("cached status = %+v, want the signed-out probe", st)
	}
	app.Contract(t, "space-cli-tools", "args:IssueTrackerService.Tools#refresh", bridge.ToolsArgs{Refresh: true})
	ready := tools(true)
	if st := toolOf(t, ready, "jira").Status; st.Kind != "ok" || st.Site != "acme.atlassian.net" || st.Account != "me@acme.test" || st.Version != "1.3.4" {
		t.Fatalf("refreshed status = %+v", st)
	}
	app.Contract(t, "space-cli-tools", "IssueTrackerService.Tools#ready", ready, flowharness.Mask("path"))

	// 3. A missing CLI lists the paths looked at.
	acli.SetInstalled(false)
	missing := tools(true)
	if st := toolOf(t, missing, "jira").Status; st.Kind != "notFound" || len(st.Probed) == 0 {
		t.Fatalf("missing status = %+v, want notFound with probed paths", st)
	}
	app.Contract(t, "space-cli-tools", "IssueTrackerService.Tools#not-installed", missing, flowharness.Mask("path"))

	// 4. The trackers list names them without probing.
	calls := acli.Count("")
	res := app.W.IssueTracker.Trackers()
	if len(res.Trackers) != 1 || res.Trackers[0].ID != "jira" || res.Trackers[0].Label != "Jira" || acli.Count("") != calls {
		t.Fatalf("Trackers = %+v, acli calls %d -> %d", res, calls, acli.Count(""))
	}
	app.Contract(t, "space-cli-tools", "IssueTrackerService.Trackers", res)
}
