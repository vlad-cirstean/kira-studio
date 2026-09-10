package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/logsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpath"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitstore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// ChunkRows is upstream's own CHUNK_ROWS (repoService.ts:711) — how many rows one graph.stream
// wire chunk carries.
const ChunkRows = 500

// walkSpecFrom resolves D6's optional scope/pageSize into a porcelain.WalkSpec and a concrete
// page size. G18 D6 upgrades what "the server's own default" means: entry's own stored
// kiraVersion.graph.* settings (RepoEntry.RepoSettings, itself falling back to the schema's own
// "all"/5000 defaults when entry is nil or storage has nothing stored) — reached by every raw
// socket client that omits scope/pageSize, with zero change to either param's own wire shape.
func walkSpecFrom(entry *gitsession.RepoEntry, scope string, pageSize *int) (porcelain.WalkSpec, int) {
	if scope == "" {
		scope = repoGraphScope(entry)
	}
	return porcelain.WalkSpec{Scope: scope, ExcludeStash: excludeStashFor(entry)}, pageSizeFrom(entry, pageSize)
}

// excludeStashFor is G28 D15's own settings-side wiring for the decidable "off" half of
// kiraVersion.stash.showInGraph (F13: inert since G18) — a server-side read from the repo's own
// stored settings, so no wire change at all. nil entry (no repo.open has happened yet) reads as
// false, the setting's own default ("on", today's de-facto behaviour).
func excludeStashFor(entry *gitsession.RepoEntry) bool {
	if entry == nil {
		return false
	}
	return !entry.RepoSettings().StashShowInGraph
}

func pageSizeFrom(entry *gitsession.RepoEntry, pageSize *int) int {
	if pageSize != nil && *pageSize > 0 {
		return *pageSize
	}
	if entry != nil {
		if stored := entry.RepoSettings().GraphPageSize; stored > 0 {
			return stored
		}
	}
	return logsession.DefaultPageSize
}

// repoGraphScope is walkSpecFrom's own scope-side default (D6) — "all" when entry is nil (no
// repo.open has happened yet — never reached by a well-behaved client, since c.Walk itself
// requires a held repo) or the repo has never stored a scope of its own.
func repoGraphScope(entry *gitsession.RepoEntry) string {
	if entry != nil {
		if stored := entry.RepoSettings().GraphScope; stored != "" {
			return stored
		}
	}
	return "all"
}

// rangedWalkSpecFrom validates rng's base/branch (D8/F6: `merge-base` takes its revisions as
// separate argv tokens, so a leading "-" is refused rather than trusted to git's own argument
// parser) and returns the ranged WalkSpec (D2). Scope is left empty and IncludeStash false,
// deliberately: RevSetArgs never reads Scope for a ranged walk and matchesSpec compares it, so
// filling it from the extension's injected graph.scope would churn a review walk that ignores
// scope entirely; a stash is not one of a branch's own commits either.
func rangedWalkSpecFrom(rng *CommitRangeParams) (porcelain.WalkSpec, error) {
	if err := validRefArg("range.base", rng.Base); err != nil {
		return porcelain.WalkSpec{}, err
	}
	if err := validRefArg("range.branch", rng.Branch); err != nil {
		return porcelain.WalkSpec{}, err
	}
	return porcelain.WalkSpec{Range: &porcelain.RangeSpec{Base: rng.Base, Branch: rng.Branch}}, nil
}

// mapConnError turns gitsession's own closed error vocabulary into an ipcerr — today just
// ErrRepoNotHeld (repo.open must precede any graph.* call, exactly as it must for every other
// per-repo request).
func mapConnError(err error) error {
	if errors.Is(err, gitsession.ErrRepoNotHeld) {
		return ipcerr.BadRequest("gitrpc: repository is not open on this connection")
	}
	return err
}

func (r *Router) handleGraphStatus(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p GraphStatusParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: graph.status: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: graph.status: repoId is required")
	}
	// G31 round-2 architecture/security review, finding #4: normalized once, here, at wire
	// ingestion — see this file's own resolveWalkRequest, which already normalized ITS internal
	// c.Entry lookup but left every c.Walk/WalkFor/ReviewWalkFor call in this file using the raw
	// p.RepoID. Conn's own maps are keyed by entry.Summary.RepoID (NFC, since Identify normalizes),
	// so a decomposed repoId for a non-ASCII repository path failed ErrRepoNotHeld here even
	// though commit.detail/file.read (entryFor, detail.go) already normalize and work fine.
	p.RepoID = gitpath.CleanNFC(p.RepoID)

	// D10: `range` present -> the review walk's own counters, never the graph's.
	if p.Range != nil {
		if _, err := rangedWalkSpecFrom(p.Range); err != nil {
			return nil, err
		}
		w, ok := c.ReviewWalkFor(p.RepoID)
		if !ok {
			// The same zero-value answer G3 D14 gives for an unopened graph walk.
			return GraphStatusResult{}, nil
		}
		loaded, remaining, exhausted, err := w.Status(ctx)
		if err != nil {
			return nil, mapGitError(err)
		}
		return GraphStatusResult{Loaded: loaded, Remaining: remaining, Exhausted: exhausted}, nil
	}

	w, ok := c.WalkFor(p.RepoID)
	if !ok {
		// upstream's own answer for an unopened walk (repoService.ts:1005-1017).
		return GraphStatusResult{}, nil
	}
	loaded, remaining, exhausted, err := w.Status(ctx)
	if err != nil {
		return nil, mapGitError(err)
	}
	return GraphStatusResult{Loaded: loaded, Remaining: remaining, Exhausted: exhausted}, nil
}

