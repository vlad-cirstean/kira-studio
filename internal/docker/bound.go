package docker

import (
	"context"

	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// BoundService is the one Wails-bound Docker surface each app embeds. An app's own
// bridge.DockerService is `struct{ *docker.BoundService }`, so binding names stay app-local while
// every method body lives here.
type BoundService struct {
	m *Manager
}

// NewBoundService builds the service over the real process environment.
func NewBoundService(emit appevent.Emitter) *BoundService {
	return &BoundService{m: NewManager(emit)}
}

// CloseWindowBound ends every stream windowKey started. A package function, not a method: Wails
// binds every exported method, and a bound one would let any window close another's sessions.
func CloseWindowBound(b *BoundService, windowKey string) {
	b.m.closeWindow(windowKey)
}

// ServiceShutdown ends every stream at app quit. Wails calls it on each registered service and
// leaves it out of the bindings.
func (b *BoundService) ServiceShutdown() error {
	b.m.shutdown()
	return nil
}

// StatusArgs is Status' wire shape.
type StatusArgs struct {
	Refresh bool `json:"refresh"`
}

// UseContextArgs is UseContext's wire shape.
type UseContextArgs struct {
	Name string `json:"name"`
}

// ListArgs is Containers' wire shape.
type ListArgs struct {
	All bool `json:"all"`
}

// IDArgs names one container.
type IDArgs struct {
	ID string `json:"id"`
}

// InspectArgs is Inspect's wire shape.
type InspectArgs struct {
	Kind string `json:"kind"` // image | volume | network
	ID   string `json:"id"`
}

// WindowArgs names the calling window.
type WindowArgs struct {
	WindowKey string `json:"windowKey"`
}

// StatsArgs is StatsSubscribe's wire shape.
type StatsArgs struct {
	WindowKey string   `json:"windowKey"`
	IDs       []string `json:"ids"`
}

// StreamArgs names one logs stream.
type StreamArgs struct {
	StreamID string `json:"streamId"`
}

// ExecWriteArgs is ExecWrite's wire shape.
type ExecWriteArgs struct {
	TerminalID string `json:"terminalId"`
	// Data is base64: keystrokes are not always valid UTF-8.
	Data string `json:"data"`
}

// ExecResizeArgs is ExecResize's wire shape.
type ExecResizeArgs struct {
	TerminalID string `json:"terminalId"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
}

// ExecCloseArgs is ExecClose's wire shape.
type ExecCloseArgs struct {
	TerminalID string `json:"terminalId"`
}

// Status pings the engine; Refresh rebuilds the client first so a changed environment is seen.
func (b *BoundService) Status(args StatusArgs) Status {
	return b.m.status(context.Background(), args.Refresh)
}

// Contexts lists the docker contexts, "default" first.
func (b *BoundService) Contexts() ([]ContextInfo, error) {
	got, err := listContexts(b.m.env, b.m.selectedContext())
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return got, nil
}

// UseContext switches the engine for every window; "" returns to automatic resolution.
func (b *BoundService) UseContext(args UseContextArgs) (Status, error) {
	if args.Name != "" {
		if _, _, err := resolveEndpoint(b.m.env, args.Name); err != nil {
			return Status{}, ipcerr.New("E_INVALID", err.Error())
		}
	}
	return b.m.useContext(context.Background(), args.Name), nil
}

func (b *BoundService) Containers(args ListArgs) ([]Container, error) {
	return b.m.containers(context.Background(), args.All)
}

func (b *BoundService) Images() ([]Image, error) { return b.m.images(context.Background()) }

func (b *BoundService) Volumes() ([]Volume, error) { return b.m.volumes(context.Background()) }

func (b *BoundService) Networks() ([]Network, error) { return b.m.networks(context.Background()) }

func (b *BoundService) InspectContainer(args IDArgs) (ContainerDetail, error) {
	return b.m.inspectContainer(context.Background(), args.ID)
}

// Inspect returns the raw inspect JSON of an image, volume or network.
func (b *BoundService) Inspect(args InspectArgs) (InspectResult, error) {
	return b.m.inspect(context.Background(), args.Kind, args.ID)
}

func (b *BoundService) Start(args IDArgs) error { return b.m.start(context.Background(), args.ID) }

func (b *BoundService) Stop(args IDArgs) error { return b.m.stop(context.Background(), args.ID) }

func (b *BoundService) Restart(args IDArgs) error { return b.m.restart(context.Background(), args.ID) }

// Watch starts pushing ChannelChanged for the window.
func (b *BoundService) Watch(args WindowArgs) error {
	if args.WindowKey == "" {
		return ipcerr.New("E_INVALID", "windowKey is required")
	}
	b.m.events.watch(args.WindowKey)
	return nil
}

func (b *BoundService) Unwatch(args WindowArgs) error {
	b.m.events.unwatch(args.WindowKey)
	return nil
}

// StatsSubscribe replaces the window's set of containers whose stats it receives.
func (b *BoundService) StatsSubscribe(args StatsArgs) error {
	if args.WindowKey == "" {
		return ipcerr.New("E_INVALID", "windowKey is required")
	}
	b.m.stats.subscribe(args.WindowKey, args.IDs)
	return nil
}

func (b *BoundService) StatsUnsubscribe(args WindowArgs) error {
	b.m.stats.unsubscribe(args.WindowKey)
	return nil
}

func (b *BoundService) LogsOpen(args LogsOpenArgs) error { return b.m.logsOpen(args) }

func (b *BoundService) LogsClose(args StreamArgs) error {
	b.m.logsClose(args.StreamID)
	return nil
}

func (b *BoundService) ExecOpen(args ExecOpenArgs) (ExecOpenResult, error) { return b.m.execOpen(args) }

func (b *BoundService) ExecWrite(args ExecWriteArgs) error {
	return b.m.execWrite(args.TerminalID, args.Data)
}

func (b *BoundService) ExecResize(args ExecResizeArgs) error {
	return b.m.execResize(context.Background(), args.TerminalID, args.Cols, args.Rows)
}

func (b *BoundService) ExecClose(args ExecCloseArgs) error { return b.m.execClose(args.TerminalID) }

// DiskUsage measures the engine's storage (/system/df). Slow on large hosts; the UI calls it on demand only.
func (b *BoundService) DiskUsage() (DiskUsage, error) { return b.m.diskUsage() }

// ContainerSize measures one container's writable layer and total size on demand.
func (b *BoundService) ContainerSize(args IDArgs) (ContainerSize, error) {
	return b.m.containerSize(args.ID)
}
