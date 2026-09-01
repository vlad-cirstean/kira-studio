// Package tree is the Go analogue of src/main/tree-service.ts: L1 cache-aside for
// children/describe/definition over internal/storage/repos.MetadataCacheRepo, backed by the
// engine when the cache misses, is bypassed, or fails its own validator (P55 §1.6 — a naive
// json.Unmarshal is not a substitute for zod's safeParse, so the model package's explicit
// validators are what makes the "drop the cached row" path reachable at all).
package tree

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// Connected is the one thing tree needs from the connections service. A one-method interface
// (P54 D14's discipline) keeps tree's tests able to set a connection's state directly instead of
// driving a real connect, while a real *connections.Service satisfies it too.
type Connected interface {
	StateOf(connectionID string) model.ConnectionState
}

// Backend is the slice of adapter tree operations this service calls through instead of straight
// into *enginehost.Host (A11's per-consumer-interface discipline — the same shape as
// connections.Backend and bridge.Canceller). *adapterhost.Router satisfies this structurally.
// Return types reuse adapters.TreeChildren/model.ObjectMeta/model.ObjectDefinition rather than
// tree-local wrapper types: Source ("cache" | "server") is this service's own concern, set after
// any real Backend call, never something the backend itself decides.
type Backend interface {
	Children(ctx context.Context, connectionID string, path model.NodePath) (adapters.TreeChildren, error)
	Describe(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectMeta, error)
	Definition(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectDefinition, error)
}

type ChildrenResult struct {
	Nodes     []model.TreeNode `json:"nodes"`
	Source    string           `json:"source"` // "cache" | "server"
	Truncated bool             `json:"truncated"`
}

type DescribeResult struct {
	Meta   model.ObjectMeta `json:"meta"`
	Source string           `json:"source"`
}

type DefinitionResult struct {
	Definition model.ObjectDefinition `json:"definition"`
	Source     string                 `json:"source"`
}

type Service struct {
	conns   *repos.ConnectionsRepo
	meta    *repos.MetadataCacheRepo
	backend Backend
	states  Connected
}

func New(conns *repos.ConnectionsRepo, meta *repos.MetadataCacheRepo, backend Backend, states Connected) *Service {
	return &Service{conns: conns, meta: meta, backend: backend, states: states}
}

// wrapErr satisfies P55 §2 D5: every error crossing out of this package is an *ipcerr.Error.
func wrapErr(err error) error {
	if err == nil {
		return nil
	}
	if ie, ok := err.(*ipcerr.Error); ok {
		return ie
	}
	return ipcerr.Internal(err.Error())
}

// requireConnected ports tree-service.ts:73-79. name is the connection row's Name, or the id
// itself if the row is gone — tree-service.ts:77's own fallback, and the message P55 §2 D11
// changed ipcerr.Disconnected to match verbatim.
func (s *Service) requireConnected(connectionID string) error {
	if s.states.StateOf(connectionID).Status == "connected" {
		return nil
	}
	name := connectionID
	if summary, err := s.conns.Get(connectionID); err == nil && summary != nil {
		name = summary.Name
	}
	return ipcerr.Disconnected(name)
}

func (s *Service) getCached(connectionID, path, kind string) (json.RawMessage, bool) {
	raw, err := s.meta.Get(connectionID, path, kind)
	if err != nil || raw == nil {
		return nil, false
	}
	return raw, true
}

