package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/logsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitstore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// ChunkRows is upstream's own CHUNK_ROWS (repoService.ts:711) — how many rows one graph.stream
// wire chunk carries.
const ChunkRows = 500

// rangeRefusal is D14's own honest answer for the three graph.* methods that accept a `range`:
// the ranged/review walk is G6's, not half-served here — the same posture G1 D12 took for a
// single default arm.
func rangeRefusal(method string) error {
	return ipcerr.BadRequest("gitrpc: " + method + ": ranged walks are not served by this build")
}

// walkSpecFrom resolves D6's optional scope/pageSize into a porcelain.WalkSpec and a concrete
// page size — "all" and logsession.DefaultPageSize are the server's own defaults, reached by
// every raw socket client (no settings snapshot to inject from).
func walkSpecFrom(scope string, pageSize *int) (porcelain.WalkSpec, int) {
	if scope == "" {
		scope = "all"
	}
	size := logsession.DefaultPageSize
	if pageSize != nil && *pageSize > 0 {
		size = *pageSize
	}
	return porcelain.WalkSpec{Scope: scope}, size
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
	if p.Range != nil {
		return nil, rangeRefusal("graph.status")
	}

	w, ok := c.WalkFor(p.RepoID)
	if !ok {
		// upstream's own answer for an unopened range/walk (repoService.ts:1005-1017).
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
	if p.Range != nil {
		return nil, rangeRefusal("graph.loadMore")
	}

	spec, pageSize := walkSpecFrom(p.Scope, p.PageSize)
	status := r.deps.Discovery.Status(ctx, "")
	if status.Kind != "ok" {
		return nil, ipcerr.New("E_GIT_UNAVAILABLE", "gitrpc: git is unavailable: "+status.Kind)
	}
	w, err := c.Walk(p.RepoID, status.Path, spec, pageSize, nil)
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

	w, ok := c.WalkFor(p.RepoID)
	if !ok {
		return GraphRefreshResult{Restarted: false}, nil
	}
	w.MarkRefresh()
	return GraphRefreshResult{Restarted: true}, nil
}

// handleGraphStream serves graph.stream: upstream's streamGraph, via gitsession.Walk.Stream
// (D14) — every emitted StreamChunk is packed to a FlatBuffer (gitstore.EncodeChunkFrame) and
// handed to rpcstream's emit as the chunk envelope's out-of-band blob (D4/D5).
func (r *Router) handleGraphStream(ctx context.Context, c *gitsession.Conn, params json.RawMessage, emit func(payload any, blob []byte) error) error {
	var p GraphStreamParams
	if err := json.Unmarshal(params, &p); err != nil {
		return ipcerr.BadRequest("gitrpc: graph.stream: invalid params")
	}
	if p.RepoID == "" {
		return ipcerr.BadRequest("gitrpc: graph.stream: repoId is required")
	}
	if p.Range != nil {
		return rangeRefusal("graph.stream")
	}

	spec, pageSize := walkSpecFrom(p.Scope, p.PageSize)
	status := r.deps.Discovery.Status(ctx, "")
	if status.Kind != "ok" {
		return ipcerr.New("E_GIT_UNAVAILABLE", "gitrpc: git is unavailable: "+status.Kind)
	}
	w, err := c.Walk(p.RepoID, status.Path, spec, pageSize, nil)
	if err != nil {
		return mapConnError(err)
	}

	return w.Stream(ctx, p.ResumeThroughRow, ChunkRows, func(chunk gitsession.StreamChunk) error {
		blob := gitstore.EncodeChunkFrame(chunk.Packed)
		payload := graphChunk{
			RepoID: p.RepoID, Seq: chunk.Seq, From: chunk.From, To: chunk.To,
			Source: chunk.Source, Remaining: chunk.Remaining, Exhausted: chunk.Exhausted,
		}
		return emit(payload, blob)
	})
}
