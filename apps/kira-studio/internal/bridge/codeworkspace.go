package bridge

import (
	"context"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// CodeWorkspaceService is C5 §3.3's whole bound surface: repo import/rename/remove plus the two
// read primitives (ListFiles, ReadFile) the native code-viewing workspace needs. §11's read-only
// guarantee starts here — no method in this file writes into a repository's working tree, and
// every git invocation below goes through internal/codeworkspace, which builds every Spec with
// ReadOnly: true.
type CodeWorkspaceService struct {
	Deps appcore.Deps
	// Discovery/Runner mirror gitrpc's own seam (Deps.Discovery/Deps.Runner) rather than reusing
	// GitRegistry — this workspace needs one read-only runner and the resolved git.path, never the
	// refcounted RepoEntry lifecycle gitsession.Registry owns.
	Discovery *gitclient.Discovery
	Runner    gitclient.Runner
	// Registry is internal/codeworkspace's own per-repo session registry (§2/§12) — reserved for
	// C6 to extend with a codeindex.Index and a catfile.Session; this phase only opens/closes it.
	Registry *codeworkspace.Registry
}

type CodeWorkspaceIDArgs struct {
	ID string `json:"id"`
}

type CodeWorkspaceImportArgs struct {
	Path string `json:"path"`
}

type CodeWorkspaceRenameArgs struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type CodeWorkspaceReadFileArgs struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

// gitPathSetting reads the current git.path setting fresh — the same "never cached, read on every
// call" discipline gitrpc's own gitPathFrom helper follows (a stale value here is a correctness
// bug, not a performance one).
func (s *CodeWorkspaceService) gitPathSetting() string {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		return ""
	}
	return settings.Git.GitPath
}

// session resolves id's own code_repos row into an internal/codeworkspace.Session, ready for a
// ListFiles/ReadFile call — re-resolved on every request (Registry.Open is cheap, §2) rather than
// trusting a cached session that could be running against a stale git.path.
func (s *CodeWorkspaceService) session(ctx context.Context, id string) (*codeworkspace.Session, *model.CodeRepo, error) {
	repo, err := s.Deps.Repos.CodeRepos.Get(id)
	if err != nil {
		return nil, nil, ipcerr.Internal(err.Error())
	}
	if repo == nil {
		return nil, nil, ipcerr.New("E_NOT_FOUND", "codeworkspace: repository not found")
	}
	status := s.Discovery.Status(ctx, s.gitPathSetting())
	if status.Kind != "ok" {
		return nil, nil, ipcerr.New("E_GIT_UNAVAILABLE", "codeworkspace: git is unavailable: "+status.Kind)
	}
	return s.Registry.Open(repo.ID, repo.Root, s.Runner, status.Path), repo, nil
}

// ListRepos returns every imported repository, sort_order then name (CodeReposRepo.List's own
// order — the panel's own list, oldest-imported-first until a user reorders it, matching
// ConnectionsRepo's own convention).
func (s *CodeWorkspaceService) ListRepos() ([]model.CodeRepo, error) {
	repos, err := s.Deps.Repos.CodeRepos.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return repos, nil
}

