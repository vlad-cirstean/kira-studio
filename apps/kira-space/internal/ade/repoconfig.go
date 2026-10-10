package ade

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpath"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

const (
	maxNicknameRunes  = 40
	maxIntegration    = 10
	maxEnvironments   = 10
	maxEnvScriptBytes = 4 << 10
	maxPrepareBytes   = 64 << 10
)

var envNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$`)

func (b *TaskBoard) notifyRepos() {
	if b.deps.OnRepos != nil {
		b.deps.OnRepos()
	}
}

// repoConfig finds one repo's config row.
func (b *TaskBoard) repoConfig(codeRepoID string) (model.AdeRepoConfig, error) {
	configs, err := b.deps.RepoConfig.List()
	if err != nil {
		return model.AdeRepoConfig{}, err
	}
	for _, c := range configs {
		if c.CodeRepoID == codeRepoID {
			return c, nil
		}
	}
	return model.AdeRepoConfig{}, invalid("code repo %s not found", codeRepoID)
}

// UpdateRepo applies a partial repo config. The prepare script and timeout go to the shared
// git_repo_settings leaves, so git-ui's worktree add sees them too.
func (b *TaskBoard) UpdateRepo(ctx context.Context, args adewire.UpdateRepoArgs) (adewire.Repo, error) {
	cfg, err := b.repoConfig(args.CodeRepoID)
	if err != nil {
		return adewire.Repo{}, err
	}
	patch, settings, err := b.validatePatch(ctx, cfg, args.Patch)
	if err != nil {
		return adewire.Repo{}, err
	}
	// The settings write goes first: the config row was just read, so Upsert is the write that
	// cannot plausibly fail after it.
	if (settings.WorktreePrepareScript != nil || settings.WorktreePrepareTimeout != nil || settings.WorktreeBasePath != nil) && b.deps.SetRepoSettings != nil {
		if err := b.deps.SetRepoSettings(cfg.RepoID, settings); err != nil {
			return adewire.Repo{}, err
		}
	}
	if err := b.deps.RepoConfig.Upsert(args.CodeRepoID, patch); err != nil {
		if errors.Is(err, repos.ErrRepoConfigMissing) {
			return adewire.Repo{}, invalid("code repo %s not found", args.CodeRepoID)
		}
		return adewire.Repo{}, err
	}
	if err := b.pruneMarks(args.CodeRepoID, patch); err != nil {
		return adewire.Repo{}, err
	}
	if patch.Environments != nil {
		b.goTracked(func() { b.refreshEnvScripts(args.CodeRepoID) })
	}
	b.notifyRepos()
	b.notifyBoard()
	return b.repoByID(ctx, args.CodeRepoID)
}

// validatePatch checks every field before anything is written, so a bad field leaves both stores untouched (a later store failure can still leave the settings applied).
func (b *TaskBoard) validatePatch(ctx context.Context, cfg model.AdeRepoConfig, p adewire.RepoPatch) (model.AdeRepoConfigPatch, model.GitRepoSettingsPatch, error) {
	patch := model.AdeRepoConfigPatch{}
	if p.Nickname != nil {
		nick := strings.TrimSpace(*p.Nickname)
		if utf8.RuneCountInString(nick) > maxNicknameRunes || strings.ContainsAny(nick, "\r\n") {
			return model.AdeRepoConfigPatch{}, model.GitRepoSettingsPatch{}, invalid("nickname must be at most %d characters on one line", maxNicknameRunes)
		}
		patch.Nickname = &nick
	}
	if p.IntegrationBranches != nil {
		branches, err := b.validateIntegration(ctx, cfg, *p.IntegrationBranches)
		if err != nil {
			return model.AdeRepoConfigPatch{}, model.GitRepoSettingsPatch{}, err
		}
		patch.IntegrationBranches = &branches
	}
	if p.Environments != nil {
		envs, err := validateEnvironments(*p.Environments)
		if err != nil {
			return model.AdeRepoConfigPatch{}, model.GitRepoSettingsPatch{}, err
		}
		patch.Environments = &envs
	}
	settings := model.GitRepoSettingsPatch{}
	if p.PrepareScript != nil {
		if len(*p.PrepareScript) > maxPrepareBytes {
			return model.AdeRepoConfigPatch{}, model.GitRepoSettingsPatch{}, invalid("prepareScript is too long")
		}
		settings.WorktreePrepareScript = p.PrepareScript
	}
	if p.PrepareTimeout != nil {
		if _, err := model.ParsePrepareTimeout(*p.PrepareTimeout); err != nil {
			return model.AdeRepoConfigPatch{}, model.GitRepoSettingsPatch{}, invalid("prepareTimeout must be a duration such as 15m, above 0 and at most %s", model.MaxPrepareTimeout)
		}
		settings.WorktreePrepareTimeout = p.PrepareTimeout
	}
	if p.WorktreeBasePath != nil {
		base := *p.WorktreeBasePath
		if base != "" {
			base = gitpath.CleanNFC(base)
		}
		settings.WorktreeBasePath = &base
	}
	return patch, settings, nil
}

// pruneMarks drops marks of targets and environments the patch removed.
func (b *TaskBoard) pruneMarks(id string, patch model.AdeRepoConfigPatch) error {
	if b.deps.Facts != nil {
		if patch.IntegrationBranches != nil {
			if err := b.deps.Facts.DeleteMarksNotIn("target", id, *patch.IntegrationBranches); err != nil {
				return err
			}
		}
		if patch.Environments != nil {
			names := make([]string, len(*patch.Environments))
			for i, e := range *patch.Environments {
				names[i] = e.Name
			}
			if err := b.deps.Facts.DeleteMarksNotIn("env", id, names); err != nil {
				return err
			}
		}
	}
	return nil
}

func (b *TaskBoard) repoByID(ctx context.Context, id string) (adewire.Repo, error) {
	res, err := b.Repos(ctx)
	if err != nil {
		return adewire.Repo{}, err
	}
	for _, r := range res.Repos {
		if r.CodeRepoID == id {
			return r, nil
		}
	}
	return adewire.Repo{}, invalid("code repo %s not found", id)
}

func (b *TaskBoard) validateIntegration(ctx context.Context, cfg model.AdeRepoConfig, in []string) ([]string, error) {
	if len(in) > maxIntegration {
		return nil, invalid("at most %d integration branches", maxIntegration)
	}
	main := b.mainShortName(ctx, cfg.CodeRepoID)
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, raw := range in {
		name := strings.TrimSpace(raw)
		switch {
		case name == "":
			return nil, invalid("an integration branch name is empty")
		case seen[name]:
			return nil, invalid("integration branch %q is listed twice", name)
		case name == main:
			return nil, invalid("%q is the repo main branch; list only the branches besides it", name)
		}
		seen[name] = true
		out = append(out, name)
	}
	return out, nil
}

func validateEnvironments(in []adewire.Environment) ([]model.AdeRepoEnv, error) {
	if len(in) > maxEnvironments {
		return nil, invalid("at most %d environments", maxEnvironments)
	}
	seen := make(map[string]bool, len(in))
	out := make([]model.AdeRepoEnv, 0, len(in))
	for _, e := range in {
		switch {
		case !envNamePattern.MatchString(e.Name):
			return nil, invalid("environment name %q must start with a letter or digit and use letters, digits, . _ - (32 characters at most)", e.Name)
		case seen[e.Name]:
			return nil, invalid("environment %q is listed twice", e.Name)
		case strings.TrimSpace(e.DeployedShaScript) == "":
			return nil, invalid("environment %q needs a script", e.Name)
		case len(e.DeployedShaScript) > maxEnvScriptBytes:
			return nil, invalid("environment %q script is longer than 4 KiB", e.Name)
		}
		seen[e.Name] = true
		out = append(out, model.AdeRepoEnv{Name: e.Name, DeployedShaScript: e.DeployedShaScript})
	}
	return out, nil
}

// --- folders -------------------------------------------------------------------------------------

func wireFolder(f model.AdeFolder) adewire.Folder {
	return adewire.Folder{Path: f.Path, Watch: f.Watch, Hidden: f.Hidden, RepoCount: f.RepoCount, HiddenCount: f.HiddenCount}
}

func (b *TaskBoard) folderByPath(path string) (adewire.Folder, bool, error) {
	folders, err := b.deps.RepoConfig.Folders()
	if err != nil {
		return adewire.Folder{}, false, err
	}
	for _, f := range folders {
		if f.Path == path {
			return wireFolder(f), true, nil
		}
	}
	return adewire.Folder{}, false, nil
}

// AddFolder records path, imports every repo found under it and, when watch is set, keeps looking
// for new ones.
func (b *TaskBoard) AddFolder(ctx context.Context, path string, watch bool) (adewire.FolderImportResult, error) {
	if !filepath.IsAbs(path) {
		return adewire.FolderImportResult{}, invalid("path must be absolute")
	}
	path = filepath.Clean(path)
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return adewire.FolderImportResult{}, invalid("%s is not a folder", path)
	}
	if err := b.deps.RepoConfig.AddFolder(path, watch); err != nil {
		return adewire.FolderImportResult{}, err
	}
	imported, err := b.importFolder(ctx, path)
	if err != nil {
		return adewire.FolderImportResult{}, err
	}
	if watch {
		b.startFolderWatch(path)
	} else {
		b.stopFolderWatch(path)
	}
	folder, _, err := b.folderByPath(path)
	if err != nil {
		return adewire.FolderImportResult{}, err
	}
	b.notifyRepos()
	return adewire.FolderImportResult{Folder: folder, Imported: imported}, nil
}

// SetFolderWatch turns the background look for new repos on or off.
func (b *TaskBoard) SetFolderWatch(_ context.Context, path string, watch bool) (adewire.Folder, error) {
	path = filepath.Clean(path)
	ok, err := b.deps.RepoConfig.SetFolderWatch(path, watch)
	if err != nil {
		return adewire.Folder{}, err
	}
	if !ok {
		return adewire.Folder{}, invalid("folder %s is not in the list", path)
	}
	if watch {
		b.startFolderWatch(path)
	} else {
		b.stopFolderWatch(path)
	}
	folder, _, err := b.folderByPath(path)
	if err != nil {
		return adewire.Folder{}, err
	}
	b.notifyRepos()
	return folder, nil
}

// SetFolderHidden hides or shows every repo imported from path; later discoveries in the folder
// import hidden while the flag is set.
func (b *TaskBoard) SetFolderHidden(_ context.Context, path string, hidden bool) (adewire.Folder, error) {
	path = filepath.Clean(path)
	ok, err := b.deps.RepoConfig.SetFolderHidden(path, hidden)
	if err != nil {
		return adewire.Folder{}, err
	}
	if !ok {
		return adewire.Folder{}, invalid("folder %s is not in the list", path)
	}
	folder, _, err := b.folderByPath(path)
	if err != nil {
		return adewire.Folder{}, err
	}
	b.notifyRepos()
	return folder, nil
}

// RemoveFolder forgets path. Repos imported from it stay imported (Git-module tabs would close
// otherwise) and become plain added repos.
func (b *TaskBoard) RemoveFolder(_ context.Context, path string) error {
	path = filepath.Clean(path)
	b.stopFolderWatch(path)
	ok, err := b.deps.RepoConfig.RemoveFolder(path)
	if err != nil {
		return err
	}
	if !ok {
		return invalid("folder %s is not in the list", path)
	}
	b.notifyRepos()
	return nil
}

// importFolder scans path and imports every repo not yet known; it returns the new code repo ids.
func (b *TaskBoard) importFolder(ctx context.Context, path string) ([]string, error) {
	b.importMu.Lock()
	defer b.importMu.Unlock()
	scan := scanFolder(path)
	imported := make([]string, 0, len(scan.repos))
	if len(scan.repos) == 0 {
		return imported, nil
	}
	status := b.deps.GitStatus(ctx)
	if status.Kind != "ok" {
		return nil, errors.New("ade: git is unavailable: " + status.Kind)
	}
	folderHidden, err := b.deps.RepoConfig.FolderHidden(path)
	if err != nil {
		return nil, err
	}
	for _, root := range scan.repos {
		rec, err := codeworkspace.Import(ctx, b.deps.CodeRepos, b.deps.Runner, status.Path, root,
			codeworkspace.ImportOptions{RejectLinkedWorktree: true, Hidden: folderHidden})
		switch {
		case err == nil:
		case errors.Is(err, codeworkspace.ErrAlreadyImported), errors.Is(err, codeworkspace.ErrLinkedWorktree),
			errors.Is(err, codeworkspace.ErrBare), errors.Is(err, codeworkspace.ErrNotRepo):
			continue
		default:
			slog.Warn("ade folder import", "scope", "ade", "path", root, "err", err)
			continue
		}
		if err := b.deps.RepoConfig.SetSource(rec.ID, path); err != nil {
			return nil, err
		}
		imported = append(imported, rec.ID)
	}
	// SetFolderHidden does not wait for a scan: a flag flipped mid-scan is re-applied to the repos
	// this scan imported, which the flip's own UPDATE could not have seen. The flag is read inside
	// the UPDATE, so a later flip is never overwritten.
	if now, err := b.deps.RepoConfig.FolderHidden(path); err == nil && now != folderHidden {
		if err := b.deps.RepoConfig.ApplyFolderHidden(path, imported); err != nil {
			return nil, err
		}
	}
	return imported, nil
}
