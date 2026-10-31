package azure

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/internal/toolexec"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

var testRepo = githost.Repo{Host: Host, Owner: "acme/Web App", Name: "api"}

func TestMapPR(t *testing.T) {
	var raw []rawPR
	if err := json.Unmarshal(fixture(t, "pr_list.json"), &raw); err != nil {
		t.Fatal(err)
	}
	crs := mapPRs(testRepo, raw)
	byNum := map[int]githost.ChangeRequest{}
	for _, c := range crs {
		byNum[c.Number] = c
	}
	open := byNum[12]
	if open.State != "open" || open.Draft || open.HeadRef != "feature/login" || open.BaseRef != "main" ||
		open.HeadOwner != testRepo.Owner || open.NodeID != "12" || open.HeadSha != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Errorf("open PR mapped wrong: %+v", open)
	}
	if want := "https://dev.azure.com/acme/Web%20App/_git/api/pullrequest/12"; open.URL != want {
		t.Errorf("URL = %q, want composed %q", open.URL, want)
	}
	if want := time.Date(2024, 5, 3, 10, 0, 0, 0, time.UTC).UnixMilli(); open.UpdatedAt != want {
		t.Errorf("UpdatedAt = %d, want creation %d", open.UpdatedAt, want)
	}
	if d := byNum[11]; d.State != "draft" || !d.Draft {
		t.Errorf("draft mapped wrong: %+v", d)
	}
	if m := byNum[9]; m.State != "merged" || m.Draft {
		t.Errorf("completed mapped wrong: %+v", m)
	}
	if c := byNum[8]; c.State != "closed" {
		t.Errorf("abandoned mapped wrong: %+v", c)
	}
	fork := byNum[15]
	if fork.HeadOwner != "acme/Sandbox/api-fork" || fork.HeadOwner == testRepo.Owner {
		t.Errorf("fork HeadOwner = %q", fork.HeadOwner)
	}
	if fork.UpdatedAt == 0 {
		t.Error("a 7-digit fractional creation time did not parse")
	}
}

func TestMapRESTMatchesProjection(t *testing.T) {
	var res struct {
		Results []map[string][]rawRESTPR `json:"results"`
	}
	if err := json.Unmarshal(fixture(t, "pr_query.json"), &res); err != nil {
		t.Fatal(err)
	}
	var fork rawRESTPR
	for _, m := range res.Results {
		for _, prs := range m {
			for _, p := range prs {
				if p.PullRequestID == 15 {
					fork = p
				}
			}
		}
	}
	cr := mapPR(testRepo, fork.raw())
	if cr.HeadOwner != "acme/Sandbox/api-fork" || cr.HeadSha != "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0" || cr.HeadRef != "feature/login" {
		t.Errorf("REST fork mapped wrong: %+v", cr)
	}
}