// ImportRepo identifies path via gitclient.Identify and stores it as a code_repos row — a plain
// E_INVALID for a bare repository (no worktree to browse) or a path that isn't a git repository at
// all, per §3.3's own contract; a friendlier E_ALREADY_IMPORTED than the UNIQUE index's own
// constraint-violation text when repo_id is already stored.
func (s *CodeWorkspaceService) ImportRepo(ctx context.Context, args CodeWorkspaceImportArgs) (model.CodeRepo, error) {
	if args.Path == "" {
		return model.CodeRepo{}, ipcerr.BadRequest("path is required")
	}
	status := s.Discovery.Status(ctx, s.gitPathSetting())
	if status.Kind != "ok" {
		return model.CodeRepo{}, ipcerr.New("E_GIT_UNAVAILABLE", "codeworkspace: git is unavailable: "+status.Kind)
	}
	summary, err := gitclient.Identify(ctx, s.Runner, status.Path, args.Path)
	if err != nil {
		return model.CodeRepo{}, ipcerr.New("E_INVALID", "not a git repository: "+err.Error())
	}
	if summary.IsBare {
		return model.CodeRepo{}, ipcerr.New("E_INVALID", "a bare repository has no worktree to browse")
	}

	existing, err := s.Deps.Repos.CodeRepos.List()
	if err != nil {
		return model.CodeRepo{}, ipcerr.Internal(err.Error())
	}
	for _, r := range existing {
		if r.RepoID == summary.RepoID {
			return model.CodeRepo{}, ipcerr.New("E_ALREADY_IMPORTED", r.Name+" is already imported")
		}
	}

	rec := model.CodeRepo{
		ID:        uuid.NewString(),
		Name:      filepath.Base(summary.Root),
		Root:      summary.Root,
		RepoID:    summary.RepoID,
		CreatedAt: model.NowISO(),
	}
	created, err := s.Deps.Repos.CodeRepos.Create(rec)
	if err != nil {
		return model.CodeRepo{}, ipcerr.Internal(err.Error())
	}
	return created, nil
}

func (s *CodeWorkspaceService) RenameRepo(args CodeWorkspaceRenameArgs) (model.CodeRepo, error) {
	if args.ID == "" {
		return model.CodeRepo{}, ipcerr.BadRequest("id is required")
	}
	if args.Name == "" {
		return model.CodeRepo{}, ipcerr.BadRequest("name is required")
	}
	rec, err := s.Deps.Repos.CodeRepos.Rename(args.ID, args.Name)
	if err != nil {
		return model.CodeRepo{}, ipcerr.Internal(err.Error())
	}
	return rec, nil
}

// RemoveRepo drops the row, its tab rows (CodeReposRepo.Remove's own transaction, §3.1) and stops
// any session (§3.3) — the renderer closes the workspace's own switcher entry and open tabs on the
// TS side; this is the storage/session half.
func (s *CodeWorkspaceService) RemoveRepo(args CodeWorkspaceIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Deps.Repos.CodeRepos.Remove(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	s.Registry.Close(args.ID)
	return nil
}

func (s *CodeWorkspaceService) ListFiles(ctx context.Context, args CodeWorkspaceIDArgs) (codeworkspace.FileListing, error) {
	if args.ID == "" {
		return codeworkspace.FileListing{}, ipcerr.BadRequest("id is required")
	}
	sess, _, err := s.session(ctx, args.ID)
	if err != nil {
		return codeworkspace.FileListing{}, err
	}
	listing, err := codeworkspace.ListFiles(ctx, sess)
	if err != nil {
		return codeworkspace.FileListing{}, ipcerr.Internal(err.Error())
	}
	return listing, nil
}

// ReadFile validates args.Path against the session's own root (§11) before ever touching disk —
// every path crossing this boundary is checked for ".." traversal and symlink escape via
// filepath.EvalSymlinks, since a repository can contain a symlink pointing anywhere on the
// machine.
func (s *CodeWorkspaceService) ReadFile(ctx context.Context, args CodeWorkspaceReadFileArgs) (codeworkspace.FileContent, error) {
	if args.ID == "" {
		return codeworkspace.FileContent{}, ipcerr.BadRequest("id is required")
	}
	if args.Path == "" {
		return codeworkspace.FileContent{}, ipcerr.BadRequest("path is required")
	}
	sess, _, err := s.session(ctx, args.ID)
	if err != nil {
		return codeworkspace.FileContent{}, err
	}
	absPath, err := codeworkspace.ValidateRelPath(sess.Root, args.Path)
	if err != nil {
		return codeworkspace.FileContent{}, ipcerr.New("E_INVALID", err.Error())
	}
	content, err := codeworkspace.ReadFile(absPath, args.Path)
	if err != nil {
		return codeworkspace.FileContent{}, ipcerr.Internal(err.Error())
	}
	return content, nil
}
