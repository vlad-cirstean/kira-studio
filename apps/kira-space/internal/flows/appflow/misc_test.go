package appflow_test

import (
	"slices"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

func TestDateFormatReachesGit(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	if got := gitStatusOf(gs).DateFormat; got != "relative" {
		t.Fatalf("default dateFormat = %q, want relative", got)
	}
	for _, format := range []string{"absolute", "relative"} {
		setSettings(t, app, model.SettingsPatch{Appearance: &model.AppearancePatch{DateFormat: &format}})
		if got := gitStatusOf(gs).DateFormat; got != format {
			t.Fatalf("app.init dateFormat = %q after setting %q", got, format)
		}
	}
	bad := "yesterday"
	if _, err := app.W.Settings.Set(bridge.SettingsSetArgs{Patch: model.SettingsPatch{Appearance: &model.AppearancePatch{DateFormat: &bad}}}); err == nil {
		t.Fatal("invalid dateFormat accepted")
	}
	if got := gitStatusOf(gs).DateFormat; got != "relative" {
		t.Fatalf("dateFormat = %q after a refused value, want relative", got)
	}
}

func TestOpenLinks(t *testing.T) {
	app := flowharness.New(t)
	open := func(url string) error { return app.W.Link.OpenExternal(bridge.LinkOpenExternalArgs{URL: url}) }

	if err := open("https://example.com/docs?q=1"); err != nil {
		t.Fatal(err)
	}
	if err := open("http://localhost:3000/"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x", "https://", "//example.com", "example.com", ""} {
		if err := open(bad); err == nil {
			t.Errorf("OpenExternal(%q) succeeded", bad)
		}
	}

	pr := func(url string) error {
		return app.W.GitHub.OpenPullRequestURL(bridge.GitHubOpenPullRequestURLArgs{URL: url})
	}
	if err := pr("https://github.com/acme/api/pull/12"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		"http://github.com/acme/api/pull/12", "https://github.com/acme/api/issues/12", "https://github.com/acme/api/pull/x",
		"https://evil.example/acme/api/pull/12", "https://github.com.evil.example/acme/api/pull/12", "javascript:alert(1)",
	} {
		if err := pr(bad); err == nil {
			t.Errorf("OpenPullRequestURL(%q) succeeded", bad)
		}
	}

	want := []string{"https://example.com/docs?q=1", "http://localhost:3000/", "https://github.com/acme/api/pull/12"}
	if got := app.Browser.Opened(); !slices.Equal(got, want) {
		t.Fatalf("browser opened %v, want only %v", got, want)
	}
}
