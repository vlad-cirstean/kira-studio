package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/apivars"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/grpcclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// GrpcService is P11 D3/D7/D8's bound service: schema discovery and a call, both run through the
// *existing* op scheduler HttpService already uses (D7) — no new scheduler, no new op log, no new
// cancel path. It is dependency-free of grpcclient's own internals beyond its public surface
// (Describe/Unary/ServerStream/Source/CallRequest), exactly as HttpService is of httpclient's.
type GrpcService struct {
	Deps appcore.Deps
}

// GrpcDescribeArgs names one descriptor source (D4) plus the scope stage 2 resolves the target and
// metadata against (D9) — collectionID/environmentID, both possibly empty (a scratch tab has no
// collection). Reload bypasses grpcclient's own cache (the UI's explicit Reload action, D4).
type GrpcDescribeArgs struct {
	DescriptorMode string                `json:"descriptorMode"`
	Target         string                `json:"target"`
	TLS            grpcclient.TLSConfig  `json:"tls"`
	Metadata       []grpcclient.MetaPair `json:"metadata"`
	ProtoPath      string                `json:"protoPath"`
	ImportPaths    []string              `json:"importPaths"`
	CollectionID   string                `json:"collectionId"`
	EnvironmentID  string                `json:"environmentId"`
	Reload         bool                  `json:"reload"`
}

func validDescriptorMode(mode string) bool {
	return mode == string(grpcclient.SourceReflection) || mode == string(grpcclient.SourceProto)
}

// resolveGrpcSource is Describe's own stage 2 for a descriptor source: target and metadata are the
// two substitutable fields — protoPath/importPaths/caFile are picker-supplied local paths, never
// substituted (P5 D7's own rule for a form-data file row's path, re-handed rather than reopened).
// A .proto descriptor source resolves nothing, because Describe needs no target to reach one — a
// .proto file is read straight off disk. This short-circuit is correct only for Describe: Call
// dials a real network target regardless of which descriptor source supplies its schema, so it
// uses resolveGrpcCallSource below instead, which never skips target/metadata resolution.
// used accumulates into whatever slice the caller points at, so a single resolver's masking
// replacer covers a whole bridge method (P17 D9: each entry is a distinct (Name, Placeholder)
// pair now, not a name→value map — a resolver's own Used() already dedupes within itself, and this
// function's only caller ever calls it once per resolver, so no further dedupe is needed here).
func (s *GrpcService) resolveGrpcSource(args GrpcDescribeArgs, used *[]apivars.UsedSecret) (grpcclient.Source, error) {
	src := grpcclient.Source{
		Mode: grpcclient.SourceMode(args.DescriptorMode), Target: args.Target, TLS: args.TLS,
		Metadata: args.Metadata, ProtoPath: args.ProtoPath, ImportPaths: args.ImportPaths,
	}
	if args.DescriptorMode != string(grpcclient.SourceReflection) {
		return src, nil
	}
	if !grpcHasAnyReference(args.Target, args.Metadata, "") {
		return src, nil
	}
	resolver, err := s.Deps.ApiVars.NewResolver(args.CollectionID, args.EnvironmentID)
	if err != nil {
		return grpcclient.Source{}, err
	}
	if !resolver.Any() {
		return src, nil
	}
	src.Target = resolver.Text(args.Target)
	src.Metadata = resolveMetaPairs(resolver, args.Metadata)
	*used = append(*used, resolver.Used()...)
	return src, nil
}

// grpcHasAnyReference mirrors apivars' own referencedFields short-circuit (resolve.go) for
// gRPC's own three substitutable fields — before ever querying a secret, is there anything to
// resolve at all.
func grpcHasAnyReference(target string, metadata []grpcclient.MetaPair, message string) bool {
	if len(apivars.Names(target)) > 0 {
		return true
	}
	for _, m := range metadata {
		if len(apivars.Names(m.Name)) > 0 || len(apivars.Names(m.Value)) > 0 {
			return true
		}
	}
	return len(apivars.Names(message)) > 0
}

func resolveMetaPairs(resolver *apivars.Resolver, pairs []grpcclient.MetaPair) []grpcclient.MetaPair {
	out := make([]grpcclient.MetaPair, len(pairs))
	for i, m := range pairs {
		out[i] = grpcclient.MetaPair{Name: resolver.Text(m.Name), Value: resolver.Text(m.Value)}
	}
	return out
}

