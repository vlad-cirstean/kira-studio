package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/tree"
)

type TreeService struct {
	Deps appcore.Deps
}

type TreeChildrenArgs struct {
	ConnectionID string `json:"connectionId"`
	Path         string `json:"path"`
	Refresh      bool   `json:"refresh"`
}

func (s *TreeService) Children(args TreeChildrenArgs) (tree.ChildrenResult, error) {
	if args.ConnectionID == "" {
		return tree.ChildrenResult{}, ipcerr.BadRequest("connectionId is required")
	}
	return s.Deps.Tree.Children(args.ConnectionID, args.Path, args.Refresh)
}

// TreeDescribeArgs is shared by Describe and Definition — both take the same four arguments.
type TreeDescribeArgs struct {
	ConnectionID string  `json:"connectionId"`
	Path         string  `json:"path"`
	Refresh      bool    `json:"refresh"`
	TabID        *string `json:"tabId"`
}

func (s *TreeService) Describe(args TreeDescribeArgs) (tree.DescribeResult, error) {
	if args.ConnectionID == "" {
		return tree.DescribeResult{}, ipcerr.BadRequest("connectionId is required")
	}
	return s.Deps.Tree.Describe(args.ConnectionID, args.Path, args.Refresh, args.TabID)
}

func (s *TreeService) Definition(args TreeDescribeArgs) (tree.DefinitionResult, error) {
	if args.ConnectionID == "" {
		return tree.DefinitionResult{}, ipcerr.BadRequest("connectionId is required")
	}
	return s.Deps.Tree.Definition(args.ConnectionID, args.Path, args.Refresh, args.TabID)
}

// TreeInvalidateArgs's Path nil drops the whole connection; non-nil drops one node.
type TreeInvalidateArgs struct {
	ConnectionID string  `json:"connectionId"`
	Path         *string `json:"path"`
}

func (s *TreeService) Invalidate(args TreeInvalidateArgs) error {
	if args.ConnectionID == "" {
		return ipcerr.BadRequest("connectionId is required")
	}
	return s.Deps.Tree.Invalidate(args.ConnectionID, args.Path)
}
