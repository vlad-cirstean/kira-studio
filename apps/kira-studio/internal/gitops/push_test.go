package gitops

import (
	"testing"
)

func TestParsePushPorcelain_EmptyStdoutIsNotAnError(t *testing.T) {
	t.Parallel()
	// Probe P8: a `--delete` of a ref that does not exist produces an EMPTY porcelain block —
	// stderr carries everything instead.
	got, err := ParsePushPorcelain([]byte(""))
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %+v, want none", got)
	}
}

func TestParsePushPorcelain_Success(t *testing.T) {
	t.Parallel()
	// Probe P5's own success row.
	stdout := "To ../rem.git\n \trefs/heads/main:refs/heads/main\tddba93b..1998b87\nDone\n"
	got, err := ParsePushPorcelain([]byte(stdout))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %+v, want 1 row", got)
	}
	want := PushStatus{Flag: ' ', Src: "refs/heads/main", Dst: "refs/heads/main", Summary: "ddba93b..1998b87"}
	if got[0] != want {
		t.Fatalf("got %+v, want %+v", got[0], want)
	}
	updates := PushUpdates(got)
	if len(updates) != 1 || *updates[0].From != "ddba93b" || *updates[0].To != "1998b87" || updates[0].Forced {
		t.Fatalf("updates = %+v", updates)
	}
}

func TestParsePushPorcelain_ForcedSuccess(t *testing.T) {
	t.Parallel()
	stdout := "To ../rem.git\n+\trefs/heads/main:refs/heads/main\tebe905a...b14ae70 (forced update)\nDone\n"
	got, err := ParsePushPorcelain([]byte(stdout))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 || got[0].Flag != '+' {
		t.Fatalf("got %+v", got)
	}
	updates := PushUpdates(got)
	if len(updates) != 1 || *updates[0].From != "ebe905a" || *updates[0].To != "b14ae70" || !updates[0].Forced {
		t.Fatalf("updates = %+v", updates)
	}
}

func TestParsePushPorcelain_NewBranchWithSetUpstream(t *testing.T) {
	t.Parallel()
	stdout := "To ../rem.git\n*\trefs/heads/fq:refs/heads/fq\t[new branch]\nDone\n"
	got, err := ParsePushPorcelain([]byte(stdout))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 || got[0].Flag != '*' || got[0].Summary != "[new branch]" {
		t.Fatalf("got %+v", got)
	}
	updates := PushUpdates(got)
	if len(updates) != 1 || updates[0].From != nil || updates[0].To != nil {
		t.Fatalf("updates = %+v, want both null (no sha in the porcelain summary)", updates)
	}
}

func TestParsePushPorcelain_NonFastForwardRejection(t *testing.T) {
	t.Parallel()
	// Probe P5's own non-ff rejection row.
	stdout := "To ../rem.git\n!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\nDone\n"
	got, err := ParsePushPorcelain([]byte(stdout))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 || got[0].Reason != "fetch first" {
		t.Fatalf("got %+v", got)
	}
	// A rejected line moved nothing.
	if updates := PushUpdates(got); len(updates) != 0 {
		t.Fatalf("updates = %+v, want none for a rejected push", updates)
	}
}

func TestParsePushPorcelain_LeaseViolations(t *testing.T) {
	t.Parallel()
	// Probe P6's three lease shapes.
	cases := []struct {
		summary string
		reason  string
	}{
		{"[rejected] (stale info)", "stale info"},
		{"[rejected] (remote ref updated since checkout)", "remote ref updated since checkout"},
	}
	for _, c := range cases {
		stdout := "To ../rem.git\n!\trefs/heads/main:refs/heads/main\t" + c.summary + "\nDone\n"
		got, err := ParsePushPorcelain([]byte(stdout))
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if len(got) != 1 || got[0].Reason != c.reason {
			t.Fatalf("summary %q: got %+v, want reason %q", c.summary, got, c.reason)
		}
	}
}

func TestParsePushPorcelain_HookRejection(t *testing.T) {
	t.Parallel()
	// Probe P7.
	stdout := "To ../rem.git\n!\trefs/heads/main:refs/heads/main\t[remote rejected] (pre-receive hook declined)\nDone\n"
	got, err := ParsePushPorcelain([]byte(stdout))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 || got[0].Reason != "pre-receive hook declined" {
		t.Fatalf("got %+v", got)
	}
}

// TestParsePushPorcelain_SetUpstreamAsideIsSkipped is probed directly in this container:
// `--set-upstream` injects its own human-readable, tab-free aside into the same porcelain block
// ("branch 'x' set up to track 'origin/x'." — sandwiched between the ref line and "Done"), which
// must be skipped rather than treated as a malformed ref line.
func TestParsePushPorcelain_SetUpstreamAsideIsSkipped(t *testing.T) {
	t.Parallel()
	stdout := "To ../rem.git\n*\trefs/heads/feature:refs/heads/feature\t[new branch]\n" +
		"branch 'feature' set up to track 'origin/feature'.\nDone\n"
	got, err := ParsePushPorcelain([]byte(stdout))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 || got[0].Flag != '*' {
		t.Fatalf("got %+v, want exactly the one ref line", got)
	}
}

func TestParsePushPorcelain_DeleteSuccess(t *testing.T) {
	t.Parallel()
	stdout := "To ../rem.git\n-\t:refs/heads/gone\t[deleted]\nDone\n"
	got, err := ParsePushPorcelain([]byte(stdout))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 || got[0].Flag != '-' || got[0].Src != "" || got[0].Dst != "refs/heads/gone" {
		t.Fatalf("got %+v", got)
	}
}

func TestExtractRemoteMessage_StripsPrefixAndRightTrimsPaddedLines(t *testing.T) {
	t.Parallel()
	// Probe P7: git right-pads "remote:" lines.
	stderr := "remote: policy: no pushes on Fridays        \nerror: failed to push some refs\n"
	got := ExtractRemoteMessage(stderr)
	if got != "policy: no pushes on Fridays" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractRemoteMessage_MultipleLinesJoinedWithNewline(t *testing.T) {
	t.Parallel()
	stderr := "remote: line one   \nremote: line two\nsomething else\n"
	got := ExtractRemoteMessage(stderr)
	if got != "line one\nline two" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractRemoteMessage_NoRemoteLinesIsEmpty(t *testing.T) {
	t.Parallel()
	if got := ExtractRemoteMessage("error: failed to push\n"); got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}
