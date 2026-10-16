package shell

import "testing"

func TestCloseDecision(t *testing.T) {
	cases := []struct {
		name            string
		ephemeral       bool
		others          int
		wantHide, wantD bool
	}{
		{"ephemeral with no real window left closes and drops row", true, 0, false, true},
		{"ephemeral with real windows closes and drops row", true, 2, false, true},
		{"last real window hides and keeps row", false, 0, true, false},
		{"real window with another real window closes and drops row", false, 1, false, true},
	}
	for _, c := range cases {
		hide, del := closeDecision(c.ephemeral, c.others)
		if hide != c.wantHide || del != c.wantD {
			t.Errorf("%s: got hide=%v delete=%v", c.name, hide, del)
		}
	}
}

func TestRegistryEphemeralNeverCounts(t *testing.T) {
	r := NewWindowRegistry()
	r.Add("main", 0, nil, func() {})
	r.AddEphemeral("rv", nil, func() {})
	if got := r.OthersReal("main"); got != 0 {
		t.Fatalf("OthersReal(main) = %d, want 0 (the review window does not count)", got)
	}
	if !r.RowDecision("rv") {
		t.Fatal("ephemeral window must always delete its row")
	}
	if r.RowDecision("main") {
		t.Fatal("last real window keeps its row")
	}
}
