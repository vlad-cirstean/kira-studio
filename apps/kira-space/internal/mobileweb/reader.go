package mobileweb

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// Reader is the read-only slice of the ADE task service the phone sees. *bridge.AdeTaskService
// satisfies it; tests use a fake. No write method is listed, so none can be reached.
type Reader interface {
	Board(ctx context.Context) (adewire.Board, error)
	Prs(ctx context.Context) (adewire.PrsResult, error)
	Sessions(ctx context.Context) (adewire.SessionsResult, error)
	Workflows(ctx context.Context) (adewire.WorkflowsResult, error)
	Backlog(ctx context.Context) (adewire.BacklogResult, error)
	Repos(ctx context.Context) (adewire.ReposResult, error)
	ReadLog(ctx context.Context, args adewire.ReadLogArgs) (adewire.LogPage, error)
}

// DeviceStore is the trust store for paired phones (storage/repos.MobileDevicesRepo).
type DeviceStore interface {
	ByID(id string) (repos.MobileDeviceRow, bool, error)
	Insert(row repos.MobileDeviceRow) error
	TouchLastSeen(id string, now int64, ip string) error
	Revoke(id string, now int64) error
}
