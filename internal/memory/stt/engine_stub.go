//go:build !(whisper && cgo)

package stt

// Built reports whether this binary carries the whisper.cpp engine.
const Built = false

func newEngine(modelDir string) (engine, error) { return nil, ErrNoEngine }
