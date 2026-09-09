package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsearch"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// DefaultSearchLimit mirrors upstream's own DEFAULT_SEARCH_LIMIT (gitsearch.DefaultLimit, D11),
// restated under the wire layer's own name — the same "own name, one alias" precedent graph.go's
// ChunkRows sets for CHUNK_ROWS.
const DefaultSearchLimit = gitsearch.DefaultLimit

// handleSearchRun serves search.run: §7.8's git-backed tail scan (D12/D13). search.run carries no
// `range`/`scope` of its own (contract.ts's own doc comment: "the tail scan is commits-only");
// this resolves and, if needed, lazily opens the connection's current GRAPH walk exactly as
// graph.loadMore/graph.stream already do when no walk has been opened yet (§10.8), so a client
// that calls search.run before ever touching the graph still gets a real answer over the same rev
// set the graph would show.
func (r *Router) handleSearchRun(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p SearchRunParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: search.run: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: search.run: repoId is required")
	}

	// D7's own empty-query short-circuit, taken here too: no reason to open a walk (a side
	// effect for a client that has never touched the graph) or spawn a process for a query with
	// nothing in it.
	if p.Query.Text == "" {
		return SearchRunResult{Kind: "ok", Hits: []SearchHit{}, Complete: true}, nil
	}

	limit := DefaultSearchLimit
	if p.Limit != nil && *p.Limit > 0 {
		limit = *p.Limit
	}

	status := r.deps.Discovery.Status(ctx, gitPathFrom(r.deps.Registry))
	if status.Kind != "ok" {
		return nil, ipcerr.New("E_GIT_UNAVAILABLE", "gitrpc: git is unavailable: "+status.Kind)
	}
	spec, pageSize, precomputedTotal, err := resolveWalkRequest(c, p.RepoID, nil, "", nil)
	if err != nil {
		return nil, err
	}
	w, err := c.Walk(p.RepoID, status.Path, spec, pageSize, precomputedTotal)
	if err != nil {
		return nil, mapConnError(err)
	}

	q := gitsearch.Query{
		Text:          p.Query.Text,
		CaseSensitive: p.Query.CaseSensitive,
		WholeWord:     p.Query.WholeWord,
		Regex:         p.Query.Regex,
	}
	result, err := w.Search(ctx, q, limit)
	if err != nil {
		switch {
		case errors.Is(err, gitsearch.ErrUnsupportedPattern):
			return SearchRunResult{Kind: "unsupportedPattern", Message: err.Error()}, nil
		case errors.Is(err, gitsearch.ErrInvalidPattern):
			return SearchRunResult{Kind: "invalidPattern", Message: err.Error()}, nil
		default:
			return nil, mapGitError(err)
		}
	}

	hits := make([]SearchHit, 0, len(result.Hits))
	for _, h := range result.Hits {
		fields := make([]string, 0, len(h.Fields))
		for _, f := range h.Fields {
			fields = append(fields, string(f))
		}
		hits = append(hits, SearchHit{
			SHA: h.SHA, Subject: h.Subject, AuthorName: h.AuthorName, AuthorEmail: h.AuthorEmail,
			AuthorTime: h.AuthorTime, Fields: fields,
		})
	}
	return SearchRunResult{
		Kind: "ok", Hits: hits, Total: result.Total, Truncated: result.Truncated,
		Scanned: result.Scanned, Complete: result.Complete,
	}, nil
}