func (r *Router) handleGraphLoadMore(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p GraphLoadMoreParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: graph.loadMore: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: graph.loadMore: repoId is required")
	}
	p.RepoID = gitpath.CleanNFC(p.RepoID) // G31 round-2 architecture/security review, finding #4.

	status := r.deps.Discovery.Status(ctx, gitPathFrom(r.deps.Registry))
	if status.Kind != "ok" {
		return nil, ipcerr.New("E_GIT_UNAVAILABLE", "gitrpc: git is unavailable: "+status.Kind)
	}

	// D10: `range` present -> pages the review walk, never the graph's.
	spec, pageSize, precomputedTotal, err := resolveWalkRequest(c, p.RepoID, p.Range, p.Scope, p.PageSize)
	if err != nil {
		return nil, err
	}
	w, err := c.Walk(p.RepoID, status.Path, spec, pageSize, precomputedTotal)
	if err != nil {
		return nil, mapConnError(err)
	}

	pages := 1
	if p.Pages != nil && *p.Pages > 0 {
		pages = *p.Pages
	}
	started, err := w.ReadPage(ctx, pages)
	if err != nil {
		return nil, mapGitError(err)
	}
	return GraphLoadMoreResult{Started: started}, nil
}

func (r *Router) handleGraphRefresh(_ context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p GraphRefreshParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: graph.refresh: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: graph.refresh: repoId is required")
	}
	p.RepoID = gitpath.CleanNFC(p.RepoID) // G31 round-2 architecture/security review, finding #4.

	// graph.refresh has no `range` — the review view has no refresh affordance (D10).
	w, ok := c.WalkFor(p.RepoID)
	if !ok {
		return GraphRefreshResult{Restarted: false}, nil
	}
	w.MarkRefresh()
	return GraphRefreshResult{Restarted: true}, nil
}

// resolveWalkRequest is graph.loadMore/graph.stream's shared range-vs-scope resolution: with a
// `range`, it validates the two ref fields (D8) and peeks the per-repo range-count slot (D9, a
// non-blocking best-effort optimisation — a miss passes nil and logsession runs its own count);
// without one, it resolves D6's scope/pageSize as before. entry is looked up once, here, and
// threaded into both branches — the range branch already needed it for the range-count peek; the
// non-ranged branch now needs it too, for G18 D6's own per-repo scope/pageSize defaults.
func resolveWalkRequest(c *gitsession.Conn, repoID string, rng *CommitRangeParams, scope string, pageSize *int) (porcelain.WalkSpec, int, *int, error) {
	entry, _ := c.Entry(gitpath.CleanNFC(repoID)) // G27 D6; nil, ok=false when unheld — c.Walk below rejects that case itself.

	if rng == nil {
		spec, size := walkSpecFrom(entry, scope, pageSize)
		return spec, size, nil, nil
	}
	spec, err := rangedWalkSpecFrom(rng)
	if err != nil {
		return porcelain.WalkSpec{}, 0, nil, err
	}
	var precomputedTotal *int
	if entry != nil {
		precomputedTotal = entry.TakeRangeCount(rng.Base, rng.Branch)
	}
	return spec, pageSizeFrom(entry, pageSize), precomputedTotal, nil
}

// handleGraphStream serves graph.stream: upstream's streamGraph, via gitsession.Walk.Stream
// (D14) — every emitted StreamChunk is packed to a FlatBuffer (gitstore.EncodeChunkFrame) and
// handed to rpcstream's emit as the chunk envelope's out-of-band blob (D4/D5). `range` present
// (D10) streams the review walk instead of the graph's; resumeThroughRow is never read on the
// ranged path (D11) — a ranged walk has no persisted cache to resume from, only whatever this
// walk's own store already holds, which Stream replays regardless.
func (r *Router) handleGraphStream(ctx context.Context, c *gitsession.Conn, params json.RawMessage, emit func(payload any, blob []byte) error) error {
	var p GraphStreamParams
	if err := json.Unmarshal(params, &p); err != nil {
		return ipcerr.BadRequest("gitrpc: graph.stream: invalid params")
	}
	if p.RepoID == "" {
		return ipcerr.BadRequest("gitrpc: graph.stream: repoId is required")
	}
	p.RepoID = gitpath.CleanNFC(p.RepoID) // G31 round-2 architecture/security review, finding #4:
	// also fixes graph.stream's own chunk echo (RepoID: p.RepoID below) carrying the client's raw
	// spelling while repo.changed events carry the NFC one — a client keying state on repoId used
	// to see two spellings for one repository.

	spec, pageSize, precomputedTotal, err := resolveWalkRequest(c, p.RepoID, p.Range, p.Scope, p.PageSize)
	if err != nil {
		return err
	}
	status := r.deps.Discovery.Status(ctx, gitPathFrom(r.deps.Registry))
	if status.Kind != "ok" {
		return ipcerr.New("E_GIT_UNAVAILABLE", "gitrpc: git is unavailable: "+status.Kind)
	}
	w, err := c.Walk(p.RepoID, status.Path, spec, pageSize, precomputedTotal)
	if err != nil {
		return mapConnError(err)
	}

	resumeThroughRow := p.ResumeThroughRow
	if p.Range != nil {
		resumeThroughRow = nil
	}
	return w.Stream(ctx, resumeThroughRow, ChunkRows, func(chunk gitsession.StreamChunk) error {
		blob := gitstore.EncodeChunkFrame(chunk.Packed)
		payload := graphChunk{
			RepoID: p.RepoID, Seq: chunk.Seq, From: chunk.From, To: chunk.To,
			Source: chunk.Source, Remaining: chunk.Remaining, Exhausted: chunk.Exhausted,
		}
		return emit(payload, blob)
	})
}