// resolveGrpcCallSource is Call's own stage 2: unlike Describe, a call always needs its target and
// metadata resolved regardless of descriptor mode (a .proto file only supplies the schema — the
// network target it calls is real either way), so there is no descriptor-mode short-circuit here.
// It also resolves the request message in the same pass, through the same Resolver instance
// (built at most once, only when there is anything at all to resolve), rather than Call building a
// second one just for the message.
func (s *GrpcService) resolveGrpcCallSource(args GrpcCallArgs) (grpcclient.Source, string, []apivars.UsedSecret, error) {
	src := grpcclient.Source{
		Mode: grpcclient.SourceMode(args.DescriptorMode), Target: args.Target, TLS: args.TLS,
		Metadata: args.Metadata, ProtoPath: args.ProtoPath, ImportPaths: args.ImportPaths,
	}
	var used []apivars.UsedSecret
	if !grpcHasAnyReference(args.Target, args.Metadata, args.MessageJSON) {
		return src, args.MessageJSON, used, nil
	}
	resolver, err := s.Deps.ApiVars.NewResolver(args.CollectionID, args.EnvironmentID)
	if err != nil {
		return grpcclient.Source{}, "", nil, err
	}
	if !resolver.Any() {
		return src, args.MessageJSON, used, nil
	}
	src.Target = resolver.Text(args.Target)
	src.Metadata = resolveMetaPairs(resolver, args.Metadata)
	resolvedMessage := resolver.Text(args.MessageJSON)
	used = append(used, resolver.Used()...)
	return src, resolvedMessage, used, nil
}

// Describe resolves a target's services and methods (D4). §0.3/D10: the reflection call's own
// metadata is resolved through the same Resolver, in this one bridge method, and never persisted —
// a Describe result records no history row.
func (s *GrpcService) Describe(ctx context.Context, args GrpcDescribeArgs) (grpcclient.Schema, error) {
	if !validDescriptorMode(args.DescriptorMode) {
		return grpcclient.Schema{}, ipcerr.BadRequest("descriptorMode must be 'reflection' or 'proto'")
	}
	if args.DescriptorMode == string(grpcclient.SourceReflection) && args.Target == "" {
		return grpcclient.Schema{}, ipcerr.BadRequest("target is required")
	}
	if args.DescriptorMode == string(grpcclient.SourceProto) && args.ProtoPath == "" {
		return grpcclient.Schema{}, ipcerr.BadRequest("protoPath is required")
	}

	var used []apivars.UsedSecret
	src, err := s.resolveGrpcSource(args, &used)
	if err != nil {
		return grpcclient.Schema{}, mapGrpcError(err)
	}
	if args.Reload {
		grpcclient.InvalidateCache(src)
	}

	schema, err := grpcclient.Describe(ctx, src)
	if err != nil {
		maskGrpcError(err, used)
		return grpcclient.Schema{}, mapGrpcError(err)
	}
	return schema, nil
}

// GrpcCallArgs carries HttpSendArgs' own op-log addressing (OpID/TabID/CollectionID/
// EnvironmentID/ItemID — P2 D3/P5 D6/P8 D2's own reasoning, applied verbatim) plus a gRPC call's
// own fields. WindowKey is D8's own addition — EmitTo needs it to aim a streaming call's message
// batches at the one window that opened it, exactly as TabsService.List/Save and
// WindowsService.Ensure already carry it (control.ts:334-340). Streaming names which of
// Unary/ServerStream this call is — the renderer already knows from the schema it resolved via
// Describe (D14's method picker), so the bridge is told rather than re-resolving the schema a
// second time just to answer its own question.
type GrpcCallArgs struct {
	OpID           string                `json:"opId"`
	TabID          string                `json:"tabId"`
	WindowKey      string                `json:"windowKey"`
	Streaming      bool                  `json:"streaming"`
	DescriptorMode string                `json:"descriptorMode"`
	Target         string                `json:"target"`
	TLS            grpcclient.TLSConfig  `json:"tls"`
	ProtoPath      string                `json:"protoPath"`
	ImportPaths    []string              `json:"importPaths"`
	Service        string                `json:"service"`
	Method         string                `json:"method"`
	MessageJSON    string                `json:"messageJson"`
	Metadata       []grpcclient.MetaPair `json:"metadata"`
	CollectionID   string                `json:"collectionId"`
	EnvironmentID  string                `json:"environmentId"`
	ItemID         string                `json:"itemId"`
}

