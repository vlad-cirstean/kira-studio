// Package tree is the Go analogue of src/main/tree-service.ts: L1 cache-aside for
// children/describe/definition over internal/storage/repos.MetadataCacheRepo, backed by the
// engine when the cache misses, is bypassed, or fails its own validator (P55 §1.6 — a naive
// json.Unmarshal is not a substitute for zod's safeParse, so the model package's explicit
// validators are what makes the "drop the cached row" path reachable at all).
package tree

import (
	"encoding/json"

	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// Connected is the one thing tree needs from the connections service. A one-method interface
// (P54 D14's discipline) keeps tree's tests able to set a connection's state directly instead of
// driving a real connect, while a real *connections.Service satisfies it too.
type Connected interface {
	StateOf(connectionID string) model.ConnectionState
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
	conns  *repos.ConnectionsRepo
	meta   *repos.MetadataCacheRepo
	host   *enginehost.Host
	states Connected
}

func New(conns *repos.ConnectionsRepo, meta *repos.MetadataCacheRepo, host *enginehost.Host, states Connected) *Service {
	return &Service{conns: conns, meta: meta, host: host, states: states}
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
	payload, err := s.host.Call(enginehost.OpChildren, map[string]any{"connectionId": connectionID, "path": nodePath})
	if err != nil {
		return ChildrenResult{}, err
	}
	var result struct {
		Nodes     []model.TreeNode `json:"nodes"`
		Truncated bool             `json:"truncated"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return ChildrenResult{}, ipcerr.Internal(err.Error())
	}
	if result.Truncated {
		_ = s.meta.Drop(connectionID, path)
	} else if encoded, err := json.Marshal(result.Nodes); err == nil {
		_ = s.meta.Put(connectionID, path, "children", encoded)
	}
	return ChildrenResult{Nodes: result.Nodes, Source: "server", Truncated: result.Truncated}, nil
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
	payload, err := s.host.Call(enginehost.OpDescribe, map[string]any{
		"connectionId": connectionID, "path": nodePath, "tabId": tabID,
	})
	if err != nil {
		return DescribeResult{}, err
	}
	var result struct {
		Meta model.ObjectMeta `json:"meta"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return DescribeResult{}, ipcerr.Internal(err.Error())
	}
	if encoded, err := json.Marshal(result.Meta); err == nil {
		_ = s.meta.Put(connectionID, path, "describe", encoded)
	}
	return DescribeResult{Meta: result.Meta, Source: "server"}, nil
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
	payload, err := s.host.Call(enginehost.OpDefinition, map[string]any{
		"connectionId": connectionID, "path": nodePath, "tabId": tabID,
	})
	if err != nil {
		return DefinitionResult{}, err
	}
	var result struct {
		Definition model.ObjectDefinition `json:"definition"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return DefinitionResult{}, ipcerr.Internal(err.Error())
	}
	if encoded, err := json.Marshal(result.Definition); err == nil {
		_ = s.meta.Put(connectionID, path, "definition", encoded)
	}
	return DefinitionResult{Definition: result.Definition, Source: "server"}, nil
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
