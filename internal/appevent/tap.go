package appevent

// Tap forwards every window-wide Emit to sink as well as to the wrapped Emitter. EmitTo and
// EmitFocused are window-addressed, so they never reach the sink.
type Tap struct {
	Emitter
	sink func(name string, data any)
}

func NewTap(inner Emitter, sink func(name string, data any)) *Tap {
	return &Tap{Emitter: inner, sink: sink}
}

func (t *Tap) Emit(name string, data any) {
	t.Emitter.Emit(name, data)
	t.sink(name, data)
}
