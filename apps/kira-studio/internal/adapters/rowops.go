package adapters

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// RunRowOps is redis/mongo/s3/sqs's own mutate loop, carried verbatim across all four (P107
// T2-4): readOnly guard, iterate plan.Ops, call apply per op, accumulate the affected count,
// assemble the result. apply owns the per-op-kind switch and any per-engine error mapping; i is
// the op's own index in plan.Ops, for an apply that wants it.
func RunRowOps(ctx context.Context, plan model.MutationPlan, readOnly bool, apply func(ctx context.Context, i int, op model.MutationRowOp) (affected int, err error)) (model.MutationResult, error) {
	if err := AssertWritable(readOnly); err != nil {
		return model.MutationResult{}, err
	}
	affectedRows := 0
	for i, op := range plan.Ops {
		if err := CheckCancelled(ctx); err != nil {
			return model.MutationResult{}, err
		}
		affected, err := apply(ctx, i, op)
		if err != nil {
			return model.MutationResult{}, err
		}
		affectedRows += affected
	}
	return model.MutationResult{AffectedRows: affectedRows}, nil
}

// RunKindDispatched folds mutate's own statements-join + SetCommand + RunRowOps call, repeated
// across mongo/redis/s3/sqs (P107 I2-12) with a hand-rolled ";\n" join loop T1-3's own
// strings.Join replacement missed. dispatch is the caller's own per-op-kind switch — sqs's own
// switch (no true "update" case, an unsupported error instead) genuinely differs from
// mongo/redis/s3's shared "update/delete/default-insert" shape (DispatchUpdateDeleteInsert
// below), so the switch itself is the caller's, not folded in here.
func RunKindDispatched(ctx context.Context, op *OpCtx, plan model.MutationPlan, readOnly bool, statements []string, dispatch func(ctx context.Context, i int, rowOp model.MutationRowOp) (int, error)) (model.MutationResult, error) {
	op.SetCommand(strings.Join(statements, ";\n"))
	return RunRowOps(ctx, plan, readOnly, dispatch)
}

// DispatchUpdateDeleteInsert wraps mongo/redis/s3's own shared per-op switch (update, delete,
// default insert) as a RunKindDispatched dispatch func (P107 I2-12).
func DispatchUpdateDeleteInsert(update, delete, insert func(ctx context.Context, rowOp model.MutationRowOp) (int, error)) func(ctx context.Context, i int, rowOp model.MutationRowOp) (int, error) {
	return func(ctx context.Context, _ int, rowOp model.MutationRowOp) (int, error) {
		switch rowOp.Kind {
		case "update":
			return update(ctx, rowOp)
		case "delete":
			return delete(ctx, rowOp)
		default: // insert
			return insert(ctx, rowOp)
		}
	}
}

// ParseHeaderJSON is kafka/produce.go's parseProduceHeaders == sqs/mutate.go's parseHeaders: a
// $headers value is a flat JSON object of string values, or absent entirely.
func ParseHeaderJSON(raw *string) (map[string]string, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(*raw), &parsed); err != nil {
		return nil, New(CodeQuery, "malformed $headers JSON", err)
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return nil, New(CodeQuery, "$headers must be a JSON object of string values", nil)
	}
	out := make(map[string]string, len(obj))
	for k, v := range obj {
		s, ok := v.(string)
		if !ok {
			return nil, New(CodeQuery, "$headers."+k+" must be a string", nil)
		}
		out[k] = s
	}
	return out, nil
}

// ValueFrom is redis/mutate.go's valueFrom == s3/mutate.go's valueFrom: the required, non-nil
// (but possibly empty) $value sentinel.
func ValueFrom(values model.RowValues, label string) (string, error) {
	raw, ok := values.Get("$value")
	if !ok || raw == nil {
		return "", New(CodeUnsupported, "a "+label+" mutation requires a $value", nil)
	}
	return *raw, nil
}

// PreviewProduce is kafka/produce.go's preview == sqs/mutate.go's preview: render each op via the
// caller's own renderOpText, keyed off one target name (topic or queue).
func PreviewProduce(plan model.MutationPlan, target string, renderOpText func(op model.MutationRowOp, target string) (string, error)) ([]string, error) {
	out := make([]string, len(plan.Ops))
	for i, op := range plan.Ops {
		text, err := renderOpText(op, target)
		if err != nil {
			return nil, err
		}
		out[i] = text
	}
	return out, nil
}
