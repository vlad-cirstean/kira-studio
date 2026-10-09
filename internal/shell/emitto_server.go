//go:build server

package shell

// EmitTo broadcasts in the -tags server build: a browser client is no named window (GetByName finds
// none) and DispatchWailsEvent is a no-op there. Listeners filter by their own ids.
func (e *emitter) EmitTo(_ string, name string, data any) {
	e.Emit(name, data)
}
