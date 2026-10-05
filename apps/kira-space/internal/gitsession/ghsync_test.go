package gitsession

import "testing"

func TestGhSyncPlanRule(t *testing.T) {
	full := ghSyncFacts{InPr: true, Kind: "full", RecordOID: "a", PrOID: "a"}
	with := func(f ghSyncFacts, mut func(*ghSyncFacts)) ghSyncFacts { mut(&f); return f }
	cases := []struct {
		name       string
		in         ghSyncFacts
		action     string
		reason     string
		dropSynced bool
	}{
		{"full and unviewed marks", full, "mark", "", false},
		{"full and already viewed", with(full, func(f *ghSyncFacts) { f.PrViewed = true }), "alreadyViewed", "", false},
		{"never reviewed", ghSyncFacts{InPr: true, Kind: "none"}, "skip", "notReviewed", false},
		{"partial never syncs", ghSyncFacts{InPr: true, Kind: "partial"}, "skip", "partial", false},
		{"changed since review", with(full, func(f *ghSyncFacts) { f.Changed = true }), "skip", "changedSinceReview", false},
		{"pr head differs from reviewed bytes", with(full, func(f *ghSyncFacts) { f.PrOID = "b" }), "skip", "differsFromPrHead", false},
		{"changed wins over pr head mismatch", with(full, func(f *ghSyncFacts) { f.Changed, f.PrOID = true, "b" }), "skip", "changedSinceReview", false},
		{"unreview of an app-marked file unmarks", ghSyncFacts{InPr: true, Kind: "none", Synced: true, PrViewed: true}, "unmark", "", false},
		{"partial of an app-marked file unmarks", ghSyncFacts{InPr: true, Kind: "partial", Synced: true, PrViewed: true}, "unmark", "", false},
		{"app-marked but already unviewed drops the row silently", ghSyncFacts{InPr: true, Kind: "none", Synced: true}, "", "", true},
		{"app-marked and still full is not unmarked", with(full, func(f *ghSyncFacts) { f.Synced, f.PrViewed = true, true }), "alreadyViewed", "", false},
		{"a viewed file the app never marked is never unmarked", ghSyncFacts{InPr: true, Kind: "none", PrViewed: true}, "skip", "notReviewed", false},
		{"reviewed but not in the PR is listed", ghSyncFacts{Kind: "full"}, "skip", "notInPr", false},
		{"reviewed and app-marked but left the PR drops the row", ghSyncFacts{Kind: "full", Synced: true}, "skip", "notInPr", true},
		{"unreviewed and not in the PR is omitted", ghSyncFacts{Kind: "none"}, "", "", false},
	}
	for _, c := range cases {
		action, reason, drop := ghSyncDecision(c.in)
		if action != c.action || reason != c.reason || drop != c.dropSynced {
			t.Errorf("%s: got (%q, %q, drop=%v), want (%q, %q, drop=%v)", c.name, action, reason, drop, c.action, c.reason, c.dropSynced)
		}
	}
}
