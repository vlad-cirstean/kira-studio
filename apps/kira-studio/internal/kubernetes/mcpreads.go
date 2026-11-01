package kubernetes

import (
	"context"
	"io"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	corev1 "k8s.io/api/core/v1"
)

// mcpLogBytes caps one MCP log read.
const mcpLogBytes = 256 << 10

// ListCapped is List with a caller-chosen row cap.
func (s *Service) ListCapped(ctx context.Context, args ListArgs, max int) (ListResult, error) {
	return s.list(ctx, args, max)
}

// LogsReadArgs is ReadLogs' argument: a one-shot, non-follow read.
type LogsReadArgs struct {
	ClusterID  string
	Namespace  string
	Pod        string
	Container  string
	Previous   bool
	Timestamps bool
	Tail       int
}

// LogsReadResult holds the framed lines; Truncated means the byte limit cut the read short.
type LogsReadResult struct {
	Lines     []LogLine `json:"lines"`
	Truncated bool      `json:"truncated"`
}

// ReadLogs reads the last Tail lines of one container, up to mcpLogBytes.
func (s *Service) ReadLogs(ctx context.Context, args LogsReadArgs) (LogsReadResult, error) {
	switch {
	case args.ClusterID == "":
		return LogsReadResult{}, ipcerr.Required("clusterId")
	case args.Namespace == "":
		return LogsReadResult{}, ipcerr.Required("namespace")
	case args.Pod == "":
		return LogsReadResult{}, ipcerr.Required("pod")
	case args.Tail <= 0:
		return LogsReadResult{}, ipcerr.Contract("tail must be positive")
	}
	cs, err := s.client(args.ClusterID)
	if err != nil {
		return LogsReadResult{}, mapErr(err)
	}
	cctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	tail, limit := int64(args.Tail), int64(mcpLogBytes)
	body, err := cs.core.Pods(args.Namespace).GetLogs(args.Pod, &corev1.PodLogOptions{
		Container: args.Container, Previous: args.Previous, Timestamps: args.Timestamps,
		TailLines: &tail, LimitBytes: &limit,
	}).Stream(cctx)
	if err != nil {
		return LogsReadResult{}, mapErr(err)
	}
	defer body.Close()
	raw, err := io.ReadAll(body)
	if err != nil {
		return LogsReadResult{}, mapErr(err)
	}
	framer := newLineFramer(args.Timestamps)
	lines := append(framer.write(raw), framer.flush()...)
	if lines == nil {
		lines = []LogLine{}
	}
	return LogsReadResult{Lines: lines, Truncated: len(raw) >= mcpLogBytes}, nil
}
