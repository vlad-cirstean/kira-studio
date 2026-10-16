package repos

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

func newTestGitRepoSettingsRepo(t *testing.T) *GitRepoSettingsRepo {
	t.Helper()
	db, err := storage.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("storage.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return &GitRepoSettingsRepo{DB: db.DB}
}

// TestGitRepoSettingsRepo_CheckoutAutoStashRoundTrip is P108 Part 17 review F1's own regression
// guard: checkoutAutoStash used to be wired through model.GitRepoSettings/GitRepoSettingsPatch and
// gitrpc/wire.go, but Get never read the stored leaf back and Set never wrote one — so
// repoSettings.set{"kiraSpace.checkout.autoStash": false} silently succeeded while Get kept
// reporting the true default forever. Proven directly against a real DB, not the RPC-layer fake, so
// the storage leaf itself is pinned.
func TestGitRepoSettingsRepo_CheckoutAutoStashRoundTrip(t *testing.T) {
	repo := newTestGitRepoSettingsRepo(t)
	const repoID = "/repos/a"

	got, err := repo.Get(repoID)
	if err != nil {
		t.Fatalf("Get before any write: %v", err)
	}
	if !got.CheckoutAutoStash {
		t.Fatalf("CheckoutAutoStash default = %v, want true", got.CheckoutAutoStash)
	}

	falseVal := false
	if _, err := repo.Set(repoID, model.GitRepoSettingsPatch{CheckoutAutoStash: &falseVal}); err != nil {
		t.Fatalf("Set(checkoutAutoStash=false): %v", err)
	}

	got, err = repo.Get(repoID)
	if err != nil {
		t.Fatalf("Get after Set(false): %v", err)
	}
	if got.CheckoutAutoStash {
		t.Fatalf("CheckoutAutoStash after Set(false) = %v, want false (the leaf was dropped by Get/Set before this fix)", got.CheckoutAutoStash)
	}

	trueVal := true
	if _, err := repo.Set(repoID, model.GitRepoSettingsPatch{CheckoutAutoStash: &trueVal}); err != nil {
		t.Fatalf("Set(checkoutAutoStash=true): %v", err)
	}
	got, err = repo.Get(repoID)
	if err != nil {
		t.Fatalf("Get after Set(true): %v", err)
	}
	if !got.CheckoutAutoStash {
		t.Fatalf("CheckoutAutoStash after Set(true) = %v, want true", got.CheckoutAutoStash)
	}
}