func TestReviewDecision(t *testing.T) {
	rv := func(vote int, required bool) rawReviewer { return rawReviewer{Vote: vote, Required: required} }
	tests := []struct {
		name string
		in   []rawReviewer
		want string
	}{
		{"none", nil, ""},
		{"optional no vote", []rawReviewer{rv(0, false)}, ""},
		{"approve", []rawReviewer{rv(10, true)}, "APPROVED"},
		{"suggestions approve", []rawReviewer{rv(5, false)}, "APPROVED"},
		{"wait for author wins over approve", []rawReviewer{rv(10, true), rv(-5, false)}, "CHANGES_REQUESTED"},
		{"reject wins over required pending", []rawReviewer{rv(0, true), rv(-10, false)}, "CHANGES_REQUESTED"},
		{"required pending beats approve", []rawReviewer{rv(10, false), rv(0, true)}, "REVIEW_REQUIRED"},
		{"required voted", []rawReviewer{rv(10, true), rv(0, false)}, "APPROVED"},
	}
	for _, tc := range tests {
		if got := reviewDecision(rawPR{Reviewers: tc.in}); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestChecksState(t *testing.T) {
	var all []rawPolicy
	if err := json.Unmarshal(fixture(t, "policy_list.json"), &all); err != nil {
		t.Fatal(err)
	}
	if got := checksState(all); got != "FAILURE" {
		t.Errorf("fixture rollup = %q, want FAILURE (rejected Build beats running Status)", got)
	}
	tests := []struct {
		name string
		in   []rawPolicy
		want string
	}{
		{"none", nil, ""},
		{"reviewers policy is not a check", []rawPolicy{{"rejected", "Minimum number of reviewers"}}, ""},
		{"not applicable", []rawPolicy{{"notApplicable", "Build"}}, ""},
		{"approved", []rawPolicy{{"approved", "Build"}, {"approved", "Status"}}, "SUCCESS"},
		{"running beats approved", []rawPolicy{{"approved", "Build"}, {"running", "Status"}}, "PENDING"},
		{"queued", []rawPolicy{{"queued", "Build"}}, "PENDING"},
		{"broken beats pending", []rawPolicy{{"running", "Build"}, {"broken", "Status"}}, "ERROR"},
		{"rejected beats broken", []rawPolicy{{"broken", "Build"}, {"rejected", "Status"}}, "FAILURE"},
	}
	for _, tc := range tests {
		if got := checksState(tc.in); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestClassify(t *testing.T) {
	exec := func(stderr string) error { return &toolexec.ExecError{ExitCode: 1, Stderr: stderr} }
	org := "https://dev.azure.com/acme"
	tests := []struct {
		name    string
		runErr  error
		ctxErr  error
		write   bool
		kind    string
		reason  string
		gone    bool
		limited bool
	}{
		{name: "ok", kind: githost.KindOK},
		{name: "cancelled", runErr: errors.New("killed"), ctxErr: context.Canceled, kind: githost.KindNotFound, reason: "cancelled"},
		{name: "timeout", runErr: timeoutError{after: 30 * time.Second}, kind: githost.KindNotFound, reason: "az did not respond within 30s"},
		{name: "write timeout", runErr: timeoutError{after: 30 * time.Second}, write: true, kind: githost.KindNotFound,
			reason: "az did not respond within 30s. The request may have been recorded; open the PR to check before trying again"},
		{name: "too large", runErr: toolexec.ErrOutputTooLarge, kind: githost.KindForbidden, reason: "Azure DevOps' response was too large to read"},
		{name: "not started", runErr: errors.New("fork/exec az: no such file"), kind: githost.KindNotFound, reason: "az could not be started: fork/exec az: no such file"},
		{name: "logged out", runErr: exec(string(fixture(t, "stderr_logged_out.txt"))), kind: githost.KindUnauthenticated},
		{name: "no account", runErr: exec(string(fixture(t, "stderr_account.txt"))), kind: githost.KindUnauthenticated},
		{name: "expired token", runErr: exec("ERROR: TF400813: The user 'x' is not authorized to access this resource."), kind: githost.KindUnauthenticated},
		{name: "http 401", runErr: exec("ERROR: Request failed with status 401"), kind: githost.KindUnauthenticated},
		{name: "no extension", runErr: exec("ERROR: 'repos' is misspelled or not recognized by the system."), kind: githost.KindNotFound, reason: reasonExtension},
		{name: "throttled", runErr: exec("ERROR: TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource"),
			kind: githost.KindForbidden, reason: reasonThrottled, limited: true},
		{name: "http 429", runErr: exec("ERROR: 429 Too Many Requests"), kind: githost.KindForbidden, reason: reasonThrottled, limited: true},
		{name: "repo missing", runErr: exec("ERROR: TF401019: The Git repository with name or identifier api does not exist or you do not have permissions for the operation you are attempting."),
			kind: githost.KindForbidden, gone: true},
		{name: "pr missing", runErr: exec("ERROR: TF401180: The requested pull request was not found."), kind: githost.KindForbidden, gone: true},
		{name: "http 404", runErr: exec("ERROR: 404 Not Found"), kind: githost.KindForbidden, gone: true},
		{name: "no permission", runErr: exec("ERROR: TF401027: You need the Git 'PullRequestContribute' permission to perform this action."),
			kind: githost.KindForbidden, reason: reasonDenied},
		{name: "http 403", runErr: exec("ERROR: 403 Forbidden"), kind: githost.KindForbidden, reason: reasonDenied},
		{name: "other", runErr: exec("ERROR: something odd"), kind: githost.KindForbidden, reason: "something odd"},
		{name: "silent", runErr: &toolexec.ExecError{ExitCode: 2}, kind: githost.KindForbidden, reason: "az exited with code 2"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := classify(org, tc.runErr, tc.ctxErr, tc.write)
			if st.Kind != tc.kind || st.Gone != tc.gone || st.RateLimited != tc.limited {
				t.Fatalf("got %+v; want kind %s gone %v limited %v", st, tc.kind, tc.gone, tc.limited)
			}
			if tc.reason != "" && st.Reason != tc.reason {
				t.Errorf("reason = %q, want %q", st.Reason, tc.reason)
			}
			if st.Host != Host || st.Site != org {
				t.Errorf("host/site = %q/%q", st.Host, st.Site)
			}
		})
	}
}

func TestParseVersionAndDefaults(t *testing.T) {
	v, ext, ok := parseVersion(fixture(t, "version.json"))
	if !ok || !ext || v != "2.91.0 (azure-devops 1.0.10)" {
		t.Errorf("version = %q, %v, %v", v, ext, ok)
	}
	if v, ext, ok := parseVersion(fixture(t, "version_noext.json")); !ok || ext || v != "2.91.0" {
		t.Errorf("noext version = %q, %v, %v", v, ext, ok)
	}
	if _, _, ok := parseVersion([]byte("not json")); ok {
		t.Error("garbage parsed as a version")
	}
	if d := parseDefaults(string(fixture(t, "configure_list.txt"))); d != (Defaults{OrgURL: "https://dev.azure.com/acme", Project: "Web App"}) {
		t.Errorf("defaults = %+v", d)
	}
	if d := parseDefaults(string(fixture(t, "configure_list_empty.txt"))); d != (Defaults{}) {
		t.Errorf("empty defaults = %+v", d)
	}
	if d := parseDefaults("[defaults]\norganization = https://acme.visualstudio.com/\n"); d.OrgURL != "https://dev.azure.com/acme" {
		t.Errorf("legacy org not canonicalized: %+v", d)
	}
}