// Children ports tree-service.ts:82-108, including P43 iter2 D22 (a truncated listing is never
// cached) and P43 iter3 D38 (a truncated refresh drops any older complete row for the same path).
func (s *Service) Children(connectionID, path string, refresh bool) (ChildrenResult, error) {
	if !refresh {
		if raw, ok := s.getCached(connectionID, path, "children"); ok {
			var nodes []model.TreeNode
			if err := json.Unmarshal(raw, &nodes); err == nil && model.ValidateTreeNodes(nodes) {
				return ChildrenResult{Nodes: nodes, Source: "cache", Truncated: false}, nil
			}
			_ = s.meta.Drop(connectionID, path)
		}
	}
	if err := s.requireConnected(connectionID); err != nil {
		return ChildrenResult{}, err
	}
	nodePath, err := model.DecodePath(connectionID, path)
	if err != nil {
		return ChildrenResult{}, ipcerr.Internal(err.Error())
	}
	result, err := s.backend.Children(context.Background(), connectionID, nodePath)
	if err != nil {
		return ChildrenResult{}, err
	}
	truncated := result.Truncated != nil && *result.Truncated
	if truncated {
		_ = s.meta.Drop(connectionID, path)
	} else if encoded, err := json.Marshal(result.Nodes); err == nil {
		_ = s.meta.Put(connectionID, path, "children", encoded)
	}
	return ChildrenResult{Nodes: result.Nodes, Source: "server", Truncated: truncated}, nil
}

// Describe ports tree-service.ts:110-128. `tabId` tags the resulting op-log row so the requesting
// tab's RunState can find its own duration — a cache hit makes no engine call and so tags
// nothing, which is correct: there is no duration to show for work that never happened.
func (s *Service) Describe(connectionID, path string, refresh bool, tabID *string) (DescribeResult, error) {
	if !refresh {
		if raw, ok := s.getCached(connectionID, path, "describe"); ok {
			var meta model.ObjectMeta
			if err := json.Unmarshal(raw, &meta); err == nil && model.ValidateObjectMeta(&meta) {
				return DescribeResult{Meta: meta, Source: "cache"}, nil
			}
			_ = s.meta.Drop(connectionID, path)
		}
	}
	if err := s.requireConnected(connectionID); err != nil {
		return DescribeResult{}, err
	}
	nodePath, err := model.DecodePath(connectionID, path)
	if err != nil {
		return DescribeResult{}, ipcerr.Internal(err.Error())
	}
	meta, err := s.backend.Describe(context.Background(), connectionID, nodePath, tabID)
	if err != nil {
		return DescribeResult{}, err
	}
	if encoded, err := json.Marshal(meta); err == nil {
		_ = s.meta.Put(connectionID, path, "describe", encoded)
	}
	return DescribeResult{Meta: meta, Source: "server"}, nil
}

// Definition ports tree-service.ts:130-148.
func (s *Service) Definition(connectionID, path string, refresh bool, tabID *string) (DefinitionResult, error) {
	if !refresh {
		if raw, ok := s.getCached(connectionID, path, "definition"); ok {
			var def model.ObjectDefinition
			if err := json.Unmarshal(raw, &def); err == nil && model.ValidateObjectDefinition(&def) {
				return DefinitionResult{Definition: def, Source: "cache"}, nil
			}
			_ = s.meta.Drop(connectionID, path)
		}
	}
	if err := s.requireConnected(connectionID); err != nil {
		return DefinitionResult{}, err
	}
	nodePath, err := model.DecodePath(connectionID, path)
	if err != nil {
		return DefinitionResult{}, ipcerr.Internal(err.Error())
	}
	definition, err := s.backend.Definition(context.Background(), connectionID, nodePath, tabID)
	if err != nil {
		return DefinitionResult{}, err
	}
	if encoded, err := json.Marshal(definition); err == nil {
		_ = s.meta.Put(connectionID, path, "definition", encoded)
	}
	return DefinitionResult{Definition: definition, Source: "server"}, nil
}

// Invalidate drops L1 for one node (path non-nil) or the whole connection (path nil). No push of
// its own — the caller already knows what it asked to invalidate (the D11 reconnect push is
// connections.OnMetadataInvalidated, a separate concern owned by internal/connections).
func (s *Service) Invalidate(connectionID string, path *string) error {
	if path == nil {
		return wrapErr(s.meta.DropConnection(connectionID))
	}
	return wrapErr(s.meta.Drop(connectionID, *path))
}
