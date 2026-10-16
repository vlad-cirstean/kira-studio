//go:build server

package shell

// EmitTo broadcasts in the -tags server build: a browser client is no named window (GetByName finds
// none) and DispatchWailsEvent is a no-op there. Every page gets every event; only payloads that
// carry an id can be filtered by a listener (see docs/DEV_ENVIRONMENT.md).
func (e *emitter) EmitTo(_ string, name string, data any) {
	e.Emit(name, data)
}
