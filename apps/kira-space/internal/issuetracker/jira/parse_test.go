package jira

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker"
)

func TestParseRef(t *testing.T) {
	cases := []struct {
		in         string
		key, site  string
		wantParsed bool
	}{
		{"KIRA-12", "KIRA-12", "", true},
		{" KIRA-12 ", "KIRA-12", "", true},
		{"https://acme.atlassian.net/browse/KIRA-12", "KIRA-12", "acme.atlassian.net", true},
		{"https://acme.atlassian.net/browse/KIRA-12?focusedCommentId=5", "KIRA-12", "acme.atlassian.net", true},
		{"https://Acme.atlassian.net/jira/software/projects/KIRA/boards/1/issues/KIRA-7", "KIRA-7", "acme.atlassian.net", true},
		{"https://acme.atlassian.net/jira/software/projects/KIRA/boards/1?selectedIssue=KIRA-9", "KIRA-9", "acme.atlassian.net", true},
		{"kira-12", "", "", false},
		{"KIRA12", "", "", false},
		{"https://github.com/o/r/issues/12", "", "", false},
		{"https://acme.atlassian.net/browse/kira-12", "", "", false},
		{"ftp://acme.atlassian.net/browse/KIRA-12", "", "", false},
		{"hello KIRA-12", "", "", false},
	}
	for _, c := range cases {
		ref, ok := parseRef(c.in)
		if ok != c.wantParsed || ref.Key != c.key || ref.Site != c.site {
			t.Errorf("parseRef(%q) = %+v, %v; want key %q site %q parsed %v", c.in, ref, ok, c.key, c.site, c.wantParsed)
		}
	}
}

func load(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestDevField(t *testing.T) {
	cases := []struct {
		file string
		id   string
		want issuetracker.ChangeRequestSummary
	}{
		{"issue-string-dev.json", "customfield_10000", issuetracker.ChangeRequestSummary{Known: true, Count: 3, State: "open", Providers: []string{"GitHub"}}},
		{"issue-object-dev.json", "customfield_10000", issuetracker.ChangeRequestSummary{Known: true, Count: 2, State: "merged", Providers: []string{"GitHub", "bitbucket"}}},
		{"issue-short-dev.json", "customfield_10000", issuetracker.ChangeRequestSummary{Known: true, Count: 1, State: "merged", Providers: []string{}}},
		{"issue-no-dev.json", "", issuetracker.ChangeRequestSummary{}},
	}
	for _, c := range cases {
		p, ok := parseIssue(load(t, c.file))
		if !ok {
			t.Fatalf("%s: unparsed", c.file)
		}
		id, sum, found := findDevField(p.fields)
		if id != c.id || found != (c.id != "") || !reflect.DeepEqual(sum, c.want) {
			t.Errorf("%s: id %q found %v sum %+v; want %q %+v", c.file, id, found, sum, c.id, c.want)
		}
	}
}

func TestParseIssueBasics(t *testing.T) {
	p, ok := parseIssue(load(t, "issue-string-dev.json"))
	if !ok || p.key != "KIRA-12" || p.title != "Add the thing" || p.status != "In Review" || p.category != "indeterminate" {
		t.Fatalf("got %+v ok %v", p, ok)
	}
	for _, bad := range []string{``, `[]`, `{"fields":{}}`, `{"key":"A-1"}`} {
		if _, ok := parseIssue([]byte(bad)); ok {
			t.Errorf("parseIssue(%q) parsed", bad)
		}
	}
}
