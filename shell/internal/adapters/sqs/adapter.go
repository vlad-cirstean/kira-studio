package sqs

import (
	"context"
	"sync"

	awssqs "github.com/aws/aws-sdk-go-v2/service/sqs"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func init() {
	adapters.Register("sqs", func(deps adapters.Deps) (adapters.Adapter, error) {
		return &Adapter{deps: deps}, nil
	})
}

// Adapter is index.ts's SqsAdapter.
type Adapter struct {
	deps adapters.Deps

	client   *awssqs.Client
	readOnly bool

	// P58d D9: name -> URL, populated by listQueues (free — it already has every URL while paging)
	// and by resolveQueueURL on a miss; avoids a GetQueueUrl round trip on every read()/count()
	// call. Mutex-guarded: two tabs on one connection are two goroutines through one *Adapter in
	// Go, unlike the single-threaded JavaScript this ports from.
	mu        sync.Mutex
	queueURLs map[string]string

	receiptHandles *receiptHandles
}

func (a *Adapter) Kind() string        { return "sqs" }
func (a *Adapter) Caps() adapters.Caps { return caps }

// Connect is index.ts's connect. The SDK client owns no sockets to destroy on failure — unlike
// the TypeScript's client.destroy(), there is no Go counterpart, so a failed listQueues probe
// just returns the mapped error.
func (a *Adapter) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *adapters.OpCtx) (adapters.ConnectInfo, error) {
	client, err := connect(ctx, cfg, a.deps.Log)
	if err != nil {
		return adapters.ConnectInfo{}, err
	}
	if _, err := listQueues(ctx, client); err != nil {
		return adapters.ConnectInfo{}, err
	}
	a.client = client
	a.readOnly = cfg.ReadOnly
	a.queueURLs = map[string]string{}
	a.receiptHandles = newReceiptHandles()
	return adapters.ConnectInfo{ServerVersion: "Amazon SQS"}, nil
}

// Disconnect is index.ts's disconnect. Clears both adapter-local caches under the mutex — the
// property checkpoint scenario 16 asserts.
func (a *Adapter) Disconnect(ctx context.Context) error {
	a.client = nil
	a.mu.Lock()
	a.queueURLs = nil
	a.mu.Unlock()
	if a.receiptHandles != nil {
		a.receiptHandles.clear()
	}
	return nil
}

func (a *Adapter) requireClient() (*awssqs.Client, error) {
	return adapters.RequireConnected(a.client)
}

func (a *Adapter) cacheQueueURL(name, url string) {
	a.mu.Lock()
	a.queueURLs[name] = url
	a.mu.Unlock()
}

func (a *Adapter) cachedQueueURL(name string) (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	url, ok := a.queueURLs[name]
	return url, ok
}

func (a *Adapter) resolveQueueURLCached(ctx context.Context, client *awssqs.Client, name string) (string, error) {
	if url, ok := a.cachedQueueURL(name); ok {
		return url, nil
	}
	url, err := resolveQueueURL(ctx, client, name)
	if err != nil {
		return "", err
	}
	a.cacheQueueURL(name, url)
	return url, nil
}

// Children is index.ts's children. Rule 5 (Adapter doc comment): returns [] for a leaf, never an
// error — a 'queue' node never has children (a flat "region -> queues" tree, no deeper level).
func (a *Adapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	if len(path.Segments) > 0 {
		return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
	}
	client, err := a.requireClient()
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	listing, err := listQueues(ctx, client)
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	for name, url := range listing.urlByName {
		a.cacheQueueURL(name, url)
	}
	return adapters.TreeChildren{Nodes: listing.nodes}, nil
}

// Describe is index.ts's describe — caps.Describe is false; unreachable while that flag gates
// every caller.
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	return model.ObjectMeta{}, adapters.Unsupported("sqs", "describe")
}

func (a *Adapter) resolveQueueTarget(path model.NodePath) (string, error) {
	if len(path.Segments) == 0 || path.Segments[0].Kind != "queue" {
		return "", adapters.New(adapters.CodeNotFound, "read requires a queue path, got: "+model.EncodePath(path.Segments), nil)
	}
	return path.Segments[0].Name, nil
}

// Definition is index.ts's definition.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	client, err := a.requireClient()
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	name, err := a.resolveQueueTarget(path)
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	url, err := a.resolveQueueURLCached(ctx, client, name)
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	return buildQueueDefinition(ctx, client, url, name)
}

// Read is index.ts's read.
func (a *Adapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	client, err := a.requireClient()
	if err != nil {
		return nil, err
	}
	name, err := a.resolveQueueTarget(req.Path)
	if err != nil {
		return nil, err
	}
	url, err := a.resolveQueueURLCached(ctx, client, name)
	if err != nil {
		return nil, err
	}
	return pollQueue(ctx, client, url, req, op, a.receiptHandles)
}

// Count is index.ts's count.
func (a *Adapter) Count(ctx context.Context, req adapters.CountRequest, op *adapters.OpCtx) (adapters.CountResult, error) {
	client, err := a.requireClient()
	if err != nil {
		return adapters.CountResult{}, err
	}
	name, err := a.resolveQueueTarget(req.Path)
	if err != nil {
		return adapters.CountResult{}, err
	}
	url, err := a.resolveQueueURLCached(ctx, client, name)
	if err != nil {
		return adapters.CountResult{}, err
	}
	return countQueue(ctx, client, url)
}

// Preview is index.ts's preview.
func (a *Adapter) Preview(plan model.MutationPlan) ([]string, error) {
	name, err := a.resolveQueueTarget(plan.Path)
	if err != nil {
		return nil, err
	}
	return preview(plan, name)
}

// Mutate is index.ts's mutate.
func (a *Adapter) Mutate(ctx context.Context, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	client, err := a.requireClient()
	if err != nil {
		return model.MutationResult{}, err
	}
	name, err := a.resolveQueueTarget(plan.Path)
	if err != nil {
		return model.MutationResult{}, err
	}
	url, err := a.resolveQueueURLCached(ctx, client, name)
	if err != nil {
		return model.MutationResult{}, err
	}
	return mutateQueue(ctx, client, url, name, a.readOnly, plan, a.receiptHandles, op)
}

// Execute is index.ts's execute — caps.SQL is false; never reached.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	return nil, adapters.NoQueryConsole("sqs")
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false; never reached.
func (a *Adapter) DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported("sqs", "file transfer")
}

// Cancel is index.ts's cancel — a permanent no-op. Unlike every native adapter built before this
// sub-phase, SQS has no server-side kill mechanism at all: the op's own context.Context, passed
// directly to every SDK call in read.go/mutate.go (P58d D3, never adapters.RunWithAbortRace), is
// the entire cancellation story. AWS-1(e) confirmed a cancelled context aborts an in-flight
// ReceiveMessage promptly through the SDK's own plumbing.
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
	return false, nil
}
