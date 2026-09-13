package repos_test

import (
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

func newLayoutRepo(t *testing.T) *repos.LayoutRepo {
	return &repos.LayoutRepo{DB: newRepos(t).DB}
}

func boolPtr(b bool) *bool        { return &b }
func floatPtr(f float64) *float64 { return &f }

// TestLayoutRepoSetSurvivesConcurrentDisjointPatches is P8 D13.1's rule: LayoutRepo.Set rewrites
// every leaf on each call (unlike SettingsRepo.Set), so its read-modify-write must be atomic —
// two concurrent Set calls patching entirely different leaves must both survive, not have one
// silently overwrite the other from a stale pre-write snapshot (F7, measured at 109/200 rounds
// lost against the pre-fix code, P8 plan §1.3(d)).
func TestLayoutRepoSetSurvivesConcurrentDisjointPatches(t *testing.T) {
	const rounds = 50
	lost := 0

	for round := 0; round < rounds; round++ {
		r := newLayoutRepo(t)

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = r.Set(model.LayoutPatch{Panel: &model.PanelsPatch{
				Project: &model.PanelProjectPatch{Visible: boolPtr(false)},
			}})
		}()
		go func() {
			defer wg.Done()
			_, _ = r.Set(model.LayoutPatch{Panel: &model.PanelsPatch{
				CellEditor: &model.PanelCellEditorPatch{Height: floatPtr(321)},
			}})
		}()
		wg.Wait()

		got, err := r.GetAll()
		if err != nil {
			t.Fatalf("round %d: GetAll: %v", round, err)
		}
		if got.Panel.Project.Visible != false || got.Panel.CellEditor.Height != 321 {
			lost++
		}
	}

	if lost != 0 {
		t.Fatalf("%d/%d rounds lost one of two disjoint concurrent patches, want 0", lost, rounds)
	}
}
