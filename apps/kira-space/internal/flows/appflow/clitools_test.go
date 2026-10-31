package appflow_test

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/clisetup"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeacli"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeaz"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost/azure"
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
	az := fakeaz.New()
	az.SetLoggedIn(false)
	app := flowharness.New(t, flowharness.WithIssueTracker(jira.Options{Locator: acli, Runner: acli}),
		flowharness.WithAzure(azure.Options{Locator: az, Runner: az}))
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
	if len(first.Tools) != 3 || first.Tools[0].Kind != "host" || first.Tools[1].Kind != "host" || first.Tools[2].Kind != "tracker" {
		t.Fatalf("tools = %+v, want the hosts then the tracker", first.Tools)
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

	// 4. Azure Repos: az is installed with its extension, signed out and with no default organization.
	azure0 := toolOf(t, first, "azure")
	if azure0.Label != "Azure Repos" || azure0.CLI != "Azure CLI (az)" || azure0.Kind != "host" {
		t.Fatalf("azure = %+v", azure0)
	}
	if got := purposes(azure0.Setup); !reflect.DeepEqual(got, []string{"install", "extension", "login", "loginToken", "defaults", "check"}) {
		t.Fatalf("az steps = %v", got)
	}
	if st := azure0.Status; st.Kind != "unauthenticated" || !strings.Contains(st.Reason, "az devops configure") {
		t.Fatalf("az without defaults = %+v, want unauthenticated naming az devops configure", st)
	}
	app.Contract(t, "space-cli-tools", "IssueTrackerService.Tools#azure-no-defaults", first, flowharness.Mask("path"))

	az.SetDefaults("https://dev.azure.com/acme", "Web App")
	app.Contract(t, "space-cli-tools", "args:IssueTrackerService.Tools#azure-refresh", bridge.ToolsArgs{Refresh: true})
	if st := toolOf(t, tools(true), "azure").Status; st.Kind != "unauthenticated" || !strings.Contains(st.Reason, "az login") || st.Site != "https://dev.azure.com/acme" {
		t.Fatalf("az signed out = %+v, want unauthenticated naming az login", st)
	}
	az.SetLoggedIn(true)
	if st := toolOf(t, tools(false), "azure").Status; st.Kind != "unauthenticated" {
		t.Fatalf("cached az status = %+v, want the signed-out probe", st)
	}
	azReady := tools(true)
	if st := toolOf(t, azReady, "azure").Status; st.Kind != "ok" || st.Site != "https://dev.azure.com/acme" || st.Account != "me@acme.test" || st.Version != "2.91.0 (azure-devops 1.0.10)" {
		t.Fatalf("az refreshed = %+v", st)
	}
	app.Contract(t, "space-cli-tools", "IssueTrackerService.Tools#azure-ready", azReady, flowharness.Mask("path"))

	az.SetExtension(false)
	noExt := tools(true)
	if st := toolOf(t, noExt, "azure").Status; st.Kind != "notFound" || !strings.Contains(st.Reason, "az extension add") {
		t.Fatalf("az without the extension = %+v, want notFound naming az extension add", st)
	}
	app.Contract(t, "space-cli-tools", "IssueTrackerService.Tools#azure-no-extension", noExt, flowharness.Mask("path"))

	// 5. The trackers list names them without probing.
	calls := acli.Count("")
	res := app.W.IssueTracker.Trackers()
	if len(res.Trackers) != 1 || res.Trackers[0].ID != "jira" || res.Trackers[0].Label != "Jira" || acli.Count("") != calls {
		t.Fatalf("Trackers = %+v, acli calls %d -> %d", res, calls, acli.Count(""))
	}
	app.Contract(t, "space-cli-tools", "IssueTrackerService.Trackers", res)
}
