package kafka

import (
	"context"
	"strconv"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func init() {
	adapters.Register("kafka", func(deps adapters.Deps) (adapters.Adapter, error) {
		return &Adapter{deps: deps}, nil
	})
}

// Adapter is index.ts's KafkaAdapter.
type Adapter struct {
	deps adapters.Deps

	client *kgo.Client
	admin  *kadm.Client
	// opts is the resolved seed/security options connect() built the long-lived client from —
	// reused to build each browse's own ephemeral kgo.Client (P58e E5) without re-resolving the
	// connection config on every read().
	opts     []kgo.Opt
	readOnly bool
}

func (a *Adapter) Kind() string        { return "kafka" }
func (a *Adapter) Caps() adapters.Caps { return caps }

// Connect is index.ts's connect, extended per P58e E15: kgo.NewClient -> Ping -> kadm.Metadata,
// which recovers a real cluster ID (P32 D13, previously lost) alongside a live, cluster-wide
// broker count (previously only the configured bootstrap-address count).
func (a *Adapter) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *adapters.OpCtx) (adapters.ConnectInfo, error) {
	cl, adm, opts, err := connect(ctx, cfg, a.deps.Log)
	if err != nil {
		return adapters.ConnectInfo{}, err
	}
	meta, err := adm.Metadata(ctx)
	if err != nil {
		cl.Close()
		return adapters.ConnectInfo{}, mapError(err)
	}
	a.client = cl
	a.admin = adm
	a.opts = opts
	a.readOnly = cfg.ReadOnly
	return adapters.ConnectInfo{
		ServerVersion: "Kafka",
		Details: map[string]string{
			"brokers": strconv.Itoa(len(meta.Brokers)),
			"cluster": meta.Cluster,
		},
	}, nil
}

func (a *Adapter) Disconnect(ctx context.Context) error {
	if a.client != nil {
		a.client.Close()
	}
	a.client = nil
	a.admin = nil
	a.opts = nil
	return nil
}

func (a *Adapter) requireAdmin() (*kadm.Client, error) {
	return adapters.RequireConnected(a.admin)
}

// Children is index.ts's children. Root is topics ∪ consumer groups (catalog.go's listRoot); a
// consumerGroup root returns [] (Adapter rule 5 — a leaf, never an error); a topic root one level
// down enumerates partitions (P23 D4: still needed even though the tree no longer expands a topic
// — StreamView.vue's partition filter popover is a second, live caller); anything deeper is a
// leaf.
func (a *Adapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	adm, err := a.requireAdmin()
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	segments := path.Segments
	if len(segments) == 0 {
		nodes, err := listRoot(ctx, adm)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	root := segments[0]
	if root.Kind == "consumerGroup" {
		return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
	}
	if root.Kind != "topic" {
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound,
			"unexpected root path segment kind: "+root.Kind, nil)
	}
	if len(segments) == 1 {
		nodes, err := listPartitions(ctx, adm, root.Name)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}
	return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil // a partition — leaf.
}

// Describe is index.ts's describe — caps.Describe is false (P31 D2); unreachable while that flag
// gates every caller.
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	return model.ObjectMeta{}, adapters.Unsupported("kafka", "describe")
}

// Definition is index.ts's definition.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	adm, err := a.requireAdmin()
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	if len(path.Segments) == 0 {
		return model.ObjectDefinition{}, adapters.New(adapters.CodeNotFound,
			"definition requires a topic or consumer group path, got: "+model.EncodePath(path.Segments), nil)
	}
	switch path.Segments[0].Kind {
	case "topic":
		return buildTopicDefinition(ctx, adm, path.Segments[0].Name)
	case "consumerGroup":
		return buildGroupDefinition(ctx, adm, path.Segments[0].Name)
	default:
		return model.ObjectDefinition{}, adapters.New(adapters.CodeNotFound,
			"definition requires a topic or consumer group path, got: "+model.EncodePath(path.Segments), nil)
	}
}

func (a *Adapter) resolveTopicTarget(path model.NodePath, what string) (string, error) {
	if len(path.Segments) == 0 || path.Segments[0].Kind != "topic" {
		return "", adapters.New(adapters.CodeNotFound,
			what+" requires a topic path, got: "+model.EncodePath(path.Segments), nil)
	}
	return path.Segments[0].Name, nil
}

// Read is index.ts's read.
func (a *Adapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	if a.client == nil || a.admin == nil {
		return nil, adapters.New(adapters.CodeConnect, "adapter is not connected", nil)
	}
	topic, err := a.resolveTopicTarget(req.Path, "read")
	if err != nil {
		return nil, err
	}
	return readTopic(ctx, a.admin, a.opts, topic, req, op)
}

// Count is index.ts's count.
func (a *Adapter) Count(ctx context.Context, req adapters.CountRequest, op *adapters.OpCtx) (adapters.CountResult, error) {
	adm, err := a.requireAdmin()
	if err != nil {
		return adapters.CountResult{}, err
	}
	topic, err := a.resolveTopicTarget(req.Path, "read")
	if err != nil {
		return adapters.CountResult{}, err
	}
	return countTopic(ctx, adm, topic)
}

// Preview is index.ts's preview.
func (a *Adapter) Preview(plan model.MutationPlan) ([]string, error) {
	topic, err := a.resolveTopicTarget(plan.Path, "read")
	if err != nil {
		return nil, err
	}
	return preview(plan, topic)
}

// Mutate is index.ts's mutate.
func (a *Adapter) Mutate(ctx context.Context, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	if a.client == nil {
		return model.MutationResult{}, adapters.New(adapters.CodeConnect, "adapter is not connected", nil)
	}
	topic, err := a.resolveTopicTarget(plan.Path, "read")
	if err != nil {
		return model.MutationResult{}, err
	}
	return produce(ctx, a.client, topic, a.readOnly, plan, op)
}

// Execute is index.ts's execute — caps.SQL is false (P10's D13); never reached.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	return nil, adapters.NoQueryConsole("kafka")
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false; never reached.
func (a *Adapter) DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported("kafka", "file transfer")
}

// Cancel is index.ts's cancel — a permanent no-op (P10's D6/D14, P32 D22). Unlike a sibling that
// carries adapters.RunWithAbortRace, Kafka has no server-side kill mechanism at all — a fetch is a
// request the broker answers or times out, there is no equivalent of pg_cancel_backend or KILL
// QUERY. The op's own context.Context, passed directly to every kadm/kgo call (P58e E3), is the
// entire cancellation story; KF-2 confirmed it aborts an in-flight PollRecords promptly.
// caps.Cancel stays true because that mechanism is real, even though this RPC itself reports
// nothing to forward.
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
	return false, nil
}
