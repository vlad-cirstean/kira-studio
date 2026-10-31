package oplog

import "context"

// Origin says where work came from. It travels in ctx so the shared git runner can attribute a
// spawn without knowing which module asked.
type Origin struct {
	Module, Trigger, Label, TaskID string
	// Background forces every spawn under it into the background lane (auto-fetch).
	Background bool
}

type originKey struct{}
type opKey struct{}

// WithOrigin returns ctx stamped with o.
func WithOrigin(ctx context.Context, o Origin) context.Context {
	return context.WithValue(ctx, originKey{}, o)
}

// OriginFrom returns the stamped origin, if any.
func OriginFrom(ctx context.Context) (Origin, bool) {
	o, ok := ctx.Value(originKey{}).(Origin)
	return o, ok
}

// WithOp carries the enclosing op down to the spawn sites, which record their argv as its steps.
func WithOp(ctx context.Context, op *Op) context.Context {
	if op == nil {
		return ctx
	}
	return context.WithValue(ctx, opKey{}, op)
}

// OpFrom returns the enclosing op, or nil.
func OpFrom(ctx context.Context) *Op {
	op, _ := ctx.Value(opKey{}).(*Op)
	return op
}