// Call is bridge/http.go's Send with a different payload, deliberately down to the ordering (D7):
// op.SetCommand receives the UNRESOLVED target and method, both before and after the call — the
// same P5 D6/F3 rule HttpService.Send follows, verbatim.
func (s *GrpcService) Call(ctx context.Context, args GrpcCallArgs) (grpcclient.CallResult, error) {
	if args.OpID == "" {
		return grpcclient.CallResult{}, ipcerr.BadRequest("opId is required")
	}
	if args.TabID == "" {
		return grpcclient.CallResult{}, ipcerr.BadRequest("tabId is required")
	}
	if !validDescriptorMode(args.DescriptorMode) {
		return grpcclient.CallResult{}, ipcerr.BadRequest("descriptorMode must be 'reflection' or 'proto'")
	}
	if args.Service == "" || args.Method == "" {
		return grpcclient.CallResult{}, ipcerr.BadRequest("service and method are required")
	}

	tabID := args.TabID
	spec := adapterhost.OpSpec{ConnectionID: nil, Kind: "grpc", OpID: args.OpID, TabID: &tabID}
	unresolvedMethod := args.Service + "/" + args.Method

	_, value, err := s.Deps.Router.Host().RunOp(ctx, spec,
		func(runCtx context.Context, op *adapters.OpCtx) (any, error) {
			// P5 D6/F3, applied to gRPC verbatim: op_log.command is a persisted SQLite column
			// rendered in the Operations panel, so both the target and the metadata a
			// {{secret}}-shaped authorization value might live in must never reach it resolved.
			op.SetCommand(fmt.Sprintf("%s → %s", unresolvedMethod, args.Target))

			src, resolvedMessage, used, resolveErr := s.resolveGrpcCallSource(args)
			if resolveErr != nil {
				return nil, resolveErr
			}

			callReq := grpcclient.CallRequest{
				Target: src.Target, TLS: args.TLS, Source: src,
				FullMethod:  "/" + args.Service + "/" + args.Method,
				MessageJSON: resolvedMessage, Metadata: src.Metadata,
			}

			var result grpcclient.CallResult
			var callErr error
			if args.Streaming {
				// runServerStream masks its own terminal error before emitting it to the
				// renderer (D8's push channel) — masking here too, after the fact, would be too
				// late for that already-emitted event (finding 4).
				result, callErr = s.runServerStream(runCtx, args, callReq, used)
			} else {
				result, callErr = grpcclient.Unary(runCtx, callReq)
				if callErr != nil {
					maskGrpcError(callErr, used)
				}
			}
			if callErr != nil {
				// D11: "a completed call" includes a cancellation or a failure that received
				// messages — the terminal status the caller sees either way (F8). Only a call
				// that never produced any terminal outcome at all (no Partial) records nothing.
				var gerr *grpcclient.Error
				if errors.As(callErr, &gerr) && gerr.Partial != nil {
					op.SetCommand(fmt.Sprintf("%s → %s → %s", unresolvedMethod, args.Target, gerr.Partial.CodeName))
					s.recordGrpcHistory(args, *gerr.Partial)
				}
				return nil, callErr
			}

			op.SetCommand(fmt.Sprintf("%s → %s → %s", unresolvedMethod, args.Target, result.CodeName))

			s.recordGrpcHistory(args, result)

			return result, nil
		})
	if err != nil {
		return grpcclient.CallResult{}, mapGrpcError(err)
	}
	result, _ := value.(grpcclient.CallResult)
	return result, nil
}

