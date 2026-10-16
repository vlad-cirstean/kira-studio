//go:build !cgo

package embed

func newEncoder(string, string, Spec) (encoder, error) { return nil, ErrNoRuntime }
