package llmprompts

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const lineID ID = "ade.sendBack.line"

func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	p := filepath.Join(t.TempDir(), "llm-prompts.json")
	return NewStore(p), p
}

func save(t *testing.T, s *Store, id ID, text string) Snapshot {
	t.Helper()
	snap, err := s.Save([]Change{{ID: id, Text: text, BaseHash: Hash(s.Snapshot().States[id].Text)}})
	if err != nil {
		t.Fatal(err)
	}
	return snap
}

func TestStoreOverrideAndReset(t *testing.T) {
	s, _ := newStore(t)
	snap := save(t, s, lineID, "{{.From}} {{.Branch}} {{.Reason}}!")
	if snap.Revision != 1 || !snap.States[lineID].Overridden {
		t.Fatalf("snapshot = %+v", snap.States[lineID])
	}
	if r := s.Resolve(lineID); !r.Overridden || r.Text != "{{.From}} {{.Branch}} {{.Reason}}!" {
		t.Fatalf("resolve = %+v", r)
	}
	snap = save(t, s, lineID, mustEntry(lineID).Default)
	if snap.States[lineID].Overridden || s.Resolve(lineID).Overridden {
		t.Fatal("default text kept an override")
	}
}

func TestStoreSeesExternalRewrite(t *testing.T) {
	s, p := newStore(t)
	save(t, s, lineID, "{{.From}} {{.Branch}} {{.Reason}}!")
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	b = []byte(strings.Replace(string(b), "}}!", "}}?", 1))
	if err := os.WriteFile(p, b, 0o600); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(p, later, later); err != nil {
		t.Fatal(err)
	}
	if got := s.Resolve(lineID).Text; got != "{{.From}} {{.Branch}} {{.Reason}}?" {
		t.Fatalf("text = %q", got)
	}
}

func TestStoreCorruptFileUsesDefaults(t *testing.T) {
	s, p := newStore(t)
	if err := os.WriteFile(p, []byte("{nope"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := s.Resolve(lineID); got.Overridden || got.Text != mustEntry(lineID).Default {
		t.Fatalf("resolve = %+v", got)
	}
	if s.Snapshot().Error == "" {
		t.Fatal("no error reported")
	}
}

func TestStoreInvalidOverrideFallsBack(t *testing.T) {
	s, p := newStore(t)
	doc := `{"version":1,"revision":3,"overrides":{"` + string(lineID) + `":{"text":"{{.Nope}}","defaultHash":"x","updatedAt":1},"gone.id":{"text":"keep","defaultHash":"x","updatedAt":1}}}`
	if err := os.WriteFile(p, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := s.Resolve(lineID); got.Overridden {
		t.Fatalf("invalid override used: %+v", got)
	}
	st := s.Snapshot().States[lineID]
	if st.Invalid == "" || !st.Overridden || !st.DefaultChanged {
		t.Fatalf("state = %+v", st)
	}
	save(t, s, "ade.rebase.contextLine", "{{.Branch}} {{.Outcome}} {{.Reason}} {{.RunID}}")
	b, _ := os.ReadFile(p)
	if !strings.Contains(string(b), "gone.id") {
		t.Fatal("unknown id dropped on save")
	}
}

func TestStoreConflictAndProblems(t *testing.T) {
	s, _ := newStore(t)
	_, err := s.Save([]Change{{ID: lineID, Text: "{{.From}} {{.Branch}} {{.Reason}}", BaseHash: "stale"}})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("err = %v", err)
	}
	base := Hash(mustEntry(lineID).Default)
	_, err = s.Save([]Change{{ID: lineID, Text: "{{.Nope}}", BaseHash: base}})
	var pe *ProblemsError
	if !errors.As(err, &pe) || len(pe.Problems) == 0 {
		t.Fatalf("err = %v", err)
	}
	if s.Revision() != 0 {
		t.Fatal("failed save changed the file")
	}
}