// recordGrpcHistory is P8 D2's rule verbatim, applied to gRPC: recorded from args (stage 1 —
// the target/method/metadata/message as the user typed them, a secret still spelled {{name}}),
// never from the resolved values — best-effort, exactly as bridge/http.go's own Record call is: a
// failed insert logs and the call still returns its result. Only a completed call reaches here
// (Call's own RunOp closure only calls this once grpcclient.Unary/ServerStream has already
// returned successfully); a cancelled or failed stream's partial state is recorded separately by
// runServerStream's own caller once C9's UI needs it — D11 states a cancellation that received
// messages is still a completed call, which is why streaming.go's coalescer's `finish` always
// carries the true partial count for that path too.
func (s *GrpcService) recordGrpcHistory(args GrpcCallArgs, result grpcclient.CallResult) {
	streaming := model.GrpcStreamingUnary
	if args.Streaming {
		streaming = model.GrpcStreamingServer
	}
	messages := make([]model.GrpcCallSnapshotMessage, len(result.Messages))
	for i, m := range result.Messages {
		messages[i] = model.GrpcCallSnapshotMessage{Seq: m.Seq, JSON: m.JSON, WireBytes: m.WireBytes, OffsetMs: m.OffsetMs}
	}
	if err := s.Deps.Repos.GrpcHistory.Record(model.GrpcCallHistoryRecord{
		ItemID: args.ItemID, TabID: args.TabID, EnvironmentID: args.EnvironmentID,
		Target: args.Target, Method: args.Service + "/" + args.Method, Streaming: streaming,
		Metadata: metaPairsToSavedRows(args.Metadata), Message: args.MessageJSON,
		Code: int(result.Code), CodeName: result.CodeName, StatusMessage: result.StatusMessage,
		ElapsedMs: int(result.ElapsedMs), MessageCount: result.MessageCount, MessageBytes: result.MessageBytes,
		Messages: messages,
		Header:   metaPairsToSavedRows(result.Header), Trailer: metaPairsToSavedRows(result.Trailer),
	}); err != nil {
		slog.Warn("recording grpc call history failed", "scope", "bridge/grpc", "opId", args.OpID, "err", err)
	}
}

func metaPairsToSavedRows(pairs []grpcclient.MetaPair) []model.SavedGrpcMetaRow {
	out := make([]model.SavedGrpcMetaRow, len(pairs))
	for i, p := range pairs {
		out[i] = model.SavedGrpcMetaRow{Name: p.Name, Value: p.Value, Enabled: true}
	}
	return out
}

// ---- D8: the coalescing push channel ----

const (
	grpcCoalesceInterval = 60 * time.Millisecond
	grpcCoalesceMaxBatch = 64
)

// GrpcCallEvent is ChannelGrpcCall's own payload (packages/shared/domain/grpc.ts's GrpcCallEvent,
// field for field) — one coalesced batch of a server-streaming call's messages. seq is the index
// of the first message in the batch, so the renderer appends by index and a future reviewer can
// detect a gap; status/error are set only on the terminal event.
type GrpcCallEvent struct {
	CallID   string                 `json:"callId"`
	Seq      int                    `json:"seq"`
	Messages []grpcclient.Message   `json:"messages"`
	Done     bool                   `json:"done"`
	Status   *grpcclient.CallResult `json:"status,omitempty"`
	Error    *GrpcCallEventErr      `json:"error,omitempty"`
}

type GrpcCallEventErr struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// grpcCoalescer is D8's own buffer: accumulates messages from the goroutine RecvMsg-ing the
// stream and flushes on whichever comes first — 60 ms elapsed, 64 messages, or a terminal event
// (flushed immediately, unconditionally, even with zero pending messages, so the renderer always
// sees a done:true event). The timer is the one thing in this package a test needs -race on: it
// is read/reset from a goroutine distinct from the one calling push (D8's own §6.1 note).
type grpcCoalescer struct {
	emit      appcore.Emitter
	windowKey string
	callID    string

	mu      sync.Mutex
	pending []grpcclient.Message
	nextSeq int
	timer   *time.Timer
	done    bool
}

func newGrpcCoalescer(emit appcore.Emitter, windowKey, callID string) *grpcCoalescer {
	return &grpcCoalescer{emit: emit, windowKey: windowKey, callID: callID}
}

// push is grpcclient.ServerStream's onMessage callback — called synchronously from the one
// goroutine reading the stream, never concurrently with itself.
func (c *grpcCoalescer) push(m grpcclient.Message) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done {
		return
	}
	c.pending = append(c.pending, m)
	if len(c.pending) >= grpcCoalesceMaxBatch {
		c.flushLocked(false, nil, nil)
		return
	}
	if c.timer == nil {
		c.timer = time.AfterFunc(grpcCoalesceInterval, c.onTimer)
	}
}

func (c *grpcCoalescer) onTimer() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done || len(c.pending) == 0 {
		return
	}
	c.flushLocked(false, nil, nil)
}

// finish is the terminal flush — always sent, even with nothing pending, so the renderer always
// learns the call ended.
func (c *grpcCoalescer) finish(status *grpcclient.CallResult, errInfo *GrpcCallEventErr) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done {
		return
	}
	c.flushLocked(true, status, errInfo)
	c.done = true
}

func (c *grpcCoalescer) flushLocked(done bool, status *grpcclient.CallResult, errInfo *GrpcCallEventErr) {
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	seq := c.nextSeq
	msgs := c.pending
	if msgs == nil {
		msgs = []grpcclient.Message{}
	}
	c.pending = nil
	c.nextSeq += len(msgs)
	c.emit.EmitTo(c.windowKey, ChannelGrpcCall, GrpcCallEvent{
		CallID: c.callID, Seq: seq, Messages: msgs, Done: done, Status: status, Error: errInfo,
	})
}

// runServerStream is D8's own call: one op stays open for the life of the stream (P2 F12: a
// long-held bound call does not block the control plane), pushing every message through the
// coalescer above, and returning the terminal CallResult so a caller that misses every event still
// ends in a correct final state.
//
// Finding 4: a failed call's error must be masked *before* coalescer.finish emits it — Call's own
// masking, applied to the returned error after this function returns, runs too late for an event
// that has already gone out over the D8 push channel (and the renderer prefers that event's error
// over Call's own return value). used is threaded in so masking can happen here, on the same
// *grpcclient.Error the coalescer is about to emit. The Partial handed to EmitTo is a copy, taken
// after masking, so nothing downstream (Call's own recordGrpcHistory read of the same error) can
// alias the struct the coalescer has already queued for emission.
func (s *GrpcService) runServerStream(ctx context.Context, args GrpcCallArgs, req grpcclient.CallRequest, used []apivars.UsedSecret) (grpcclient.CallResult, error) {
	coalescer := newGrpcCoalescer(s.Deps.Events, args.WindowKey, args.OpID)

	result, err := grpcclient.ServerStream(ctx, req, coalescer.push)
	if err != nil {
		maskGrpcError(err, used)
		var gerr *grpcclient.Error
		if errors.As(err, &gerr) && gerr.Partial != nil {
			partial := *gerr.Partial
			coalescer.finish(&partial, &GrpcCallEventErr{Code: gerr.Code, Message: gerr.Message})
		} else if errors.As(err, &gerr) {
			coalescer.finish(nil, &GrpcCallEventErr{Code: gerr.Code, Message: gerr.Message})
		} else {
			coalescer.finish(nil, &GrpcCallEventErr{Code: grpcclient.CodeTransport, Message: err.Error()})
		}
		return grpcclient.CallResult{}, err
	}
	coalescer.finish(&result, nil)
	return result, nil
}

// ---- D10/D16: masking and error mapping ----

// maskGrpcError masks a *grpcclient.Error's own Message (and, for a partial stream result, its
// StatusMessage/Header/Trailer values) back to {{name}} form before it ever reaches mapGrpcError —
// the same strings.Replacer shape bridge/http.go's secretReplacer builds, a second consumer of the
// one unexported helper this package already has (D10's own last row). A no-op for any error that
// is not a *grpcclient.Error, or when nothing was actually substituted.
func maskGrpcError(err error, used []apivars.UsedSecret) {
	var gerr *grpcclient.Error
	if !errors.As(err, &gerr) {
		return
	}
	replacer := secretReplacer(used)
	if replacer == nil {
		return
	}
	gerr.Message = replacer.Replace(gerr.Message)
	if gerr.Partial != nil {
		gerr.Partial.StatusMessage = replacer.Replace(gerr.Partial.StatusMessage)
		for i := range gerr.Partial.Header {
			gerr.Partial.Header[i].Value = replacer.Replace(gerr.Partial.Header[i].Value)
		}
		for i := range gerr.Partial.Trailer {
			gerr.Partial.Trailer[i].Value = replacer.Replace(gerr.Partial.Trailer[i].Value)
		}
	}
}

// mapGrpcError joins grpcclient's own four-code vocabulary into the ipcerr family (D16) — mirrors
// mapHttpError (bridge/http.go): when the failure carries a Partial CallResult (a stream that
// delivered some messages before failing or being cancelled, F8), it is marshalled into Details
// for a renderer that knows how to read it, the same P10 D15 channel mapHttpError already uses.
func mapGrpcError(err error) error {
	var gerr *grpcclient.Error
	if errors.As(err, &gerr) {
		e := ipcerr.New(gerr.Code, gerr.Message)
		if gerr.Partial != nil {
			if b, mErr := json.Marshal(gerr.Partial); mErr == nil {
				e.Details = b
			} else {
				slog.Warn("marshalling partial gRPC call result failed", "scope", "bridge/grpc", "err", mErr)
			}
		}
		return e
	}
	return ipcerr.Internal(err.Error())
}
